/**
 * DesignCraft — headless book compositor for Fusion Lab Studio.
 * Studio's book JSON stays canonical; every render uses an isolated temp job.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { DEFAULT_LAYOUT_SPEC, PAGE_SIZES, type PdfLayoutSpec } from '../pdfTypes';
import {
  buildDesigncraftRtf,
  IMAGE_BEGIN,
  IMAGE_END,
  type DesigncraftManuscript,
} from '../designcraft/rtf';
import { extensionForMime, loadImageBytes } from '../../media/imageBytes';
import { run } from './pandocEngine';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

export const DESIGNCRAFT_PATH = process.env.DESIGNCRAFT_PATH || 'designcraft-cli';
const DESIGNCRAFT_TIMEOUT_MS = Number(process.env.DESIGNCRAFT_TIMEOUT_MS) || 180_000;
const PAGE_NUMBER_MARKER = '\uE000';

interface InspectPage {
  index: number;
  name?: string;
  bounds: [number, number, number, number];
}
interface InspectSpread {
  index: number;
  pages: InspectPage[];
}
interface InspectResult {
  spreads?: InspectSpread[];
}
interface ImagePlacement {
  placeholder: string;
  path?: string;
  captionUk: string;
  errorUk?: string;
  start: number;
  end: number;
}

function mergedSpec(input?: Partial<PdfLayoutSpec>): PdfLayoutSpec {
  return {
    ...DEFAULT_LAYOUT_SPEC,
    ...(input || {}),
    margins: { ...DEFAULT_LAYOUT_SPEC.margins, ...(input?.margins || {}) },
    chapterTitle: { ...DEFAULT_LAYOUT_SPEC.chapterTitle, ...(input?.chapterTitle || {}) },
    sectionTitle: { ...DEFAULT_LAYOUT_SPEC.sectionTitle, ...(input?.sectionTitle || {}) },
    titlePage: { ...DEFAULT_LAYOUT_SPEC.titlePage, ...(input?.titlePage || {}) },
    frontMatter: { ...DEFAULT_LAYOUT_SPEC.frontMatter, ...(input?.frontMatter || {}) },
    pageNumber: { ...DEFAULT_LAYOUT_SPEC.pageNumber, ...(input?.pageNumber || {}) },
    runningHead: { ...DEFAULT_LAYOUT_SPEC.runningHead, ...(input?.runningHead || {}) },
  };
}

function pageSize(spec: PdfLayoutSpec): { width: number; height: number } {
  if (Number(spec.pageWidthPt) > 0 && Number(spec.pageHeightPt) > 0) {
    return { width: Number(spec.pageWidthPt), height: Number(spec.pageHeightPt) };
  }
  return PAGE_SIZES[spec.pageSize] || PAGE_SIZES.A5;
}

function jsonLine(command: string, params: Record<string, unknown> = {}): string {
  return `${command} ${JSON.stringify(params)}`;
}

function reportFrom(stdout: string): any {
  const text = stdout.trim();
  if (!text) throw new Error('DesignCraft не повернув звіт виконання.');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`DesignCraft повернув не JSON: ${text.slice(0, 400)}`, { cause: err as Error });
  }
}

function reportFailed(report: any): boolean {
  return report?.failedIndex !== undefined && report?.failedIndex !== null;
}

function errorSummary(stdout: string, stderr: string): string {
  try {
    const report = reportFrom(stdout);
    if (reportFailed(report)) {
      return `Крок ${report.failedIndex}: ${JSON.stringify(report.failed)}`;
    }
  } catch {
    // Fall through to stderr/plain output.
  }
  const err = stderr.trim();
  if (err) return err.slice(-1600);
  return stdout.trim().slice(-1600) || 'DesignCraft завершився помилкою без пояснення.';
}

async function cliWorks(): Promise<boolean> {
  const result = await run(DESIGNCRAFT_PATH, ['--version'], { timeoutMs: 12_000 });
  return result.code === 0;
}

function frameTextCommands(
  spread: number,
  rect: [number, number, number, number],
  text: string,
  size: number,
  align: 'left' | 'center' | 'right' = 'center'
): string[] {
  if (!text.trim()) return [];
  return [
    jsonLine('frame.create', { spread, rect, content: 'text', text }),
    jsonLine('text.selectStory', {
      frame: '$last.id',
      point: [(rect[0] + rect[2]) / 2, rect[1] + 8],
    }),
    jsonLine('type.para', { attrs: { align } }),
    jsonLine('type.char', { attrs: { size } }),
  ];
}

function titleCommands(request: PdfRenderRequest, spec: PdfLayoutSpec): string[] {
  if (!spec.titlePage.show) return [];
  const { width, height } = pageSize(spec);
  const left = spec.margins.left;
  const right = width - spec.margins.right;
  const titleY = height * 0.27;
  return [
    ...frameTextCommands(
      0,
      [left, titleY, right, titleY + 100],
      String(request.book.title || 'Без назви'),
      spec.titlePage.titleSize
    ),
    ...frameTextCommands(
      0,
      [left, titleY + 115, right, titleY + 165],
      String(request.book.subtitle || ''),
      spec.titlePage.subtitleSize
    ),
    ...frameTextCommands(
      0,
      [left, height * 0.70, right, height * 0.70 + 45],
      String(request.book.author || ''),
      spec.titlePage.authorSize
    ),
  ];
}

function initialScript(request: PdfRenderRequest, spec: PdfLayoutSpec, manuscriptPath: string): string {
  const { width, height } = pageSize(spec);
  const tocPage = spec.titlePage.show ? 2 : 1;
  const bodyPage = tocPage + 1;
  const entries = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
  const commands = [
    jsonLine('file.new', {
      width,
      height,
      pages: bodyPage,
      facingPages: false,
      margins: {
        top: spec.margins.top,
        bottom: spec.margins.bottom,
        inside: spec.margins.left,
        outside: spec.margins.right,
      },
      title: request.book.title || 'Fusion Lab book',
    }),
    // IMPORTANT: import the manuscript before creating/selecting title frames.
    // file.place prioritises the current text caret over its `page` argument.
    jsonLine('file.place', {
      path: manuscriptPath,
      page: bodyPage,
      autoflow: true,
      styleConflicts: 'useExisting',
    }),
    jsonLine('style.paragraph.edit', {
      name: 'Body',
      para: {
        align: spec.bodyAlign === 'left' ? 'left' : 'justify',
        firstLineIndent: spec.paragraphIndent,
        spaceAfter: spec.paragraphSpacing,
      },
      chars: { size: spec.baseFontSize, fontFamily: 'DejaVu Serif' },
    }),
    jsonLine('style.paragraph.edit', {
      name: 'Heading 1',
      para: { align: spec.chapterTitle.align || 'left', spaceBefore: spec.chapterTitle.spaceBefore, spaceAfter: spec.chapterTitle.spaceAfter },
      chars: { size: spec.chapterTitle.fontSize, fontFamily: 'DejaVu Serif', fontStyle: 'Bold' },
    }),
    jsonLine('style.paragraph.edit', {
      name: 'Heading 2',
      para: { align: spec.sectionTitle.align || 'left', spaceBefore: spec.sectionTitle.spaceBefore, spaceAfter: spec.sectionTitle.spaceAfter },
      chars: { size: spec.sectionTitle.fontSize, fontFamily: 'DejaVu Serif', fontStyle: 'Bold' },
    }),
    jsonLine('layout.section', {
      page: bodyPage,
      startNumber: Math.max(1, Math.round(spec.pageNumber.startAt || 1)),
      style: 'arabic',
    }),
    ...titleCommands(request, spec),
    jsonLine('toc.generate', {
      styles: entries,
      title: spec.frontMatter.contentsTitle || 'Зміст',
      pageNumbers: true,
      page: tocPage,
    }),
    jsonLine('document.inspect'),
  ];
  return commands.join('\n') + '\n';
}

function bodyStartPhysicalPage(spec: PdfLayoutSpec): number {
  return spec.titlePage.show ? 3 : 2;
}

function byteOffset(text: string, charIndex: number): number {
  return Buffer.byteLength(text.slice(0, charIndex), 'utf8');
}

function locateImageBlocks(text: string, manuscript: DesigncraftManuscript): ImagePlacement[] {
  const result: ImagePlacement[] = [];
  for (const image of manuscript.images) {
    const begin = IMAGE_BEGIN(image.placeholder);
    const end = IMAGE_END(image.placeholder);
    const a = text.indexOf(begin);
    const b0 = text.indexOf(end, a >= 0 ? a + begin.length : 0);
    if (a < 0 || b0 < 0) {
      throw new Error(`У імпортованому рукописі зник маркер ілюстрації ${image.placeholder}.`);
    }
    const b = b0 + end.length;
    result.push({
      placeholder: image.placeholder,
      captionUk: image.captionUk,
      start: byteOffset(text, a),
      end: byteOffset(text, b),
    });
  }
  return result.sort((a, b) => b.start - a.start);
}

async function prepareImages(
  workDir: string,
  manuscript: DesigncraftManuscript,
  placements: ImagePlacement[],
  ownerId?: string | null
): Promise<string[]> {
  const notes: string[] = [];
  const byPlaceholder = new Map(placements.map((p) => [p.placeholder, p]));
  for (const image of manuscript.images) {
    const target = byPlaceholder.get(image.placeholder);
    if (!target) continue;
    try {
      const loaded = await loadImageBytes(image.url, ownerId);
      const ext = extensionForMime(loaded.mimeType);
      const imagePath = path.join(workDir, `${image.placeholder}.${ext}`);
      await fs.writeFile(imagePath, loaded.bytes);
      target.path = imagePath;
    } catch (err) {
      target.errorUk = (err as Error).message;
      notes.push(`Ілюстрація «${image.captionUk || image.placeholder}» не вставлена: ${target.errorUk}`);
    }
  }
  return notes;
}

function pageNumberRect(
  page: InspectPage,
  spec: PdfLayoutSpec
): { rect: [number, number, number, number]; align: 'left' | 'center' | 'right' } {
  const [x0, y0, x1, y1] = page.bounds;
  const w = 72;
  const h = 18;
  const position = spec.pageNumber.position || 'bottom-center';
  const top = position.startsWith('top');
  const y = top
    ? y0 + Math.max(10, spec.margins.top * 0.25)
    : y1 - Math.max(30, spec.margins.bottom * 0.62);
  if (position.endsWith('left')) {
    return { rect: [x0 + spec.margins.left, y, x0 + spec.margins.left + w, y + h], align: 'left' };
  }
  if (position.endsWith('right')) {
    return { rect: [x1 - spec.margins.right - w, y, x1 - spec.margins.right, y + h], align: 'right' };
  }
  const cx = (x0 + x1) / 2;
  return { rect: [cx - w / 2, y, cx + w / 2, y + h], align: 'center' };
}

function finalScript(
  request: PdfRenderRequest,
  inspect: InspectResult,
  story: number,
  placements: ImagePlacement[],
  spec: PdfLayoutSpec,
  imageWidth: number
): string {
  const bodyStart = bodyStartPhysicalPage(spec);
  const commands: string[] = [];

  // Work from the end backwards so earlier UTF-8 offsets stay valid.
  for (const image of placements) {
    commands.push(jsonLine('story.replaceRange', {
      story,
      start: image.start,
      end: image.end,
      text: '',
    }));
    if (image.path) {
      commands.push(jsonLine('file.place', {
        path: image.path,
        spread: 0,
        x: 0,
        y: 0,
        width: imageWidth,
      }));
      commands.push(jsonLine('anchored.insert', {
        ids: ['$last.id'],
        story,
        pos: image.start,
        position: 'aboveLine',
        align: 'center',
        spaceBefore: 8,
        spaceAfter: 10,
      }));
    }
  }

  if (spec.runningHead.show && spec.runningHead.content === 'chapter') {
    commands.push(jsonLine('variables.define', {
      name: 'FusionLab Chapter',
      type: 'runningHeader',
      style: 'Heading 1',
      use: 'lastOnPage',
    }));
  }

  for (const spread of inspect.spreads || []) {
    for (const page of spread.pages || []) {
      const physical = Number(page.index) + 1;
      if (physical < bodyStart) continue;
      const [x0, y0, x1] = page.bounds;

      if (spec.runningHead.show) {
        const y = y0 + Math.max(12, spec.margins.top * 0.28);
        const rect: [number, number, number, number] = [
          x0 + spec.margins.left,
          y,
          x1 - spec.margins.right,
          y + 18,
        ];
        if (spec.runningHead.content === 'chapter') {
          commands.push(jsonLine('frame.create', { spread: spread.index, rect, content: 'text', text: '' }));
          commands.push(jsonLine('text.select', { story: '$last.story', anchor: 0, focus: 0 }));
          commands.push(jsonLine('variables.insert', { name: 'FusionLab Chapter' }));
          commands.push(jsonLine('type.para', { attrs: { align: 'center' } }));
          commands.push(jsonLine('type.char', { attrs: { size: spec.runningHead.fontSize } }));
        } else {
          const value = spec.runningHead.content === 'author'
            ? String(request.book.author || '')
            : String(request.book.title || '');
          commands.push(...frameTextCommands(spread.index, rect, value, spec.runningHead.fontSize));
        }
      }

      if (spec.pageNumber.show) {
        const number = pageNumberRect(page, spec);
        commands.push(jsonLine('frame.create', {
          spread: spread.index,
          rect: number.rect,
          content: 'text',
          text: PAGE_NUMBER_MARKER,
        }));
        commands.push(jsonLine('text.selectStory', {
          frame: '$last.id',
          point: [(number.rect[0] + number.rect[2]) / 2, number.rect[1] + 6],
        }));
        commands.push(jsonLine('type.para', { attrs: { align: number.align } }));
        commands.push(jsonLine('type.char', { attrs: { size: spec.pageNumber.fontSize } }));
      }
    }
  }

  const tocStyles = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
  commands.push(jsonLine('toc.update'));
  commands.push(jsonLine('story.get', { story }));
  commands.push(jsonLine('anchored.list', { story }));
  commands.push(jsonLine('toc.entries', { styles: tocStyles }));
  commands.push(jsonLine('document.inspect'));
  return commands.join('\n') + '\n';
}

async function runScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  timeoutMessage: string
): Promise<any> {
  const result = await run(DESIGNCRAFT_PATH, ['script', scriptPath, ...args], {
    cwd,
    timeoutMs: DESIGNCRAFT_TIMEOUT_MS,
  });
  if (result.timedOut) throw new PdfEngineError('designcraft', 'timeout', timeoutMessage);
  if (result.code !== 0) {
    throw new PdfEngineError('designcraft', 'engine', errorSummary(result.stdout, result.stderr));
  }
  const report = reportFrom(result.stdout);
  if (reportFailed(report)) {
    throw new PdfEngineError(
      'designcraft',
      'engine',
      `Помилка кроку ${report.failedIndex}: ${JSON.stringify(report.failed)}`
    );
  }
  return report;
}

export const designcraftEngine: PdfEngine = {
  id: 'designcraft',
  label: 'DesignCraft',
  strengthUk:
    'Професійна книжкова верстка: автоматичне перетікання, стилі, зміст, ілюстрації, колонтитули та нумерація.',
  limitUk:
    'Друкований KDP-макет із розрахунком корінця поки лишається за Nova; DesignCraft використовується для цифрового PDF.',
  supportsPrint: false,

  async available(): Promise<PdfEngineAvailability> {
    if (await cliWorks()) return { ok: true };
    return {
      ok: false,
      reasonUk: `DesignCraft CLI не знайдено (${DESIGNCRAFT_PATH}).`,
      fixUk: 'У production він встановлюється в Docker-образ; локально задайте DESIGNCRAFT_PATH.',
    };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const state = await this.available();
    if (!state.ok) {
      throw new PdfEngineError('designcraft', 'unavailable', state.reasonUk || 'DesignCraft недоступний.');
    }

    const spec = mergedSpec(request.spec);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-designcraft-'));
    // Tagged Text must have a plain-text extension; the DesignCraft importer
    // sniffs its <ASCII-WIN> header and preserves paragraph style names.
    const manuscriptPath = path.join(workDir, 'manuscript.txt');
    const buildScript = path.join(workDir, 'build.dcs');
    const storyScript = path.join(workDir, 'story.dcs');
    const finalPath = path.join(workDir, 'final.dcs');
    const doc1 = path.join(workDir, 'book-flow.designcraft');
    const doc2 = path.join(workDir, 'book-final.designcraft');
    const pdfPath = path.join(workDir, 'book.pdf');

    try {
      const manuscript = buildDesigncraftRtf(request.book, spec);
      await fs.writeFile(manuscriptPath, manuscript.rtf, 'utf8');
      await fs.writeFile(buildScript, initialScript(request, spec, manuscriptPath), 'utf8');

      const firstReport = await runScript(
        buildScript,
        ['--save', doc1],
        workDir,
        'DesignCraft не завершив первинну верстку вчасно.'
      );
      const firstResults = Array.isArray(firstReport.results) ? firstReport.results : [];
      const placed = firstResults.find(
        (v: any) => v && typeof v === 'object' && 'pagesAdded' in v && 'overset' in v
      );
      if (!placed || !Number.isFinite(Number(placed.story))) {
        throw new PdfEngineError('designcraft', 'engine', 'DesignCraft не повернув story після імпорту рукопису.');
      }
      if (placed.overset) {
        throw new PdfEngineError('designcraft', 'engine', 'Автоперетікання завершилось із прихованим текстом (overset).');
      }
      const story = Number(placed.story);
      const inspect = [...firstResults].reverse().find((v: any) => v?.spreads) as InspectResult | undefined;
      if (!inspect?.spreads?.length) {
        throw new PdfEngineError('designcraft', 'engine', 'Після автоперетікання немає структури сторінок.');
      }

      await fs.writeFile(storyScript, jsonLine('story.get', { story }) + '\n', 'utf8');
      const storyReport = await runScript(
        storyScript,
        ['--in', doc1],
        workDir,
        'DesignCraft не повернув текст для перевірки ілюстрацій.'
      );
      const storyText = String(storyReport.results?.[0]?.text || '');
      const placements = locateImageBlocks(storyText, manuscript);
      const notesUk = await prepareImages(workDir, manuscript, placements, request.ownerId);
      if (manuscript.unresolvedMarkers.length) {
        notesUk.push(
          `Картинок за маркером не знайдено: ${manuscript.unresolvedMarkers.join(', ')}. ` +
          'Службовий маркер у PDF не друкується.'
        );
      }

      const { width } = pageSize(spec);
      const textWidth = width - spec.margins.left - spec.margins.right;
      const widthFactors = placements.some((p) => p.path) ? [0.64, 0.52, 0.42] : [0.64];
      let finalReport: any = null;
      let fittedWidth = Math.min(260, textWidth * widthFactors[0]);

      for (const factor of widthFactors) {
        fittedWidth = Math.min(260, textWidth * factor);
        await fs.writeFile(
          finalPath,
          finalScript(request, inspect, story, placements, spec, fittedWidth),
          'utf8'
        );
        finalReport = await runScript(
          finalPath,
          ['--in', doc1, '--save', doc2, '--export', pdfPath],
          workDir,
          'DesignCraft не завершив фінальний PDF вчасно.'
        );
        const results = Array.isArray(finalReport.results) ? finalReport.results : [];
        const storyState = results.at(-4);
        if (!storyState?.overset) break;
        finalReport = null;
      }
      if (!finalReport) {
        throw new PdfEngineError(
          'designcraft',
          'engine',
          'Ілюстрації спричинили overset навіть після автоматичного зменшення. Публікацію зупинено.'
        );
      }

      const finalResults = Array.isArray(finalReport.results) ? finalReport.results : [];
      const storyState = finalResults.at(-4);
      const anchored = finalResults.at(-3);
      const toc = finalResults.at(-2);
      const finalInspect = finalResults.at(-1) as InspectResult;
      if (storyState?.overset) {
        throw new PdfEngineError('designcraft', 'engine', 'Фінальна перевірка: у книзі лишився overset.');
      }
      const loadedImageCount = placements.filter((p) => p.path).length;
      if (!Array.isArray(anchored) || anchored.length !== loadedImageCount) {
        throw new PdfEngineError(
          'designcraft',
          'engine',
          `Фінальна перевірка ілюстрацій: очікувалось ${loadedImageCount}, отримано ${Array.isArray(anchored) ? anchored.length : 0}.`
        );
      }
      const chapterCount = request.book.chapters?.length || 0;
      const chapterEntries = Array.isArray(toc) ? toc.filter((e: any) => Number(e?.level) === 1) : [];
      if (chapterCount > 0 && chapterEntries.length !== chapterCount) {
        throw new PdfEngineError(
          'designcraft',
          'engine',
          `Фінальна перевірка змісту: глав ${chapterCount}, а записів першого рівня ${chapterEntries.length}.`
        );
      }

      const bytes = new Uint8Array(await fs.readFile(pdfPath));
      if (bytes.byteLength < 1000) {
        throw new PdfEngineError('designcraft', 'engine', 'DesignCraft створив підозріло малий PDF.');
      }
      const pdf = await PDFDocument.load(bytes);
      const pageCount = pdf.getPageCount();
      const inspectedPages = (finalInspect?.spreads || []).reduce(
        (n, spread) => n + (spread.pages?.length || 0),
        0
      );
      if (pageCount !== inspectedPages || pageCount < bodyStartPhysicalPage(spec)) {
        throw new PdfEngineError(
          'designcraft',
          'engine',
          `Фінальна перевірка сторінок не пройшла: PDF=${pageCount}, документ=${inspectedPages}.`
        );
      }

      notesUk.unshift(
        `DesignCraft: ${pageCount} стор., автоматичне перетікання без overset, зміст синхронізовано, ` +
        `${loadedImageCount} ілюстрацій перевірено${loadedImageCount ? ` (ширина до ${Math.round(fittedWidth)} pt)` : ''}.`
      );
      return {
        bytes,
        pageCount,
        engineId: 'designcraft',
        honoredSpec: true,
        notesUk,
      };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('designcraft', 'engine', `DesignCraft: ${(err as Error).message}`);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};

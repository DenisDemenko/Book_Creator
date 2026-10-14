/**
 * DesignCraft — headless book compositor for Fusion Lab Studio.
 *
 * Studio JSON is canonical. Every render is isolated in a temporary job and
 * builds a fresh DesignCraft document; no DesignCraft ids leak into Studio.
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
const TIMEOUT_MS = Number(process.env.DESIGNCRAFT_TIMEOUT_MS) || 180_000;
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
  captionUk: string;
  start: number;
  end: number;
  path?: string;
}

function specOf(input?: Partial<PdfLayoutSpec>): PdfLayoutSpec {
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

function cmd(command: string, params: Record<string, unknown> = {}): string {
  return `${command} ${JSON.stringify(params)}`;
}

function parseReport(stdout: string): any {
  const text = stdout.trim();
  if (!text) throw new Error('DesignCraft не повернув JSON-звіт.');
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`DesignCraft повернув не JSON: ${text.slice(0, 500)}`, { cause: err as Error });
  }
}

function failed(report: any): boolean {
  return report?.failedIndex !== undefined && report?.failedIndex !== null;
}

function reportError(report: any): string {
  const index = report?.failedIndex;
  const command = report?.failedCommand ? ` (${report.failedCommand})` : '';
  const message = report?.error || report?.failed || 'невідома помилка';
  return index === undefined || index === null
    ? String(message)
    : `Крок ${index}${command}: ${String(message)}`;
}

async function runScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  timeoutMessage: string
): Promise<any> {
  const result = await run(DESIGNCRAFT_PATH, ['script', scriptPath, ...args], {
    cwd,
    timeoutMs: TIMEOUT_MS,
  });
  if (result.timedOut) throw new PdfEngineError('designcraft', 'timeout', timeoutMessage);

  let report: any = null;
  try {
    report = parseReport(result.stdout);
  } catch (err) {
    if (result.code === 0) throw err;
  }
  if (report && failed(report)) {
    throw new PdfEngineError('designcraft', 'engine', reportError(report));
  }
  if (result.code !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || 'DesignCraft завершився з помилкою.';
    throw new PdfEngineError('designcraft', 'engine', message.slice(-1800));
  }
  if (!report) report = parseReport(result.stdout);
  return report;
}

function dcAlign(value: string | undefined): 'left' | 'center' | 'right' | 'leftJustified' {
  if (value === 'center' || value === 'right' || value === 'left') return value;
  return 'leftJustified';
}

function createStyles(spec: PdfLayoutSpec): string[] {
  return [
    cmd('style.paragraph.create', {
      name: 'Body',
      para: {
        align: dcAlign(spec.bodyAlign),
        firstLineIndent: spec.paragraphIndent,
        spaceAfter: spec.paragraphSpacing,
      },
      chars: { size: spec.baseFontSize, fontFamily: 'DejaVu Serif' },
    }),
    cmd('style.paragraph.create', {
      name: 'Heading 1',
      para: {
        align: dcAlign(spec.chapterTitle.align),
        spaceBefore: spec.chapterTitle.spaceBefore,
        spaceAfter: spec.chapterTitle.spaceAfter,
      },
      chars: {
        size: spec.chapterTitle.fontSize,
        fontFamily: 'DejaVu Serif',
        fontStyle: 'Bold',
      },
    }),
    cmd('style.paragraph.create', {
      name: 'Heading 2',
      para: {
        align: dcAlign(spec.sectionTitle.align),
        spaceBefore: spec.sectionTitle.spaceBefore,
        spaceAfter: spec.sectionTitle.spaceAfter,
      },
      chars: {
        size: spec.sectionTitle.fontSize,
        fontFamily: 'DejaVu Serif',
        fontStyle: 'Bold',
      },
    }),
  ];
}

function textFrame(
  spread: number,
  rect: [number, number, number, number],
  text: string,
  size: number,
  align: 'left' | 'center' | 'right' = 'center'
): string[] {
  if (!text.trim()) return [];
  // frame.create leaves the new frame selected. In DesignCraft v0.7.1 both
  // type.para and type.char can format a selected text frame directly.
  return [
    cmd('frame.create', { spread, rect, content: 'text', text }),
    cmd('type.para', { attrs: { align } }),
    cmd('type.char', { attrs: { size } }),
  ];
}

function titleFrames(request: PdfRenderRequest, spec: PdfLayoutSpec): string[] {
  if (!spec.titlePage.show) return [];
  const { width, height } = pageSize(spec);
  const left = spec.margins.left;
  const right = width - spec.margins.right;
  const y = height * 0.27;
  return [
    ...textFrame(0, [left, y, right, y + 100], String(request.book.title || 'Без назви'), spec.titlePage.titleSize),
    ...textFrame(0, [left, y + 115, right, y + 165], String(request.book.subtitle || ''), spec.titlePage.subtitleSize),
    ...textFrame(0, [left, height * 0.70, right, height * 0.70 + 45], String(request.book.author || ''), spec.titlePage.authorSize),
  ];
}

function bodyPhysicalStart(spec: PdfLayoutSpec): number {
  return spec.titlePage.show ? 3 : 2;
}

function firstScript(request: PdfRenderRequest, spec: PdfLayoutSpec, manuscriptPath: string): string {
  const { width, height } = pageSize(spec);
  const tocPage = spec.titlePage.show ? 2 : 1;
  const bodyPage = tocPage + 1;
  const tocStyles = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
  return [
    cmd('file.new', {
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
    ...createStyles(spec),
    // Import after final styles exist so autoflow composes final typography.
    cmd('file.place', {
      path: manuscriptPath,
      page: bodyPage,
      autoflow: true,
      styleConflicts: 'useExisting',
    }),
    cmd('layout.section', {
      page: bodyPage,
      startNumber: Math.max(1, Math.round(spec.pageNumber.startAt || 1)),
      style: 'arabic',
    }),
    ...titleFrames(request, spec),
    cmd('toc.generate', {
      styles: tocStyles,
      title: spec.frontMatter.contentsTitle || 'Зміст',
      pageNumbers: true,
      page: tocPage,
    }),
    cmd('document.inspect'),
  ].join('\n') + '\n';
}

function byteOffset(text: string, charIndex: number): number {
  return Buffer.byteLength(text.slice(0, charIndex), 'utf8');
}

function imageBlocks(text: string, manuscript: DesigncraftManuscript): ImagePlacement[] {
  const out: ImagePlacement[] = [];
  for (const image of manuscript.images) {
    const begin = IMAGE_BEGIN(image.placeholder);
    const end = IMAGE_END(image.placeholder);
    const a = text.indexOf(begin);
    const e = text.indexOf(end, Math.max(0, a + begin.length));
    if (a < 0 || e < 0) {
      throw new Error(`Зник службовий маркер ілюстрації ${image.placeholder}.`);
    }
    const b = e + end.length;
    out.push({
      placeholder: image.placeholder,
      captionUk: image.captionUk,
      start: byteOffset(text, a),
      end: byteOffset(text, b),
    });
  }
  return out.sort((a, b) => b.start - a.start);
}

async function loadImages(
  workDir: string,
  manuscript: DesigncraftManuscript,
  placements: ImagePlacement[],
  ownerId?: string | null
): Promise<string[]> {
  const notes: string[] = [];
  const targets = new Map(placements.map((p) => [p.placeholder, p]));
  for (const image of manuscript.images) {
    const target = targets.get(image.placeholder);
    if (!target) continue;
    try {
      const loaded = await loadImageBytes(image.url, ownerId);
      const ext = extensionForMime(loaded.mimeType);
      target.path = path.join(workDir, `${image.placeholder}.${ext}`);
      await fs.writeFile(target.path, loaded.bytes);
    } catch (err) {
      notes.push(`Ілюстрація «${image.captionUk || image.placeholder}» не вставлена: ${(err as Error).message}`);
    }
  }
  return notes;
}

function numberRect(
  page: InspectPage,
  spec: PdfLayoutSpec
): { rect: [number, number, number, number]; align: 'left' | 'center' | 'right' } {
  const [x0, y0, x1, y1] = page.bounds;
  const pos = spec.pageNumber.position || 'bottom-center';
  const top = pos.startsWith('top');
  const y = top
    ? y0 + Math.max(10, spec.margins.top * 0.25)
    : y1 - Math.max(30, spec.margins.bottom * 0.62);
  const w = 72;
  if (pos.endsWith('left')) {
    return { rect: [x0 + spec.margins.left, y, x0 + spec.margins.left + w, y + 18], align: 'left' };
  }
  if (pos.endsWith('right')) {
    return { rect: [x1 - spec.margins.right - w, y, x1 - spec.margins.right, y + 18], align: 'right' };
  }
  const cx = (x0 + x1) / 2;
  return { rect: [cx - w / 2, y, cx + w / 2, y + 18], align: 'center' };
}

function secondScript(
  request: PdfRenderRequest,
  inspect: InspectResult,
  story: number,
  placements: ImagePlacement[],
  spec: PdfLayoutSpec,
  imageWidth: number
): string {
  const commands: string[] = [];

  for (const image of placements) {
    commands.push(cmd('story.replaceRange', { story, start: image.start, end: image.end, text: '' }));
    if (image.path) {
      commands.push(cmd('file.place', { path: image.path, spread: 0, x: 0, y: 0, width: imageWidth }));
      commands.push(cmd('anchored.insert', {
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
    commands.push(cmd('variables.define', {
      name: 'FusionLab Chapter',
      type: 'runningHeader',
      style: 'Heading 1',
      use: 'lastOnPage',
    }));
  }

  const bodyStart = bodyPhysicalStart(spec);
  for (const spread of inspect.spreads || []) {
    for (const page of spread.pages || []) {
      const physical = Number(page.index) + 1;
      const isBody = physical >= bodyStart;
      const [x0, y0, x1] = page.bounds;

      if (isBody && spec.runningHead.show) {
        const y = y0 + Math.max(12, spec.margins.top * 0.28);
        const rect: [number, number, number, number] = [x0 + spec.margins.left, y, x1 - spec.margins.right, y + 18];
        if (spec.runningHead.content === 'chapter') {
          commands.push(cmd('frame.create', { spread: spread.index, rect, content: 'text', text: '' }));
          commands.push(cmd('text.select', { story: '$last.story', anchor: 0, focus: 0 }));
          commands.push(cmd('variables.insert', { name: 'FusionLab Chapter' }));
          commands.push(cmd('type.para', { attrs: { align: 'center' } }));
          commands.push(cmd('type.char', { attrs: { size: spec.runningHead.fontSize } }));
        } else {
          const value = spec.runningHead.content === 'author'
            ? String(request.book.author || '')
            : String(request.book.title || '');
          commands.push(...textFrame(spread.index, rect, value, spec.runningHead.fontSize));
        }
      }

      const numberThisPage = spec.pageNumber.show && (isBody || !spec.pageNumber.skipFrontMatter);
      if (numberThisPage) {
        const n = numberRect(page, spec);
        commands.push(cmd('frame.create', { spread: spread.index, rect: n.rect, content: 'text', text: PAGE_NUMBER_MARKER }));
        // v0.7.1 formats the selected text frame directly; no text.selectStory command exists.
        commands.push(cmd('type.para', { attrs: { align: n.align } }));
        commands.push(cmd('type.char', { attrs: { size: spec.pageNumber.fontSize } }));
      }
    }
  }

  const tocStyles = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
  commands.push(cmd('toc.update'));
  commands.push(cmd('story.get', { story }));
  commands.push(cmd('anchored.list', { story }));
  commands.push(cmd('toc.entries', { styles: tocStyles }));
  commands.push(cmd('document.inspect'));
  return commands.join('\n') + '\n';
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
    const result = await run(DESIGNCRAFT_PATH, ['--version'], { timeoutMs: 12_000 });
    if (result.code === 0) return { ok: true };
    return {
      ok: false,
      reasonUk: `DesignCraft CLI не знайдено (${DESIGNCRAFT_PATH}).`,
      fixUk: 'У production він встановлюється в Docker-образ; локально задайте DESIGNCRAFT_PATH.',
    };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const availability = await this.available();
    if (!availability.ok) {
      throw new PdfEngineError('designcraft', 'unavailable', availability.reasonUk || 'DesignCraft недоступний.');
    }

    const spec = specOf(request.spec);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-designcraft-'));
    const manuscriptPath = path.join(workDir, 'manuscript.txt');
    const buildPath = path.join(workDir, 'build.dcs');
    const storyPath = path.join(workDir, 'story.dcs');
    const finalPath = path.join(workDir, 'final.dcs');
    const doc1 = path.join(workDir, 'flow.designcraft');
    const doc2 = path.join(workDir, 'final.designcraft');
    const pdfPath = path.join(workDir, 'book.pdf');

    try {
      const manuscript = buildDesigncraftRtf(request.book, spec);
      await fs.writeFile(manuscriptPath, manuscript.rtf, 'utf8');
      await fs.writeFile(buildPath, firstScript(request, spec, manuscriptPath), 'utf8');

      const first = await runScript(buildPath, ['--save', doc1], workDir, 'DesignCraft не завершив автоперетікання вчасно.');
      const results = Array.isArray(first.results) ? first.results : [];
      const placed = results.find((v: any) => v && typeof v === 'object' && 'pagesAdded' in v && 'overset' in v);
      if (!placed || !Number.isFinite(Number(placed.story))) {
        throw new PdfEngineError('designcraft', 'engine', 'DesignCraft не повернув story після імпорту рукопису.');
      }
      if (placed.overset) {
        throw new PdfEngineError('designcraft', 'engine', 'Автоперетікання лишило прихований текст (overset).');
      }
      const story = Number(placed.story);
      const inspect = [...results].reverse().find((v: any) => v?.spreads) as InspectResult | undefined;
      if (!inspect?.spreads?.length) {
        throw new PdfEngineError('designcraft', 'engine', 'DesignCraft не повернув структуру сторінок.');
      }

      await fs.writeFile(storyPath, cmd('story.get', { story }) + '\n', 'utf8');
      const storyReport = await runScript(storyPath, ['--in', doc1], workDir, 'Не вдалося прочитати story DesignCraft.');
      const storyText = String(storyReport.results?.[0]?.text || '');
      const placements = imageBlocks(storyText, manuscript);
      const notesUk = await loadImages(workDir, manuscript, placements, request.ownerId);
      if (manuscript.unresolvedMarkers.length) {
        notesUk.push(`Не знайдено ілюстрацій для маркерів: ${manuscript.unresolvedMarkers.join(', ')}.`);
      }

      const { width } = pageSize(spec);
      const textWidth = width - spec.margins.left - spec.margins.right;
      const factors = placements.some((p) => p.path) ? [0.64, 0.52, 0.42] : [0.64];
      let finalReport: any = null;
      let fittedWidth = Math.min(260, textWidth * factors[0]);

      for (const factor of factors) {
        fittedWidth = Math.min(260, textWidth * factor);
        await fs.writeFile(finalPath, secondScript(request, inspect, story, placements, spec, fittedWidth), 'utf8');
        const candidate = await runScript(
          finalPath,
          ['--in', doc1, '--save', doc2, '--export', pdfPath],
          workDir,
          'DesignCraft не завершив фінальний PDF вчасно.'
        );
        const r = Array.isArray(candidate.results) ? candidate.results : [];
        const storyState = r.at(-4);
        if (!storyState?.overset) {
          finalReport = candidate;
          break;
        }
      }
      if (!finalReport) {
        throw new PdfEngineError('designcraft', 'engine', 'Після вставлення ілюстрацій лишився overset навіть після зменшення.');
      }

      const finalResults = Array.isArray(finalReport.results) ? finalReport.results : [];
      const storyState = finalResults.at(-4);
      const anchored = finalResults.at(-3);
      const toc = finalResults.at(-2);
      const finalInspect = finalResults.at(-1) as InspectResult;
      if (storyState?.overset) {
        throw new PdfEngineError('designcraft', 'engine', 'Фінальна перевірка знайшла overset.');
      }

      const loadedImages = placements.filter((p) => p.path).length;
      if (!Array.isArray(anchored) || anchored.length !== loadedImages) {
        throw new PdfEngineError(
          'designcraft',
          'engine',
          `Ілюстрації: очікувалось ${loadedImages}, в anchored story знайдено ${Array.isArray(anchored) ? anchored.length : 0}.`
        );
      }

      const chapterCount = request.book.chapters?.length || 0;
      const chapterEntries = Array.isArray(toc) ? toc.filter((e: any) => Number(e?.level) === 1) : [];
      if (chapterCount && chapterEntries.length !== chapterCount) {
        throw new PdfEngineError(
          'designcraft',
          'engine',
          `Зміст: глав ${chapterCount}, записів першого рівня ${chapterEntries.length}.`
        );
      }

      const bytes = new Uint8Array(await fs.readFile(pdfPath));
      if (bytes.byteLength < 1000) {
        throw new PdfEngineError('designcraft', 'engine', 'DesignCraft створив підозріло малий PDF.');
      }
      const pdf = await PDFDocument.load(bytes);
      const pageCount = pdf.getPageCount();
      const inspectedPages = (finalInspect?.spreads || []).reduce((n, s) => n + (s.pages?.length || 0), 0);
      if (pageCount !== inspectedPages || pageCount < bodyPhysicalStart(spec)) {
        throw new PdfEngineError(
          'designcraft',
          'engine',
          `Сторінки не збігаються: PDF=${pageCount}, DesignCraft=${inspectedPages}.`
        );
      }

      notesUk.unshift(
        `DesignCraft: ${pageCount} стор., автоматичне перетікання без overset, зміст синхронізовано, ` +
          `${loadedImages} ілюстрацій перевірено${loadedImages ? ` (ширина до ${Math.round(fittedWidth)} pt)` : ''}.`
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

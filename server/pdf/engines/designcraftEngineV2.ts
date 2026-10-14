/**
 * DesignCraft Gate B renderer, second generation.
 *
 * The first adapter delegated pagination to DesignCraft's `file.place
 * autoflow`.  That is excellent for interactive use, but its first capacity
 * estimate may deliberately over-allocate a very large document.  A real
 * Studio manuscript exposed the worst case: ~600k characters caused the
 * estimator to allocate the 2000-page safety ceiling in one jump.
 *
 * This renderer keeps DesignCraft as the compositor, but controls page
 * growth itself: import once, add ordinary margin frames in modest batches,
 * ask DesignCraft whether the story is still overset, then trim any spare
 * tail pages one-by-one.  The result is real reflow without empty-page
 * inflation and without hard-coded story/object ids.
 */
import { spawn } from 'node:child_process';
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
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

export const DESIGNCRAFT_V2_PATH = process.env.DESIGNCRAFT_PATH || 'designcraft-cli';
const TIMEOUT_MS = Number(process.env.DESIGNCRAFT_TIMEOUT_MS) || 180_000;
const MAX_OUTPUT = Number(process.env.DESIGNCRAFT_MAX_OUTPUT_CHARS) || 30_000_000;
const PAGE_BATCH = Math.max(1, Math.min(64, Number(process.env.DESIGNCRAFT_PAGE_BATCH) || 16));
const MAX_PAGES = Math.max(100, Number(process.env.DESIGNCRAFT_MAX_PAGES) || 2500);
const PAGE_NUMBER_MARKER = '\uE000';

type SpreadRef = number | { kind: 'parent'; index: number };

interface CliResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}
interface ImagePlacement {
  placeholder: string;
  captionUk: string;
  start: number;
  end: number;
  path?: string;
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

function sizeOf(spec: PdfLayoutSpec): { width: number; height: number } {
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
    throw new Error(`DesignCraft повернув неповний/некоректний JSON (${text.length} символів): ${text.slice(0, 500)}`, {
      cause: err as Error,
    });
  }
}

function reportFailure(report: any): string | null {
  if (report?.failedIndex === undefined || report?.failedIndex === null) return null;
  const command = report?.failedCommand ? ` (${report.failedCommand})` : '';
  return `Крок ${report.failedIndex}${command}: ${String(report.error || report.failed || 'невідома помилка')}`;
}

/**
 * Dedicated runner: unlike the Pandoc runner it must accept structured
 * DesignCraft reports containing a full long story.  Output is still bounded
 * to protect the server, but at tens of MB rather than 20 KB.
 */
function runCli(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(DESIGNCRAFT_V2_PATH, args, {
      cwd: opts.cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const append = (current: string, value: unknown, max: number): string => {
      if (current.length >= max) return current;
      const next = String(value);
      return current + next.slice(0, Math.max(0, max - current.length));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, opts.timeoutMs ?? TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout = append(stdout, d, MAX_OUTPUT); });
    child.stderr.on('data', (d) => { stderr = append(stderr, d, 2_000_000); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: append(stderr, err, 2_000_000), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function runScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  timeoutMessage: string
): Promise<any> {
  const result = await runCli(['script', scriptPath, ...args], { cwd });
  if (result.timedOut) throw new PdfEngineError('designcraft', 'timeout', timeoutMessage);
  let report: any = null;
  try { report = parseReport(result.stdout); } catch (err) {
    if (result.code === 0) throw err;
  }
  const failure = report && reportFailure(report);
  if (failure) throw new PdfEngineError('designcraft', 'engine', failure);
  if (result.code !== 0) {
    const reason = result.stderr.trim() || result.stdout.trim() || 'DesignCraft завершився з помилкою.';
    throw new PdfEngineError('designcraft', 'engine', reason.slice(-3500));
  }
  return report || parseReport(result.stdout);
}

function dcAlign(value: string | undefined): 'left' | 'center' | 'right' | 'leftJustified' {
  if (value === 'left' || value === 'center' || value === 'right') return value;
  return 'leftJustified';
}

function styleCommands(spec: PdfLayoutSpec): string[] {
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
      chars: { size: spec.chapterTitle.fontSize, fontFamily: 'DejaVu Serif', fontStyle: 'Bold' },
    }),
    cmd('style.paragraph.create', {
      name: 'Heading 2',
      para: {
        align: dcAlign(spec.sectionTitle.align),
        spaceBefore: spec.sectionTitle.spaceBefore,
        spaceAfter: spec.sectionTitle.spaceAfter,
      },
      chars: { size: spec.sectionTitle.fontSize, fontFamily: 'DejaVu Serif', fontStyle: 'Bold' },
    }),
  ];
}

function frameCommands(
  spread: SpreadRef,
  rect: [number, number, number, number],
  text: string,
  size: number,
  align: 'left' | 'center' | 'right' = 'center'
): string[] {
  if (!text.trim()) return [];
  return [
    cmd('frame.create', { spread, rect, content: 'text', text }),
    cmd('type.para', { attrs: { align } }),
    cmd('type.char', { attrs: { size } }),
  ];
}

function titleCommands(request: PdfRenderRequest, spec: PdfLayoutSpec): string[] {
  if (!spec.titlePage.show) return [];
  const { width, height } = sizeOf(spec);
  const left = spec.margins.left;
  const right = width - spec.margins.right;
  const y = height * 0.27;
  return [
    ...frameCommands(0, [left, y, right, y + 100], String(request.book.title || 'Без назви'), spec.titlePage.titleSize),
    ...frameCommands(0, [left, y + 115, right, y + 165], String(request.book.subtitle || ''), spec.titlePage.subtitleSize),
    ...frameCommands(0, [left, height * 0.70, right, height * 0.70 + 45], String(request.book.author || ''), spec.titlePage.authorSize),
  ];
}

function parentFurniture(request: PdfRenderRequest, spec: PdfLayoutSpec): string[] {
  const { width, height } = sizeOf(spec);
  const commands: string[] = [];
  const parent: SpreadRef = { kind: 'parent', index: 0 };

  if (spec.runningHead.show) {
    const y = Math.max(10, spec.margins.top * 0.25);
    const rect: [number, number, number, number] = [spec.margins.left, y, width - spec.margins.right, y + 18];
    if (spec.runningHead.content === 'chapter') {
      commands.push(cmd('variables.define', {
        name: 'FusionLab Chapter',
        type: 'runningHeader',
        style: 'Heading 1',
        use: 'lastOnPage',
      }));
      commands.push(cmd('frame.create', { spread: parent, rect, content: 'text', text: '' }));
      commands.push(cmd('text.select', { story: '$last.story', anchor: 0, focus: 0 }));
      commands.push(cmd('variables.insert', { name: 'FusionLab Chapter' }));
      commands.push(cmd('type.para', { attrs: { align: 'center' } }));
      commands.push(cmd('type.char', { attrs: { size: spec.runningHead.fontSize } }));
    } else {
      const text = spec.runningHead.content === 'author'
        ? String(request.book.author || '')
        : String(request.book.title || '');
      commands.push(...frameCommands(parent, rect, text, spec.runningHead.fontSize));
    }
  }

  if (spec.pageNumber.show) {
    const pos = spec.pageNumber.position || 'bottom-center';
    const top = pos.startsWith('top');
    const y = top
      ? Math.max(10, spec.margins.top * 0.25)
      : height - Math.max(30, spec.margins.bottom * 0.62);
    const w = 72;
    let rect: [number, number, number, number];
    let align: 'left' | 'center' | 'right' = 'center';
    if (pos.endsWith('left')) {
      rect = [spec.margins.left, y, spec.margins.left + w, y + 18];
      align = 'left';
    } else if (pos.endsWith('right')) {
      rect = [width - spec.margins.right - w, y, width - spec.margins.right, y + 18];
      align = 'right';
    } else {
      rect = [width / 2 - w / 2, y, width / 2 + w / 2, y + 18];
    }
    commands.push(cmd('frame.create', { spread: parent, rect, content: 'text', text: PAGE_NUMBER_MARKER }));
    commands.push(cmd('type.para', { attrs: { align } }));
    commands.push(cmd('type.char', { attrs: { size: spec.pageNumber.fontSize } }));
  }
  return commands;
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
    if (a < 0 || e < 0) throw new Error(`Зник службовий маркер ілюстрації ${image.placeholder}.`);
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
  const target = new Map(placements.map((p) => [p.placeholder, p]));
  for (const image of manuscript.images) {
    const p = target.get(image.placeholder);
    if (!p) continue;
    try {
      const loaded = await loadImageBytes(image.url, ownerId);
      p.path = path.join(workDir, `${image.placeholder}.${extensionForMime(loaded.mimeType)}`);
      await fs.writeFile(p.path, loaded.bytes);
    } catch (err) {
      notes.push(`Ілюстрація «${image.captionUk || image.placeholder}» не вставлена: ${(err as Error).message}`);
    }
  }
  return notes;
}

function hasOverset(storyState: any): boolean {
  return storyState?.overset !== null && storyState?.overset !== undefined && storyState?.overset !== false;
}

function bodyStart(spec: PdfLayoutSpec): number {
  return spec.titlePage.show ? 3 : 2; // physical, 1-based
}

function bodyRect(spec: PdfLayoutSpec): [number, number, number, number] {
  const { width, height } = sizeOf(spec);
  return [spec.margins.left, spec.margins.top, width - spec.margins.right, height - spec.margins.bottom];
}

async function storyState(workDir: string, doc: string, story: number, name = 'story-state.dcs'): Promise<any> {
  const script = path.join(workDir, name);
  await fs.writeFile(script, cmd('story.get', { story }) + '\n', 'utf8');
  const report = await runScript(script, ['--in', doc], workDir, 'DesignCraft не відповів під час перевірки переповнення.');
  return report.results?.[0];
}

/** Add threaded margin frames until the story fits; returns the exact file/page count before tail trimming. */
async function growUntilFits(
  workDir: string,
  sourceDoc: string,
  story: number,
  startPageCount: number,
  phase: string
): Promise<{ doc: string; pageCount: number; state: any }> {
  let doc = sourceDoc;
  let pageCount = startPageCount;
  let state = await storyState(workDir, doc, story, `${phase}-state-0.dcs`);
  let round = 0;
  while (hasOverset(state)) {
    if (pageCount >= MAX_PAGES) {
      throw new PdfEngineError('designcraft', 'engine', `Автоперетікання зупинено на ${pageCount} сторінках: текст усе ще overset.`);
    }
    const add = Math.min(PAGE_BATCH, MAX_PAGES - pageCount);
    const script = path.join(workDir, `${phase}-grow-${round}.dcs`);
    const nextDoc = path.join(workDir, `${phase}-grow-${round}.designcraft`);
    const commands: string[] = [cmd('layout.pages.insert', { count: add, after: pageCount - 1 })];
    const rect = bodyRect((growUntilFits as any)._spec as PdfLayoutSpec);
    const frames: number[] = Array.isArray(state?.frames) ? state.frames.map(Number).filter(Number.isFinite) : [];
    const lastFrame = frames.at(-1);
    if (!Number.isFinite(lastFrame)) throw new PdfEngineError('designcraft', 'engine', 'Не знайдено останній текстовий фрейм для продовження потоку.');
    for (let i = 0; i < add; i += 1) {
      commands.push(cmd('text.thread', {
        from: i === 0 ? lastFrame : '$last.to',
        rect,
        spread: pageCount + i,
        autoflow: false,
      }));
    }
    commands.push(cmd('story.get', { story }));
    await fs.writeFile(script, commands.join('\n') + '\n', 'utf8');
    const report = await runScript(script, ['--in', doc, '--save', nextDoc], workDir, 'DesignCraft не завершив контрольоване перетікання вчасно.');
    doc = nextDoc;
    pageCount += add;
    state = report.results?.at(-1);
    round += 1;
  }
  return { doc, pageCount, state };
}

/** Remove unused tail pages safely. A candidate that makes the story overset is discarded. */
async function trimTail(
  workDir: string,
  sourceDoc: string,
  story: number,
  startPageCount: number,
  minPageCount: number,
  phase: string
): Promise<{ doc: string; pageCount: number; state: any }> {
  let doc = sourceDoc;
  let pageCount = startPageCount;
  let state = await storyState(workDir, doc, story, `${phase}-trim-state.dcs`);
  let step = 0;
  while (pageCount > minPageCount && step < PAGE_BATCH + 2) {
    const script = path.join(workDir, `${phase}-trim-${step}.dcs`);
    const candidate = path.join(workDir, `${phase}-trim-${step}.designcraft`);
    await fs.writeFile(
      script,
      [cmd('layout.pages.delete', { pages: [pageCount - 1] }), cmd('story.get', { story })].join('\n') + '\n',
      'utf8'
    );
    const report = await runScript(script, ['--in', doc, '--save', candidate], workDir, 'DesignCraft не завершив обрізання зайвої сторінки.');
    const candidateState = report.results?.at(-1);
    if (hasOverset(candidateState)) break;
    doc = candidate;
    state = candidateState;
    pageCount -= 1;
    step += 1;
  }
  return { doc, pageCount, state };
}

export const designcraftEngineV2: PdfEngine = {
  id: 'designcraft',
  label: 'DesignCraft',
  strengthUk: 'Професійна книжкова верстка з контрольованим reflow, змістом, ілюстраціями, колонтитулами та нумерацією.',
  limitUk: 'Друкований KDP-макет із розрахунком корінця поки лишається за Nova; DesignCraft використовується для цифрового PDF.',
  supportsPrint: false,

  async available(): Promise<PdfEngineAvailability> {
    const out = await runCli(['--version'], { timeoutMs: 12_000 });
    if (out.code === 0) return { ok: true };
    return {
      ok: false,
      reasonUk: `DesignCraft CLI не знайдено (${DESIGNCRAFT_V2_PATH}).`,
      fixUk: 'У production він встановлюється в Docker-образ; локально задайте DESIGNCRAFT_PATH.',
    };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const availability = await this.available();
    if (!availability.ok) throw new PdfEngineError('designcraft', 'unavailable', availability.reasonUk || 'DesignCraft недоступний.');

    const spec = mergedSpec(request.spec);
    (growUntilFits as any)._spec = spec;
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-designcraft-v2-'));
    const manuscriptPath = path.join(workDir, 'manuscript.txt');
    const firstPath = path.join(workDir, 'initial.dcs');
    const initialDoc = path.join(workDir, 'initial.designcraft');
    const finalScript = path.join(workDir, 'final.dcs');
    const finalDoc = path.join(workDir, 'final.designcraft');
    const pdfPath = path.join(workDir, 'book.pdf');

    try {
      const manuscript = buildDesigncraftRtf(request.book, spec);
      await fs.writeFile(manuscriptPath, manuscript.rtf, 'utf8');
      const tocPage = spec.titlePage.show ? 2 : 1;
      const bodyPage = tocPage + 1;
      const frontPages = Array.from({ length: bodyPage - 1 }, (_, i) => i);
      const commands = [
        cmd('file.new', {
          ...sizeOf(spec),
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
        ...styleCommands(spec),
        cmd('file.place', { path: manuscriptPath, page: bodyPage, autoflow: false, styleConflicts: 'useExisting' }),
        cmd('layout.section', {
          page: bodyPage,
          startNumber: Math.max(1, Math.round(spec.pageNumber.startAt || 1)),
          style: 'arabic',
        }),
        // Body furniture lives on the default A parent. Front matter is
        // detached when it must not inherit those frames.
        ...(frontPages.length && (spec.runningHead.show || spec.pageNumber.skipFrontMatter)
          ? [cmd('layout.pages.applyParent', { pages: frontPages, parent: null })]
          : []),
        ...parentFurniture(request, spec),
        ...titleCommands(request, spec),
      ];
      await fs.writeFile(firstPath, commands.join('\n') + '\n', 'utf8');
      const first = await runScript(firstPath, ['--save', initialDoc], workDir, 'DesignCraft не завершив початковий імпорт вчасно.');
      const placed = (first.results || []).find((v: any) => v && typeof v === 'object' && 'story' in v && 'overset' in v);
      const story = Number(placed?.story);
      if (!Number.isFinite(story)) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft не повернув story після імпорту рукопису.');

      let flowed = await growUntilFits(workDir, initialDoc, story, bodyPage, 'text');
      flowed = await trimTail(workDir, flowed.doc, story, flowed.pageCount, bodyPage, 'text');

      const state = await storyState(workDir, flowed.doc, story, 'image-locate.dcs');
      const storyText = String(state?.text || '');
      const placements = imageBlocks(storyText, manuscript);
      const notesUk = await loadImages(workDir, manuscript, placements, request.ownerId);
      if (manuscript.unresolvedMarkers.length) {
        notesUk.push(`Не знайдено ілюстрацій для маркерів: ${manuscript.unresolvedMarkers.join(', ')}.`);
      }

      let imageDoc = flowed.doc;
      if (placements.length) {
        const imagePath = path.join(workDir, 'images.dcs');
        const imageOut = path.join(workDir, 'images.designcraft');
        const textWidth = sizeOf(spec).width - spec.margins.left - spec.margins.right;
        const imageWidth = Math.min(260, textWidth * 0.58);
        const imageCommands: string[] = [];
        for (const image of placements) {
          imageCommands.push(cmd('story.replaceRange', { story, start: image.start, end: image.end, text: '' }));
          if (image.path) {
            imageCommands.push(cmd('file.place', { path: image.path, spread: 0, x: 0, y: 0, width: imageWidth }));
            imageCommands.push(cmd('anchored.insert', {
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
        imageCommands.push(cmd('story.get', { story }));
        await fs.writeFile(imagePath, imageCommands.join('\n') + '\n', 'utf8');
        const imageReport = await runScript(imagePath, ['--in', imageDoc, '--save', imageOut], workDir, 'DesignCraft не завершив вставлення ілюстрацій.');
        imageDoc = imageOut;
        if (hasOverset(imageReport.results?.at(-1))) {
          let grown = await growUntilFits(workDir, imageDoc, story, flowed.pageCount, 'images');
          grown = await trimTail(workDir, grown.doc, story, grown.pageCount, bodyPage, 'images');
          imageDoc = grown.doc;
          flowed.pageCount = grown.pageCount;
        }
      }

      const tocStyles = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
      const loadedImages = placements.filter((p) => p.path).length;
      await fs.writeFile(
        finalScript,
        [
          cmd('toc.generate', {
            styles: tocStyles,
            title: spec.frontMatter.contentsTitle || 'Зміст',
            pageNumbers: true,
            page: tocPage,
          }),
          cmd('toc.update'),
          cmd('story.get', { story }),
          cmd('anchored.list', { story }),
          cmd('toc.entries', { styles: tocStyles }),
        ].join('\n') + '\n',
        'utf8'
      );
      const finalReport = await runScript(
        finalScript,
        ['--in', imageDoc, '--save', finalDoc, '--export', pdfPath],
        workDir,
        'DesignCraft не завершив фінальний PDF вчасно.'
      );
      const r = Array.isArray(finalReport.results) ? finalReport.results : [];
      const finalState = r.at(-3);
      const anchored = r.at(-2);
      const toc = r.at(-1);
      if (hasOverset(finalState)) throw new PdfEngineError('designcraft', 'engine', 'Фінальна перевірка знайшла overset.');
      if (!Array.isArray(anchored) || anchored.length !== loadedImages) {
        throw new PdfEngineError('designcraft', 'engine', `Ілюстрації: очікувалось ${loadedImages}, знайдено ${Array.isArray(anchored) ? anchored.length : 0}.`);
      }
      const chapterCount = request.book.chapters?.length || 0;
      const chapterEntries = Array.isArray(toc) ? toc.filter((e: any) => Number(e?.level) === 1) : [];
      if (chapterCount && chapterEntries.length !== chapterCount) {
        throw new PdfEngineError('designcraft', 'engine', `Зміст: глав ${chapterCount}, записів першого рівня ${chapterEntries.length}.`);
      }

      const bytes = new Uint8Array(await fs.readFile(pdfPath));
      if (bytes.length < 1000) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft створив підозріло малий PDF.');
      const pdf = await PDFDocument.load(bytes);
      const pageCount = pdf.getPageCount();
      if (pageCount !== flowed.pageCount) {
        throw new PdfEngineError('designcraft', 'engine', `Кількість сторінок не збігається: PDF=${pageCount}, reflow=${flowed.pageCount}.`);
      }
      notesUk.unshift(
        `DesignCraft: ${pageCount} стор., контрольоване reflow без overset і порожнього хвоста, зміст синхронізовано, ${loadedImages} ілюстрацій перевірено.`
      );
      return { bytes, pageCount, engineId: 'designcraft', honoredSpec: true, notesUk };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('designcraft', 'engine', `DesignCraft: ${(err as Error).message}`);
    } finally {
      delete (growUntilFits as any)._spec;
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};

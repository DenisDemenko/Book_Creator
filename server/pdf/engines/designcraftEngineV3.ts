/**
 * DesignCraft production renderer for long Studio manuscripts.
 *
 * DesignCraft's own autoflow is used to create a valid threaded story. For a
 * very large book the v0.7.1 estimator may conservatively allocate far more
 * pages than necessary (up to its 2000-page guard). We therefore minimize the
 * document afterwards with a binary search over `layout.documentSetup.pages`:
 * a candidate is accepted only when DesignCraft itself reports no overset.
 * This preserves native threading while eliminating the empty tail in O(log n)
 * headless passes.
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

export const DESIGNCRAFT_PROD_PATH = process.env.DESIGNCRAFT_PATH || 'designcraft-cli';
const TIMEOUT_MS = Number(process.env.DESIGNCRAFT_TIMEOUT_MS) || 240_000;
const MAX_OUTPUT = Number(process.env.DESIGNCRAFT_MAX_OUTPUT_CHARS) || 30_000_000;
const PAGE_NUMBER_MARKER = '\uE000';

type SpreadRef = number | { kind: 'parent'; index: number };
interface CliResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }
interface ImagePlacement { placeholder: string; captionUk: string; start: number; end: number; path?: string }

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

function command(id: string, params: Record<string, unknown> = {}): string {
  return `${id} ${JSON.stringify(params)}`;
}

function runCli(args: string[], cwd?: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(DESIGNCRAFT_PROD_PATH, args, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const add = (current: string, chunk: unknown, max: number): string => {
      if (current.length >= max) return current;
      const text = String(chunk);
      return current + text.slice(0, Math.max(0, max - current.length));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout = add(stdout, d, MAX_OUTPUT); });
    child.stderr.on('data', (d) => { stderr = add(stderr, d, 2_000_000); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: add(stderr, err, 2_000_000), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

function parseReport(stdout: string): any {
  const text = stdout.trim();
  if (!text) throw new Error('DesignCraft не повернув JSON-звіт.');
  try { return JSON.parse(text); } catch (err) {
    throw new Error(`DesignCraft повернув неповний JSON (${text.length} символів): ${text.slice(0, 500)}`, { cause: err as Error });
  }
}

async function runScript(script: string, args: string[], cwd: string, timeoutUk: string): Promise<any> {
  const out = await runCli(['script', script, ...args], cwd);
  if (out.timedOut) throw new PdfEngineError('designcraft', 'timeout', timeoutUk);
  let report: any = null;
  try { report = parseReport(out.stdout); } catch (err) {
    if (out.code === 0) throw err;
  }
  if (report?.failedIndex !== undefined && report?.failedIndex !== null) {
    const id = report.failedCommand ? ` (${report.failedCommand})` : '';
    throw new PdfEngineError('designcraft', 'engine', `Крок ${report.failedIndex}${id}: ${String(report.error || report.failed || 'невідома помилка')}`);
  }
  if (out.code !== 0) {
    throw new PdfEngineError('designcraft', 'engine', (out.stderr.trim() || out.stdout.trim() || 'DesignCraft завершився з помилкою.').slice(-3500));
  }
  return report || parseReport(out.stdout);
}

function overset(state: any): boolean {
  return state?.overset !== null && state?.overset !== undefined && state?.overset !== false;
}

function align(value: string | undefined): 'left' | 'center' | 'right' | 'leftJustified' {
  if (value === 'left' || value === 'center' || value === 'right') return value;
  return 'leftJustified';
}

function styles(spec: PdfLayoutSpec): string[] {
  return [
    command('style.paragraph.create', {
      name: 'Body',
      para: { align: align(spec.bodyAlign), firstLineIndent: spec.paragraphIndent, spaceAfter: spec.paragraphSpacing },
      chars: { size: spec.baseFontSize, fontFamily: 'DejaVu Serif' },
    }),
    command('style.paragraph.create', {
      name: 'Heading 1',
      para: { align: align(spec.chapterTitle.align), spaceBefore: spec.chapterTitle.spaceBefore, spaceAfter: spec.chapterTitle.spaceAfter },
      chars: { size: spec.chapterTitle.fontSize, fontFamily: 'DejaVu Serif', fontStyle: 'Bold' },
    }),
    command('style.paragraph.create', {
      name: 'Heading 2',
      para: { align: align(spec.sectionTitle.align), spaceBefore: spec.sectionTitle.spaceBefore, spaceAfter: spec.sectionTitle.spaceAfter },
      chars: { size: spec.sectionTitle.fontSize, fontFamily: 'DejaVu Serif', fontStyle: 'Bold' },
    }),
  ];
}

function frame(
  spread: SpreadRef,
  rect: [number, number, number, number],
  text: string,
  size: number,
  a: 'left' | 'center' | 'right' = 'center'
): string[] {
  if (!text.trim()) return [];
  return [
    command('frame.create', { spread, rect, content: 'text', text }),
    command('type.para', { attrs: { align: a } }),
    command('type.char', { attrs: { size } }),
  ];
}

function titleFrames(request: PdfRenderRequest, spec: PdfLayoutSpec): string[] {
  if (!spec.titlePage.show) return [];
  const { width, height } = pageSize(spec);
  const left = spec.margins.left;
  const right = width - spec.margins.right;
  const y = height * 0.27;
  return [
    ...frame(0, [left, y, right, y + 100], String(request.book.title || 'Без назви'), spec.titlePage.titleSize),
    ...frame(0, [left, y + 115, right, y + 165], String(request.book.subtitle || ''), spec.titlePage.subtitleSize),
    ...frame(0, [left, height * 0.70, right, height * 0.70 + 45], String(request.book.author || ''), spec.titlePage.authorSize),
  ];
}

function parentFrames(request: PdfRenderRequest, spec: PdfLayoutSpec): string[] {
  const { width, height } = pageSize(spec);
  const parent: SpreadRef = { kind: 'parent', index: 0 };
  const out: string[] = [];
  if (spec.runningHead.show) {
    const y = Math.max(10, spec.margins.top * 0.25);
    const rect: [number, number, number, number] = [spec.margins.left, y, width - spec.margins.right, y + 18];
    if (spec.runningHead.content === 'chapter') {
      out.push(command('variables.define', { name: 'FusionLab Chapter', type: 'runningHeader', style: 'Heading 1', use: 'lastOnPage' }));
      out.push(command('frame.create', { spread: parent, rect, content: 'text', text: '' }));
      out.push(command('text.select', { story: '$last.story', anchor: 0, focus: 0 }));
      out.push(command('variables.insert', { name: 'FusionLab Chapter' }));
      out.push(command('type.para', { attrs: { align: 'center' } }));
      out.push(command('type.char', { attrs: { size: spec.runningHead.fontSize } }));
    } else {
      const text = spec.runningHead.content === 'author' ? String(request.book.author || '') : String(request.book.title || '');
      out.push(...frame(parent, rect, text, spec.runningHead.fontSize));
    }
  }
  if (spec.pageNumber.show) {
    const pos = spec.pageNumber.position || 'bottom-center';
    const y = pos.startsWith('top') ? Math.max(10, spec.margins.top * 0.25) : height - Math.max(30, spec.margins.bottom * 0.62);
    const w = 72;
    let rect: [number, number, number, number];
    let a: 'left' | 'center' | 'right' = 'center';
    if (pos.endsWith('left')) { rect = [spec.margins.left, y, spec.margins.left + w, y + 18]; a = 'left'; }
    else if (pos.endsWith('right')) { rect = [width - spec.margins.right - w, y, width - spec.margins.right, y + 18]; a = 'right'; }
    else rect = [width / 2 - w / 2, y, width / 2 + w / 2, y + 18];
    out.push(command('frame.create', { spread: parent, rect, content: 'text', text: PAGE_NUMBER_MARKER }));
    out.push(command('type.para', { attrs: { align: a } }));
    out.push(command('type.char', { attrs: { size: spec.pageNumber.fontSize } }));
  }
  return out;
}

function byteOffset(text: string, chars: number): number {
  return Buffer.byteLength(text.slice(0, chars), 'utf8');
}

function locateImages(text: string, manuscript: DesigncraftManuscript): ImagePlacement[] {
  const out: ImagePlacement[] = [];
  for (const image of manuscript.images) {
    const begin = IMAGE_BEGIN(image.placeholder);
    const end = IMAGE_END(image.placeholder);
    const a = text.indexOf(begin);
    const e = text.indexOf(end, Math.max(0, a + begin.length));
    if (a < 0 || e < 0) throw new Error(`Зник службовий маркер ілюстрації ${image.placeholder}.`);
    out.push({ placeholder: image.placeholder, captionUk: image.captionUk, start: byteOffset(text, a), end: byteOffset(text, e + end.length) });
  }
  return out.sort((a, b) => b.start - a.start);
}

async function prepareImages(workDir: string, manuscript: DesigncraftManuscript, placements: ImagePlacement[], ownerId?: string | null): Promise<string[]> {
  const notes: string[] = [];
  const targets = new Map(placements.map((p) => [p.placeholder, p]));
  for (const image of manuscript.images) {
    const target = targets.get(image.placeholder);
    if (!target) continue;
    try {
      const loaded = await loadImageBytes(image.url, ownerId);
      target.path = path.join(workDir, `${image.placeholder}.${extensionForMime(loaded.mimeType)}`);
      await fs.writeFile(target.path, loaded.bytes);
    } catch (err) {
      notes.push(`Ілюстрація «${image.captionUk || image.placeholder}» не вставлена: ${(err as Error).message}`);
    }
  }
  return notes;
}

async function getStory(workDir: string, doc: string, story: number, name: string): Promise<any> {
  const script = path.join(workDir, name);
  await fs.writeFile(script, command('story.get', { story }) + '\n', 'utf8');
  const report = await runScript(script, ['--in', doc], workDir, 'DesignCraft не відповів під час перевірки story.');
  return report.results?.[0];
}

/**
 * Find the smallest total page count whose threaded story is not overset.
 * Every probe starts from the same over-allocated autoflow document, so a
 * failed probe cannot damage the accepted document.
 */
async function minimizePages(
  workDir: string,
  sourceDoc: string,
  story: number,
  minPages: number,
  maxPages: number,
  label: string
): Promise<{ doc: string; pageCount: number; state: any }> {
  let low = minPages;
  let high = Math.max(minPages, maxPages);
  let bestDoc = sourceDoc;
  let bestState = await getStory(workDir, sourceDoc, story, `${label}-source-state.dcs`);
  if (overset(bestState)) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft autoflow завершився з overset.');

  let probe = 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const script = path.join(workDir, `${label}-probe-${probe}.dcs`);
    const candidate = path.join(workDir, `${label}-probe-${probe}.designcraft`);
    await fs.writeFile(script, [command('layout.documentSetup', { pages: mid }), command('story.get', { story })].join('\n') + '\n', 'utf8');
    const report = await runScript(script, ['--in', sourceDoc, '--save', candidate], workDir, 'DesignCraft не завершив пошук мінімальної кількості сторінок.');
    const state = report.results?.at(-1);
    if (overset(state)) {
      low = mid + 1;
    } else {
      high = mid;
      bestDoc = candidate;
      bestState = state;
    }
    probe += 1;
  }

  if (high === maxPages) return { doc: sourceDoc, pageCount: maxPages, state: bestState };
  // `bestDoc` may be a larger successful probe than the final high when the
  // last binary step was a failure. Materialize the exact boundary once.
  const exact = path.join(workDir, `${label}-exact.designcraft`);
  const exactScript = path.join(workDir, `${label}-exact.dcs`);
  await fs.writeFile(exactScript, [command('layout.documentSetup', { pages: high }), command('story.get', { story })].join('\n') + '\n', 'utf8');
  const exactReport = await runScript(exactScript, ['--in', sourceDoc, '--save', exact], workDir, 'DesignCraft не завершив фінальне обрізання сторінок.');
  const exactState = exactReport.results?.at(-1);
  if (overset(exactState)) throw new PdfEngineError('designcraft', 'engine', `Внутрішня перевірка reflow: ${high} стор. знову дали overset.`);
  return { doc: exact, pageCount: high, state: exactState };
}

export const designcraftEngineV3: PdfEngine = {
  id: 'designcraft',
  label: 'DesignCraft',
  strengthUk: 'Професійна книжкова верстка з нативним reflow, автоматичним змістом, ілюстраціями, колонтитулами та нумерацією.',
  limitUk: 'Друкований KDP-макет із розрахунком корінця поки лишається за Nova; DesignCraft використовується для цифрового PDF.',
  supportsPrint: false,

  async available(): Promise<PdfEngineAvailability> {
    const out = await runCli(['--version']);
    if (out.code === 0) return { ok: true };
    return { ok: false, reasonUk: `DesignCraft CLI не знайдено (${DESIGNCRAFT_PROD_PATH}).`, fixUk: 'У production він встановлюється в Docker-образ; локально задайте DESIGNCRAFT_PATH.' };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const availability = await this.available();
    if (!availability.ok) throw new PdfEngineError('designcraft', 'unavailable', availability.reasonUk || 'DesignCraft недоступний.');

    const spec = specOf(request.spec);
    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-designcraft-v3-'));
    const manuscriptPath = path.join(workDir, 'manuscript.txt');
    const initialScript = path.join(workDir, 'initial.dcs');
    const initialDoc = path.join(workDir, 'autoflow.designcraft');
    const pdfPath = path.join(workDir, 'book.pdf');

    try {
      const manuscript = buildDesigncraftRtf(request.book, spec);
      await fs.writeFile(manuscriptPath, manuscript.rtf, 'utf8');
      const tocPage = spec.titlePage.show ? 2 : 1;
      const bodyPage = tocPage + 1;
      await fs.writeFile(
        initialScript,
        [
          command('file.new', {
            ...pageSize(spec),
            pages: bodyPage,
            facingPages: false,
            margins: { top: spec.margins.top, bottom: spec.margins.bottom, inside: spec.margins.left, outside: spec.margins.right },
            title: request.book.title || 'Fusion Lab book',
          }),
          ...styles(spec),
          command('file.place', { path: manuscriptPath, page: bodyPage, autoflow: true, styleConflicts: 'useExisting' }),
        ].join('\n') + '\n',
        'utf8'
      );
      const initial = await runScript(initialScript, ['--save', initialDoc], workDir, 'DesignCraft не завершив первинне autoflow вчасно.');
      const placed = (initial.results || []).find((v: any) => v && typeof v === 'object' && 'pagesAdded' in v && 'story' in v);
      const story = Number(placed?.story);
      const pagesAdded = Number(placed?.pagesAdded || 0);
      if (!Number.isFinite(story)) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft не повернув story після імпорту рукопису.');
      if (placed?.overset) throw new PdfEngineError('designcraft', 'engine', 'Первинне DesignCraft autoflow завершилось із overset.');
      const allocatedPages = bodyPage + pagesAdded;
      let minimized = await minimizePages(workDir, initialDoc, story, bodyPage, allocatedPages, 'text');

      // Locate and place illustrations. Reservation paragraphs in the source
      // deliberately make the text layout pessimistic, so normal images fit
      // without adding pages. If they do not, retry narrower from the same
      // clean minimized document.
      const beforeImages = await getStory(workDir, minimized.doc, story, 'locate-images.dcs');
      const placements = locateImages(String(beforeImages?.text || ''), manuscript);
      const notesUk = await prepareImages(workDir, manuscript, placements, request.ownerId);
      if (manuscript.unresolvedMarkers.length) notesUk.push(`Не знайдено ілюстрацій для маркерів: ${manuscript.unresolvedMarkers.join(', ')}.`);
      const loadedImages = placements.filter((p) => p.path).length;
      let contentDoc = minimized.doc;

      if (placements.length) {
        const textWidth = pageSize(spec).width - spec.margins.left - spec.margins.right;
        let accepted = false;
        for (const factor of [0.56, 0.46, 0.36]) {
          const script = path.join(workDir, `images-${factor}.dcs`);
          const outDoc = path.join(workDir, `images-${factor}.designcraft`);
          const commands: string[] = [];
          for (const image of placements) {
            commands.push(command('story.replaceRange', { story, start: image.start, end: image.end, text: '' }));
            if (image.path) {
              commands.push(command('file.place', { path: image.path, spread: 0, x: 0, y: 0, width: Math.min(260, textWidth * factor) }));
              commands.push(command('anchored.insert', { ids: ['$last.id'], story, pos: image.start, position: 'aboveLine', align: 'center', spaceBefore: 8, spaceAfter: 10 }));
            }
          }
          commands.push(command('story.get', { story }));
          await fs.writeFile(script, commands.join('\n') + '\n', 'utf8');
          const report = await runScript(script, ['--in', minimized.doc, '--save', outDoc], workDir, 'DesignCraft не завершив вставлення ілюстрацій.');
          if (!overset(report.results?.at(-1))) {
            contentDoc = outDoc;
            accepted = true;
            break;
          }
        }
        if (!accepted) throw new PdfEngineError('designcraft', 'engine', 'Ілюстрації спричинили overset навіть після автоматичного зменшення.');
      }

      const finalScript = path.join(workDir, 'final.dcs');
      const finalDoc = path.join(workDir, 'final.designcraft');
      const frontPages = Array.from({ length: bodyPage - 1 }, (_, i) => i);
      const tocStyles = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
      await fs.writeFile(
        finalScript,
        [
          command('layout.section', { page: bodyPage, startNumber: Math.max(1, Math.round(spec.pageNumber.startAt || 1)), style: 'arabic' }),
          ...(frontPages.length && (spec.runningHead.show || spec.pageNumber.skipFrontMatter)
            ? [command('layout.pages.applyParent', { pages: frontPages, parent: null })]
            : []),
          ...parentFrames(request, spec),
          ...titleFrames(request, spec),
          command('toc.generate', { styles: tocStyles, title: spec.frontMatter.contentsTitle || 'Зміст', pageNumbers: true, page: tocPage }),
          command('toc.update'),
          command('story.get', { story }),
          command('anchored.list', { story }),
          command('toc.entries', { styles: tocStyles }),
        ].join('\n') + '\n',
        'utf8'
      );
      const final = await runScript(finalScript, ['--in', contentDoc, '--save', finalDoc, '--export', pdfPath], workDir, 'DesignCraft не завершив фінальний PDF вчасно.');
      const r = Array.isArray(final.results) ? final.results : [];
      const finalState = r.at(-3);
      const anchored = r.at(-2);
      const toc = r.at(-1);
      if (overset(finalState)) throw new PdfEngineError('designcraft', 'engine', 'Фінальна перевірка знайшла overset.');
      if (!Array.isArray(anchored) || anchored.length !== loadedImages) {
        throw new PdfEngineError('designcraft', 'engine', `Ілюстрації: очікувалось ${loadedImages}, знайдено ${Array.isArray(anchored) ? anchored.length : 0}.`);
      }
      const chapterCount = request.book.chapters?.length || 0;
      const chapterEntries = Array.isArray(toc) ? toc.filter((e: any) => Number(e?.level) === 1) : [];
      if (chapterCount && chapterEntries.length !== chapterCount) throw new PdfEngineError('designcraft', 'engine', `Зміст: глав ${chapterCount}, записів першого рівня ${chapterEntries.length}.`);

      const bytes = new Uint8Array(await fs.readFile(pdfPath));
      if (bytes.length < 1000) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft створив підозріло малий PDF.');
      const pdf = await PDFDocument.load(bytes);
      const pageCount = pdf.getPageCount();
      if (pageCount !== minimized.pageCount) throw new PdfEngineError('designcraft', 'engine', `Кількість сторінок не збігається: PDF=${pageCount}, reflow=${minimized.pageCount}.`);

      notesUk.unshift(
        `DesignCraft: ${pageCount} стор. (первинно виділено ${allocatedPages}, зайвий хвіст прибрано бінарною перевіркою), без overset, зміст синхронізовано, ${loadedImages} ілюстрацій перевірено.`
      );
      return { bytes, pageCount, engineId: 'designcraft', honoredSpec: true, notesUk };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('designcraft', 'engine', `DesignCraft: ${(err as Error).message}`);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};

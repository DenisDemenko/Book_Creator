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
// Правила KDP беруться там, де вони вже є: один рушій не має права мати
// власну думку про припустиме корінцеве поле.
import { kdpSpec } from '../pdfKdp';
import { getKdpMinimumGutterMm } from '../../../src/utils/kdpHelpers';
import { buildDesigncraftSemanticPagination } from '../designcraftSemanticPagination';
import {
  buildDesigncraftRtf,
  IMAGE_BEGIN,
  IMAGE_END,
  type DesigncraftManuscript,
} from '../designcraft/rtf';
import { buildDesigncraftStyleCommands } from '../designcraft/styleCommands';
import { cmd, serializeScript, type DesigncraftCommand } from '../designcraft/commands';
import {
  DesigncraftSession,
  DesigncraftSessionError,
  type DesigncraftReport,
} from '../designcraft/session';
import {
  findUnsupportedScriptSteps,
  readDesigncraftCapabilities,
  type DesigncraftCapabilities,
} from '../designcraft/capabilities';
import { extensionForMime, loadImageBytes } from '../../media/imageBytes';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfRenderRequest,
  type PdfRenderResult,
  type PdfCompanion,
  type PdfCompanionKind,
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
    pdfExport: { ...DEFAULT_LAYOUT_SPEC.pdfExport, ...(input?.pdfExport || {}) },
  };
}

function pageSize(spec: PdfLayoutSpec): { width: number; height: number } {
  if (Number(spec.pageWidthPt) > 0 && Number(spec.pageHeightPt) > 0) {
    return { width: Number(spec.pageWidthPt), height: Number(spec.pageHeightPt) };
  }
  return PAGE_SIZES[spec.pageSize] || PAGE_SIZES.A5;
}

/**
 * Крок конвеєра — дані, а не рядок. Рядок `.dcs` потрібен лише файловому
 * транспорту; жива сесія віддає ті самі об'єкти інструменту `batch`. Див.
 * шапку `../designcraft/commands.ts`.
 */
const command = cmd;

/**
 * Параметри `file.exportPdf` з макетного spec. Один білдер на обидва
 * транспорти: інакше файловий і сесійний шляхи експортували б по-різному, і
 * побайтовий збіг, яким вимірювач доводить їх тотожність, перестав би щось
 * означати.
 *
 * `standard: 'none'` не передається зовсім — рушій і так не застосовує
 * стандарту, а зайвий параметр у скрипті лише заважав би читати його очима.
 */
export function exportParams(
  spec: PdfLayoutSpec,
  pdfPath: string,
  print?: { bleed?: boolean }
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    path: pdfPath,
    tagged: spec.pdfExport.tagged,
    compressImages: spec.pdfExport.compressImages,
  };
  if (spec.pdfExport.standard !== 'none') out.standard = spec.pdfExport.standard;
  if (print) {
    // Друкарні потрібні мітки обрізу; виліт — лише якщо книга його має, бо
    // без зображень «під зріз» він лише з'їдає поле.
    out.marks = true;
    if (print.bleed) out.bleed = true;
  }
  return out;
}

/**
 * Брама відповідності. `designcraft-cli validate-pdf` перевіряє **лише**
 * PDF/X-4: на звичайному PDF він скаржиться на речі, яких від нього ніхто й
 * не вимагав («the PDF version must be 1.6 or lower»), а на PDF/A-2b — на
 * чужий стандарт. Тому брама вмикається рівно для `x4`, інакше вона
 * повідомляла б про неіснуючі проблеми.
 */
async function validateIfRequested(spec: PdfLayoutSpec, pdfPath: string, notesUk: string[]): Promise<void> {
  if (spec.pdfExport.standard !== 'x4') return;
  const out = await runCli(['validate-pdf', pdfPath]);
  if (out.timedOut) {
    notesUk.push('Перевірку PDF/X-4 не завершено вчасно; файл залишено як є.');
    return;
  }
  let issues: unknown = null;
  try {
    issues = JSON.parse(out.stdout.trim())?.issues;
  } catch {
    notesUk.push(`Перевірка PDF/X-4 повернула нерозбірний звіт: ${out.stdout.trim().slice(0, 200)}`);
    return;
  }
  if (Array.isArray(issues) && issues.length) {
    throw new PdfEngineError(
      'designcraft',
      'engine',
      `PDF/X-4: файл не відповідає стандарту (${issues.length}): ${issues.map((x) => String(x)).join('; ')}.`
    );
  }
  notesUk.push('PDF/X-4: вбудована перевірка відповідності пройдена без зауважень.');
}

interface CompanionPlan {
  kind: PdfCompanionKind;
  path: string;
  mimeType: string;
  extension: string;
}

/**
 * Команди супутніх експортів і план, як потім зібрати байти.
 *
 * Обидва формати беруться з ТОГО САМОГО документа, що й PDF, уже після
 * `toc.update`: сенс саме в цьому, бо EPUB успадковує стилі, порядок читання
 * й ілюстрації верстки. `cover: true` робить обкладинкою першу сторінку —
 * титул, який Студія й так малює.
 *
 * `language` поки прибитий до `uk`: у `PdfBookInput` поля мови немає, а
 * вигадувати його з тексту книги гірше, ніж назвати мову Студії явно.
 */
function companionSteps(
  spec: PdfLayoutSpec,
  request: PdfRenderRequest,
  workDir: string
): { commands: DesigncraftCommand[]; plan: CompanionPlan[] } {
  const commands: DesigncraftCommand[] = [];
  const plan: CompanionPlan[] = [];
  const title = String(request.book.title || 'Fusion Lab book');
  const author = String(request.book.author || '');
  for (const kind of spec.pdfExport.companions) {
    if (kind === 'epub') {
      const file = path.join(workDir, 'book.epub');
      commands.push(command('file.exportEpub', { path: file, title, author, language: 'uk', cover: true }));
      plan.push({ kind, path: file, mimeType: 'application/epub+zip', extension: 'epub' });
    } else if (kind === 'html') {
      const file = path.join(workDir, 'book.html');
      commands.push(command('file.exportHtml', { path: file, title, language: 'uk' }));
      plan.push({ kind, path: file, mimeType: 'text/html; charset=utf-8', extension: 'html' });
    }
  }
  return { commands, plan };
}

/** Зібрати байти супутніх форматів. Невдача одного не валить PDF. */
async function collectCompanions(plan: readonly CompanionPlan[], notesUk: string[]): Promise<PdfCompanion[]> {
  const out: PdfCompanion[] = [];
  for (const item of plan) {
    try {
      const bytes = new Uint8Array(await fs.readFile(item.path));
      if (bytes.length < 200) throw new Error(`файл підозріло малий (${bytes.length} Б)`);
      out.push({ kind: item.kind, bytes, mimeType: item.mimeType, extension: item.extension });
      notesUk.push(`Супутній ${item.kind.toUpperCase()} зроблено з того самого макета: ${bytes.length} Б.`);
    } catch (err) {
      // PDF уже готовий і перевірений; втрата супутнього формату не причина
      // віддавати авторові помилку замість книги.
      notesUk.push(`Супутній ${item.kind.toUpperCase()} не зроблено: ${(err as Error).message}`);
    }
  }
  return out;
}

/** Що саме експортер зробив і про що попередив — авторові, а не в /dev/null. */
function exportNotes(spec: PdfLayoutSpec, exported: any, notesUk: string[]): void {
  const warnings = Array.isArray(exported?.warnings) ? exported.warnings.map((w: unknown) => String(w)) : [];
  for (const warning of warnings) notesUk.push(`DesignCraft під час експорту: ${warning}`);
  const parts: string[] = [];
  parts.push(spec.pdfExport.tagged ? 'структурне дерево вкладено' : 'без структурного дерева');
  if (spec.pdfExport.standard !== 'none') parts.push(`стандарт ${spec.pdfExport.standard.toUpperCase()}`);
  if (spec.pdfExport.compressImages) parts.push('зображення стиснуто');
  notesUk.push(`Експорт PDF: ${parts.join(', ')}.`);
}

/**
 * Єдине місце, де кроки стають текстом `.dcs`. Підпис приймає лише
 * `DesigncraftCommand[]`, тож випадкова конкатенація кроку з рядком (яку
 * TypeScript пропускає, бо `object + string` законне) тут неможлива.
 */
async function writeScript(file: string, steps: readonly DesigncraftCommand[]): Promise<void> {
  await fs.writeFile(file, serializeScript(steps), 'utf8');
}

/**
 * Скільки разів запускався процес DesignCraft. Існує для вимірювача
 * (`scripts/bench-designcraftSession.mts`): різниця між транспортами — саме в
 * цьому числі, і читати його з логів було б менш надійно, ніж рахувати тут.
 */
let processLaunches = 0;

export function __designcraftProcessLaunches(): number {
  return processLaunches;
}

export function __resetDesigncraftProcessLaunches(): void {
  processLaunches = 0;
}

function runCli(args: string[], cwd?: string): Promise<CliResult> {
  processLaunches += 1;
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

/**
 * Звірити згенерований скрипт із ВСТАНОВЛЕНИМ бінарником перед запуском.
 *
 * Раніше цю роль грав awk у `scripts/designcraft-cli-compat.sh`: він
 * переписував два відомі шаблони прямо в тексті скрипта. Так розбіжність
 * версій ставала невидимою, а регресія виробника скрипта — тихо виправленою.
 * Тепер розбіжність — це дані (`designcraft-cli commands`), а невідповідність
 * зупиняє рендер із назвою кроку й команди. Докладніше — у шапці
 * `../designcraft/capabilities.ts`.
 */
async function assertScriptSupported(scriptPath: string): Promise<void> {
  const text = await fs.readFile(scriptPath, 'utf8');
  let caps: DesigncraftCapabilities;
  try {
    caps = await readDesigncraftCapabilities(DESIGNCRAFT_PROD_PATH, (args) => runCli(args));
  } catch (err) {
    throw new PdfEngineError(
      'designcraft',
      'unavailable',
      `Не вдалося прочитати перелік команд DesignCraft (${DESIGNCRAFT_PROD_PATH}): ${(err as Error).message}`
    );
  }
  const problems = findUnsupportedScriptSteps(text, caps);
  if (problems.length) {
    throw new PdfEngineError(
      'designcraft',
      'bad_input',
      ['DesignCraft не виконає згенерований скрипт.', ...problems].join(' ')
    );
  }
}

async function runScript(script: string, args: string[], cwd: string, timeoutUk: string): Promise<any> {
  await assertScriptSupported(script);
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

/** Same normalization as bookToMarkdown's headingText, used only for TOC diagnostics. */
function normalizedHeading(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`\[\]]/g, '')
    .trim() || 'Розділ';
}

function missingChapterTitles(request: PdfRenderRequest, chapterEntries: any[]): string[] {
  const actual = new Map<string, number>();
  for (const entry of chapterEntries) {
    const text = normalizedHeading(entry?.text);
    actual.set(text, (actual.get(text) || 0) + 1);
  }
  const missing: string[] = [];
  const chapters = (request.book.chapters || []).slice().sort((a: any, b: any) => (a?.order ?? 0) - (b?.order ?? 0));
  for (const chapter of chapters) {
    const title = normalizedHeading(chapter?.title);
    const count = actual.get(title) || 0;
    if (count > 0) actual.set(title, count - 1);
    else missing.push(title);
  }
  return missing;
}

function frame(
  spread: SpreadRef,
  rect: [number, number, number, number],
  text: string,
  size: number,
  a: 'left' | 'center' | 'right' = 'center'
): DesigncraftCommand[] {
  if (!text.trim()) return [];
  return [
    command('frame.create', { spread, rect, content: 'text', text }),
    command('type.para', { attrs: { align: a } }),
    command('type.char', { attrs: { size } }),
  ];
}

function titleFrames(request: PdfRenderRequest, spec: PdfLayoutSpec): DesigncraftCommand[] {
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

function parentFrames(request: PdfRenderRequest, spec: PdfLayoutSpec): DesigncraftCommand[] {
  const { width, height } = pageSize(spec);
  const parent: SpreadRef = { kind: 'parent', index: 0 };
  const out: DesigncraftCommand[] = [];
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
  await writeScript(script, [command('story.get', { story })]);
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
    await writeScript(script, [command('layout.documentSetup', { pages: mid }), command('story.get', { story })]);
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
  const exact = path.join(workDir, `${label}-exact.designcraft`);
  const exactScript = path.join(workDir, `${label}-exact.dcs`);
  await writeScript(exactScript, [command('layout.documentSetup', { pages: high }), command('story.get', { story })]);
  const exactReport = await runScript(exactScript, ['--in', sourceDoc, '--save', exact], workDir, 'DesignCraft не завершив фінальне обрізання сторінок.');
  const exactState = exactReport.results?.at(-1);
  if (overset(exactState)) throw new PdfEngineError('designcraft', 'engine', `Внутрішня перевірка reflow: ${high} стор. знову дали overset.`);
  return { doc: exact, pageCount: high, state: exactState };
}

// ---------------------------------------------------------------------------
// Другий транспорт: той самий конвеєр в ОДНІЙ живій сесії.
//
// Увімкнення — `DESIGNCRAFT_SESSION=1`. Типовим шляхом лишається файловий:
// це спайк, і порівнювати треба з чимось живим. Команди обидва шляхи беруть
// з тих самих білдерів (`command()`, `buildDesigncraftStyleCommands`,
// `parentFrames`, `titleFrames`), тож верстка однакова за побудовою.
//
// Відкат невдалої спроби — єдине, чим шляхи РІЗНЯТЬСЯ по суті, і саме це
// порівнюється. Файловий щоразу стартує з того самого збереженого документа.
// Сесійний має живий документ, тож:
//   - проба кількості сторінок — один undoable крок, відкат через `edit.undo`
//     (перевірено: `pages=10` на книзі в 109 стор. дало overset=30489, після
//     undo — overset=null і 109 стор.);
//   - спроба з ілюстраціями — це багато кроків, і рахувати undo було б
//     крихко, тому перед циклом ставиться контрольна точка `file.save`, а
//     невдала спроба відкочується `file.open`. Два записи файлу в найгіршому
//     разі замість повторного прогону всього конвеєра.
// ---------------------------------------------------------------------------

export const DESIGNCRAFT_SESSION_MODE =
  process.env.DESIGNCRAFT_SESSION === '1' || process.env.DESIGNCRAFT_SESSION === 'true';

function sessionOptions() {
  return { cliPath: DESIGNCRAFT_PROD_PATH, timeoutMs: TIMEOUT_MS, maxResponseChars: MAX_OUTPUT };
}

/** Звіт `batch` має ту саму форму, що й звіт `script`: перевірка теж спільна. */
function assertReportOk(report: DesigncraftReport, whatUk: string): void {
  if (report?.failedIndex !== undefined && report?.failedIndex !== null) {
    const id = report.failedCommand ? ` (${report.failedCommand})` : '';
    throw new PdfEngineError(
      'designcraft',
      'engine',
      `${whatUk}: крок ${report.failedIndex}${id}: ${String(report.error || 'невідома помилка')}`
    );
  }
}

/**
 * Найменша кількість сторінок, за якої нитка не overset — у живій сесії.
 * Кожна невдала проба відкочується одним `edit.undo`, тож наступна проба
 * починає з того самого стану, що й у файловому шляху.
 */
async function minimizePagesInSession(
  session: DesigncraftSession,
  story: number,
  minPages: number,
  maxPages: number
): Promise<{ pageCount: number; state: any }> {
  let low = minPages;
  let high = Math.max(minPages, maxPages);
  let bestState = await session.execute('story.get', { story });
  if (overset(bestState)) {
    throw new PdfEngineError('designcraft', 'engine', 'DesignCraft autoflow завершився з overset.');
  }

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const report = await session.batch([
      command('layout.documentSetup', { pages: mid }),
      command('story.get', { story }),
    ]);
    assertReportOk(report, 'Пошук мінімальної кількості сторінок');
    const state = (report.results || []).at(-1);
    if (overset(state)) {
      // Крок був один undoable — повертаємо документ як було.
      await session.execute('edit.undo', {});
      low = mid + 1;
    } else {
      high = mid;
      bestState = state;
      await session.execute('edit.undo', {});
    }
  }

  if (high === maxPages) return { pageCount: maxPages, state: bestState };

  const exact = await session.batch([
    command('layout.documentSetup', { pages: high }),
    command('story.get', { story }),
  ]);
  assertReportOk(exact, 'Фінальне обрізання сторінок');
  const exactState = (exact.results || []).at(-1);
  if (overset(exactState)) {
    throw new PdfEngineError(
      'designcraft',
      'engine',
      `Внутрішня перевірка reflow: ${high} стор. знову дали overset.`
    );
  }
  return { pageCount: high, state: exactState };
}

/**
 * Узгодження корінця з обсягом — те, через що друкований макет і лишався за
 * Nova.
 *
 * КУРКА З ЯЙЦЕМ. Мінімальне корінцеве поле KDP залежить від кількості
 * сторінок, а кількість сторінок — від ширини текстового блоку, тобто від
 * поля. Nova розв'язує це трьома ПОВНИМИ перезверстками
 * (`renderKdpInterior`). У живій сесії документ лишається в пам'яті, тож
 * досить змінити поля (`layout.marginsAndColumns` з `adjustLayout`) і
 * перезібрати нитку — повторної верстки з нуля не потрібно.
 *
 * Правила KDP НЕ дублюються: `kdpSpec` і `getKdpMinimumGutterMm` — ті самі,
 * якими користується Nova. Інакше два рушії з часом розійшлися б у тому, що
 * вважають припустимим полем, і автор не знав би, кому вірити.
 *
 * Корінець тільки РОСТЕ, як і в Nova: вузьке поле KDP відхилить, ширше — ні.
 */
async function agreeKdpGutter(
  session: DesigncraftSession,
  request: PdfRenderRequest,
  baseSpec: PdfLayoutSpec,
  story: number,
  state: { pageCount: number; spec: PdfLayoutSpec; gutterMm: number },
  notesUk: string[]
): Promise<void> {
  for (let pass = 0; pass < 3; pass += 1) {
    const needed = getKdpMinimumGutterMm(state.pageCount).minMm;
    if (needed <= state.gutterMm) {
      notesUk.push(
        `KDP: корінцеве поле ${state.gutterMm} мм при мінімумі ${needed} мм для ${state.pageCount} стор. — узгоджено за ${pass} ${pass === 1 ? 'прохід' : 'проходів'}.`
      );
      return;
    }
    const next = kdpSpec({
      base: baseSpec,
      trimId: request.trimId,
      hasBleed: request.hasBleed,
      pageCountEstimate: state.pageCount,
    });
    const merged = specOf(next.spec);
    const report = await session.batch([
      command('layout.marginsAndColumns', {
        margins: {
          top: merged.margins.top,
          bottom: merged.margins.bottom,
          inside: merged.margins.left,
          outside: merged.margins.right,
        },
        adjustLayout: true,
      }),
      command('story.get', { story }),
    ]);
    assertReportOk(report, 'Узгодження корінця KDP');
    state.spec = merged;
    state.gutterMm = next.gutterMm;

    // Ширший корінець звужує текст, тож нитка могла піти в overset: добираємо
    // сторінки, доки вона не вміститься, і фіксуємо новий обсяг.
    let current = (report.results || []).at(-1);
    let pages = state.pageCount;
    let guard = 0;
    while (overset(current) && guard < 64) {
      pages += Math.max(1, Math.ceil(pages * 0.02));
      const grow = await session.batch([
        command('layout.documentSetup', { pages }),
        command('story.get', { story }),
      ]);
      assertReportOk(grow, 'Добір сторінок після зміни корінця');
      current = (grow.results || []).at(-1);
      guard += 1;
    }
    if (overset(current)) {
      throw new PdfEngineError('designcraft', 'engine', 'Після зміни корінця нитка не вмістилася навіть із запасом сторінок.');
    }
    const minimized = await minimizePagesInSession(session, story, 1, pages);
    state.pageCount = minimized.pageCount;
    notesUk.push(`KDP: корінець ${next.gutterMm} мм → обсяг ${minimized.pageCount} стор.`);
  }
  const needed = getKdpMinimumGutterMm(state.pageCount).minMm;
  if (needed > state.gutterMm) {
    throw new PdfEngineError(
      'designcraft',
      'engine',
      `KDP: корінець не узгодився за три проходи (треба ${needed} мм, маємо ${state.gutterMm} мм при ${state.pageCount} стор.).`
    );
  }
}

async function renderInSession(request: PdfRenderRequest, specIn: PdfLayoutSpec): Promise<PdfRenderResult> {
  let spec = specIn;
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nova-designcraft-session-'));
  const manuscriptPath = path.join(workDir, 'manuscript.txt');
  const checkpoint = path.join(workDir, 'checkpoint.designcraft');
  const pdfPath = path.join(workDir, 'book.pdf');

  processLaunches += 1;
  const session = await DesigncraftSession.start(sessionOptions());
  try {
    /*
     * Друкована редакція починається з макета KDP, а не з екранного: обріз,
     * дзеркальні поля й початковий корінець задає `kdpSpec`. Далі корінець
     * узгоджується з фактичним обсягом (`agreeKdpGutter`).
     */
    const kdp = request.print
      ? kdpSpec({ base: spec, trimId: request.trimId, hasBleed: request.hasBleed, pageCountEstimate: 24 })
      : null;
    if (kdp) spec = specOf(kdp.spec);
    // Нотатки друку збираються окремо, бо `notesUk` з'являється лише після
    // підготовки ілюстрацій, а корінець узгоджується раніше.
    const notesPrint: string[] = [];

    const manuscript = buildDesigncraftRtf(request.book, spec);
    await fs.writeFile(manuscriptPath, manuscript.rtf, 'utf8');
    const tocPage = spec.titlePage.show ? 2 : 1;
    const bodyPage = tocPage + 1;

    const initial = await session.batch([
      command('file.new', {
        ...pageSize(spec),
        pages: bodyPage,
        // Дзеркальні поля мають сенс лише на розкладках: саме вони роблять
        // внутрішнє поле внутрішнім. Для екранного PDF це зайве.
        facingPages: !!request.print,
        margins: { top: spec.margins.top, bottom: spec.margins.bottom, inside: spec.margins.left, outside: spec.margins.right },
        title: request.book.title || 'Fusion Lab book',
      }),
      ...buildDesigncraftStyleCommands(spec, manuscript.semanticStylesUsed),
      command('file.place', { path: manuscriptPath, page: bodyPage, autoflow: true, styleConflicts: 'useExisting' }),
    ]);
    assertReportOk(initial, 'Первинне autoflow');
    const placed = (initial.results || []).find(
      (v: any) => v && typeof v === 'object' && 'pagesAdded' in v && 'story' in v
    ) as any;
    const story = Number(placed?.story);
    const pagesAdded = Number(placed?.pagesAdded || 0);
    if (!Number.isFinite(story)) {
      throw new PdfEngineError('designcraft', 'engine', 'DesignCraft не повернув story після імпорту рукопису.');
    }
    if (placed?.overset) {
      throw new PdfEngineError('designcraft', 'engine', 'Первинне DesignCraft autoflow завершилось із overset.');
    }
    const allocatedPages = bodyPage + pagesAdded;
    const minimized = await minimizePagesInSession(session, story, bodyPage, allocatedPages);

    if (kdp) {
      const agreed = { pageCount: minimized.pageCount, spec, gutterMm: kdp.gutterMm };
      await agreeKdpGutter(session, request, specIn, story, agreed, notesPrint);
      spec = agreed.spec;
      minimized.pageCount = agreed.pageCount;
    }

    const beforeImages = await session.execute('story.get', { story });
    const placements = locateImages(String(beforeImages?.text || ''), manuscript);
    const notesUk = await prepareImages(workDir, manuscript, placements, request.ownerId);
    if (manuscript.unresolvedMarkers.length) {
      notesUk.push(`Не знайдено ілюстрацій для маркерів: ${manuscript.unresolvedMarkers.join(', ')}.`);
    }
    const loadedImages = placements.filter((p) => p.path).length;

    if (placements.length) {
      const textWidth = pageSize(spec).width - spec.margins.left - spec.margins.right;
      // Контрольна точка: невдалу спробу з ілюстраціями відкотити одним відкриттям.
      await session.execute('file.save', { path: checkpoint });
      let accepted = false;
      for (const factor of [0.56, 0.46, 0.36]) {
        const commands: DesigncraftCommand[] = [];
        for (const image of placements) {
          commands.push(command('story.replaceRange', { story, start: image.start, end: image.end, text: '' }));
          if (image.path) {
            commands.push(command('file.place', { path: image.path, spread: 0, x: 0, y: 0, width: Math.min(260, textWidth * factor) }));
            commands.push(command('anchored.insert', { ids: ['$last.id'], story, pos: image.start, position: 'aboveLine', align: 'center', spaceBefore: 8, spaceAfter: 10 }));
          }
        }
        commands.push(command('story.get', { story }));
        const report = await session.batch(commands);
        assertReportOk(report, 'Вставлення ілюстрацій');
        if (!overset((report.results || []).at(-1))) {
          accepted = true;
          break;
        }
        await session.execute('file.open', { path: checkpoint });
      }
      if (!accepted) {
        throw new PdfEngineError('designcraft', 'engine', 'Ілюстрації спричинили overset навіть після автоматичного зменшення.');
      }
    }

    const frontPages = Array.from({ length: bodyPage - 1 }, (_, i) => i);
    const tocStyles = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
    const companion = companionSteps(spec, request, workDir);
    const steps: DesigncraftCommand[] = [
      command('layout.section', { page: bodyPage, startNumber: Math.max(1, Math.round(spec.pageNumber.startAt || 1)), style: 'arabic' }),
      ...(frontPages.length && (spec.runningHead.show || spec.pageNumber.skipFrontMatter)
        ? [command('layout.pages.applyParent', { pages: frontPages, parent: null })]
        : []),
      ...parentFrames(request, spec),
      ...titleFrames(request, spec),
      command('toc.generate', { styles: tocStyles, title: spec.frontMatter.contentsTitle || 'Зміст', pageNumbers: true, page: tocPage }),
      command('toc.update'),
      ...companion.commands,
    ];
    // Індекси запам'ятовуються, а не відлічуються з кінця: супутні експорти
    // роблять хвіст змінної довжини, і від'ємні зсуви попливли б.
    const at = { state: 0, anchored: 0, toc: 0, chapterToc: 0, inspect: 0 };
    at.state = steps.push(command('story.get', { story })) - 1;
    at.anchored = steps.push(command('anchored.list', { story })) - 1;
    at.toc = steps.push(command('toc.entries', { styles: tocStyles })) - 1;
    at.chapterToc = steps.push(command('toc.entries', { styles: ['Heading 1'] })) - 1;
    at.inspect = steps.push(command('document.inspect')) - 1;

    const final = await session.batch(steps);
    assertReportOk(final, 'Фінальний прохід');
    const r = Array.isArray(final.results) ? final.results : [];
    const finalState = r[at.state] as any;
    const anchored = r[at.anchored];
    const toc = r[at.toc];
    const chapterToc = r[at.chapterToc];
    const inspect = r[at.inspect] as any;

    if (overset(finalState)) throw new PdfEngineError('designcraft', 'engine', 'Фінальна перевірка знайшла overset.');
    if (!Array.isArray(anchored) || anchored.length !== loadedImages) {
      throw new PdfEngineError('designcraft', 'engine', `Ілюстрації: очікувалось ${loadedImages}, знайдено ${Array.isArray(anchored) ? anchored.length : 0}.`);
    }
    const chapterCount = request.book.chapters?.length || 0;
    const chapterEntries = Array.isArray(chapterToc) ? chapterToc : [];
    if (chapterCount && chapterEntries.length !== chapterCount) {
      const missing = missingChapterTitles(request, chapterEntries);
      const returned = chapterEntries.map((e: any) => normalizedHeading(e?.text));
      throw new PdfEngineError(
        'designcraft',
        'engine',
        [
          `Зміст: глав ${chapterCount}, Heading 1 на сторінках ${chapterEntries.length}.`,
          missing.length ? `Не потрапили до змісту: ${missing.map((x) => `«${x}»`).join(', ')}.` : '',
          `DesignCraft повернув: ${returned.map((x) => `«${x}»`).join(', ')}.`,
        ].filter(Boolean).join(' ')
      );
    }
    if (!Array.isArray(toc) || toc.length < chapterEntries.length) {
      throw new PdfEngineError('designcraft', 'engine', 'Зміст: загальний TOC повернув менше записів, ніж окремий список глав.');
    }

    const exported = await session.execute(
      'file.exportPdf',
      exportParams(spec, pdfPath, kdp ? { bleed: request.hasBleed } : undefined)
    );
    const bytes = new Uint8Array(await fs.readFile(pdfPath));
    if (bytes.length < 1000) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft створив підозріло малий PDF.');
    const pdf = await PDFDocument.load(bytes);
    const pageCount = pdf.getPageCount();
    if (pageCount !== minimized.pageCount) {
      throw new PdfEngineError('designcraft', 'engine', `Кількість сторінок не збігається: PDF=${pageCount}, reflow=${minimized.pageCount}.`);
    }
    if (Number(inspect?.pageCount) !== pageCount) {
      throw new PdfEngineError('designcraft', 'engine', `document.inspect не збігається з PDF: inspect=${String(inspect?.pageCount)}, PDF=${pageCount}.`);
    }
    // Третє незалежне джерело кількості сторінок, якого файловий шлях не мав:
    // `file.exportPdf` сам звітує, скільки сторінок записав.
    if (Number(exported?.pages) !== pageCount) {
      throw new PdfEngineError('designcraft', 'engine', `file.exportPdf звітує ${String(exported?.pages)} стор., у PDF ${pageCount}.`);
    }
    exportNotes(spec, exported, notesUk);
    await validateIfRequested(spec, pdfPath, notesUk);
    const companions = await collectCompanions(companion.plan, notesUk);

    const pagination = buildDesigncraftSemanticPagination({
      book: request.book,
      tocEntries: toc,
      chapterEntries,
      inspect,
      titlePageShown: spec.titlePage.show,
      tocPageIndex: tocPage - 1,
      contentStartPageIndex: bodyPage - 1,
    });

    if (notesPrint.length) notesUk.unshift(...notesPrint);
    const semanticNames = manuscript.semanticStylesUsed.filter((name) => !['Body', 'Heading 1', 'Heading 2'].includes(name));
    if (semanticNames.length) notesUk.unshift(`Тема DesignCraft застосувала семантичні стилі: ${semanticNames.join(', ')}.`);
    notesUk.unshift(
      `DesignCraft (жива сесія): ${pageCount} стор. (первинно виділено ${allocatedPages}, зайвий хвіст прибрано бінарною перевіркою), без overset, зміст синхронізовано (${chapterEntries.length}/${chapterCount} глав), ${loadedImages} ілюстрацій перевірено.`
    );
    return {
      bytes,
      pageCount,
      engineId: 'designcraft',
      honoredSpec: true,
      notesUk,
      pagination,
      ...(companions.length ? { companions } : {}),
    };
  } catch (err) {
    if (err instanceof PdfEngineError) throw err;
    if (err instanceof DesigncraftSessionError) {
      throw new PdfEngineError('designcraft', err.kind === 'timeout' ? 'timeout' : 'engine', `DesignCraft: ${err.message}`);
    }
    throw new PdfEngineError('designcraft', 'engine', `DesignCraft: ${(err as Error).message}`);
  } finally {
    session.close();
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Лише для вимірювача: сесійний шлях, викликаний напряму, щоб обидва
 * транспорти можна було зміряти в ОДНОМУ процесі Node — інакше різниця
 * включала б прогрів V8 і кеш файлової системи, а не транспорт.
 */
export async function __renderWithSession(request: PdfRenderRequest): Promise<PdfRenderResult> {
  return await renderInSession(request, specOf(request.spec));
}

export const designcraftEngineV3: PdfEngine = {
  id: 'designcraft',
  label: 'DesignCraft',
  strengthUk: 'Професійна книжкова верстка з нативним reflow, автоматичним змістом, ілюстраціями, колонтитулами та нумерацією.',
  limitUk: 'Друкований KDP-макет із розрахунком корінця поки лишається за Nova; DesignCraft використовується для цифрового PDF.',
  // Чесно: друкований макет існує ЛИШЕ в сесійному транспорті (там живий
  // документ, без якого корінець не узгодити). У файловому його немає, і
  // обіцяти його там означало б показати авторові кнопку, що не працює.
  supportsPrint: DESIGNCRAFT_SESSION_MODE,
  supportsCompanions: true,

  async available(): Promise<PdfEngineAvailability> {
    const out = await runCli(['--version']);
    if (out.code === 0) return { ok: true };
    return { ok: false, reasonUk: `DesignCraft CLI не знайдено (${DESIGNCRAFT_PROD_PATH}).`, fixUk: 'У production він встановлюється в Docker-образ; локально задайте DESIGNCRAFT_PATH.' };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const availability = await this.available();
    if (!availability.ok) throw new PdfEngineError('designcraft', 'unavailable', availability.reasonUk || 'DesignCraft недоступний.');

    const spec = specOf(request.spec);
    // Спайк: той самий конвеєр в одній живій сесії. Типовим лишається
    // файловий шлях нижче — див. блок перед цим об'єктом.
    if (DESIGNCRAFT_SESSION_MODE) return await renderInSession(request, spec);

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
      await writeScript(
        initialScript,
        [
          command('file.new', {
            ...pageSize(spec),
            pages: bodyPage,
            facingPages: false,
            margins: { top: spec.margins.top, bottom: spec.margins.bottom, inside: spec.margins.left, outside: spec.margins.right },
            title: request.book.title || 'Fusion Lab book',
          }),
          ...buildDesigncraftStyleCommands(spec, manuscript.semanticStylesUsed),
          command('file.place', { path: manuscriptPath, page: bodyPage, autoflow: true, styleConflicts: 'useExisting' }),
        ]
      );
      const initial = await runScript(initialScript, ['--save', initialDoc], workDir, 'DesignCraft не завершив первинне autoflow вчасно.');
      const placed = (initial.results || []).find((v: any) => v && typeof v === 'object' && 'pagesAdded' in v && 'story' in v);
      const story = Number(placed?.story);
      const pagesAdded = Number(placed?.pagesAdded || 0);
      if (!Number.isFinite(story)) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft не повернув story після імпорту рукопису.');
      if (placed?.overset) throw new PdfEngineError('designcraft', 'engine', 'Первинне DesignCraft autoflow завершилось із overset.');
      const allocatedPages = bodyPage + pagesAdded;
      const minimized = await minimizePages(workDir, initialDoc, story, bodyPage, allocatedPages, 'text');

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
          const commands: DesigncraftCommand[] = [];
          for (const image of placements) {
            commands.push(command('story.replaceRange', { story, start: image.start, end: image.end, text: '' }));
            if (image.path) {
              commands.push(command('file.place', { path: image.path, spread: 0, x: 0, y: 0, width: Math.min(260, textWidth * factor) }));
              commands.push(command('anchored.insert', { ids: ['$last.id'], story, pos: image.start, position: 'aboveLine', align: 'center', spaceBefore: 8, spaceAfter: 10 }));
            }
          }
          commands.push(command('story.get', { story }));
          await writeScript(script, commands);
          const report = await runScript(script, ['--in', minimized.doc, '--save', outDoc], workDir, 'DesignCraft не завершив вставлення ілюстрацій.');
          if (!overset(report.results?.at(-1))) {
            contentDoc = outDoc;
            accepted = true;
            break;
          }
        }
        if (!accepted) throw new PdfEngineError('designcraft', 'engine', 'Ілюстрації спричинили overset навіть після автоматичного зменшення.');
      }

      const companion = companionSteps(spec, request, workDir);
      const finalScript = path.join(workDir, 'final.dcs');
      const finalDoc = path.join(workDir, 'final.designcraft');
      const frontPages = Array.from({ length: bodyPage - 1 }, (_, i) => i);
      const tocStyles = spec.frontMatter.contentsSections ? ['Heading 1', 'Heading 2'] : ['Heading 1'];
      await writeScript(
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
          // Експорт стоїть ПЕРЕД п'ятіркою запитів, а не після: запити
          // документа не змінюють, тож порядок байт у PDF той самий, зате
          // негативні індекси нижче лишаються прив'язані до тих самих п'яти
          // результатів. Раніше експорт робив прапорець `--export`, і опції
          // експортера були недосяжні.
          command('file.exportPdf', exportParams(spec, pdfPath)),
          ...companion.commands,
          command('story.get', { story }),
          command('anchored.list', { story }),
          command('toc.entries', { styles: tocStyles }),
          command('toc.entries', { styles: ['Heading 1'] }),
          command('document.inspect'),
        ]
      );
      const final = await runScript(finalScript, ['--in', contentDoc, '--save', finalDoc], workDir, 'DesignCraft не завершив фінальний PDF вчасно.');
      const r = Array.isArray(final.results) ? final.results : [];
      // П'ятірка запитів завжди в кінці, а супутні експорти стоять перед нею,
      // тож від'ємні зсуви для запитів лишаються правильними; до результату
      // експорту PDF треба відняти ще й довжину хвоста супутників.
      const exported = r.at(-6 - companion.commands.length) as any;
      const finalState = r.at(-5);
      const anchored = r.at(-4);
      const toc = r.at(-3);
      const chapterToc = r.at(-2);
      const inspect = r.at(-1);
      if (overset(finalState)) throw new PdfEngineError('designcraft', 'engine', 'Фінальна перевірка знайшла overset.');
      if (!Array.isArray(anchored) || anchored.length !== loadedImages) {
        throw new PdfEngineError('designcraft', 'engine', `Ілюстрації: очікувалось ${loadedImages}, знайдено ${Array.isArray(anchored) ? anchored.length : 0}.`);
      }
      const chapterCount = request.book.chapters?.length || 0;
      const chapterEntries = Array.isArray(chapterToc) ? chapterToc : [];
      if (chapterCount && chapterEntries.length !== chapterCount) {
        const missing = missingChapterTitles(request, chapterEntries);
        const returned = chapterEntries.map((e: any) => normalizedHeading(e?.text));
        throw new PdfEngineError(
          'designcraft',
          'engine',
          [
            `Зміст: глав ${chapterCount}, Heading 1 на сторінках ${chapterEntries.length}.`,
            missing.length ? `Не потрапили до змісту: ${missing.map((x) => `«${x}»`).join(', ')}.` : '',
            `DesignCraft повернув: ${returned.map((x) => `«${x}»`).join(', ')}.`,
          ].filter(Boolean).join(' ')
        );
      }
      if (!Array.isArray(toc) || toc.length < chapterEntries.length) {
        throw new PdfEngineError('designcraft', 'engine', 'Зміст: загальний TOC повернув менше записів, ніж окремий список глав.');
      }

      const bytes = new Uint8Array(await fs.readFile(pdfPath));
      if (bytes.length < 1000) throw new PdfEngineError('designcraft', 'engine', 'DesignCraft створив підозріло малий PDF.');
      const pdf = await PDFDocument.load(bytes);
      const pageCount = pdf.getPageCount();
      if (pageCount !== minimized.pageCount) throw new PdfEngineError('designcraft', 'engine', `Кількість сторінок не збігається: PDF=${pageCount}, reflow=${minimized.pageCount}.`);
      if (Number(inspect?.pageCount) !== pageCount) {
        throw new PdfEngineError('designcraft', 'engine', `document.inspect не збігається з PDF: inspect=${String(inspect?.pageCount)}, PDF=${pageCount}.`);
      }
      // Третє джерело кількості сторінок: сам експортер. Доступне відтоді,
      // як експорт робить команда, а не прапорець `--export`.
      if (Number(exported?.pages) !== pageCount) {
        throw new PdfEngineError('designcraft', 'engine', `file.exportPdf звітує ${String(exported?.pages)} стор., у PDF ${pageCount}.`);
      }
      exportNotes(spec, exported, notesUk);
      await validateIfRequested(spec, pdfPath, notesUk);
      const companions = await collectCompanions(companion.plan, notesUk);

      const pagination = buildDesigncraftSemanticPagination({
        book: request.book,
        tocEntries: toc,
        chapterEntries,
        inspect,
        titlePageShown: spec.titlePage.show,
        tocPageIndex: tocPage - 1,
        contentStartPageIndex: bodyPage - 1,
      });

      const semanticNames = manuscript.semanticStylesUsed.filter((name) => !['Body', 'Heading 1', 'Heading 2'].includes(name));
      if (semanticNames.length) notesUk.unshift(`Тема DesignCraft застосувала семантичні стилі: ${semanticNames.join(', ')}.`);
      notesUk.unshift(
        `DesignCraft: ${pageCount} стор. (первинно виділено ${allocatedPages}, зайвий хвіст прибрано бінарною перевіркою), без overset, зміст синхронізовано (${chapterEntries.length}/${chapterCount} глав), ${loadedImages} ілюстрацій перевірено.`
      );
      return {
        bytes,
        pageCount,
        engineId: 'designcraft',
        honoredSpec: true,
        notesUk,
        pagination,
        ...(companions.length ? { companions } : {}),
      };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('designcraft', 'engine', `DesignCraft: ${(err as Error).message}`);
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
};

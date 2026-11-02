/**
 * PDF-креслення замовленого столу, зібрані рушієм DesignCraft.
 *
 * ЧОМУ ТУТ. Креслення — не товар маркетплейсу: їх бачить лише адміністратор, на картці замовлення в Студії. А
 * DesignCraft працює саме на сервері Студії (`Dockerfile`, окремий pinned-бінарник), тож PDF складається тут, а не в
 * браузері й не в API маркетплейсу.
 *
 * ЯК. Ті самі векторні аркуші, що в SVG для виробництва (`public/slab-studio/table-production.js`, 1:1 в мм), вставляються
 * у документ DesignCraft командою `edit.pasteSvg` — контури лишаються векторними, текст стає контурами. Перша сторінка —
 * специфікація: замовник і всі параметри обраної конфігурації разом із епоксидною смолою; далі по сторінці на аркуш,
 * зменшений до формату A4 (книжного) з написаним масштабом. Експортує `file.exportPdf`.
 *
 * ЧОМУ ОКРЕМИЙ БІНАРНИК. `edit.pasteSvg` з'явився у DesignCraft 0.9.0, а книги досі рендеряться на 0.7.1 із шимом
 * (`DESIGNCRAFT_PATH`). Креслення йдуть через `DESIGNCRAFT_DRAWINGS_PATH`, тож версію книг ніхто не зачіпає.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { cmd, serializeScript, type DesigncraftCommand } from './pdf/designcraft/commands';
import { buildDesigncraftStyleCommands } from './pdf/designcraft/styleCommands';
import { getBookDesignTheme, isBookDesignThemeId, listBookDesignThemes, type BookDesignThemeId } from './pdf/designcraft/themes';
import { DEFAULT_LAYOUT_SPEC, type PdfLayoutSpec } from './pdf/pdfTypes';

/** A4, книжна, пункти. */
export const PAGE = { w: 595.28, h: 841.89, margin: 28, footer: 54 } as const;
const PT_PER_MM = 72 / 25.4;
/** Масштаби, якими користується креслення: найближчий, що вміщує аркуш. */
const NICE = [1, 2, 2.5, 5, 10, 20, 25, 50, 100];
const TIMEOUT_MS = Number(process.env.DESIGNCRAFT_TIMEOUT_MS) || 240_000;

/**
 * Шаблон дизайну креслень — одна з дизайн-тем книг Студії (ті самі шрифти, вирівнювання, розміри й відступи, що в
 * верстці книг). Тема визначає, як виглядає сторінка специфікації: заголовок, назви розділів і текст.
 */
export const DEFAULT_DRAWINGS_TEMPLATE: BookDesignThemeId = 'academic-research';
export function listDrawingsTemplates() {
  return listBookDesignThemes().map((t) => ({
    id: t.id,
    label: t.labelUk,
    description: t.descriptionUk,
    category: t.category,
    recommendedFor: t.recommendedFor,
    default: t.id === DEFAULT_DRAWINGS_TEMPLATE,
  }));
}
export const resolveDrawingsTemplate = (value: unknown): BookDesignThemeId => (isBookDesignThemeId(value) ? value : DEFAULT_DRAWINGS_TEMPLATE);
/** Налаштування верстки для сторінки специфікації: A4, дрібніший текст, заголовки в межах сторінки. */
function templateSpec(id: BookDesignThemeId): PdfLayoutSpec {
  return {
    ...DEFAULT_LAYOUT_SPEC,
    themeId: id,
    baseFontSize: 10,
    bodyAlign: 'left',
    paragraphIndent: 0,
    paragraphSpacing: 1,
    chapterTitle: { ...DEFAULT_LAYOUT_SPEC.chapterTitle, fontSize: 18, spaceBefore: 0, spaceAfter: 10, align: 'left' },
    sectionTitle: { ...DEFAULT_LAYOUT_SPEC.sectionTitle, fontSize: 11, spaceBefore: 10, spaceAfter: 2, align: 'left' },
  } as PdfLayoutSpec;
}
/** Назви розділів специфікації: вони отримують стиль «Heading 2». */
const SECTION_TITLES = new Set(['ЗАМОВНИК', 'СТІЛЬНИЦЯ', 'ЕПОКСИДНА СМОЛА', 'СЛЕБИ', 'НІЖКИ']);

export const DRAWINGS_CLI_PATH = () => process.env.DESIGNCRAFT_DRAWINGS_PATH || '';

interface Sheet { id: string; title: string; w: number; h: number }
interface ProductionApi {
  sheets(order: unknown): Sheet[];
  svg(sheet: Sheet, order: unknown, opts?: { scale?: number; mmText?: boolean }): string;
}
export interface DrawingsOrder {
  number: string;
  shape: string;
  l: number;
  w: number;
  t: number;
  color: string;
  buyer?: { displayName?: string | null; email?: string | null } | null;
  customer?: { name?: string | null; email?: string | null; shipping?: { recipientName?: string; phone?: string; city?: string; branch?: string } | null } | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------- спільні модулі конструктора
/** Папка, де лежать спільні скрипти конструктора: у образі — dist/slab-studio, у розробці — public/slab-studio. */
export function slabStudioDir(): string {
  for (const dir of [path.join(process.cwd(), 'dist', 'slab-studio'), path.join(process.cwd(), 'public', 'slab-studio')])
    if (existsSync(path.join(dir, 'table-production.js'))) return dir;
  throw new Error('Не знайдено скрипти конструктора столів (table-production.js).');
}

let cached: { dir: string; api: ProductionApi } | null = null;
export function loadProduction(dir = slabStudioDir()): ProductionApi {
  if (cached && cached.dir === dir) return cached.api;
  const context = vm.createContext({ TextEncoder });
  (context as Record<string, unknown>).window = context;
  for (const file of ['geometry.js', 'table-legs.js', 'table-edges.js', 'table-production.js'])
    vm.runInContext(readFileSync(path.join(dir, file), 'utf8'), context, { filename: file });
  const api = (context as Record<string, unknown>).TableProduction as ProductionApi | undefined;
  if (!api?.sheets) throw new Error('table-production.js не завантажився.');
  cached = { dir, api };
  return api;
}

// ---------------------------------------------------------------------------- текст специфікації
const num = (v: unknown, d = 1) => (Number.isFinite(Number(v)) ? String(Math.round(Number(v) * 10 ** d) / 10 ** d).replace('.', ',') : '—');
const SHAPES: Record<string, string> = { square: 'квадрат', rect: 'прямокутник', round: 'коло', oval: 'овал' };
const EDGE = (style: unknown) => (style === 'chamfer' ? 'фаска 45°' : 'скруглення');

export function customerOf(o: DrawingsOrder) {
  const c = o.customer;
  const ship = c?.shipping;
  return {
    name: c?.name || o.buyer?.displayName || 'Без імені',
    email: c?.email || o.buyer?.email || '',
    phone: ship?.phone || '',
    address: ship ? [ship.city, ship.branch].filter(Boolean).join(', ') : '',
  };
}

/** Рядки першої сторінки: замовник і параметри обраної конфігурації. */
export function specLines(o: DrawingsOrder): string[] {
  const c = customerOf(o);
  const q = (o.quote || {}) as Record<string, any>;
  const legs = q.legs as Record<string, any> | undefined;
  const slabs = (o.slabs as any[] | undefined) || [];
  const lines: string[] = [
    `Креслення столу №${o.number}`,
    '',
    'ЗАМОВНИК',
    `Ім’я: ${c.name}`,
    ...(c.email ? [`Email: ${c.email}`] : []),
    ...(c.phone ? [`Телефон: ${c.phone}`] : []),
    ...(c.address ? [`Доставка: ${c.address}`] : []),
    '',
    'СТІЛЬНИЦЯ',
    `Форма: ${SHAPES[o.shape] || o.shape}, ${num(Number(o.l) * 10, 0)} × ${num(Number(o.w) * 10, 0)} × ${num(Number(o.t) * 10, 0)} мм`,
  ];
  if (Number(o.cornerMm)) lines.push(`Радіус кутів: ${num(o.cornerMm, 0)} мм`);
  if (Number(o.edgeTopMm) || Number(o.edgeBottomMm))
    lines.push(`Краї: верх — ${EDGE(o.edgeTopStyle)} ${num(o.edgeTopMm, 0)} мм, низ — ${EDGE(o.edgeBottomStyle)} ${num(o.edgeBottomMm, 0)} мм`);
  lines.push('', 'ЕПОКСИДНА СМОЛА', `Колір: ${o.color}${(o.resinTexture as any)?.name ? `, текстура «${(o.resinTexture as any).name}»` : ''}`);
  if (Number(o.resinTransparency)) lines.push(`Прозорість: ${num(o.resinTransparency, 0)} %`);
  if (Number(o.resinAngle)) lines.push(`Поворот текстури: ${num(o.resinAngle, 0)}°`);
  if (q.litres) lines.push(`Обсяг: ${num(q.litres, 2)} л · ${num(q.kg, 2)} кг (вільна площа ${num(q.resin, 3)} м²)`);
  lines.push('', 'СЛЕБИ');
  for (const s of slabs) lines.push(`${s.number} · ${s.species} · ${num(s.h * 10, 0)} × ${num(s.w * 10, 0)} × ${num(s.t * 10, 0)} мм`);
  if (legs) {
    lines.push('', 'НІЖКИ', `Схема: ${legs.schemeName} · ${legs.material?.name || ''} · стіл ${num(legs.height * 10, 0)} мм, довжина ніжки ${num(legs.legLength * 10, 0)} мм`);
    if (legs.legDims) lines.push(`Ніжка: верх ${num(legs.legDims.topW * 10, 0)} × ${num(legs.legDims.topD * 10, 0)} → низ ${num(legs.legDims.footW * 10, 0)} × ${num(legs.legDims.footD * 10, 0)} мм`);
    if (legs.columnDims) lines.push(`Колона: верхнє коло Ø${num(legs.columnDims.top * 10, 0)} → нижнє Ø${num(legs.columnDims.foot * 10, 0)} мм`);
    if (legs.slats) lines.push(`Рейки: товщина ${num(legs.slats.thick * 10, 0)} мм, скруглення ${num(legs.slats.radius * 10, 0)} мм, ${legs.slatCount ?? '—'} на колоні`);
    lines.push(`Відступ від краю стільниці: ${num(legs.inset * 10, 0)} мм`);
    if (legs.plate)
      lines.push(`Пластини: ${legs.mounts?.length ?? '—'} × «${legs.plate.name}» ${num(legs.mounts?.[0]?.w * 10, 0)} × ${num(legs.mounts?.[0]?.d * 10, 0)} × ${num(legs.plateThicknessCm * 10, 0)} мм, 4 отвори Ø${num(legs.plate.holeDiameterMm, 1)} мм, відступ ${num(legs.plate.holeInsetMm, 0)} мм від краю`);
  }
  return lines;
}

// ---------------------------------------------------------------------------- скрипт DesignCraft
const clampScale = (sheet: Sheet, areaW: number, areaH: number) => {
  const need = Math.max(sheet.w / (areaW / PT_PER_MM), sheet.h / (areaH / PT_PER_MM), 1);
  const denominator = NICE.find((n) => n >= need) ?? Math.ceil(need);
  return denominator;
};
export function buildDrawingsScript(
  order: DrawingsOrder,
  production: ProductionApi = loadProduction(),
  opts: { template?: unknown } = {},
): { steps: DesigncraftCommand[]; pages: number; scales: number[]; template: BookDesignThemeId } {
  const template = resolveDrawingsTemplate(opts.template);
  const sheets = production.sheets(order);
  const pages = sheets.length + 1;
  const c = customerOf(order);
  const steps: DesigncraftCommand[] = [
    cmd('file.new', { width: PAGE.w, height: PAGE.h, pages, margins: 0, facingPages: false, title: `Стіл №${order.number} — креслення`, intent: 'print' }),
    // стилі абзаців шаблону: Body, Heading 1, Heading 2 — із тієї самої теми, що й книги
    ...buildDesigncraftStyleCommands(templateSpec(template), []),
  ];
  const areaW = PAGE.w - 2 * PAGE.margin,
    areaH = PAGE.h - 2 * PAGE.margin - PAGE.footer;
  const footer = (page: number, label: string) =>
    cmd('frame.create', {
      spread: page,
      rect: [PAGE.margin, PAGE.h - PAGE.margin - 40, PAGE.w - PAGE.margin, PAGE.h - PAGE.margin],
      content: 'text',
      text: `Fusion Lab · стіл №${order.number} · замовник: ${c.name} · ${label} · лист ${page + 1} з ${pages}`,
    });

  // Перша сторінка: специфікація і зразок кольору смоли.
  const lines = specLines(order);
  const specAt = steps.length; // номер кроку, на який посилаються наступні (`$N.story`)
  steps.push(
    cmd('frame.create', {
      spread: 0,
      rect: [PAGE.margin, PAGE.margin + 70, PAGE.w - PAGE.margin, PAGE.h - PAGE.margin - PAGE.footer],
      content: 'text',
      text: lines.join('\n'),
    }),
    ...styleParagraphs(specAt, lines),
    cmd('edit.pasteSvg', {
      spread: 0,
      at: [PAGE.w - PAGE.margin - 85, PAGE.margin + 30],
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="30mm" viewBox="0 0 60 30"><rect width="60" height="30" fill="${/^#[0-9a-fA-F]{6}$/.test(order.color) ? order.color : '#24474b'}" stroke="#222" stroke-width="0.3"/></svg>`,
    }),
    footer(0, 'специфікація'),
  );

  // Далі по сторінці на аркуш.
  const scales: number[] = [];
  sheets.forEach((sheet, i) => {
    const denominator = clampScale(sheet, areaW, areaH);
    scales.push(denominator);
    steps.push(
      cmd('edit.pasteSvg', {
        spread: i + 1,
        at: [PAGE.margin + areaW / 2, PAGE.margin + areaH / 2],
        svg: production.svg(sheet, order, { scale: 1 / denominator, mmText: true }),
      }),
      footer(i + 1, `${sheet.title}, масштаб 1:${denominator}`),
    );
  });
  steps.push(cmd('file.exportPdf', { path: '__OUT__', title: `Стіл №${order.number} — креслення`, author: 'Fusion Lab', tagged: true }));
  return { steps, pages, scales, template };
}

/** Стилі абзаців специфікації: уся розмітка — Body, перший рядок — Heading 1, назви розділів — Heading 2. */
function styleParagraphs(frameStep: number, lines: string[]): DesigncraftCommand[] {
  const story = `$${frameStep}.story`;
  const total = Buffer.byteLength(lines.join('\n'), 'utf8');
  const steps: DesigncraftCommand[] = [
    cmd('text.select', { story, anchor: 0, focus: total }),
    cmd('style.paragraph.apply', { name: 'Body' }),
  ];
  let at = 0;
  lines.forEach((line, i) => {
    const bytes = Buffer.byteLength(line, 'utf8');
    const name = i === 0 ? 'Heading 1' : SECTION_TITLES.has(line) ? 'Heading 2' : null;
    if (name && bytes > 0) steps.push(cmd('text.select', { story, anchor: at, focus: at + bytes }), cmd('style.paragraph.apply', { name }));
    at += bytes + 1;
  });
  return steps;
}

// ---------------------------------------------------------------------------- запуск
interface CliResult { code: number | null; stdout: string; stderr: string; timedOut: boolean }
function run(cli: string, args: string[], cwd: string): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = spawn(cli, args, { cwd, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 100_000) stderr += d; });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: null, stdout, stderr: stderr + String(e), timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, timedOut }); });
  });
}

export class DrawingsError extends Error {
  constructor(message: string, readonly status = 500) { super(message); }
}

/** Бінарник вміє вставляти SVG (DesignCraft 0.9.0 і новіші). */
export async function drawingsCliSupportsSvg(cli: string): Promise<boolean> {
  const r = await run(cli, ['commands', 'edit.pasteSvg'], process.cwd());
  return r.code === 0 && r.stdout.includes('"edit.pasteSvg"');
}

export async function renderDrawingsPdf(order: DrawingsOrder, opts: { cli?: string; template?: unknown } = {}): Promise<Buffer> {
  const cli = opts.cli || DRAWINGS_CLI_PATH();
  if (!cli) throw new DrawingsError('PDF-креслення вимкнені: не задано DESIGNCRAFT_DRAWINGS_PATH (DesignCraft 0.9.0 або новіший).', 503);
  if (!(await drawingsCliSupportsSvg(cli)))
    throw new DrawingsError('Цей DesignCraft не вміє вставляти SVG (потрібен 0.9.0 або новіший).', 503);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'table-drawings-'));
  try {
    const out = path.join(dir, 'drawings.pdf');
    const { steps } = buildDrawingsScript(order, undefined, { template: opts.template });
    const script = serializeScript(steps.map((s) => (s.command === 'file.exportPdf' ? { ...s, params: { ...s.params, path: out.replace(/\\/g, '/') } } : s)));
    const file = path.join(dir, 'drawings.dcs');
    await fs.writeFile(file, script, 'utf8');
    const r = await run(cli, ['script', file], dir);
    if (r.timedOut) throw new DrawingsError('DesignCraft не встиг скласти креслення.', 504);
    let report: { failedIndex?: number | null; failedCommand?: string | null; error?: string | null } = {};
    try { report = JSON.parse(r.stdout); } catch { /* нижче */ }
    if (r.code !== 0 || report.failedIndex !== undefined && report.failedIndex !== null)
      throw new DrawingsError(`DesignCraft: ${report.failedCommand ? report.failedCommand + ': ' : ''}${report.error || r.stderr.slice(0, 300) || 'невідома помилка'}`);
    return await fs.readFile(out);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

export const drawingsFileName = (order: DrawingsOrder) => `stil-${String(order.number).replace(/[^A-Za-z0-9_-]/g, '_')}-kreslennya.pdf`;

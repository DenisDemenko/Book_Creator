/**
 * Живий прогін плаваючого блока інструментів «Книга та текст» (запис #235).
 * Запуск: npm run live:tool-dock   (потрібен `npm run build`).
 *
 * Перевіряє в справжньому браузері те, що юніт-тест не бачить: над канвою
 * немає жодної кнопки; блок типово прилип згори й не накриває текст;
 * перетягування робить його вільним; вузька ширина — колонка; підведення до
 * правої панелі примагнічує (із підсвіченим краєм); кнопки магніту — ліворуч
 * і донизу; палітри нижнього блока відкриваються вгору; у розвороті UA | EN —
 * вибір колонки й мітки мов; згортання до шапки; стан переживає перезавантаження.
 *
 * Пастка (log.md #172): у page.evaluate — лише стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-tool-dock');
const PORT = Number(process.env.TOOL_DOCK_PORT || 34235);
const BASE = `http://localhost:${PORT}`;
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const SHOTS = path.join(ROOT, 'tmp', 'tool-dock');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-dock', email: 'dock@test.ua', name: 'Живий блок', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({ token: TOKEN, userId: 'u-dock', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString() });

const log: string[] = [];
const child = spawn(process.execPath, [path.join(ROOT, 'dist/server.mjs')], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), NODE_ENV: 'production', DATA_DIR: DIR, DATABASE_PATH: `${DIR}/nova-studio.db` },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (d) => log.push(String(d)));
child.stderr.on('data', (d) => log.push(String(d)));
process.on('exit', () => { try { child.kill(); } catch { /* */ } });
let up = false;
for (let i = 0; i < 120 && !up; i++) {
  try { up = (await fetch(`${BASE}/api/auth/status`)).ok; } catch { /* */ }
  if (!up) await new Promise((r) => setTimeout(r, 500));
}
if (!up) { console.error(log.join('').slice(-2000)); process.exit(1); }

const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) {
  console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).');
  child.kill();
  process.exit(1);
}
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});
const errors: string[] = [];
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setViewport({ width: 1600, height: 950 });
  await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.click('#nav-tab-editor');
  await page.waitForSelector('[data-editor-tool-dock]', { timeout: 30000 });
  await page.waitForSelector('#book-content-editor-ua', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1200));
  // Онбординг-тур відкривається сам і накриває кадр — закриваємо.
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, a')).find((e) => /Я вже в курсі/.test(e.textContent || '')) as HTMLElement | undefined;
    b?.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  const info = () =>
    page.evaluate(() => {
      const dock = document.querySelector('[data-editor-tool-dock]') as HTMLElement;
      const m = document.querySelector('main') as HTMLElement;
      const r = dock.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      const cs = getComputedStyle(m);
      const canvas = document.querySelector('#book-content-editor-ua') as HTMLElement | null;
      const cr = canvas?.getBoundingClientRect();
      return {
        dock: dock.dataset.dock,
        orientation: dock.dataset.orientation,
        rect: { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height },
        main: { l: mr.left, t: mr.top, r: mr.right, b: mr.bottom },
        pad: { t: parseFloat(cs.paddingTop), b: parseFloat(cs.paddingBottom), l: parseFloat(cs.paddingLeft), r: parseFloat(cs.paddingRight) },
        canvasTop: cr?.top ?? -1,
        canvasLeft: cr?.left ?? -1,
        canvasRight: cr?.right ?? -1,
        inBody: dock.parentElement === document.body,
        buttons: dock.querySelectorAll('button, select, input').length,
        tours: ['editor__1', 'editor__3', 'editor__4'].filter((k) => dock.querySelector(`[data-tour="${k}"]`)),
      };
    });

  // ── 1. Типовий стан: прилип згори, над текстом нічого іншого ─────────────
  let s = await info();
  t('блок існує й живе в body (портал)', s.inBody);
  t('типово прилип до верху поля тексту', s.dock === 'top', JSON.stringify(s.rect));
  t('горизонтальний рядок', s.orientation === 'horizontal');
  t('компактно: ≤ 4 рядки кнопок без окремого рядка шапки (≤ 160px)', s.rect.h <= 160, String(s.rect.h));
  t('на всю ширину поля тексту', Math.abs(s.rect.w - (s.main.r - s.main.l)) < 2, `${s.rect.w} vs ${s.main.r - s.main.l}`);
  t('поле звільнило місце згори (padding = висота блока + проміжок)', Math.abs(s.pad.t - (Math.ceil(s.rect.h) + 6)) <= 1, `${s.pad.t} vs ${s.rect.h}`);
  t('текст починається НИЖЧЕ блока (блок не накриває канву)', s.canvasTop >= s.rect.b, `canvas ${s.canvasTop} / dock bottom ${s.rect.b}`);
  t('у блоці всі елементи керування (≥ 40)', s.buttons >= 40, String(s.buttons));
  t('точки онбордингу editor__1/3/4 — у блоці', s.tours.length === 3, s.tours.join(','));
  const aboveCanvas = await page.evaluate(() => {
    const m = document.querySelector('main') as HTMLElement;
    const canvas = document.querySelector('#book-content-editor-ua') as HTMLElement;
    const top = canvas.getBoundingClientRect().top;
    // Будь-який елемент керування всередині <main> вище за канву — це смуга, якої не має бути.
    return Array.from(m.querySelectorAll('button, select, input')).filter((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return r.height > 0 && r.bottom <= top;
    }).length;
  });
  t('у <main> над канвою — жодної кнопки/поля', aboveCanvas === 0, String(aboveCanvas));
  await page.screenshot({ path: path.join(SHOTS, '1-docked-top.png') });

  // ── 2. Перетягнути в середину — вільне вікно поверх канви ──────────────
  const header = async () => {
    const r = await page.evaluate(() => {
      const h = document.querySelector('[data-editor-tool-dock] > div') as HTMLElement;
      const b = h.getBoundingClientRect();
      return { x: b.left + Math.min(40, b.width / 2), y: b.top + 10 };
    });
    return r;
  };
  let h = await header();
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + 200, h.y + 150, { steps: 8 });
  await page.mouse.move(h.x + 400, h.y + 300, { steps: 8 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  s = await info();
  t('після перетягування в середину — вільний', s.dock === 'float', s.dock);
  t('вільний блок не резервує місця', s.pad.t === 0 && s.pad.b === 0 && s.pad.l === 0 && s.pad.r === 0, JSON.stringify(s.pad));
  t('вільний блок компактний (≤ 760)', s.rect.w <= 761, String(s.rect.w));
  t('вільний блок лежить поверх канви', s.rect.t > s.main.t + 50);
  await page.screenshot({ path: path.join(SHOTS, '2-floating.png') });

  // ── 3. Змінити ширину — вузький блок стає колонкою ─────────────────────
  const rh = await page.evaluate(() => {
    const d = document.querySelector('[data-editor-tool-dock]') as HTMLElement;
    const b = d.getBoundingClientRect();
    return { x: b.right - 2, y: b.top + 60 };
  });
  await page.mouse.move(rh.x, rh.y);
  await page.mouse.down();
  await page.mouse.move(rh.x - 300, rh.y, { steps: 10 });
  await page.mouse.move(rh.x - 520, rh.y, { steps: 10 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  s = await info();
  t('ширину змінено перетягуванням краю', s.rect.w < 420, String(s.rect.w));
  t('вузький блок — вертикальна колонка', s.orientation === 'vertical');
  t('ширина не менша за мінімальну (176)', s.rect.w >= 176, String(s.rect.w));
  await page.screenshot({ path: path.join(SHOTS, '3-narrow-column.png') });

  // ── 4. Піднести до правої панелі — примагнічується праворуч ─────────────
  h = await header();
  s = await info();
  const toRight = s.main.r - s.rect.r;
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x + toRight / 2, h.y + 5, { steps: 8 });
  await page.mouse.move(h.x + toRight - 10, h.y + 10, { steps: 8 });
  const previewShown = await page.evaluate(() => !!document.querySelector('[aria-hidden="true"].fixed.rounded-full'));
  t('під час підведення видно підсвічений край (попередній показ)', previewShown);
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 400));
  s = await info();
  t('прилип праворуч (до правої панелі)', s.dock === 'right', s.dock);
  t('правий край блока = правий край поля (межа правої панелі)', Math.abs(s.rect.r - s.main.r) < 2, `${s.rect.r} vs ${s.main.r}`);
  t('поле звільнило місце праворуч', s.pad.r > 150 && s.pad.l === 0, JSON.stringify(s.pad));
  t('текст не заходить під блок', s.canvasRight <= s.rect.l + 1, `${s.canvasRight} vs ${s.rect.l}`);
  await page.screenshot({ path: path.join(SHOTS, '4-docked-right.png') });

  // ── 5. Кнопки магніту: ліворуч і знизу ─────────────────────────────────
  const dockVia = async (edge: string) => {
    await page.click('[data-tool-dock-menu]');
    await page.click(`[data-tool-dock-edge="${edge}"]`);
    await new Promise((r) => setTimeout(r, 400));
  };
  await dockVia('left');
  s = await info();
  t('кнопкою — ліворуч (до меню студії)', s.dock === 'left' && Math.abs(s.rect.l - s.main.l) < 2);
  t('поле звільнило місце ліворуч', s.pad.l > 150 && s.canvasLeft >= s.rect.r - 1, JSON.stringify(s.pad));
  await page.screenshot({ path: path.join(SHOTS, '5-docked-left.png') });

  await dockVia('bottom');
  s = await info();
  const vh = await page.evaluate(() => window.innerHeight);
  t('кнопкою — донизу (низ поля або низ вікна)', s.dock === 'bottom' && Math.abs(s.rect.b - Math.min(s.main.b, vh)) < 2, `${s.rect.b} / main ${s.main.b} / vh ${vh}`);
  t('поле звільнило місце знизу, включно з частиною за краєм вікна', Math.abs(s.pad.b - (Math.ceil(s.rect.h) + 6 + Math.max(0, Math.round(s.main.b - vh)))) <= 1, `${s.pad.b}`);
  const lastLineVisible = await page.evaluate(() => {
    const m = document.querySelector('main') as HTMLElement;
    const d = document.querySelector('[data-editor-tool-dock]') as HTMLElement;
    const canvas = m.querySelector('.flex-1.min-h-0.bg-slate-950') as HTMLElement;
    return canvas.getBoundingClientRect().bottom <= d.getBoundingClientRect().top + 1;
  });
  t('поле тексту закінчується над нижнім блоком', lastLineVisible);
  // Палітра кольору в нижньому блоці відкривається вгору, а не за край вікна.
  const colorBtn = await page.$('[data-editor-tool-dock] button[aria-label="Колір тексту"], [data-editor-tool-dock] button[title*="Колір"]');
  if (colorBtn) {
    await colorBtn.click();
    await new Promise((r) => setTimeout(r, 250));
    const pal = await page.evaluate(() => {
      const p = document.querySelector('[data-editor-tool-dock] .grid.grid-cols-6') as HTMLElement | null;
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, vh: window.innerHeight };
    });
    t('палітра нижнього блока відкривається вгору й видима', !!pal && pal.bottom <= pal.vh && pal.top >= 0, JSON.stringify(pal));
    await page.screenshot({ path: path.join(SHOTS, '6-bottom-palette.png') });
    await colorBtn.click();
  } else {
    t('кнопку кольору знайдено в блоці', false);
  }

  // ── 6. Розворот UA | EN: одна панель форматування, вибір колонки ────────
  await dockVia('top');
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[data-tour="editor__3"] button')) as HTMLElement[];
    btns[1]?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const par = await page.evaluate(() => {
    const d = document.querySelector('[data-editor-tool-dock]') as HTMLElement;
    const target = Array.from(d.querySelectorAll('button')).filter((b) => /UA$|EN$/.test((b.textContent || '').trim()) && b.getAttribute('aria-pressed') !== null);
    const badges = Array.from(document.querySelectorAll('main span.pointer-events-none')).map((e) => (e.textContent || '').trim());
    return { targets: target.map((b) => (b.textContent || '').trim()), badges, enTitle: !!d.querySelector('input[aria-label="Section Title (EN)"]') };
  });
  t('у розвороті є перемикач колонки UA/EN у блоці', par.targets.length === 2, par.targets.join(','));
  t('колонки підписано мітками замість шапок', par.badges.some((b) => b.includes('UA')) && par.badges.some((b) => b.includes('EN')), par.badges.join(','));
  t('назва розділу EN — у блоці', par.enTitle);
  await page.screenshot({ path: path.join(SHOTS, '7-parallel.png') });

  // ── 7. Згорнути блок до шапки ──────────────────────────────────────────
  const minBtn = await page.$('[data-editor-tool-dock] > div button[aria-label="Згорнути блок"]');
  await minBtn?.click();
  await new Promise((r) => setTimeout(r, 300));
  s = await info();
  t('згорнутий блок — лише шапка (< 40px)', s.rect.h < 40, String(s.rect.h));
  t('резерв зменшився до шапки', s.pad.t < 50, String(s.pad.t));
  await page.screenshot({ path: path.join(SHOTS, '8-minimized.png') });

  // ── 8. Стан переживає перезавантаження ─────────────────────────────────
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
  await page.click('#nav-tab-editor');
  await page.waitForSelector('[data-editor-tool-dock]', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  s = await info();
  t('після перезавантаження — той самий край і згорнутість', s.dock === 'top' && s.rect.h < 40, `${s.dock} ${s.rect.h}`);

  t('жодної помилки сторінки', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  child.kill();
}
console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
process.exit(fail ? 1 : 0);

/**
 * Живий прогін: сутності ядра в тренажерах майстерності (запис #237).
 * Запуск: npm run live:mastery-entities   (потрібен `npm run build`).
 *
 * Перевіряє в справжньому браузері: у тренажері «Персонажі та взаємодія»
 * вправи мають панель сутностей; клік по сутності вставляє тег у робоче поле
 * й рахується як розмітка; ШІ-коуч отримує сутності вправи (запит
 * перехоплюється — мережі до моделі не треба) і його розбір розмітки
 * показується; пікер абзаців книги знаходить абзаци з тегами сутностей
 * тренажера й вставляє їх одним кліком.
 *
 * Пастка (log.md #172): у page.evaluate — лише рядки або стрілкові функції.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIR = path.join(os.tmpdir(), 'nova-mastery-entities');
const PORT = Number(process.env.MASTERY_ENTITIES_PORT || 34237);
const BASE = `http://localhost:${PORT}`;
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
const SHOTS = path.join(ROOT, 'tmp', 'mastery-entities');
fs.mkdirSync(SHOTS, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-mastery', email: 'mastery@test.ua', name: 'Тренажер', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(32).toString('hex');
await createSession({ token: TOKEN, userId: 'u-mastery', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400_000).toISOString() });

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
  if (!up) await sleep(500);
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
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });

// Запит до ШІ-коуча перехоплюється: перевіряємо, ЩО йде на сервер, а відповідь
// підставляємо — модель у прогоні не потрібна.
let coachBody: any = null;
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.url().includes('/api/ai/coach-feedback')) {
    try { coachBody = JSON.parse(req.postData() || '{}'); } catch { coachBody = {}; }
    req.respond({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        score: 88, summary: 'Тест', strengths: ['a'], improvements: ['b'], criteriaFeedback: [], rewrittenExample: '', tip: '',
        entityFeedback: [
          { slug: 'character', used: true, comment: 'тег на місці' },
          { slug: 'goal', used: false, comment: 'позначте мету' },
        ],
      }),
    });
    return;
  }
  req.continue();
});

const clickByText = (selector: string, re: RegExp) =>
  page.evaluate((sel, src) => {
    const rx = new RegExp(src);
    const el = Array.from(document.querySelectorAll(sel)).find((e) => rx.test((e.textContent || '').trim())) as HTMLElement | undefined;
    el?.click();
    return !!el;
  }, selector, re.source);

console.log('\nКнига: абзаци з тегами сутностей');
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#nav-tab-editor', { timeout: 40000 });
await page.click('#nav-tab-editor');
await page.waitForSelector('#book-content-editor-ua .ProseMirror', { timeout: 30000 });
await sleep(1500);
await clickByText('button,a', /Я вже в курсі/);
await page.evaluate(`(() => {
  const ed = document.querySelector('#book-content-editor-ua .ProseMirror').editor;
  ed.commands.insertContentAt(1, [
    { type: 'paragraph', content: [{ type: 'text', text: '[/character:Олена] Олена зачинила двері лабораторії й довго не вмикала світла.' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '[/relationship:Олена і Сварог — недовіра] — Ти знову стежиш за мною? — спитала вона.' }] },
  ]);
})()`);
await sleep(3500);
t('теги вставлено в канву', await page.evaluate(() => /\[\/relationship:/.test((document.querySelector('#book-content-editor-ua') as HTMLElement).innerText)));

console.log('\nТренажер «Персонажі та взаємодія»');
await page.click('#nav-tab-mastery');
await sleep(2500);
t('картка навички знайдена', await clickByText('div.cursor-pointer', /^03.*Персонажі та взаємодія/s));
await sleep(1200);
t('вкладка тренажера відкрита', await clickByText('button', /AI Тренажер/));
await sleep(1000);
const exCount = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => /^Вправа #\d+$/.test((b.textContent || '').trim())).length);
t('дві вправи: наявна + нова для сутностей', exCount === 2, String(exCount));
const chips1 = await page.$$eval('[data-entity-chip]', (els) => els.map((e) => e.getAttribute('data-entity-chip')));
t('вправа #1 має 4 сутності', chips1.join(',') === 'character,value,decision,character-state', chips1.join(','));

await clickByText('button', /^Вправа #2$/);
await sleep(500);
const chips2 = await page.$$eval('[data-entity-chip]', (els) => els.map((e) => e.getAttribute('data-entity-chip')));
t('вправа #2 — 8 сутностей персонажа', chips2.length === 8 && chips2.includes('goal') && chips2.includes('character-arc'), chips2.join(','));
t('лічильник на старті — 0 з 8', (await page.$eval('[data-exercise-entities-count]', (e) => e.textContent || '')).includes('0 з 8'));

await page.click('[data-entity-chip="character"]');
await sleep(300);
await page.keyboard.type('Андрій');
await sleep(300);
const draft = await page.$eval('textarea[data-trainer-draft]', (e) => (e as HTMLTextAreaElement).value);
t('клік по сутності вставив тег, курсор — перед «]»', draft.includes('[/character:Андрій]'), JSON.stringify(draft));
t('сутність позначено розміченою', (await page.$eval('[data-entity-chip="character"]', (e) => e.getAttribute('data-entity-used'))) === '1');
t('лічильник — 1 з 8', (await page.$eval('[data-exercise-entities-count]', (e) => e.textContent || '')).includes('1 з 8'));

await page.focus('textarea[data-trainer-draft]');
await page.keyboard.down('Control');
await page.keyboard.press('End');
await page.keyboard.up('Control');
await page.keyboard.type(' стояв біля вікна. [/персонаж:Андрій] вагався.');
await sleep(300);
t('український ключ, набраний руками, теж рахується', (await page.$eval('[data-exercise-entities-count]', (e) => e.textContent || '')).includes('1 з 8'));
await page.screenshot({ path: path.join(SHOTS, 'exercise-entities.png') });

console.log('\nШІ-коуч');
await clickByText('button', /Отримати розбір AI Coach/);
await sleep(1500);
t('коуч отримав сутності вправи', Array.isArray(coachBody?.exerciseEntities) && coachBody.exerciseEntities.length === 8, JSON.stringify(coachBody?.exerciseEntities?.map((e: any) => e.slug)));
t('коуч отримав крок розмітки', typeof coachBody?.entityStep === 'string' && coachBody.entityStep.includes('[/goal:'));
const fbRows = await page.$$eval('[data-entity-feedback] .neo-pressed-soft', (els) => els.map((e) => (e.textContent || '').trim()));
t('розбір розмітки показано', fbRows.length === 2 && /Персонаж — тег на місці/.test(fbRows[0]), fbRows.join(' | '));

console.log('\nАбзаци книги з сутностями тренажера');
const sectionPicked = await page.evaluate(() => {
  const sel = Array.from(document.querySelectorAll('select')).find((s) => Array.from(s.options).some((o) => /Оберіть розділ/.test(o.text))) as HTMLSelectElement | undefined;
  if (!sel || sel.options.length < 2) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  setter.call(sel, sel.options[1].value);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
});
t('розділ книги обрано в пікері', sectionPicked);
await sleep(800);
const tagBtn = await page.$('[data-select-entity-paragraphs]');
const tagBtnText = tagBtn ? await page.evaluate((e) => e.textContent || '', tagBtn) : '';
t('кнопка «З сутностями тренажера» знайшла 2 абзаци', /\(2\)/.test(tagBtnText), tagBtnText);
await tagBtn?.click();
await sleep(400);
const badges = await page.$$eval('[data-paragraph-entities]', (els) => els.map((e) => e.getAttribute('data-paragraph-entities')));
t('абзаци позначено сутностями', badges.join('|') === 'character|relationship', badges.join('|'));
await clickByText('button', /Вставити в тренажер/);
await sleep(500);
const inserted = await page.$eval('textarea[data-trainer-draft]', (e) => (e as HTMLTextAreaElement).value);
t('обрані абзаци з тегами — у робочому полі', inserted.includes('[/character:Олена]') && inserted.includes('[/relationship:'), inserted.slice(0, 120));
t('лічильник рахує теги з книги (персонаж + стосунки)', (await page.$eval('[data-exercise-entities-count]', (e) => e.textContent || '')).includes('2 з 8'));
await page.screenshot({ path: path.join(SHOTS, 'book-paragraphs.png') });

console.log('\nІнші тренажери');
await page.keyboard.press('Escape');
await sleep(500);
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#nav-tab-mastery', { timeout: 40000 });
await page.click('#nav-tab-mastery');
await sleep(2500);
t('картка «Практична цінність» знайдена', await clickByText('div.cursor-pointer', /^06.*Практична цінність/s));
await sleep(1000);
await clickByText('button', /AI Тренажер/);
await sleep(800);
const ex6 = await page.evaluate(() => Array.from(document.querySelectorAll('button')).filter((b) => /^Вправа #\d+$/.test((b.textContent || '').trim())).length);
t('«Практична цінність» — 4 вправи (курс, інструкція, квест)', ex6 === 4, String(ex6));
await clickByText('button', /^Вправа #4$/);
await sleep(400);
const chips6 = await page.$$eval('[data-entity-chip]', (els) => els.length);
t('вправа «Квест» — 12 ігрових сутностей', chips6 === 12, String(chips6));

await browser.close();
child.kill();
console.log(`\nСкриншоти: tmp/mastery-entities/\n\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

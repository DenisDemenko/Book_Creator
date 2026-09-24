/**
 * Живий прогін трьох ролей AI в адмінці (Т0.9, журнал #250).
 * Запуск: npm run live:core-ai-roles   (потрібен зібраний dist/server.mjs).
 *
 * Адміністратор відкриває «Ядро AI (адмін)» і бачить три ролі окремими
 * модулями з описами; через API прив'язує кожній роль свою модель; моделі без
 * зору AI-3 не отримує.
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
const DIR = path.join(os.tmpdir(), 'nova-core-ai-roles');
const PORT = Number(process.env.CORE_AI_ROLES_PORT || 34250);
const BASE = `http://localhost:${PORT}`;
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const { initStore, saveUser, createSession } = await import('../server/store');
await initStore();
await saveUser({ id: 'u-admin', email: 'admin-roles@test.ua', name: 'Адмін', role: 'admin', createdAt: new Date().toISOString() } as any);
const TOKEN = crypto.randomBytes(24).toString('hex');
await createSession({ token: TOKEN, userId: 'u-admin', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() });
const H = { Cookie: `nova_session=${TOKEN}`, 'Content-Type': 'application/json' };

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

console.log('\nAPI прив\'язки «модуль → модель»:');
const list = await (await fetch(`${BASE}/api/ai/core-module-models`, { headers: H })).json();
t('три ролі — у переліку модулів ядра', ['coreAi1Classify', 'coreAi2Analysis', 'coreAi3Visual'].every((m) => list.modules?.includes(m)), `${list.modules?.length} модулів`);
const put = (module: string, modelId: string | null) =>
  fetch(`${BASE}/api/ai/core-module-models`, { method: 'PUT', headers: H, body: JSON.stringify({ module, modelId }) });
await put('coreAi1Classify', 'deepseek-v4-pro');
await put('coreAi2Analysis', 'claude-sonnet-5');
const visionBad = await put('coreAi3Visual', 'deepseek-v4-pro');
const visionBadBody = await visionBad.json();
await put('coreAi3Visual', 'gemini-3.7-flash');
const after = await (await fetch(`${BASE}/api/ai/core-module-models`, { headers: H })).json();
t('кожна роль має свою модель', after.models?.coreAi1Classify === 'deepseek-v4-pro' && after.models?.coreAi2Analysis === 'claude-sonnet-5' && after.models?.coreAi3Visual === 'gemini-3.7-flash', JSON.stringify(after.models));
t('AI-3 не можна віддати моделі без зору', visionBad.status === 400 && visionBadBody.kind === 'vision_unsupported');

console.log('\nВкладка «Ядро AI (адмін)»:');
const puppeteer = (await import('puppeteer-core')).default;
const CHROME = [
  process.env.CHROMIUM_PATH,
  process.env.PUPPETEER_EXECUTABLE_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.error('Не знайдено Chrome/Chromium (CHROMIUM_PATH).'); child.kill(); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
await browser.setCookie({ name: 'nova_session', value: TOKEN, domain: 'localhost', path: '/' });
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#quick-ai-btn', { timeout: 40000 });
await sleep(1500);
await page.click('#quick-ai-btn');
await sleep(1200);
const clickByText = (text: string) =>
  page.evaluate((s: string) => {
    const b = Array.from(document.querySelectorAll('button')).find((e) => (e.textContent || '').trim() === s) as HTMLElement | undefined;
    b?.click();
    return !!b;
  }, text);
t('вкладка адміна відкривається', await clickByText('Ядро AI (адмін)'));
await sleep(1500);
const labels = ['Ядро · AI-1 класифікація', 'Ядро · AI-2 спеціалізований аналіз', 'Ядро · AI-3 візуальний аналіз'];
const present = await page.evaluate((ls: string[]) => ls.map((l) => Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === l)), labels);
t('три ролі — окремими модулями', present.every(Boolean), present.join());
await clickByText('Ядро · AI-3 візуальний аналіз');
await sleep(800);
const text = await page.evaluate(() => document.body.innerText);
t('опис ролі AI-3 і модель ролі видно', /Потрібна модель із зором/.test(text) && /Gemini 3\.7 Flash|gemini-3\.7-flash/.test(text));
await page.screenshot({ path: path.join(DIR, 'core-ai-roles.png') });
console.log(`  (знімок: ${path.join(DIR, 'core-ai-roles.png')})`);

await browser.close();
child.kill();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) { console.log(log.join('').slice(-2000)); process.exit(1); }

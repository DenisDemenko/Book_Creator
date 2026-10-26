/**
 * Живий прогін інтерфейсу «Власний шаблон і фон блоків» у справжньому браузері (Chromium/Playwright).
 * Не входить у `npm test` (потрібен браузер): запуск `npx tsx scripts/live-templateWorkshop.mts`.
 * API-запити обслуговує сам скрипт: імпорт — справжній `importDesigncraftTemplate`, копія — підробний рушій.
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import JSZip from 'jszip';
import { build } from 'esbuild';
import { importDesigncraftTemplate, TemplateImportError } from '../server/pdf/designcraft/templateImport';
import { buildDesigncraftParagraphStyles } from '../server/pdf/designcraft/styleCommands';
import { DEFAULT_LAYOUT_SPEC } from '../server/pdf/pdfTypes';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-'));
fs.writeFileSync(path.join(tmp, 'entry.tsx'), `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TemplateWorkshop } from '${path.resolve('src/components/publication/TemplateWorkshop').replace(/\\/g, '/')}';
const start: any = { id: 'B1', title: 'Т', layoutConfig: { bookDesignThemeId: 'classic' } };
function App() {
  const [book, setBook] = useState<any>(start);
  (window as any).__book = book;
  return <TemplateWorkshop book={book} activeThemeId="classic" onUpdateBook={(b: any) => setBook(b)} />;
}
createRoot(document.getElementById('root')!).render(<App />);
`);
await build({ nodePaths: [path.resolve('node_modules')], entryPoints: [path.join(tmp, 'entry.tsx')], bundle: true, outfile: path.join(tmp, 'bundle.js'), format: 'iife', jsx: 'automatic', loader: { '.tsx': 'tsx' }, logLevel: 'error', define: { 'process.env.NODE_ENV': '"development"' } });

// «Файл, збережений у DesignCraft»
const spec: any = { ...DEFAULT_LAYOUT_SPEC, themeId: 'classic' };
const styles = buildDesigncraftParagraphStyles(spec, ['Quote', 'Letter']) as any[];
styles.find((s) => s.name === 'Body').chars.size = 13;
Object.assign(styles.find((s) => s.name === 'Quote').para, { shadingOn: true, shadingColor: 'BookDesign DFF1E6', shadingTint: 1 });
styles.find((s) => s.name === 'Quote').chars.fontFamily = 'Source Serif 4';
const zip = new JSZip();
zip.file('mimetype', 'application/vnd.designcraft+zip');
zip.file('document.json', JSON.stringify({ title: 'Зразок', styles: { paragraph: styles }, swatches: [{ name: 'BookDesign DFF1E6', value: { kind: 'color', color: { model: 'rgb', r: 0.87, g: 0.95, b: 0.9 } } }] }));
const savedFile = path.join(tmp, 'moj-shablon.designcraft');
fs.writeFileSync(savedFile, await zip.generateAsync({ type: 'nodebuffer' }));

const calls: string[] = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><meta charset=utf-8><body style="background:#0f172a;color:#cbd5e1;font:13px sans-serif"><div id=root></div><script src=/bundle.js></script>'); }
  if (url.pathname === '/bundle.js') { res.setHeader('content-type', 'text/javascript'); return res.end(fs.readFileSync(path.join(tmp, 'bundle.js'))); }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  calls.push(`${req.method} ${url.pathname}${url.search}`);
  if (url.pathname === '/api/pdf/designcraft/template-copy') { res.setHeader('content-type', 'application/vnd.designcraft'); return res.end(Buffer.from([80, 75, 3, 4])); }
  if (url.pathname === '/api/pdf/designcraft/template-import') {
    try {
      const out = await importDesigncraftTemplate(body, { basedOn: url.searchParams.get('basedOn') as any, name: url.searchParams.get('name') || '' });
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify(out));
    } catch (e) {
      res.statusCode = 400; res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ error: e instanceof TemplateImportError ? e.message : String(e) }));
    }
  }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => server.listen(0, () => r()));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
const errors: string[] = [];
page.on('pageerror', (e: Error) => errors.push(e.message));
await page.goto(base);
await page.waitForSelector('[data-template-workshop]');
const book = () => page.evaluate(() => (window as any).__book);

console.log('\nКопія шаблону');
const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-template-copy-btn]')]);
t('кнопка віддає файл shablon-classic.designcraft', download.suggestedFilename() === 'shablon-classic.designcraft', download.suggestedFilename());
t('запит пішов із шаблоном classic', calls.some((c) => c === 'POST /api/pdf/designcraft/template-copy'));

console.log('\nКористувацький шаблон');
await page.fill('input[placeholder^="Назва шаблону"]', 'Мій книжковий');
await page.setInputFiles('[data-template-file]', savedFile);
await page.waitForSelector('[data-template-result]');
const resultText = await page.textContent('[data-template-result]');
t('показано, скільки стилів прочитано, і пояснення про чужий шрифт', /Прочитано стилів/.test(resultText || '') && /Source Serif 4/.test(resultText || ''), (resultText || '').replace(/\s+/g, ' ').slice(0, 140));
t('до застосування книга не змінилась', !(await book()).layoutConfig.customDesignTheme);
await page.click('[data-template-apply]');
await page.waitForSelector('[data-custom-template-active]');
const applied = (await book()).layoutConfig.customDesignTheme;
t('шаблон застосовано до книги: назва, основа, Body 13 pt', applied?.name === 'Мій книжковий' && applied.basedOn === 'classic' && applied.entities.body.fontSizePt === 13, JSON.stringify(applied?.entities?.body));
t('шаблон потрапив у список власних тем книги (як у Designer Mode)', await page.evaluate(() => JSON.parse(localStorage.getItem('book-design-studio:custom-themes:B1') || '[]').length === 1));
await page.click('[data-custom-template-remove]');
await page.waitForFunction(() => !(window as any).__book.layoutConfig.customDesignTheme);
t('«Повернути» прибирає власний шаблон; вбудований лишається', (await book()).layoutConfig.bookDesignThemeId === 'classic');

console.log('\nПомилка файла');
fs.writeFileSync(path.join(tmp, 'bad.designcraft'), 'це не архів');
await page.setInputFiles('[data-template-file]', path.join(tmp, 'bad.designcraft'));
await page.waitForSelector('[data-template-error]');
t('зрозуміле повідомлення, а не крах', /не файл DesignCraft/.test((await page.textContent('[data-template-error]')) || ''));

console.log('\nФон блоків');
const row = (id: string) => `[data-block-bg-row="${id}"]`;
await page.click(`${row('Quote')} [data-block-bg-color="#DDEBF7"]`);
let bg = (await book()).layoutConfig.blockBackgrounds;
t('колір із палітри записується в книгу', bg?.Quote?.color === '#DDEBF7' && bg.Quote.opacity === 1, JSON.stringify(bg));
await page.selectOption(`${row('Quote')} [data-block-bg-opacity]`, '0.6');
t('насиченість 60%', (await book()).layoutConfig.blockBackgrounds.Quote.opacity === 0.6);
await page.click(`${row('ChatMessage')} [data-block-bg-none]`);
t('«без фону» зберігається як color:null', (await book()).layoutConfig.blockBackgrounds.ChatMessage.color === null);
await page.fill(`${row('Letter')} [data-block-bg-custom]`, '#ff8800').catch(async () => {
  await page.$eval(`${row('Letter')} [data-block-bg-custom]`, (el: any) => { el.value = '#ff8800'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
});
t('свій колір (HEX) записується у верхньому регістрі', (await book()).layoutConfig.blockBackgrounds.Letter?.color === '#FF8800');
await page.click(`${row('Quote')} [data-block-bg-default]`);
bg = (await book()).layoutConfig.blockBackgrounds;
t('«за шаблоном» прибирає опцію цього блоку, решта лишається', !bg.Quote && bg.ChatMessage && bg.Letter);
await page.click('[data-block-bg-reset]');
t('«Скинути всі» прибирає ключ повністю', (await book()).layoutConfig.blockBackgrounds === undefined);
t('фон блоків не стирає вибраний шаблон', (await book()).layoutConfig.bookDesignThemeId === 'classic');

await page.screenshot({ path: path.join(tmp, 'workshop.png'), fullPage: true });
console.log('скріншот:', path.join(tmp, 'workshop.png'));
t('жодної помилки в консолі сторінки', errors.length === 0, errors.join(' | '));
console.log('\nКнопка «Відкрити лише DesignCraft»');
{
  const href = await page.getAttribute('[data-open-designcraft-only]', 'href');
  t('кнопка є й веде на режим без Claude Code', href === 'designcraft-studio://open?mode=designcraft', String(href));
  await page.click('[data-open-designcraft-only]').catch(() => {});
  await page.waitForSelector('[data-only-silent], [data-only-sent]', { timeout: 6000 }).catch(() => {});
  t('без обробника посилання через 3 с — підказка поставити/оновити інсталятор', (await page.locator('[data-only-silent]').count()) === 1);
}

await browser.close();
server.close();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало.`);
if (fail) process.exit(1);

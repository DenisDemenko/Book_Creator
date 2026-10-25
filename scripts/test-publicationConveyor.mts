/**
 * «Верстка для публікації»: шаблони → точний PDF DesignCraft → чернетка для графічного
 * редактора → повернення результату. Запуск: npm run test:publication-conveyor
 *
 * Що доводить тест (з бінарником DesignCraft; без нього — пропускає залежні перевірки):
 *  1. Шаблон із книги доходить до DesignCraft: точний PDF верстається темою книги, а різні
 *     шаблони дають різну верстку (раніше тема в точний PDF не передавалась узагалі).
 *  2. Усі шаблони каталогу верстаються без помилок.
 *  3. EPUB/HTML доступні письменнику (не адміну) через /api/pdf/companion.
 *  4. Чернетка `.designcraft` — та сама верстка: її відкриває сам DesignCraft і експортує
 *     PDF з тією самою кількістю сторінок; вона лягає артефактом книги з ревізією.
 *  5. Скрипт (токен з коду підключення) отримує чернетку й повертає результат; після зміни
 *     книги результат позначається застарілим. Чуже — 404, сміття — 400.
 */
const DIR = '/tmp/nova-publication-conveyor';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

let pass = 0;
let fail = 0;
let skipped = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};
const skip = (n: string, why: string) => {
  skipped++;
  console.log(`  — ${n} — пропущено: ${why}`);
};

// Бінарник визначається ДО імпорту рушія (див. test-designcraftCompanionRoute.mts).
const LOCAL_CLI = 'D:/Rama/designcraft/target/release/designcraft-cli.exe';
const envCli = process.env.DESIGNCRAFT_PATH;
const cli = envCli === '' ? undefined : envCli && fs.existsSync(envCli) ? envCli : fs.existsSync(LOCAL_CLI) ? LOCAL_CLI : undefined;
if (cli) process.env.DESIGNCRAFT_PATH = cli;
const realCli = process.env.DESIGNCRAFT_REAL_PATH && fs.existsSync(process.env.DESIGNCRAFT_REAL_PATH) ? process.env.DESIGNCRAFT_REAL_PATH : cli;

const db = await import('../server/db');
await db.initDb();
const storeMod = await import('../server/store');
const bookStore = await import('../server/bookStore');
const { registerPdfRoutes } = await import('../server/pdfRoutes');
const external = await import('../server/external/externalApiRoutes');
const { initialBook } = await import('../src/data/initialBook');
const { BOOK_DESIGN_THEME_CARDS } = await import('../src/data/bookDesignThemeCatalog');

const now = new Date().toISOString();
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', createdAt: now } as any);
await storeMod.saveUser({ id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', createdAt: now } as any);
const users: Record<string, any> = {
  'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', isGuest: false },
  'u-b': { id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', isGuest: false },
};
const GUEST = { id: null, role: 'guest', isGuest: true };

const app = express();
app.use(express.json({ limit: '40mb' }));
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : GUEST;
  next();
});
external.registerExternalApiRoutes(app, { recognize: async () => ({ text: '', modelId: 'x' }) });
registerPdfRoutes(app, {
  resolveEngine: () => 'claude',
  loadAdminLayer: async () => ({}) as never,
  generateText: async () => ({ text: '{}' }),
} as any);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;

async function call(method: string, p: string, opts: { session?: string; token?: string; body?: unknown; raw?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.raw) {
    headers['content-type'] = headers['content-type'] || 'application/octet-stream';
    body = opts.raw;
  } else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(base + p, { method, headers, body });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(buf.toString('utf8'));
  } catch {
    /* бінарна відповідь */
  }
  return { status: res.status, headers: res.headers, buf, json };
}

function bookWith(themeId?: string, legacy?: 'classic' | 'editorial') {
  const book: any = JSON.parse(JSON.stringify(initialBook));
  book.id = 'TEST-PUBLICATION-1';
  book.title = 'Тестова книга верстки';
  if (themeId) book.layoutConfig.bookDesignThemeId = themeId;
  if (legacy) book.layoutConfig.designTheme = legacy;
  return book;
}
const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
/** Текст сторінок без мінливих байтів PDF (дата створення тощо). */
function pdfFonts(buf: Buffer): string {
  const f = path.join(DIR, `fonts-${sha(buf).slice(0, 8)}.pdf`);
  fs.writeFileSync(f, buf);
  try {
    return execFileSync('pdffonts', [f]).toString();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
console.log('\nШаблон книги доходить до точного PDF DesignCraft');
if (!cli) {
  skip('тема з книги в точному PDF', 'бінарника DesignCraft немає');
} else {
  const classic = await call('POST', '/api/pdf/author-preview', { session: 'u-a', body: { book: bookWith('studio-classic'), engineId: 'designcraft', format: 'digital' } });
  const scifi = await call('POST', '/api/pdf/author-preview', { session: 'u-a', body: { book: bookWith('sci-fi'), engineId: 'designcraft', format: 'digital' } });
  t('Studio Classic — 200 PDF', classic.status === 200 && classic.buf.subarray(0, 5).toString('latin1') === '%PDF-', String(classic.status));
  t('Sci-Fi — 200 PDF', scifi.status === 200, String(scifi.status));
  const fc = pdfFonts(classic.buf);
  const fs2 = pdfFonts(scifi.buf);
  if (fc && fs2) {
    t('Sci-Fi верстає заголовки гротеском (DejaVu Sans), Studio Classic — ні', /DejaVuSans-Bold/.test(fs2) && !/DejaVuSans-Bold/.test(fc), 'шрифти PDF');
  } else {
    skip('порівняння шрифтів', 'немає pdffonts');
  }
  const legacy = await call('POST', '/api/pdf/author-preview', { session: 'u-a', body: { book: bookWith(undefined, 'editorial'), engineId: 'designcraft', format: 'digital' } });
  t('стара книга з «Редакційним» отримує Studio Editorial, а не падає', legacy.status === 200, String(legacy.status));
  const explicitTheme = await call('POST', '/api/pdf/author-preview', { session: 'u-a', body: { book: bookWith('studio-classic'), engineId: 'designcraft', theme: 'sci-fi' } });
  const explicitFonts = pdfFonts(explicitTheme.buf);
  if (explicitFonts) {
    t('явна тема в запиті має пріоритет над книгою (перегляд теми)', /DejaVuSans-Bold/.test(explicitFonts));
  } else {
    t('явна тема в запиті повертає PDF', explicitTheme.status === 200 && explicitTheme.buf.subarray(0, 5).toString('latin1') === '%PDF-', String(explicitTheme.status));
    skip('пріоритет явної теми над книгою (за шрифтами)', 'немає pdffonts');
  }
}

// ---------------------------------------------------------------------------
console.log('\nУсі шаблони каталогу верстаються');
if (!cli) {
  skip('усі шаблони', 'бінарника DesignCraft немає');
} else {
  const failed: string[] = [];
  const pages: Record<string, number> = {};
  for (const card of BOOK_DESIGN_THEME_CARDS) {
    const r = await call('POST', '/api/pdf/author-preview', { session: 'u-a', body: { book: bookWith(card.id), engineId: 'designcraft' } });
    if (r.status !== 200) failed.push(`${card.id}: ${r.json?.error || r.status}`);
    else pages[card.id] = Number(r.headers.get('x-pdf-pages'));
  }
  t(`${BOOK_DESIGN_THEME_CARDS.length} шаблонів — без помилок`, failed.length === 0, failed.join('; '));
  t('у кожного шаблону є сторінки', Object.values(pages).every((n) => n > 0), JSON.stringify(pages));
}

// ---------------------------------------------------------------------------
console.log('\nEPUB/HTML для письменника');
{
  const guest = await call('POST', '/api/pdf/companion', { body: { book: bookWith(), engineId: 'designcraft', kind: 'epub' } });
  t('гість — 401', guest.status === 401, String(guest.status));
  if (!cli) {
    skip('EPUB письменнику', 'бінарника DesignCraft немає');
  } else {
    const epub = await call('POST', '/api/pdf/companion', { session: 'u-a', body: { book: bookWith('studio-editorial'), engineId: 'designcraft', kind: 'epub' } });
    t('письменник (не адмін) отримує EPUB', epub.status === 200 && epub.buf.subarray(0, 2).toString('latin1') === 'PK', String(epub.status));
    const html = await call('POST', '/api/pdf/companion', { session: 'u-a', body: { book: bookWith(), engineId: 'designcraft', kind: 'html' } });
    t('і HTML', html.status === 200 && html.buf.toString('utf8').includes('Скляний'), String(html.status));
  }
  const admin = await call('POST', '/api/admin/pdf/companion', { session: 'u-a', body: { book: bookWith(), engineId: 'designcraft', kind: 'epub' } });
  t('адмінський маршрут лишився адмінським (403)', admin.status === 403, String(admin.status));
}

// ---------------------------------------------------------------------------
console.log('\nЧернетка .designcraft: Студія → вікно DesignCraft');
const stored = await bookStore.saveBook({ ownerId: 'u-a', book: bookWith('studio-editorial') });
await bookStore.saveBook({ ownerId: 'u-b', book: { ...bookWith(), id: 'TEST-PUBLICATION-OTHER' } });
{
  t('чужа книга — 404', (await call('POST', `/api/books/${stored.id}/designcraft-draft`, { session: 'u-b' })).status === 404);
  if (!cli) {
    skip('чернетка', 'бінарника DesignCraft немає');
  } else {
    const draft = await call('POST', `/api/books/${stored.id}/designcraft-draft`, { session: 'u-a' });
    t('автор отримує чернетку', draft.status === 200 && draft.buf.length > 1000, `${draft.status} ${draft.buf.length} Б`);
    t('чернетка несе ревізію книги', draft.headers.get('x-book-revision') === String(stored.revision));
    const arts = await bookStore.listArtifacts(stored.id);
    const a = arts.find((x) => x.kind === 'designcraft');
    t('чернетка лягла артефактом книги з шаблоном', !!a && a.bookRevision === stored.revision && a.variant === 'studio-editorial', JSON.stringify(a));
    if (realCli) {
      const dfile = path.join(DIR, 'draft.designcraft');
      const out = path.join(DIR, 'reopened.pdf');
      fs.writeFileSync(dfile, draft.buf);
      const run = spawnSync(realCli, ['run', '--in', dfile, '--export', out], { encoding: 'utf8' });
      const log = `${run.stdout || ''}${run.stderr || ''}`; // «wrote … (N pages…)» DesignCraft пише в stderr
      const m = /\((\d+) pages?/.exec(log);
      t('DesignCraft відкриває чернетку й експортує ті самі сторінки', !!m && m[1] === draft.headers.get('x-pdf-pages'), `${log.trim()} / X-Pdf-Pages=${draft.headers.get('x-pdf-pages')}`);
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\nСкрипт: код підключення → чернетка → повернення результату');
{
  const code = (await call('POST', '/api/external-tokens/pairing-code', { session: 'u-a', body: {} })).json?.code;
  const token = (await call('POST', '/api/external/v1/pair', { body: { code } })).json?.token;
  t('токен із коду підключення', String(token).startsWith('nst_'));
  const codeB = (await call('POST', '/api/external-tokens/pairing-code', { session: 'u-b', body: {} })).json?.code;
  const tokenB = (await call('POST', '/api/external/v1/pair', { body: { code: codeB } })).json?.token;

  t('без токена — 401', (await call('POST', `/api/external/v1/books/${stored.id}/designcraft-draft`)).status === 401);
  t('чужим токеном — 404', (await call('POST', `/api/external/v1/books/${stored.id}/designcraft-draft`, { token: tokenB })).status === 404);
  if (cli) {
    const d = await call('POST', `/api/external/v1/books/${stored.id}/designcraft-draft`, { token });
    t('скрипт отримує чернетку токеном', d.status === 200 && d.buf.length > 1000, String(d.status));
  } else skip('чернетка токеном', 'бінарника DesignCraft немає');

  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2000, 32)]);
  const put = (kind: string, raw: Buffer, rev?: number, tok = token) =>
    call('PUT', `/api/external/v1/books/${stored.id}/designcraft-result/${kind}`, {
      token: tok,
      raw,
      headers: rev === undefined ? {} : { 'x-book-revision': String(rev) },
    });
  t('без ревізії — 400', (await put('designcraft-pdf', pdf)).status === 400);
  t('ревізія з майбутнього — 400', (await put('designcraft-pdf', pdf, stored.revision + 5)).status === 400);
  t('не PDF під виглядом PDF — 400', (await put('designcraft-pdf', Buffer.alloc(2000, 65), stored.revision)).status === 400);
  t('невідомий вид — 400', (await put('exe', pdf, stored.revision)).status === 400);
  t('чужим токеном — 404', (await put('designcraft-pdf', pdf, stored.revision, tokenB)).status === 404);
  const ok = await put('designcraft-pdf', pdf, stored.revision);
  t('результат прийнято (201), не застарілий', ok.status === 201 && ok.json?.stale === false, JSON.stringify(ok.json));
  const okDoc = await put('designcraft', Buffer.alloc(3000, 7), stored.revision);
  t('і .designcraft прийнято', okDoc.status === 201);

  const officialBefore = (await bookStore.listArtifacts(stored.id)).find((a) => a.kind === 'pdf');
  t('офіційний PDF публікації не перезаписано', !officialBefore, JSON.stringify(officialBefore || null));

  // Збереження БЕЗ змін піднімає ревізію, але чернетка не повинна від цього «старіти».
  const same = await bookStore.saveBook({ ownerId: 'u-a', book: stored.book as any, expectedRevision: stored.revision });
  const st1 = await call('GET', `/api/books/${stored.id}/designcraft-status`, { session: 'u-a' });
  t('збереження без змін: ревізія виросла, але результат НЕ застарів', same.revision > stored.revision && st1.json?.artifacts?.every((a: any) => a.stale === false), JSON.stringify(st1.json?.artifacts?.map((a: any) => [a.kind, a.stale])));
  t('чужий статус — 404', (await call('GET', `/api/books/${stored.id}/designcraft-status`, { session: 'u-b' })).status === 404);
  const next = await bookStore.saveBook({ ownerId: 'u-a', book: { ...(stored.book as any), title: 'Тестова книга верстки (правка)' }, expectedRevision: same.revision });
  const st2 = await call('GET', `/api/books/${stored.id}/designcraft-status`, { session: 'u-a' });
  t('після правки назви — застаріло', st2.json?.artifacts?.some((a: any) => a.kind === 'designcraft-pdf' && a.stale === true));
  const arts = await bookStore.listArtifacts(stored.id);
  const gui = arts.find((a) => a.kind === 'designcraft-pdf');
  t('після правки книги результат DesignCraft застарілий (ревізія старіша)', !!gui && gui.bookRevision !== next.revision, `${gui?.bookRevision} vs ${next.revision}`);
  const stale = await put('designcraft-pdf', pdf, stored.revision);
  t('повернення зі старої ревізії сервер позначає stale', stale.json?.stale === true && stale.json?.currentRevision === next.revision);
}

server.close();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало, ${skipped} пропущено.`);
if (fail) process.exit(1);

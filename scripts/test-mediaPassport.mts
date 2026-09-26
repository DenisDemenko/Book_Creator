/**
 * Паспорт зображення в Медіатеці — Т2.3 В1 (журнал #260).
 * Запуск: npm run test:media-passport
 *
 * ЩО ПЕРЕВІРЯЄТЬСЯ (PLAN_VISUAL_LIBRARY.md §3 В1):
 *   1. Старі файли без паспорта отримують чесні значення: згенероване —
 *      «ШІ» й «власна» ліцензія, завантажене — «невідома», версія 1. І в
 *      SQLite (стара база без колонок — міграція), і в JSON.
 *   2. Паспорт змінюється лише своїм власником, неправильні значення
 *      відхиляються з поясненням, зміна пишеться в історію «з → на».
 *   3. Нова версія не стирає попередню: та сама група, номер +1, паспорт
 *      успадковано; у галереї — лише остання; чужа «попередня» — відмова.
 *   4. Історія групи живе й після видалення версії.
 *   5. Маршрути: паспорт, PATCH, завантаження версії, `list?latest=1`; чужому — 404.
 *   6. Заміна URL у книзі — лише точний збіг (md-1 не чіпає md-10).
 */
const DIR = '/tmp/nova-media-passport-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
const store = await import('../server/media/mediaLibraryStore');
const routes = await import('../server/mediaRoutes');
const { replaceMediaUrlInBook, mediaIdFromUrl, passportWarnings } = await import('../src/utils/mediaPassport');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_B64 = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;

async function suite(label: string) {
  console.log(`\nПаспорт (${label}):`);
  const up = await store.saveAsset({ ownerId: 'u-1', bookId: 'b-1', kind: 'upload', filename: 'фото.png', mimeType: 'image/png', bytes: PNG });
  const ai = await store.saveAsset({ ownerId: 'u-1', bookId: 'b-1', kind: 'illustration', filename: 'scene.png', mimeType: 'image/png', bytes: PNG, prompt: 'рудий кіт', model: 'gemini-image' });
  t('завантажене: джерело «завантажено», ліцензія невідома, готове, версія 1, група — сам файл',
    up.source === 'upload' && up.license === 'unknown' && up.status === 'final' && up.version === 1 && up.rootId === up.id && up.parentId === null);
  t('згенероване: джерело «ШІ», ліцензія власна', ai.source === 'ai' && ai.license === 'own');
  const withPassport = await store.saveAsset({ ownerId: 'u-1', kind: 'upload', filename: 'x.png', mimeType: 'image/png', bytes: PNG, passport: { source: 'stock', license: 'cc-by', author: 'Іван Фото', title: 'Ліс' } });
  t('паспорт одразу при збереженні', withPassport.source === 'stock' && withPassport.license === 'cc-by' && withPassport.author === 'Іван Фото' && withPassport.title === 'Ліс');

  // ── Зміна паспорта ──
  const p1 = await store.updateAssetPassport(up.id, 'u-1', { title: 'Олена біля вікна', license: 'own', status: 'draft', author: 'Автор' });
  t('PATCH: поля змінено, дата зміни оновлена', p1?.title === 'Олена біля вікна' && p1.license === 'own' && p1.status === 'draft' && p1.updatedAt >= p1.createdAt);
  t('чужий файл — null (як 404)', (await store.updateAssetPassport(up.id, 'u-2', { title: 'x' })) === null);
  const err = async (patch: object) => { try { await store.updateAssetPassport(up.id, 'u-1', patch); return 'ok'; } catch (e) { return e instanceof store.MediaPassportError ? 'bad' : String(e); } };
  t('неправильні значення — відмова з поясненням', (await err({ license: 'gpl' })) === 'bad' && (await err({ status: 'x' })) === 'bad' && (await err({ source: 'x' })) === 'bad' && (await err({ licenseUrl: 'ftp://a' })) === 'bad' && (await err({ title: 'a'.repeat(201) })) === 'bad' && (await err({ title: 5 })) === 'bad');
  await store.updateAssetPassport(up.id, 'u-1', { title: 'Олена біля вікна' });
  const pp = (await store.getAssetPassport(up.id, 'u-1'))!;
  const ph = pp.history.filter((h) => h.action === 'passport');
  t('історія: одна зміна паспорта «з → на» (порожня зміна не пишеться)', ph.length === 1 && (ph[0].details as any).changes.license.from === 'unknown' && (ph[0].details as any).changes.license.to === 'own' && ph[0].actor === 'user:u-1');
  t('історія: «створено» першою подією', pp.history[pp.history.length - 1].action === 'created');

  // ── Версії ──
  const v2 = await store.saveAsset({ ownerId: 'u-1', kind: 'upload', filename: 'фото-2.png', mimeType: 'image/png', bytes: PNG, parentId: up.id });
  t('нова версія: та сама група, номер 2, книга й паспорт успадковано', v2.rootId === up.id && v2.version === 2 && v2.parentId === up.id && v2.bookId === 'b-1' && v2.title === 'Олена біля вікна' && v2.license === 'own' && v2.status === 'draft');
  const v3 = await store.saveAsset({ ownerId: 'u-1', kind: 'upload', filename: 'фото-3.png', mimeType: 'image/png', bytes: PNG, parentId: up.id });
  t('версія від старої — усе одно наступний номер групи (3)', v3.version === 3 && v3.rootId === up.id);
  let foreign = false;
  try { await store.saveAsset({ ownerId: 'u-2', kind: 'upload', filename: 'z.png', mimeType: 'image/png', bytes: PNG, parentId: up.id }); } catch { foreign = true; }
  t('чужа «попередня версія» — відмова', foreign);
  t('стара версія на місці (не стерта)', !!(await store.getAsset(up.id)) && !!(await store.readAsset(up.id)));
  const latest = store.latestVersionsOnly(await store.listAssets('u-1', { bookId: 'b-1' }));
  t('галерея: лише остання версія групи', latest.filter((a) => a.rootId === up.id).map((a) => a.version).join() === '3' && latest.some((a) => a.id === ai.id));
  const pv = (await store.getAssetPassport(v2.id, 'u-1'))!;
  t('паспорт будь-якої версії: усі версії по порядку й спільна історія', pv.versions.map((v) => v.version).join() === '1,2,3' && pv.history.filter((h) => h.action === 'version').length === 2);
  t('чужий паспорт — null', (await store.getAssetPassport(v2.id, 'u-2')) === null);

  await store.deleteAsset(v3.id, 'u-1');
  const pd = (await store.getAssetPassport(up.id, 'u-1'))!;
  t('видалення версії — у історії лишається, решта версій на місці', pd.history[0].action === 'deleted' && (pd.history[0].details as any).version === 3 && pd.versions.map((v) => v.version).join() === '1,2');
}

console.log('SQLite: стара база без колонок паспорта');
{
  const sqlite = (await import('node:sqlite')) as any;
  const old = new sqlite.DatabaseSync(`${DIR}/nova-studio.db`);
  old.exec(`CREATE TABLE media_assets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, book_id TEXT, kind TEXT NOT NULL, filename TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, prompt TEXT, model TEXT, created_at TEXT NOT NULL)`);
  old.prepare(`INSERT INTO media_assets VALUES ('md-old-1', 'u-9', 'b-9', 'character_art', 'char.png', 'image/png', 10, 'портрет', 'imagen', '2026-01-01T00:00:00.000Z')`).run();
  old.prepare(`INSERT INTO media_assets VALUES ('md-old-2', 'u-9', 'b-9', 'upload', 'photo.jpg', 'image/jpeg', 10, NULL, NULL, '2026-01-02T00:00:00.000Z')`).run();
  old.close();
  await db.initDb();
  t('база піднялась (SQLite)', db.isAvailable());
  const cols = (db.getDb()!.prepare('PRAGMA table_info(media_assets)').all() as any[]).map((c) => c.name);
  t('міграція додала колонки паспорта', ['title', 'alt_text', 'source', 'author', 'license', 'license_url', 'status', 'parent_id', 'root_id', 'version', 'updated_at'].every((c) => cols.includes(c)));
  const o1 = (await store.getAsset('md-old-1'))!;
  const o2 = (await store.getAsset('md-old-2'))!;
  t('старий згенерований портрет — «ШІ», власна ліцензія, версія 1, група — сам', o1.source === 'ai' && o1.license === 'own' && o1.version === 1 && o1.rootId === 'md-old-1' && o1.updatedAt === o1.createdAt);
  t('старе фото — «завантажено», ліцензія невідома', o2.source === 'upload' && o2.license === 'unknown' && o2.status === 'final');
  const pO = (await store.getAssetPassport('md-old-1', 'u-9'))!;
  t('паспорт старого файлу — версія одна, історії ще немає', pO.versions.length === 1 && pO.history.length === 0);
  await suite('SQLite');
}

console.log('\nJSON: старий файл без паспорта');
{
  // Без SQLite сховище працює на JSON-файлі — той самий договір.
  db.closeDb();
  store.__resetMediaCacheForTests();
  fs.writeFileSync(`${DIR}/media-assets.json`, JSON.stringify({ assets: [{ id: 'md-j-1', ownerId: 'u-8', bookId: null, kind: 'upload', filename: 'a.png', mimeType: 'image/png', sizeBytes: 3, prompt: null, model: null, createdAt: '2026-01-01T00:00:00.000Z', url: '/api/media/file/md-j-1' }] }));
  t('бекенд — JSON', !db.isAvailable());
  const j = (await store.getAsset('md-j-1'))!;
  t('старий запис JSON — з паспортом за правилами', j.source === 'upload' && j.license === 'unknown' && j.version === 1 && j.rootId === 'md-j-1');
  await suite('JSON');
}

console.log('\nМаршрути:');
{
  let principal: any = { id: 'u-1', email: 'a@test.ua', name: 'Автор', role: 'writer', isGuest: false };
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use((req: any, _res, next) => { req.principal = principal; next(); });
  routes.registerMediaRoutes(app);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
  };
  const up = await call('POST', '/api/media/upload', { dataUrl: PNG_B64, filename: 'hero.png', bookId: 'b-r', passport: { license: 'cc0', title: 'Герой' } });
  t('upload з паспортом', up.status === 200 && up.data.asset.license === 'cc0' && up.data.asset.title === 'Герой');
  const bad = await call('POST', '/api/media/upload', { dataUrl: PNG_B64, filename: 'x.png', passport: { license: 'gpl' } });
  t('upload з неправильною ліцензією — 400', bad.status === 400 && bad.data.kind === 'bad_passport');
  const pa = await call('PATCH', `/api/media/${up.data.asset.id}`, { author: 'Марія Художниця', license: 'cc-by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/' });
  t('PATCH паспорта — 200', pa.status === 200 && pa.data.asset.author === 'Марія Художниця' && pa.data.asset.license === 'cc-by');
  t('PATCH неправильного — 400 з поясненням', (await call('PATCH', `/api/media/${up.data.asset.id}`, { status: 'x' })).status === 400);
  const v2 = await call('POST', '/api/media/upload', { dataUrl: PNG_B64, filename: 'hero-2.png', parentId: up.data.asset.id });
  t('нова версія через upload — v2, паспорт успадковано', v2.status === 200 && v2.data.asset.version === 2 && v2.data.asset.author === 'Марія Художниця');
  const pass2 = await call('GET', `/api/media/${v2.data.asset.id}/passport`);
  t('GET паспорта: 2 версії, історія (створено, паспорт, версія)', pass2.status === 200 && pass2.data.versions.length === 2 && pass2.data.history.map((h: any) => h.action).sort().join() === 'created,passport,version');
  const listAll = await call('GET', '/api/media/list?bookId=b-r');
  const listLatest = await call('GET', '/api/media/list?bookId=b-r&latest=1');
  t('list — усі версії; list?latest=1 — лише остання', listAll.data.assets.length === 2 && listLatest.data.assets.length === 1 && listLatest.data.assets[0].version === 2);
  principal = { id: 'u-2', role: 'writer', isGuest: false };
  t('чужому: паспорт і PATCH — 404, версія від чужого — 404',
    (await call('GET', `/api/media/${v2.data.asset.id}/passport`)).status === 404 &&
    (await call('PATCH', `/api/media/${v2.data.asset.id}`, { title: 'x' })).status === 404 &&
    (await call('POST', '/api/media/upload', { dataUrl: PNG_B64, filename: 'y.png', parentId: up.data.asset.id })).status === 404);
  principal = null;
  t('гостю — 401', (await call('GET', `/api/media/${v2.data.asset.id}/passport`)).status === 401);
  server.close();
}

console.log('\nКнига: заміна посилання на нову версію');
{
  const book = {
    characters: [{ id: 'c1', avatarUrl: '/api/media/file/md-1' }, { id: 'c2', avatarUrl: '/api/media/file/md-10' }],
    coverConfig: { frontArtUrl: '/api/media/file/md-1' },
    illustrations: [{ id: 'i1', url: '/api/media/file/md-1?v=1' }],
    chapters: [{ sections: [{ content: 'Текст ![](/api/media/file/md-1) і ще' }] }],
  };
  const r = replaceMediaUrlInBook(book, '/api/media/file/md-1', '/api/media/file/md-2');
  t('усі посилання md-1 → md-2 (портрет, обкладинка, ілюстрація, текст)', r.count === 4 && r.book.characters[0].avatarUrl === '/api/media/file/md-2' && r.book.coverConfig.frontArtUrl === '/api/media/file/md-2' && r.book.illustrations[0].url === '/api/media/file/md-2?v=1' && r.book.chapters[0].sections[0].content.includes('/api/media/file/md-2)'));
  t('md-10 не зачеплено; вихідна книга не змінена', r.book.characters[1].avatarUrl === '/api/media/file/md-10' && book.characters[0].avatarUrl === '/api/media/file/md-1');
  t('не файл медіатеки — нічого не робиться', replaceMediaUrlInBook(book, 'data:image/png;base64,AAA', '/api/media/file/md-2').count === 0);
  t('id з URL', mediaIdFromUrl('/api/media/file/md-abc?x=1') === 'md-abc' && mediaIdFromUrl('https://x/a.png') === null);
  t('позначки паспорта: невідома ліцензія; CC BY без автора', passportWarnings({ license: 'unknown' }).join() === 'license' && passportWarnings({ license: 'cc-by', author: '' }).join() === 'author' && passportWarnings({ license: 'own' }).length === 0);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

/**
 * «Перевірити» після зміни опису — Т2.3 В5 (журнал #263).
 *
 * PLAN_VISUAL_LIBRARY.md §3 В5: коли змінюється затверджений опис зовнішності
 * (картка героя → синхронізація ядра, або опис версії зовнішності),
 * зображення, звірені зі старим описом (`checked_hash` ≠ поточного),
 * позначаються `needs_review`, ядро пише сповіщення; позначку видно в
 * Медіатеці й у профілі; знімає її «Звірено» (автор) або повернення опису.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:visual-review
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { appearanceOverview, cardAppearanceHash, expectedLinkHash } from '../server/core/visual.ts';
import { studioAppearanceText, studioFromBook } from '../server/core/characterProfile.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nВідбиток опису:');
t('опис картки одним рядком — українські назви полів, лише заповнені',
  studioAppearanceText({ appearance: { hair: 'руде', eyes: ' сірі ', face: '' } }) === 'волосся: руде; очі: сірі' && studioAppearanceText(null) === '');
t('відбиток картки: без різниці в пробілах і регістрі; порожній опис — теж відбиток',
  cardAppearanceHash('Волосся: руде') === cardAppearanceHash(' волосся:  руде ') && cardAppearanceHash('') === cardAppearanceHash(null) && cardAppearanceHash('') !== cardAppearanceHash('x'));
const vm = new Map([['v1', { descriptionHash: 'H-v1' }]]);
t('з чим звіряти: портрет версії — опис версії; загальний портрет — картка; локація, сцена, «зображено» — ні з чим',
  expectedLinkHash({ entityId: 'e', role: 'portrait', appearanceVersionId: 'v1' }, vm, () => 'H-card') === 'H-v1' &&
  expectedLinkHash({ entityId: 'e', role: 'full_body', appearanceVersionId: null }, vm, () => 'H-card') === 'H-card' &&
  expectedLinkHash({ entityId: 'e', role: 'location', appearanceVersionId: null }, vm, () => 'H-card') === undefined &&
  expectedLinkHash({ entityId: 'e', role: 'depicts', appearanceVersionId: null }, vm, () => 'H-card') === undefined &&
  expectedLinkHash({ entityId: null, role: 'scene', appearanceVersionId: null }, vm, () => 'H-card') === undefined);

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nПеревірити після зміни опису (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [
      { id: 'c-o', name: 'Олена', avatarUrl: '/api/media/file/md-card', appearance: { hair: 'руде', eyes: 'сірі' } },
      { id: 'c-m', name: 'Марко', avatarUrl: '/api/media/file/md-marko' },
    ],
    chapters: [
      { id: 'ch1', title: 'Перша', order: 0, sections: [sec('s1', 0, '[/character:Олена] [/character:Марко] [/location:Київ] Олена й Марко в Києві.')] },
      { id: 'ch2', title: 'Друга', order: 1, sections: [sec('s2', 0, '[/character:Олена] Олена доросла.')] },
    ],
  };
  const sync = () => syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const r1 = await sync();
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const kyiv = (await repo.resolveAlias(P, 'location', 'Київ'))!;
  const linkOf = async (url: string) => (await repo.listAssetLinks(P, { assetUrl: url }))[0];
  const card = () => cardAppearanceHash(studioAppearanceText(book.characters[0]));
  t('перша синхронізація: портрети з карток звірено з поточним описом (без позначки)',
    r1.assets.review?.baselined === 2 && r1.assets.review?.flagged === 0 &&
    (await linkOf('/api/media/file/md-card')).checkedHash === card() && !(await linkOf('/api/media/file/md-card')).needsReview, JSON.stringify(r1.assets));
  const r1b = await sync();
  t('повторна синхронізація без змін — нічого не пише', !r1b.wroteAnything && r1b.assets.review?.baselined === 0, JSON.stringify(r1b.assets));

  // Маршрути — як у Студії.
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', studio: async (_p, entity) => studioFromBook(book, entity) });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  const art = await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-art', role: 'full_body', entityId: olena });
  t('прив\'язав автор — звірено з поточним описом картки одразу', art.status === 201 && art.body.link.checkedHash === card() && art.body.link.needsReview === false);
  const loc = await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-kyiv', role: 'location', entityId: kyiv });
  t('локація — без відбитка (опису зовнішності немає)', loc.status === 201 && loc.body.link.checkedHash === null);
  const v = await call('POST', `/visual/appearance/${olena}`, 'owner', { label: 'Доросла', fromChapter: 2, description: 'Коротке руде волосся' });
  const vid = v.body.version.id;
  const vp = await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'owner', { assetUrl: '/api/media/file/md-adult' });
  t('портрет версії — звірено з описом версії', vp.body.link.checkedHash === v.body.version.descriptionHash && vp.body.link.needsReview === false);
  const rej = await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-old', role: 'reference', entityId: olena });
  await repo.setAssetLinkStatus(P, rej.body.link.id, 'rejected');

  // ── Картка змінилась ──
  book.characters[0].appearance.hair = 'чорне';
  const r2 = await sync();
  const flagged = (await repo.listAssetLinks(P, { entityId: olena })).filter((l) => l.needsReview).map((l) => l.assetUrl).sort();
  t('КРИТЕРІЙ: волосся в картці змінилось — портрет з картки й повний зріст «перевірити», портрет версії — ні',
    r2.assets.review?.flagged === 2 && flagged.join() === '/api/media/file/md-art,/api/media/file/md-card' && r2.wroteAnything, JSON.stringify(flagged));
  t('відхилений референс і портрет Марка не чіпаються', !(await linkOf('/api/media/file/md-old')).needsReview && !(await linkOf('/api/media/file/md-marko')).needsReview);
  const notes = (await repo.listNotifications(P)).filter((n) => n.kind === 'visual_needs_review');
  t('сповіщення ядра — одне на героя, з кількістю й зв\'язками', notes.length === 1 && /Олена/.test(notes[0].message) && /2$/.test(notes[0].message) && (notes[0].payload as any).linkIds.length === 2 && (notes[0].payload as any).entityId === olena, notes[0]?.message);
  const r2b = await sync();
  t('повторна синхронізація — позначки лишаються, нових сповіщень немає', !r2b.wroteAnything && (await repo.listNotifications(P)).filter((n) => n.kind === 'visual_needs_review').length === 1);

  const g = await call('GET', `/visual/links?assetUrl=${encodeURIComponent('/api/media/file/md-card')}`, 'reader');
  t('Медіатека: позначка видна в зв\'язках (читачу теж)', g.body.links[0]?.needsReview === true);
  const studioCard = { description: studioAppearanceText(book.characters[0]), portraitUrl: '/api/media/file/md-card' };
  let ov = await appearanceOverview(repo, P, olena, studioCard);
  t('профіль: перелік «перевірити» (2), портрет-основа з позначкою, портрет версії — без',
    ov.needsReview.length === 2 && ov.base.portraitNeedsReview === true && ov.versions[0].portraitNeedsReview === false && ov.needsReview.every((x) => x.versionLabel === null));

  // «Звірено»
  const cardLink = await linkOf('/api/media/file/md-card');
  t('«Звірено»: читачу — 403; локація — 400; невідомий — 404',
    (await call('POST', `/visual/links/${cardLink.id}/checked`, 'reader')).status === 403 &&
    (await call('POST', `/visual/links/${loc.body.link.id}/checked`, 'owner')).status === 400 &&
    (await call('POST', '/visual/links/00000000-0000-4000-8000-000000000000/checked', 'owner')).status === 404);
  const ok = await call('POST', `/visual/links/${cardLink.id}/checked`, 'owner');
  t('«Звірено» автором — позначку знято, відбиток — новий опис картки', ok.status === 200 && ok.body.link.needsReview === false && ok.body.link.checkedHash === card());
  const r3 = await sync();
  t('наступна синхронізація звірене не позначає знову', r3.assets.review?.flagged === 0 && !(await linkOf('/api/media/file/md-card')).needsReview);

  // Опис повернули — позначка знімається сама.
  book.characters[0].appearance.hair = 'руде';
  const r4 = await sync();
  const artNow = await linkOf('/api/media/file/md-art');
  const cardNow = await linkOf('/api/media/file/md-card');
  t('опис повернули: повний зріст (звірений зі старим «руде») — позначку знято; портрет, звірений з «чорне», — тепер «перевірити»',
    r4.assets.review?.cleared === 1 && r4.assets.review?.flagged === 1 && !artNow.needsReview && cardNow.needsReview, JSON.stringify(r4.assets.review));
  await call('POST', `/visual/links/${cardNow.id}/checked`, 'owner');

  // ── Опис версії змінився ──
  const same = await call('PATCH', `/visual/appearance/${olena}/versions/${vid}`, 'owner', { label: 'Доросла (30)' });
  t('змінили лише назву версії — нічого не позначено', same.status === 200 && same.body.review === null && !(await linkOf('/api/media/file/md-adult')).needsReview);
  const pv = await call('PATCH', `/visual/appearance/${olena}/versions/${vid}`, 'owner', { description: 'Сиве волосся, шрам' });
  t('КРИТЕРІЙ: опис версії змінився — її портрет «перевірити», сповіщення з назвою версії',
    pv.body.review?.flagged === 1 && (await linkOf('/api/media/file/md-adult')).needsReview &&
    (await repo.listNotifications(P)).some((n) => n.kind === 'visual_needs_review' && /Доросла \(30\)/.test(n.message)), JSON.stringify(pv.body.review));
  ov = await appearanceOverview(repo, P, olena, studioCard);
  t('профіль: портрет версії з позначкою, у переліку — з назвою версії',
    ov.versions[0].portraitNeedsReview === true && ov.needsReview.some((x) => x.versionLabel === 'Доросла (30)'));
  const chk = await call('POST', `/visual/links/${(await linkOf('/api/media/file/md-adult')).id}/checked`, 'owner');
  t('«Звірено» портрета версії — відбиток опису версії', chk.body.link.checkedHash === pv.body.version.descriptionHash && !chk.body.link.needsReview);
  const vp2 = await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'owner', { assetUrl: '/api/media/file/md-adult-2' });
  t('новий портрет версії — одразу звірений', vp2.body.link.needsReview === false && vp2.body.link.checkedHash === pv.body.version.descriptionHash);

  // Версію видалено — її портрет став загальним і звіряється з карткою.
  const del = await call('DELETE', `/visual/appearance/${olena}/versions/${vid}`, 'owner');
  const adult2 = await linkOf('/api/media/file/md-adult-2');
  t('версію видалено: її портрет — загальний, звірений з описом версії, отже «перевірити» з карткою',
    del.body.ok && del.body.review?.flagged === 1 && adult2.appearanceVersionId === null && adult2.needsReview);
  t('Марко (без опису в картці) — його портрет не позначався жодного разу', !(await linkOf('/api/media/file/md-marko')).needsReview && (await linkOf('/api/media/file/md-marko')).entityId === marko);
  server.close();
}

await suite('memory', new MemoryCoreRepository(), 'book-m');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    await suite('postgres', new PgCoreRepository(pool), 'book-p');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

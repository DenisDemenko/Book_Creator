/**
 * Вкладка «За сутностями» Медіатеки — Т2.3 В7.
 *
 * PLAN_VISUAL_LIBRARY.md §3 В7: ліва колонка — герої, локації, предмети,
 * сцени з кількістю зображень і позначками «перевірити» / «без портрета»;
 * права — зображення сутності, версії зовнішності, пропозиції AI-3, звірка
 * з описом (усе те, що вже дають маршрути В1–В6 — тут лише огляд-перелік
 * для лівої колонки, `GET /api/projects/:id/visual/entities`).
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:visual-entities
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
import { primaryVisualRole, visualEntitiesOverview } from '../server/core/visual.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nГоловна роль типу (позначка «без портрета»):');
t('герой — портрет; локація і світ — «локація»; предмет — «предмет»; решта — «зображено»',
  primaryVisualRole('character') === 'portrait' && primaryVisualRole('location') === 'location' && primaryVisualRole('world') === 'location' &&
  primaryVisualRole('weapon') === 'object' && primaryVisualRole('group') === 'depicts' && primaryVisualRole('symbol') === 'depicts');

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nОгляд «За сутностями» (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Перша', order: 0, sections: [sec('s1', 0, '[/character:Олена] [/character:Марко] [/location:Київ] [/location:Земля] [/object:Меч] [/emotion:страх @Олена] Олена з мечем у Києві.')] },
      { id: 'ch2', title: 'Друга', order: 1, sections: [sec('s2', 0, 'Далі.')] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const kyiv = (await repo.resolveAlias(P, 'location', 'Київ'))!;
  const zemlia = (await repo.resolveAlias(P, 'location', 'Земля'))!;
  const mech = (await repo.resolveAlias(P, 'object', 'Меч'))!;
  const fear = (await repo.resolveAlias(P, 'emotion', 'страх'))!;
  // «Земля» лишиться сутністю без жодного зв'язку — критерій «0 зображень, без портрета».
  void zemlia;

  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };

  // ── Прив'язки: два портрети Олени (один — «перевірити»), пропозиція AI-3 на Марка, локація й предмет із портретом, сцена з ілюстрацією ──
  await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-olena', role: 'portrait', entityId: olena });
  const fb = (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-olena-fb', role: 'full_body', entityId: olena })).body.link;
  await repo.setAssetLinkReview(P, fb.id, { needsReview: true });
  await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-marko-ai', role: 'depicts', entityId: marko, status: 'suggested', source: 'ai', createdBy: 'ai:visual3' });
  await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-kyiv', role: 'location', entityId: kyiv });
  await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-mech', role: 'object', entityId: mech });
  // Той самий файл прив'язаний і як «зображено» Олени (не має подвоювати лічильник зображень).
  await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-olena', role: 'depicts', entityId: olena });
  await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-scene1', role: 'scene', sectionId: 's1' });
  // Відхилена пропозиція — не рахується ніде.
  const rej = (await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-rej', role: 'depicts', entityId: kyiv, status: 'suggested', source: 'ai', createdBy: 'ai:visual3' }));
  await repo.setAssetLinkStatus(P, rej.id, 'rejected');

  const off = await call('GET', '/visual/entities', 'owner');
  t('маршрут доступний читачу теж (перелік, не редагування)', off.status === 200);

  const ov = off.body;
  t('розділи: герой(и), локації, предмети, сцени', Array.isArray(ov.characters) && Array.isArray(ov.locations) && Array.isArray(ov.objects) && Array.isArray(ov.scenes) && ov.synced === true);
  t('емоція («страх») не входить у жоден розділ (не має вигляду)',
    ![...ov.characters, ...ov.locations, ...ov.objects, ...ov.other].some((e: any) => e.id === fear));

  const oEl = ov.characters.find((e: any) => e.id === olena);
  t('КРИТЕРІЙ: Олена — 2 зображення (md-olena рахується раз, не двічі за дві ролі), пропозицій 0, перевірити 1, портрет є',
    oEl?.images === 2 && oEl.suggested === 0 && oEl.needsReview === 1 && oEl.hasPortrait === true, JSON.stringify(oEl));
  const mEl = ov.characters.find((e: any) => e.id === marko);
  t('Марко — 0 підтверджених, 1 пропозиція ШІ, без портрета', mEl?.images === 0 && mEl.suggested === 1 && mEl.hasPortrait === false);
  t('Герої відсортовані за іменем (uk)', ov.characters.map((e: any) => e.name).join() === 'Марко,Олена');

  const kEl = ov.locations.find((e: any) => e.id === kyiv);
  t('Київ — 1 зображення (роль «локація»), відхилена пропозиція не рахується, портрет є', kEl?.images === 1 && kEl.suggested === 0 && kEl.hasPortrait === true);
  const zEl = ov.locations.find((e: any) => e.id === zemlia);
  t('КРИТЕРІЙ «без портрета»: Земля — 0 зображень, без портрета', zEl?.images === 0 && zEl.hasPortrait === false);
  const mechEl = ov.objects.find((e: any) => e.id === mech);
  t('Меч — предмет, 1 зображення, портрет («предмет») є', !!mechEl && mechEl.images === 1 && mechEl.hasPortrait === true);

  t('сцена «s1» — 1 зображення, глава 1; розділ «s2» без ілюстрацій не входить у перелік',
    ov.scenes.length === 1 && ov.scenes[0].sectionId === 's1' && ov.scenes[0].images === 1 && ov.scenes[0].chapterNumber === 1);

  // ── Пряма перевірка функції (без HTTP) — та сама відповідь ──
  const direct = await visualEntitiesOverview(repo, P);
  t('пряма функція й маршрут узгоджені', JSON.stringify(direct.characters) === JSON.stringify(ov.characters) && direct.scenes.length === ov.scenes.length);

  server.close();

  // ── Чужа книга — 403 ще до ядра ──
  const app2 = express();
  app2.use(express.json());
  app2.use((req, _res, next) => { (req as any).principal = who.owner; next(); });
  registerProjectRoutes(app2, { access, repo: () => repo, coreState: () => 'ready' });
  const server2 = app2.listen(0);
  const base2 = `http://127.0.0.1:${(server2.address() as AddressInfo).port}/api/projects/${P}-not-mine`;
  const r2 = await fetch(`${base2}/visual/entities`, { headers: { 'x-user': 'owner' } });
  t('чужа книга — 403 (доступ до проєкту перевіряється раніше за ядро)', r2.status === 403);

  // ── Своя, але ще не синхронізована з ядром книга — порожній, не 4xx ──
  const P2 = `${P}-fresh`;
  const access3 = { ...access, async getBookOwnerId(x: string) { return x === P2 ? 'u-owner' : null; } };
  const app3 = express();
  app3.use(express.json());
  app3.use((req, _res, next) => { (req as any).principal = who.owner; next(); });
  registerProjectRoutes(app3, { access: access3, repo: () => repo, coreState: () => 'ready' });
  const server3 = app3.listen(0);
  const base3 = `http://127.0.0.1:${(server3.address() as AddressInfo).port}/api/projects/${P2}`;
  const r3 = await fetch(`${base3}/visual/entities`, { headers: { 'x-user': 'owner' } });
  const b3 = await r3.json();
  t('несинхронізована книга: 200, synced:false, порожні переліки', r3.status === 200 && b3.synced === false && b3.characters.length === 0 && b3.scenes.length === 0);
  server2.close();
  server3.close();
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

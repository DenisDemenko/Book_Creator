/**
 * Бібліотека ілюстрацій — прив'язка зображень до сутностей, Т2.3 В2 (журнал #261).
 *
 * Критерій сторінки 7 (ТЗ-11): портрет, прив'язаний до героя, видно в його
 * профілі й у пов'язаних розділах («Хто в сцені»). Плюс: перенесення
 * наявних портретів і ілюстрацій розділів з книги (рішення власника —
 * «переносити всі») синхронізацією ядра й зведення при змінах; зв'язок автора
 * важить більше за перенесений; відв'язаний перенесений не повертається;
 * правила (data:-URL, роль і ціль, AI лише пропонує); маршрути й права.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:visual-links
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
import { heroPortrait, sceneVisuals } from '../server/core/visual.ts';
import { buildCharacterProfile, studioFromBook } from '../server/core/characterProfile.ts';
import { CoreRuleError, isLinkableAssetUrl } from '../server/core/rules.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nЯкі URL можна прив\'язати:');
t('файл Медіатеки, http(s), шлях сайту — так; data:, порожнє, пробіли — ні',
  isLinkableAssetUrl('/api/media/file/md-1') && isLinkableAssetUrl('https://x.ua/a.png') && isLinkableAssetUrl('/generated/a.png') &&
  !isLinkableAssetUrl('data:image/png;base64,AAA') && !isLinkableAssetUrl('') && !isLinkableAssetUrl('javascript:alert(1)') && !isLinkableAssetUrl('/a b.png'));

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nЗв'язки зображень (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [
      { id: 'c-o', name: 'Олена', avatarUrl: '/api/media/file/md-olena-1' },
      { id: 'c-m', name: 'Марко', avatarUrl: 'data:image/png;base64,AAAA' },
      { id: 'c-i', name: 'Ірина' },
    ],
    illustrations: [
      { id: 'i1', url: '/api/media/file/md-scene-1', sectionId: 's2' },
      { id: 'i2', url: 'https://example.com/x.png', sectionId: 'немає' },
      { id: 'i3', url: '/api/media/file/md-chapter', chapterId: 'ch1' },
    ],
    chapters: [
      { id: 'ch1', title: 'Перша', order: 0, sections: [
        sec('s1', 0, '[/character:Олена] Олена відчинила двері.'),
        sec('s2', 1, '[/character:Олена] [/character:Марко] [/location:Київ] Олена й Марко йшли Києвом.\n\n[/emotion:страх @Ірина] Ірина боялась.'),
      ] },
    ],
  };
  const s1 = await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const id = async (type: string, name: string) => (await repo.resolveAlias(P, type, name))!;
  const olena = await id('character', 'Олена');
  const marko = await id('character', 'Марко');
  const irina = await id('character', 'Ірина');
  const kyiv = await id('location', 'Київ');
  const legacy = await repo.listAssetLinks(P, { source: 'legacy' });
  t('перенесено з книги: портрет Олени й ілюстрація розділу s2 (data:, неіснуючий розділ і «лише глава» — ні)',
    s1.assets.linked === 2 && legacy.length === 2 &&
    legacy.some((l) => l.role === 'portrait' && l.entityId === olena && l.assetUrl === '/api/media/file/md-olena-1' && l.assetId === 'md-olena-1') &&
    legacy.some((l) => l.role === 'scene' && l.sectionId === 's2' && l.assetUrl === '/api/media/file/md-scene-1'), JSON.stringify(s1.assets));
  t('перенесене — підтверджене, від синхронізації', legacy.every((l) => l.status === 'confirmed' && l.createdBy === 'system:core_sync'));
  const s1b = await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  t('повторна синхронізація без змін — нічого не пише', s1b.assets.linked === 0 && s1b.assets.unlinked === 0 && !s1b.wroteAnything);

  book.characters[0].avatarUrl = '/api/media/file/md-olena-2';
  const s2 = await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const portraits = (await repo.listAssetLinks(P, { entityId: olena })).filter((l) => l.role === 'portrait');
  t('новий портрет у картці — старий перенесений зник, новий з\'явився', s2.assets.linked === 1 && s2.assets.unlinked === 1 && portraits.length === 1 && portraits[0].assetUrl === '/api/media/file/md-olena-2');

  // ── Критерій: профіль героя ──
  const studio = () => studioFromBook(book, { externalRef: 'studio:character:c-o' } as any);
  let prof = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('профіль: портрет із зв\'язку (перенесений з картки)', prof.canon.portraitUrl === '/api/media/file/md-olena-2' && prof.canon.portraitSource === 'link');
  const mine = await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-olena-art', role: 'portrait', entityId: olena, createdBy: 'user:u-owner' });
  prof = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('КРИТЕРІЙ: портрет, прив\'язаний автором у Медіатеці, — у профілі героя (важить більше за перенесений)', prof.canon.portraitUrl === '/api/media/file/md-olena-art' && prof.canon.portraitSource === 'link');
  const sv = (await sceneVisuals(repo, P, 's2', (e) => (e.id === marko ? 'data:image/png;base64,AAAA' : null)))!;
  t('КРИТЕРІЙ: «Хто в сцені» s2 — Олена з портретом автора, Марко з картки, Ірина (чий страх) без портрета',
    sv.cast.map((c) => c.name).join() === 'Олена,Марко,Ірина' && sv.cast[0].portraitUrl === '/api/media/file/md-olena-art' && sv.cast[1].portraitSource === 'card' && sv.cast[2].portraitUrl === null, JSON.stringify(sv.cast));
  t('«Хто в сцені» s2 — ілюстрація сцени; s1 — без неї; невідомий розділ — null', sv.illustrations.map((i) => i.url).join() === '/api/media/file/md-scene-1' && (await sceneVisuals(repo, P, 's1'))!.illustrations.length === 0 && (await sceneVisuals(repo, P, 'нема')) === null);
  await repo.deleteAssetLink(P, mine.id);
  await repo.setAssetLinkStatus(P, portraits[0].id, 'rejected');
  t('без зв\'язків — портрет з картки (запасний)', (await heroPortrait(repo, P, olena, '/api/media/file/card'))?.source === 'card');
  const s3 = await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  t('відхилений перенесений — синхронізація не повертає і не видаляє', s3.assets.linked === 0 && s3.assets.unlinked === 0 && (await repo.getAssetLink(P, portraits[0].id))?.status === 'rejected');

  // ── Правила сховища ──
  const bad = async (patch: object) => {
    try {
      await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-x', role: 'portrait', entityId: olena, createdBy: 'user:u', ...patch } as any);
      return 'ok';
    } catch (e) {
      return e instanceof CoreRuleError ? e.code : String(e);
    }
  };
  t('data:-URL, роль «сцена» для сутності, роль героя без цілі, обидві цілі — bad_input',
    (await bad({ assetUrl: 'data:image/png;base64,AA' })) === 'bad_input' && (await bad({ role: 'scene' })) === 'bad_input' &&
    (await bad({ entityId: null })) === 'bad_input' && (await bad({ sectionId: 's1' })) === 'bad_input' && (await bad({ role: 'nope' })) === 'bad_input');
  t('AI лише пропонує; чужа сутність чи розділ — not_found',
    (await bad({ source: 'ai', status: 'confirmed', createdBy: 'ai:AI-3' })) === 'ai_suggests_only' &&
    (await bad({ entityId: '00000000-0000-4000-8000-000000000000' })) === 'not_found' &&
    (await bad({ entityId: null, sectionId: 'немає', role: 'scene' })) === 'not_found');
  const a1 = await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-kyiv', role: 'location', entityId: kyiv, note: 'Поділ', createdBy: 'user:u-owner' });
  const a2 = await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-kyiv', role: 'location', entityId: kyiv, status: 'rejected', createdBy: 'user:u-owner' });
  t('той самий URL, ціль і роль — оновлення (примітка лишається)', a1.id === a2.id && a2.status === 'rejected' && a2.note === 'Поділ');
  await repo.deleteAssetLink(P, a1.id);

  // ── Маршрути ──
  console.log(`\nМаршрути бібліотеки (${label}):`);
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false }, stranger: { id: 'u-x', role: 'writer', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, {
    access,
    repo: () => repo,
    coreState: () => 'ready',
    studio: async (_p, entity) => studioFromBook(book, entity),
  });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const tg = await call('GET', '/visual/targets', 'reader');
  t('GET targets: сутності й розділи по порядку, ролі', tg.status === 200 && tg.body.sections.map((s: any) => s.id).join() === 's1,s2' && tg.body.entities.some((e: any) => e.id === kyiv) && tg.body.roles.includes('scene'));
  const add = await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-new', role: 'portrait', entityId: irina });
  t('POST: портрет Ірини — 201, від автора, з ім\'ям цілі', add.status === 201 && add.body.link.source === 'author' && add.body.link.targetName === 'Ірина' && add.body.link.createdBy === 'user:u-owner');
  const sceneAdd = await call('POST', '/visual/links', 'owner', { assetUrl: 'https://example.com/scene.png', role: 'scene', sectionId: 's1' });
  t('POST: ілюстрація сцени s1 — 201, ціль — назва розділу', sceneAdd.status === 201 && sceneAdd.body.link.targetName === 'Розділ s1' && sceneAdd.body.link.targetType === 'scene');
  t('POST: читачу — 403; data:-URL, невідома роль — 400; портрет для локації — 400; невідома сутність чи розділ — 404',
    (await call('POST', '/visual/links', 'reader', { assetUrl: '/api/media/file/md-new', role: 'portrait', entityId: irina })).status === 403 &&
    (await call('POST', '/visual/links', 'owner', { assetUrl: 'data:image/png;base64,AA', role: 'portrait', entityId: irina })).status === 400 &&
    (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-new', role: 'hat', entityId: irina })).status === 400 &&
    (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-new', role: 'portrait', entityId: kyiv })).status === 400 &&
    (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-new', role: 'portrait', entityId: '00000000-0000-4000-8000-000000000000' })).status === 404 &&
    (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-new', role: 'scene', sectionId: 'нема' })).status === 404);
  const byAsset = await call('GET', `/visual/links?assetUrl=${encodeURIComponent('/api/media/file/md-new')}`, 'reader');
  t('GET links за зображенням — читачу видно, без прав на зміну', byAsset.status === 200 && byAsset.body.links.length === 1 && byAsset.body.canEdit === false);
  t('чужому — 403', (await call('GET', '/visual/links', 'stranger')).status === 403);
  const pr = await call('GET', `/visual/portrait/${irina}`, 'reader');
  t('GET portrait: Ірина — з Медіатеки', pr.body.portrait?.url === '/api/media/file/md-new' && pr.body.portrait?.source === 'link');
  const scene = await call('GET', '/visual/scene?sectionId=s2', 'reader');
  t('GET scene: «Хто в сцені» s2 — троє, Ірина вже з портретом', scene.status === 200 && scene.body.cast.length === 3 && scene.body.cast.find((c: any) => c.name === 'Ірина').portraitUrl === '/api/media/file/md-new');
  t('GET scene невідомого розділу — 404', (await call('GET', '/visual/scene?sectionId=нема', 'reader')).status === 404);
  const legacyScene = (await repo.listAssetLinks(P, { sectionId: 's2' }))[0];
  const delLegacy = await call('DELETE', `/visual/links/${legacyScene.id}`, 'owner');
  t('DELETE перенесеного — стає відхиленим (не повернеться), у списку його вже немає',
    delLegacy.body.rejected === true && (await repo.getAssetLink(P, legacyScene.id))?.status === 'rejected' &&
    !(await call('GET', '/visual/links?sectionId=s2', 'owner')).body.links.length &&
    (await call('GET', '/visual/links?sectionId=s2&includeRejected=1', 'owner')).body.links.length === 1);
  const delMine = await call('DELETE', `/visual/links/${add.body.link.id}`, 'owner');
  t('DELETE свого — видалено; повторно — 404', delMine.body.rejected === false && (await call('DELETE', `/visual/links/${add.body.link.id}`, 'owner')).status === 404);
  const st = await call('POST', `/visual/links/${legacyScene.id}/status`, 'owner', { status: 'confirmed' });
  t('статус: повернути відхилене — confirmed; поганий статус — 400; читачу — 403',
    st.body.link.status === 'confirmed' &&
    (await call('POST', `/visual/links/${legacyScene.id}/status`, 'owner', { status: 'maybe' })).status === 400 &&
    (await call('POST', `/visual/links/${legacyScene.id}/status`, 'reader', { status: 'rejected' })).status === 403);
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

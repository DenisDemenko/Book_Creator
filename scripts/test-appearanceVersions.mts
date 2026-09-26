/**
 * Версії зовнішності героя за віком чи етапом — Т2.3 В3 (журнал #262).
 *
 * Критерій етапу (PLAN_VISUAL_LIBRARY.md §3 В3): у профілі героя — стрічка
 * версій («8 років · гл. 1–2», «30 років · з гл. 3»), у кожної свій портрет і
 * затверджений опис; профіль у режимі «стан на главі N» і «Хто в сцені»
 * показують портрет версії, що діє в главі N. Опис нової версії — з картки
 * героя (канон автора). Плюс: правила (глави, AI лише пропонує), вибір
 * діючої версії при перетині, історія, видалення (портрет лишається
 * загальним), позначка версії на зв'язку зображення, маршрути й права.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:appearance-versions
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
import { activeAppearanceVersion, appearanceOverview, heroPortrait, sceneVisuals } from '../server/core/visual.ts';
import { buildCharacterProfile, studioFromBook } from '../server/core/characterProfile.ts';
import { CoreRuleError, appearanceHash, checkAppearanceVersion } from '../server/core/rules.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof CoreRuleError ? e.code : String(e);
  }
};
const codeAsync = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    return e instanceof CoreRuleError ? e.code : String(e);
  }
};

console.log('\nПравила версії зовнішності:');
const base = { projectId: 'p', entityId: 'e', createdBy: 'user:u' };
t('назва обов\'язкова (пробіли — не назва), до 120 символів',
  code(() => checkAppearanceVersion({ ...base, label: '   ' })) === 'bad_input' && code(() => checkAppearanceVersion({ ...base, label: 'x'.repeat(121) })) === 'bad_input');
t('глави: «до» раніше за «від», нуль, дріб — bad_input; порожні — null',
  code(() => checkAppearanceVersion({ ...base, label: 'a', fromChapter: 3, toChapter: 2 })) === 'bad_input' &&
  code(() => checkAppearanceVersion({ ...base, label: 'a', fromChapter: 0 })) === 'bad_input' &&
  code(() => checkAppearanceVersion({ ...base, label: 'a', toChapter: 1.5 })) === 'bad_input' &&
  checkAppearanceVersion({ ...base, label: ' a ', fromChapter: '' as any }).fromChapter === null);
t('AI — лише незатверджена пропозиція; автор — затверджено за замовчуванням',
  code(() => checkAppearanceVersion({ ...base, label: 'a', createdBy: 'ai:AI-3', approved: true })) === 'ai_suggests_only' &&
  checkAppearanceVersion({ ...base, label: 'a', createdBy: 'ai:AI-3' }).approved === false &&
  checkAppearanceVersion({ ...base, label: 'a' }).approved === true);
t('відбиток опису не залежить від пробілів і регістру, але від змісту — так',
  appearanceHash('Руде  волосся,\nсірі очі') === appearanceHash('руде волосся, сірі очі ') && appearanceHash('руде') !== appearanceHash('русе'));
const V = (id: string, from: number | null, to: number | null, approved = true, updatedAt = '2026-01-01') => ({ id, fromChapter: from, toChapter: to, approved, updatedAt });
const pick = (list: ReturnType<typeof V>[], n: number | null) => activeAppearanceVersion(list, n)?.id ?? null;
const vs = [V('child', 1, 2), V('adult', 3, null), V('scar', 3, 3), V('draft', 1, null, false)];
t('діюча версія: гл.1 — дитина, гл.3 — «після шраму» (вужча з тим самим початком), гл.4 — доросла, без глави — жодна',
  pick(vs, 1) === 'child' && pick(vs, 3) === 'scar' && pick(vs, 4) === 'adult' && pick(vs, null) === null, [1, 3, 4].map((n) => pick(vs, n)).join());
t('незатверджена не діє; «з початку» програє пізнішому початку',
  pick([V('draft', 1, null, false)], 2) === null && pick([V('all', null, null), V('late', 2, null)], 2) === 'late' && pick([V('all', null, null), V('late', 2, null)], 1) === 'all');

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nВерсії зовнішності (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [
      { id: 'c-o', name: 'Олена', avatarUrl: '/api/media/file/md-olena-card', appearance: { hair: 'руде', eyes: 'сірі' } },
      { id: 'c-m', name: 'Марко' },
    ],
    chapters: [
      { id: 'ch1', title: 'Дитинство', order: 0, sections: [sec('s1', 0, '[/character:Олена] Олена гралась у дворі.')] },
      { id: 'ch2', title: 'Школа', order: 1, sections: [sec('s2', 0, '[/character:Олена] [/character:Марко] Олена і Марко в класі.')] },
      { id: 'ch3', title: 'Війна', order: 2, sections: [sec('s3', 0, '[/character:Олена] Олена повернулась зі шрамом.')] },
      { id: 'ch4', title: 'Мир', order: 3, sections: [sec('s4', 0, '[/character:Олена] Олена вдома.')] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const studio = () => studioFromBook(book, { externalRef: 'studio:character:c-o' } as any);

  const child = await repo.upsertAppearanceVersion({ projectId: P, entityId: olena, label: 'Олена, 8 років', age: '8', fromChapter: 1, toChapter: 2, description: 'Руде волосся в косах', createdBy: 'user:u-owner' });
  const adult = await repo.upsertAppearanceVersion({ projectId: P, entityId: olena, label: '30 років', age: '30', fromChapter: 3, description: 'Коротке руде волосся', createdBy: 'user:u-owner' });
  t('версії створено: затверджені, з відбитком опису, по порядку глав',
    child.approved && adult.approved && child.descriptionHash === appearanceHash('руде волосся в косах') &&
    (await repo.listAppearanceVersions(P, olena)).map((v) => v.label).join('|') === 'Олена, 8 років|30 років');
  t('чужий герой, неіснуюча версія — not_found; перенести версію до іншого героя — bad_input',
    (await codeAsync(() => repo.upsertAppearanceVersion({ projectId: P, entityId: '00000000-0000-4000-8000-000000000000', label: 'x', createdBy: 'user:u' }))) === 'not_found' &&
    (await codeAsync(() => repo.upsertAppearanceVersion({ id: '00000000-0000-4000-8000-000000000000', projectId: P, entityId: olena, label: 'x', createdBy: 'user:u' }))) === 'not_found' &&
    (await codeAsync(() => repo.upsertAppearanceVersion({ id: child.id, projectId: P, entityId: marko, label: 'x', createdBy: 'user:u' }))) === 'bad_input');

  // Портрети: загальний — перенесений з картки; у дитини — свій.
  let p1 = await heroPortrait(repo, P, olena, null, { chapter: 1 });
  t('гл.1 без портрета версії — загальний (перенесений з картки)', p1?.url === '/api/media/file/md-olena-card' && p1?.version === null);
  await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-olena-8', role: 'portrait', entityId: olena, appearanceVersionId: child.id, createdBy: 'user:u-owner' });
  p1 = await heroPortrait(repo, P, olena, null, { chapter: 1 });
  const p3 = await heroPortrait(repo, P, olena, null, { chapter: 3 });
  const p0 = await heroPortrait(repo, P, olena, null);
  t('гл.1 — портрет версії «8 років»; гл.3 (у дорослої ще немає) — загальний, не дитячий; без глави — загальний',
    p1?.url === '/api/media/file/md-olena-8' && p1?.version?.label === 'Олена, 8 років' && p3?.url === '/api/media/file/md-olena-card' && p0?.url === '/api/media/file/md-olena-card');

  // ── Критерій: профіль «стан на главі N» ──
  const prof1 = (await buildCharacterProfile(repo, P, olena, { upto: 1, studio: studio() }))!;
  const prof4 = (await buildCharacterProfile(repo, P, olena, { upto: 4, studio: studio() }))!;
  const profAll = (await buildCharacterProfile(repo, P, olena, { studio: studio() }))!;
  t('КРИТЕРІЙ: профіль «стан на главі 1» — портрет версії «8 років», з її назвою',
    prof1.canon.portraitUrl === '/api/media/file/md-olena-8' && prof1.canon.portraitVersion?.id === child.id, JSON.stringify(prof1.canon.portraitVersion));
  t('профіль на гл.4 і повний — загальний портрет, без версії',
    prof4.canon.portraitUrl === '/api/media/file/md-olena-card' && !prof4.canon.portraitVersion && profAll.canon.portraitUrl === '/api/media/file/md-olena-card');

  // ── Критерій: «Хто в сцені» ──
  const sc1 = (await sceneVisuals(repo, P, 's1'))!;
  const sc2 = (await sceneVisuals(repo, P, 's2'))!;
  const sc3 = (await sceneVisuals(repo, P, 's3'))!;
  t('КРИТЕРІЙ: «Хто в сцені» гл.1 — Олена з дитячим портретом і підписом версії',
    sc1.chapterNumber === 1 && sc1.cast[0].portraitUrl === '/api/media/file/md-olena-8' && sc1.cast[0].versionLabel === 'Олена, 8 років', JSON.stringify(sc1.cast));
  t('гл.2 — теж дитяча; Марко без версій — без підпису; гл.3 — підпис «30 років», портрет загальний',
    sc2.cast.find((c) => c.name === 'Олена')?.portraitUrl === '/api/media/file/md-olena-8' && sc2.cast.find((c) => c.name === 'Марко')?.versionLabel === null &&
    sc3.cast[0].versionLabel === '30 років' && sc3.cast[0].portraitUrl === '/api/media/file/md-olena-card');

  // Перетин і чернетка.
  const scar = await repo.upsertAppearanceVersion({ projectId: P, entityId: olena, label: 'Після шраму', fromChapter: 3, toChapter: 3, description: 'Шрам на щоці', createdBy: 'user:u-owner' });
  const draft = await repo.upsertAppearanceVersion({ projectId: P, entityId: olena, label: 'Чернетка', fromChapter: 4, approved: false, createdBy: 'user:u-owner' });
  await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-olena-scar', role: 'portrait', entityId: olena, appearanceVersionId: scar.id, createdBy: 'user:u-owner' });
  t('гл.3 — вужча «Після шраму» зі своїм портретом; гл.4 — чернетка не діє, діє «30 років»',
    (await heroPortrait(repo, P, olena, null, { chapter: 3 }))?.url === '/api/media/file/md-olena-scar' &&
    (await sceneVisuals(repo, P, 's4'))!.cast[0].versionLabel === '30 років');

  // Стрічка версій.
  const card = { description: 'волосся: руде; очі: сірі', portraitUrl: '/api/media/file/md-olena-card' };
  const all = await appearanceOverview(repo, P, olena, card);
  const at2 = await appearanceOverview(repo, P, olena, card, 2);
  t('стрічка: основа з картки, 4 версії, перетин «30 років» ↔ «Після шраму», у дитини — свій портрет',
    all.base.description === card.description && all.base.portraitUrl === '/api/media/file/md-olena-card' && all.versions.length === 4 &&
    all.versions.find((v) => v.id === adult.id)!.overlapsWith.join() === scar.id && all.versions.find((v) => v.id === child.id)!.portraitUrl === '/api/media/file/md-olena-8' &&
    all.versions.find((v) => v.id === draft.id)!.overlapsWith.length === 0 && all.activeId === null);
  t('стрічка «стан на главі 2»: лише версії, що вже почались, діюча — дитина; опис картки прихований (як канон)',
    at2.versions.map((v) => v.id).join() === child.id && at2.activeId === child.id && at2.versions[0].active && at2.base.description === '');

  // Зміна, історія, видалення.
  const upd = await repo.upsertAppearanceVersion({ id: adult.id, projectId: P, entityId: olena, label: '30 років', fromChapter: 3, description: 'Коротке сиве волосся', createdBy: 'user:u-owner' });
  t('зміна опису — новий відбиток, та сама версія', upd.id === adult.id && upd.descriptionHash !== adult.descriptionHash && upd.createdAt === adult.createdAt);
  const childLink = (await repo.listAssetLinks(P, { entityId: olena })).find((l) => l.appearanceVersionId === child.id)!;
  t('видалення версії — true; повторно — false', (await repo.deleteAppearanceVersion(P, child.id, 'user:u-owner')) && !(await repo.deleteAppearanceVersion(P, child.id, 'user:u-owner')));
  const after = await repo.getAssetLink(P, childLink.id);
  t('портрет видаленої версії лишився — уже загальним портретом героя', after?.appearanceVersionId === null && after.assetUrl === '/api/media/file/md-olena-8');
  const hist = await repo.listAppearanceHistory(P, olena);
  t('історія: створення, зміна, видалення — новіші першими, зі знімком',
    hist[0].action === 'deleted' && (hist[0].snapshot as any).label === 'Олена, 8 років' && hist.some((h) => h.action === 'updated' && h.versionId === adult.id) && hist.filter((h) => h.action === 'created').length === 4, hist.map((h) => h.action).join());

  // Зв'язок із позначкою версії.
  t('позначка версії: для сцени чи локації — bad_input; версія іншого героя — bad_input; невідома — not_found',
    (await codeAsync(() => repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/x', role: 'scene', sectionId: 's1', appearanceVersionId: adult.id, createdBy: 'user:u' }))) === 'bad_input' &&
    (await codeAsync(() => repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/x', role: 'portrait', entityId: marko, appearanceVersionId: adult.id, createdBy: 'user:u' }))) === 'bad_input' &&
    (await codeAsync(() => repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/x', role: 'portrait', entityId: olena, appearanceVersionId: '00000000-0000-4000-8000-000000000000', createdBy: 'user:u' }))) === 'not_found');
  const scarLink = (await repo.listAssetLinks(P, { entityId: olena })).find((l) => l.appearanceVersionId === scar.id)!;
  const kept = await repo.upsertAssetLink({ projectId: P, assetUrl: scarLink.assetUrl, role: 'portrait', entityId: olena, note: 'шрам', createdBy: 'user:u-owner' });
  const cleared = await repo.upsertAssetLink({ projectId: P, assetUrl: scarLink.assetUrl, role: 'portrait', entityId: olena, appearanceVersionId: null, createdBy: 'user:u-owner' });
  t('оновлення зв\'язку без позначки — версія лишається; null — знімається', kept.appearanceVersionId === scar.id && cleared.appearanceVersionId === null);
  const sync2 = await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  t('синхронізація книги не чіпає версій і їхніх портретів', (await repo.listAppearanceVersions(P, olena)).length === 3 && sync2.assets.unlinked === 0);

  // ── Маршрути ──
  console.log(`\nМаршрути версій (${label}):`);
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false }, stranger: { id: 'u-x', role: 'writer', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', studio: async (_p, entity) => studioFromBook(book, entity) });
  const server = app.listen(0);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${baseUrl}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const g = await call('GET', `/visual/appearance/${marko}`, 'reader');
  t('GET: читачу видно, без права змін; основа — з картки (у Марка порожня); 4 глави', g.status === 200 && g.body.canEdit === false && g.body.versions.length === 0 && g.body.chapters.length === 4 && g.body.entity.name === 'Марко');
  t('GET: чужому — 403; не герой чи невідомий — 404',
    (await call('GET', `/visual/appearance/${marko}`, 'stranger')).status === 403 &&
    (await call('GET', '/visual/appearance/00000000-0000-4000-8000-000000000000', 'reader')).status === 404);
  const mk = await call('POST', `/visual/appearance/${olena}`, 'owner', { label: 'Юність', age: 16, fromChapter: 2, toChapter: 2 });
  t('POST без опису — опис із картки героя (канон автора), затверджено, від автора',
    mk.status === 201 && mk.body.version.description === 'волосся: руде; очі: сірі' && mk.body.version.approved && mk.body.version.createdBy === 'user:u-owner' && mk.body.version.age === '16', JSON.stringify(mk.body));
  t('POST: читачу — 403; погані глави — 422; не герой — 404',
    (await call('POST', `/visual/appearance/${olena}`, 'reader', { label: 'x' })).status === 403 &&
    (await call('POST', `/visual/appearance/${olena}`, 'owner', { label: 'x', fromChapter: 3, toChapter: 1 })).status === 422 &&
    (await call('POST', '/visual/appearance/00000000-0000-4000-8000-000000000000', 'owner', { label: 'x' })).status === 404);
  const vid = mk.body.version.id;
  const pa = await call('PATCH', `/visual/appearance/${olena}/versions/${vid}`, 'owner', { description: 'Руде волосся, підліток', toChapter: null });
  t('PATCH: лише передане змінюється (назва, «від» лишились; «до» — знято)', pa.status === 200 && pa.body.version.label === 'Юність' && pa.body.version.fromChapter === 2 && pa.body.version.toChapter === null && pa.body.version.description === 'Руде волосся, підліток');
  t('PATCH версії іншого героя за чужим шляхом — 404', (await call('PATCH', `/visual/appearance/${marko}/versions/${vid}`, 'owner', { label: 'x' })).status === 404);
  const pp = await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'owner', { assetUrl: '/api/media/file/md-olena-16' });
  t('PUT портрет: зв\'язок «портрет» героя з позначкою версії і її назвою', pp.status === 200 && pp.body.link.appearanceVersionId === vid && pp.body.link.versionLabel === 'Юність' && pp.body.link.source === 'author');
  const scene2 = await call('GET', '/visual/scene?sectionId=s2', 'reader');
  t('«Хто в сцені» гл.2 через маршрут — портрет «Юність»', scene2.body.cast.find((c: any) => c.name === 'Олена').portraitUrl === '/api/media/file/md-olena-16' && scene2.body.cast.find((c: any) => c.name === 'Олена').versionLabel === 'Юність');
  const prof = await call('GET', `/characters/${olena}/profile?chapter=2`, 'reader');
  t('профіль через маршрут на гл.2 — той самий портрет версії', prof.body.canon.portraitUrl === '/api/media/file/md-olena-16' && prof.body.canon.portraitVersion?.label === 'Юність');
  const pp2 = await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'owner', { assetUrl: '/api/media/file/md-olena-16b' });
  const olenaLinks = await repo.listAssetLinks(P, { entityId: olena });
  t('заміна портрета версії — старий (від автора) відв\'язано, новий діє',
    pp2.status === 200 && !olenaLinks.some((l) => l.assetUrl === '/api/media/file/md-olena-16') && olenaLinks.some((l) => l.assetUrl === '/api/media/file/md-olena-16b' && l.appearanceVersionId === vid));
  const legacyLink = olenaLinks.find((l) => l.source === 'legacy')!;
  const pp3 = await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'owner', { assetUrl: legacyLink.assetUrl });
  t('портрет з картки для версії — той самий перенесений зв\'язок (лишається «з книги»)', pp3.body.link.id === legacyLink.id && pp3.body.link.source === 'legacy' && pp3.body.link.appearanceVersionId === vid);
  const rm = await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'owner', { assetUrl: null });
  t('прибрати портрет версії: перенесений стає загальним (не видаляється)', rm.status === 200 && rm.body.link === null && (await repo.getAssetLink(P, legacyLink.id))?.appearanceVersionId === null);
  t('PUT: data:-URL — 400; читачу — 403',
    (await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'owner', { assetUrl: 'data:image/png;base64,AA' })).status === 400 &&
    (await call('PUT', `/visual/appearance/${olena}/versions/${vid}/portrait`, 'reader', { assetUrl: '/api/media/file/y' })).status === 403);
  const ln = await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-full', role: 'full_body', entityId: olena, appearanceVersionId: vid });
  t('POST links з версією: повний зріст «Юності» — 201; версія до ролі «локація» чи чужого героя — 400',
    ln.status === 201 && ln.body.link.versionLabel === 'Юність' &&
    (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-full', role: 'portrait', entityId: marko, appearanceVersionId: vid })).status === 400 &&
    (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-full', role: 'depicts', entityId: olena, appearanceVersionId: vid })).status === 400);
  const g2 = await call('GET', `/visual/appearance/${olena}?chapter=2`, 'owner');
  t('GET ?chapter=2: діюча — «Юність» (пізніший початок), версії з гл.3 приховані; історія є',
    g2.body.activeId === vid && g2.body.upto === 2 && g2.body.versions.every((v: any) => (v.fromChapter ?? 0) <= 2) && g2.body.history.some((h: any) => h.action === 'portrait') && g2.body.canEdit === true);
  t('DELETE: читачу — 403; власнику — ok; повторно — 404',
    (await call('DELETE', `/visual/appearance/${olena}/versions/${vid}`, 'reader')).status === 403 &&
    (await call('DELETE', `/visual/appearance/${olena}/versions/${vid}`, 'owner')).body.ok === true &&
    (await call('DELETE', `/visual/appearance/${olena}/versions/${vid}`, 'owner')).status === 404);
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
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — v11 (версії зовнішності)', Number(rows[0].v) === 11, `v${rows[0].v}`);
    await suite('postgres', new PgCoreRepository(pool), 'book-p');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

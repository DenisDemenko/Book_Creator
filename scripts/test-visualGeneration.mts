/**
 * Генерація зображення від сутності — Т2.3 В6.
 *
 * PLAN_VISUAL_LIBRARY.md §3 В6: лише за командою автора; промпт — із
 * затвердженого опису (версія зовнішності чи картка героя), референси — уже
 * прив'язані зображення сутності (тієї ж версії й загальні; інших версій і
 * позначених «перевірити» — ні); результат одразу прив'язаний (джерело —
 * автор), звірений з описом, з якого генерували; опис змінився за час
 * генерації — «перевірити». Модель і черга — підставні (виклик моделі живе в
 * сервері Студії й перевіряється живим прогоном).
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:visual-generation
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { registerProjectRoutes, type VisualGenerationDeps } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { studioFromBook, studioAppearanceText } from '../server/core/characterProfile.ts';
import { cardAppearanceHash } from '../server/core/visual.ts';
import {
  defaultGenerationRole,
  generationPrompt,
  generationRolesFor,
  isMediaFileUrl,
  type GenerationTarget,
} from '../server/core/visualGeneration.ts';
import type { CoreRepository, EntityRow } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nРоль, ролі й промпт:');
t('роль за замовчуванням: герой — портрет, локація — локація, предмет — предмет, група — «зображено»',
  defaultGenerationRole('character') === 'portrait' && defaultGenerationRole('location') === 'location' && defaultGenerationRole('weapon') === 'object' && defaultGenerationRole('group') === 'depicts');
t('ролі: герою — портрет, повний зріст, референс (не «зображено»); локації — референс, «зображено», локація',
  generationRolesFor('character', false).join() === 'portrait,full_body,reference' && generationRolesFor('character', true).join() === 'portrait,full_body,reference' &&
  generationRolesFor('location', false).join() === 'reference,depicts,location' && generationRolesFor('object', false).join() === 'reference,depicts,object');
t('референсом — лише файл Медіатеки', isMediaFileUrl('/api/media/file/md-1') && !isMediaFileUrl('https://x/y.png') && !isMediaFileUrl('data:image/png;base64,AA') && !isMediaFileUrl('/api/media/file/../x'));
const ent = (type: string, name: string) => ({ id: 'e', projectId: 'p', type, name, canonical: {}, status: 'confirmed', version: 1, externalRef: null, createdBy: 'user:u', createdAt: '', updatedAt: '' }) as EntityRow;
const tv: GenerationTarget = { projectId: 'p', entity: ent('character', 'Олена'), role: 'portrait', version: { id: 'v', projectId: 'p', entityId: 'e', label: 'Олена, 8 років', age: '8', fromChapter: 1, toChapter: 2, description: 'x', descriptionHash: 'h', approved: true, createdBy: 'user:u', createdAt: '', updatedAt: '' } };
const pv = generationPrompt(tv, 'Дві руді коси; веснянки.', true);
t('промпт версії: роль, ім\'я, версія з віком, опис, «збережи схожість»',
  pv.startsWith('Портрет персонажа «Олена» — Олена, 8 років (вік: 8).') && pv.includes('Зовнішність: Дві руді коси; веснянки.') && pv.includes('збережи схожість'), pv);
const pl = generationPrompt({ projectId: 'p', entity: ent('location', 'Київ'), role: 'location', version: null }, '', false);
t('промпт локації без опису й референсів — лише назва', pl === 'Локація «Київ».', pl);

async function suite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nГенерація від сутності (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: `Розділ ${id}`, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [
      { id: 'c-o', name: 'Олена', avatarUrl: '/api/media/file/md-card', appearance: { hair: 'руде', eyes: 'сірі' } },
      { id: 'c-m', name: 'Марко' },
    ],
    chapters: [
      { id: 'ch1', title: 'Перша', order: 0, sections: [sec('s1', 0, '[/character:Олена] [/character:Марко] [/location:Київ] [/object:Меч] [/emotion:страх @Олена] Олена з мечем у Києві.')] },
      { id: 'ch2', title: 'Друга', order: 1, sections: [sec('s2', 0, 'Далі.')] },
      { id: 'ch3', title: 'Третя', order: 2, sections: [sec('s3', 0, 'Ще далі.')] },
    ],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const kyiv = (await repo.resolveAlias(P, 'location', 'Київ'))!;
  const fear = (await repo.resolveAlias(P, 'emotion', 'страх'))!;

  // ── Підставні генерація й референси ──
  const owners: Record<string, string> = {};
  for (const id of ['md-card', 'md-v8', 'md-full', 'md-adult', 'md-flag', 'md-scene', 'md-kyiv']) owners[`/api/media/file/${id}`] = 'u-owner';
  owners['/api/media/file/md-alien'] = 'u-x';
  const refCalls: string[] = [];
  const started: Array<Parameters<VisualGenerationDeps['start']>[1]> = [];
  const gen: VisualGenerationDeps = {
    guards: [(req, res, next) => (req.headers['x-quota'] === 'over' ? void res.status(402).json({ kind: 'quota_exceeded', error: 'ліміт' }) : next())],
    maxReferences: 10,
    referenceUrl: async (_req, _p, url, actor) => {
      refCalls.push(url);
      const o = owners[url];
      return o && (o === actor.replace(/^user:/, '') || o === 'u-owner') ? `https://pub.example/ref/${url.split('/').pop()}` : null;
    },
    start: async (_req, p) => {
      started.push(p);
      return `imgjob_${started.length}`;
    },
  };
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const mk = (withGen: boolean) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
    registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', studio: async (_p, e) => studioFromBook(book, e), ...(withGen ? { visualGeneration: gen } : {}) });
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
    const call = async (method: string, path: string, user: string, body?: unknown, headers: Record<string, string> = {}) => {
      const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
      return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
    };
    return { server, call };
  };
  const { server, call } = mk(true);

  // ── Версії й прив'язки героя ──
  const v8 = (await call('POST', `/visual/appearance/${olena}`, 'owner', { label: 'Олена, 8 років', age: '8', fromChapter: 1, toChapter: 2, description: 'Дві руді коси, веснянки' })).body.version;
  const adult = (await call('POST', `/visual/appearance/${olena}`, 'owner', { label: 'Доросла', fromChapter: 3, description: 'Коротке руде волосся' })).body.version;
  const draft = (await call('POST', `/visual/appearance/${olena}`, 'owner', { label: 'Чернетка', description: 'ще не знаю', approved: false })).body.version;
  await call('PUT', `/visual/appearance/${olena}/versions/${v8.id}/portrait`, 'owner', { assetUrl: '/api/media/file/md-v8' });
  await call('PUT', `/visual/appearance/${olena}/versions/${adult.id}/portrait`, 'owner', { assetUrl: '/api/media/file/md-adult' });
  await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-full', role: 'full_body', entityId: olena });
  const flag = (await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-flag', role: 'reference', entityId: olena })).body.link;
  await repo.setAssetLinkReview(P, flag.id, { needsReview: true });
  await call('POST', '/visual/links', 'owner', { assetUrl: '/api/media/file/md-scene', role: 'depicts', entityId: olena });
  await call('POST', '/visual/links', 'owner', { assetUrl: 'https://cdn.example/olena.png', role: 'portrait', entityId: olena });
  t('підготовка: версії й прив\'язки героя', !!v8?.id && !!adult?.id && draft?.approved === false && !!flag?.id);

  // ── Що буде згенеровано ──
  t('опис: читачу — 403; емоція (без вигляду) — 422; невідома — 404',
    (await call('GET', `/visual/generation-brief?entityId=${olena}`, 'reader')).status === 403 &&
    (await call('GET', `/visual/generation-brief?entityId=${fear}`, 'owner')).status === 422 &&
    (await call('GET', '/visual/generation-brief?entityId=nope', 'owner')).status === 404);
  t('опис: чернетка версії — 422; версія до локації — 422; портрет локації — 422; версія іншого героя — 404',
    (await call('GET', `/visual/generation-brief?entityId=${olena}&versionId=${draft.id}`, 'owner')).status === 422 &&
    (await call('GET', `/visual/generation-brief?entityId=${olena}&versionId=${v8.id}&role=depicts`, 'owner')).status === 422 &&
    (await call('GET', `/visual/generation-brief?entityId=${kyiv}&role=portrait`, 'owner')).status === 422 &&
    (await call('GET', `/visual/generation-brief?entityId=${marko}&versionId=${v8.id}`, 'owner')).status === 404);
  const bBase = (await call('GET', `/visual/generation-brief?entityId=${olena}`, 'owner')).body;
  t('за карткою: портрет, опис з картки, промпт з ним і «схожістю»',
    bBase.role === 'portrait' && bBase.description === 'волосся: руде; очі: сірі' && bBase.prompt.includes('«Олена»') && bBase.prompt.includes('волосся: руде; очі: сірі') && bBase.prompt.includes('схожість') && bBase.available === true && bBase.version === null, bBase.prompt);
  t('референси за карткою: загальні портрет і повний зріст; інших версій, «перевірити», «зображено», зовнішні — ні',
    bBase.references.map((r: any) => r.assetUrl).join() === '/api/media/file/md-card,/api/media/file/md-full', bBase.references.map((r: any) => r.assetUrl).join());
  const bV8 = (await call('GET', `/visual/generation-brief?entityId=${olena}&versionId=${v8.id}`, 'owner')).body;
  t('КРИТЕРІЙ: за версією — опис версії, у промпті версія й вік; референси — спершу портрет версії, далі загальні, «Доросла» — ні',
    bV8.description === 'Дві руді коси, веснянки' && bV8.prompt.includes('Олена, 8 років (вік: 8)') && bV8.prompt.includes('Дві руді коси') &&
    bV8.references.map((r: any) => r.assetUrl).join() === '/api/media/file/md-v8,/api/media/file/md-card,/api/media/file/md-full' && bV8.references[0].versionLabel === 'Олена, 8 років', bV8.references.map((r: any) => r.assetUrl).join());
  const bMarko = (await call('GET', `/visual/generation-brief?entityId=${marko}`, 'owner')).body;
  t('герой без опису — «опису немає», без референсів, промпт без «схожості»',
    bMarko.missingDescription === true && bMarko.references.length === 0 && !bMarko.prompt.includes('схожість') && bMarko.prompt === 'Портрет персонажа «Марко».', bMarko.prompt);
  const bKyiv = (await call('GET', `/visual/generation-brief?entityId=${kyiv}`, 'owner')).body;
  t('локація — роль «локація», ролі для неї, опису не треба', bKyiv.role === 'location' && bKyiv.roles.join() === 'reference,depicts,location' && bKyiv.missingDescription === false && bKyiv.prompt === 'Локація «Київ».');

  // ── Згенерувати: права й перевірки до черги ──
  const body = (extra: object = {}) => ({ entityId: olena, appearanceVersionId: v8.id, prompt: 'Портрет Олени', referenceAssets: ['/api/media/file/md-v8', '/api/media/file/md-card'], ...extra });
  t('генерувати: читачу — 403; квота — 402 (перевірки тарифу перед ядром); без промпту — 400',
    (await call('POST', '/visual/generate', 'reader', body())).status === 403 &&
    (await call('POST', '/visual/generate', 'owner', body(), { 'x-quota': 'over' })).status === 402 &&
    (await call('POST', '/visual/generate', 'owner', body({ prompt: '  ' }))).status === 400);
  const refsBefore = refCalls.length;
  t('референси: чужий файл, data:, зовнішній — 400; більше 4 — 400; чернетка версії — 422; нічого не поставлено',
    (await call('POST', '/visual/generate', 'owner', body({ referenceAssets: ['/api/media/file/md-alien'] }))).status === 400 &&
    (await call('POST', '/visual/generate', 'owner', body({ referenceAssets: ['data:image/png;base64,AA'] }))).status === 400 &&
    (await call('POST', '/visual/generate', 'owner', body({ referenceAssets: ['https://cdn.example/olena.png'] }))).status === 400 &&
    (await call('POST', '/visual/generate', 'owner', body({ referenceAssets: Array(5).fill('/api/media/file/md-card') }))).status === 400 &&
    (await call('POST', '/visual/generate', 'owner', body({ appearanceVersionId: draft.id }))).status === 422 &&
    started.length === 0 && refCalls.length === refsBefore + 1);

  // ── Портрет версії ──
  const g1 = await call('POST', '/visual/generate', 'owner', body({ prompt: 'Портрет Олени, 8 років', engine: 'nano-banana-2', aspectRatio: '3:4' }));
  const s1 = started[0];
  t('поставлено: 202 з id задачі; модель отримала промпт, публічні копії референсів, книгу, ім\'я файлу героя',
    g1.status === 202 && g1.body.jobId === 'imgjob_1' && g1.body.references === 2 && s1.prompt === 'Портрет Олени, 8 років' && s1.engine === 'nano-banana-2' && s1.aspectRatio === '3:4' &&
    s1.referenceImageUrls.join() === 'https://pub.example/ref/md-v8,https://pub.example/ref/md-card' && s1.bookId === P && s1.filenameHint === 'char-Олена' && s1.label.includes('Олена, 8 років'), JSON.stringify({ ...s1, onGenerated: undefined }));
  const l1 = (await s1.onGenerated('/api/media/file/gen-v8')) as any;
  const row1 = (await repo.getAssetLink(P, l1.id))!;
  t('готове зображення прив\'язане: портрет версії, від автора, підтверджено, звірено з описом версії',
    l1.role === 'portrait' && l1.versionLabel === 'Олена, 8 років' && l1.needsReview === false &&
    row1.source === 'author' && row1.status === 'confirmed' && row1.createdBy === 'user:u-owner' && row1.appearanceVersionId === v8.id && row1.checkedHash === v8.descriptionHash && row1.assetUrl === '/api/media/file/gen-v8');
  const av1 = (await call('GET', `/visual/appearance/${olena}?chapter=1`, 'owner')).body;
  t('КРИТЕРІЙ: «стан на главі 1» — портрет версії вже згенерований (новіший авторський), в історії версії — «портрет»',
    av1.versions.find((v: any) => v.id === v8.id)?.portraitUrl === '/api/media/file/gen-v8' &&
    av1.history.some((h: any) => h.versionId === v8.id && h.action === 'portrait'), av1.versions.find((v: any) => v.id === v8.id)?.portraitUrl);
  const bV8b = (await call('GET', `/visual/generation-brief?entityId=${olena}&versionId=${v8.id}`, 'owner')).body;
  t('наступна генерація бере згенероване референсом', bV8b.references[0].assetUrl === '/api/media/file/gen-v8');

  // ── За карткою; опис змінився, поки генерувалось ──
  const g2 = await call('POST', '/visual/generate', 'owner', { entityId: olena, role: 'full_body', prompt: 'Олена у повний зріст', referenceAssets: [] });
  const oldCard = cardAppearanceHash(studioAppearanceText(book.characters[0]));
  book.characters[0].appearance.hair = 'чорне';
  const l2 = (await started[1].onGenerated('/api/media/file/gen-full')) as any;
  const row2 = (await repo.getAssetLink(P, l2.id))!;
  t('КРИТЕРІЙ: опис картки змінився за час генерації — прив\'язано, звірено зі старим описом, «перевірити»',
    g2.status === 202 && l2.role === 'full_body' && l2.needsReview === true && row2.needsReview && row2.checkedHash === oldCard && row2.appearanceVersionId === null);
  const bBase2 = (await call('GET', `/visual/generation-brief?entityId=${olena}`, 'owner')).body;
  t('позначене «перевірити» референсом не йде', !bBase2.references.some((r: any) => r.assetUrl === '/api/media/file/gen-full') && bBase2.description.includes('чорне'));

  // ── Версію видалили, поки генерувалось ──
  await call('POST', '/visual/generate', 'owner', body({ referenceAssets: [] }));
  await call('DELETE', `/visual/appearance/${olena}/versions/${v8.id}`, 'owner');
  const l3 = (await started[2].onGenerated('/api/media/file/gen-gone')) as any;
  const row3 = (await repo.getAssetLink(P, l3.id))!;
  t('версію видалили під час генерації — загальний портрет, звірений з описом версії, отже «перевірити»',
    row3.appearanceVersionId === null && l3.versionLabel === null && row3.needsReview === true && row3.checkedHash === v8.descriptionHash);

  // ── Локація ──
  const g4 = await call('POST', '/visual/generate', 'owner', { entityId: kyiv, prompt: 'Київ на світанку', referenceAssets: ['/api/media/file/md-kyiv'] });
  const l4 = (await started[3].onGenerated('/api/media/file/gen-kyiv')) as any;
  const row4 = (await repo.getAssetLink(P, l4.id))!;
  t('локація: роль «локація», файл — не героя, без відбитка опису й позначки',
    g4.status === 202 && started[3].filenameHint === 'entity' && row4.role === 'location' && row4.entityId === kyiv && row4.checkedHash === null && !row4.needsReview && row4.source === 'author');
  const links = await call('GET', `/visual/links?assetUrl=${encodeURIComponent('/api/media/file/gen-kyiv')}`, 'reader');
  t('у Медіатеці зв\'язок згенерованого видно (читачу теж)', links.body.links?.[0]?.role === 'location' && links.body.links[0].targetName === 'Київ', JSON.stringify(links.body.links?.[0]));
  server.close();

  // ── Сервер без генерації ──
  const off = mk(false);
  const bOff = await off.call('GET', `/visual/generation-brief?entityId=${olena}`, 'owner');
  const gOff = await off.call('POST', '/visual/generate', 'owner', { entityId: olena, prompt: 'x' });
  t('генерацію вимкнено на сервері: опис є, «доступно» — ні; генерувати — 503', bOff.status === 200 && bOff.body.available === false && gOff.status === 503);
  off.server.close();
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

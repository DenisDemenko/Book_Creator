/**
 * AI-3 у бібліотеці ілюстрацій — розпізнавання й звірка з описом, Т2.3 В4.
 *
 * PLAN_VISUAL_LIBRARY.md §3 В4: лише за командою (фонова задача `ai_visual`);
 * AI-3 отримує зображення + сутності книги + затверджені описи й повертає
 * `visual_link` (зв'язок-пропозиція, затверджує автор; відхилене — назавжди),
 * `visual_trait`, `visual_mismatch`, кожен з доказом-зображенням. «Звірити з
 * описом» — збіги, розбіжності, «недостатньо даних»; збіг знімає «перевірити»
 * (В5), розбіжність ставить. AI бачить лише файли Медіатеки автора чи
 * власника книги. Модель — підставна.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:visual-ai
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import type { JobStore } from '../server/core/jobs/types.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { studioFromBook } from '../server/core/characterProfile.ts';
import { CoreRuleError } from '../server/core/rules.ts';
import {
  AI_VISUAL_JOB_KIND,
  aiVisualJobKind,
  compareTask,
  compareVerdict,
  recognizeTask,
  suggestedRoleFor,
} from '../server/core/visualAi.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nЗавдання й підсумки AI-3:');
t('роль пропозиції: локація → «локація», предмет → «предмет», герой → «зображено» (портрет — рішення автора)',
  suggestedRoleFor('location') === 'location' && suggestedRoleFor('object') === 'object' && suggestedRoleFor('character') === 'depicts' && suggestedRoleFor('group') === 'depicts');
const rt = recognizeTask('/api/media/file/x', [{ type: 'character', name: 'Олена' }, { type: 'location', name: 'Київ' }], [
  { entityId: 'e', name: 'Олена', card: 'волосся: руде', versions: [{ label: '8 років', chapters: 'гл. 1–2', description: 'коси' }] },
]);
t('«Розпізнати»: перелік сутностей, опис картки й версії, id зображення як доказ',
  rt.includes('- character: Олена') && rt.includes('- location: Київ') && rt.includes('волосся: руде') && rt.includes('версія «8 років» (гл. 1–2): коси') && rt.includes('image_ids: ["/api/media/file/x"]'));
const ct = compareTask('/api/media/file/x', 'Олена', '8 років', 'руде волосся');
t('«Звірити з описом»: герой, версія, опис, три види висновків', ct.includes('«Олена»') && ct.includes('версія «8 років»') && ct.includes('руде волосся') && ct.includes('visual_unknown'));
t('підсумок звірки: є розбіжність → mismatch; лише збіги → match; нічого не видно → insufficient',
  compareVerdict([{ kind: 'visual_match' }, { kind: 'visual_mismatch' }]) === 'mismatch' && compareVerdict([{ kind: 'visual_match' }, { kind: 'visual_unknown' }]) === 'match' && compareVerdict([{ kind: 'visual_unknown' }]) === 'insufficient' && compareVerdict([]) === 'insufficient');

async function suite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nAI-3 — розпізнавання й звірка (${label}):`);
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
    chapters: [{ id: 'ch1', title: 'Перша', order: 0, sections: [sec('s1', 0, '[/character:Олена] [/location:Київ] [/object:Меч] [/emotion:страх @Олена] Олена з мечем у Києві.')] }],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const kyiv = (await repo.resolveAlias(P, 'location', 'Київ'))!;
  const sword = (await repo.resolveAlias(P, 'object', 'Меч'))!;

  // ── Правила: AI лише пропонує ──
  const code = async (patch: object) => {
    try {
      await repo.upsertAssetLink({ projectId: P, assetUrl: '/api/media/file/md-rule', role: 'location', entityId: kyiv, createdBy: 'user:u', ...patch } as any);
      return 'ok';
    } catch (e) {
      return e instanceof CoreRuleError ? e.code : String(e);
    }
  };
  t('правила: AI не підтверджує; «пропозицію AI» не пише користувач; автор затверджує пропозицію AI',
    (await code({ source: 'ai', status: 'confirmed', createdBy: 'ai:AI-3' })) === 'ai_suggests_only' &&
    (await code({ source: 'ai', status: 'suggested', createdBy: 'user:u' })) === 'ai_suggests_only' &&
    (await code({ source: 'ai', status: 'confirmed', createdBy: 'user:u' })) === 'ok');
  await repo.deleteAssetLink(P, (await repo.listAssetLinks(P, { assetUrl: '/api/media/file/md-rule' }))[0].id);

  // ── Підставна модель і черга ──
  const calls: AiGenerateInput[] = [];
  let answer: (input: AiGenerateInput) => object = () => ({ findings: [] });
  const generate = async (input: AiGenerateInput) => {
    calls.push(input);
    return { text: JSON.stringify(answer(input)), modelId: 'fake-ai3', engine: 'fake', inputTokens: 300, outputTokens: 80, costUsd: 0.002 };
  };
  const images: Record<string, string> = { '/api/media/file/md-scene': 'u-owner', '/api/media/file/md-card': 'u-owner', '/api/media/file/md-full': 'u-owner', '/api/media/file/md-alien': 'u-x' };
  const loadImage = async (_p: string, url: string, actor: string) => {
    const owner = images[url];
    if (!owner || (owner !== actor.replace(/^user:/, '') && owner !== 'u-owner')) return null;
    return { mimeType: 'image/png', data: Buffer.from(`png:${url}`).toString('base64') };
  };
  let clock = Date.parse('2026-09-26T12:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_VISUAL_JOB_KIND, aiVisualJobKind({ repo: () => repo, generate, resolveModel: async () => 'fake-ai3', loadImage, loadStudio: async (_p, e) => studioFromBook(book, e) }));
  const drain = async () => {
    await q.runOnce();
    clock += 61_000;
  };

  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'reader', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', queue: () => q, studio: async (_p, e) => studioFromBook(book, e), visualImage: loadImage });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const job = async (jobId: string) => {
    await drain();
    return (await call('GET', `/jobs/${jobId}`, 'owner')).body;
  };

  // ── «Розпізнати» ──
  const SCENE = '/api/media/file/md-scene';
  t('«Розпізнати»: читачу — 403; чужий файл, data:, не з Медіатеки — 400',
    (await call('POST', '/visual/recognize', 'reader', { assetUrl: SCENE })).status === 403 &&
    (await call('POST', '/visual/recognize', 'owner', { assetUrl: '/api/media/file/md-alien' })).status === 400 &&
    (await call('POST', '/visual/recognize', 'owner', { assetUrl: 'data:image/png;base64,AA' })).status === 400 &&
    (await call('POST', '/visual/recognize', 'owner', { assetUrl: '/api/media/file/md-none' })).status === 400);
  answer = (input) => {
    const id = input.images?.[0]?.id ?? '';
    return { findings: [
      { kind: 'visual_link', entity_type: 'character', entity_name: 'Олена', summary: 'Руда жінка з мечем — схоже, Олена.', image_ids: [id], confidence: 0.8 },
      { kind: 'visual_link', entity_type: 'location', entity_name: 'Київ', summary: 'Міст і Лавра — Київ.', image_ids: [id], confidence: 0.7 },
      { kind: 'visual_link', entity_type: 'object', entity_name: 'Меч', summary: 'Меч у руці.', image_ids: [id], confidence: 0.9 },
      { kind: 'visual_link', entity_type: 'character', entity_name: 'Незнайомець', summary: 'Хтось ще.', image_ids: [id], confidence: 0.3 },
      { kind: 'visual_link', entity_type: 'location', entity_name: 'Львів', summary: 'Без доказу.', image_ids: [], confidence: 0.3 },
      { kind: 'visual_trait', entity_type: 'character', entity_name: 'Олена', field: 'hair', summary: 'Руде волосся до плечей.', image_ids: [id], confidence: 0.8 },
      { kind: 'visual_mismatch', entity_type: 'character', entity_name: 'Олена', field: 'eyes', summary: 'На зображенні карі очі, в описі — сірі.', image_ids: [id], confidence: 0.6 },
    ] };
  };
  const r1 = await call('POST', '/visual/recognize', 'owner', { assetUrl: SCENE });
  const j1 = await job(r1.body.jobId);
  const sent = calls[calls.length - 1];
  t('задача AI-3: одна картинка з Медіатеки, у завданні — сутності (без емоцій) і опис картки Олени',
    r1.status === 202 && sent.module === 'coreAi3Visual' && sent.images?.length === 1 && sent.images[0].id === SCENE &&
    sent.user.includes('character: Олена') && sent.user.includes('object: Меч') && !sent.user.includes('emotion:') && sent.user.includes('волосся: руде'), sent.user.slice(0, 120));
  t('підсумок: 3 пропозиції прив\'язок (невідома сутність і без доказу — ні), ознака, розбіжність',
    j1.status === 'succeeded' && j1.result.suggestedLinks === 3 && j1.result.traits === 1 && j1.result.mismatches === 1, JSON.stringify(j1.result));
  const sugg = await repo.listAssetLinks(P, { assetUrl: SCENE });
  t('пропозиції — suggested, від AI-3, з доказом-висновком: Олена «зображено», Київ «локація», Меч «предмет»',
    sugg.length === 3 && sugg.every((l) => l.status === 'suggested' && l.source === 'ai' && l.createdBy === 'ai:AI-3' && l.evidence.length === 1) &&
    sugg.some((l) => l.entityId === olena && l.role === 'depicts') && sugg.some((l) => l.entityId === kyiv && l.role === 'location') && sugg.some((l) => l.entityId === sword && l.role === 'object'));
  const findings = (await repo.listFindings(P)).filter((f) => f.kind.startsWith('visual_'));
  t('висновки AI-3 — пропозиції з доказом-зображенням', findings.length === 5 && findings.every((f) => f.status === 'suggested' && f.sourceAssetIds.join() === SCENE && f.createdBy === 'ai:AI-3'));
  const an = await call('GET', `/visual/analysis?assetUrl=${encodeURIComponent(SCENE)}`, 'reader');
  t('GET analysis: останнє розпізнавання — ознака й розбіжність (читачу видно)',
    an.status === 200 && an.body.recognize.some((i: any) => i.kind === 'visual_trait' && i.field === 'hair') && an.body.recognize.some((i: any) => i.kind === 'visual_mismatch' && /карі/.test(i.summary)) && an.body.available === true);
  const links = (await call('GET', `/visual/links?assetUrl=${encodeURIComponent(SCENE)}`, 'owner')).body.links;
  t('у Медіатеці пропозиції видно разом із прив\'язками (статус suggested)', links.length === 3 && links.every((l: any) => l.status === 'suggested'));

  // Автор вирішує.
  const kyivLink = sugg.find((l) => l.entityId === kyiv)!;
  const swordLink = sugg.find((l) => l.entityId === sword)!;
  const acc = await call('POST', `/visual/links/${kyivLink.id}/status`, 'owner', { status: 'confirmed' });
  t('«Прив\'язати» пропозицію: підтверджено, записав автор, джерело — ШІ; висновок-доказ підтверджено',
    acc.status === 200 && acc.body.link.status === 'confirmed' && acc.body.link.createdBy === 'user:u-owner' && acc.body.link.source === 'ai' &&
    (await repo.listFindings(P)).find((f) => f.id === kyivLink.evidence[0])?.status === 'confirmed');
  const rej = await call('DELETE', `/visual/links/${swordLink.id}`, 'owner');
  t('«Відхилити» пропозицію — відхилено назавжди (не видалено), висновок відхилено',
    rej.body.rejected === true && (await repo.getAssetLink(P, swordLink.id))?.status === 'rejected' &&
    (await call('POST', `/visual/links/${sugg.find((l) => l.entityId === olena)!.id}/status`, 'owner', { status: 'rejected' })).status === 200);
  const r2 = await call('POST', '/visual/recognize', 'owner', { assetUrl: SCENE });
  const j2 = await job(r2.body.jobId);
  t('повторне розпізнавання: відхилене й уже прив\'язане не пропонуються знову', j2.result.suggestedLinks === 0 && (await repo.listAssetLinks(P, { assetUrl: SCENE })).length === 3, JSON.stringify(j2.result));

  // ── «Звірити з описом» ──
  const card = (await repo.listAssetLinks(P, { assetUrl: '/api/media/file/md-card' }))[0];
  t('звірка: не герой (локація) — 400; невідомий — 404; читачу — 403',
    (await call('POST', `/visual/links/${kyivLink.id}/compare`, 'owner')).status === 400 &&
    (await call('POST', '/visual/links/00000000-0000-4000-8000-000000000000/compare', 'owner')).status === 404 &&
    (await call('POST', `/visual/links/${card.id}/compare`, 'reader')).status === 403);
  answer = (input) => {
    const id = input.images?.[0]?.id ?? '';
    return { findings: [
      { kind: 'visual_match', field: 'hair', summary: 'Волосся руде, як в описі.', image_ids: [id], confidence: 0.9 },
      { kind: 'visual_unknown', field: 'eyes', summary: 'Очей не видно.', image_ids: [id], insufficient_data: true, confidence: 0.2 },
    ] };
  };
  // Опис картки змінився → «перевірити» (В5); звірка AI-3 знімає позначку, якщо збіг.
  book.characters[0].appearance.eyes = 'зелені';
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  t('після зміни опису портрет з картки — «перевірити»', (await repo.getAssetLink(P, card.id))!.needsReview);
  const c1 = await call('POST', `/visual/links/${card.id}/compare`, 'owner');
  const cj1 = await job(c1.body.jobId);
  const cmpCall = calls[calls.length - 1];
  t('звірка: AI-3 отримав портрет і опис картки (з новими очима)', cmpCall.images?.[0]?.id === '/api/media/file/md-card' && cmpCall.user.includes('очі: зелені') && cmpCall.user.includes('«Олена»'));
  t('КРИТЕРІЙ: збіг (ознака очей — «недостатньо даних») — «перевірити» знято AI-3, відбиток — новий опис',
    cj1.result.verdict === 'match' && cj1.result.review === 'cleared' && !(await repo.getAssetLink(P, card.id))!.needsReview && cj1.result.unknown === 1, JSON.stringify(cj1.result));
  answer = (input) => ({ findings: [
    { kind: 'visual_mismatch', field: 'eyes', summary: 'На портреті сірі очі, в описі — зелені.', image_ids: [input.images?.[0]?.id], confidence: 0.8 },
    { kind: 'visual_match', field: 'hair', summary: 'Руде волосся.', image_ids: [input.images?.[0]?.id], confidence: 0.8 },
  ] });
  const c2 = await call('POST', `/visual/links/${card.id}/compare`, 'owner');
  const cj2 = await job(c2.body.jobId);
  t('КРИТЕРІЙ: розбіжність — підсумок «є розбіжності», позначку «перевірити» поставлено',
    cj2.result.verdict === 'mismatch' && cj2.result.review === 'flagged' && (await repo.getAssetLink(P, card.id))!.needsReview, JSON.stringify(cj2.result));
  const an2 = await call('GET', `/visual/analysis?assetUrl=${encodeURIComponent('/api/media/file/md-card')}`, 'owner');
  t('GET analysis: остання звірка зв\'язку — «розбіжність» з поясненням', an2.body.compare[card.id]?.verdict === 'mismatch' && an2.body.compare[card.id].items.some((i: any) => i.kind === 'visual_mismatch' && /зелені/.test(i.summary)));

  // Портрет версії — звірка з описом версії; опису немає — модель не викликається.
  const v = await call('POST', `/visual/appearance/${olena}`, 'owner', { label: 'Дитина', fromChapter: 1, toChapter: 1, description: 'Дві руді коси' });
  const vp = await call('PUT', `/visual/appearance/${olena}/versions/${v.body.version.id}/portrait`, 'owner', { assetUrl: '/api/media/file/md-full' });
  answer = (input) => ({ findings: [{ kind: 'visual_match', field: 'hair', summary: 'Коси.', image_ids: [input.images?.[0]?.id], confidence: 0.9 }] });
  const c3 = await call('POST', `/visual/links/${vp.body.link.id}/compare`, 'owner');
  const cj3 = await job(c3.body.jobId);
  t('портрет версії звіряється з описом версії', calls[calls.length - 1].user.includes('Дві руді коси') && calls[calls.length - 1].user.includes('версія «Дитина»') && cj3.result.verdict === 'match');
  await call('PATCH', `/visual/appearance/${olena}/versions/${v.body.version.id}`, 'owner', { description: '' });
  const before = calls.length;
  const c4 = await call('POST', `/visual/links/${vp.body.link.id}/compare`, 'owner');
  const cj4 = await job(c4.body.jobId);
  t('опису немає — «звіряти нема з чим», модель не викликано (без витрат)', cj4.result.status === 'no_description' && calls.length === before);
  server.close();
}

await suite('memory', new MemoryCoreRepository(), new MemoryJobStore(), 'book-m');

const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    await suite('postgres', new PgCoreRepository(pool), new PgJobStore(pool), 'book-p');
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

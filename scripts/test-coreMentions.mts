/**
 * AI-1: пропоновані згадки й зв'язки — задача Т1.1 (журнал #252).
 *
 * Критерії: нерозмічений розділ отримує пропозиції з доказами; «Підтвердити»
 * дає тег для потрібного абзацу й лише для нього; відхилене не пропонується
 * вдруге. Плюс: зіставлення за псевдонімами (один UUID), відсів уже
 * позначеного й поза реєстром, зв'язки лише між відомими сутностями, права
 * (читач не запускає й не підтверджує), 409 для несинхронізованого розділу.
 * Модель — підставна.
 *
 * Без бази — у пам'яті; з CORE_TEST_DATABASE_URL — ще й на PostgreSQL
 * (схема `fusion_core` видаляється — лише тестова база!).
 *
 * Запуск: npm run test:core-mentions
 */
import express from 'express';
import type { AddressInfo } from 'node:net';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { aiMentionsJobKind, AI_MENTIONS_JOB_KIND, mentionTask, MENTION_SUGGESTION, RELATION_SUGGESTION } from '../server/core/ai/mentions.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';
import type { CoreRepository } from '../server/core/types.ts';
import type { JobStore } from '../server/core/jobs/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nІнструкція AI-1:');
{
  const task = mentionTask([{ type: 'character', name: 'Олена Коваль' }]);
  t('перелічує типи реєстру, ключі зв\'язків і відомі сутності', task.includes('character') && task.includes('follows') && task.includes('character: Олена Коваль'));
  t('просить один абзац на згадку й не вигадувати', /рівно ОДИН id/.test(task) && /Не вигадуй/.test(task));
}

function section(id: string, order: number, content: string) {
  const r = reconcileParagraphIds({ sectionId: id, content });
  return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
}

async function suite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nПропозиції AI-1 (${label}):`);
  const book = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-olena', name: 'Олена', surname: 'Коваль', alias: 'Лена' }, { id: 'c-marko', name: 'Марко' }],
    chapters: [{ id: 'ch', title: 'Глава', order: 0, sections: [
      section('s1', 0, ['[/character:Олена] стояла на мосту.', 'Її охопив страх, але Марко мовчав.', 'Лена згадала матір.', 'Порожній кінець.'].join('\n\n')),
      section('s2', 1, 'Інший розділ.'),
    ] }],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const paras = await repo.listParagraphs(P, 's1');
  const [p1, p2, p3, p4] = paras.map((p) => p.id);
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;

  let reply = '';
  const calls: AiGenerateInput[] = [];
  const generate = async (input: AiGenerateInput) => {
    calls.push(input);
    return { text: reply, modelId: 'fake', engine: 'fake', inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
  };
  let clock = Date.parse('2026-09-25T10:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_MENTIONS_JOB_KIND, aiMentionsJobKind({ repo: () => repo, generate, resolveModel: async () => 'model-ai1' }));

  reply = JSON.stringify({ findings: [
    { kind: 'mention', entity_type: 'emotion', entity_name: 'страх', subject_name: 'Олена', summary: 'Олені страшно', paragraph_ids: [p2], quote: 'Її охопив страх', confidence: 0.8 },
    { kind: 'mention', entity_type: 'character', entity_name: 'Олена', summary: 'Олена', paragraph_ids: [p1], confidence: 0.9 },
    { kind: 'mention', entity_type: 'character', entity_name: 'Лена', summary: 'Лена — це Олена', paragraph_ids: [p3], quote: 'Лена', confidence: 0.7 },
    { kind: 'mention', entity_type: 'dragon', entity_name: 'Змій', summary: 'поза реєстром', paragraph_ids: [p2], confidence: 0.5 },
    { kind: 'mention', entity_type: 'character', entity_name: 'Марко', summary: 'Марко', paragraph_ids: [p2, p4, 'p-чужий'], confidence: 0.6 },
    { kind: 'relation', entity_type: 'character', entity_name: 'Олена', target_entity_type: 'character', target_entity_name: 'Марко', relation_type: 'follows', summary: 'Олена йде за Марком', paragraph_ids: [p2], confidence: 0.6 },
    { kind: 'relation', entity_type: 'character', entity_name: 'Олена', target_entity_type: 'character', target_entity_name: 'Невідомий', relation_type: 'follows', summary: 'x', paragraph_ids: [p2], confidence: 0.4 },
    { kind: 'relation', entity_type: 'character', entity_name: 'Олена', target_entity_type: 'character', target_entity_name: 'Марко', relation_type: 'kills_forever', summary: 'x', paragraph_ids: [p2], confidence: 0.4 },
  ] });
  const job = (await q.enqueue({ projectId: P, kind: AI_MENTIONS_JOB_KIND, payload: { paragraphIds: paras.map((p) => p.id) }, createdBy: 'user:u-owner' })).job;
  await q.runOnce();
  const done = await jobStore.get(P, job.id);
  t('задача AI-1 завершилась з підсумком', done?.status === 'succeeded' && (done.result as any)?.suggestions === 4 && (done.result as any)?.relations === 1, JSON.stringify(done?.result ?? done?.error));
  t('модель — AI-1, у запиті — абзаци розділу й інструкція', calls[0].module === 'coreAi1Classify' && calls[0].user.includes(`[${p2}]`) && calls[0].user.includes('Знайди в абзацах згадки'));

  const sug = (await repo.listFindings(P, { status: 'suggested' })).filter((f) => f.kind === MENTION_SUGGESTION);
  const byPara = (pid: string) => sug.filter((f) => f.sourceParagraphIds[0] === pid);
  const fear = byPara(p2).find((f) => (f.payload as any).entityType === 'emotion');
  t('емоція з суб\'єктом — тег «[/emotion:страх @Олена]» для свого абзацу', (fear?.payload as any)?.tag === '[/emotion:страх @Олена]' && fear?.sourceParagraphIds.join() === p2);
  t('згадка, що вже стоїть тегом у абзаці, не пропонується', byPara(p1).length === 0);
  const lena = byPara(p3)[0];
  t('псевдонім «Лена» → та сама сутність, тег з її назвою', lena?.entityId === olena && (lena.payload as any).tag === '[/character:Олена Коваль]', (lena?.payload as any)?.tag);
  t('тип поза реєстром — відсіяно', !sug.some((f) => (f.payload as any).entityType === 'dragon'));
  t('одна згадка на кілька абзаців → по пропозиції на абзац (чужий id — ні)', byPara(p2).some((f) => f.entityId === marko) && byPara(p4).some((f) => f.entityId === marko) && sug.length === 4);
  const rels = (await repo.listFindings(P, { status: 'suggested' })).filter((f) => f.kind === RELATION_SUGGESTION);
  t('зв\'язок — лише між відомими сутностями й лише з реєстру', rels.length === 1 && rels[0].entityId === olena && (rels[0].payload as any).targetEntityId === marko);
  t('усі пропозиції — від AI-1, suggested, з доказом', [...sug, ...rels].every((f) => f.createdBy === 'ai:AI-1' && f.status === 'suggested' && f.sourceParagraphIds.length === 1));

  // Відхилене не повертається; нерозглянуте не дублюється.
  await repo.setFindingStatus(P, fear!.id, 'rejected', 'user:u-owner');
  clock += 120_000;
  await q.enqueue({ projectId: P, kind: AI_MENTIONS_JOB_KIND, payload: { paragraphIds: paras.map((p) => p.id) }, createdBy: 'user:u-owner' });
  await q.runOnce();
  const after = (await repo.listFindings(P)).filter((f) => f.kind === MENTION_SUGGESTION || f.kind === RELATION_SUGGESTION);
  t('повторний аналіз: відхилене не пропонується вдруге', after.filter((f) => (f.payload as any).entityType === 'emotion' && f.sourceParagraphIds[0] === p2).length === 1);
  t('і нерозглянуте не дублюється', after.filter((f) => f.status === 'suggested').length === 4, `${after.filter((f) => f.status === 'suggested').length}`);

  // ── Маршрути ──
  console.log(`\nМаршрути пропозицій (${label}):`);
  const access = {
    async getBookOwnerId(id: string) { return id === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = {
    owner: { id: 'u-owner', role: 'writer', isGuest: false },
    reader: { id: 'u-reader', role: 'reader', isGuest: false },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', queue: () => q });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (method: string, path: string, user: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };

  t('читач не запускає аналіз — 403', (await call('POST', '/ai/mentions', 'reader', { sectionId: 's1' })).status === 403);
  t('розділ, якого немає в ядрі, — 409 «не синхронізовано»', (await call('POST', '/ai/mentions', 'owner', { sectionId: 'nope' })).body.kind === 'not_synced');
  clock += 120_000;
  const started = await call('POST', '/ai/mentions', 'owner', { sectionId: 's1' });
  t('запуск аналізу розділу — 202 з id задачі', started.status === 202 && !!started.body.jobId && started.body.paragraphs === 4);
  await q.runOnce();
  const st = await call('GET', `/jobs/${started.body.jobId}`, 'reader');
  t('стан задачі видно учасникам', st.status === 200 && st.body.status === 'succeeded');

  const list = await call('GET', '/suggestions?sectionId=s1', 'reader');
  const items = list.body.suggestions as any[];
  t('пропозиції розділу з абзацом, номером у редакторі й уривком',
    list.status === 200 && items.length === 4 && items.every((s) => s.sectionId === 's1' && s.editorPid && s.paragraphExcerpt), `${items?.length}`);
  t('інший розділ — без пропозицій', (await call('GET', '/suggestions?sectionId=s2', 'owner')).body.suggestions.length === 0);
  const lenaS = items.find((s) => s.paragraphId === p3);
  t('читач не підтверджує — 403', (await call('POST', `/suggestions/${lenaS.id}/confirm`, 'reader')).status === 403);
  const conf = await call('POST', `/suggestions/${lenaS.id}/confirm`, 'owner');
  t('«Підтвердити» — тег і абзац (лише цей), куди його поставить редактор',
    conf.status === 200 && conf.body.tag === '[/character:Олена Коваль]' && conf.body.paragraphId === p3 && conf.body.editorPid === p3 && conf.body.sectionId === 's1');
  t('рукопис на сервері не змінено — тег ставить редактор', (await repo.getParagraph(P, p3))?.text === 'Лена згадала матір.');
  t('повторне підтвердження — 409', (await call('POST', `/suggestions/${lenaS.id}/confirm`, 'owner')).status === 409);
  const relS = items.find((s) => s.kind === RELATION_SUGGESTION);
  const relConf = await call('POST', `/suggestions/${relS.id}/confirm`, 'owner');
  t('підтверджений зв\'язок — у ядрі, від автора', relConf.status === 200 && relConf.body.relation?.status === 'confirmed' && relConf.body.relation.createdBy === 'user:u-owner' && relConf.body.relation.evidence.join() === p2);
  const toReject = items.find((s) => s.paragraphId === p4);
  t('«Відхилити»', (await call('POST', `/suggestions/${toReject.id}/reject`, 'owner')).body.ok === true);
  t('розглянуте зникає зі списку', (await call('GET', '/suggestions?sectionId=s1', 'owner')).body.suggestions.length === 1);
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

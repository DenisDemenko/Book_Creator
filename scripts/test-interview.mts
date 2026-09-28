/**
 * Т2.7 — «Допит живого персонажа» (FLC етап 1, `PLAN_INTERVIEW.md`).
 *
 * В1: таблиці `character_agents`, `scene_simulations`, `simulation_events`,
 * `canon_proposals` (міграція 0017) — правила (дзеркало CHECK: увімкнено ⇔
 * рівень не off; допит — лише з героєм; питання ставить лише автор; хід
 * героя — з героєм; тег — лише до фрагмента; вирішує пропозицію лише автор і
 * лише один раз), сховища в пам'яті й PostgreSQL.
 *
 * В2: «AI-персонаж» і рівні автономності — налаштування (лише відомі поля),
 * допит лише для увімкненого героя, маршрути `…/agent` і `…/agents`, права.
 *
 * В3: хід допиту — питання → Jev (тактичний на хід, прогін = допит) →
 * голос героя (модуль `coreCharacterVoice`) з історією допиту. КРИТЕРІЇ
 * FLC 2.0 §7: 10 відповідей поспіль без втрати контексту й без зміни
 * канону; немає майбутнього й чужих приватних секретів; збій Jev — запасний
 * LLM, збій голосу — «не вдалося» зі збереженим питанням і «повторити»,
 * рішення чекає автора — «чекає» з варіантами. Маршрути `…/interview`,
 * `…/simulations/:id`, `/turn`, `/retry`, `/status`.
 * В4: пропозиції в канон — з відповіді (спогад, факт-гіпотеза, фрагмент
 * чистим текстом і теги П7 окремо), без повторів; КРИТЕРІЇ FLC 2.0 §7:
 * (1) факт профілю — з джерелом або позначкою гіпотези; (4) вибіркове
 * прийняття й відхилення; (5) правка сцени — прийнятий спогад «перевірити»,
 * факт «на перегляд», допит «застарів» (нових ходів немає, пропозиції —
 * лише явним рішенням). Маршрути `…/proposals`, `/accept`, `/reject`.
 * PostgreSQL — з CORE_TEST_DATABASE_URL (схема `fusion_core` видаляється —
 * лише тестова база!).
 *
 * Запуск: npm run test:interview
 */
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { checkCanonProposal, checkCharacterAgent, checkSimulation, checkSimulationEvent, checkSimulationPatch } from '../server/core/rules.ts';
import type { CoreRepository } from '../server/core/types.ts';
import { askQuestion, getAgent, INTERVIEW_ACTIONS, normalizeAgentConfig, requireInterviewAgent, retryTurn, setAgent, startInterview, type InterviewDeps } from '../server/core/interview.ts';
import { addAuthorMemory, collectTagMemories, heroMemories } from '../server/core/characterMemory.ts';
import { acceptProposal, cleanFragmentText, interviewBoundaryHash, proposalViews, rejectProposal, validProposalTag } from '../server/core/interviewProposals.ts';
import { buildCharacterProfile } from '../server/core/characterProfile.ts';
import { scanScenes } from '../server/core/timeline.ts';
import { resolveDecisionByAuthor } from '../server/core/jevLevels.ts';
import { HttpJevAdapter, LlmFallbackJevAdapter, MockJevAdapter } from '../server/ai/adapters/jev/index.ts';
import { factoryCharacterVoiceTemplate } from '../server/core/interviewPrompt.ts';
import { CORE_MODULE_KEYS, resolveCoreTemplate } from '../server/coreAiRegistry.ts';
import { registerProjectRoutes } from '../server/core/projectRoutes.ts';
import express from 'express';
import type { AddressInfo } from 'node:net';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const code = async (fn: () => unknown) => {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return (err as any).code ?? (err as Error).message;
  }
};

console.log('\nПравила — дзеркало CHECK міграції 0017:');
{
  t('агент: рівень — off / interview / scene; AI не перемикає; налаштування — обʼєкт',
    (await code(() => checkCharacterAgent({ projectId: 'p', characterId: 'c', autonomyLevel: 'interview', actor: 'user:u' }))) === 'ok' &&
    (await code(() => checkCharacterAgent({ projectId: 'p', characterId: 'c', autonomyLevel: 'god' as any, actor: 'user:u' }))) === 'bad_input' &&
    (await code(() => checkCharacterAgent({ projectId: 'p', characterId: 'c', autonomyLevel: 'scene', actor: 'ai:AI-2' }))) === 'bad_actor' &&
    (await code(() => checkCharacterAgent({ projectId: 'p', characterId: 'c', autonomyLevel: 'off', agentConfig: [] as any, actor: 'user:u' }))) === 'bad_input');
  t('прогін: допит — лише з героєм; ревізія ≥ 0; глава ≥ 1; вид відомий',
    (await code(() => checkSimulation({ projectId: 'p', kind: 'interview', baseBookRevision: 1, createdBy: 'user:u' }))) === 'bad_input' &&
    (await code(() => checkSimulation({ projectId: 'p', kind: 'interview', characterId: 'c', baseBookRevision: -1, createdBy: 'user:u' }))) === 'bad_input' &&
    (await code(() => checkSimulation({ projectId: 'p', kind: 'interview', characterId: 'c', baseBookRevision: 1, asOfChapter: 0, createdBy: 'user:u' }))) === 'bad_input' &&
    (await code(() => checkSimulation({ projectId: 'p', kind: 'chat' as any, characterId: 'c', baseBookRevision: 1, createdBy: 'user:u' }))) === 'bad_input' &&
    (await code(() => checkSimulation({ projectId: 'p', kind: 'scene', baseBookRevision: 0, createdBy: 'system:x' }))) === 'ok');
  t('зміна прогону: статус і хід у межах', (await code(() => checkSimulationPatch({ status: 'done' as any }))) === 'bad_input' && (await code(() => checkSimulationPatch({ currentTurn: -1 }))) === 'bad_input' && (await code(() => checkSimulationPatch({ status: 'stale' }))) === 'ok');
  const ev = { projectId: 'p', simulationId: 's', turnIndex: 1, createdBy: 'user:u' };
  t('хід: питання — лише автор; хід героя — з героєм; невідомий вид — ні',
    (await code(() => checkSimulationEvent({ ...ev, actor: 'character', actorCharacterId: 'c', eventType: 'question' }))) === 'bad_input' &&
    (await code(() => checkSimulationEvent({ ...ev, actor: 'character', eventType: 'answer' }))) === 'bad_input' &&
    (await code(() => checkSimulationEvent({ ...ev, actor: 'system', eventType: 'shout' as any }))) === 'bad_input' &&
    (await code(() => checkSimulationEvent({ ...ev, actor: 'author', eventType: 'question' }))) === 'ok');
  t('пропозиція: тег (П7) — лише до фрагмента; вид відомий',
    (await code(() => checkCanonProposal({ projectId: 'p', simulationId: 's', characterId: 'c', kind: 'tag', proposedChange: {}, createdBy: 'ai:x' }))) === 'bad_input' &&
    (await code(() => checkCanonProposal({ projectId: 'p', simulationId: 's', characterId: 'c', kind: 'poem' as any, proposedChange: {}, createdBy: 'ai:x' }))) === 'bad_input' &&
    (await code(() => checkCanonProposal({ projectId: 'p', simulationId: 's', characterId: 'c', kind: 'fragment', proposedChange: { text: 'x' }, createdBy: 'ai:x' }))) === 'ok');
}

async function repoSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nСховище допиту — В1 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Архів',
    book: { id: P, title: 'Архів', characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }], chapters: [{ id: 'ch1', title: 'Гл. 1', order: 0, sections: [sec('s1', 0, '[/character:Олена] [/character:Марко] Марко звинуватив Олену.')] }] },
  } as any);
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const rev = (await repo.getProject(P))!.revision;
  const nope = '00000000-0000-4000-8000-000000000000';

  t('агента ще немає', (await repo.getCharacterAgent(P, olena)) === null);
  const a1 = await repo.upsertCharacterAgent({ projectId: P, characterId: olena, autonomyLevel: 'interview', agentConfig: { asOfChapter: 1 }, actor: 'user:u-owner' });
  t('«AI-персонаж» увімкнено — рівень «допит», налаштування, хто', a1.enabled && a1.autonomyLevel === 'interview' && a1.agentConfig.asOfChapter === 1 && a1.createdBy === 'user:u-owner');
  const a2 = await repo.upsertCharacterAgent({ projectId: P, characterId: olena, autonomyLevel: 'scene', actor: 'user:u-ed' });
  t('зміна рівня — той самий запис, налаштування збережено, хто змінив', a2.id === a1.id && a2.autonomyLevel === 'scene' && a2.enabled && a2.agentConfig.asOfChapter === 1 && a2.updatedBy === 'user:u-ed' && a2.createdBy === 'user:u-owner');
  const a3 = await repo.upsertCharacterAgent({ projectId: P, characterId: olena, autonomyLevel: 'off', actor: 'user:u-owner' });
  t('вимкнено — enabled false; перелік агентів проєкту', !a3.enabled && (await repo.listCharacterAgents(P)).length === 1);
  t('невідомий герой — not_found', (await code(() => repo.upsertCharacterAgent({ projectId: P, characterId: nope, autonomyLevel: 'interview', actor: 'user:u' }))) === 'not_found');

  const sim = await repo.addSimulation({ projectId: P, kind: 'interview', characterId: olena, sceneId: 's1', asOfChapter: 1, baseBookRevision: rev, title: 'Допит Олени', config: { question: 'x' }, createdBy: 'user:u-owner' });
  t('прогін-допит: активний, хід 0, сцена, глава, ревізія книги', sim.status === 'active' && sim.currentTurn === 0 && sim.sceneId === 's1' && sim.asOfChapter === 1 && sim.baseBookRevision === rev && sim.title === 'Допит Олени');
  const other = await repo.addSimulation({ projectId: P, kind: 'interview', characterId: marko, baseBookRevision: rev, createdBy: 'user:u-owner' });
  t('перелік: новіші першими; фільтр героя, виду, статусу',
    (await repo.listSimulations(P, { characterId: olena })).map((s) => s.id).join() === sim.id && (await repo.listSimulations(P)).length === 2 &&
    (await repo.listSimulations(P, { kind: 'scene' })).length === 0 && (await repo.listSimulations(P, { status: 'active' })).length === 2);
  const upd = await repo.updateSimulation(P, sim.id, { currentTurn: 2, status: 'paused' });
  t('оновлення: хід і статус', upd.currentTurn === 2 && upd.status === 'paused' && (await repo.getSimulation(P, sim.id))!.status === 'paused');
  t('невідомий прогін — not_found; поганий статус — bad_input',
    (await code(() => repo.updateSimulation(P, nope, { status: 'closed' }))) === 'not_found' && (await code(() => repo.updateSimulation(P, sim.id, { status: 'done' as any }))) === 'bad_input');

  const q1 = await repo.addSimulationEvent({ projectId: P, simulationId: sim.id, turnIndex: 1, actor: 'author', eventType: 'question', publicPayload: { text: 'Де ти була?' }, createdBy: 'user:u-owner' });
  const d = await repo.addCharacterDecision({ projectId: P, characterId: olena, level: 'tactical', simulationId: sim.id, turnIndex: 1, cacheKey: 'k', snapshotHash: 'a'.repeat(32), modelVersion: 'mock', source: 'mock', selectedAction: 'deflect', createdBy: 'user:u-owner' });
  const a = await repo.addSimulationEvent({ projectId: P, simulationId: sim.id, turnIndex: 1, actor: 'character', actorCharacterId: olena, eventType: 'answer', publicPayload: { text: 'У лабораторії.' }, sourceDecisionId: d.id, createdBy: 'ai:voice' });
  await repo.addSimulationEvent({ projectId: P, simulationId: sim.id, turnIndex: 2, actor: 'author', eventType: 'question', publicPayload: { text: 'А Марко?' }, createdBy: 'user:u-owner' });
  const evs = await repo.listSimulationEvents(P, sim.id);
  t('ходи — у порядку, з рішенням Jev і змістом', evs.map((e) => `${e.turnIndex}:${e.eventType}`).join() === '1:question,1:answer,2:question' && evs[1].sourceDecisionId === d.id && (evs[1].publicPayload as any).text === 'У лабораторії.');
  t('ходи іншого прогону — окремо', (await repo.listSimulationEvents(P, other.id)).length === 0);
  t('хід невідомого прогону — not_found; питання від героя — bad_input',
    (await code(() => repo.addSimulationEvent({ projectId: P, simulationId: nope, turnIndex: 1, actor: 'author', eventType: 'question', createdBy: 'user:u' }))) === 'not_found' &&
    (await code(() => repo.addSimulationEvent({ projectId: P, simulationId: sim.id, turnIndex: 1, actor: 'character', actorCharacterId: olena, eventType: 'question', createdBy: 'ai:x' }))) === 'bad_input');

  const frag = await repo.addCanonProposal({ projectId: P, simulationId: sim.id, characterId: olena, kind: 'fragment', proposedChange: { text: 'Я була в лабораторії, перевіряла архів.' }, sourceEventIds: [a.id], createdBy: 'ai:voice' });
  const tag = await repo.addCanonProposal({ projectId: P, simulationId: sim.id, characterId: olena, kind: 'tag', parentId: frag.id, proposedChange: { tag: '[/emotion:тривога @Олена]' }, sourceEventIds: [a.id], createdBy: 'ai:voice' });
  const mem = await repo.addCanonProposal({ projectId: P, simulationId: sim.id, characterId: olena, kind: 'memory', proposedChange: { memoryType: 'recollection', content: 'Марко мене підставив.' }, sourceEventIds: [a.id, q1.id], createdBy: 'ai:voice' });
  t('пропозиції: фрагмент, тег до нього, спогад — очікують', [frag, tag, mem].every((p) => p.status === 'pending') && tag.parentId === frag.id && mem.sourceEventIds.length === 2);
  t('перелік пропозицій: прогону, героя, статусу, виду',
    (await repo.listCanonProposals(P, { simulationId: sim.id })).length === 3 && (await repo.listCanonProposals(P, { characterId: marko })).length === 0 &&
    (await repo.listCanonProposals(P, { status: 'pending', kind: 'tag' })).map((p) => p.id).join() === tag.id);
  t('тег до невідомого фрагмента — not_found; тег без фрагмента — bad_input',
    (await code(() => repo.addCanonProposal({ projectId: P, simulationId: sim.id, characterId: olena, kind: 'tag', parentId: nope, proposedChange: {}, createdBy: 'ai:x' }))) === 'not_found' &&
    (await code(() => repo.addCanonProposal({ projectId: P, simulationId: sim.id, characterId: olena, kind: 'tag', proposedChange: {}, createdBy: 'ai:x' }))) === 'bad_input');
  t('вирішує лише автор', (await code(() => repo.resolveCanonProposal(P, mem.id, { status: 'accepted', actor: 'ai:voice' }))) === 'confirmed_is_author_only');
  const acc = await repo.resolveCanonProposal(P, mem.id, { status: 'accepted', actor: 'user:u-owner', result: { memoryId: 'm-1' } });
  t('прийнято — хто, коли, що створено', acc.status === 'accepted' && acc.reviewedBy === 'user:u-owner' && !!acc.reviewedAt && acc.result.memoryId === 'm-1');
  t('повторне рішення — conflict; невідома — not_found',
    (await code(() => repo.resolveCanonProposal(P, mem.id, { status: 'rejected', actor: 'user:u-owner' }))) === 'conflict' &&
    (await code(() => repo.resolveCanonProposal(P, nope, { status: 'rejected', actor: 'user:u-owner' }))) === 'not_found');
  const rej = await repo.resolveCanonProposal(P, tag.id, { status: 'rejected', actor: 'user:u-owner' });
  t('відхилити тег окремо від фрагмента (фрагмент далі очікує)', rej.status === 'rejected' && (await repo.getCanonProposal(P, frag.id))!.status === 'pending');
  return { olena, sim };
}

async function agentSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\n«AI-персонаж» і рівні автономності — В2 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Архів',
    book: { id: P, title: 'Архів', characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }], chapters: [{ id: 'ch1', title: 'Гл. 1', order: 0, sections: [sec('s1', 0, '[/character:Олена] [/character:Марко] [/location:Лабораторія] Марко звинуватив Олену.')] }] },
  } as any);
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const lab = (await repo.resolveAlias(P, 'location', 'Лабораторія'))!;

  t('налаштування: лише відомі поля, невідоме відкинуто; межі',
    JSON.stringify(normalizeAgentConfig({ asOfChapter: '2', sceneId: 's1', note: ' говорить коротко ', maxTurns: 12, secret: 'x' })) === JSON.stringify({ asOfChapter: 2, sceneId: 's1', note: 'говорить коротко', maxTurns: 12 }) &&
    (await code(() => normalizeAgentConfig({ asOfChapter: 0 }))) === 'bad_input' && (await code(() => normalizeAgentConfig({ maxTurns: 1000 }))) === 'bad_input' && (await code(() => normalizeAgentConfig([]))) === 'bad_input');
  const v0 = await getAgent(repo, P, olena);
  t('типово — вимкнено', !v0.enabled && v0.autonomyLevel === 'off' && v0.updatedBy === null);
  t('допит вимкненого героя — conflict з підказкою', (await code(() => requireInterviewAgent(repo, P, olena))) === 'conflict');
  const v1 = await setAgent(repo, P, olena, { autonomyLevel: 'interview', config: { asOfChapter: 1, note: 'уникає прямих відповідей' } }, 'user:u-owner');
  t('увімкнено «Допит» з налаштуваннями', v1.enabled && v1.autonomyLevel === 'interview' && v1.config.asOfChapter === 1 && v1.config.note === 'уникає прямих відповідей' && v1.updatedBy === 'user:u-owner');
  const v2 = await setAgent(repo, P, olena, { config: { maxTurns: 10 } }, 'user:u-ed');
  t('зміна лише налаштувань — рівень і решта полів збережені', v2.autonomyLevel === 'interview' && v2.config.asOfChapter === 1 && v2.config.maxTurns === 10 && v2.updatedBy === 'user:u-ed');
  t('допит увімкненого — так (герой і агент)', (await requireInterviewAgent(repo, P, olena)).hero.name === 'Олена');
  await setAgent(repo, P, olena, { autonomyLevel: 'scene' }, 'user:u-owner');
  t('«учасник сцени» включає допит', (await code(() => requireInterviewAgent(repo, P, olena))) === 'ok');
  t('поганий рівень — bad_input; не герой (місце) чи невідомий — not_found',
    (await code(() => setAgent(repo, P, olena, { autonomyLevel: 'god' }, 'user:u'))) === 'bad_input' &&
    (await code(() => setAgent(repo, P, lab, { autonomyLevel: 'interview' }, 'user:u'))) === 'not_found' &&
    (await code(() => getAgent(repo, P, '00000000-0000-4000-8000-000000000000'))) === 'not_found');

  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }, { acceptedUserId: 'u-ed', role: 'editor' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'writer', isGuest: false }, editor: { id: 'u-ed', role: 'writer', isGuest: false }, stranger: { id: 'u-x', role: 'writer', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (user: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  try {
    const g = await call('reader', 'GET', `/characters/${marko}/agent`);
    t('GET …/agent (читач): вимкнено, три рівні з описом, «учасник сцени» — ще недоступний, без права змінювати',
      g.status === 200 && g.body.agent.autonomyLevel === 'off' && Object.keys(g.body.levels).join() === 'off,interview,scene' && g.body.levels.scene.available === false && g.body.canEdit === false);
    t('права: читач не вмикає (403), чужий не бачить (403)', (await call('reader', 'POST', `/characters/${marko}/agent`, { autonomyLevel: 'interview' })).status === 403 && (await call('stranger', 'GET', `/characters/${marko}/agent`)).status === 403);
    const on = await call('editor', 'POST', `/characters/${marko}/agent`, { autonomyLevel: 'interview', config: { maxTurns: 15 } });
    t('POST (редактор) — увімкнено; поганий рівень — 422; не герой — 404',
      on.status === 200 && on.body.agent.enabled && on.body.agent.config.maxTurns === 15 &&
      (await call('owner', 'POST', `/characters/${marko}/agent`, { autonomyLevel: 'x' })).status === 422 && (await call('owner', 'POST', `/characters/${lab}/agent`, { autonomyLevel: 'interview' })).status === 404);
    const list = await call('reader', 'GET', '/agents');
    t('GET /agents — усі увімкнені AI-персонажі з іменами', list.status === 200 && list.body.agents.map((a: any) => a.name).sort().join() === 'Марко,Олена');
    await call('owner', 'POST', `/characters/${marko}/agent`, { autonomyLevel: 'off' });
    t('вимкнено — зникає з переліку', (await call('owner', 'GET', '/agents')).body.agents.map((a: any) => a.name).join() === 'Олена');
  } finally {
    server.close();
  }
}

async function turnSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nХід допиту — В3 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Архів',
    book: {
      id: P, title: 'Архів', characters: [{ id: 'c-o', name: 'Олена', role: 'protagonist' }, { id: 'c-m', name: 'Марко' }],
      chapters: [
        { id: 'ch1', title: 'Гл. 1', order: 0, sections: [
          sec('s1', 0, '[/character:Олена] [/character:Марко] [/conflict:Сварка в лабораторії] Марко звинуватив Олену в крадіжці архіву.'),
          sec('s2', 1, '[/character:Олена] Олена сиділа сама в кабінеті.'),
        ] },
        { id: 'ch2', title: 'Гл. 2', order: 1, sections: [sec('s3', 0, '[/character:Олена] [/revelation:Марко зрадник @Олена] Олена дізналась, що Марко — зрадник.')] },
      ],
    },
  } as any);
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  await collectTagMemories(repo, P);
  await addAuthorMemory(repo, { projectId: P, characterId: marko, memoryType: 'recollection', content: 'Я сам вкрав архів уночі.', sceneId: 's1', visibility: 'hidden', actor: 'user:u-owner' });
  await addAuthorMemory(repo, { projectId: P, characterId: olena, memoryType: 'belief', content: 'Марко мені заздрить.', sceneId: 's1', actor: 'user:u-owner' });

  const prompts: { system: string; user: string }[] = [];
  let voiceMode: 'ok' | 'down' | 'garbage' = 'ok';
  const voice = async (system: string, user: string) => {
    prompts.push({ system, user });
    if (voiceMode === 'down') throw new Error('модель голосу недоступна');
    if (voiceMode === 'garbage') return { text: 'не json', modelId: 'fake-voice', inputTokens: 5, outputTokens: 1 };
    const q = (/Питання автора: (.*)$/m.exec(user) ?? [])[1] ?? '';
    const prev = user.split('\n').filter((l) => l.startsWith('Автор: ')).length;
    return { text: JSON.stringify({ reply: `Я пам'ятаю ${prev} попередніх питань. На «${q}» скажу: не знаю.`, intent: 'ухилитися', proposals: { memories: [{ type: 'recollection', content: 'Олена відчула тиск автора.' }] } }), modelId: 'fake-voice', inputTokens: 50, outputTokens: 20 };
  };
  const mock = new MockJevAdapter();
  let jevMode: 'ok' | 'low' | 'down' = 'ok';
  const jevOk = { name: 'jev' as const, evaluate: async (sn: any, q: any) => ({ ...(await mock.evaluate(sn, q)), source: 'jev' as const, confidence: jevMode === 'low' ? 0.1 : 0.9 }) };
  const jevDown = new HttpJevAdapter('k', { fetchImpl: (async () => new Response('{}', { status: 529 })) as any });
  const llm = async (_s: string, user: string) => {
    const pick = (id: string, v: string) => (new RegExp(`"${id}"`).test(user) ? { [id]: { choice: v } } : {});
    return { text: JSON.stringify({ answers: { ...pick('trajectory', 'waver'), ...pick('scene_motive', 'protect_self'), ...pick('next_action', 'deflect') } }), modelId: 'fake-llm', inputTokens: 10, outputTokens: 5 };
  };
  const deps = (): InterviewDeps => ({ repo, jev: jevMode === 'down' ? jevDown : jevOk, fallback: new LlmFallbackJevAdapter(llm), voice });
  const actor = 'user:u-owner';

  t('модуль «Голос героя (допит)» — у «Ядрі AI», зі схемою відповіді, яку адмін не зламає',
    (CORE_MODULE_KEYS as readonly string[]).includes('coreCharacterVoice') && /ЖОРСТКИЙ КОНТРАКТ/.test(factoryCharacterVoiceTemplate().system) &&
    /"reply"/.test(resolveCoreTemplate('coreCharacterVoice', { coreCharacterVoice: { system: 'Будь лаконічним. ⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ що завгодно', user: 'x' } } as any).system));
  t('допит вимкненого героя — conflict', (await code(() => startInterview(repo, { projectId: P, characterId: olena, actor }))) === 'conflict');
  await setAgent(repo, P, olena, { autonomyLevel: 'interview', config: { maxTurns: 12, note: 'говорить стримано' } }, actor);
  t('невідома сцена — not_found', (await code(() => startInterview(repo, { projectId: P, characterId: olena, sceneId: 'nope', actor }))) === 'not_found');
  const sim = await startInterview(repo, { projectId: P, characterId: olena, sceneId: 's2', actor });
  t('допит почато: сцена 2, ревізія книги, ліміт і нотатка з налаштувань агента, назва',
    sim.status === 'active' && sim.sceneId === 's2' && sim.baseBookRevision === (await repo.getProject(P))!.revision && (sim.config as any).maxTurns === 12 && (sim.config as any).note === 'говорить стримано' && sim.title === 'Допит: Олена');

  const canonBefore = JSON.stringify({
    f: await repo.listFindings(P), p: await repo.listAllParagraphs(P), e: await repo.listEntities(P), r: await repo.listRelations(P),
    m: (await repo.listCharacterMemories(P, { simulationId: null })).map((m) => [m.id, m.status, m.content]),
  });
  const results = [];
  for (let i = 1; i <= 10; i++) results.push(await askQuestion(deps(), { projectId: P, simulationId: sim.id, question: `Питання номер ${i}: де ти була?`, actor }));
  t('КРИТЕРІЙ FLC 2.0 §7 (3): 10 відповідей поспіль — усі з відповіддю, ходи 1…10', results.every((r, i) => r.status === 'answered' && r.turn === i + 1), results.map((r) => r.status).join(','));
  const last = results[9].event.publicPayload as any;
  t('контекст не губиться: у 10-му запиті голосу — 9 попередніх питань і відповідей; відповідь це підтверджує',
    (prompts[9].user.match(/^Автор: /gm) ?? []).length === 9 && (prompts[9].user.match(/^Олена: /gm) ?? []).length === 9 && /Я пам'ятаю 9 попередніх/.test(last.text), last.text);
  const decision = (await repo.getCharacterDecision(P, last.decisionId))!;
  t('кожна відповідь — з рішенням Jev на хід (тактичне, прогін = допит, хід 10, дія з дозволених), відбиток знімка',
    decision.level === 'tactical' && decision.simulationId === sim.id && decision.turnIndex === 10 && INTERVIEW_ACTIONS.includes(last.action) && last.source === 'jev' && /^[0-9a-f]{32}$/.test(last.snapshotHash));
  t('стратегічне й сценічне — раз на допит (з кешу), тактичних — 10',
    (await repo.listCharacterDecisions(P, { characterId: olena, level: 'strategic' })).length === 1 && (await repo.listCharacterDecisions(P, { characterId: olena, level: 'scene' })).length === 1 &&
    (await repo.listCharacterDecisions(P, { characterId: olena, level: 'tactical', simulationId: sim.id })).length === 10);
  const canonAfter = JSON.stringify({
    f: await repo.listFindings(P), p: await repo.listAllParagraphs(P), e: await repo.listEntities(P), r: await repo.listRelations(P),
    m: (await repo.listCharacterMemories(P, { simulationId: null })).map((m) => [m.id, m.status, m.content]),
  });
  t('КРИТЕРІЙ FLC 2.0 §7 (3) / ТЗ-H №3: канон, рукопис, пам\'ять канону — без змін', canonBefore === canonAfter);
  const allPrompts = prompts.map((p) => p.system + p.user).join('\n');
  t('КРИТЕРІЙ FLC 2.0 §7 (2) / ТЗ-H №5: у запитах голосу немає майбутнього (гл. 2 — «зрадник») і чужого приватного (Марко вкрав архів)',
    !/зрадник/.test(allPrompts) && !/вкрав архів/.test(allPrompts));
  t('у запиті — своє: переконання «Марко заздрить», сварка (пам\'ять), нотатка голосу, рішення на хід',
    /Марко мені заздрить/.test(prompts[0].user) && /Сварка в лабораторії/.test(prompts[0].user) && /говорить стримано/.test(prompts[0].system) && /дія: /.test(prompts[0].user));
  t('пропозиції голосу збережено у відповіді (для В4)', Array.isArray(last.proposals?.memories) && last.proposals.memories.length === 1);

  // Запасні шляхи.
  const sim2 = await startInterview(repo, { projectId: P, characterId: olena, asOfChapter: 1, actor });
  jevMode = 'down';
  const fb = await askQuestion(deps(), { projectId: P, simulationId: sim2.id, question: 'Хто винен?', actor });
  t('КРИТЕРІЙ FLC 2.0 §7 (6): Jev 529 — запасний LLM, відповідь є, причина збережена', fb.status === 'answered' && (fb.event.publicPayload as any).source === 'llm_fallback' && /529/.test((fb.event.publicPayload as any).fallbackReason ?? ''));
  jevMode = 'ok';
  voiceMode = 'down';
  const failed = await askQuestion(deps(), { projectId: P, simulationId: sim2.id, question: 'А що було далі?', actor });
  t('голос недоступний — «не вдалося», питання збережене, хід 2', failed.status === 'failed' && failed.turn === 2 && (failed.event.publicPayload as any).stage === 'voice');
  t('нове питання, поки попереднє без відповіді, — conflict', (await code(() => askQuestion(deps(), { projectId: P, simulationId: sim2.id, question: 'Ще?', actor }))) === 'conflict');
  voiceMode = 'garbage';
  t('відповідь голосу не за схемою — теж «не вдалося»', (await retryTurn(deps(), { projectId: P, simulationId: sim2.id, actor })).status === 'failed');
  voiceMode = 'ok';
  const again = await retryTurn(deps(), { projectId: P, simulationId: sim2.id, actor });
  const ev2 = await repo.listSimulationEvents(P, sim2.id);
  t('«повторити» — відповідь на те саме питання, той самий хід, питання не продубльовано; стан цілий',
    again.status === 'answered' && again.turn === 2 && ev2.filter((e) => e.eventType === 'question').length === 2 && /«А що було далі\?»/.test((again.event.publicPayload as any).text) && (await repo.getSimulation(P, sim2.id))!.currentTurn === 2);
  t('повторювати нічого — conflict', (await code(() => retryTurn(deps(), { projectId: P, simulationId: sim2.id, actor }))) === 'conflict');

  // Рішення чекає автора.
  const sim3 = await startInterview(repo, { projectId: P, characterId: olena, sceneId: 's1', actor });
  jevMode = 'low';
  let r = await askQuestion(deps(), { projectId: P, simulationId: sim3.id, question: 'Чому ти мовчиш?', actor });
  t('низька впевненість — «чекає автора» з варіантами, відповіді немає', r.status === 'awaiting' && Array.isArray((r.event.publicPayload as any).options) && (r.event.publicPayload as any).options.length >= 2);
  let loops = 0;
  while (r.status === 'awaiting' && loops < 4) {
    const p = r.event.publicPayload as any;
    await resolveDecisionByAuthor(repo, P, p.decisionId, p.options[0], actor);
    r = await retryTurn(deps(), { projectId: P, simulationId: sim3.id, actor });
    loops++;
  }
  t('автор вирішує за героя (рівень за рівнем) → «повторити» → відповідь з дією автора', r.status === 'answered' && (r.event.publicPayload as any).source === 'author' && loops >= 1, `кроків: ${loops}`);
  jevMode = 'ok';

  // Ліміт і статуси.
  t('11-те питання при ліміті 12 — ще можна; ліміт вичерпано — conflict', (await askQuestion(deps(), { projectId: P, simulationId: sim.id, question: '11?', actor })).status === 'answered' &&
    (await askQuestion(deps(), { projectId: P, simulationId: sim.id, question: '12?', actor })).status === 'answered' &&
    (await code(() => askQuestion(deps(), { projectId: P, simulationId: sim.id, question: '13?', actor }))) === 'conflict');
  await repo.updateSimulation(P, sim2.id, { status: 'paused' });
  t('на паузі — conflict', (await code(() => askQuestion(deps(), { projectId: P, simulationId: sim2.id, question: 'x', actor }))) === 'conflict');
  await setAgent(repo, P, olena, { autonomyLevel: 'off' }, actor);
  t('героя вимкнено — допит зупинено (conflict)', (await code(() => askQuestion(deps(), { projectId: P, simulationId: sim3.id, question: 'x', actor }))) === 'conflict');
  await setAgent(repo, P, olena, { autonomyLevel: 'interview' }, actor);
  t('порожнє питання — bad_input; чужий id — not_found', (await code(() => askQuestion(deps(), { projectId: P, simulationId: sim3.id, question: '  ', actor }))) === 'bad_input' && (await code(() => askQuestion(deps(), { projectId: P, simulationId: '00000000-0000-4000-8000-000000000000', question: 'x', actor }))) === 'not_found');

  // Маршрути.
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'writer', isGuest: false } };
  const serve = (full: boolean) => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
    registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', ...(full ? { flc: { jev: async () => jevOk as any, llm: () => llm }, interview: { voice: () => voice } } : {}) });
    const server = app.listen(0);
    return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}` };
  };
  const { server, base } = serve(true);
  const call = async (user: string, method: string, path: string, body?: unknown, b = base) => {
    const res = await fetch(`${b}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  try {
    t('права: читач не допитує (403)', (await call('reader', 'POST', `/characters/${olena}/interview`, {})).status === 403 && (await call('reader', 'GET', `/characters/${olena}/interviews`)).status === 403);
    const st = await call('owner', 'POST', `/characters/${olena}/interview`, { sceneId: 's2', title: 'Розмова про архів' });
    t('POST …/interview — 201', st.status === 201 && st.body.simulation.title === 'Розмова про архів');
    const sid = st.body.simulation.id;
    const turn = await call('owner', 'POST', `/simulations/${sid}/turn`, { question: 'Де архів?' });
    t('POST …/turn — відповідь героя з рішенням', turn.status === 200 && turn.body.status === 'answered' && !!turn.body.event.publicPayload.text && !!turn.body.event.sourceDecisionId);
    const got = await call('owner', 'GET', `/simulations/${sid}`);
    t('GET …/simulations/:id — допит і ходи', got.status === 200 && got.body.events.map((e: any) => e.eventType).join() === 'question,answer');
    t('перелік допитів героя', (await call('owner', 'GET', `/characters/${olena}/interviews`)).body.simulations.some((s: any) => s.id === sid));
    t('retry без потреби — 409; порожнє питання — 422', (await call('owner', 'POST', `/simulations/${sid}/retry`, {})).status === 409 && (await call('owner', 'POST', `/simulations/${sid}/turn`, { question: '' })).status === 422);
    t('статус: пауза → продовжити → закрити; закритий не відкрити (409); поганий статус — 400',
      (await call('owner', 'POST', `/simulations/${sid}/status`, { status: 'paused' })).body.simulation.status === 'paused' &&
      (await call('owner', 'POST', `/simulations/${sid}/status`, { status: 'active' })).body.simulation.status === 'active' &&
      (await call('owner', 'POST', `/simulations/${sid}/status`, { status: 'closed' })).body.simulation.status === 'closed' &&
      (await call('owner', 'POST', `/simulations/${sid}/status`, { status: 'active' })).status === 409 && (await call('owner', 'POST', `/simulations/${sid}/status`, { status: 'x' })).status === 400);
    t('невідомий допит — 404', (await call('owner', 'GET', '/simulations/00000000-0000-4000-8000-000000000000')).status === 404);
  } finally {
    server.close();
  }
  const bare = serve(false);
  try {
    const st = await call('owner', 'POST', `/characters/${olena}/interview`, {}, bare.base);
    t('без Jev/голосу в сервері — хід 503 (почати й читати — можна)', st.status === 201 && (await call('owner', 'POST', `/simulations/${st.body.simulation.id}/turn`, { question: 'x' }, bare.base)).status === 503);
  } finally {
    bare.server.close();
  }
}

async function proposalSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nПропозиції в канон — В4 (${label}):`);
  const prev = new Map<string, { ids: string[]; hashes: string[] }>();
  const sec = (id: string, order: number, content: string) => {
    const old = prev.get(id);
    const r = reconcileParagraphIds({ sectionId: id, content, prevIds: old?.ids, prevHashes: old?.hashes });
    prev.set(id, { ids: r.ids, hashes: r.hashes });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book = (s2: string) => ({
    id: P, ownerId: 'u-owner', title: 'Архів',
    book: {
      id: P, title: 'Архів', characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
      chapters: [
        { id: 'ch1', title: 'Гл. 1', order: 0, sections: [
          sec('s1', 0, '[/character:Олена] [/character:Марко] Марко звинуватив Олену в крадіжці архіву.'),
          sec('s2', 1, s2),
        ] },
        { id: 'ch2', title: 'Гл. 2', order: 1, sections: [sec('s3', 0, '[/character:Олена] Олена поїхала до столиці.')] },
      ],
    },
  } as any);
  await syncBookToCore(repo, book('[/character:Олена] Олена сиділа сама в кабінеті.\n\nЗа вікном ішов дощ.'));
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const actor = 'user:u-owner';
  await setAgent(repo, P, olena, { autonomyLevel: 'interview' }, actor);

  t('П7: чистий фрагмент — без тегів і маркерів чернетки, абзаци збережено',
    cleanFragmentText('[/character:Олена] Я мовчала.  [/emotion:страх @Олена]\n\n[AI-DRAFT]Дощ.') === 'Я мовчала.\n\nДощ.');
  t('П7: тег — рівно один тег книги з реєстру зі значенням', validProposalTag('[/emotion:тривога @Олена]') === '[/emotion:тривога @Олена]' &&
    validProposalTag('тривога') === null && validProposalTag('[/emotion:тривога] зайве') === null && validProposalTag('[/nonsense:x]') === null && validProposalTag('[/emotion:]') === null);

  let n = 0;
  const voice = async (_s: string, user: string) => {
    n++;
    const q = (/Питання автора: (.*)$/m.exec(user) ?? [])[1] ?? '';
    return {
      text: JSON.stringify({
        reply: `Про «${q}» я не скажу.`,
        proposals: {
          memories: [{ type: 'recollection', content: 'Олена відчула, що їй не вірять.' }, { type: 'belief', content: `Автор питає про «${q}», бо підозрює мене.` }, { content: 'третій' }, { content: 'четвертий — зайвий' }],
          facts: [{ statement: `Олена боїться допитів (хід ${n}).`, field: 'fear' }, { statement: 'Олена кульгає.', field: 'nonsense' }],
          fragment: { text: `[/character:Олена] — Я була в кабінеті, — сказала Олена (хід ${n}).`, tags: ['[/emotion:тривога @Олена]', '[/emotion:втома @Олена]', 'не тег', '[/nonsense:x]'] },
        },
      }),
      modelId: 'fake-voice', inputTokens: 40, outputTokens: 30,
    };
  };
  const llm = async (_s: string, u: string) => {
    const pick = (id: string, v: string) => (new RegExp(`"${id}"`).test(u) ? { [id]: { choice: v } } : {});
    return { text: JSON.stringify({ answers: { ...pick('trajectory', 'waver'), ...pick('scene_motive', 'protect_self'), ...pick('next_action', 'deflect') } }), modelId: 'fake-llm', inputTokens: 1, outputTokens: 1 };
  };
  const mock = new MockJevAdapter();
  const jev = { name: 'jev' as const, evaluate: async (sn: any, q: any) => ({ ...(await mock.evaluate(sn, q)), source: 'jev' as const, confidence: 0.9 }) };
  const deps = (): InterviewDeps => ({ repo, jev, fallback: new LlmFallbackJevAdapter(llm), voice });

  const sim = await startInterview(repo, { projectId: P, characterId: olena, sceneId: 's2', actor });
  const scan0 = await scanScenes(repo, P, await repo.listTimePoints(P));
  t('на старті — відбиток межі допиту (сцена 2)', typeof (sim.config as any).boundaryHash === 'string' && (sim.config as any).boundaryHash === interviewBoundaryHash(scan0, sim));
  const simCh = await startInterview(repo, { projectId: P, characterId: olena, asOfChapter: 1, actor });
  const simS1 = await startInterview(repo, { projectId: P, characterId: olena, sceneId: 's1', actor });

  const r1 = await askQuestion(deps(), { projectId: P, simulationId: sim.id, question: 'Де ти була?', actor });
  const kinds = r1.proposals.map((p) => p.kind).join();
  t('відповідь → пропозиції: до 3 спогадів, факти, фрагмент і теги П7 до нього', r1.status === 'answered' && kinds === 'memory,memory,memory,fact,fact,fragment,tag,tag', kinds);
  const frag1 = r1.proposals.find((p) => p.kind === 'fragment')!;
  const tags1 = r1.proposals.filter((p) => p.kind === 'tag');
  t('П7: фрагмент — чистий текст; теги — окремими пропозиціями до нього (лише з реєстру)',
    !/\[\//.test(String(frag1.proposedChange.text)) && tags1.every((x) => x.parentId === frag1.id) && tags1.map((x) => x.proposedChange.tag).join() === '[/emotion:тривога @Олена],[/emotion:втома @Олена]');
  t('пропозиції — від голосу, очікують автора, джерела — питання й відповідь, хід 1; факт із невідомим полем — «інше»',
    r1.proposals.every((p) => p.status === 'pending' && p.createdBy === 'ai:character-voice' && p.sourceEventIds.join() === `${r1.question.id},${r1.event.id}` && p.proposedChange.turn === 1) &&
    r1.proposals.filter((p) => p.kind === 'fact').map((p) => p.proposedChange.field).join() === 'fear,other');
  const r2 = await askQuestion(deps(), { projectId: P, simulationId: sim.id, question: 'А вчора?', actor });
  t('повтор у цьому допиті не дублюється (той самий спогад, «кульгає», «третій»)', r2.proposals.filter((p) => p.kind === 'memory').length === 1 && r2.proposals.filter((p) => p.kind === 'fact').length === 1);
  t('допит не змінює канон: пропозиції — не спогади й не факти', (await repo.listFindings(P, { entityId: olena })).length === 0 && (await heroMemories(repo, P, { characterId: olena })).every((m) => m.origin === 'tag'));
  const views = proposalViews(await repo.listCanonProposals(P, { simulationId: sim.id }));
  t('показ: теги — всередині свого фрагмента; хід і зміст окремо', views.every((v) => v.kind !== 'tag') && views.filter((v) => v.kind === 'fragment').every((v) => v.tags!.length === 2) && views[0].turn === 1 && !('turn' in views[0].change));

  // КРИТЕРІЙ 4 — вибірково.
  const [mA, mB] = r1.proposals.filter((p) => p.kind === 'memory');
  t('вирішує лише автор (AI — ні)', (await code(() => acceptProposal(repo, { projectId: P, proposalId: mA.id, actor: 'ai:x' }))) === 'confirmed_is_author_only');
  const accM = await acceptProposal(repo, { projectId: P, proposalId: mA.id, actor, content: 'Олена відчула, що автор їй не вірить.' });
  const mem = accM.memory!;
  t('спогад прийнято → пам\'ять героя: підтверджений, від автора (з правкою), сцена допиту, джерело — хід допиту, доказ — абзаци сцени',
    mem.status === 'confirmed' && mem.origin === 'author' && mem.content === 'Олена відчула, що автор їй не вірить.' && mem.sceneId === 's2' &&
    mem.sourceEventKind === 'simulation_event' && mem.sourceEventId === r1.event.id && mem.sourceParagraphIds.length === 2 && !!mem.evidenceHash && mem.simulationId === null &&
    accM.proposal.status === 'accepted' && accM.proposal.result.memoryId === mem.id && accM.proposal.result.edited === true);
  const rejB = await rejectProposal(repo, { projectId: P, proposalId: mB.id, actor, reason: 'не так' });
  t('КРИТЕРІЙ FLC 2.0 §7 (4): інший спогад тієї ж відповіді — відхилено, у пам\'ять не потрапив', rejB.proposal.status === 'rejected' && rejB.proposal.result.reason === 'не так' &&
    !(await heroMemories(repo, P, { characterId: olena })).some((m) => /підозрює/.test(m.content)));
  t('повторне рішення — conflict', (await code(() => acceptProposal(repo, { projectId: P, proposalId: mA.id, actor }))) === 'conflict' && (await code(() => rejectProposal(repo, { projectId: P, proposalId: mB.id, actor }))) === 'conflict');
  t('прийнятий спогад герой пам\'ятає в новому допиті', (await heroMemories(repo, P, { characterId: olena, simulationId: simS1.id })).some((m) => m.id === mem.id));

  const fP = r1.proposals.find((p) => p.kind === 'fact')!;
  t('поганий вид поля — bad_input', (await code(() => acceptProposal(repo, { projectId: P, proposalId: fP.id, actor, field: 'x' }))) === 'bad_input');
  const accF = await acceptProposal(repo, { projectId: P, proposalId: fP.id, actor });
  const fact = accF.fact!;
  t('факт прийнято → факт профілю: «гіпотеза з допиту», пропозиція (не канон), поле, доказ — абзаци сцени',
    fact.kind === 'profile_fact' && fact.status === 'suggested' && (fact.payload as any).hypothesis === true && (fact.payload as any).origin === 'interview' && (fact.payload as any).field === 'fear' &&
    (fact.payload as any).simulationId === sim.id && fact.sourceParagraphIds.length === 2);
  const profile = (await buildCharacterProfile(repo, P, olena))!;
  const allFacts = [...profile.facts.confirmed, ...profile.facts.suggested, ...profile.facts.contradicted, ...profile.facts.unknown];
  t('КРИТЕРІЙ FLC 2.0 §7 (1): кожен факт профілю — з джерелом або позначкою гіпотези; факт допиту — «гіпотеза», з допиту',
    allFacts.length === 1 && allFacts.every((f) => f.sources.length > 0 || f.hypothesis) && profile.facts.suggested[0].hypothesis && profile.facts.suggested[0].origin === 'interview' && profile.facts.suggested[0].simulationId === sim.id);
  await repo.setFindingStatus(P, fact.id, 'confirmed', actor, 'підтверджено автором');
  const p2 = (await buildCharacterProfile(repo, P, olena))!;
  t('автор підтвердив у профілі — вже не гіпотеза, джерело — сцена допиту', p2.facts.confirmed.length === 1 && !p2.facts.confirmed[0].hypothesis && p2.facts.confirmed[0].sources.length === 2);

  // Фрагмент і теги (П7).
  const [tagA, tagB] = tags1;
  t('тег до неприйнятого фрагмента — conflict (спершу фрагмент)', (await code(() => acceptProposal(repo, { projectId: P, proposalId: tagA.id, actor }))) === 'conflict');
  t('фрагмент без розділу — bad_input; невідомий розділ — not_found; чужий тег — not_found',
    (await code(() => acceptProposal(repo, { projectId: P, proposalId: frag1.id, actor }))) === 'bad_input' &&
    (await code(() => acceptProposal(repo, { projectId: P, proposalId: frag1.id, actor, sectionId: 'nope' }))) === 'not_found' &&
    (await code(() => acceptProposal(repo, { projectId: P, proposalId: frag1.id, actor, sectionId: 's2', tagIds: [r2.proposals.find((p) => p.kind === 'tag')!.id] }))) === 'not_found');
  const accFr = await acceptProposal(repo, { projectId: P, proposalId: frag1.id, actor, sectionId: 's2', tagIds: [tagA.id] });
  t('фрагмент прийнято з одним тегом → що вставити: «AI-чернетка» в розділ 2, тег дописано в кінець',
    accFr.insert?.mode === 'ai_draft' && accFr.insert.sectionId === 's2' && accFr.insert.snippet === `[AI-DRAFT]\n\n${frag1.proposedChange.text} [/emotion:тривога @Олена]\n\n[/AI-DRAFT]` &&
    accFr.tags.length === 1 && accFr.tags[0].status === 'accepted' && accFr.tags[0].result.withFragment === true, accFr.insert?.snippet);
  t('рукопис сервер не змінює (вставляє редактор)', !(await repo.listAllParagraphs(P)).some((p) => /AI-DRAFT|кабінеті, — сказала/.test(p.text)));
  t('другий тег лишився пропозицією; прийнятий окремо — дописати до фрагмента в тому ж розділі',
    (await repo.getCanonProposal(P, tagB.id))!.status === 'pending' &&
    JSON.stringify((await acceptProposal(repo, { projectId: P, proposalId: tagB.id, actor })).insert) === JSON.stringify({ sectionId: 's2', mode: 'append_tag', snippet: '[/emotion:втома @Олена]' }));
  const frag2 = r2.proposals.find((p) => p.kind === 'fragment')!;
  const rj = await rejectProposal(repo, { projectId: P, proposalId: frag2.id, actor });
  t('відхилений фрагмент відхиляє свої неприйняті теги', rj.tags.length === 2 && rj.tags.every((x) => x.status === 'rejected'));

  // КРИТЕРІЙ 5 — правка сцени.
  const pendingMem = r2.proposals.find((p) => p.kind === 'memory')!;
  const syncRes = await syncBookToCore(repo, book('[/character:Олена] Олена сиділа в кабінеті з Марком.\n\nЗа вікном ішов дощ.'));
  const memAfter = (await repo.getCharacterMemory(P, mem.id))!;
  t('КРИТЕРІЙ FLC 2.0 §7 (5): правка сцени допиту — прийнятий спогад «перевірити»', memAfter.status === 'needs_review', memAfter.status);
  t('…факт з допиту — «на перегляд»', (await repo.getFinding(P, fact.id))!.needsReview === true);
  const simAfter = (await repo.getSimulation(P, sim.id))!;
  t('…допит сцени 2 і допит глави 1 — «застарів» (синхронізація), допит сцени 1 — ні',
    simAfter.status === 'stale' && (await repo.getSimulation(P, simCh.id))!.status === 'stale' && (await repo.getSimulation(P, simS1.id))!.status === 'active' && (syncRes as any).interviewsStale === 2);
  const note = (await repo.listNotifications(P, 20)).find((x) => x.kind === 'interviews_stale');
  t('…сповіщення автору: скільки допитів і неприйнятих пропозицій', !!note && /застаріли: 2/.test(note.message) && (note.payload as any).characterId === olena, note?.message);
  t('застарілий допит — нових ходів немає (conflict)', (await code(() => askQuestion(deps(), { projectId: P, simulationId: sim.id, question: 'Ще?', actor }))) === 'conflict');
  t('пропозиція застарілого — лише явно: без позначки conflict, з нею — прийнято й позначено',
    (await code(() => acceptProposal(repo, { projectId: P, proposalId: pendingMem.id, actor }))) === 'conflict' &&
    (await acceptProposal(repo, { projectId: P, proposalId: pendingMem.id, actor, acknowledgeStale: true })).proposal.result.stale === true);
  t('відхилити пропозицію застарілого — можна завжди', (await rejectProposal(repo, { projectId: P, proposalId: r2.proposals.find((p) => p.kind === 'fact')!.id, actor })).proposal.status === 'rejected');

  // Застарів без синхронізації (перевірка при зверненні).
  const simLazy = await startInterview(repo, { projectId: P, characterId: olena, sceneId: 's1', actor });
  await repo.updateSimulation(P, simLazy.id, { config: { ...simLazy.config, boundaryHash: 'f'.repeat(32) } });
  t('межа змінилась поза синхронізацією — допит сам стає «застарів» при ході', (await code(() => askQuestion(deps(), { projectId: P, simulationId: simLazy.id, question: 'x', actor }))) === 'conflict' && (await repo.getSimulation(P, simLazy.id))!.status === 'stale');

  // Маршрути.
  const r3 = await askQuestion(deps(), { projectId: P, simulationId: simS1.id, question: 'Хто винен?', actor });
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'writer', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (user: string, method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  };
  try {
    const g = await call('owner', 'GET', `/simulations/${simS1.id}`);
    t('GET …/simulations/:id — з пропозиціями (теги всередині фрагмента)', g.status === 200 && g.body.proposals.length === 6 && g.body.proposals.find((v: any) => v.kind === 'fragment').tags.length === 2);
    const pend = await call('owner', 'GET', `/characters/${olena}/proposals?status=pending`);
    t('GET …/characters/:id/proposals?status=pending — усі неприйняті героя з назвами й станом допитів',
      pend.status === 200 && pend.body.proposals.every((v: any) => v.status === 'pending') && pend.body.simulations.some((s: any) => s.id === simS1.id && s.status === 'active') && pend.body.simulations.some((s: any) => s.status === 'stale'));
    t('права: читач не бачить і не приймає (403); поганий статус — 400',
      (await call('reader', 'GET', `/characters/${olena}/proposals`)).status === 403 && (await call('reader', 'POST', `/proposals/${r3.proposals[0].id}/accept`, {})).status === 403 &&
      (await call('owner', 'GET', `/characters/${olena}/proposals?status=x`)).status === 400);
    const fr3 = r3.proposals.find((p) => p.kind === 'fragment')!;
    const acc = await call('owner', 'POST', `/proposals/${fr3.id}/accept`, { sectionId: 's1', tagIds: r3.proposals.filter((p) => p.kind === 'tag').map((p) => p.id) });
    t('POST …/accept (фрагмент з обома тегами) — insert для редактора', acc.status === 200 && acc.body.insert.mode === 'ai_draft' && acc.body.tags.length === 2 && /втома @Олена\]\n\n\[\/AI-DRAFT\]$/.test(acc.body.insert.snippet));
    t('POST …/reject; повторно — 409; невідома — 404',
      (await call('owner', 'POST', `/proposals/${r3.proposals[0].id}/reject`, { reason: 'ні' })).body.proposal.status === 'rejected' &&
      (await call('owner', 'POST', `/proposals/${r3.proposals[0].id}/reject`, {})).status === 409 &&
      (await call('owner', 'POST', '/proposals/00000000-0000-4000-8000-000000000000/accept', {})).status === 404);
    t('застарілий допит у GET — позначено', (await call('owner', 'GET', `/simulations/${sim.id}`)).body.simulation.status === 'stale');
  } finally {
    server.close();
  }
}

await repoSuite('memory', new MemoryCoreRepository(), 'int-m');
await agentSuite('memory', new MemoryCoreRepository(), 'agt-m');
await turnSuite('memory', new MemoryCoreRepository(), 'trn-m');
await proposalSuite('memory', new MemoryCoreRepository(), 'prp-m');
const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — не старіша за v17 (допит)', Number(rows[0].v) >= 17, `v${rows[0].v}`);
    const { olena, sim } = await repoSuite('postgres', new PgCoreRepository(pool), 'int-p');
    await agentSuite('postgres', new PgCoreRepository(pool), 'agt-p');
    await turnSuite('postgres', new PgCoreRepository(pool), 'trn-p');
    await proposalSuite('postgres', new PgCoreRepository(pool), 'prp-p');
    const refused = async (sql: string, params: unknown[]) => {
      try {
        await pool.query(sql, params);
        return false;
      } catch {
        return true;
      }
    };
    t('CHECK у базі: увімкнено при рівні off — ні; допит без героя — ні',
      (await refused(`UPDATE ${CORE_SCHEMA}.character_agents SET enabled = true WHERE project_id = 'int-p' AND character_id = $1`, [olena])) &&
      (await refused(`INSERT INTO ${CORE_SCHEMA}.scene_simulations (project_id, kind, base_book_revision, created_by) VALUES ('int-p', 'interview', 1, 'user:u')`, [])));
    t('CHECK у базі: питання від героя — ні; вирішена пропозиція без того, хто вирішив, — ні',
      (await refused(`INSERT INTO ${CORE_SCHEMA}.simulation_events (project_id, simulation_id, turn_index, actor, actor_character_id, event_type, created_by) VALUES ('int-p', $1, 3, 'character', $2, 'question', 'ai:x')`, [sim.id, olena])) &&
      (await refused(`INSERT INTO ${CORE_SCHEMA}.canon_proposals (project_id, simulation_id, character_id, kind, proposed_change, status, created_by) VALUES ('int-p', $1, $2, 'memory', '{}', 'accepted', 'ai:x')`, [sim.id, olena])));
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

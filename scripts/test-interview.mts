/**
 * Т2.7 — «Допит живого персонажа» (FLC етап 1, `PLAN_INTERVIEW.md`).
 *
 * В1: таблиці `character_agents`, `scene_simulations`, `simulation_events`,
 * `canon_proposals` (міграція 0017) — правила (дзеркало CHECK: увімкнено ⇔
 * рівень не off; допит — лише з героєм; питання ставить лише автор; хід
 * героя — з героєм; тег — лише до фрагмента; вирішує пропозицію лише автор і
 * лише один раз), сховища в пам'яті й PostgreSQL.
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

await repoSuite('memory', new MemoryCoreRepository(), 'int-m');
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

/**
 * Т2.6 — CharacterMemoryService: довготривала суб'єктивна пам'ять героя
 * (`PLAN_CHARACTER_MEMORY.md`).
 *
 * В1: таблиці `character_memories` і `character_states` (міграція 0016) —
 * правила (дзеркало CHECK: рівно одне з прогону / ревізії канону; шар за
 * видом — переконання ніколи не world_truth; AI лише пропонує; хто
 * підтверджує), сховища в пам'яті й PostgreSQL, ізоляція: незатверджене
 * одного прогону не бачить інший, приватне одного героя — не в пам'яті
 * іншого, «пропозиція» / «перевірити» / reader_knowledge — не в пам'яті
 * героя.
 * PostgreSQL — з CORE_TEST_DATABASE_URL (схема `fusion_core` видаляється —
 * лише тестова база!).
 *
 * Запуск: npm run test:character-memory
 */
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { checkCharacterMemory, checkCharacterMemoryStatus } from '../server/core/rules.ts';
import { heroMemories, isVisibleToHero } from '../server/core/characterMemory.ts';
import type { CharacterMemoryInput, CoreRepository } from '../server/core/types.ts';

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

const base = (x: Partial<CharacterMemoryInput> = {}): CharacterMemoryInput => ({
  projectId: 'p',
  characterId: 'c',
  memoryType: 'world_fact',
  content: 'Сергій і Анна посварились на кухні.',
  sourceEventKind: 'entity',
  origin: 'tag',
  createdBy: 'system:memory-tags',
  canonRevision: 1,
  ...x,
});

console.log('\nПравила спогаду — дзеркало CHECK міграції 0016:');
{
  const f = checkCharacterMemory(base());
  t('світовий факт із тегу: world_truth, «знає», одразу підтверджено, видно проєкту', f.layer === 'world_truth' && f.beliefStatus === 'knows' && f.status === 'confirmed' && f.visibility === 'project');
  const b = checkCharacterMemory(base({ memoryType: 'belief', content: 'Анна збрехала.' }));
  t('переконання: character_belief, «вірить»', b.layer === 'character_belief' && b.beliefStatus === 'believes');
  t('FLC 2.0 §4: переконання, спогад чи наслідок як world_truth — відмова',
    (await code(() => checkCharacterMemory(base({ memoryType: 'belief', layer: 'world_truth' })))) === 'bad_input' &&
    (await code(() => checkCharacterMemory(base({ memoryType: 'recollection', layer: 'world_truth' })))) === 'bad_input' &&
    (await code(() => checkCharacterMemory(base({ memoryType: 'consequence', layer: 'reader_knowledge' })))) === 'bad_input');
  t('знання — лише world_truth; світовий факт — не переконання; читацьке знання — дозволено',
    (await code(() => checkCharacterMemory(base({ memoryType: 'knowledge', layer: 'reader_knowledge' })))) === 'bad_input' &&
    (await code(() => checkCharacterMemory(base({ layer: 'character_belief' })))) === 'bad_input' &&
    checkCharacterMemory(base({ layer: 'reader_knowledge' })).layer === 'reader_knowledge');
  t('рівно одне: і прогін, і ревізія — ні; жодного — ні',
    (await code(() => checkCharacterMemory(base({ simulationId: 'sim-1' })))) === 'bad_input' &&
    (await code(() => checkCharacterMemory(base({ canonRevision: null })))) === 'bad_input');
  t('AI лише пропонує: типово «пропозиція», «підтверджено» — ai_suggests_only',
    checkCharacterMemory(base({ origin: 'ai', memoryType: 'recollection', createdBy: 'ai:AI-2' })).status === 'suggested' &&
    (await code(() => checkCharacterMemory(base({ origin: 'ai', memoryType: 'recollection', status: 'confirmed', createdBy: 'ai:AI-2' })))) === 'ai_suggests_only');
  t('спогад прогону — лише з його simulationId; типово «пропозиція»',
    (await code(() => checkCharacterMemory(base({ origin: 'simulation' })))) === 'bad_input' &&
    checkCharacterMemory(base({ origin: 'simulation', canonRevision: null, simulationId: 'sim-1' })).status === 'suggested');
  t('зміст 1–2000, відбиток доказів — hex, автор запису — user/ai/system',
    (await code(() => checkCharacterMemory(base({ content: '  ' })))) === 'bad_input' && (await code(() => checkCharacterMemory(base({ content: 'x'.repeat(2001) })))) === 'bad_input' &&
    (await code(() => checkCharacterMemory(base({ evidenceHash: 'nothex' })))) === 'bad_input' && (await code(() => checkCharacterMemory(base({ createdBy: 'robot' })))) === 'bad_actor');
  const ai = { status: 'suggested' as const, origin: 'ai' as const };
  t('статус: підтвердити спогад AI — лише людина (не AI, не система)',
    (await code(() => checkCharacterMemoryStatus(ai, 'confirmed', 'ai:AI-2'))) === 'confirmed_is_author_only' &&
    (await code(() => checkCharacterMemoryStatus(ai, 'confirmed', 'system:x'))) === 'confirmed_is_author_only' &&
    (await code(() => checkCharacterMemoryStatus(ai, 'confirmed', 'user:u'))) === 'ok');
  t('статус: спогад із тегу система може підтвердити (оновлення з тегів); «перевірити» — не AI; назад у «пропозицію» — ні; замінений — conflict',
    (await code(() => checkCharacterMemoryStatus({ status: 'needs_review', origin: 'tag' }, 'confirmed', 'system:memory-tags'))) === 'ok' &&
    (await code(() => checkCharacterMemoryStatus(ai, 'needs_review', 'ai:AI-2'))) === 'bad_input' &&
    (await code(() => checkCharacterMemoryStatus(ai, 'suggested', 'user:u'))) === 'bad_input' &&
    (await code(() => checkCharacterMemoryStatus({ status: 'superseded', origin: 'tag' }, 'confirmed', 'user:u'))) === 'conflict');
}

console.log('\nІзоляція без бази (isVisibleToHero):');
{
  const m = (x: any) => ({ characterId: 'serhii', layer: 'world_truth', status: 'confirmed', simulationId: null, ...x });
  t('канон: підтверджене — так; пропозиція / перевірити / відхилено — ні',
    isVisibleToHero(m({}), { characterId: 'serhii' }) && !isVisibleToHero(m({ status: 'suggested' }), { characterId: 'serhii' }) &&
    !isVisibleToHero(m({ status: 'needs_review' }), { characterId: 'serhii' }) && !isVisibleToHero(m({ status: 'rejected' }), { characterId: 'serhii' }));
  t('чужий герой — ні; reader_knowledge — ні', !isVisibleToHero(m({}), { characterId: 'anna' }) && !isVisibleToHero(m({ layer: 'reader_knowledge' }), { characterId: 'serhii' }));
  t('прогін: свій (і пропозиції в ньому) — так; інший прогін чи без прогону — ні',
    isVisibleToHero(m({ simulationId: 's1', status: 'suggested' }), { characterId: 'serhii', simulationId: 's1' }) &&
    !isVisibleToHero(m({ simulationId: 's1', status: 'suggested' }), { characterId: 'serhii', simulationId: 's2' }) &&
    !isVisibleToHero(m({ simulationId: 's1' }), { characterId: 'serhii' }) &&
    !isVisibleToHero(m({ simulationId: 's1', status: 'rejected' }), { characterId: 'serhii', simulationId: 's1' }));
}

async function repoSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nСховище пам'яті героя — В1 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Кухня',
    book: {
      id: P, title: 'Кухня', characters: [{ id: 'c-s', name: 'Сергій' }, { id: 'c-a', name: 'Анна' }],
      chapters: [{ id: 'ch1', title: 'Гл. 1', order: 0, sections: [sec('s1', 0, '[/character:Сергій] [/character:Анна] [/conflict:Сварка на кухні] Сергій і Анна посварились.')] }],
    },
  } as any);
  const serhii = (await repo.resolveAlias(P, 'character', 'Сергій'))!;
  const anna = (await repo.resolveAlias(P, 'character', 'Анна'))!;
  const quarrel = (await repo.resolveAlias(P, 'conflict', 'Сварка на кухні'))!;
  const [p1] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const rev = (await repo.getProject(P))!.revision;
  const mk = (x: Partial<CharacterMemoryInput>) => repo.addCharacterMemory(base({ projectId: P, characterId: serhii, canonRevision: rev, sourceEventId: quarrel, sourceParagraphIds: [p1], sceneId: 's1', ...x }));

  const fact = await mk({ dedupeKey: 'fact:quarrel', aboutEntityIds: [anna], storyTime: { label: 'вечір', narrativeIndex: 1, chapter: 1 }, evidenceHash: 'a'.repeat(32) });
  const back = await repo.getCharacterMemory(P, fact.id);
  t('світовий факт героя: поля збережено (про кого, джерело, абзаци, відбиток, сцена, час, ревізія)',
    !!back && back.layer === 'world_truth' && back.status === 'confirmed' && back.aboutEntityIds[0] === anna && back.sourceEventId === quarrel &&
    back.sourceParagraphIds[0] === p1 && back.evidenceHash === 'a'.repeat(32) && back.sceneId === 's1' && back.storyTime.label === 'вечір' && back.canonRevision === rev && back.simulationId === null);
  t('невідомий герой — not_found', (await code(() => mk({ characterId: '00000000-0000-4000-8000-000000000000' }))) === 'not_found');
  t('повторний збір із тим самим ключем — conflict (не дублює)', (await code(() => mk({ dedupeKey: 'fact:quarrel' }))) === 'conflict');

  const rec = await mk({ memoryType: 'recollection', origin: 'ai', createdBy: 'ai:AI-2', content: 'Анна збрехала мені просто в очі.', effects: { trust: [{ towards: anna, delta: -3 }], goals: ['перевірити її слова'] } });
  t('тлумачення AI — «пропозиція», наслідки збережено', rec.status === 'suggested' && rec.layer === 'character_belief' && (rec.effects.trust as any)[0].delta === -3);
  t('AI не підтверджує сам', (await code(() => repo.setCharacterMemoryStatus(P, rec.id, 'confirmed', 'ai:AI-2'))) === 'confirmed_is_author_only');
  const ok = await repo.setCharacterMemoryStatus(P, rec.id, 'confirmed', 'user:u-owner', 'так, саме так він це запам\'ятав');
  t('автор підтверджує — хто, коли, примітка', ok.status === 'confirmed' && ok.reviewedBy === 'user:u-owner' && !!ok.reviewedAt && ok.reviewNote?.startsWith('так') === true);
  const flagged = await repo.setCharacterMemoryStatus(P, fact.id, 'needs_review', 'system:core_sync', 'абзац змінено');
  t('«перевірити» від синхронізації', flagged.status === 'needs_review' && flagged.reviewedBy === 'system:core_sync');
  await repo.setCharacterMemoryStatus(P, fact.id, 'rejected', 'user:u-owner');
  t('після відхилення той самий ключ — знову можна (новий збір)', (await code(() => mk({ dedupeKey: 'fact:quarrel' }))) === 'ok');
  t('невідомий спогад — not_found', (await code(() => repo.setCharacterMemoryStatus(P, '00000000-0000-4000-8000-000000000000', 'confirmed', 'user:u'))) === 'not_found');

  // Ізоляція: канон, прогони, чужа приватна пам'ять, читацьке знання.
  const annaPrivate = await repo.addCharacterMemory(base({ projectId: P, characterId: anna, canonRevision: rev, memoryType: 'recollection', origin: 'author', createdBy: 'user:u-owner', visibility: 'hidden', content: 'Сергій мені більше не довіряє — сховаю ще й лист.' }));
  const annaSuggested = await repo.addCharacterMemory(base({ projectId: P, characterId: anna, canonRevision: rev, memoryType: 'belief', origin: 'ai', createdBy: 'ai:AI-2', content: 'Сергій її підозрює.' }));
  const run1 = await mk({ canonRevision: null, simulationId: 'run-1', origin: 'simulation', createdBy: 'system:interview', memoryType: 'recollection', content: 'На допиті я сказав, що вірю їй.' });
  const run1Rejected = await mk({ canonRevision: null, simulationId: 'run-1', origin: 'simulation', createdBy: 'system:interview', memoryType: 'belief', content: 'Вона в змові з братом.' });
  await repo.setCharacterMemoryStatus(P, run1Rejected.id, 'rejected', 'user:u-owner');
  const run2 = await mk({ canonRevision: null, simulationId: 'run-2', origin: 'simulation', createdBy: 'system:interview', memoryType: 'belief', content: 'Анна щось приховує.' });
  const reader = await mk({ layer: 'reader_knowledge', content: 'Читач знає, що лист у шухляді.' });
  const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
  const canon = ids(await heroMemories(repo, P, { characterId: serhii }));
  t('КРИТЕРІЙ В1: пам\'ять Сергія без прогону — лише підтверджений канон (без прогонів, читацького знання, пропозицій)',
    canon.has(rec.id) && !canon.has(run1.id) && !canon.has(run2.id) && !canon.has(reader.id) && !canon.has(fact.id), [...canon].length + ' записів');
  const r1 = ids(await heroMemories(repo, P, { characterId: serhii, simulationId: 'run-1' }));
  const r2 = ids(await heroMemories(repo, P, { characterId: serhii, simulationId: 'run-2' }));
  t('КРИТЕРІЙ В1: прогін 1 бачить свої незатверджені спогади, але не прогону 2 — і навпаки; відхилене в прогоні — ні',
    r1.has(run1.id) && !r1.has(run2.id) && r2.has(run2.id) && !r2.has(run1.id) && r1.has(rec.id) && !r1.has(run1Rejected.id));
  t('КРИТЕРІЙ ТЗ-H №5 (пам\'ять): приватне Анни й її пропозиції — ніколи не в пам\'яті Сергія',
    ![...canon, ...r1, ...r2].some((id) => id === annaPrivate.id || id === annaSuggested.id));
  const annaMem = ids(await heroMemories(repo, P, { characterId: anna }));
  t('Анна бачить власний приватний спогад, не свою непідтверджену пропозицію', annaMem.has(annaPrivate.id) && !annaMem.has(annaSuggested.id));
  t('перелік: фільтри героя, виду, статусу, лише канону чи прогону, абзаців-доказів',
    (await repo.listCharacterMemories(P, { characterId: anna })).length === 2 &&
    (await repo.listCharacterMemories(P, { characterId: serhii, memoryType: 'recollection' })).every((m) => m.memoryType === 'recollection') &&
    (await repo.listCharacterMemories(P, { status: 'suggested' })).every((m) => m.status === 'suggested') &&
    (await repo.listCharacterMemories(P, { simulationId: null })).every((m) => m.simulationId === null) &&
    (await repo.listCharacterMemories(P, { simulationId: 'run-2' })).map((m) => m.id).join() === run2.id &&
    (await repo.listCharacterMemories(P, { paragraphIds: [p1] })).length > 0 && (await repo.listCharacterMemories(P, { paragraphIds: ['nope'] })).length === 0 &&
    (await repo.listCharacterMemories(P, { paragraphIds: [] })).length === 0);

  // Стан героя на сцену (кеш будівника знімка, В5).
  const st = await repo.addCharacterState({ projectId: P, characterId: serhii, sceneId: 's1', canonRevision: rev, snapshotHash: 'b'.repeat(32), createdBy: 'system:snapshot', goals: ['перевірити слова Анни'], beliefs: [{ id: rec.id }], memoryIds: [rec.id] });
  const got = await repo.getCharacterState(P, { characterId: serhii, sceneId: 's1', simulationId: null, canonRevision: rev });
  t('стан героя на сцену: додано й знайдено за героєм + сценою + прогоном + ревізією', got?.id === st.id && got.memoryIds[0] === rec.id && (got.goals as string[])[0] === 'перевірити слова Анни' && got.stateVersion === 1);
  t('інший прогін чи ревізія — стану немає; поганий відбиток — bad_input',
    (await repo.getCharacterState(P, { characterId: serhii, sceneId: 's1', simulationId: 'run-1', canonRevision: rev })) === null &&
    (await repo.getCharacterState(P, { characterId: serhii, sceneId: 's1', simulationId: null, canonRevision: rev + 1 })) === null &&
    (await code(() => repo.addCharacterState({ projectId: P, characterId: serhii, canonRevision: rev, snapshotHash: 'x', createdBy: 'system:snapshot' }))) === 'bad_input');
  return { serhii, anna };
}

await repoSuite('memory', new MemoryCoreRepository(), 'mem-m');
const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — не старіша за v16 (пам\'ять героя)', Number(rows[0].v) >= 16, `v${rows[0].v}`);
    const { serhii } = await repoSuite('postgres', new PgCoreRepository(pool), 'mem-p');
    const ins = async (cols: string, vals: string) => {
      try {
        await pool.query(`INSERT INTO ${CORE_SCHEMA}.character_memories (project_id, character_id, ${cols}) VALUES ('mem-p', $1, ${vals})`, [serhii]);
        return false;
      } catch {
        return true;
      }
    };
    const common = `memory_type, layer, content, source_event_kind, origin, created_by`;
    t('CHECK у базі: і прогін, і ревізія — ні; жодного — ні',
      (await ins(`${common}, simulation_id, canon_revision`, `'world_fact', 'world_truth', 'x', 'entity', 'tag', 'system:x', 's', 1`)) &&
      (await ins(common, `'world_fact', 'world_truth', 'x', 'entity', 'tag', 'system:x'`)));
    t('CHECK у базі: переконання як world_truth — ні; AI «підтверджено» без того, хто підтвердив, — ні',
      (await ins(`${common}, canon_revision`, `'belief', 'world_truth', 'x', 'entity', 'tag', 'system:x', 1`)) &&
      (await ins(`${common}, canon_revision, status`, `'recollection', 'character_belief', 'x', 'entity', 'ai', 'ai:AI-2', 1, 'confirmed'`)));
    t('CHECK у базі: спогад прогону без прогону — ні', await ins(`${common}, canon_revision`, `'recollection', 'character_belief', 'x', 'entity', 'simulation', 'system:x', 1`));
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

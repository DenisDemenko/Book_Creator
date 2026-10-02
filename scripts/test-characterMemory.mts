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
 *
 * В2: пам'ять із тегів (світовий факт, знання, переконання, наслідок; без
 * AI; повторний збір не дублює, відхилене не відроджує), записи автора,
 * межа знань у часі — КРИТЕРІЙ ТЗ-H №5: станом на сцену немає спогадів із
 * пізніших сцен і чужої пам'яті; флешбек — за часом світу; станом на главу.
 *
 * В3: інвалідація за ревізією — КРИТЕРІЙ: правка сцени (синхронізація)
 * позначає «перевірити» всі залежні спогади канону (з тегів, автора, AI),
 * решта й спогади прогонів — без змін; сповіщення; «перевірити» — не в
 * пам'яті героя; автор: «досі так» (новий відбиток), «відхилити», «оновити з
 * тегів» (тег змінився — новий спогад; тегу немає — нічого).
 *
 * В4: AI-2 тлумачить подію очима кожного учасника (фонова задача
 * `ai_memory`) — КРИТЕРІЙ FLC 2.0: сварка Сергія й Анни — один факт, дві
 * різні інтерпретації (Сергій: «Анна збрехала» → перевірити її слова; Анна:
 * «Сергій більше не довіряє» → приховати ще одну обставину), кожна лише в
 * пам'яті свого героя; окремий запит на героя (приватне одного не йде в
 * запит іншого); лише пропозиції з доказами; повторний прогін не дублює.
 *
 * В5: CharacterSnapshotBuilder і character_states — знімок героя станом на
 * сцену (профіль + пам'ять), КРИТЕРІЙ: знімок на сцену 2 не містить нічого
 * зі сцени 3 і з пам'яті іншого героя; ліміт Jev (канон і факти не
 * відкидаються); стан на сцену — кеш за відбитком; три рівні Jev — через
 * будівник, підтверджений спогад — значуща подія; `GET …/snapshot` і права.
 *
 * В6: маршрути пам'яті — перелік (статуси, приватне лише власнику,
 * ?chapter), свій спогад, збір із тегів, рішення автора, запуск AI-2; права
 * (чужий 403, читач — перегляд без змін).
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
import { addAuthorMemory, collectTagMemories, heroMemories, isVisibleToHero, memoriesAt, memoryEvidenceHash, reviewMemory } from '../server/core/characterMemory.ts';
import type { CharacterMemoryInput, CoreRepository } from '../server/core/types.ts';
import { VIA_WORKFLOWS, workflowEngineFor, workflowRunsOf } from './lib/workflowTestEngine.mts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { PgJobStore } from '../server/core/jobs/pgJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import type { JobStore } from '../server/core/jobs/types.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';
import { AI_MEMORY_JOB_KIND, aiMemoryJobKind } from '../server/core/memoryAi.ts';
import { buildCharacterSnapshot } from '../server/core/characterSnapshot.ts';
import { validateSnapshot } from '../server/ai/contracts/index.ts';
import { jevState, LlmFallbackJevAdapter, MockJevAdapter } from '../server/ai/adapters/jev/index.ts';
import { JevDecisionAdapter } from '../server/core/jevLevels.ts';
import { PROFILE_FACT } from '../server/core/characterProfile.ts';
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

async function tagsSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nПам'ять із тегів і межа знань — В2 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Кухня',
    book: {
      id: P, title: 'Кухня', characters: [{ id: 'c-s', name: 'Сергій' }, { id: 'c-a', name: 'Анна' }],
      chapters: [
        { id: 'ch1', title: 'Гл. 1', order: 0, sections: [
          sec('s1', 0, '[/character:Сергій] [/character:Анна] [/conflict:Сварка на кухні] Сергій і Анна посварились.\n\n[/belief:Анна бреше @Сергій] [/emotion:гнів] Сергій вирішив, що Анна бреше.'),
          sec('s2', 1, '[/character:Сергій] [/revelation:Лист у шухляді @Сергій] Сергій знайшов лист.\n\n[/consequence:Недовіра до Анни @Сергій] Тепер він їй не вірив.'),
        ] },
        { id: 'ch2', title: 'Гл. 2', order: 1, sections: [
          sec('s3', 0, '[/character:Анна] [/event:Втеча з міста @Анна] [/goal:Сховатися @Анна] Анна поїхала з міста.'),
          sec('s4', 1, '[/character:Сергій] [/event:Дитинство біля річки @Сергій] Колись, у дитинстві, Сергій жив біля річки.'),
        ] },
      ],
    },
  } as any);
  const serhii = (await repo.resolveAlias(P, 'character', 'Сергій'))!;
  const anna = (await repo.resolveAlias(P, 'character', 'Анна'))!;
  // Час світу: s4 — флешбек (раніше за все), решта — по черзі.
  const tp = (sid: string, key: number, lbl: string) => repo.upsertTimePoint({ projectId: P, subjectKind: 'scene', subjectId: sid, kind: 'exact', start: String(key), end: null, sortKey: key, endKey: null, label: lbl, createdBy: 'user:u-owner' } as any);
  await tp('s1', 10, 'вечір сварки');
  await tp('s2', 20, 'ніч');
  await tp('s3', 30, 'ранок');
  await tp('s4', 1, 'дитинство');

  const first = await collectTagMemories(repo, P);
  const mine = async (hero: string) => (await repo.listCharacterMemories(P, { characterId: hero })).filter((m) => m.origin === 'tag');
  const sm = await mine(serhii);
  const am = await mine(anna);
  const kinds = (xs: { memoryType: string; sceneId: string | null }[]) => xs.map((m) => `${m.memoryType}@${m.sceneId}`).sort().join(',');
  t('Сергій із тегів: світовий факт (сварка, дитинство), переконання, знання (лист), наслідок', kinds(sm) === 'belief@s1,consequence@s2,knowledge@s2,world_fact@s1,world_fact@s4', kinds(sm));
  t('Анна: сварка (була присутня) і її втеча; чужі переконання, розкриття й наслідок Сергія — ні; емоції й цілі — не пам\'ять', kinds(am) === 'world_fact@s1,world_fact@s3', kinds(am));
  const belief = sm.find((m) => m.memoryType === 'belief')!;
  const fact = sm.find((m) => m.memoryType === 'world_fact' && m.sceneId === 's1')!;
  t('поля: шар, певність, правда, джерело-сутність, абзац, відбиток, час сцени, ревізія, підтверджено',
    belief.layer === 'character_belief' && belief.beliefStatus === 'believes' && belief.truth === 'unknown' && fact.layer === 'world_truth' && fact.truth === 'true' &&
    fact.sourceEventKind === 'entity' && !!fact.sourceEventId && fact.sourceParagraphIds.length === 1 && /^[0-9a-f]{32}$/.test(fact.evidenceHash ?? '') &&
    fact.storyTime.label === 'вечір сварки' && fact.storyTime.chapter === 1 && fact.canonRevision! >= 1 && fact.status === 'confirmed' && fact.createdBy === 'system:memory-tags' &&
    /^Конфлікт: Сварка на кухні/.test(fact.content), fact.content);
  t('підсумок збору: створено 7, по видах', first.created === 7 && first.byType.world_fact === 4 && first.byType.belief === 1 && first.byType.knowledge === 1 && first.byType.consequence === 1, JSON.stringify(first));
  const again = await collectTagMemories(repo, P);
  t('повторний збір — нічого нового (не дублює)', again.created === 0 && again.unchanged === 7 && (await repo.listCharacterMemories(P)).length === 7);
  await repo.setCharacterMemoryStatus(P, belief.id, 'rejected', 'user:u-owner', 'це не переконання, а здогад');
  const third = await collectTagMemories(repo, P, { characterId: serhii });
  t('відхилене автором не відроджується при новому зборі; збір одного героя', third.created === 0 && third.skippedRejected === 1 && third.unchanged === 4);
  t('збір для невідомого героя — not_found', (await code(() => collectTagMemories(repo, P, { characterId: '00000000-0000-4000-8000-000000000000' }))) === 'not_found');

  // Автор вписує спогад Анни — приватний, про Сергія, зі сцени 1.
  const [a1] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const annaNote = await addAuthorMemory(repo, { projectId: P, characterId: anna, memoryType: 'recollection', content: 'Сергій мені більше не довіряє — сховаю ще й лист.', sourceParagraphIds: [a1], aboutEntityIds: [serhii], visibility: 'hidden', effects: { trust: [{ towards: serhii, delta: -2 }] }, actor: 'user:u-owner' });
  t('спогад автора: підтверджено, сцена з абзацу, відбиток, час, джерело — абзац',
    annaNote.status === 'confirmed' && annaNote.origin === 'author' && annaNote.sceneId === 's1' && !!annaNote.evidenceHash && annaNote.storyTime.label === 'вечір сварки' && annaNote.sourceEventKind === 'paragraph');
  t('спогад автора: не від людини, невідома сцена чи абзац, не герой — відмова',
    (await code(() => addAuthorMemory(repo, { projectId: P, characterId: anna, memoryType: 'belief', content: 'x', actor: 'ai:AI-2' }))) === 'bad_input' &&
    (await code(() => addAuthorMemory(repo, { projectId: P, characterId: anna, memoryType: 'belief', content: 'x', sceneId: 'nope', actor: 'user:u' }))) === 'not_found' &&
    (await code(() => addAuthorMemory(repo, { projectId: P, characterId: anna, memoryType: 'belief', content: 'x', sourceParagraphIds: ['nope'], actor: 'user:u' }))) === 'not_found' &&
    (await code(() => addAuthorMemory(repo, { projectId: P, characterId: fact.sourceEventId!, memoryType: 'belief', content: 'x', actor: 'user:u' }))) === 'not_found');
  const backstory = await addAuthorMemory(repo, { projectId: P, characterId: serhii, memoryType: 'belief', content: 'Людям не можна довіряти до кінця.', actor: 'user:u-owner' });

  const at = async (hero: string, o: any) => (await memoriesAt(repo, P, hero, o));
  const names = (r: { memories: { memoryType: string; sceneId: string | null }[] }) => kinds(r.memories);
  const s2 = await at(serhii, { sceneId: 's2' });
  t('КРИТЕРІЙ ТЗ-H №5: Сергій станом на сцену 2 — сварка (с.1), флешбек-дитинство (раніше в часі), передісторія; без листа й наслідку з самої с.2 і без пізнішого',
    names(s2) === 'belief@null,world_fact@s1,world_fact@s4' && s2.later === 2, `${names(s2)} · later ${s2.later}`);
  const s3 = await at(serhii, { sceneId: 's3' });
  t('станом на сцену 3 — уже і лист, і наслідок', names(s3) === 'belief@null,consequence@s2,knowledge@s2,world_fact@s1,world_fact@s4', names(s3));
  const annaS2 = await at(anna, { sceneId: 's2' });
  t('КРИТЕРІЙ ТЗ-H №5: Анна станом на сцену 2 — лише своє (сварка й власний приватний спогад), нічого з пам\'яті Сергія',
    names(annaS2) === 'recollection@s1,world_fact@s1' && !annaS2.memories.some((m) => m.characterId !== anna), names(annaS2));
  t('приватний спогад Анни — ніколи в пам\'яті Сергія (з будь-якої сцени)', !(await at(serhii, { sceneId: 's3' })).memories.some((m) => m.id === annaNote.id) && !(await heroMemories(repo, P, { characterId: serhii })).some((m) => m.id === annaNote.id));
  const ch1 = await at(serhii, { asOfChapter: 1 });
  t('станом на главу 1 — без глави 2 (і флешбеку в ній: читач ще не дочитав)', names(ch1) === 'belief@null,consequence@s2,knowledge@s2,world_fact@s1', names(ch1));
  const s1 = await at(serhii, { sceneId: 's1' });
  t('на самому початку (сцена 1) — лише флешбек і передісторія', names(s1) === 'belief@null,world_fact@s4', names(s1));
  const run = await repo.addCharacterMemory({ projectId: P, characterId: serhii, memoryType: 'recollection', content: 'На допиті я збрехав про лист.', sourceEventKind: 'simulation_event', origin: 'simulation', simulationId: 'run-9', sceneId: 's3', createdBy: 'system:interview' });
  t('спогад свого прогону — у пам\'яті й до його сцени; без прогону — ні',
    (await at(serhii, { sceneId: 's1', simulationId: 'run-9' })).memories.some((m) => m.id === run.id) && !(await at(serhii, { sceneId: 's3' })).memories.some((m) => m.id === run.id));
  t('невідома сцена — not_found; без сцени й глави — уся підтверджена пам\'ять', (await code(() => at(serhii, { sceneId: 'nope' }))) === 'not_found' && (await at(serhii, {})).memories.length === 5);
  t('відбиток доказів: той самий текст — той самий; інший текст чи зникнення — інший; без абзаців — немає',
    memoryEvidenceHash(() => 'h1', ['p1', 'p2']) === memoryEvidenceHash(() => 'h1', ['p2', 'p1']) && memoryEvidenceHash(() => 'h1', ['p1']) !== memoryEvidenceHash(() => 'h2', ['p1']) &&
    memoryEvidenceHash(() => 'h1', ['p1']) !== memoryEvidenceHash(() => undefined, ['p1']) && memoryEvidenceHash(() => 'h1', []) === null);
  void backstory;
}

async function reviewSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nІнвалідація за ревізією — В3 (${label}):`);
  const prev = new Map<string, { ids: string[]; hashes: string[] }>();
  const sec = (id: string, order: number, content: string) => {
    const old = prev.get(id);
    const r = reconcileParagraphIds({ sectionId: id, content, prevIds: old?.ids, prevHashes: old?.hashes });
    prev.set(id, { ids: r.ids, hashes: r.hashes });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const text = {
    s1: '[/character:Сергій] [/character:Анна] [/conflict:Сварка на кухні] Сергій і Анна посварились.\n\n[/belief:Анна бреше @Сергій] Сергій вирішив, що Анна бреше.',
    s2: '[/character:Сергій] [/revelation:Лист у шухляді @Сергій] Сергій знайшов лист.',
  };
  const sync = () => syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Кухня',
    book: { id: P, title: 'Кухня', characters: [{ id: 'c-s', name: 'Сергій' }, { id: 'c-a', name: 'Анна' }], chapters: [{ id: 'ch1', title: 'Гл. 1', order: 0, sections: [sec('s1', 0, text.s1), sec('s2', 1, text.s2)] }] },
  } as any);
  await sync();
  const serhii = (await repo.resolveAlias(P, 'character', 'Сергій'))!;
  const anna = (await repo.resolveAlias(P, 'character', 'Анна'))!;
  await collectTagMemories(repo, P);
  const [q1, q2] = (await repo.listParagraphs(P, 's1')).sort((a, b) => a.order - b.order).map((p) => p.id);
  const author = await addAuthorMemory(repo, { projectId: P, characterId: anna, memoryType: 'recollection', content: 'Сергій на мене накричав.', sourceParagraphIds: [q1], actor: 'user:u-owner' });
  const ai = await repo.addCharacterMemory({ projectId: P, characterId: serhii, memoryType: 'consequence', content: 'Довіра до Анни впала.', sourceEventKind: 'paragraph', sourceParagraphIds: [q1], evidenceHash: author.evidenceHash, sceneId: 's1', canonRevision: author.canonRevision, origin: 'ai', createdBy: 'ai:AI-2' });
  const backstory = await addAuthorMemory(repo, { projectId: P, characterId: serhii, memoryType: 'belief', content: 'Людям не можна довіряти.', actor: 'user:u-owner' });
  const run = await repo.addCharacterMemory({ projectId: P, characterId: serhii, memoryType: 'recollection', content: 'На допиті я згадав сварку.', sourceEventKind: 'simulation_event', sourceParagraphIds: [q1], origin: 'simulation', simulationId: 'run-1', createdBy: 'system:interview' });
  const all0 = await repo.listCharacterMemories(P);
  const byKey = (k: string) => all0.find((m) => m.dedupeKey?.startsWith(k))!;
  const quarrelS = all0.find((m) => m.characterId === serhii && m.memoryType === 'world_fact')!;
  const quarrelA = all0.find((m) => m.characterId === anna && m.memoryType === 'world_fact')!;
  const belief = byKey('tag:belief');
  const letter = byKey('tag:knowledge');
  const revBefore = (await repo.getProject(P))!.revision;

  // Автор правит перший абзац сцени 1 (сварка) — друга частина сцени й сцена 2 без змін.
  text.s1 = text.s1.replace('Сергій і Анна посварились.', 'Сергій і Анна гучно посварились через лист.');
  const res = await sync();
  const st = async (id: string) => (await repo.getCharacterMemory(P, id))!;
  t('КРИТЕРІЙ В3: правка сцени — «перевірити» всі залежні спогади канону: з тегів (обох героїв), автора, пропозиція AI',
    (await st(quarrelS.id)).status === 'needs_review' && (await st(quarrelA.id)).status === 'needs_review' && (await st(author.id)).status === 'needs_review' && (await st(ai.id)).status === 'needs_review',
    JSON.stringify(res.memoriesNeedReview));
  t('решта без змін: переконання з другого абзацу, лист зі сцени 2, передісторія без доказів, спогад прогону',
    (await st(belief.id)).status === 'confirmed' && (await st(letter.id)).status === 'confirmed' && (await st(backstory.id)).status === 'confirmed' && (await st(run.id)).status === 'suggested');
  const flagged = await st(quarrelS.id);
  t('хто й чому: синхронізація, примітка з ревізією; у підсумку синхронізації — 4', flagged.reviewedBy === 'system:core_sync' && /змінено \(ревізія \d+\)/.test(flagged.reviewNote ?? '') && res.memoriesNeedReview === 4 && res.revision > revBefore);
  const notes = (await repo.listNotifications(P, 20)).filter((n) => n.kind === 'memories_need_review');
  t('сповіщення — по одному на героя, з id спогадів і абзацом', notes.length === 2 && notes.some((n) => (n.payload as any).characterId === serhii && (n.payload as any).memoryIds.length === 2) && notes.every((n) => n.paragraphIds.includes(q1)), notes.map((n) => n.message).join(' | '));
  t('«перевірити» — не в пам\'яті героя (fail closed); спогад прогону в прогоні — так',
    !(await heroMemories(repo, P, { characterId: serhii })).some((m) => m.id === quarrelS.id) && (await heroMemories(repo, P, { characterId: serhii, simulationId: 'run-1' })).some((m) => m.id === run.id));
  const again = await sync();
  t('повторне збереження без змін — нових позначок немає', (again.memoriesNeedReview ?? 0) === 0);

  // Рішення автора.
  t('рішення — лише людина; невідомий — not_found',
    (await code(() => reviewMemory(repo, P, author.id, 'confirm', 'ai:AI-2'))) === 'confirmed_is_author_only' && (await code(() => reviewMemory(repo, P, '00000000-0000-4000-8000-000000000000', 'confirm', 'user:u'))) === 'not_found');
  const ok = await reviewMemory(repo, P, author.id, 'confirm', 'user:u-owner', 'досі так');
  t('«досі так» — підтверджено, новий відбиток і ревізія; знову в пам\'яті героя',
    ok.memory.status === 'confirmed' && ok.memory.evidenceHash !== author.evidenceHash && ok.memory.canonRevision! > author.canonRevision! && (await heroMemories(repo, P, { characterId: anna })).some((m) => m.id === author.id));
  t('підтверджене з новим відбитком не позначається знову, доки текст той самий', ((await sync()).memoriesNeedReview ?? 0) === 0 && (await st(author.id)).status === 'confirmed');
  t('відхилити пропозицію AI, яка «перевірити»', (await reviewMemory(repo, P, ai.id, 'reject', 'user:u-owner')).memory.status === 'rejected');
  t('«оновити з тегів» — лише для спогаду з тегів', (await code(() => reviewMemory(repo, P, author.id, 'refresh', 'user:u-owner'))) === 'bad_input');
  const upd = await reviewMemory(repo, P, quarrelS.id, 'refresh', 'user:u-owner');
  t('«оновити з тегів»: старий — замінено, новий — підтверджений, з поточним відбитком (тег ще є)',
    upd.memory.status === 'superseded' && !!upd.replacement && upd.replacement.status === 'confirmed' && upd.replacement.evidenceHash !== quarrelS.evidenceHash && upd.replacement.dedupeKey === quarrelS.dedupeKey);
  t('замінений — більше не змінюється (conflict)', (await code(() => reviewMemory(repo, P, quarrelS.id, 'confirm', 'user:u-owner'))) === 'conflict');

  // Автор прибрав тег розкриття зі сцени 2 — «оновити з тегів» нічого не створює.
  text.s2 = 'Сергій знайшов лист.';
  const r2 = await sync();
  t('правка сцени 2 — лист «перевірити»', (await st(letter.id)).status === 'needs_review' && r2.memoriesNeedReview === 1);
  const gone = await reviewMemory(repo, P, letter.id, 'refresh', 'user:u-owner');
  t('тегу вже немає — старий замінено, нового немає', gone.memory.status === 'superseded' && gone.replacement === null);
  // Абзац видалено зовсім.
  text.s1 = '[/character:Сергій] [/character:Анна] [/conflict:Сварка на кухні] Сергій і Анна гучно посварились через лист.';
  await sync();
  const bf = await st(belief.id);
  t('абзац-доказ видалено — «перевірити» з приміткою; «досі так» уже не можна (conflict)',
    bf.status === 'needs_review' && /видалено/.test(bf.reviewNote ?? '') && (await code(() => reviewMemory(repo, P, belief.id, 'confirm', 'user:u-owner'))) === 'conflict');
  void q2;
}

async function aiSuite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nAI-2 тлумачить подію очима учасників — В4 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Кухня',
    book: {
      id: P, title: 'Кухня', characters: [{ id: 'c-s', name: 'Сергій' }, { id: 'c-a', name: 'Анна' }, { id: 'c-m', name: 'Марко' }],
      chapters: [{ id: 'ch1', title: 'Гл. 1', order: 0, sections: [
        sec('s0', 0, '[/character:Анна] Анна сховала лист у шухляду.\n\n[/character:Марко] Марко ремонтував авто.'),
        sec('s1', 1, '[/character:Сергій] [/character:Анна] [/conflict:Сварка на кухні] Сергій спитав про лист, Анна сказала, що нічого не знає.\n\nСергій грюкнув дверима.'),
        sec('s2', 2, '[/character:Марко] Марко їхав містом.'),
      ] }],
    },
  } as any);
  const serhii = (await repo.resolveAlias(P, 'character', 'Сергій'))!;
  const anna = (await repo.resolveAlias(P, 'character', 'Анна'))!;
  const quarrel = (await repo.resolveAlias(P, 'conflict', 'Сварка на кухні'))!;
  const [a0] = (await repo.listParagraphs(P, 's0')).sort((a, b) => a.order - b.order).map((p) => p.id);
  const [p1, p2] = (await repo.listParagraphs(P, 's1')).sort((a, b) => a.order - b.order).map((p) => p.id);
  // Пам'ять героїв станом на сварку: приватне Анни (лист) і переконання Сергія.
  await addAuthorMemory(repo, { projectId: P, characterId: anna, memoryType: 'recollection', content: 'Я сховала лист у шухляду — ніхто не має знати.', sourceParagraphIds: [a0], visibility: 'hidden', actor: 'user:u-owner' });
  await addAuthorMemory(repo, { projectId: P, characterId: serhii, memoryType: 'belief', content: 'Анна щось від мене приховує останнім часом.', actor: 'user:u-owner' });

  const calls: AiGenerateInput[] = [];
  const generate = async (input: AiGenerateInput) => {
    calls.push(input);
    const heroIs = (n: string) => input.user.includes(`ОЧИМА героя «${n}»`);
    const findings = heroIs('Сергій')
      ? [
          { kind: 'memory_recollection', summary: 'Сергій вважає, що Анна збрехала йому просто в очі.', about: ['Анна'], paragraph_ids: [p1], quote: 'нічого не знає', confidence: 0.8 },
          { kind: 'memory_consequence', summary: 'Сергій більше не вірить Анні й вирішує перевірити її слова.', trust: [{ towards: 'Анна', delta: -5 }], fear_delta: 0, goals: ['перевірити слова Анни'], paragraph_ids: [p1, p2], confidence: 0.7 },
          { kind: 'memory_belief', summary: 'Анна в змові з Марком.', about: ['Марко'], paragraph_ids: [a0], confidence: 0.4 },
        ]
      : [
          { kind: 'memory_recollection', summary: 'Анна вважає, що Сергій більше їй не довіряє.', about: ['Сергій'], paragraph_ids: [p1, p2], confidence: 0.8 },
          { kind: 'memory_consequence', summary: 'Анна вирішує приховати ще одну обставину.', trust: [{ towards: 'Сергій', delta: -1 }], goals: ['приховати ще одну обставину'], paragraph_ids: [p2], confidence: 0.7 },
          { kind: 'memory_belief', summary: 'Сергій знає про лист.', certainty: 'doubts', truth: 'false', about: ['Сергій'], paragraph_ids: [p1], confidence: 0.5 },
          { kind: 'continuity_issue', summary: 'Не той вид.', paragraph_ids: [p1], confidence: 0.5 },
        ];
    return { text: JSON.stringify({ findings }), modelId: 'fake-ai2', engine: 'fake', inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
  };
  let clock = Date.parse('2026-09-28T10:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_MEMORY_JOB_KIND, aiMemoryJobKind({ repo: () => repo, generate, resolveModel: async () => 'fake-ai2', workflows: await workflowEngineFor(repo, { generate, resolveModel: async () => 'fake-ai2' }) }));
  const run = async (payload: Record<string, unknown>) => {
    const { job } = await q.enqueue({ projectId: P, kind: AI_MEMORY_JOB_KIND, payload, createdBy: 'user:u-owner' });
    await q.runOnce();
    clock += 61_000;
    return (await jobStore.get(P, job.id))!;
  };
  const j = await run({ sectionId: 's1' });
  const r = j.result as any;
  t('задача: окремий виклик AI-2 на кожного учасника сварки (Сергій, Анна), модуль coreAi2Analysis', calls.length === 2 && calls.every((c) => c.module === 'coreAi2Analysis') && r?.heroes?.length === 2, JSON.stringify(r ?? j.error));
  const sPrompt = calls.find((c) => c.user.includes('ОЧИМА героя «Сергій»'))!.user;
  const aPrompt = calls.find((c) => c.user.includes('ОЧИМА героя «Анна»'))!.user;
  t('ТЗ-H §5.1: приватне Анни (лист у шухляді) — лише в її запиті; переконання Сергія — лише в його; абзаци — лише цього розділу',
    aPrompt.includes('сховала лист') && !sPrompt.includes('сховала лист') && sPrompt.includes('щось від мене приховує') && !aPrompt.includes('щось від мене приховує') &&
    sPrompt.includes(`[${p1}]`) && !sPrompt.includes(`[${a0}]`) && !aPrompt.includes(`[${a0}]`));
  const sm = (await repo.listCharacterMemories(P, { characterId: serhii })).filter((m) => m.origin === 'ai');
  const am = (await repo.listCharacterMemories(P, { characterId: anna })).filter((m) => m.origin === 'ai');
  const sRec = sm.find((m) => m.memoryType === 'recollection')!;
  const aRec = am.find((m) => m.memoryType === 'recollection')!;
  t('КРИТЕРІЙ FLC 2.0: один факт (сварка) — дві різні інтерпретації, кожна в пам\'яті свого героя',
    !!sRec && !!aRec && sRec.sourceEventId === quarrel && aRec.sourceEventId === quarrel && /Анна збрехала/.test(sRec.content) && /не довіряє/.test(aRec.content) &&
    sRec.content !== aRec.content && !sm.some((m) => /не довіряє/.test(m.content)) && !am.some((m) => /збрехала/.test(m.content)));
  const sCons = sm.find((m) => m.memoryType === 'consequence')!;
  const aCons = am.find((m) => m.memoryType === 'consequence')!;
  t('наслідки: Сергій — довіра до Анни ↓ (обмежено −3), мета «перевірити слова Анни»; Анна — приховати ще одну обставину',
    (sCons.effects.trust as any)[0].towards === anna && (sCons.effects.trust as any)[0].delta === -3 && (sCons.effects.goals as string[])[0] === 'перевірити слова Анни' &&
    (aCons.effects.goals as string[])[0] === 'приховати ще одну обставину' && sCons.aboutEntityIds.includes(anna), JSON.stringify(sCons.effects));
  const aBel = am.find((m) => m.memoryType === 'belief')!;
  t('хибне переконання Анни: «сумнівається», truth = false, шар — переконання', aBel.beliefStatus === 'doubts' && aBel.truth === 'false' && aBel.layer === 'character_belief');
  t('лише пропозиції AI з доказами розділу, відбитком, сценою, ревізією; тлумачення без абзацу розділу й чужий вид — відкинуто',
    [...sm, ...am].every((m) => m.status === 'suggested' && m.createdBy === 'ai:AI-2' && m.sceneId === 's1' && m.sourceParagraphIds.every((id) => id === p1 || id === p2) && !!m.evidenceHash && m.canonRevision !== null) &&
    sm.length === 2 && am.length === 3 && r.heroes.find((h: any) => h.characterId === serhii).rejected === 1 && r.heroes.find((h: any) => h.characterId === anna).rejected === 1, JSON.stringify(r.heroes));
  const findings = (await repo.listFindings(P, { entityId: serhii })).filter((f) => f.kind === 'memory_proposal');
  t('аудит: висновки AI-2 в analysis_findings (прогін, модель, доказ)', findings.length === 2 && findings.every((f) => !!f.runId && f.sourceParagraphIds.length > 0));
  t('до підтвердження автора — не в пам\'яті героя', !(await memoriesAt(repo, P, serhii, { sceneId: 's2' })).memories.some((m) => m.origin === 'ai'));
  t('AI не підтверджує сам', (await code(() => repo.setCharacterMemoryStatus(P, sRec.id, 'confirmed', 'ai:AI-2'))) === 'confirmed_is_author_only');
  await reviewMemory(repo, P, sRec.id, 'confirm', 'user:u-owner');
  await reviewMemory(repo, P, aRec.id, 'confirm', 'user:u-owner');
  const sAfter = (await memoriesAt(repo, P, serhii, { sceneId: 's2' })).memories;
  const aAfter = (await memoriesAt(repo, P, anna, { sceneId: 's2' })).memories;
  t('підтверджено автором — у пам\'яті свого героя станом на наступну сцену, не в пам\'яті іншого',
    sAfter.some((m) => m.id === sRec.id) && !sAfter.some((m) => m.id === aRec.id) && aAfter.some((m) => m.id === aRec.id) && !aAfter.some((m) => m.id === sRec.id));
  await reviewMemory(repo, P, aBel.id, 'reject', 'user:u-owner');
  calls.length = 0;
  const j2 = await run({ sectionId: 's1' });
  t('повторний прогін: нових пропозицій немає — ні підтверджене, ні відхилене не повторюється', (j2.result as any)?.proposals === 0 && calls.length === 2 && calls[1].user.includes('не повторювати'), JSON.stringify(j2.result));
  calls.length = 0;
  const j3 = await run({ sectionId: 's1', characterIds: [anna] });
  t('лише обраний герой — один виклик', calls.length === 1 && calls[0].user.includes('ОЧИМА героя «Анна»') && (j3.result as any).heroes.length === 1);
  t('розділу немає — no_section; герой не учасник — no_heroes',
    ((await run({ sectionId: 'nope' })).result as any).status === 'no_section' && ((await run({ sectionId: 's2', characterIds: [serhii] })).result as any).status === 'no_heroes');
  if (VIA_WORKFLOWS) {
    const runs = await workflowRunsOf(repo, 'ai2_memory');
    t('Т5.4: пам\'ять героя — через процес ai2_memory (LangGraph)', runs.length >= 1 && runs.every((r) => r.trigger === 'job:ai_memory'), `${runs.length}`);
  }
}

async function snapshotSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nЗнімок героя станом на сцену — В5 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Кухня',
    book: {
      id: P, title: 'Кухня', characters: [{ id: 'c-s', name: 'Сергій', role: 'protagonist' }, { id: 'c-a', name: 'Анна' }],
      chapters: [{ id: 'ch1', title: 'Гл. 1', order: 0, sections: [
        sec('s1', 0, '[/character:Сергій] [/character:Анна] [/conflict:Сварка на кухні] Сергій і Анна посварились.\n\n[/emotion:гнів @Сергій] Сергій кипів від гніву.'),
        sec('s2', 1, '[/character:Сергій] [/goal:Перевірити слова Анни @Сергій] Сергій вирішив перевірити її слова.'),
        sec('s3', 2, '[/character:Сергій] [/revelation:Лист у шухляді @Сергій] [/emotion:страх @Сергій] Сергій знайшов лист і злякався.'),
        sec('s4', 3, '[/character:Анна] [/belief:Сергій не довіряє @Анна] Анна плакала на вокзалі.'),
      ] }],
    },
  } as any);
  const serhii = (await repo.resolveAlias(P, 'character', 'Сергій'))!;
  const anna = (await repo.resolveAlias(P, 'character', 'Анна'))!;
  const [p1] = (await repo.listParagraphs(P, 's1')).sort((a, b) => a.order - b.order).map((p) => p.id);
  await collectTagMemories(repo, P);
  await addAuthorMemory(repo, { projectId: P, characterId: serhii, memoryType: 'belief', content: 'Анна бреше про лист.', sceneId: 's1', actor: 'user:u-owner' });
  await addAuthorMemory(repo, { projectId: P, characterId: anna, memoryType: 'recollection', content: 'Я сховала лист — Сергій не мусить знати.', sceneId: 's1', visibility: 'hidden', actor: 'user:u-owner' });
  const fact = await repo.addFinding({ projectId: P, entityId: serhii, kind: PROFILE_FACT, payload: { field: 'fear', statement: 'Сергій боїться зради.', assessment: 'supported' }, sourceParagraphIds: [p1], createdBy: 'ai:AI-2' });
  await repo.setFindingStatus(P, fact.id, 'confirmed', 'user:u-owner');

  const snap = (hero: string, o: any = {}) => buildCharacterSnapshot(repo, { projectId: P, characterId: hero, situation: 'Ситуація.', allowedActions: ['answer', 'lie', 'silence'], ...o });
  const at2 = await snap(serhii, { sceneId: 's2' });
  const j2 = JSON.stringify(at2.snapshot);
  t('знімок Сергія на сцену 2: сварка (пам\'ять), переконання «Анна бреше», гнів, підтверджений факт; за контрактом',
    validateSnapshot(at2.snapshot).ok && at2.snapshot.memories?.some((m) => m.type === 'world_fact' && /Сварка/.test(m.content)) === true &&
    at2.snapshot.beliefs?.some((b) => /Анна бреше/.test(b.statement)) === true && at2.snapshot.current_states.some((x) => x.name === 'гнів') &&
    at2.snapshot.confirmed_facts.some((f) => /боїться зради/.test(f.statement)) && at2.sceneApplied, j2.slice(0, 300));
  t('КРИТЕРІЙ В5 / ТЗ-H №5: на сцену 2 — нічого зі сцени 2–3 (ні мети, ні листа, ні страху, ні тексту) і нічого з пам\'яті Анни',
    !/Лист у шухляді|знайшов лист|страх|Перевірити слова|сховала лист|вокзалі|Сергій не довіряє/.test(j2) && at2.later > 0, `later ${at2.later}`);
  const at3 = await snap(serhii, { sceneId: 's3' });
  const at4 = await snap(serhii, { sceneId: 's4' });
  t('на сцену 3 — уже мета «перевірити», ще без листа; на сцену 4 — і лист (знання), і страх',
    at3.snapshot.current_states.some((x) => x.name === 'Перевірити слова Анни') && !JSON.stringify(at3.snapshot).includes('Лист у шухляді') &&
    at4.snapshot.memories?.some((m) => m.type === 'knowledge' && /Лист у шухляді/.test(m.content)) === true && at4.snapshot.current_states.some((x) => x.name === 'страх'));
  const annaAt4 = await snap(anna, { sceneId: 's4' });
  t('знімок Анни — її приватний спогад так, нічого з пам\'яті Сергія', JSON.stringify(annaAt4.snapshot).includes('сховала лист') && !/Анна бреше|Перевірити слова/.test(JSON.stringify(annaAt4.snapshot)));
  const tight = await snap(serhii, { sceneId: 's4', budgetChars: 600 });
  t('ліміт Jev: зайве відкинуто (давніші появи, потім спогади), канон і підтверджені факти лишились',
    tight.trimmed.appearances + tight.trimmed.memories + tight.trimmed.beliefs > 0 && tight.snapshot.confirmed_facts.length === at4.snapshot.confirmed_facts.length &&
    tight.snapshot.canon.length === at4.snapshot.canon.length && JSON.stringify(jevState(tight.snapshot)).length === tight.jevStateChars, JSON.stringify(tight.trimmed) + ` ${tight.jevStateChars}`);
  t('невідома сцена — not_found; сцена прогону (lenient) — знімок без межі сцени; не герой — not_found',
    (await code(() => snap(serhii, { sceneId: 'nope' }))) === 'not_found' && !(await snap(serhii, { sceneId: 'sim-scene', lenientScene: true })).sceneApplied &&
    (await code(() => snap(fact.id))) === 'not_found');
  const runMem = await repo.addCharacterMemory({ projectId: P, characterId: serhii, memoryType: 'recollection', content: 'На допиті я збрехав.', sourceEventKind: 'simulation_event', origin: 'simulation', simulationId: 'run-7', createdBy: 'system:interview' });
  t('прогін: його спогад у знімку лише цього прогону', (await snap(serhii, { sceneId: 's2', simulationId: 'run-7' })).memoryIds.includes(runMem.id) && !(await snap(serhii, { sceneId: 's2', simulationId: 'run-8' })).memoryIds.includes(runMem.id));

  // character_states — кеш за відбитком.
  const st1 = await snap(serhii, { sceneId: 's2', persist: 'user:u-owner' });
  const st2 = await snap(serhii, { sceneId: 's2', persist: 'user:u-owner' });
  t('стан на сцену: записано (цілі, емоції, переконання, стосунки, спогади), повтор — той самий запис',
    !!st1.state && !st1.stateReused && st2.stateReused && st2.state!.id === st1.state!.id && (st1.state!.emotions as any[]).some((e) => e.name === 'гнів') &&
    (st1.state!.beliefs as any[]).some((b) => /Анна бреше/.test(b.statement)) && st1.state!.memoryIds.length === st1.memoryIds.length && st1.state!.snapshotHash === st1.hash);
  await addAuthorMemory(repo, { projectId: P, characterId: serhii, memoryType: 'consequence', content: 'Після сварки Сергій зачинився в собі.', sceneId: 's1', effects: { trust: [{ towards: anna, delta: -2 }] }, actor: 'user:u-owner' });
  const st3 = await snap(serhii, { sceneId: 's2', persist: 'user:u-owner' });
  t('новий підтверджений спогад — новий відбиток і нова версія стану', !st3.stateReused && st3.hash !== st1.hash && st3.state!.stateVersion === 2 && st3.snapshot.memories!.some((m) => (m.effects as any)?.trust?.[0]?.delta === -2));
  const runState = await snap(serhii, { sceneId: 's2', simulationId: 'run-7', persist: 'system:interview' });
  t('стан прогону — окремий запис', runState.state!.id !== st3.state!.id && runState.state!.simulationId === 'run-7');

  // Три рівні Jev — через будівник.
  const seen: any[] = [];
  const mock = new MockJevAdapter();
  const jev = { name: 'jev' as const, evaluate: async (sn: any, q: any) => { seen.push(sn); return { ...(await mock.evaluate(sn, q)), confidence: 0.9 }; } };
  const engine = new JevDecisionAdapter({ repo, jev, fallback: new LlmFallbackJevAdapter(async () => ({ text: '{}', modelId: 'x', inputTokens: 0, outputTokens: 0 })) });
  const d1 = await engine.decide({ projectId: P, characterId: serhii, level: 'scene', sceneId: 's2', situation: 'Кухня', actor: 'user:u-owner' });
  const [stratSnap, sceneSnap] = seen;
  t('Jev: сценічний знімок на с.2 — з пам\'яттю й переконаннями, без листа й чужого; стратегічний — з пам\'яттю канону',
    !!d1.decision && sceneSnap.memories?.some((m: any) => /Сварка/.test(m.content)) && sceneSnap.beliefs?.length > 0 && !/Лист у шухляді|сховала лист/.test(JSON.stringify(sceneSnap)) &&
    stratSnap.memories?.length > 0 && /спогади: \d+/.test(String((await repo.getCharacterDecision(P, d1.chain[0].id))!.basis.note)));
  const again = await engine.decide({ projectId: P, characterId: serhii, level: 'strategic', actor: 'user:u-owner' });
  await addAuthorMemory(repo, { projectId: P, characterId: serhii, memoryType: 'belief', content: 'Анна не винна — лист підкинули.', sceneId: 's3', actor: 'user:u-owner' });
  const after = await engine.decide({ projectId: P, characterId: serhii, level: 'strategic', actor: 'user:u-owner' });
  t('підтверджений спогад канону — значуща подія: стратегічне перераховано (до того — з кешу)', again.reused && !after.reused && after.decision.cacheKey !== again.decision.cacheKey);

  // Маршрут GET …/snapshot.
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'writer', isGuest: false }, stranger: { id: 'u-x', role: 'writer', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready' });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}/characters`;
  try {
    const get = async (user: string, path: string) => { const r = await fetch(`${base}${path}`, { headers: { 'x-user': user } }); return { status: r.status, body: (await r.json().catch(() => ({}))) as any }; };
    const ok = await get('owner', `/${serhii}/snapshot?sceneId=s2`);
    t('GET …/snapshot?sceneId=s2 — знімок, відбиток, стан, ліміт', ok.status === 200 && ok.body.snapshot.name === 'Сергій' && ok.body.sceneApplied && /^[0-9a-f]{32}$/.test(ok.body.hash) && ok.body.state?.snapshotHash === ok.body.hash && ok.body.jevStateChars <= ok.body.budgetChars, JSON.stringify(ok.body).slice(0, 200));
    t('права: читач — 403 (приватна пам\'ять), чужий — 403; невідома сцена — 404; не герой — 404',
      (await get('reader', `/${serhii}/snapshot`)).status === 403 && (await get('stranger', `/${serhii}/snapshot`)).status === 403 &&
      (await get('owner', `/${serhii}/snapshot?sceneId=nope`)).status === 404 && (await get('owner', `/${fact.id}/snapshot`)).status === 404);
    const ch = await get('owner', `/${serhii}/snapshot?chapter=1&simulationId=run-7`);
    t('?chapter і ?simulationId', ch.status === 200 && ch.body.snapshot.as_of_chapter === 1 && ch.body.memoryIds.includes(runMem.id));
  } finally {
    server.close();
  }
}

async function routesSuite(label: string, repo: CoreRepository, jobStore: JobStore, P: string) {
  console.log(`\nМаршрути пам'яті героя — В6 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  await syncBookToCore(repo, {
    id: P, ownerId: 'u-owner', title: 'Кухня',
    book: {
      id: P, title: 'Кухня', characters: [{ id: 'c-s', name: 'Сергій' }, { id: 'c-a', name: 'Анна' }],
      chapters: [
        { id: 'ch1', title: 'Гл. 1', order: 0, sections: [sec('s1', 0, '[/character:Сергій] [/character:Анна] [/conflict:Сварка на кухні] Сергій і Анна посварились.')] },
        { id: 'ch2', title: 'Гл. 2', order: 1, sections: [sec('s2', 0, '[/character:Сергій] [/revelation:Лист у шухляді @Сергій] Сергій знайшов лист.'), sec('s3', 1, '[/character:Анна] Анна поїхала.')] },
      ],
    },
  } as any);
  const serhii = (await repo.resolveAlias(P, 'character', 'Сергій'))!;
  const anna = (await repo.resolveAlias(P, 'character', 'Анна'))!;
  const [p1] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const generate = async (input: AiGenerateInput) => ({
    text: JSON.stringify({ findings: [{ kind: 'memory_recollection', summary: 'Сергій вважає, що Анна збрехала.', about: ['Анна'], paragraph_ids: [p1], confidence: 0.8 }] }),
    modelId: 'fake-ai2', engine: 'fake', inputTokens: 10, outputTokens: 5, costUsd: 0,
  });
  let clock = Date.parse('2026-09-28T12:00:00Z');
  const q = new JobQueue(jobStore, { workerId: 'w', now: () => new Date(clock), log: () => {} });
  q.register(AI_MEMORY_JOB_KIND, aiMemoryJobKind({ repo: () => repo, generate, resolveModel: async () => 'fake-ai2', workflows: await workflowEngineFor(repo, { generate, resolveModel: async () => 'fake-ai2' }) }));
  const access = {
    async getBookOwnerId(x: string) { return x === P ? 'u-owner' : null; },
    async getCollabOwnerId() { return undefined; },
    async listAcceptedInvites() { return [{ acceptedUserId: 'u-reader', role: 'reader' }, { acceptedUserId: 'u-ed', role: 'editor' }]; },
  };
  const who: Record<string, any> = { owner: { id: 'u-owner', role: 'writer', isGuest: false }, reader: { id: 'u-reader', role: 'writer', isGuest: false }, editor: { id: 'u-ed', role: 'writer', isGuest: false }, stranger: { id: 'u-x', role: 'writer', isGuest: false } };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).principal = who[String(req.headers['x-user'])]; next(); });
  registerProjectRoutes(app, { access, repo: () => repo, coreState: () => 'ready', queue: () => q as any });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${P}`;
  const call = async (user: string, method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}${path}`, { method, headers: { 'x-user': user, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: (await r.json().catch(() => ({}))) as any };
  };
  const M = `/characters/${serhii}/memories`;
  try {
    t('права: чужий — 403; читач — перелік так, зміни — 403', (await call('stranger', 'GET', M)).status === 403 && (await call('reader', 'GET', M)).status === 200 &&
      (await call('reader', 'POST', `${M}/collect`, {})).status === 403 && (await call('reader', 'POST', M, { memoryType: 'belief', content: 'x' })).status === 403);
    const col = await call('editor', 'POST', `${M}/collect`, {});
    t('«Зібрати з тегів» (редактор): сварка й лист', col.status === 200 && col.body.created === 2, JSON.stringify(col.body));
    const list = await call('owner', 'GET', M);
    const fact = list.body.memories.find((m: any) => m.memoryType === 'world_fact');
    t('перелік: вид, статус, сцена з назвою, джерело-подія з іменем, місця абзаців для переходу, лічильники',
      list.status === 200 && list.body.canEdit && list.body.canSeePrivate && fact.status === 'confirmed' && fact.scene?.id === 's1' && fact.source.name === 'Сварка на кухні' &&
      fact.places[0]?.paragraphId === p1 && fact.places[0]?.chapterId === 'ch1' && !!fact.places[0]?.editorPid && list.body.counts.confirmed === 2, JSON.stringify(fact).slice(0, 200));
    const own = await call('owner', 'POST', M, { memoryType: 'belief', content: 'Анна щось приховує.', sceneId: 's1', visibility: 'hidden' });
    const edPriv = await call('editor', 'POST', M, { memoryType: 'belief', content: 'x', visibility: 'hidden' });
    t('свій спогад: власник — приватний (201); редактор приватний — 403; поганий вид — 400; невідома сцена — 404',
      own.status === 201 && own.body.memory.visibility === 'hidden' && own.body.memory.status === 'confirmed' && edPriv.status === 403 &&
      (await call('owner', 'POST', M, { memoryType: 'dream', content: 'x' })).status === 400 && (await call('owner', 'POST', M, { memoryType: 'belief', content: 'x', sceneId: 'nope' })).status === 404);
    t('приватне бачить лише власник: редактор і читач — ні', !(await call('editor', 'GET', M)).body.memories.some((m: any) => m.id === own.body.memory.id) && !(await call('reader', 'GET', M)).body.memories.some((m: any) => m.id === own.body.memory.id) && (await call('owner', 'GET', M)).body.memories.some((m: any) => m.id === own.body.memory.id));
    t('?chapter=1 — лише зі сцен глави 1 (без листа)', (await call('owner', 'GET', `${M}?chapter=1`)).body.memories.every((m: any) => m.scene?.chapterNumber !== 2) && (await call('owner', 'GET', `${M}?type=knowledge`)).body.memories.length === 1);
    t('AI-2: розділ, де героя немає, — 422; невідомий — 404; читач — 403',
      (await call('owner', 'POST', `${M}/ai`, { sectionId: 's3' })).status === 422 && (await call('owner', 'POST', `${M}/ai`, { sectionId: 'nope' })).status === 404 && (await call('reader', 'POST', `${M}/ai`, { sectionId: 's1' })).status === 403);
    const ai = await call('owner', 'POST', `${M}/ai`, { sectionId: 's1' });
    await q.runOnce();
    clock += 61_000;
    const job = await call('owner', 'GET', `/jobs/${ai.body.jobId}`);
    const sug = (await call('owner', 'GET', `${M}?status=suggested`)).body.memories;
    t('AI-2 — задача 202, лише для цього героя; пропозиція в переліку', ai.status === 202 && job.body.status === 'succeeded' && (job.body.result?.heroes ?? []).length === 1 && sug.length === 1 && sug[0].origin === 'ai' && sug[0].about[0]?.name === 'Анна', JSON.stringify(job.body.result));
    const bad = await call('owner', 'POST', `${M}/${sug[0].id}/review`, { action: 'maybe' });
    const foreign = await call('owner', 'POST', `/characters/${anna}/memories/${sug[0].id}/review`, { action: 'confirm' });
    t('рішення: невідома дія — 400; через іншого героя — 404; читач — 403',
      bad.status === 400 && foreign.status === 404 && (await call('reader', 'POST', `${M}/${sug[0].id}/review`, { action: 'confirm' })).status === 403);
    const ok = await call('editor', 'POST', `${M}/${sug[0].id}/review`, { action: 'confirm' });
    t('підтвердити — 200, спогад підтверджено; «оновити з тегів» не з тегів — 422', ok.status === 200 && ok.body.memory.status === 'confirmed' && (await call('owner', 'POST', `${M}/${sug[0].id}/review`, { action: 'refresh' })).status === 422);
  } finally {
    server.close();
  }
}

await repoSuite('memory', new MemoryCoreRepository(), 'mem-m');
await tagsSuite('memory', new MemoryCoreRepository(), 'tag-m');
await reviewSuite('memory', new MemoryCoreRepository(), 'rev-m');
await aiSuite('memory', new MemoryCoreRepository(), new MemoryJobStore(), 'ai-m');
await snapshotSuite('memory', new MemoryCoreRepository(), 'snap-m');
await routesSuite('memory', new MemoryCoreRepository(), new MemoryJobStore(), 'rts-m');
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
    await tagsSuite('postgres', new PgCoreRepository(pool), 'tag-p');
    await reviewSuite('postgres', new PgCoreRepository(pool), 'rev-p');
    await aiSuite('postgres', new PgCoreRepository(pool), new PgJobStore(pool), 'ai-p');
    await snapshotSuite('postgres', new PgCoreRepository(pool), 'snap-p');
    await routesSuite('postgres', new PgCoreRepository(pool), new PgJobStore(pool), 'rts-p');
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

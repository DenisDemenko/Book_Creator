/**
 * Т2.5 — адаптери, контракти й три рівні Jev (`PLAN_JEV_LEVELS.md`).
 *
 * В1: `server/ai/` за ТЗ-H §7.2 — контракти як справжні `*.schema.json`
 * (знімок героя, запит рішення з рівнем, нормалізований результат), адаптери
 * `jev` (справжній REST, підставний, запасний LLM), `llm`, `harness`
 * (наш рантайм + заготовка Harness «не налаштовано»). Контрактні тести:
 * три адаптери Jev дають ОДНУ форму відповіді (основа критеріїв ТЗ-H №2 і
 * №9), Noul — у всіх трьох, другорядний вибір рівня (траєкторія) теж лише з
 * його варіантів, старі шляхи прототипу (`server/core/flc/*`) — ті самі
 * об'єкти, заміна рантайму не торкається коду, що ним користується.
 * Мережі немає: Jev і LLM — підставні.
 *
 * В2: журнал рішень героя `character_decisions` (міграція 0015) — правила
 * запису (дзеркало CHECK), «чекає автора» без дії, рішення автора лише з
 * цього стану, заміна чинних рішень рівня, фільтри; прототип циклу пише
 * кожне рішення в журнал з відбитком, моделлю й підставами-посиланнями.
 * Пам'ять і PostgreSQL (з CORE_TEST_DATABASE_URL; схема `fusion_core`
 * видаляється — лише тестова база!).
 *
 * В3: три рівні й кеш (`JevDecisionAdapter`) — КРИТЕРІЙ Т2.5: стратегічний
 * рівень не перераховується без значущої події (емоція, новий абзац, чужий
 * поріг — ні; поріг героя, канон, підтверджений факт, межа знань — так);
 * сценічний — до зміни умов сцени чи «повороту» і до нового стратегічного;
 * тактичний — щоразу, повторно лише той самий хід прогону; ланцюжок
 * parent_id; питання рівнів із конфігурації; запасний шлях із причиною.
 *
 * Запуск: npm run test:jev-levels
 */
import fs from 'node:fs';
import {
  CHARACTER_SNAPSHOT_SCHEMA,
  DECISION_REQUEST_SCHEMA,
  DECISION_RESULT_SCHEMA,
  snapshotHash,
  validateDecision,
  validateDecisionRequest,
  validateSnapshot,
  type CharacterSnapshot,
  type JevQuestion,
} from '../server/ai/contracts/index.ts';
import {
  evaluateWithFallback,
  HttpJevAdapter,
  LlmFallbackJevAdapter,
  MockJevAdapter,
  noulProbability,
  type JevAdapter,
} from '../server/ai/adapters/jev/index.ts';
import { llmViaCore } from '../server/ai/adapters/llm/index.ts';
import { createAgentRuntime, HarnessAgentRuntime, HarnessNotConfiguredError, InProcessAgentRuntime, type AgentRuntime } from '../server/ai/adapters/harness/index.ts';
import * as oldContracts from '../server/core/flc/contracts.ts';
import * as oldJev from '../server/core/flc/jev.ts';
import * as oldRuntime from '../server/core/flc/runtime.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { createCorePool } from '../server/core/index.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { runFlcCycle } from '../server/core/flc/cycle.ts';
import { PROFILE_FACT } from '../server/core/characterProfile.ts';
import type { CoreRepository } from '../server/core/types.ts';
import { DEFAULT_LEVEL_CONFIG, JevDecisionAdapter, significantState } from '../server/core/jevLevels.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const snap: CharacterSnapshot = {
  character_id: 'c1',
  name: 'Олена',
  as_of_chapter: 2,
  canon: [{ label: 'Роль', value: 'головна героїня' }],
  confirmed_facts: [{ statement: 'Боїться води.', evidence: [{ paragraph_id: 'p1', chapter: 1, excerpt: 'Олена боялася води.' }] }],
  current_states: [{ type: 'goal', name: 'знайти брата', chapter: 1 }],
  relations: [],
  recent_appearances: [{ paragraph_id: 'p1', chapter: 1, excerpt: 'Олена боялася води.' }],
  situation: 'Слідчий питає, де вона була тієї ночі.',
  allowed_actions: ['answer', 'lie', 'silence', 'deflect'],
};
const questions: JevQuestion[] = [
  { id: 'next_action', kind: 'choice', instructions: 'Яку дію обере героїня?', options: { answer: 'відповісти', lie: 'збрехати', silence: 'промовчати', deflect: 'ухилитися' } },
  { id: 'trajectory', kind: 'choice', instructions: 'Яка траєкторія?', options: { hold: 'тримає курс', waver: 'вагається', change_goal: 'змінює ціль' } },
  { id: 'fear_intensity', kind: 'score', instructions: 'Наскільки сильний страх?', levels: ['спокій', 'тривога', 'страх', 'жах', 'паніка'] },
  { id: 'fact_consistent', kind: 'noul', instructions: 'Чи узгоджується «вона була вдома» зі знімком?' },
];

console.log('\nКонтракти — справжні *.schema.json (ТЗ-H §7.2):');
{
  const dir = new URL('../server/ai/contracts/', import.meta.url);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.schema.json')).sort();
  t('три файли схем: знімок, запит рішення, результат', files.join() === 'character-snapshot.schema.json,decision-request.schema.json,decision-result.schema.json', files.join());
  const parsed = files.map((f) => JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8')));
  t('кожна — JSON Schema draft-07 зі своїм $id і назвою', parsed.every((s) => /draft-07/.test(s.$schema) && /^https:\/\/fusionlab\.studio\/ai\/contracts\//.test(s.$id) && s.title));
  t('сервер перевіряє саме ці файли (той самий вміст)', JSON.stringify(parsed[0]) === JSON.stringify(CHARACTER_SNAPSHOT_SCHEMA) && JSON.stringify(parsed[1]) === JSON.stringify(DECISION_REQUEST_SCHEMA) && JSON.stringify(parsed[2]) === JSON.stringify(DECISION_RESULT_SCHEMA));
  t('знімок — за схемою; факт без доказу — ні', validateSnapshot(snap).ok && !validateSnapshot({ ...snap, confirmed_facts: [{ statement: 'x', evidence: [] }] }).ok);
  const req = { level: 'tactical', character_id: 'c1', situation: snap.situation, allowed_actions: snap.allowed_actions, questions };
  t('запит рішення з рівнем — за схемою', validateDecisionRequest(req).ok, validateDecisionRequest(req).errors.join());
  t('запит: невідомий рівень, choice без варіантів, score без рівнів — ні',
    !validateDecisionRequest({ ...req, level: 'weekly' }).ok &&
    !validateDecisionRequest({ ...req, questions: [{ id: 'x_y', kind: 'choice', instructions: 'a' }] }).ok &&
    !validateDecisionRequest({ ...req, questions: [{ id: 'x_y', kind: 'score', instructions: 'a' }] }).ok);
}

console.log('\nТри адаптери Jev — одна форма відповіді (ТЗ-H №2, №9):');
let sent: any = null;
const okBody = {
  model: 'jev-1.13.0',
  answers: {
    next_action: { type: 'choice', choice: 'deflect', probabilities: { answer: 0.1, lie: 0.2, silence: 0.2, deflect: 0.5 }, confidence: 0.62 },
    trajectory: { type: 'choice', choice: 'fly_away', probabilities: { hold: 0.2, waver: 0.7, change_goal: 0.1 }, confidence: 0.5 },
    fear_intensity: { type: 'score', score: 3, confidence: 0.4, probabilities: { '3': 1 } },
    fact_consistent: { type: 'noul', probability: 0.83 },
  },
  usage: { input_tokens: 900, output_tokens: 0 },
};
const fakeFetch = (status: number, body: unknown) => (async (url: string, init: any) => {
  sent = { url, body: JSON.parse(init.body) };
  return new Response(JSON.stringify(body), { status });
}) as unknown as typeof fetch;
const llmAnswers = { answers: { next_action: { choice: 'silence' }, trajectory: { choice: 'hold' }, fear_intensity: { score: 4 }, fact_consistent: { probability: 0.1 } } };
let llmCalls: string[] = [];
const fakeLlm = async (_system: string, user: string) => {
  llmCalls.push(user);
  return { text: JSON.stringify(llmAnswers), modelId: 'fake-llm', inputTokens: 300, outputTokens: 40 };
};
{
  const adapters: JevAdapter[] = [new HttpJevAdapter('k', { fetchImpl: fakeFetch(200, okBody) }), new MockJevAdapter(), new LlmFallbackJevAdapter(fakeLlm)];
  const results = [];
  for (const a of adapters) results.push(await a.evaluate(snap, questions));
  t('усі три — за схемою результату', results.every((r) => validateDecision(r).ok), results.map((r) => validateDecision(r).errors.join()).join(' | '));
  const shape = (r: any) => [Object.keys(r.scores).sort().join(), Object.keys(r.checks ?? {}).sort().join(), Object.keys(r.choices ?? {}).sort().join()].join('/');
  t('однаковий склад: оцінка страху, перевірка Noul, другорядний вибір (траєкторія)', new Set(results.map(shape)).size === 1 && shape(results[0]) === 'fear_intensity/fact_consistent/trajectory', results.map(shape).join(' · '));
  t('джерело чесно підписане: jev / mock / llm_fallback; відбиток знімка — той самий', results.map((r) => r.source).join() === 'jev,mock,llm_fallback' && results.every((r) => r.snapshot_hash === snapshotHash(snap)));
  const [jev, , llm] = results;
  t('справжній Jev: головна дія, оцінка 0–10, Noul — імовірність «так», модель', jev.selected_action === 'deflect' && jev.scores.fear_intensity === 7.5 && jev.checks?.fact_consistent === 0.83 && jev.model_version === 'jev-1.13.0');
  t('другорядний вибір поза своїм списком («fly_away») — найімовірніший із дозволених («waver»)', jev.choices?.trajectory === 'waver', JSON.stringify(jev.choices));
  t('у запиті до TypeSafe Noul — `type: noul` без criteria; choice і score — як були',
    sent.body.questions.fact_consistent?.type === 'noul' && !('criteria' in sent.body.questions.fact_consistent) &&
    sent.body.questions.next_action.type === 'choice' && Array.isArray(sent.body.questions.fear_intensity.criteria));
  t('запасний LLM: те саме в тій самій формі, Noul — у запиті й у відповіді', llm.selected_action === 'silence' && llm.checks?.fact_consistent === 0.1 && llm.choices?.trajectory === 'hold' && /так \/ ні/.test(llmCalls[0]));
}
{
  t('Noul — будь-яка форма провайдера → імовірність «так»',
    noulProbability({ probability: 0.4 }) === 0.4 && noulProbability({ probabilities: { yes: 0.7, no: 0.3 } }) === 0.7 &&
    noulProbability({ answer: 'no', confidence: 0.9 }) === 0.1 && noulProbability({ value: true }) === 1 && noulProbability({ score: 0.25 }) === 0.25 &&
    noulProbability({ probability: 7 }) === 1 && noulProbability({}) === null);
  const strategic: JevQuestion[] = [
    { id: 'long_goal', kind: 'choice', instructions: 'Провідна довга ціль?', options: { find_brother: null, protect_anna: null } },
    { id: 'motive_conflict', kind: 'score', instructions: 'Конфлікт мотивів?', levels: ['немає', 'слабкий', 'сильний'] },
  ];
  const body = { model: 'jev-1.13.0', answers: { long_goal: { choice: 'protect_anna', probabilities: { find_brother: 0.3, protect_anna: 0.7 }, confidence: 0.7 }, motive_conflict: { score: 1 } } };
  const r = await new HttpJevAdapter('k', { fetchImpl: fakeFetch(200, body) }).evaluate(snap, strategic);
  t('рівень без «next_action»: головне — перше choice, і лише з ЙОГО варіантів (не з дій ходу)', r.selected_action === 'protect_anna' && !r.corrected && r.scores.motive_conflict === 5, JSON.stringify({ a: r.selected_action, s: r.scores }));
  const bad = await new HttpJevAdapter('k', { fetchImpl: fakeFetch(200, { ...body, answers: { ...body.answers, long_goal: { choice: 'answer', probabilities: body.answers.long_goal.probabilities } } }) }).evaluate(snap, strategic);
  t('…і дія ходу як «ціль» — виправлено валідатором на найімовірнішу ціль', bad.selected_action === 'protect_anna' && bad.corrected);
}
{
  const down = new HttpJevAdapter('k', { fetchImpl: fakeFetch(529, { error: { message: 'overloaded' } }) });
  llmCalls = [];
  const r = await evaluateWithFallback(down, new LlmFallbackJevAdapter(fakeLlm), snap, questions);
  t('збій Jev (529) — запасний LLM у тій самій формі, причина збережена', r.decision.source === 'llm_fallback' && validateDecision(r.decision).ok && /529/.test(r.fallbackReason ?? '') && llmCalls.length === 1);
}

console.log('\nАдаптер LLM через ядро ШІ:');
{
  const calls: any[] = [];
  const llm = llmViaCore(async (input) => { calls.push(input); return { text: '{}', modelId: 'm-ai2', inputTokens: 1, outputTokens: 2 }; }, async () => 'm-ai2', 'book-1', 'user:u1');
  const out = await llm('sys', 'usr');
  t('модуль ролі AI-2, модель із «Ядра AI», проєкт і хто запустив — для обліку витрат', calls[0].module === 'coreAi2Analysis' && calls[0].modelId === 'm-ai2' && calls[0].projectId === 'book-1' && calls[0].actor === 'user:u1' && out.modelId === 'm-ai2');
}

console.log('\nРантайм агентів: наш і заготовка Harness (ТЗ-H №10):');
{
  const scope = { projectId: 'b', actorId: 'user:u', characterId: 'c1', simulationId: 's1' };
  const tools = [{ name: 'echo', description: 'повторює', run: async (a: any) => a }];
  // Код, що користується рантаймом, знає лише договір AgentRuntime.
  const useRuntime = (rt: AgentRuntime) => rt.step('character-agent', ['echo'], async (ctx) => ctx.tool<{ x: number }>('echo', { x: 1 }));
  const ours = createAgentRuntime('in_process', scope, tools);
  t('наш рантайм: крок виконано, журнал є', (await useRuntime(ours)).x === 1 && ours instanceof InProcessAgentRuntime && ours.trace.length > 0);
  const harness = createAgentRuntime('harness', scope, tools);
  let err: unknown = null;
  try { await useRuntime(harness); } catch (e) { err = e; }
  t('Harness до виходу з preview — чесна відмова «не підключено», а не тиха підміна', harness instanceof HarnessAgentRuntime && err instanceof HarnessNotConfiguredError && /не підключено/.test(String((err as Error).message)));
}

console.log('\nСтарі шляхи прототипу (Т1.6) — ті самі об\'єкти:');
t('server/core/flc/{contracts,jev,runtime} реекспортують server/ai/*',
  oldContracts.validateSnapshot === validateSnapshot && oldContracts.CHARACTER_SNAPSHOT_SCHEMA === CHARACTER_SNAPSHOT_SCHEMA &&
  oldJev.HttpJevAdapter === HttpJevAdapter && oldJev.MockJevAdapter === MockJevAdapter && oldRuntime.InProcessAgentRuntime === InProcessAgentRuntime);

const code = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? String(e);
  }
};

async function decisionsSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nЖурнал рішень героя character_decisions — В2 (${label}):`);
  const sec = (id: string, order: number, content: string) => {
    const r = reconcileParagraphIds({ sectionId: id, content });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const book: any = {
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [{ id: 'ch1', title: 'Ніч', order: 0, sections: [sec('s1', 0, '[/character:Олена] [/emotion:страх] Олена боялася води.\n\n[/character:Марко] Марко питав, де вона була.')] }],
  };
  await syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book });
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
  const h = 'a'.repeat(32);
  const base = { projectId: P, characterId: olena, cacheKey: 'k1', snapshotHash: h, modelVersion: 'jev-1.13.0', source: 'jev' as const, createdBy: 'user:u-owner' };

  const s1 = await repo.addCharacterDecision({ ...base, level: 'strategic', selectedAction: 'find_brother', result: { selected_action: 'find_brother' }, basis: { paragraphIds: ['p1'], note: 'значущі події: 1' }, questions: [{ id: 'long_goal' }], usage: { input_tokens: 10 }, latencyMs: 12.7 });
  t('рішення записано: чинне, рівень, модель, відбиток, підстави-посилання', s1.status === 'active' && s1.level === 'strategic' && s1.modelVersion === 'jev-1.13.0' && s1.snapshotHash === h && s1.basis.paragraphIds?.[0] === 'p1' && s1.latencyMs === 13 && s1.resolvedBy === null);
  const sc = await repo.addCharacterDecision({ ...base, level: 'scene', sceneId: 's1', cacheKey: 'k-scene', parentId: s1.id, selectedAction: 'protect_self' });
  t('сценічне — з посиланням на стратегічне (parent_id)', sc.parentId === s1.id && (await repo.getCharacterDecision(P, sc.id))?.sceneId === 's1');
  t('правила: невідомий рівень, чинне без дії, джерело «автор» напряму, поганий відбиток, чужий герой, невідомий батько',
    (await code(() => repo.addCharacterDecision({ ...base, level: 'weekly' as any, selectedAction: 'x' }))) === 'bad_input' &&
    (await code(() => repo.addCharacterDecision({ ...base, level: 'tactical' }))) === 'bad_input' &&
    (await code(() => repo.addCharacterDecision({ ...base, level: 'tactical', source: 'author', selectedAction: 'x' }))) === 'bad_input' &&
    (await code(() => repo.addCharacterDecision({ ...base, level: 'tactical', snapshotHash: 'xyz', selectedAction: 'x' }))) === 'bad_input' &&
    (await code(() => repo.addCharacterDecision({ ...base, characterId: '00000000-0000-4000-8000-000000000000', level: 'tactical', selectedAction: 'x' }))) === 'not_found' &&
    (await code(() => repo.addCharacterDecision({ ...base, level: 'tactical', selectedAction: 'x', parentId: '00000000-0000-4000-8000-000000000000' }))) === 'not_found');

  const waiting = await repo.addCharacterDecision({ ...base, level: 'tactical', status: 'awaiting_author', source: 'llm_fallback', fallbackReason: 'Jev 529; LLM: не JSON', options: { allowed: ['answer', 'lie'] } });
  t('«чекає автора» — без дії, з причиною запасного шляху', waiting.status === 'awaiting_author' && waiting.selectedAction === null && /529/.test(waiting.fallbackReason ?? ''));
  t('вибір автора: не від користувача — bad_input; порожня дія — bad_input',
    (await code(() => repo.resolveCharacterDecision(P, waiting.id, { selectedAction: 'lie', result: {}, actor: 'ai:AI-2' as any }))) === 'bad_input' &&
    (await code(() => repo.resolveCharacterDecision(P, waiting.id, { selectedAction: ' ', result: {}, actor: 'user:u-owner' }))) === 'bad_input');
  const resolved = await repo.resolveCharacterDecision(P, waiting.id, { selectedAction: 'lie', result: { selected_action: 'lie', source: 'author' }, actor: 'user:u-owner' });
  t('вибір автора — чинне, джерело «автор», хто й коли; причина збою лишилась у журналі', resolved.status === 'active' && resolved.source === 'author' && resolved.selectedAction === 'lie' && resolved.resolvedBy === 'user:u-owner' && !!resolved.resolvedAt && /529/.test(resolved.fallbackReason ?? ''));
  t('повторний вибір автора — conflict (рішення вже прийнято); невідоме — not_found',
    (await code(() => repo.resolveCharacterDecision(P, waiting.id, { selectedAction: 'answer', result: {}, actor: 'user:u-owner' }))) === 'conflict' &&
    (await code(() => repo.resolveCharacterDecision(P, '00000000-0000-4000-8000-000000000000', { selectedAction: 'answer', result: {}, actor: 'user:u-owner' }))) === 'not_found');

  const s2 = await repo.addCharacterDecision({ ...base, level: 'strategic', cacheKey: 'k2', selectedAction: 'protect_anna' });
  const n = await repo.supersedeCharacterDecisions(P, { characterId: olena, level: 'strategic', exceptId: s2.id });
  t('нове стратегічне — старе чинне стає «замінено» (лише свого рівня й героя)', n === 1 && (await repo.getCharacterDecision(P, s1.id))!.status === 'superseded' && (await repo.getCharacterDecision(P, s2.id))!.status === 'active' && (await repo.getCharacterDecision(P, sc.id))!.status === 'active');
  await repo.addCharacterDecision({ ...base, characterId: marko, level: 'scene', sceneId: 's9', cacheKey: 'k-m', selectedAction: 'ask' });
  t('заміна в межах сцени не чіпає інших сцен і героїв', (await repo.supersedeCharacterDecisions(P, { characterId: olena, level: 'scene', sceneId: 'інша' })) === 0 && (await repo.getCharacterDecision(P, sc.id))!.status === 'active');
  const olenaList = await repo.listCharacterDecisions(P, { characterId: olena });
  t('перелік героя — новіші першими; фільтри за рівнем, статусом, ключем кешу, сценою',
    olenaList[0].id === s2.id && olenaList.length === 4 &&
    (await repo.listCharacterDecisions(P, { characterId: olena, level: 'strategic', status: 'active' })).map((d) => d.id).join() === s2.id &&
    (await repo.listCharacterDecisions(P, { characterId: olena, cacheKey: 'k-scene' })).length === 1 &&
    (await repo.listCharacterDecisions(P, { sceneId: 's9' })).length === 1 && (await repo.listCharacterDecisions(P, { limit: 2 })).length === 2);

  // Прототип циклу (Т1.6) пише рішення в журнал.
  const [p1] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
  const fact = await repo.addFinding({ projectId: P, entityId: olena, kind: PROFILE_FACT, payload: { field: 'fear', statement: 'Олена боїться води.', assessment: 'supported' }, sourceParagraphIds: [p1], createdBy: 'ai:AI-2' });
  await repo.setFindingStatus(P, fact.id, 'confirmed', 'user:u-owner');
  const llm = async () => ({ text: JSON.stringify({ reply: 'Не пам\'ятаю.', intent: 'приховати' }), modelId: 'fake-llm', inputTokens: 10, outputTokens: 5 });
  const res = await runFlcCycle({ repo, jev: new MockJevAdapter(), fallback: new LlmFallbackJevAdapter(llm), llm }, { projectId: P, entityId: olena, question: 'Де ти була?', asOfChapter: 1, actorId: 'user:u-owner' });
  const logged = await repo.getCharacterDecision(P, res.decisionId);
  t('КРИТЕРІЙ В2: рішення прототипу — у журналі: тактичний рівень, прогін, відбиток знімка, модель, джерело, підстави — абзаци-докази',
    !!logged && logged.level === 'tactical' && logged.simulationId === res.simulationId && logged.snapshotHash === res.decision.snapshot_hash &&
    logged.modelVersion === 'mock-jev-0' && logged.source === 'mock' && logged.selectedAction === res.decision.selected_action && logged.basis.paragraphIds?.includes(p1) === true &&
    JSON.stringify(logged.basis).length < 300, JSON.stringify(logged?.basis));
}

async function levelsSuite(label: string, repo: CoreRepository, P: string) {
  console.log(`\nТри рівні й кеш — В3 (${label}):`);
  const prevIds = new Map<string, { ids: string[]; hashes: string[] }>();
  const sec = (id: string, order: number, content: string) => {
    const old = prevIds.get(id);
    const r = reconcileParagraphIds({ sectionId: id, content, prevIds: old?.ids, prevHashes: old?.hashes });
    prevIds.set(id, { ids: r.ids, hashes: r.hashes });
    return { id, title: id, order, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
  };
  const text = {
    s1: '[/character:Олена] [/goal:Знайти брата @Олена] [/need:Безпека @Олена] Олена шукала брата.',
    s2: '[/character:Олена] [/character:Марко] [/event:Пожежа @Марко] Марко підпалив склад, Олена бачила.',
    s3: '[/character:Марко] Марко один.',
  };
  const book = (): any => ({
    id: P,
    title: 'Книга',
    characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Гл. 1', order: 0, sections: [sec('s1', 0, text.s1), sec('s2', 1, text.s2)] },
      { id: 'ch2', title: 'Гл. 2', order: 1, sections: [sec('s3', 0, text.s3)] },
    ],
  });
  const sync = () => syncBookToCore(repo, { id: P, ownerId: 'u-owner', title: 'Книга', book: book() });
  await sync();
  const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
  let card = { id: 'c-o', name: 'Олена', biography: 'Сестра зниклого брата.' };
  let calls = 0;
  const mock = new MockJevAdapter();
  const counting = { name: 'mock' as const, evaluate: async (s: any, q: any) => { calls++; return mock.evaluate(s, q); } };
  const fallbackLlm = async () => ({ text: JSON.stringify({ answers: { trajectory: { choice: 'waver' }, motive_conflict: { score: 2 } } }), modelId: 'fake-llm', inputTokens: 5, outputTokens: 5 });
  const engine = (jev: any = counting, config = DEFAULT_LEVEL_CONFIG) =>
    new JevDecisionAdapter({ repo, jev, fallback: new LlmFallbackJevAdapter(fallbackLlm), studio: async () => ({ character: card, all: [card] }), config });
  const e = engine();
  const strat = () => e.decide({ projectId: P, characterId: olena, level: 'strategic', actor: 'user:u-owner' });

  const s1 = await strat();
  const r1 = s1.decision.result as any;
  t('стратегічне: Jev викликано, траєкторія з конфігурації, провідна мета з цілей героя (2), конфлікт мотивів 0–10',
    !s1.reused && calls === 1 && Object.keys(DEFAULT_LEVEL_CONFIG.strategic.primary.options).includes(s1.decision.selectedAction!) &&
    ['goal_1', 'goal_2'].includes(r1.choices?.long_goal) && typeof r1.scores?.motive_conflict === 'number' && r1.level === 'strategic',
    JSON.stringify({ a: s1.decision.selectedAction, c: r1.choices, s: r1.scores }));
  t('підстави: пережите («Пожежа» — героїня присутня) і цілі; примітка без змісту знімка',
    (s1.decision.basis.entityIds ?? []).length === 1 && /значущі події: 1, цілі: 2/.test(s1.decision.basis.note ?? ''), JSON.stringify(s1.decision.basis));
  t('повторно — з журналу, без Jev', (await strat()).reused && calls === 1);

  text.s1 += '\n\n[/emotion:страх @Олена] Олені стало страшно.\n\nЗвичайний новий абзац без тегів.';
  text.s2 = text.s2.replace('Олена бачила.', 'Олена бачила все це.');
  await sync();
  const afterNoise = await strat();
  t('КРИТЕРІЙ Т2.5: емоція, новий абзац і правка тексту без сюжетних тегів — стратегічне НЕ перераховується',
    afterNoise.reused && afterNoise.decision.id === s1.decision.id && calls === 1, `calls=${calls}`);
  text.s3 += '\n\n[/threshold:Втеча @Марко] Марко втік.';
  await sync();
  t('поріг іншого героя в сцені без Олени — теж ні', (await strat()).reused && calls === 1);

  text.s1 += '\n\n[/threshold:Рішення піти @Олена] Олена вирішила піти з дому.';
  await sync();
  const afterEvent = await strat();
  t('КРИТЕРІЙ Т2.5: значуща подія (поріг героїні) — перераховано; старе — «замінено»',
    !afterEvent.reused && calls === 2 && (await repo.getCharacterDecision(P, s1.decision.id))!.status === 'superseded' && afterEvent.decision.status === 'active');
  card = { ...card, biography: 'Сестра зниклого брата; колишня поліцейська.' };
  const afterCanon = await strat();
  t('зміна канону автора (картка героя) — перераховано', !afterCanon.reused && calls === 3);
  const [p1] = (await repo.listParagraphs(P, 's1')).map((x) => x.id);
  const fact = await repo.addFinding({ projectId: P, entityId: olena, kind: PROFILE_FACT, payload: { field: 'fear', statement: 'Олена боїться вогню.', assessment: 'supported' }, sourceParagraphIds: [p1], createdBy: 'ai:AI-2' });
  t('факт профілю лише запропоновано (ще не підтверджено) — ні', (await strat()).reused && calls === 3);
  await repo.setFindingStatus(P, fact.id, 'confirmed', 'user:u-owner');
  const afterFact = await strat();
  t('підтверджений факт профілю — перераховано', !afterFact.reused && calls === 4);
  const ch1 = await e.decide({ projectId: P, characterId: olena, level: 'strategic', actor: 'user:u-owner', asOfChapter: 1 });
  t('інша межа знань (станом на главу 1) — окремий ключ', !ch1.reused && calls === 5 && ch1.decision.cacheKey !== afterFact.decision.cacheKey);
  const noiseKey1 = (await significantState(repo, P, olena, { canon: [], version: 'x' })).key;
  const noiseKey2 = (await significantState(repo, P, olena, { canon: [], version: 'y' })).key;
  t('версія конфігурації — теж частина ключа (інші питання — інша відповідь)', noiseKey1 !== noiseKey2);

  console.log('  — сценічний рівень:');
  calls = 0;
  const sc = (extra: Record<string, unknown> = {}) => e.decide({ projectId: P, characterId: olena, level: 'scene', actor: 'user:u-owner', sceneId: 's2', situation: 'Допит у поліції', participants: ['Марко', 'Слідчий'], ...extra });
  const sc1 = await sc();
  const strNow = (await repo.listCharacterDecisions(P, { characterId: olena, level: 'strategic', cacheKey: afterFact.decision.cacheKey }))[0];
  const scr = sc1.decision.result as any;
  t('сценічне: мотив із конфігурації, страх / довіра / ризик; батько — чинне стратегічне (з кешу)',
    !sc1.reused && calls === 1 && sc1.chain[0].reused && sc1.decision.parentId === strNow.id &&
    Object.keys(DEFAULT_LEVEL_CONFIG.scene.primary.options).includes(sc1.decision.selectedAction!) && ['fear', 'trust', 'risk'].every((k) => typeof scr.scores[k] === 'number'),
    JSON.stringify({ a: sc1.decision.selectedAction, s: scr.scores }));
  t('ті самі умови сцени (учасники в іншому порядку) — з кешу', (await sc({ participants: ['Слідчий', 'Марко'] })).reused && calls === 1);
  const sc2 = await sc({ turnMark: 'Слідчий показав фото' });
  t('«поворот» від режисера — перераховано, попереднє в цій сцені — «замінено»', !sc2.reused && calls === 2 && (await repo.getCharacterDecision(P, sc1.decision.id))!.status === 'superseded');
  const other = await e.decide({ projectId: P, characterId: olena, level: 'scene', actor: 'user:u-owner', sceneId: 's1', situation: 'Вдома' });
  t('інша сцена — окреме рішення; сцену s2 не чіпає', !other.reused && (await repo.getCharacterDecision(P, sc2.decision.id))!.status === 'active');

  console.log('  — тактичний рівень:');
  calls = 0;
  const tac = (extra: Record<string, unknown> = {}) => e.decide({ projectId: P, characterId: olena, level: 'tactical', actor: 'user:u-owner', sceneId: 's2', situation: 'Слідчий: «Де ви були вночі?»', allowedActions: ['answer', 'lie', 'silence', 'deflect'], ...extra });
  const t1 = await tac({ forbiddenActions: ['lie'], checks: ['Олена була вдома тієї ночі'] });
  const tr = t1.decision.result as any;
  t('тактичне: дія лише з дозволених без заборонених, відповідність стилю 0–10, перевірка Noul; батько — чинне сценічне s2',
    !t1.reused && calls === 1 && ['answer', 'silence', 'deflect'].includes(t1.decision.selectedAction!) && typeof tr.scores.style_fit === 'number' &&
    typeof tr.checks?.check_1 === 'number' && t1.decision.parentId === sc2.decision.id && t1.chain.map((c) => c.reused).join() === 'true,true',
    JSON.stringify({ a: t1.decision.selectedAction, s: tr.scores, c: tr.checks, chain: t1.chain }));
  t('тактичне без прогону — щоразу (не кешується)', !(await tac()).reused && calls === 2);
  const sim = { simulationId: 'sim-1', turnIndex: 3 };
  const t3 = await tac(sim);
  t('той самий хід того самого прогону — з кешу (повтор запиту), наступний хід — ні',
    !t3.reused && (await tac(sim)).reused && !(await tac({ ...sim, turnIndex: 4 })).reused && calls === 4);
  let refused = '';
  try { await tac({ allowedActions: ['answer', 'lie'], forbiddenActions: ['lie'] }); } catch (err) { refused = (err as any).code; }
  t('менше двох дозволених дій — відмова (bad_input)', refused === 'bad_input');

  console.log('  — зміна стратегічного тягне сцену:');
  calls = 0;
  text.s2 += '\n\n[/revelation:Правда про брата @Олена] Олена дізналась правду.';
  await sync();
  const sc3 = await sc({ turnMark: 'Слідчий показав фото' });
  t('нова значуща подія → нове стратегічне → сцена з тими самими умовами рахується наново (інший батько)',
    !sc3.reused && sc3.chain[0].reused === false && calls === 2 && sc3.decision.parentId !== sc2.decision.parentId);

  console.log('  — запасний шлях і конфігурація:');
  const down = { name: 'jev' as const, evaluate: async () => { throw new Error('Jev 529: overloaded'); } };
  const fb = await engine(down, { ...DEFAULT_LEVEL_CONFIG, version: 'levels-test-fallback' }).decide({ projectId: P, characterId: olena, level: 'strategic', actor: 'user:u-owner' });
  t('збій Jev — запасний LLM, джерело й причина в журналі (стан цілий: той самий ключ значущих подій)',
    !fb.reused && fb.decision.source === 'llm_fallback' && /529/.test(fb.decision.fallbackReason ?? '') && fb.decision.selectedAction === 'waver');
  const hist = await repo.listCharacterDecisions(P, { characterId: olena, level: 'strategic' });
  t('журнал: стратегічних рішень — кожен перерахунок окремо, чинне — одне', hist.length >= 6 && hist.filter((d) => d.status === 'active').length === 1, `${hist.length}/${hist.filter((d) => d.status === 'active').length}`);
}

await decisionsSuite('memory', new MemoryCoreRepository(), 'jev-m');
await levelsSuite('memory', new MemoryCoreRepository(), 'lvl-m');
const url = process.env.CORE_TEST_DATABASE_URL?.trim();
if (!url) {
  console.log('\nPostgreSQL: пропущено (CORE_TEST_DATABASE_URL не задано) — перевірено на сховищі в пам\'яті');
} else {
  const pool = createCorePool(url);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
    await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
    const { rows } = await pool.query(`SELECT max(version) AS v FROM ${CORE_SCHEMA}.core_schema_migrations`);
    t('схема ядра — не старіша за v15 (журнал рішень героя)', Number(rows[0].v) >= 15, `v${rows[0].v}`);
    await decisionsSuite('postgres', new PgCoreRepository(pool), 'jev-p');
    await levelsSuite('postgres', new PgCoreRepository(pool), 'lvl-p');
    const [d] = (await pool.query(`SELECT project_id, character_id FROM ${CORE_SCHEMA}.character_decisions LIMIT 1`)).rows;
    let refused = false;
    try {
      await pool.query(`INSERT INTO ${CORE_SCHEMA}.character_decisions (project_id, character_id, level, cache_key, snapshot_hash, model_version, source, status, created_by) VALUES ($1, $2, 'tactical', 'k', '${'b'.repeat(32)}', 'm', 'jev', 'active', 'user:x')`, [d.project_id, d.character_id]);
    } catch { refused = true; }
    let refusedAuthor = false;
    try {
      await pool.query(`INSERT INTO ${CORE_SCHEMA}.character_decisions (project_id, character_id, level, cache_key, snapshot_hash, model_version, source, selected_action, created_by) VALUES ($1, $2, 'tactical', 'k', '${'b'.repeat(32)}', 'm', 'author', 'x', 'user:x')`, [d.project_id, d.character_id]);
    } catch { refusedAuthor = true; }
    t('CHECK у базі: чинне без дії — ні; «автор» без того, хто вирішив, — ні', refused && refusedAuthor);
  } catch (err) {
    t('прогін на PostgreSQL без збоїв', false, (err as Error).stack ?? String(err));
  } finally {
    await pool.end();
  }
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

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

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

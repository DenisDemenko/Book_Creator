/**
 * Шар рішень Jev у процесах ШІ (Т5.5 В1, `PLAN_JEV_NODES.md`; ТЗ Graph Studio
 * §6–§10, §16, §17, §20–§22, §36, §39 №9–12): сім вузлів Jev і SUBGRAPH,
 * Jev → запасний LLM, поріг, маршрутизація за впевненістю, друга перевірка,
 * узгодження моделей за політикою, відображення виходу, реєстр напрямків і
 * підпроцес, відгалуження після рішення без нового виклику Jev.
 * Запуск: npm run test:jev-nodes (з CORE_TEST_DATABASE_URL — ще й на
 * PostgreSQL; схема ядра в цій базі видаляється — лише тестова база!).
 */
import { createCorePool } from '../server/core/index.ts';
import { PgCoreRepository } from '../server/core/pgRepository.ts';
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { CORE_SCHEMA, loadMigrations, resolveMigrationsDir, runMigrations } from '../server/core/migrate.ts';
import { bootstrapOntology, resetActiveRegistry } from '../server/core/ontology/lifecycle.ts';
import { createWorkflow, saveDraft, validateVersion, promoteToTest, publishVersion } from '../server/core/workflows/lifecycle.ts';
import { startRun, forkRun, type EngineDeps } from '../server/core/workflows/engine/runner.ts';
import { normalizeAnswer, scoreLevels, consensusPolicy } from '../server/core/workflows/engine/jev.ts';
import { MockJevAdapter, type JevAdapter, type JevQuestion } from '../server/ai/adapters/jev/index.ts';
import { validateWorkflow, nodeOutputs, defaultParams, isExecutableNode, needsReviewBranch, type WorkflowDefinition, type WorkflowNode } from '../src/utils/workflowGraph.ts';
import type { CoreRepository } from '../server/core/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const errOf = async (f: () => Promise<unknown>): Promise<any> => {
  try { await f(); return null; } catch (e) { return e; }
};
const e = (from: string, port: string, to: string) => ({ id: `e-${from}-${port}-${to}`, from, fromPort: port, to });
const node = (id: string, type: string, params: Record<string, unknown> = {}): WorkflowNode => ({ id, type, params: { ...defaultParams(type), ...params } });

// ── Реєстр і перевірка ──────────────────────────────────────────────────────
console.log('\nРеєстр вузлів Jev (№9):');
const JEV = ['JEV_CHOICE', 'JEV_SCORE', 'JEV_NOUL', 'JEV_ROUTER', 'JEV_GATE', 'JEV_EVALUATOR', 'JEV_DECISION_BUNDLE'];
t('усі сім вузлів Jev і SUBGRAPH — виконувані', [...JEV, 'SUBGRAPH'].every(isExecutableNode) && !isExecutableNode('HUMAN_REVIEW'));
t('гілка review — лише коли потрібна (§16, §17)',
  !needsReviewBranch(node('c', 'JEV_CHOICE')) && needsReviewBranch(node('c', 'JEV_CHOICE', { on_low: 'HUMAN_REVIEW' })) && needsReviewBranch(node('c', 'JEV_NOUL', { on_medium: 'SECOND_OPINION' })) && needsReviewBranch(node('c', 'JEV_SCORE', { consensus_from_risk: 'high' })) && !needsReviewBranch(node('c', 'JEV_SCORE', { on_low: 'FALLBACK' })));
t('гілки: вибір — варіанти + fallback (+ review)', nodeOutputs(node('c', 'JEV_CHOICE', { options: ['a', 'b'] })).join() === 'a,b,fallback' && nodeOutputs(node('c', 'JEV_CHOICE', { options: ['a', 'b'], on_low: 'HUMAN_REVIEW' })).join() === 'a,b,fallback,review');
t('маршрутизатор із реєстром — out + fallback, гілки на канві ігноруються', nodeOutputs(node('r', 'JEV_ROUTER', { registry: 'scene_agents', routes: ['x', 'y'] })).join() === 'out,fallback');
const base = (n: WorkflowNode, ports: string[]): WorkflowDefinition => ({ format: 'fusion-workflow/1', id: 'v_check', name: { en: 'V', uk: 'В' }, description: '', nodes: [node('s', 'START'), n, node('e', 'END')], edges: [e('s', 'out', n.id), ...ports.map((p) => e(n.id, p, 'e'))] });
const codes = (d: WorkflowDefinition) => validateWorkflow(d).errors.map((x) => x.code);
t('гілка review обов\'язкова, коли її вимагає дія', codes(base(node('n', 'JEV_NOUL', { question: 'Q?', on_low: 'HUMAN_REVIEW' }), ['true', 'false', 'fallback'])).includes('unconnected_branch') && validateWorkflow(base(node('n', 'JEV_NOUL', { question: 'Q?', on_low: 'HUMAN_REVIEW' }), ['true', 'false', 'fallback', 'review'])).ok);
t('середня впевненість вища за високу — помилка', codes(base(node('n', 'JEV_NOUL', { question: 'Q?', confidence_medium: 0.95, confidence_high: 0.9 }), ['true', 'false', 'fallback'])).includes('bad_confidence_levels'));
t('маршрутизатор без реєстру й з однією гілкою — помилка; з реєстром — гаразд', codes(base(node('r', 'JEV_ROUTER', { question: 'Q?', routes: ['x'] }), ['x', 'fallback'])).includes('bad_param') && validateWorkflow(base(node('r', 'JEV_ROUTER', { question: 'Q?', registry: 'agents' }), ['out', 'fallback'])).ok);
t('пакет: питання перевіряються (вид, варіанти, рівні, повтор id)',
  codes(base(node('b', 'JEV_DECISION_BUNDLE', { question: 'Q', questions: [{ id: 'a', kind: 'choice', question: 'Що?', options: ['x'] }] }), ['out', 'fallback'])).includes('bad_bundle')
  && codes(base(node('b', 'JEV_DECISION_BUNDLE', { question: 'Q', questions: [{ id: 'a', kind: 'noul', question: 'Чи?' }, { id: 'a', kind: 'noul', question: 'Чи?' }] }), ['out', 'fallback'])).includes('bad_bundle')
  && validateWorkflow(base(node('b', 'JEV_DECISION_BUNDLE', { question: 'Q', questions: [{ id: 'act', kind: 'choice', question: 'Що?', options: ['x', 'y'] }, { id: 'danger', kind: 'score', question: 'Небезпека', levels: ['низька', 'висока'] }, { id: 'safe', kind: 'noul', question: 'Чи в безпеці?' }] }), ['out', 'fallback'])).ok);
t('шкала: 2–10 рівнів, «до» більше за «від»', codes(base(node('s2', 'JEV_SCORE', { question: 'Q', levels: ['one'] }), ['out', 'fallback'])).includes('bad_param') && codes(base(node('s2', 'JEV_SCORE', { question: 'Q', scale_min: 5, scale_max: 5 }), ['out', 'fallback'])).includes('bad_param'));

console.log('\nНормалізація відповіді:');
const qc: JevQuestion = { id: 'c', kind: 'choice', instructions: 'Q', options: { a: null, b: null } };
const qs: JevQuestion = { id: 's', kind: 'score', instructions: 'Q', levels: ['0', '1', '2', '3', '4'] };
const qn: JevQuestion = { id: 'n', kind: 'noul', instructions: 'Q' };
t('choice: недозволений варіант → найімовірніший дозволений, з позначкою', (() => { const a = normalizeAnswer(qc, { choice: 'zzz', probabilities: { a: 0.3, b: 0.6 }, confidence: 0.6 }, 'jev')!; return a.selected === 'b' && a.corrected === true && a.confidence === 0.6; })());
t('score: позиція → значення шкали вузла', normalizeAnswer(qs, { score: 3, confidence: 0.7 }, 'jev', { min: 0, max: 100 })!.value === 75);
t('noul: впевненість запасного LLM — невідома (null), у Jev без поля — з імовірності', normalizeAnswer(qn, { probability: 0.9 }, 'llm_fallback')!.confidence === null && normalizeAnswer(qn, { probability: 0.9 }, 'jev')!.confidence === 0.8);
t('шкала без рівнів — 6 рівнів між «від» і «до»', scoreLevels(node('s', 'JEV_SCORE', { scale_min: 0, scale_max: 5 })).levels.join() === '0,1,2,3,4,5');
t('узгодження за політикою: вимкнено / важливість / бюджет',
  !consensusPolicy(node('x', 'JEV_NOUL'), { input: {}, vars: {}, steps: 0, cost: 0 }).on
  && consensusPolicy(node('x', 'JEV_NOUL', { importance: 'critical', consensus_from_importance: 'high' }), { input: {}, vars: {}, steps: 0, cost: 0 }).on
  && !consensusPolicy(node('x', 'JEV_NOUL', { importance: 'medium', consensus_from_importance: 'high' }), { input: {}, vars: {}, steps: 0, cost: 0 }).on
  && /бюджет/.test(consensusPolicy(node('x', 'JEV_NOUL', { risk: 'high', consensus_from_risk: 'high', consensus_budget: 0.01 }), { input: {}, vars: {}, steps: 0, cost: 0.02 }).reason));

// ── Виконання ───────────────────────────────────────────────────────────────

/** Підставний Jev: відповіді — зі сценарію за id питання. */
type Script = (q: JevQuestion, state: Record<string, unknown>) => any;
const jevCalls: { questions: string[]; state: Record<string, unknown> }[] = [];
let jevScript: Script | null = null;
let jevDown = false;
const fakeJev: JevAdapter = {
  name: 'jev',
  async evaluate() { throw new Error('not used'); },
  async askState(state, questions) {
    jevCalls.push({ questions: questions.map((q) => q.id), state });
    if (jevDown) throw new Error('Jev 529: перевантажено');
    return { answers: Object.fromEntries(questions.map((q) => [q.id, jevScript!(q, state)])), model: 'jev-1.13.0', usage: { input_tokens: 1000, output_tokens: 0 }, latency_ms: 5 };
  },
};
/** Підставний LLM запасного шляху: відповідь за моделлю. */
const llmCalls: { model: string; module: string; ids: string[] }[] = [];
let llmScript: (model: string, id: string, kind: string) => any = () => null;
let llmDown = false;
const deps = (repo: CoreRepository, jev: JevAdapter | null = fakeJev): EngineDeps => ({
  repo,
  services: {
    async generate(input) {
      const ids = [...input.user.matchAll(/Питання "([^"]+)" \((вибір|оцінка|так \/ ні)\)/g)].map((m) => [m[1], m[2]]);
      llmCalls.push({ model: input.modelId ?? '', module: input.module, ids: ids.map((x) => x[0]) });
      if (llmDown) throw new Error('LLM недоступна');
      const answers = Object.fromEntries(ids.map(([id, kind]) => [id, llmScript(input.modelId ?? '', id, kind)]));
      return { text: JSON.stringify({ answers }), modelId: input.modelId ?? 'm', engine: 'fake', inputTokens: 200, outputTokens: 20, costUsd: 0.001 };
    },
    resolveModel: async (module) => (module === 'coreAi1Classify' ? 'model-ai1' : 'model-ai2'),
    sleep: async () => {},
    jev: async () => jev,
  },
});

async function publish(repo: CoreRepository, def: WorkflowDefinition) {
  const actor = 'user:u-admin' as const;
  const existing = await repo.getWorkflow(def.id);
  const draftId = existing
    ? (await (await import('../server/core/workflows/lifecycle.ts')).ensureDraft(repo, def.id, actor)).id
    : (await createWorkflow(repo, { id: def.id, name: def.name, actor })).draft.id;
  await saveDraft(repo, { workflowId: def.id, versionId: draftId, definition: def, actor });
  const v = await validateVersion(repo, def.id, draftId, actor);
  if (!v.validation.ok) throw new Error(`invalid ${def.id}: ${JSON.stringify(v.validation.errors)}`);
  await promoteToTest(repo, def.id, draftId, actor);
  return publishVersion(repo, def.id, draftId, actor);
}

const wf = (id: string, nodes: WorkflowNode[], edges: ReturnType<typeof e>[]): WorkflowDefinition => ({ format: 'fusion-workflow/1', id, name: { en: id, uk: id }, description: '', nodes, edges });
/** Процес: START → вузол → END за кожною гілкою (свій END на гілку). */
function single(id: string, n: WorkflowNode): WorkflowDefinition {
  const ports = nodeOutputs(n);
  return wf(id, [node('start', 'START'), n, ...ports.map((p) => node(`end_${p}`, 'END'))], [e('start', 'out', n.id), ...ports.map((p) => e(n.id, p, `end_${p}`))]);
}
const actor = 'user:u-admin' as const;

async function suite(name: string, repo: CoreRepository) {
  resetActiveRegistry();
  await bootstrapOntology(repo);
  const d = deps(repo);
  const run = async (id: string, input: Record<string, unknown> = {}) => startRun(d, { workflowId: id, input, trigger: 'manual', actor, projectId: 'book-1' });
  const stepOf = async (runId: string, nodeId: string) => (await repo.listWorkflowSteps(runId)).find((s) => s.nodeId === nodeId)!;

  console.log(`\n${name} — Jev-вибір і поріг (№9, №11):`);
  await publish(repo, single('choice_flow', node('pick', 'JEV_CHOICE', { question: 'Яка функція сцени «{{input.title}}»?', options: ['EVENT', 'DECISION', 'EMOTION'], threshold: 0.5, input_state: ['input.text'], output_mapping: { scene_kind: 'selected' } })));
  jevScript = (q) => ({ choice: 'DECISION', probabilities: { EVENT: 0.1, DECISION: 0.8, EMOTION: 0.1 }, confidence: 0.8 });
  jevCalls.length = 0;
  let r = await run('choice_flow', { title: 'Розмова', text: 'Марк вирішує.' });
  let st = await stepOf(r.run.id, 'pick');
  t('гілка — обраний варіант', r.run.status === 'succeeded' && st.branch === 'DECISION' && (await stepOf(r.run.id, 'end_DECISION')) !== undefined);
  t('питання з {{змінними}}, вхідний стан — лише вказані ключі', (st.details as any).question === 'Яка функція сцени «Розмова»?' && JSON.stringify(jevCalls[0].state) === JSON.stringify({ 'input.text': 'Марк вирішує.' }));
  t('у кроці: розподіл, впевненість, джерело, модель, вартість Jev за токенами', (st.details as any).answers.choice.distribution.DECISION === 0.8 && st.confidence === 0.8 && (st.details as any).source === 'jev' && st.model === 'jev-1.13.0' && st.costUsd === 0.000042);
  t('відображення виходу (§36) і vars.<вузол>', r.state!.vars.scene_kind === 'DECISION' && (r.state!.vars.pick as any).selected === 'DECISION');
  jevScript = () => ({ choice: 'EVENT', probabilities: { EVENT: 0.4, DECISION: 0.3, EMOTION: 0.3 }, confidence: 0.4 });
  r = await run('choice_flow', { title: 'Т', text: 'x' });
  st = await stepOf(r.run.id, 'pick');
  t('впевненість нижча за поріг — резервний маршрут', st.branch === 'fallback' && /поріг/.test(st.decision ?? ''));

  console.log(`\n${name} — Jev недоступний → запасний LLM (рішення §2 п.1):`);
  jevDown = true;
  llmScript = (_m, _id, kind) => (kind === 'вибір' ? { choice: 'EMOTION' } : null);
  llmCalls.length = 0;
  r = await run('choice_flow', { title: 'Т', text: 'x' });
  st = await stepOf(r.run.id, 'pick');
  t('рішення від запасного LLM (модуль AI-2), з причиною', st.branch === 'EMOTION' && (st.details as any).source === 'llm_fallback' && /529/.test((st.details as any).fallbackReason) && llmCalls[0]?.module === 'coreAi2Analysis' && llmCalls[0].model === 'model-ai2');
  t('невідома впевненість LLM — поріг не застосовується', st.confidence === null);
  llmDown = true;
  r = await run('choice_flow', { title: 'Т', text: 'x' });
  st = await stepOf(r.run.id, 'pick');
  t('ніхто не відповів — гілка fallback, запуск не падає', r.run.status === 'succeeded' && st.branch === 'fallback' && st.warnings.length > 0);
  jevDown = false;
  llmDown = false;
  const noKey = deps(repo, null);
  llmCalls.length = 0;
  r = await startRun(noKey, { workflowId: 'choice_flow', input: { title: 'Т', text: 'x' }, trigger: 'manual', actor });
  t('без ключа Jev — одразу запасний LLM', (await stepOf(r.run.id, 'pick')).branch === 'EMOTION' && /немає ключа/.test(((await stepOf(r.run.id, 'pick')).details as any).fallbackReason));

  console.log(`\n${name} — оцінка, істинність, шлюз, оцінювач, пакет:`);
  await publish(repo, single('score_flow', node('tension', 'JEV_SCORE', { question: 'Наративна напруга?', levels: ['відсутня', 'слабка', 'помірна', 'сильна', 'дуже сильна', 'кульмінаційна'], scale_min: 0, scale_max: 5 })));
  jevScript = () => ({ score: 3, probabilities: { 3: 0.7 }, confidence: 0.7 });
  r = await run('score_flow');
  t('JEV SCORE: рівень і значення шкали (§9)', (r.state!.vars.tension as any).value === 3 && (r.state!.vars.tension as any).level === 'сильна');
  await publish(repo, single('noul_flow', node('is_new', 'JEV_NOUL', { question: 'Це новий персонаж?', threshold: 0.85 })));
  jevScript = () => ({ probability: 0.9, confidence: 0.9 });
  r = await run('noul_flow');
  t('JEV NOUL: 0,9 ≥ 0,85 → true', (await stepOf(r.run.id, 'is_new')).branch === 'true');
  jevScript = () => ({ probability: 0.7, confidence: 0.9 });
  r = await run('noul_flow');
  t('JEV NOUL: 0,7 < 0,85 → false (поріг — параметр вузла, §8.2)', (await stepOf(r.run.id, 'is_new')).branch === 'false');
  await publish(repo, single('gate_flow', node('canon', 'JEV_GATE', { question: 'Це суперечить канону?', threshold: 0.85, pass_when: 'false' })));
  jevScript = () => ({ probability: 0.95, confidence: 0.9 });
  r = await run('gate_flow');
  t('JEV GATE: «суперечить» → зупинено (§20)', (await stepOf(r.run.id, 'canon')).branch === 'block');
  jevScript = () => ({ probability: 0.1, confidence: 0.9 });
  r = await run('gate_flow');
  t('JEV GATE: «не суперечить» → пропущено', (await stepOf(r.run.id, 'canon')).branch === 'pass');
  await publish(repo, single('eval_flow', node('critic', 'JEV_EVALUATOR', { question: 'Оціни відповідь героя.', criteria: ['Узгодженість', 'Відповідність персонажу'] })));
  jevScript = (q) => ({ score: q.id === 'c1' ? 4 : 2, confidence: 0.8 });
  r = await run('eval_flow');
  const ev = r.state!.vars.critic as any;
  t('JEV EVALUATOR: 0–10 за критерієм, середня, «не факт канону» (§21)', ev.criteria['Узгодженість'].value === 10 && ev.criteria['Відповідність персонажу'].value === 5 && ev.overall === 7.5 && ev.canonical === false && r.state!.result === undefined);
  await publish(repo, single('bundle_flow', node('mark', 'JEV_DECISION_BUNDLE', { question: 'Марк у пастці', questions: [{ id: 'act', kind: 'choice', question: 'Що зробить Марк?', options: ['втекти', 'битись'] }, { id: 'danger', kind: 'score', question: 'Сприйнята небезпека', levels: ['низька', 'середня', 'висока'] }, { id: 'sofia', kind: 'noul', question: 'Чи в небезпеці Софія?' }] })));
  jevScript = (q) => (q.kind === 'choice' ? { choice: 'битись', probabilities: { втекти: 0.3, битись: 0.7 }, confidence: 0.7 } : q.kind === 'score' ? { score: 2, confidence: 0.8 } : { probability: 0.6, confidence: 0.75 });
  jevCalls.length = 0;
  r = await run('bundle_flow');
  const bd = (r.state!.vars.mark as any).answers;
  t('JEV DECISION BUNDLE: три незалежні питання одним запитом (§22)', jevCalls.length === 1 && jevCalls[0].questions.join() === 'act,danger,sofia' && bd.act.selected === 'битись' && bd.danger.value === 10 && bd.sofia.probability === 0.6);
  t('впевненість пакета — найменша з відповідей', (await stepOf(r.run.id, 'mark')).confidence === 0.7);

  console.log(`\n${name} — маршрутизація за впевненістю (§16, №12):`);
  const routed = (extra: Record<string, unknown>) => single('conf_flow', node('pick', 'JEV_CHOICE', { question: 'Що?', options: ['a', 'b'], ...extra }));
  await publish(repo, routed({ on_low: 'HUMAN_REVIEW', on_medium: 'SECOND_OPINION', on_high: 'AUTO_ROUTE', confidence_high: 0.9, confidence_medium: 0.6 }));
  jevScript = () => ({ choice: 'a', probabilities: { a: 0.95, b: 0.05 }, confidence: 0.95 });
  llmCalls.length = 0;
  r = await run('conf_flow');
  t('висока → AUTO_ROUTE, без другої моделі', (await stepOf(r.run.id, 'pick')).branch === 'a' && llmCalls.length === 0);
  jevScript = () => ({ choice: 'a', probabilities: { a: 0.7, b: 0.3 }, confidence: 0.7 });
  llmScript = () => ({ choice: 'a' });
  r = await run('conf_flow');
  st = await stepOf(r.run.id, 'pick');
  t('середня → друга перевірка збіглась → далі', st.branch === 'a' && (st.details as any).secondOpinion.agree === true && llmCalls.length === 1);
  llmScript = () => ({ choice: 'b' });
  r = await run('conf_flow');
  t('середня → друга перевірка не збіглась → review', (await stepOf(r.run.id, 'pick')).branch === 'review');
  jevScript = () => ({ choice: 'a', probabilities: { a: 0.5, b: 0.5 }, confidence: 0.5 });
  r = await run('conf_flow');
  t('низька → перевірка людиною (гілка review)', (await stepOf(r.run.id, 'pick')).branch === 'review' && ((await stepOf(r.run.id, 'pick')).details as any).routing.tier === 'low');
  await publish(repo, routed({ on_low: 'FALLBACK', confidence_medium: 0.6 }));
  r = await run('conf_flow');
  t('низька → FALLBACK; пороги — з версії, без зміни коду', (await stepOf(r.run.id, 'pick')).branch === 'fallback');

  console.log(`\n${name} — узгодження кількох моделей за політикою (§17):`);
  await publish(repo, single('cons_flow', node('risky', 'JEV_NOUL', { question: 'Це розкриває загадку?', threshold: 0.5, importance: 'critical', consensus_from_importance: 'high', consensus_budget: 1, consensus_model_b: 'model-b' })));
  jevScript = () => ({ probability: 0.8, confidence: 0.9 });
  llmScript = () => ({ probability: 0.7 });
  llmCalls.length = 0;
  r = await run('cons_flow');
  st = await stepOf(r.run.id, 'risky');
  t('критичне рішення: Jev + модель A (AI-2) + модель B — згода → далі', st.branch === 'true' && llmCalls.map((c) => c.model).join() === 'model-ai2,model-b' && (st.details as any).consensus.agree === true);
  t('вартість кроку — Jev і обидві моделі', Math.abs(st.costUsd - (0.000042 + 0.002)) < 1e-9);
  llmScript = (m) => ({ probability: m === 'model-b' ? 0.2 : 0.8 });
  r = await run('cons_flow');
  t('розбіжність моделей → review, у кроці — відповіді кожної', (await stepOf(r.run.id, 'risky')).branch === 'review' && ((await stepOf(r.run.id, 'risky')).details as any).consensus.b.answers.noul === 0.2);
  await publish(repo, single('cons_flow', node('risky', 'JEV_NOUL', { question: 'Це розкриває загадку?', threshold: 0.5, importance: 'low', consensus_from_importance: 'high' })));
  llmCalls.length = 0;
  r = await run('cons_flow');
  t('важливість нижча за політику — узгодження не запускається', llmCalls.length === 0 && (await stepOf(r.run.id, 'risky')).branch === 'true');

  console.log(`\n${name} — маршрутизатор і реєстр напрямків (№10):`);
  await publish(repo, single('route_flow', node('route', 'JEV_ROUTER', { question: 'Куди?', routes: ['character', 'scene'] })));
  jevScript = () => ({ choice: 'scene', probabilities: { character: 0.2, scene: 0.8 }, confidence: 0.8 });
  r = await run('route_flow');
  t('гілки на канві — виконання йде гілкою обраного', (await stepOf(r.run.id, 'route')).branch === 'scene');
  // Напрямки: два агенти-процеси.
  const agent = (id: string) => wf(id, [node('start', 'START'), node('decide', 'JEV_NOUL', { question: `${id}: чи є що сказати?` }), node('end', 'END')], [e('start', 'out', 'decide'), e('decide', 'true', 'end'), e('decide', 'false', 'end'), e('decide', 'fallback', 'end')]);
  await publish(repo, agent('character_agent'));
  await publish(repo, agent('scene_agent'));
  await repo.saveWorkflowDestination({ registry: 'story_agents', option: 'character', label: { en: 'Character agent', uk: 'Агент персонажа' }, description: 'Питання про героя', workflowId: 'character_agent', enabled: true, updatedBy: actor });
  await repo.saveWorkflowDestination({ registry: 'story_agents', option: 'scene', label: { en: 'Scene agent', uk: 'Агент сцени' }, description: 'Питання про сцену', workflowId: 'scene_agent', enabled: true, updatedBy: actor });
  await publish(repo, single('registry_flow', node('route', 'JEV_ROUTER', { question: 'Хто відповість на «{{input.q}}»?', registry: 'story_agents' })));
  jevScript = (q) => (q.kind === 'choice' ? { choice: 'character', probabilities: { character: 0.9, scene: 0.1 }, confidence: 0.9 } : { probability: 0.8, confidence: 0.9 });
  jevCalls.length = 0;
  r = await run('registry_flow', { q: 'хто Марк?' });
  st = await stepOf(r.run.id, 'route');
  const sub = (r.state!.vars.route as any).subgraph;
  const child = sub ? await repo.getWorkflowRun(sub.runId) : null;
  t('варіанти — напрямки реєстру з описами для Jev', JSON.stringify(Object.keys((st.details as any).questions[0].options).sort()) === '["character","scene"]' && (st.details as any).questions[0].options.character === 'Питання про героя');
  t('обраний процес виконано підпроцесом: режим subgraph, батько, той самий проєкт', r.run.status === 'succeeded' && st.branch === 'out' && child?.workflowId === 'character_agent' && child.mode === 'subgraph' && child.parentRunId === r.run.id && child.projectId === 'book-1' && child.status === 'succeeded');
  t('вартість підпроцесу — у кроці маршрутизатора', Math.abs(st.costUsd - 2 * 0.000042) < 1e-9);
  await publish(repo, agent('mystery_agent'));
  await repo.saveWorkflowDestination({ registry: 'story_agents', option: 'mystery', label: { en: 'Mystery agent', uk: 'Агент загадки' }, description: 'Таємниці й підказки', workflowId: 'mystery_agent', enabled: true, updatedBy: actor });
  await repo.saveWorkflowDestination({ registry: 'story_agents', option: 'scene', label: { en: 'Scene agent', uk: 'Агент сцени' }, description: 'Питання про сцену', workflowId: 'scene_agent', enabled: false, updatedBy: actor });
  jevScript = (q) => (q.kind === 'choice' ? { choice: 'mystery', probabilities: { character: 0.1, mystery: 0.9 }, confidence: 0.9 } : { probability: 0.8, confidence: 0.9 });
  r = await run('registry_flow', { q: 'хто вбивця?' });
  st = await stepOf(r.run.id, 'route');
  t('новий напрямок — без зміни маршрутизатора; вимкнений — не пропонується', JSON.stringify(Object.keys((st.details as any).questions[0].options).sort()) === '["character","mystery"]' && (r.state!.vars.route as any).subgraph.workflowId === 'mystery_agent' && r.run.versionId === (await repo.listWorkflowRuns({ workflowId: 'registry_flow', limit: 5 }))[1].versionId);
  await publish(repo, single('empty_flow', node('route', 'JEV_ROUTER', { question: 'Куди?', registry: 'nobody_here' })));
  r = await run('empty_flow');
  t('порожній реєстр — резервний маршрут', (await stepOf(r.run.id, 'route')).branch === 'fallback');

  console.log(`\n${name} — SUBGRAPH:`);
  await publish(repo, wf('sub_flow', [node('start', 'START'), node('call', 'SUBGRAPH', { workflow_id: 'scene_agent' }), node('end', 'END')], [e('start', 'out', 'call'), e('call', 'out', 'end')]));
  r = await run('sub_flow', { q: 'сцена' });
  t('підпроцес — дочірній запуск, результат у vars', r.run.status === 'succeeded' && (r.state!.vars.call as any).workflowId === 'scene_agent' && (r.state!.vars.call as any).status === 'succeeded');
  const caller = (id: string, target: string) => wf(id, [node('start', 'START'), node('call', 'SUBGRAPH', { workflow_id: target }), node('end', 'END')], [e('start', 'out', 'call'), e('call', 'out', 'end')]);
  await publish(repo, caller('loop_b', 'scene_agent'));
  await publish(repo, caller('loop_a', 'loop_b'));
  await publish(repo, caller('loop_b', 'loop_a'));
  r = await run('loop_a');
  t('цикл підпроцесів — зрозуміла помилка, не нескінченність', r.run.status === 'failed' && /цикл/.test(r.run.error ?? ''));
  await publish(repo, caller('deep_4', 'scene_agent'));
  await publish(repo, caller('deep_3', 'deep_4'));
  await publish(repo, caller('deep_2', 'deep_3'));
  await publish(repo, caller('deep_1', 'deep_2'));
  r = await run('deep_2');
  t('три рівні вкладення — гаразд', r.run.status === 'succeeded', r.run.error ?? '');
  r = await run('deep_1');
  t('глибше за три рівні — зрозуміла помилка', r.run.status === 'failed' && /глибше/.test(r.run.error ?? ''));

  console.log(`\n${name} — відгалуження після рішення (§31):`);
  jevScript = () => ({ choice: 'DECISION', probabilities: { DECISION: 0.9 }, confidence: 0.9 });
  r = await run('choice_flow', { title: 'Т', text: 'x' });
  jevCalls.length = 0;
  const fk = await forkRun(d, r.run.id, 2, actor);
  t('FORK після вузла Jev — без нового виклику Jev, рішення зі стану', fk.run.status === 'succeeded' && jevCalls.length === 0 && (fk.state!.vars.pick as any).selected === 'DECISION');

  console.log(`\n${name} — реєстр напрямків у сховищі:`);
  const list = await repo.listWorkflowDestinations({ registry: 'story_agents' });
  t('список за реєстром; лише увімкнені', list.length === 3 && (await repo.listWorkflowDestinations({ registry: 'story_agents', enabledOnly: true })).map((x) => x.option).join() === 'character,mystery');
  t('напрямок до неіснуючого процесу — not_found', (await errOf(() => repo.saveWorkflowDestination({ registry: 'story_agents', option: 'ghost', label: { en: 'G', uk: 'Г' }, description: '', workflowId: 'ghost_flow', enabled: true, updatedBy: actor })))?.code === 'not_found');
  t('правила: id, назви en/uk, опис ≤255, без ШІ-автора', (await errOf(() => repo.saveWorkflowDestination({ registry: 'Bad Name', option: 'x', label: { en: 'a', uk: 'б' }, description: '', workflowId: 'scene_agent', enabled: true, updatedBy: actor })))?.code === 'bad_input'
    && (await errOf(() => repo.saveWorkflowDestination({ registry: 'r', option: 'x', label: { en: '', uk: 'б' }, description: '', workflowId: 'scene_agent', enabled: true, updatedBy: actor })))?.code === 'bad_input'
    && (await errOf(() => repo.saveWorkflowDestination({ registry: 'r', option: 'x', label: { en: 'a', uk: 'б' }, description: 'x'.repeat(256), workflowId: 'scene_agent', enabled: true, updatedBy: actor })))?.code === 'bad_input'
    && (await errOf(() => repo.saveWorkflowDestination({ registry: 'r', option: 'x', label: { en: 'a', uk: 'б' }, description: '', workflowId: 'scene_agent', enabled: true, updatedBy: 'ai:x' as any })))?.code === 'bad_actor');
  t('видалення', (await repo.deleteWorkflowDestination('story_agents', 'scene')) === true && (await repo.deleteWorkflowDestination('story_agents', 'scene')) === false);
  t('підпроцес без батька — відмова правил', (await errOf(() => repo.addWorkflowRun({ ...((({ id, status, createdAt, updatedAt, finishedAt, ...x }) => x)(r.run as any)), mode: 'subgraph', parentRunId: null, trigger: 'subgraph' } as any)))?.code === 'bad_input');
}

// Підставний Jev із реального адаптера — детермінований askState.
{
  console.log('\nПідставний Jev над станом:');
  const m = new MockJevAdapter();
  const a = await m.askState({ x: 1 }, [qc, qn]);
  const b = await m.askState({ x: 1 }, [qc, qn]);
  const c = await m.askState({ x: 2 }, [qc, qn]);
  t('той самий стан — та сама відповідь; інший — інша', JSON.stringify(a.answers) === JSON.stringify(b.answers) && JSON.stringify(a.answers) !== JSON.stringify(c.answers) && ['a', 'b'].includes(a.answers.c.choice));
}

await suite('Пам\'ять', new MemoryCoreRepository());

const url = process.env.CORE_TEST_DATABASE_URL;
if (url) {
  const pool = createCorePool(url);
  await pool.query(`DROP SCHEMA IF EXISTS ${CORE_SCHEMA} CASCADE`);
  await runMigrations(pool, loadMigrations(resolveMigrationsDir()));
  await suite('PostgreSQL', new PgCoreRepository(pool, true));
  await pool.end();
} else {
  console.log('\n(PostgreSQL пропущено: немає CORE_TEST_DATABASE_URL)');
}

resetActiveRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

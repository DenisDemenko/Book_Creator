/**
 * Граф процесу ШІ — формат `fusion-workflow/1`, реєстр вузлів і перевірка
 * (Т5.2 В1, `PLAN_GRAPH_STUDIO.md`; ТЗ Graph Studio §5, §35–36, №6, 7, 28).
 * Запуск: npm run test:workflow-graph
 */
import {
  NODE_TYPES,
  PALETTE_GROUPS,
  defaultParams,
  diffWorkflows,
  emptyWorkflow,
  nodeOutputs,
  nodeTypeById,
  samplePipeline,
  sanitizeLayout,
  validateWorkflow,
  workflowSemanticJson,
  type WorkflowDefinition,
} from '../src/utils/workflowGraph.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const codes = (d: WorkflowDefinition) => validateWorkflow(d).errors.map((e) => e.code);

console.log('\nПалітра й реєстр вузлів:');
t('вісім груп палітри §35 у порядку ТЗ', PALETTE_GROUPS.map((g) => g.code).join() === 'CORE,STORY CORE,AI,JEV,CONTROL,VALIDATION,HUMAN,OUTPUT');
const ids = NODE_TYPES.map((n) => n.id);
const s52 = ['START', 'LLM', 'AGENT', 'PROMPT', 'CONTEXT', 'QUERY', 'TOOL', 'CONDITION', 'MEMORY', 'VALIDATOR', 'HUMAN_REVIEW', 'PROPOSAL', 'CANON_WRITE', 'SUBGRAPH', 'END'];
t('усі 15 типів §5.2', s52.every((id) => ids.includes(id)), s52.filter((id) => !ids.includes(id)).join());
const s36 = ['JEV_CHOICE', 'JEV_SCORE', 'JEV_NOUL', 'JEV_ROUTER', 'JEV_GATE', 'JEV_EVALUATOR', 'JEV_DECISION_BUNDLE'];
t('усі 7 вузлів Jev §36 — у групі JEV', s36.every((id) => nodeTypeById(id)?.group === 'jev'));
t('кожен Jev-вузол має питання, вхідний стан, поріг, відображення виходу, журналювання й резервний маршрут (§36)',
  s36.every((id) => { const tdef = nodeTypeById(id)!; return ['question', 'input_state', 'threshold', 'output_mapping', 'logging'].every((p) => tdef.params.some((x) => x.id === p)) && tdef.outputs.includes('fallback'); }));
t('LLM має параметри §5.3', ['model_provider', 'model', 'temperature', 'max_tokens', 'timeout', 'retry_count', 'system_prompt', 'context_policy', 'output_schema', 'entity_scope', 'relation_scope', 'confidence_policy', 'cost_limit'].every((p) => nodeTypeById('LLM')!.params.some((x) => x.id === p)));
t('кожен тип — з назвою en/uk і в групі палітри', NODE_TYPES.every((n) => n.name.en && n.name.uk && PALETTE_GROUPS.some((g) => g.id === n.group)));
t('у кожній групі палітри є вузли', PALETTE_GROUPS.every((g) => NODE_TYPES.some((n) => n.group === g.id)));
t('гілки Jev-вибору — з варіантів + fallback', nodeOutputs({ id: 'c', type: 'JEV_CHOICE', params: { options: ['втекти', 'битись'] } }).join() === 'втекти,битись,fallback');
t('параметри за замовчуванням — у межах', validateWorkflow({ ...emptyWorkflow('wf_a', { en: 'A', uk: 'А' }), nodes: [{ id: 'start', type: 'START', params: {} }, { id: 'l', type: 'LLM', params: defaultParams('LLM') }, { id: 'end', type: 'END', params: {} }], edges: [{ id: 'e1', from: 'start', fromPort: 'out', to: 'l' }, { id: 'e2', from: 'l', fromPort: 'out', to: 'end' }] }).ok);

console.log('\nПеревірка:');
const sample = samplePipeline();
const v = validateWorkflow(sample);
t('зразок §5.1 (рукопис → … → запис у канон) — валідний', v.ok, v.errors.map((e) => e.message).join(' | '));
t('порожній процес START → END — валідний', validateWorkflow(emptyWorkflow('wf_empty', { en: 'Empty', uk: 'Порожній' })).ok);
{
  const d = clone(sample); d.nodes = d.nodes.filter((n) => n.type !== 'START'); d.edges = d.edges.filter((e) => e.from !== 'start');
  t('без START — помилка', codes(d).includes('start_count'));
}
{
  const d = clone(sample); d.nodes.push({ id: 'start2', type: 'START', params: {} }); d.edges.push({ id: 'e-s2', from: 'start2', fromPort: 'out', to: 'end' });
  t('два START — помилка', codes(d).includes('start_count'));
}
{
  const d = clone(sample); d.nodes = d.nodes.filter((n) => n.type !== 'END'); d.edges = d.edges.filter((e) => e.to !== 'end');
  t('без END — помилка', codes(d).includes('no_end'));
}
{
  const d = clone(sample); d.edges.push({ id: 'e-bad', from: 'extract', fromPort: 'out', to: 'nowhere' });
  t('ребро в неіснуючий вузол — помилка', codes(d).includes('dangling_edge'));
}
{
  const d = clone(sample); d.nodes.find((n) => n.id === 'extract')!.params.temperature = 5;
  const c = validateWorkflow(d).errors.find((e) => e.code === 'bad_param');
  t('температура 5 — поза межами, з прив\'язкою до вузла', !!c && c.nodeId === 'extract' && /не більше 2/.test(c.message), c?.message);
}
{
  const d = clone(sample); delete d.nodes.find((n) => n.id === 'decide')!.params.question;
  t('Jev без питання — помилка', codes(d).includes('bad_param'));
}
{
  const d = clone(sample); d.edges = d.edges.filter((e) => !(e.from === 'decide' && e.fromPort === 'fallback'));
  t('Jev без резервного маршруту — помилка', codes(d).includes('missing_fallback'));
}
{
  const d = clone(sample); d.edges = d.edges.filter((e) => !(e.from === 'classify' && e.fromPort === 'invalid'));
  t('гілка, що нікуди не веде, — помилка', codes(d).includes('unconnected_branch'));
}
{
  const d = clone(sample); d.edges.push({ id: 'e-fan', from: 'extract', fromPort: 'out', to: 'proposal' });
  t('одна гілка в два вузли без PARALLEL — помилка', codes(d).includes('fan_out'));
}
{
  const d = clone(sample); d.nodes.push({ id: 'island', type: 'PROMPT', params: { template: 'x' } }); d.edges.push({ id: 'e-isl', from: 'island', fromPort: 'out', to: 'end' });
  t('недосяжний вузол — помилка', codes(d).includes('unreachable'));
}
{
  const d = clone(sample); d.edges.push({ id: 'e-cycle', from: 'canon', fromPort: 'out', to: 'context' }); d.edges = d.edges.filter((e) => !(e.from === 'canon' && e.to === 'end'));
  const c = codes(d);
  t('цикл без LOOP — помилка', c.includes('cycle_without_loop'));
}
{
  const d = clone(sample);
  d.edges = d.edges.filter((e) => !(e.from === 'proposal'));
  d.edges.push({ id: 'e-p-c', from: 'proposal', fromPort: 'out', to: 'canon' });
  t('запис у канон в обхід перевірки людиною — помилка (§24)', codes(d).includes('canon_without_review'));
}
{
  const loop: WorkflowDefinition = {
    ...emptyWorkflow('wf_loop', { en: 'Loop', uk: 'Цикл' }),
    nodes: [
      { id: 'start', type: 'START', params: {} },
      { id: 'loop', type: 'LOOP', params: { max_iterations: 3 } },
      { id: 'llm', type: 'LLM', params: defaultParams('LLM') },
      { id: 'end', type: 'END', params: {} },
    ],
    edges: [
      { id: 'e1', from: 'start', fromPort: 'out', to: 'loop' },
      { id: 'e2', from: 'loop', fromPort: 'body', to: 'llm' },
      { id: 'e3', from: 'llm', fromPort: 'out', to: 'loop' },
      { id: 'e4', from: 'loop', fromPort: 'done', to: 'end' },
    ],
  };
  t('цикл через LOOP з лімітом — валідний', validateWorkflow(loop).ok, validateWorkflow(loop).errors.map((e) => e.message).join(' | '));
  const bad = clone(loop); bad.nodes[1].params.max_iterations = 50;
  t('LOOP понад 20 повторів — помилка', codes(bad).includes('bad_param'));
}
{
  const d = clone(sample); d.nodes.push({ id: 'x', type: 'MAGIC', params: {} });
  t('невідомий тип вузла — помилка', codes(d).includes('unknown_node_type'));
  const n = clone(sample); n.name = { en: 'Only English', uk: '' };
  t('назва лише англійською — помилка (ТЗ §0)', codes(n).includes('missing_name'));
  const p = clone(sample); p.nodes.find((x) => x.id === 'extract')!.params.secret_param = 1;
  t('зайвий параметр — попередження, не помилка', validateWorkflow(p).ok && validateWorkflow(p).warnings.some((w) => w.code === 'unknown_param'));
  const ch: WorkflowDefinition = { ...emptyWorkflow('wf_c', { en: 'C', uk: 'В' }), nodes: [{ id: 'start', type: 'START', params: {} }, { id: 'c', type: 'JEV_CHOICE', params: { ...defaultParams('JEV_CHOICE'), question: 'Що зробить герой?', options: ['fallback', 'бій'] } }, { id: 'end', type: 'END', params: {} }], edges: [] };
  t('варіант Jev-вибору «fallback» збігається з резервною гілкою — помилка', codes(ch).includes('duplicate_branch'));
}

console.log('\nСемантика й розкладка (№28):');
{
  const a = workflowSemanticJson(sample);
  const b = clone(sample); b.nodes.reverse(); b.edges.reverse();
  t('порядок вузлів і ребер — не семантика (той самий відбиток)', workflowSemanticJson(b) === a);
  t('у визначенні немає координат', !/"x"|"y"|position/.test(JSON.stringify(sample)));
  const c = clone(sample); c.nodes.find((n) => n.id === 'extract')!.params.temperature = 0.2;
  t('зміна параметра — інший відбиток', workflowSemanticJson(c) !== a);
  const diff = diffWorkflows(sample, c);
  t('різниця: змінено параметр temperature вузла extract', diff.changed && diff.nodes.changed[0]?.id === 'extract' && diff.nodes.changed[0].fields.join() === 'params.temperature');
  t('розкладка — лише вузли визначення, скінченні числа', JSON.stringify(sanitizeLayout(sample, { start: { x: 10.4, y: 20 }, ghost: { x: 1, y: 1 }, extract: { x: 'a', y: 1 }, end: { x: 1e9, y: 0 } })) === '{"start":{"x":10,"y":20}}');
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
if (fail > 0) process.exit(1);

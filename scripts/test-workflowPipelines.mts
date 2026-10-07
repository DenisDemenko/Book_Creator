/**
 * Наявні конвеєри як процеси ШІ (Т5.4 В2, `PLAN_WORKFLOW_ENGINE.md`; рішення
 * власника §2 п.1–2; ТЗ Graph Studio §39 №7, 8, 11): системні процеси,
 * автопублікація v1 (і лише раз), задача AI-1 через опубліковану версію,
 * поріг впевненості нової версії — без коду, повтор запуску з відновленням
 * запиту з входу, без опублікованої версії — старий шлях.
 * Рівність зі старим шляхом — ті самі тести конвеєрів з `--workflows`
 * (test:core-mentions:wf, test:character-profile:wf, test:character-memory:wf,
 * test:interview:wf). Запуск: npm run test:workflow-pipelines
 */
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { bootstrapOntology, resetActiveRegistry } from '../server/core/ontology/lifecycle.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { MemoryJobStore } from '../server/core/jobs/memoryJobStore.ts';
import { JobQueue } from '../server/core/jobs/queue.ts';
import { aiMentionsJobKind, AI_MENTIONS_JOB_KIND } from '../server/core/ai/mentions.ts';
import { ensureSystemWorkflows, systemWorkflowDefinitions } from '../server/core/workflows/seeds.ts';
import { systemBindings } from '../server/core/workflows/bindings/index.ts';
import { ensureDraft, saveDraft, validateVersion, promoteToTest, publishVersion } from '../server/core/workflows/lifecycle.ts';
import { replayRun, publishedVersion, type EngineDeps } from '../server/core/workflows/engine/runner.ts';
import { validateWorkflow } from '../src/utils/workflowGraph.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import type { AiGenerateInput } from '../server/core/ai/roles.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('\nСистемні процеси (§2 п.1):');
const defs = systemWorkflowDefinitions();
t('сім процесів: AI-1, AI-2 профіль і пам’ять, голос героя, детектор змін, адаптивний аналіз, причинність', defs.map((d) => d.id).join() === 'ai1_mentions,ai2_profile,ai2_memory,character_voice,semantic_change_detector,adaptive_workflow,causality_engine');
t('кожен проходить перевірку Graph Studio', defs.every((d) => validateWorkflow(d).ok), JSON.stringify(defs.map((d) => validateWorkflow(d).errors.map((e) => e.message))));
t('v1 = поведінка до Т5.4: температура 0,7, без ліміту токенів, без повторів вузла, поріг 0', defs.filter(d => !['semantic_change_detector', 'adaptive_workflow', 'causality_engine'].includes(d.id)).every((d) => {
  const llm = d.nodes.find((n) => n.type === 'LLM')!.params;
  const prop = d.nodes.find((n) => n.type === 'PROPOSAL')!.params;
  return llm.temperature === 0.7 && llm.max_tokens === undefined && llm.retry_count === 0 && prop.min_confidence === 0;
}));
t('шаблони — з «Ядра AI» (адмін їх і далі править там)', defs.filter(d => !['semantic_change_detector', 'adaptive_workflow', 'causality_engine'].includes(d.id)).map((d) => d.nodes.find((n) => n.type === 'PROMPT')!.params.template).join() === 'core:coreAi1Classify,core:coreAi2Analysis,core:coreAi2Analysis,core:coreCharacterVoice');

const repo = new MemoryCoreRepository();
resetActiveRegistry();
await bootstrapOntology(repo);

console.log('\nАвтопублікація v1 (§2 п.2):');
t('перший старт — створено й опубліковано всі сім', (await ensureSystemWorkflows(repo)).length === 7);
for (const d of defs) {
  const v = await publishedVersion(repo, d.id);
  if (!v || v.version !== 1 || v.publishedBy !== 'system:workflow-seed') t(`«${d.id}» опубліковано v1 системою`, false);
}
t('опубліковані v1 — від системи', (await Promise.all(defs.map((d) => publishedVersion(repo, d.id)))).every((v) => v?.version === 1 && v.publishedBy === 'system:workflow-seed'));
t('другий старт — нічого не створює й не чіпає', (await ensureSystemWorkflows(repo)).length === 0 && (await repo.listWorkflowVersions('ai1_mentions')).length === 1);

console.log('\nAI-1 через опубліковану версію (№8):');
const P = 'book-wf';
const sec = (id: string, content: string) => {
  const r = reconcileParagraphIds({ sectionId: id, content });
  return { id, title: id, order: 0, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
};
await syncBookToCore(repo, {
  id: P, ownerId: 'u-owner', title: 'Книга',
  book: { id: P, title: 'Книга', characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }], chapters: [{ id: 'ch', title: 'Глава', order: 0, sections: [sec('s1', 'Олена стояла на мосту.\n\nМарко мовчав.\n\nЛіхтар світив.')] }] },
});
const paras = await repo.listParagraphs(P, 's1');
const marko = (await repo.resolveAlias(P, 'character', 'Марко'))!;
const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
const calls: AiGenerateInput[] = [];
const generate = async (input: AiGenerateInput) => {
  calls.push(input);
  return {
    text: JSON.stringify({ findings: [
      { kind: 'mention', entity_type: 'character', entity_name: 'Олена', summary: 'Олена', paragraph_ids: [paras[0].id], confidence: 0.9 },
      { kind: 'mention', entity_type: 'character', entity_name: 'Марко', summary: 'Марко', paragraph_ids: [paras[1].id], confidence: 0.55 },
    ] }),
    modelId: input.modelId ?? 'm', engine: 'fake', inputTokens: 80, outputTokens: 40, costUsd: 0.002,
  };
};
const engine: EngineDeps = { repo, services: { generate, resolveModel: async () => 'model-ai1', sleep: async () => {} }, bindings: systemBindings() };
let clock = Date.parse('2026-10-02T10:00:00Z');
const store = new MemoryJobStore();
const q = new JobQueue(store, { workerId: 'w', now: () => new Date(clock), log: () => {} });
q.register(AI_MENTIONS_JOB_KIND, aiMentionsJobKind({ repo: () => repo, generate, resolveModel: async () => 'model-ai1', workflows: () => engine }));
const runJob = async () => {
  const { job } = await q.enqueue({ projectId: P, kind: AI_MENTIONS_JOB_KIND, payload: { paragraphIds: paras.map((p) => p.id) }, createdBy: 'user:u-owner' });
  await q.runOnce();
  clock += 120_000;
  return store.get(P, job.id);
};
let job = await runJob();
const r1 = (await repo.listWorkflowRuns({ workflowId: 'ai1_mentions' }))[0];
t('задача пройшла через процес: запуск, джерело, задача', (job?.result as any)?.workflowRunId === r1?.id && r1.trigger === 'job:ai_mentions' && r1.jobId === job?.id && r1.status === 'succeeded');
t('пропозиції — як раніше (дві згадки)', (job?.result as any)?.suggestions === 2, JSON.stringify(job?.result));
const steps = await repo.listWorkflowSteps(r1.id);
t('трасування: контекст → шаблон → модель → схема → пропозиції', steps.map((s) => s.nodeId).join() === 'start,context,prompt,llm,validate,propose,end', steps.map((s) => s.nodeId).join());
t('крок моделі: модель модуля, токени, вартість; крок перевірки — впевненість', steps[3].model === 'model-ai1' && steps[3].tokensIn === 80 && steps[3].costUsd === 0.002 && Math.abs((steps[4].confidence ?? 0) - 0.725) < 1e-6);
t('модель отримала параметри версії (температура 0,7)', calls[0].generation?.temperature === 0.7 && calls[0].module === 'coreAi1Classify');
const analysis = await repo.getRun(P, String((job?.result as any)?.runId));
t('analysis_runs — як раніше: запис ролі AI-1, завершено', analysis?.status === 'done' && analysis.role === 'AI-1' && analysis.model === 'model-ai1');

console.log('\nПоріг у новій версії — без зміни коду (№11):');
const draft = await ensureDraft(repo, 'ai1_mentions', 'user:u-admin');
const def = structuredClone(draft.definition) as any;
def.nodes.find((n: any) => n.id === 'propose').params.min_confidence = 0.6;
def.nodes.find((n: any) => n.id === 'llm').params.temperature = 0.2;
await saveDraft(repo, { workflowId: 'ai1_mentions', versionId: draft.id, definition: def, actor: 'user:u-admin' });
await validateVersion(repo, 'ai1_mentions', draft.id, 'user:u-admin');
await promoteToTest(repo, 'ai1_mentions', draft.id, 'user:u-admin');
await publishVersion(repo, 'ai1_mentions', draft.id, 'user:u-admin');
for (const f of await repo.listFindings(P, { status: 'suggested' })) await repo.setFindingStatus(P, f.id, 'rejected', 'user:u-owner');
await syncBookToCore(repo, {
  id: 'book-wf2', ownerId: 'u-owner', title: 'Друга',
  book: { id: 'book-wf2', title: 'Друга', characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }], chapters: [{ id: 'ch', title: 'Глава', order: 0, sections: [sec('s1', 'Олена стояла на мосту.\n\nМарко мовчав.\n\nЛіхтар світив.')] }] },
});
const paras2 = await repo.listParagraphs('book-wf2', 's1');
calls.length = 0;
const { job: j2 } = await q.enqueue({ projectId: 'book-wf2', kind: AI_MENTIONS_JOB_KIND, payload: { paragraphIds: paras2.map((p) => p.id) }, createdBy: 'user:u-owner' });
// Відповідь моделі посилається на абзаци першої книги — підмінимо на другу.
paras.splice(0, paras.length, ...paras2);
await q.runOnce();
clock += 120_000;
job = await store.get('book-wf2', j2.id);
t('v2: поріг 0,6 — згадку з упевненістю 0,55 відсіяно', (job?.result as any)?.suggestions === 1 && (job?.result as any)?.filtered >= 1, JSON.stringify(job?.result));
t('v2: температура 0,2 дійшла до моделі', calls[0].generation?.temperature === 0.2);
const r2 = (await repo.listWorkflowRuns({ workflowId: 'ai1_mentions', projectId: 'book-wf2' }))[0];
t('запуск пам\'ятає v2', r2.version === 2);

console.log('\nПовтор запуску — запит із входу (§31):');
calls.length = 0;
const rep = await replayRun(engine, r1.id, 'user:u-admin');
t('повтор першого запуску — та сама v1, вхід той самий, модель знову', rep.run.status === 'succeeded' && rep.run.version === 1 && rep.run.inputHash === r1.inputHash && calls.length === 1 && calls[0].generation?.temperature === 0.7, rep.run.error ?? '');
t('повтор: дублікати вже відхиленого не пропонуються (той самий відсів)', (rep.state?.result as any)?.kinds?.mention_suggestion === undefined || (rep.state?.result as any)?.kinds?.mention_suggestion === 0, JSON.stringify(rep.state?.result));

console.log('\nБез опублікованої версії — старий шлях:');
{
  const repo2 = new MemoryCoreRepository();
  await bootstrapOntology(repo2);
  await syncBookToCore(repo2, {
    id: P, ownerId: 'u-owner', title: 'Книга',
    book: { id: P, title: 'Книга', characters: [{ id: 'c-o', name: 'Олена' }, { id: 'c-m', name: 'Марко' }], chapters: [{ id: 'ch', title: 'Глава', order: 0, sections: [sec('s1', 'Олена стояла на мосту.\n\nМарко мовчав.\n\nЛіхтар світив.')] }] },
  });
  const ps = await repo2.listParagraphs(P, 's1');
  paras.splice(0, paras.length, ...ps);
  const store2 = new MemoryJobStore();
  const q2 = new JobQueue(store2, { workerId: 'w2', now: () => new Date(clock), log: () => {} });
  q2.register(AI_MENTIONS_JOB_KIND, aiMentionsJobKind({ repo: () => repo2, generate, resolveModel: async () => 'model-ai1', workflows: () => ({ ...engine, repo: repo2 }) }));
  const { job: j3 } = await q2.enqueue({ projectId: P, kind: AI_MENTIONS_JOB_KIND, payload: { paragraphIds: ps.map((p) => p.id) }, createdBy: 'user:u-owner' });
  await q2.runOnce();
  const done = await store2.get(P, j3.id);
  t('рушій є, процесу немає — задача йде старим шляхом, без запусків', (done?.result as any)?.suggestions === 2 && !(done?.result as any)?.workflowRunId && (await repo2.listWorkflowRuns({})).length === 0, JSON.stringify(done?.result));
}
void marko;
void olena;

resetActiveRegistry();
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

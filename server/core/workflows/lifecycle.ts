/**
 * Процеси ШІ: версії й середовища (Т5.2 В2, `PLAN_GRAPH_STUDIO.md`; ТЗ Graph
 * Studio §34, §37, §38, №7, 27, 28).
 *
 *   чернетка (draft) ──перевірка──▶ тест (test, заморожена)
 *        ▲                               │ публікація (право canPublishSchema)
 *        │ нова чернетка з робочої        ▼
 *        └──────────────────────── робоча (production) ──▶ архів
 *
 * Правка — лише чернетки, тож робоча версія від неї не змінюється (§38).
 * Відкат — нова версія з копією обраної опублікованої, одразу робоча
 * (попередня — в архів). Розкладка канви живе окремо від визначення: її
 * можна правити й у замороженої версії — семантика від неї не залежить (№28).
 */

import crypto from 'node:crypto';
import type { CoreActor, CoreRepository, WorkflowRow, WorkflowVersionRow } from '../types';
import { CoreRuleError } from '../rules';
import {
  WORKFLOW_FORMAT,
  WORKFLOW_ID_RE,
  emptyWorkflow,
  samplePipeline,
  sanitizeLayout,
  validateWorkflow,
  workflowSemanticJson,
  type GraphLayout,
  type WorkflowDefinition,
  type WorkflowValidation,
} from '../../../src/utils/workflowGraph';
import type { LocalizedName } from '../../../src/utils/ontology';

export function workflowHash(def: WorkflowDefinition): string {
  return crypto.createHash('sha256').update(workflowSemanticJson(def)).digest('hex');
}

/** Визначення з клієнта — у межах формату: id і формат беруться від процесу, зайве відкидається. */
export function normalizeDefinition(workflowId: string, raw: unknown, fallback: { name: LocalizedName; description: string }): WorkflowDefinition {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CoreRuleError('bad_input', 'Визначення процесу — обʼєкт');
  const r = raw as Record<string, any>;
  const nodes = Array.isArray(r.nodes) ? r.nodes : null;
  const edges = Array.isArray(r.edges) ? r.edges : null;
  if (!nodes || !edges) throw new CoreRuleError('bad_input', 'Визначення процесу — з вузлами й ребрами');
  if (nodes.length > 300 || edges.length > 1000) throw new CoreRuleError('bad_input', 'Процес — до 300 вузлів і 1000 ребер');
  const name = r.name && typeof r.name.en === 'string' && typeof r.name.uk === 'string' ? { en: r.name.en, uk: r.name.uk } : fallback.name;
  return {
    format: WORKFLOW_FORMAT,
    id: workflowId,
    name,
    description: typeof r.description === 'string' ? r.description.slice(0, 2000) : fallback.description,
    nodes: nodes.map((n: any) => ({
      id: String(n?.id ?? ''),
      type: String(n?.type ?? ''),
      ...(typeof n?.label === 'string' && n.label.trim() ? { label: n.label.slice(0, 200) } : {}),
      params: n?.params && typeof n.params === 'object' && !Array.isArray(n.params) ? n.params : {},
    })),
    edges: edges.map((e: any) => ({ id: String(e?.id ?? ''), from: String(e?.from ?? ''), fromPort: String(e?.fromPort ?? 'out'), to: String(e?.to ?? '') })),
  };
}

export interface StoredValidation extends WorkflowValidation {
  /** Для якого хешу визначення пораховано — інший хеш = перевірка застаріла. */
  hash: string;
  at: string;
}

const isFresh = (v: WorkflowVersionRow) => {
  const val = v.validation as unknown as StoredValidation | null;
  return !!val && val.ok === true && val.hash === v.definitionHash;
};

/** Перевірка визначення + те, що бачить лише сервер: підграфи — наявні процеси з робочою версією. */
export async function validateOnServer(repo: CoreRepository, def: WorkflowDefinition): Promise<WorkflowValidation> {
  const v = validateWorkflow(def);
  for (const n of def.nodes ?? []) {
    if (n.type !== 'SUBGRAPH') continue;
    const ref = String(n.params?.workflow_id ?? '');
    if (!ref || ref === def.id) continue;
    const wf = await repo.getWorkflow(ref);
    const prod = wf ? (await repo.listWorkflowVersions(ref, { limit: 200 })).find((x) => x.environment === 'production') : null;
    if (!wf || wf.status !== 'active') v.errors.push({ code: 'unknown_subgraph', path: `nodes.${n.id}.params.workflow_id`, message: `Підграф «${ref}» — такого процесу немає`, nodeId: n.id });
    else if (!prod) v.errors.push({ code: 'subgraph_not_published', path: `nodes.${n.id}.params.workflow_id`, message: `Підграф «${ref}» ще не опубліковано — викликати можна лише робочу версію`, nodeId: n.id });
  }
  v.ok = v.errors.length === 0;
  return v;
}

const event = (repo: CoreRepository, workflowId: string, versionId: string | null, action: Parameters<CoreRepository['addWorkflowEvent']>[0]['action'], actor: CoreActor, details: Record<string, unknown> = {}) =>
  repo.addWorkflowEvent({ workflowId, versionId, action, actor, details });

async function versionOf(repo: CoreRepository, workflowId: string, versionId: string): Promise<WorkflowVersionRow> {
  const v = await repo.getWorkflowVersion(versionId);
  if (!v || v.workflowId !== workflowId) throw new CoreRuleError('not_found', 'Версію процесу не знайдено');
  return v;
}

export async function createWorkflow(
  repo: CoreRepository,
  input: { id: string; name: LocalizedName; description?: string; template?: 'empty' | 'sample'; actor: CoreActor },
): Promise<{ workflow: WorkflowRow; draft: WorkflowVersionRow }> {
  if (!WORKFLOW_ID_RE.test(String(input.id ?? ''))) throw new CoreRuleError('bad_input', 'Id процесу — латиниця, цифри й «_», від 2 до 64 символів, з літери');
  if (await repo.getWorkflow(input.id)) throw new CoreRuleError('conflict', `Процес «${input.id}» уже є`);
  const workflow = await repo.addWorkflow({ id: input.id, name: input.name, description: input.description ?? '', createdBy: input.actor });
  const base = input.template === 'sample' ? samplePipeline() : emptyWorkflow(input.id, input.name, input.description ?? '');
  const def: WorkflowDefinition = { ...base, id: input.id, name: input.name, description: input.description ?? base.description };
  const draft = await repo.addWorkflowVersion({ workflowId: input.id, definition: def as unknown as Record<string, unknown>, definitionHash: workflowHash(def), createdBy: input.actor });
  await event(repo, input.id, draft.id, 'create', input.actor, { template: input.template ?? 'empty' });
  return { workflow, draft };
}

export interface WorkflowSummary {
  workflow: WorkflowRow;
  production: { id: string; version: number; publishedAt: string | null } | null;
  test: { id: string; version: number } | null;
  draft: { id: string; version: number; valid: boolean } | null;
  versions: number;
}

export async function listWorkflowSummaries(repo: CoreRepository): Promise<WorkflowSummary[]> {
  const out: WorkflowSummary[] = [];
  for (const w of await repo.listWorkflows()) {
    const vs = await repo.listWorkflowVersions(w.id, { limit: 200 });
    const p = vs.find((v) => v.environment === 'production');
    const t = vs.find((v) => v.environment === 'test');
    const d = vs.find((v) => v.environment === 'draft');
    out.push({
      workflow: w,
      production: p ? { id: p.id, version: p.version, publishedAt: p.publishedAt } : null,
      test: t ? { id: t.id, version: t.version } : null,
      draft: d ? { id: d.id, version: d.version, valid: isFresh(d) } : null,
      versions: vs.length,
    });
  }
  return out;
}

/** Відкрити чернетку: наявну — або нову з обраної (типово — робочої) версії, з її розкладкою. */
export async function ensureDraft(repo: CoreRepository, workflowId: string, actor: CoreActor, fromVersionId?: string | null): Promise<WorkflowVersionRow> {
  const wf = await repo.getWorkflow(workflowId);
  if (!wf) throw new CoreRuleError('not_found', `Процесу «${workflowId}» немає`);
  if (wf.status !== 'active') throw new CoreRuleError('conflict', 'Процес в архіві');
  const vs = await repo.listWorkflowVersions(workflowId, { limit: 200 });
  const existing = vs.find((v) => v.environment === 'draft');
  if (existing) return (await repo.getWorkflowVersion(existing.id))!;
  const baseRow = fromVersionId ? await versionOf(repo, workflowId, fromVersionId) : vs.find((v) => v.environment === 'production') ?? vs.find((v) => v.environment === 'test') ?? vs[0];
  if (!baseRow) throw new CoreRuleError('not_found', 'У процесу немає версій');
  const base = baseRow.definition ? baseRow : (await repo.getWorkflowVersion(baseRow.id))!;
  const def = base.definition as unknown as WorkflowDefinition;
  const draft = await repo.addWorkflowVersion({ workflowId, definition: def as unknown as Record<string, unknown>, definitionHash: workflowHash(def), basedOn: base.id, createdBy: actor });
  const layout = await repo.getGraphLayout('workflow', workflowId, base.id);
  if (layout) await repo.saveGraphLayout({ graphKind: 'workflow', graphId: workflowId, versionRef: draft.id, layout: layout.layout, updatedBy: actor });
  await event(repo, workflowId, draft.id, 'create_draft', actor, { from: base.version });
  return draft;
}

export async function saveDraft(
  repo: CoreRepository,
  input: { workflowId: string; versionId: string; definition: unknown; layout?: unknown; expectedRevision?: number; actor: CoreActor },
): Promise<WorkflowVersionRow> {
  const wf = await repo.getWorkflow(input.workflowId);
  if (!wf) throw new CoreRuleError('not_found', `Процесу «${input.workflowId}» немає`);
  const cur = await versionOf(repo, input.workflowId, input.versionId);
  if (cur.environment !== 'draft') throw new CoreRuleError('conflict', `Правити можна лише чернетку, а ця версія — «${cur.environment}» (§38)`);
  const def = normalizeDefinition(input.workflowId, input.definition, { name: wf.name, description: wf.description });
  const hash = workflowHash(def);
  const changed = hash !== cur.definitionHash;
  const row = changed
    ? await repo.updateWorkflowDraft(cur.id, { definition: def as unknown as Record<string, unknown>, definitionHash: hash, validation: null }, input.expectedRevision)
    : cur;
  if (input.layout !== undefined) {
    await repo.saveGraphLayout({ graphKind: 'workflow', graphId: input.workflowId, versionRef: cur.id, layout: sanitizeLayout(def, input.layout), updatedBy: input.actor });
  }
  if (changed) await event(repo, input.workflowId, cur.id, 'edit', input.actor, { nodes: def.nodes.length, edges: def.edges.length });
  if (changed && (def.name.en !== wf.name.en || def.name.uk !== wf.name.uk || def.description !== wf.description)) {
    await repo.updateWorkflow(input.workflowId, { name: def.name, description: def.description });
  }
  return row;
}

export async function validateVersion(repo: CoreRepository, workflowId: string, versionId: string, actor: CoreActor): Promise<{ version: WorkflowVersionRow; validation: StoredValidation }> {
  const v = await versionOf(repo, workflowId, versionId);
  const res = await validateOnServer(repo, v.definition as unknown as WorkflowDefinition);
  const validation: StoredValidation = { ...res, hash: v.definitionHash, at: new Date().toISOString() };
  const version = v.environment === 'draft' ? await repo.updateWorkflowDraft(v.id, { validation: validation as unknown as Record<string, unknown> }) : v;
  await event(repo, workflowId, v.id, 'validate', actor, { ok: res.ok, errors: res.errors.length, warnings: res.warnings.length });
  return { version, validation };
}

/** Чернетка → тест: лише перевірена (для поточного хешу) і без помилок. */
export async function promoteToTest(repo: CoreRepository, workflowId: string, versionId: string, actor: CoreActor): Promise<WorkflowVersionRow> {
  const v = await versionOf(repo, workflowId, versionId);
  if (v.environment !== 'draft') throw new CoreRuleError('conflict', `У тест переходить лише чернетка, а ця версія — «${v.environment}»`);
  if (!isFresh(v)) throw new CoreRuleError('conflict', 'Спершу перевірте чернетку — без помилок (Validate перед тестом)');
  const out = await repo.transitionWorkflowVersion(v.id, 'test', actor);
  await event(repo, workflowId, v.id, 'to_test', actor, { version: v.version });
  return out;
}

/** Тест → робоче середовище (PUBLISH TO PRODUCTION, §38). Право перевіряє маршрут. */
export async function publishVersion(repo: CoreRepository, workflowId: string, versionId: string, actor: CoreActor): Promise<WorkflowVersionRow> {
  const v = await versionOf(repo, workflowId, versionId);
  if (v.environment !== 'test') throw new CoreRuleError('conflict', `Опублікувати можна лише тестову версію, а ця — «${v.environment}»`);
  const check = await validateOnServer(repo, v.definition as unknown as WorkflowDefinition);
  if (!check.ok) throw new CoreRuleError('conflict', `Версія не проходить перевірку: ${check.errors.slice(0, 3).map((e) => e.message).join('; ')}`);
  const prev = (await repo.listWorkflowVersions(workflowId, { limit: 200 })).find((x) => x.environment === 'production');
  const out = await repo.transitionWorkflowVersion(v.id, 'production', actor);
  await event(repo, workflowId, v.id, 'publish', actor, { version: v.version, replaced: prev?.version ?? null });
  return out;
}

/** Відкат (№27): нова версія з копією опублікованої, одразу робоча; поточна робоча — в архів. */
export async function rollbackTo(repo: CoreRepository, workflowId: string, targetVersionId: string, actor: CoreActor): Promise<WorkflowVersionRow> {
  const target = await versionOf(repo, workflowId, targetVersionId);
  if (!target.publishedAt) throw new CoreRuleError('conflict', 'Відкотитися можна лише до версії, що вже була робочою');
  if (target.environment === 'production') throw new CoreRuleError('conflict', 'Ця версія й так робоча');
  const def = target.definition as unknown as WorkflowDefinition;
  const check = await validateOnServer(repo, def);
  if (!check.ok) throw new CoreRuleError('conflict', `Стара версія вже не проходить перевірку: ${check.errors.slice(0, 3).map((e) => e.message).join('; ')}`);
  const prev = (await repo.listWorkflowVersions(workflowId, { limit: 200 })).find((x) => x.environment === 'production');
  const copy = await repo.addWorkflowVersion({ workflowId, definition: def as unknown as Record<string, unknown>, definitionHash: workflowHash(def), basedOn: target.id, createdBy: actor, environment: 'test', notes: `Відкат до версії ${target.version}` });
  const out = await repo.transitionWorkflowVersion(copy.id, 'production', actor);
  const layout = await repo.getGraphLayout('workflow', workflowId, target.id);
  if (layout) await repo.saveGraphLayout({ graphKind: 'workflow', graphId: workflowId, versionRef: copy.id, layout: layout.layout, updatedBy: actor });
  await event(repo, workflowId, copy.id, 'rollback', actor, { to: target.version, version: copy.version, replaced: prev?.version ?? null });
  return out;
}

/** Відкинути чернетку чи зняти тестову версію (в архів). Робочу — лише публікацією чи відкатом. */
export async function archiveVersion(repo: CoreRepository, workflowId: string, versionId: string, actor: CoreActor): Promise<WorkflowVersionRow> {
  const v = await versionOf(repo, workflowId, versionId);
  const out = await repo.transitionWorkflowVersion(v.id, 'archived', actor);
  await event(repo, workflowId, v.id, v.environment === 'draft' ? 'discard' : 'archive', actor, { version: v.version, from: v.environment });
  return out;
}

export async function getLayout(repo: CoreRepository, kind: 'workflow' | 'ontology', graphId: string, versionRef: string): Promise<GraphLayout> {
  return ((await repo.getGraphLayout(kind, graphId, versionRef))?.layout ?? {}) as GraphLayout;
}

/** Розкладка версії процесу — і замороженої теж: координати не семантика (№28). */
export async function saveVersionLayout(repo: CoreRepository, workflowId: string, versionId: string, layout: unknown, actor: CoreActor): Promise<GraphLayout> {
  const v = await versionOf(repo, workflowId, versionId);
  const clean = sanitizeLayout(v.definition as unknown as WorkflowDefinition, layout);
  await repo.saveGraphLayout({ graphKind: 'workflow', graphId: workflowId, versionRef: v.id, layout: clean, updatedBy: actor });
  return clean;
}

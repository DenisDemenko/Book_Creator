/**
 * Виконання ролі AI над абзацами книги (Т0.9): прогін → модель → схема →
 * доказ → висновки `suggested`.
 *
 * Кожен виклик — рядок `analysis_runs` (роль, модуль, модель, версія
 * шаблону, вхідні абзаци з відбитком, витрата), а витрата — ще й у
 * `usage_log` з `book_id` через ядро ШІ (`generate` нижче), тож видна в
 * «Тарифах ШІ». Якщо прогін іде у фоновій задачі, витрата списується з
 * бюджету проєкту (Т0.7).
 *
 * Модель тут — залежність (`generate`), а не імпорт: у тестах її заміняє
 * підставна функція, у Студії — `aiRoleGenerateViaCore` (`generate.ts`).
 */

import { createHash } from 'node:crypto';
import { blockHash } from '../../../src/utils/paragraphIds';
import type { AiRole, CoreActor, CoreRepository, FindingRow, RunRow, Visibility } from '../types';
import {
  CORE_AI_ROLE_MODULE,
  CORE_AI_ROLE_RESPONSE_SCHEMA,
  factoryCoreAiRoleTemplate,
  renderCoreAiRoleTemplate,
  type CoreAiModule,
  type CoreAiRoleModule,
} from './rolePrompts';
import { parseModelJson, validateAgainstSchema } from './schema';

export interface AiGenerateInput {
  module: CoreAiModule;
  modelId: string | undefined;
  system: string;
  user: string;
  projectId: string;
  /** Для витрати в usage_log: хто запустив. */
  actor: CoreActor;
  images?: { id: string; mimeType: string; data: string }[];
  signal?: AbortSignal;
  /** Т5.4: параметри вузла LLM (температура, ліміт токенів, тайм-аут); без них — як раніше. */
  generation?: { temperature?: number; maxTokens?: number; timeoutMs?: number };
}

export interface AiGenerateOutput {
  text: string;
  modelId: string;
  engine: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface AiRoleDeps {
  repo: CoreRepository;
  generate: (input: AiGenerateInput) => Promise<AiGenerateOutput>;
  /** Модель ролі з адмінки (`resolveModuleModelId`); undefined — дефолт сервера. */
  resolveModel: (module: CoreAiRoleModule) => Promise<string | undefined>;
  /** Шаблон з адмінського шару; без нього — заводський. */
  loadTemplate?: (module: CoreAiRoleModule) => Promise<{ system: string; user: string } | undefined>;
  /** Списання з бюджету задачі (Т0.7); кидає, якщо бюджет вичерпано. */
  recordUsage?: (usage: { tokens: number; requests: number }) => Promise<void>;
}

export interface AiRoleRequest {
  projectId: string;
  role: AiRole;
  /** Що саме зробити — підставляється в {ЗАВДАННЯ}. */
  task: string;
  paragraphs: { id: string; text: string }[];
  images?: { id: string; description?: string; mimeType?: string; data?: string }[];
  /** Висновки прив'язати до цієї сутності (профіль персонажа тощо). */
  entityId?: string | null;
  sourceRevision?: number | null;
  visibility?: Visibility;
  language?: string;
  /** Хто запустив прогін: `user:…` або `system:…`. */
  createdBy: CoreActor;
  signal?: AbortSignal;
  /**
   * Додаткова обробка кожного висновку (Т1.1): зіставлення з сутностями,
   * відсів дублів і відхиленого раніше, розбиття по абзацах. Отримує висновок
   * з уже звіреним доказом; `[]` — не зберігати.
   */
  prepare?: (finding: ModelFinding, evidence: { paragraphIds: string[]; imageIds: string[] }) => Promise<PreparedFinding[]>;
}

export interface RejectedFinding {
  /** no_evidence — немає доказу з вхідних даних; filtered — відкинув `prepare` (дубль, відхилене раніше…). */
  reason: 'no_evidence' | 'filtered';
  kind: string;
  summary: string;
}

export interface AiRoleResult {
  run: RunRow;
  status: 'done' | 'invalid' | 'failed';
  findings: FindingRow[];
  rejected: RejectedFinding[];
  errors: string[];
}

export interface ModelFinding {
  kind: string;
  entity_type?: string;
  entity_name?: string;
  summary: string;
  paragraph_ids?: string[];
  image_ids?: string[];
  quote?: string;
  confidence: number;
  insufficient_data?: boolean;
  [key: string]: unknown;
}

/** Висновок після `prepare`: що саме зберегти (можна кілька з одного — по абзацу). */
export interface PreparedFinding {
  kind: string;
  entityId?: string | null;
  payload: Record<string, unknown>;
  paragraphIds: string[];
  imageIds?: string[];
}

function formatParagraphs(paragraphs: { id: string; text: string }[]): string {
  return paragraphs.map((p) => `[${p.id}] ${p.text}`).join('\n\n');
}

function templateVersion(t: { system: string; user: string }): string {
  return createHash('sha256').update(`${t.system}\u0000${t.user}`).digest('hex').slice(0, 12);
}

// ── Кроки ролі окремо (Т5.4 В2): ними користуються і `runAiRole`, і вузли процесу ШІ ──

export interface RolePrompt {
  module: CoreAiRoleModule;
  template: { system: string; user: string };
  rendered: { system: string; user: string };
  promptVersion: string;
}

/** Шаблон ролі (адмінський шар чи заводський; або власний системний текст вузла PROMPT) → готова інструкція. */
export async function prepareRolePrompt(deps: Pick<AiRoleDeps, 'loadTemplate'>, req: AiRoleRequest, override?: { system?: string }): Promise<RolePrompt> {
  const module = CORE_AI_ROLE_MODULE[req.role];
  const base = (await deps.loadTemplate?.(module)) ?? factoryCoreAiRoleTemplate(module);
  const template = override?.system ? { system: override.system, user: base.user } : base;
  const rendered = renderCoreAiRoleTemplate(template, {
    task: req.task,
    paragraphs: formatParagraphs(req.paragraphs),
    images: (req.images ?? []).map((i) => `[${i.id}] ${i.description ?? ''}`.trim()).join('\n'),
    language: req.language,
  });
  return { module, template, rendered, promptVersion: templateVersion(template) };
}

/** Рядок `analysis_runs` для виклику ролі. */
export function beginRoleRun(deps: Pick<AiRoleDeps, 'repo'>, req: AiRoleRequest, modelId: string | undefined, prompt: RolePrompt): Promise<RunRow> {
  return deps.repo.createRun({
    projectId: req.projectId,
    role: req.role,
    module: prompt.module,
    model: modelId ?? '',
    promptVersion: prompt.promptVersion,
    inputs: req.paragraphs.map((p) => ({ paragraphId: p.id, hash: blockHash(p.text) })),
    createdBy: req.createdBy,
  });
}

/** Висновок моделі зі звіреним доказом (серіалізовний — для стану процесу). */
export interface CheckedFinding {
  finding: ModelFinding;
  paragraphIds: string[];
  imageIds: string[];
  insufficient: boolean;
  payload: Record<string, unknown>;
}

export type RoleOutputCheck =
  | { ok: true; checked: CheckedFinding[]; rejected: RejectedFinding[] }
  | { ok: false; status: 'invalid'; message: string; errors: string[] };

/** Розбір відповіді: JSON → схема ролі → доказ лише з того, що модель справді отримала. */
export function checkRoleOutput(text: string, req: Pick<AiRoleRequest, 'paragraphs' | 'images'>): RoleOutputCheck {
  let parsed: unknown;
  try {
    parsed = parseModelJson(text);
  } catch (err) {
    const message = `Відповідь не збережено: ${(err as Error).message}`;
    return { ok: false, status: 'invalid', message, errors: [message] };
  }
  const check = validateAgainstSchema<{ findings: ModelFinding[] }>(CORE_AI_ROLE_RESPONSE_SCHEMA, parsed);
  if (!check.ok) return { ok: false, status: 'invalid', message: `Відповідь не збережено — не відповідає схемі: ${check.errors.join('; ')}`, errors: check.errors };
  const inputParagraphs = new Set(req.paragraphs.map((p) => p.id));
  const inputImages = new Set((req.images ?? []).map((i) => i.id));
  const checked: CheckedFinding[] = [];
  const rejected: RejectedFinding[] = [];
  for (const f of check.value!.findings) {
    const paragraphIds = [...new Set((f.paragraph_ids ?? []).filter((id) => inputParagraphs.has(id)))];
    const imageIds = [...new Set((f.image_ids ?? []).filter((id) => inputImages.has(id)))];
    const insufficient = !!f.insufficient_data && !paragraphIds.length && !imageIds.length;
    if (!paragraphIds.length && !imageIds.length && !insufficient) {
      rejected.push({ reason: 'no_evidence', kind: f.kind, summary: f.summary });
      continue;
    }
    const payload: Record<string, unknown> = { summary: f.summary, confidence: f.confidence };
    if (f.entity_type) payload.entityType = f.entity_type;
    if (f.entity_name) payload.entityName = f.entity_name;
    if (f.quote) payload.quote = f.quote;
    const dropped = (f.paragraph_ids ?? []).length - paragraphIds.length + (f.image_ids ?? []).length - imageIds.length;
    if (dropped > 0) payload.droppedUnknownEvidence = dropped;
    checked.push({ finding: f, paragraphIds, imageIds, insufficient, payload });
  }
  return { ok: true, checked, rejected };
}

export type RoleCost = { engine: string; model: string; inputTokens: number; outputTokens: number; costUsd: number };

/**
 * Зберегти висновки: `prepare` (зіставлення, відсів), `analysis_findings`,
 * завершити прогін. Т5.4: `minConfidence` — поріг вузла PROPOSAL (за
 * замовчуванням 0 — як раніше).
 */
export async function persistRoleFindings(
  deps: Pick<AiRoleDeps, 'repo'>,
  req: AiRoleRequest,
  run: RunRow,
  check: { checked: CheckedFinding[]; rejected: RejectedFinding[] },
  cost: RoleCost,
  opts: { minConfidence?: number } = {},
): Promise<AiRoleResult> {
  const findings: FindingRow[] = [];
  const rejected: RejectedFinding[] = [...check.rejected];
  const min = opts.minConfidence ?? 0;
  for (const c of check.checked) {
    const f = c.finding;
    if (min > 0 && typeof f.confidence === 'number' && f.confidence < min) {
      rejected.push({ reason: 'filtered', kind: f.kind, summary: f.summary });
      continue;
    }
    const prepared: PreparedFinding[] = req.prepare
      ? await req.prepare(f, { paragraphIds: c.paragraphIds, imageIds: c.imageIds })
      : [{ kind: f.kind, entityId: req.entityId ?? null, payload: c.payload, paragraphIds: c.paragraphIds, imageIds: c.imageIds }];
    if (!prepared.length) {
      rejected.push({ reason: 'filtered', kind: f.kind, summary: f.summary });
      continue;
    }
    for (const p of prepared) {
      findings.push(
        await deps.repo.addFinding({
          projectId: req.projectId,
          runId: run.id,
          entityId: p.entityId ?? null,
          kind: p.kind,
          payload: { ...c.payload, ...p.payload },
          sourceParagraphIds: p.paragraphIds,
          sourceAssetIds: p.imageIds ?? [],
          sourceRevision: req.sourceRevision ?? null,
          insufficientData: c.insufficient && !p.paragraphIds.length && !(p.imageIds ?? []).length,
          visibility: req.visibility ?? 'project',
          createdBy: `ai:${req.role}`,
        }),
      );
    }
  }
  const done = await deps.repo.finishRun(req.projectId, run.id, { status: 'done', cost: { ...cost, accepted: findings.length, rejected: rejected.length } });
  return { run: done, status: 'done', findings, rejected, errors: [] };
}

export async function runAiRole(deps: AiRoleDeps, req: AiRoleRequest): Promise<AiRoleResult> {
  const prompt = await prepareRolePrompt(deps, req);
  const module = prompt.module;
  const modelId = await deps.resolveModel(module);
  const rendered = prompt.rendered;
  const run = await beginRoleRun(deps, req, modelId, prompt);

  let out: AiGenerateOutput;
  try {
    out = await deps.generate({
      module,
      modelId,
      system: rendered.system,
      user: rendered.user,
      projectId: req.projectId,
      actor: req.createdBy,
      images: (req.images ?? [])
        .filter((i) => i.data && i.mimeType)
        .map((i) => ({ id: i.id, mimeType: i.mimeType!, data: i.data! })),
      signal: req.signal,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? String(err);
    const failed = await deps.repo.finishRun(req.projectId, run.id, { status: 'failed', error: message });
    return { run: failed, status: 'failed', findings: [], rejected: [], errors: [message] };
  }

  const cost: RoleCost = { engine: out.engine, model: out.modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd };
  // Бюджет — до розбору відповіді: витрачене витрачене, навіть якщо відповідь зіпсована.
  if (deps.recordUsage) {
    try {
      await deps.recordUsage({ tokens: out.inputTokens + out.outputTokens, requests: 1 });
    } catch (err) {
      const message = (err as Error)?.message ?? String(err);
      const failed = await deps.repo.finishRun(req.projectId, run.id, { status: 'failed', cost, error: message });
      throw Object.assign(err as Error, { run: failed });
    }
  }

  const check = checkRoleOutput(out.text, req);
  if (check.ok === false) {
    const bad = check as Extract<RoleOutputCheck, { ok: false }>;
    const invalid = await deps.repo.finishRun(req.projectId, run.id, { status: 'failed', cost, error: bad.message });
    return { run: invalid, status: 'invalid', findings: [], rejected: [], errors: bad.errors };
  }
  return persistRoleFindings(deps, req, run, check as Extract<RoleOutputCheck, { ok: true }>, cost);
}

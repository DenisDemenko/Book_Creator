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
  type CoreAiRoleModule,
} from './rolePrompts';
import { parseModelJson, validateAgainstSchema } from './schema';

export interface AiGenerateInput {
  module: CoreAiRoleModule;
  modelId: string | undefined;
  system: string;
  user: string;
  projectId: string;
  /** Для витрати в usage_log: хто запустив. */
  actor: CoreActor;
  images?: { id: string; mimeType: string; data: string }[];
  signal?: AbortSignal;
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
}

export interface RejectedFinding {
  reason: 'no_evidence';
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

interface ModelFinding {
  kind: string;
  entity_type?: string;
  entity_name?: string;
  summary: string;
  paragraph_ids?: string[];
  image_ids?: string[];
  quote?: string;
  confidence: number;
  insufficient_data?: boolean;
}

function formatParagraphs(paragraphs: { id: string; text: string }[]): string {
  return paragraphs.map((p) => `[${p.id}] ${p.text}`).join('\n\n');
}

function templateVersion(t: { system: string; user: string }): string {
  return createHash('sha256').update(`${t.system}\u0000${t.user}`).digest('hex').slice(0, 12);
}

export async function runAiRole(deps: AiRoleDeps, req: AiRoleRequest): Promise<AiRoleResult> {
  const module = CORE_AI_ROLE_MODULE[req.role];
  const modelId = await deps.resolveModel(module);
  const template = (await deps.loadTemplate?.(module)) ?? factoryCoreAiRoleTemplate(module);
  const rendered = renderCoreAiRoleTemplate(template, {
    task: req.task,
    paragraphs: formatParagraphs(req.paragraphs),
    images: (req.images ?? []).map((i) => `[${i.id}] ${i.description ?? ''}`.trim()).join('\n'),
    language: req.language,
  });

  const run = await deps.repo.createRun({
    projectId: req.projectId,
    role: req.role,
    module,
    model: modelId ?? '',
    promptVersion: templateVersion(template),
    inputs: req.paragraphs.map((p) => ({ paragraphId: p.id, hash: blockHash(p.text) })),
    createdBy: req.createdBy,
  });

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

  const cost = {
    engine: out.engine,
    model: out.modelId,
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
    costUsd: out.costUsd,
  };
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

  let parsed: unknown;
  try {
    parsed = parseModelJson(out.text);
  } catch (err) {
    const message = `Відповідь не збережено: ${(err as Error).message}`;
    const invalid = await deps.repo.finishRun(req.projectId, run.id, { status: 'failed', cost, error: message });
    return { run: invalid, status: 'invalid', findings: [], rejected: [], errors: [message] };
  }
  const check = validateAgainstSchema<{ findings: ModelFinding[] }>(CORE_AI_ROLE_RESPONSE_SCHEMA, parsed);
  if (!check.ok) {
    const message = `Відповідь не збережено — не відповідає схемі: ${check.errors.join('; ')}`;
    const invalid = await deps.repo.finishRun(req.projectId, run.id, { status: 'failed', cost, error: message });
    return { run: invalid, status: 'invalid', findings: [], rejected: [], errors: check.errors };
  }

  // Доказ — лише з того, що модель справді отримала.
  const inputParagraphs = new Set(req.paragraphs.map((p) => p.id));
  const inputImages = new Set((req.images ?? []).map((i) => i.id));
  const findings: FindingRow[] = [];
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
    findings.push(
      await deps.repo.addFinding({
        projectId: req.projectId,
        runId: run.id,
        entityId: req.entityId ?? null,
        kind: f.kind,
        payload,
        sourceParagraphIds: paragraphIds,
        sourceAssetIds: imageIds,
        sourceRevision: req.sourceRevision ?? null,
        insufficientData: insufficient,
        visibility: req.visibility ?? 'project',
        createdBy: `ai:${req.role}`,
      }),
    );
  }

  const done = await deps.repo.finishRun(req.projectId, run.id, {
    status: 'done',
    cost: { ...cost, accepted: findings.length, rejected: rejected.length },
  });
  return { run: done, status: 'done', findings, rejected, errors: [] };
}

/**
 * Фонова задача `ai_role` (Т0.9): роль AI над абзацами книги — у черзі ядра,
 * з бюджетом проєкту (Т0.7), контрольною точкою перед викликом моделі й
 * прогресом. Абзаци задача бере з ядра (їх туди кладе `core_sync`, Т0.6), а
 * не з тіла запиту: так висновок завжди спирається на збережений текст,
 * відбиток якого записано в `analysis_runs.inputs`.
 */

import type { CoreRepository } from '../types';
import type { AiRole } from '../types';
import { runAiRole, type AiRoleDeps } from './roles';

export const AI_ROLE_JOB_KIND = 'ai_role';

export interface AiRoleJobPayload {
  role: AiRole;
  task: string;
  paragraphIds: string[];
  entityId?: string | null;
  language?: string;
}

export function aiRoleJobKind(deps: {
  repo: () => CoreRepository | null;
  generate: AiRoleDeps['generate'];
  resolveModel: AiRoleDeps['resolveModel'];
  loadTemplate?: AiRoleDeps['loadTemplate'];
}) {
  return {
    maxAttempts: 2,
    // Не частіше за 30 прогонів ролі на хвилину в межах книги — захист від
    // циклу, що ставив би прогін за прогоном.
    rateLimit: { max: 30, windowMs: 60_000 },
    handler: async (ctx: {
      job: { projectId: string; payload: Record<string, unknown>; createdBy: string };
      signal: AbortSignal;
      checkpoint(): Promise<void>;
      setProgress(p: Record<string, unknown>): Promise<void>;
      recordUsage(u: { tokens?: number; requests?: number }): Promise<void>;
    }) => {
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const p = ctx.job.payload as unknown as AiRoleJobPayload;
      const paragraphs = [];
      for (const id of p.paragraphIds ?? []) {
        const row = await repo.getParagraph(ctx.job.projectId, id);
        if (row && !row.deletedAt) paragraphs.push({ id: row.id, text: row.text });
      }
      const project = await repo.getProject(ctx.job.projectId);
      await ctx.setProgress({ step: 'model', paragraphs: paragraphs.length });
      await ctx.checkpoint();
      const res = await runAiRole(
        {
          repo,
          generate: deps.generate,
          resolveModel: deps.resolveModel,
          loadTemplate: deps.loadTemplate,
          recordUsage: (u) => ctx.recordUsage(u),
        },
        {
          projectId: ctx.job.projectId,
          role: p.role,
          task: p.task,
          paragraphs,
          entityId: p.entityId ?? null,
          sourceRevision: project?.revision ?? null,
          language: p.language,
          createdBy: ctx.job.createdBy,
          signal: ctx.signal,
        },
      );
      // Збій виклику моделі — привід для повтору; невалідна відповідь — ні:
      // прогін уже записаний як невдалий, і повтор той самий шаблон не виправить.
      if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');
      return { runId: res.run.id, status: res.status, findings: res.findings.length, rejected: res.rejected.length, errors: res.errors };
    },
  };
}

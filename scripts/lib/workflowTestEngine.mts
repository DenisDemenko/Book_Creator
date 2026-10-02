/**
 * Т5.4 В2: ті самі тести конвеєрів — ще й через рушій процесів ШІ.
 * Запуск тесту з `--workflows`: системні процеси (AI-1, AI-2, голос героя)
 * засіваються й публікуються, задачі й допит ідуть через LangGraph, а всі
 * перевірки старого шляху мають пройти без змін (рівність поведінки).
 */
import type { CoreRepository } from '../../server/core/types.ts';
import type { EngineServices } from '../../server/core/workflows/engine/types.ts';
import type { EngineDeps } from '../../server/core/workflows/engine/runner.ts';
import type { SystemBindingDeps } from '../../server/core/workflows/bindings/index.ts';

export const VIA_WORKFLOWS = process.argv.includes('--workflows');

/** Без `--workflows` — undefined (старий шлях); з ним — фабрика рушія для задач і допиту. */
export async function workflowEngineFor(repo: CoreRepository, services: EngineServices, bindingDeps: SystemBindingDeps = {}): Promise<(() => EngineDeps) | undefined> {
  if (!VIA_WORKFLOWS) return undefined;
  const { ensureSystemWorkflows } = await import('../../server/core/workflows/seeds.ts');
  const { systemBindings } = await import('../../server/core/workflows/bindings/index.ts');
  if (!(await repo.getWorkflow('ai1_mentions'))) await ensureSystemWorkflows(repo);
  const bindings = systemBindings(bindingDeps);
  return () => ({ repo, services: { ...services, sleep: async () => {} }, bindings });
}

/** Підсумок для журналу тесту: скільки запусків процесу пройшло через рушій. */
export async function workflowRunsOf(repo: CoreRepository, workflowId: string) {
  return VIA_WORKFLOWS ? repo.listWorkflowRuns({ workflowId, limit: 500 }) : [];
}

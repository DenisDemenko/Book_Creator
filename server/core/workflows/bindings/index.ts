/**
 * Прив'язки системних процесів ШІ (Т5.4 В2): id процесу → кроки конвеєра.
 * Повтор, відгалуження й продовження відновлюють запит із входу запуску тими
 * самими функціями, що й задачі черги.
 */

import { semanticChangeBinding } from '../semanticChange';
import type { EntityRow } from '../../types';
import type { StudioCharacterLike } from '../../characterProfile';
import { AI1_MENTIONS_WORKFLOW, buildMentionsRequest } from '../../ai/mentions';
import { AI2_PROFILE_WORKFLOW, buildProfileRequest } from '../../characterProfile';
import { AI2_MEMORY_WORKFLOW, buildMemoryRequest, persistMemoryProposals } from '../../memoryAi';
import type { InterviewDeps } from '../../interview';
import type { BindingDef } from '../engine/types';
import { aiRoleBinding } from './aiRole';
import { voiceBinding } from './voice';

export interface SystemBindingDeps {
  loadStudio?: (projectId: string, entity: EntityRow) => Promise<{ character: StudioCharacterLike | null; all: StudioCharacterLike[] }>;
  interview?: Pick<InterviewDeps, 'studio' | 'loadTemplate'>;
}

export function systemBindings(deps: SystemBindingDeps = {}): Record<string, BindingDef> {
  const list: BindingDef[] = [
    aiRoleBinding({
      workflowId: AI1_MENTIONS_WORKFLOW,
      role: 'AI-1',
      rebuild: async ({ repo, run, input }) => buildMentionsRequest(repo, run.projectId ?? '', input, run.startedBy),
    }),
    aiRoleBinding({
      workflowId: AI2_PROFILE_WORKFLOW,
      role: 'AI-2',
      rebuild: async ({ repo, run, input }) => (await buildProfileRequest(repo, run.projectId ?? '', input, run.startedBy, deps.loadStudio)).req,
    }),
    aiRoleBinding({
      workflowId: AI2_MEMORY_WORKFLOW,
      role: 'AI-2',
      rebuild: async ({ repo, run, input }) => (await buildMemoryRequest(repo, run.projectId ?? '', String(input.sectionId ?? ''), String(input.characterId ?? ''), run.startedBy))?.req ?? null,
      afterPersist: async ({ repo, run, input }, res) => ({
        memories: await persistMemoryProposals(repo, run.projectId ?? '', String(input.sectionId ?? ''), String(input.characterId ?? ''), res.findings),
      }),
    }),
    voiceBinding(deps.interview ?? {}),
    semanticChangeBinding(),
  ];
  return Object.fromEntries(list.map((b) => [b.workflowId, b]));
}

import { causalityWorkflowDefinition } from './causalityEngine';
/**
 * Системні процеси ШІ (Т5.4 В2; рішення власника §2 п.1–2): наявні конвеєри
 * як визначення `fusion-workflow/1`. На першому старті ядра процес
 * створюється й v1 публікується автоматично — і вона точно відтворює
 * поведінку старого шляху (температура 0,7, без ліміту токенів і повторів
 * вузла — повторює черга задач, поріг 0). Далі процес належить адміну:
 * зміни — новими версіями через тест і публікацію; сід їх не чіпає.
 */

import { adaptiveWorkflowDefinition } from './adaptiveWorkflow';
import { semanticWorkflowDefinition } from './semanticChange';
import type { CoreActor, CoreRepository } from '../types';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '../../../src/utils/workflowGraph';
import { WORKFLOW_FORMAT } from '../../../src/utils/workflowGraph';
import { CHARACTER_VOICE_SCHEMA } from '../interviewPrompt';
import { INTERVIEW_ACTIONS } from '../interview';
import { createWorkflow, promoteToTest, publishVersion, saveDraft, validateVersion } from './lifecycle';

const SEED_ACTOR: CoreActor = 'system:workflow-seed';
const e = (from: string, port: string, to: string): WorkflowEdge => ({ id: `e-${from}-${port}-${to}`, from, fromPort: port, to });

/** Параметри моделі v1 = поведінка до Т5.4 (без ліміту токенів: його не було). */
const LLM_V1 = { model_provider: 'core_module', model: '', temperature: 0.7, timeout: 300, retry_count: 0, backoff: 'exponential', on_timeout: 'fail', on_provider_error: 'fail', confidence_policy: 'propose_only', cost_limit: 5 };

function aiRolePipeline(o: { id: string; en: string; uk: string; description: string; module: string; target: string; memory?: boolean }): WorkflowDefinition {
  const nodes: WorkflowNode[] = [
    { id: 'start', type: 'START', label: 'Job input (Вхід задачі)', params: {} },
    { id: 'context', type: 'CONTEXT', label: 'Scene context (Контекст сцени)', params: { context_policy: o.memory ? 'scene' : o.target === 'fact' ? 'entity_scope' : 'scene', max_tokens: 8000 } },
    ...(o.memory ? [{ id: 'memory', type: 'MEMORY', label: 'Hero memory (Пам\'ять героя)', params: { scope: 'character' } }] : []),
    { id: 'prompt', type: 'PROMPT', label: 'Core AI template (Шаблон «Ядра AI»)', params: { template: `core:${o.module}` } },
    { id: 'llm', type: 'LLM', label: 'Model (Модель)', params: { ...LLM_V1 } },
    { id: 'validate', type: 'VALIDATOR', label: 'Schema & evidence (Схема й доказ)', params: { rules: ['core_ai_role_schema', 'evidence_in_input'] } },
    { id: 'propose', type: 'PROPOSAL', label: 'Suggestions (Пропозиції)', params: { target: o.target, min_confidence: 0 } },
    { id: 'end', type: 'END', label: 'Done (Готово)', params: {} },
    { id: 'end_invalid', type: 'END', label: 'Invalid answer (Відповідь не збережено)', params: {} },
  ];
  const chain = ['start', 'context', ...(o.memory ? ['memory'] : []), 'prompt', 'llm', 'validate'];
  const edges: WorkflowEdge[] = [];
  for (let i = 0; i + 1 < chain.length; i++) edges.push(e(chain[i], 'out', chain[i + 1]));
  edges.push(e('validate', 'valid', 'propose'), e('validate', 'invalid', 'end_invalid'), e('propose', 'out', 'end'));
  return { format: WORKFLOW_FORMAT, id: o.id, name: { en: o.en, uk: o.uk }, description: o.description, nodes, edges };
}

export function systemWorkflowDefinitions(): WorkflowDefinition[] {
  const voice: WorkflowDefinition = {
    format: WORKFLOW_FORMAT,
    id: 'character_voice',
    name: { en: 'Character voice (interview)', uk: 'Голос героя (допит)' },
    description: 'Хід допиту: рішення Jev (рівні Т2.5 — стратегічний і сценічний з кешу, тактичний на хід; запасний LLM; коли не змогли — вирішує автор), знімок героя, історія ходів, шаблон «Ядра AI», модель, схема відповіді, відповідь і пропозиції в канон (вирішує автор).',
    nodes: [
      { id: 'start', type: 'START', label: 'Question (Питання)', params: {} },
      // Т5.5 В3 (рішення власника §2 п.4): рішення Jev ходу — вузол процесу.
      {
        id: 'decide',
        type: 'JEV_DECISION_BUNDLE',
        label: 'Hero decision (Рішення героя, Jev)',
        params: {
          question: 'Що зробить герой у відповідь на питання автора: «{{input.question}}»?',
          questions: [
            { id: 'next_action', kind: 'choice', question: 'Яку дію з дозволеного списку обере персонаж у цій ситуації, зважаючи лише на наданий стан?', options: [...INTERVIEW_ACTIONS] },
            { id: 'fear_intensity', kind: 'score', question: 'Наскільки сильний страх персонажа в цій ситуації?', levels: ['спокій, страху немає', 'легке занепокоєння', 'помітний страх, але контроль', 'сильний страх, контроль слабне', 'паніка'] },
          ],
          threshold: 0,
          logging: true,
          // Jev і запасний LLM не змогли — вирішує автор (гілка review, §16 HUMAN_REVIEW).
          on_low: 'HUMAN_REVIEW',
        },
      },
      { id: 'memory', type: 'MEMORY', label: 'Hero snapshot (Знімок героя)', params: { scope: 'character' } },
      { id: 'context', type: 'CONTEXT', label: 'History & decision (Історія й рішення)', params: { context_policy: 'scene', max_tokens: 8000 } },
      { id: 'prompt', type: 'PROMPT', label: 'Voice template (Шаблон голосу)', params: { template: 'core:coreCharacterVoice' } },
      { id: 'llm', type: 'LLM', label: 'Voice model (Модель голосу)', params: { ...LLM_V1, cost_limit: 1 } },
      { id: 'validate', type: 'VALIDATOR', label: 'Reply schema (Схема відповіді)', params: { output_schema: CHARACTER_VOICE_SCHEMA as unknown as Record<string, unknown> } },
      { id: 'answer', type: 'PROPOSAL', label: 'Answer & proposals (Відповідь і пропозиції)', params: { target: 'text', min_confidence: 0 } },
      { id: 'end', type: 'END', label: 'Answered (Відповів)', params: {} },
      { id: 'end_invalid', type: 'END', label: 'Failed turn (Хід не вдався)', params: {} },
      { id: 'end_author', type: 'END', label: 'Author decides (Вирішує автор)', params: {} },
      { id: 'end_no_decision', type: 'END', label: 'No decision (Рішення не ухвалено)', params: {} },
    ],
    edges: [
      e('start', 'out', 'decide'), e('decide', 'out', 'memory'), e('decide', 'review', 'end_author'), e('decide', 'fallback', 'end_no_decision'), e('memory', 'out', 'context'), e('context', 'out', 'prompt'), e('prompt', 'out', 'llm'), e('llm', 'out', 'validate'),
      e('validate', 'valid', 'answer'), e('validate', 'invalid', 'end_invalid'), e('answer', 'out', 'end'),
    ],
  };
  return [
    aiRolePipeline({ id: 'ai1_mentions', en: 'AI-1: mentions in scene', uk: 'AI-1: згадки в сцені', description: 'Абзаци сцени → шаблон AI-1 → модель → схема й доказ → пропозиції згадок і зв\'язків (Т1.1).', module: 'coreAi1Classify', target: 'mention' }),
    aiRolePipeline({ id: 'ai2_profile', en: 'AI-2: character profile', uk: 'AI-2: профіль героя', description: 'Абзаци з героєм → шаблон AI-2 → модель → схема й доказ → факти профілю (Т1.5).', module: 'coreAi2Analysis', target: 'fact' }),
    aiRolePipeline({ id: 'ai2_memory', en: 'AI-2: hero memory in scene', uk: 'AI-2: пам\'ять героя в сцені', description: 'Сцена й пам\'ять героя → шаблон AI-2 → модель → схема й доказ → записи пам\'яті «запропоновано» (Т2.6).', module: 'coreAi2Analysis', target: 'memory', memory: true }),
    voice,
    semanticWorkflowDefinition(),
    adaptiveWorkflowDefinition(),
    causalityWorkflowDefinition(),
  ];
}

/** Створити й опублікувати v1 системних процесів, яких ще немає. Наявні — не чіпає. */
export async function ensureSystemWorkflows(repo: CoreRepository, log: (m: string) => void = () => {}): Promise<string[]> {
  const created: string[] = [];
  for (const def of systemWorkflowDefinitions()) {
    if (await repo.getWorkflow(def.id)) continue;
    const { draft } = await createWorkflow(repo, { id: def.id, name: def.name, description: def.description, actor: SEED_ACTOR });
    await saveDraft(repo, { workflowId: def.id, versionId: draft.id, definition: def, actor: SEED_ACTOR });
    const v = await validateVersion(repo, def.id, draft.id, SEED_ACTOR);
    if (!v.validation.ok) {
      log(`[workflows] «${def.id}» не пройшов перевірку — лишився чернеткою: ${v.validation.errors.map((x) => x.message).join('; ')}`);
      continue;
    }
    await promoteToTest(repo, def.id, draft.id, SEED_ACTOR);
    await publishVersion(repo, def.id, draft.id, SEED_ACTOR);
    created.push(def.id);
  }
  if (created.length) log(`[workflows] опубліковано v1 системних процесів: ${created.join(', ')}`);
  return created;
}

/**
 * Справжні моделі для прогону якості (Т2.8 В3) — ті самі шляхи, що в
 * Студії: голос героя — модуль «Ядра AI» `coreCharacterVoice` (шаблон і модель
 * адміна), запасний LLM рішень — модель модуля AI-2, Jev — ключ TypeSafe
 * платформи чи `TYPESAFE_API_KEY`. Суддя — Jev; без ключа — запасний LLM у
 * ролі судді (звіт так і пише: «суддя: llm_fallback»). Витрати пишуться в
 * `usage_log` на того, хто запустив, з `book_id` = набору.
 */

import { aiRoleGenerateViaCore, loadCoreAiRoleTemplate } from '../ai/generate';
import { resolveModuleModelId } from '../../coreModuleModels';
import { platformKeyFor } from '../../platformKeys';
import { GEMINI_MODEL, resolveTextEngine } from '../../aiCore';
import { priceForTextEngine, type TextEngine } from '../../pricing';
import { llmViaCore } from '../../ai/adapters/llm';
import { HttpJevAdapter, LlmFallbackJevAdapter, jevKeyFromEnv, jevModelFromEnv } from '../../ai/adapters/jev';
import type { QualityRunDeps } from './livingCharacters';

export const QUALITY_PROJECT_TAG = 'qa-living-characters';

export async function realQualityDeps(actor: string): Promise<{ deps: QualityRunDeps; models: Record<string, unknown> }> {
  const voiceModel = (await resolveModuleModelId('coreCharacterVoice')) || GEMINI_MODEL;
  const llmModel = (await resolveModuleModelId('coreAi2Analysis')) || GEMINI_MODEL;
  const key = (await platformKeyFor('typesafe').catch(() => undefined)) || jevKeyFromEnv();
  const jevModel = jevModelFromEnv();
  const jev = key ? new HttpJevAdapter(key, { model: jevModel }) : null;
  const llm = llmViaCore(aiRoleGenerateViaCore, async () => llmModel, QUALITY_PROJECT_TAG, actor);
  const deps: QualityRunDeps = {
    voice: async (system, user) => {
      const out = await aiRoleGenerateViaCore({ module: 'coreCharacterVoice', modelId: voiceModel, system, user, projectId: QUALITY_PROJECT_TAG, actor });
      return { text: out.text, modelId: out.modelId, inputTokens: out.inputTokens, outputTokens: out.outputTokens, costUsd: out.costUsd };
    },
    loadTemplate: () => loadCoreAiRoleTemplate('coreCharacterVoice'),
    jev,
    fallbackLlm: llm,
    judge: jev ?? new LlmFallbackJevAdapter(llm),
    priceLlm: (modelId, i, o) => priceForTextEngine(resolveTextEngine(modelId) as TextEngine, i, o, modelId),
    label: `справжні моделі: голос ${voiceModel}, рішення ${jev ? jevModel : `немає ключа Jev — ${llmModel}`}, суддя ${jev ? jevModel : llmModel}`,
  };
  return { deps, models: { voice: voiceModel, decisions: jev ? jevModel : null, fallbackLlm: llmModel, judge: jev ? jevModel : llmModel } };
}

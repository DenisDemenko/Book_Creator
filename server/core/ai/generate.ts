/**
 * Виклик моделі для ролей AI ядра через ядро ШІ Студії (Т0.9).
 *
 * Те саме, що роблять інші модулі (`resolveModuleModelId` → рушій за
 * моделлю → ключ платформи чи автора → `generateText`), але без HTTP-запиту
 * під рукою: роль може працювати у фоновій задачі. Тому «хто запустив»
 * передається явно (`actor`), і витрата в `usage_log` пишеться на цього
 * користувача з `book_id` = проєкт.
 */

import { GEMINI_MODEL, generateText, resolveTextEngine } from '../../aiCore';
import { resolveEngineKey } from '../../platformKeys';
import { priceForTextEngine } from '../../pricing';
import { findUserById } from '../../store';
import { getAppSetting } from '../../store';
import { CORE_PROMPT_TEMPLATES_META_KEY, resolveCoreTemplate, type CorePromptTemplateBundle } from '../../coreAiRegistry';
import type { AiGenerateInput, AiGenerateOutput } from './roles';
import type { CoreAiRoleModule } from './rolePrompts';

/**
 * Шаблон ролі з урахуванням правок адміна (вкладка «Ядро AI»). Схема відповіді
 * завжди заводська — `resolveCoreTemplate` дописує її поверх будь-якого
 * адмінського тексту.
 */
export async function loadCoreAiRoleTemplate(module: CoreAiRoleModule): Promise<{ system: string; user: string }> {
  let layer: CorePromptTemplateBundle | undefined;
  try {
    const raw = await getAppSetting(CORE_PROMPT_TEMPLATES_META_KEY);
    layer = raw ? (JSON.parse(raw) as CorePromptTemplateBundle) : undefined;
  } catch {
    layer = undefined;
  }
  return resolveCoreTemplate(module, layer);
}

export async function aiRoleGenerateViaCore(input: AiGenerateInput): Promise<AiGenerateOutput> {
  const modelId = input.modelId || GEMINI_MODEL;
  const engine = resolveTextEngine(modelId);
  const userId = input.actor.startsWith('user:') ? input.actor.slice(5) : null;
  const user = userId ? await findUserById(userId).catch(() => undefined) : null;
  const apiKeyOverride = await resolveEngineKey(userId, engine, `core:${input.module}`);
  // Рядок у usage_log бере особу з `req.principal` — даємо його без HTTP-запиту.
  const req = {
    principal: user
      ? { id: user.id, email: user.email, role: user.role, isGuest: false }
      : { id: null, email: 'system@core', role: 'system', isGuest: false },
  };
  const result = await generateText({
    engine,
    modelId,
    prompt: input.user,
    systemInstruction: input.system,
    json: true,
    apiKeyOverride,
    images: input.images?.map((i) => ({ mimeType: i.mimeType, dataBase64: i.data })),
    req,
    label: `core:${input.module}`,
    bookId: input.projectId,
  });
  return {
    text: result.text,
    modelId,
    engine,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: priceForTextEngine(engine, result.inputTokens, result.outputTokens, modelId),
  };
}

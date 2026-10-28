/**
 * Справжній текстовий прохід 2–3 «чернеток за фото» (A2): текстова модель ядра
 * AI. Окремий файл від маршрутів і від запису результату: маршрути й тести не
 * тягнуть за собою мережевих провайдерів.
 *
 * ОПЛАТА — ТАРИФ ВИКЛАДАЧА (рішення власника 28.10.2026): generateText сам
 * перевіряє грошовий ліміт текстового ШІ автора (checkChatQuota) і записує
 * витрату на нього, бо `req.principal` — викладач, якому належить токен.
 */

import { GEMINI_MODEL, generateText } from '../aiCore';
import { engineConfigured, resolveEngine, ENGINE_ENV_KEY } from '../chatProviders';
import { resolveEngineKey } from '../platformKeys';
import { resolveModuleModelId } from '../coreModuleModels';
import type { WriteTextParams } from './photoDraftRoutes';

export async function writeWithCoreText(p: WriteTextParams): Promise<{ text: string; modelId: string }> {
  // Модуль «Розгортання інструкції» — звичайна текстова модель, яку обирає адмін;
  // власної прив'язки проходи GrabFusion не мають, доки не з'ясується, що потрібна.
  const modelId = (await resolveModuleModelId('instructionElaboration')) || GEMINI_MODEL;
  const engine = resolveEngine(modelId);
  const userKey = await resolveEngineKey(p.ownerId, engine, 'photo-draft');
  if (!userKey && !engineConfigured(engine)) {
    throw new Error(`Модель не налаштована: потрібен ${ENGINE_ENV_KEY[engine]} на сервері або власний ключ автора.`);
  }
  const result = await generateText({
    engine,
    modelId,
    prompt: p.prompt,
    systemInstruction: p.system,
    apiKeyOverride: userKey,
    json: true,
    generation: { temperature: 0.4, maxTokens: p.maxTokens, timeoutMs: 170_000 },
    req: p.req,
    label: p.label,
  });
  return { text: result.text, modelId };
}

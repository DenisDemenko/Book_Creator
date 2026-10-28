/**
 * Справжній прохід 1 — модель зору ядра AI, як у сканах WriterScan
 * (scanRecognizer.ts): модель модуля «Текст за фото», той самий вибір ключа
 * (resolveEngineKey) і те саме логування витрат.
 *
 * ОПЛАТА — ТАРИФ ВИКЛАДАЧА (рішення власника 28.10.2026). generateText сам
 * перевіряє грошовий ліміт текстового ШІ автора (checkChatQuota) і записує
 * витрату на нього, бо `req.principal` — це викладач, якому належить токен.
 *
 * Окремий файл від маршрутів: маршрути тестуються з підставним описом і не
 * тягнуть за собою мережевих провайдерів.
 */

import { GEMINI_MODEL, generateText } from '../aiCore';
import { engineConfigured, modelSupportsVision, resolveEngine, ENGINE_ENV_KEY } from '../chatProviders';
import { resolveEngineKey } from '../platformKeys';
import { resolveModuleModelId } from '../coreModuleModels';
import { buildDescribePrompt, describeSystemInstruction, parseDescribeResult } from './photoDraftPrompts';
import type { DescribePhotoParams } from './photoDraftRoutes';

export async function describePhotoWithCoreVision(
  p: DescribePhotoParams
): Promise<{ description: string; tags: string[]; modelId: string }> {
  const modelId = (await resolveModuleModelId('textFromImage')) || GEMINI_MODEL;
  if (!modelSupportsVision(modelId)) {
    throw new Error(`Модель «${modelId}», привʼязана до модуля «Текст за фото», не бачить зображень — оберіть модель із зором в «Ядрі AI».`);
  }
  const engine = resolveEngine(modelId);
  const userKey = await resolveEngineKey(p.ownerId, engine, 'photo-draft');
  if (!userKey && !engineConfigured(engine)) {
    throw new Error(`Модель не налаштована: потрібен ${ENGINE_ENV_KEY[engine]} на сервері або власний ключ автора.`);
  }
  const result = await generateText({
    engine,
    modelId,
    prompt: buildDescribePrompt(p.context),
    systemInstruction: describeSystemInstruction(),
    apiKeyOverride: userKey,
    images: [{ mimeType: p.mimeType, dataBase64: p.base64 }],
    req: p.req,
    label: 'Опис кадру (GrabFusion)',
  });
  return { ...parseDescribeResult(result.text), modelId };
}

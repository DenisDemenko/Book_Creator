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

import { GEMINI_MODEL } from '../aiCore';
import { resolveModuleModelId } from '../coreModuleModels';
import { buildDescribePrompt, describeSystemInstruction, parseDescribeResult } from './photoDraftPrompts';
import { generateVisionWithFailover } from './visionFailover';
import type { DescribePhotoParams } from './photoDraftRoutes';

export async function describePhotoWithCoreVision(
  p: DescribePhotoParams
): Promise<{ description: string; tags: string[]; modelId: string }> {
  // Ліміт часу й запасні моделі — у visionFailover.ts (той самий збій, що й у розпізнаванні сторінок).
  const result = await generateVisionWithFailover({
    primaryModelId: (await resolveModuleModelId('textFromImage')) || GEMINI_MODEL,
    ownerId: p.ownerId,
    keyLabel: 'photo-draft',
    params: {
      prompt: buildDescribePrompt(p.context),
      systemInstruction: describeSystemInstruction(),
      images: [{ mimeType: p.mimeType, dataBase64: p.base64 }],
      req: p.req,
      label: `Опис кадру (GrabFusion) ${p.draftId}`,
    },
  });
  return { ...parseDescribeResult(result.text), modelId: result.modelId };
}

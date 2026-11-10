/**
 * Справжній прохід 1 — модель зору ядра AI, як у сканах WriterScan
 * (scanRecognizer.ts): модель модуля «Текст за фото», той самий вибір ключа
 * (resolveEngineKey) і те саме логування витрат.
 *
 * ОПЛАТА. З журналу #538 (рішення власника 09.11.2026 про єдиний облік) — БАЛАМИ, як проходи 2–3:
 * visionBilling.runBilledVision резервує бали, після відповіді списує фактичне. Де бали не діють
 * (адмін, облік вимкнено, ціни моделі не звірено, `PHOTO_DRAFT_PASS1_CREDITS=off`) — як було до
 * 1.4.0 (рішення 28.10.2026): generateText сам перевіряє грошовий ліміт текстового ШІ автора
 * (checkChatQuota) і записує витрату на нього, бо `req.principal` — викладач, якому належить токен.
 *
 * Окремий файл від маршрутів: маршрути тестуються з підставним описом і не
 * тягнуть за собою мережевих провайдерів.
 */

import { GEMINI_MODEL } from '../aiCore';
import { resolveModuleModelId } from '../coreModuleModels';
import { buildDescribePrompt, describeSystemInstruction, parseDescribeResult } from './photoDraftPrompts';
import { creditBilledLabel } from '../creditBilledContext';
import { generateVisionWithFailover } from './visionFailover';
import { runBilledVision } from './visionBilling';
import type { DescribePhotoParams } from './photoDraftRoutes';

export async function describePhotoWithCoreVision(
  p: DescribePhotoParams
): Promise<{ description: string; tags: string[]; modelId: string }> {
  // Ліміт часу й запасні моделі — у visionFailover.ts (той самий збій, що й у розпізнаванні сторінок).
  const label = `Опис кадру (GrabFusion) ${p.draftId}`;
  const result = await runBilledVision({
    req: p.req,
    kind: 'describe',
    run: async (billed) =>
      generateVisionWithFailover({
        primaryModelId: (await resolveModuleModelId('textFromImage')) || GEMINI_MODEL,
        ownerId: p.ownerId,
        keyLabel: 'photo-draft',
        params: {
          prompt: buildDescribePrompt(p.context),
          systemInstruction: describeSystemInstruction(),
          images: [{ mimeType: p.mimeType, dataBase64: p.base64 }],
          req: p.req,
          // Оплачено балами — грошовий ліміт не питаємо, запис журналу витрат позначаємо, токени міркування рахуємо.
          ...(billed ? { skipBudgetCheck: true, countThinkingTokens: true } : {}),
          label: billed ? creditBilledLabel(label) : label,
        },
      }),
  });
  return { ...parseDescribeResult(result.text), modelId: result.modelId };
}

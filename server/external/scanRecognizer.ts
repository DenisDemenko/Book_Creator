/**
 * Справжнє розпізнавання скану — модель зору ядра AI.
 *
 * Рішення власника: не підключати окремий Google Cloud Vision (новий
 * сервісний акаунт, платіжний профіль і секрет — ще один вузол відмови), а
 * взяти те, що вже працює в «Описати ШІ» (#222/#223): модель, привʼязану
 * адміністратором до модуля «Текст за фото» в «Ядрі AI», з тим самим
 * вибором ключа (власний ключ автора → платформний → серверний) і тим самим
 * логуванням витрат. Відрізняється лише промпт: дослівний OCR замість сцени.
 *
 * Ліміт часу й запасні моделі — у visionFailover.ts: без них мовчазна модель
 * тримала сторінку по 5 хвилин (заміри 09.11.2026 — там само).
 *
 * Окремий файл від маршрутів: маршрути тестуються з підставним
 * розпізнаванням, і їм не треба тягнути за собою мережеві провайдери.
 */

import { GEMINI_MODEL } from '../aiCore';
import { resolveModuleModelId } from '../coreModuleModels';
import { buildScanOcrPrompt, scanOcrSystemInstruction } from './scanOcrPrompt';
import { generateVisionWithFailover } from './visionFailover';
import type { RecognizeParams } from './externalApiRoutes';

export async function recognizeScanWithCoreVision(p: RecognizeParams): Promise<{ text: string; modelId: string }> {
  return generateVisionWithFailover({
    primaryModelId: (await resolveModuleModelId('textFromImage')) || GEMINI_MODEL,
    ownerId: p.ownerId,
    keyLabel: 'scan-ocr',
    params: {
      prompt: buildScanOcrPrompt({ languageHint: 'uk', note: p.note }),
      systemInstruction: scanOcrSystemInstruction(),
      images: [{ mimeType: p.mimeType, dataBase64: p.base64 }],
      req: p.req,
      label: p.draftId ? `Сторінка рукопису (GrabFusion) ${p.draftId}` : 'Скан сторінки з телефону (WriterScan)',
      bookId: p.bookId || undefined,
    },
  });
}

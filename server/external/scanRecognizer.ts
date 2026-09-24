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
 * Окремий файл від маршрутів: маршрути тестуються з підставним
 * розпізнаванням, і їм не треба тягнути за собою мережеві провайдери.
 */

import { GEMINI_MODEL, generateText } from '../aiCore';
import { engineConfigured, modelSupportsVision, resolveEngine, ENGINE_ENV_KEY } from '../chatProviders';
import { resolveEngineKey } from '../platformKeys';
import { resolveModuleModelId } from '../coreModuleModels';
import { buildScanOcrPrompt, scanOcrSystemInstruction } from './scanOcrPrompt';
import type { RecognizeParams } from './externalApiRoutes';

export async function recognizeScanWithCoreVision(p: RecognizeParams): Promise<{ text: string; modelId: string }> {
  const modelId = (await resolveModuleModelId('textFromImage')) || GEMINI_MODEL;
  if (!modelSupportsVision(modelId)) {
    throw new Error(
      `Модель «${modelId}», привʼязана до модуля «Текст за фото», не бачить зображень — оберіть модель із зором в «Ядрі AI».`
    );
  }
  const engine = resolveEngine(modelId);
  const userKey = await resolveEngineKey(p.ownerId, engine, 'scan-ocr');
  if (!userKey && !engineConfigured(engine)) {
    throw new Error(`Модель не налаштована: потрібен ${ENGINE_ENV_KEY[engine]} на сервері або власний ключ автора.`);
  }
  const result = await generateText({
    engine,
    modelId,
    prompt: buildScanOcrPrompt({ languageHint: 'uk' }),
    systemInstruction: scanOcrSystemInstruction(),
    apiKeyOverride: userKey,
    images: [{ mimeType: p.mimeType, dataBase64: p.base64 }],
    req: p.req,
    label: 'Скан сторінки з телефону (WriterScan)',
    bookId: p.bookId,
  });
  return { text: result.text, modelId };
}

/**
 * Справжній запис результату відправки й справжній текстовий прохід (A2).
 * Маршрути (photoDraftRoutes.ts) тестуються з підставними реалізаціями цих
 * інтерфейсів і не тягнуть ні базу курсів, ні мережевих провайдерів.
 */

import { GEMINI_MODEL, generateText } from '../aiCore';
import { engineConfigured, resolveEngine, ENGINE_ENV_KEY } from '../chatProviders';
import { resolveEngineKey } from '../platformKeys';
import { resolveModuleModelId } from '../coreModuleModels';
import { createCourse } from '../courseStore';
import { createDraft as createExpressDraft } from '../expressStore';
import { listUsageSince } from '../store';
import { createScan, updateScan } from './externalApiStore';
import type { CourseInput, InboxItem } from './photoDraftMapping';
import type { WriteTextParams } from './photoDraftRoutes';

export async function writeWithCoreText(p: WriteTextParams): Promise<{ text: string; modelId: string }> {
  // Модуль «Розгортання інструкції» — звичайна текстова модель адміна; своєї
  // прив'язки проходи GrabFusion не мають, доки не з'ясується, що потрібна.
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

/**
 * Скільки ШІ коштувала чернетка: записи журналу витрат викладача, у підписі яких
 * є id чернетки (описи кадрів і проходи 2–3). Не вдалося прочитати — `null`:
 * відправку це не блокує.
 */
export async function aiUsageForDraft(p: { ownerId: string; draftId: string; since: string }): Promise<{ calls: number; costUsd: number } | null> {
  try {
    const rows = (await listUsageSince(p.since)).filter((r) => r.userId === p.ownerId && typeof r.context === 'string' && r.context.includes(p.draftId));
    const costUsd = Math.round(rows.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0) * 10_000) / 10_000;
    return { calls: rows.length, costUsd };
  } catch {
    return null;
  }
}

export async function createCourseDraft(ownerId: string, input: CourseInput): Promise<string> {
  return createCourse(ownerId, input).id;
}

export async function createExpressInstruction(ownerId: string, payload: Record<string, unknown>): Promise<string> {
  return createExpressDraft(ownerId, payload as any).id;
}

/**
 * По одному запису у «Вхідних» на урок (або на сторінку рукопису); повертає id першого
 * (на нього веде посилання). З `batch` записи складають пакет: порядок = порядок `items`,
 * `bookId` може бути порожнім (нова книга без запису на сервері).
 */
export async function createInboxScans(p: {
  ownerId: string;
  bookId: string;
  items: InboxItem[];
  tokenId?: string | null;
  batch?: { id: string; bookTitle?: string | null };
}): Promise<string> {
  let first = '';
  let order = 0;
  for (const item of p.items) {
    order += 1;
    const scan = await createScan({
      ownerId: p.ownerId,
      bookId: p.bookId,
      assetId: item.assetId,
      imageUrl: item.imageUrl,
      tokenId: p.tokenId ?? null,
      ...(p.batch ? { batch: { id: p.batch.id, order, bookTitle: p.batch.bookTitle ?? null } } : {}),
    });
    await updateScan(scan.id, p.ownerId, {
      status: 'submitted',
      recognizedText: item.text,
      text: item.text,
      chapterTitle: item.chapterTitle,
      sectionTitle: item.sectionTitle,
      modelId: 'grabfusion',
    });
    if (!first) first = scan.id;
  }
  return first;
}

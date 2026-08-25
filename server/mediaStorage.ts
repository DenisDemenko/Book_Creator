/**
 * Ліміт сховища фотоальбому (завантажені з компʼютера jpg/png/svg +
 * згенеровані зображення користувача) — на відміну від checkImageQuota
 * (server/subscriptions.ts) це НЕ лічильник за період підписки, а загальний
 * («lifetime») обсяг, порахований сумарно для облікового запису — тобто
 * загалом для всіх книг автора, а не окремо на кожну книгу.
 *
 * Реалізовано через той самий журнал usage_log (kind='storage', поле bytes),
 * що й лічильник генерацій зображень — жодного видалення при видаленні
 * фото з альбому не передбачено (так само, як imageQuota не звільняється
 * при видаленні згенерованої ілюстрації): це свідоме спрощення, узгоджене
 * з уже наявною в проєкті філософією тарифних лічильників.
 */

import { PLANS, resolveSubscription, type PlanId } from './subscriptions';
import { recordUsage, totalStorageBytesForUser, type StoredRole } from './store';

export interface StorageQuotaResult {
  allowed: boolean;
  plan: PlanId;
  usedBytes: number;
  quotaBytes: number | null;
  remainingBytes: number | null;
  reasonUk?: string;
}

const MB = 1024 * 1024;

/** Поточний стан використання сховища — без запису нового факту завантаження. */
export async function getStorageUsage(userId: string, role: StoredRole): Promise<StorageQuotaResult> {
  if (role === 'admin') {
    return { allowed: true, plan: 'ultra', usedBytes: 0, quotaBytes: null, remainingBytes: null };
  }
  const sub = await resolveSubscription(userId);
  const plan = (PLANS[sub.plan as PlanId] ? sub.plan : 'free') as PlanId;
  const def = PLANS[plan];
  const quotaBytes = def.storageQuotaMb * MB;
  const usedBytes = await totalStorageBytesForUser(userId);
  const remainingBytes = Math.max(0, quotaBytes - usedBytes);
  return { allowed: usedBytes < quotaBytes, plan, usedBytes, quotaBytes, remainingBytes };
}

/**
 * Перевіряє, чи вміститься файл розміром `bytes` у залишок ліміту, і якщо
 * так — одразу записує факт завантаження (атомарно щодо конкретного
 * запиту; паралельні запити того самого користувача теоретично можуть
 * проскочити разом, як і в checkImageQuota — прийнятний компроміс без
 * блокувань для застосунку такого масштабу).
 */
export async function checkAndRecordStorageUpload(
  userId: string,
  userEmail: string,
  role: StoredRole,
  bytes: number,
  bookId: string | undefined,
  fileName: string
): Promise<StorageQuotaResult> {
  if (role === 'admin') {
    return { allowed: true, plan: 'ultra', usedBytes: 0, quotaBytes: null, remainingBytes: null };
  }

  const sub = await resolveSubscription(userId);
  const plan = (PLANS[sub.plan as PlanId] ? sub.plan : 'free') as PlanId;
  const def = PLANS[plan];
  const quotaBytes = def.storageQuotaMb * MB;
  const usedBytes = await totalStorageBytesForUser(userId);

  if (usedBytes + bytes > quotaBytes) {
    const remainingMb = Math.max(0, (quotaBytes - usedBytes) / MB).toFixed(1);
    return {
      allowed: false,
      plan,
      usedBytes,
      quotaBytes,
      remainingBytes: Math.max(0, quotaBytes - usedBytes),
      reasonUk: `Перевищено ліміт фотоальбому тарифу ${def.nameUk} (${def.storageQuotaMb} МБ). Залишилось: ${remainingMb} МБ. Оберіть вищий тариф на сторінці «Підписка» або звільніть місце.`,
    };
  }

  await recordUsage({
    id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    userId,
    userEmail,
    role,
    kind: 'storage',
    engineId: 'upload',
    modelId: 'media-library',
    context: fileName,
    bookId,
    success: true,
    bytes,
    costUsd: 0,
  });

  const newUsed = usedBytes + bytes;
  return {
    allowed: true,
    plan,
    usedBytes: newUsed,
    quotaBytes,
    remainingBytes: Math.max(0, quotaBytes - newUsed),
  };
}

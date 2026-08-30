/**
 * Вибір моделі для експрес-майстра (Wisart Book Crealiry.md §3.4).
 *
 * Майстер спершу ходив жорстко в Gemini через `generateWithGemini`. На
 * практиці це означало, що він не працює ні в кого, крім власника
 * серверного ключа Gemini — тоді як у користувача вже можуть бути власні
 * ключі OpenAI, Claude чи DeepSeek у розділі «Ключі API».
 *
 * Тут майстер отримує ту саму багатопровайдерність, що й чат: спершу
 * береться власний ключ користувача, і лише як запасний варіант —
 * серверний env-ключ.
 *
 * Порядок автовибору не випадковий: спершу ті рушії, які мають апаратну
 * опору для структурованого JSON (`response_format` в OpenAI-сумісних,
 * assistant-prefill у Claude), бо весь майстер тримається на тому, що
 * модель повертає розбірний JSON.
 */

import { getUserApiKey } from './store';
import { decryptApiKey, isApiKeyCryptoConfigured } from './userApiKeyCrypto';
import {
  CHAT_MODELS,
  ENGINE_ENV_KEY,
  engineConfigured,
  type EngineId,
} from './chatProviders';

/** Рушії, придатні для майстра, у порядку переваги. */
const PREFERRED: readonly EngineId[] = ['gpt', 'claude', 'gemini', 'deepseek', 'mistral', 'groq'];

export interface EngineChoice {
  engine: EngineId;
  modelId: string;
  /** Розшифрований ключ користувача; undefined — працюємо на серверному. */
  apiKeyOverride?: string;
  /** Звідки взявся ключ — потрібне для діагностики в UI. */
  source: 'user' | 'server';
}

/** Перша модель рушія зі списку, що показується в селекторі чату. */
function defaultModelFor(engine: EngineId): string {
  return CHAT_MODELS.find((m) => m.engine === engine)?.id ?? '';
}

/**
 * Чи має користувач власний придатний ключ для рушія. Значення ключа
 * назовні не віддається — лише сюди, у виклик провайдера.
 */
async function userKeyFor(userId: string | null, engine: EngineId): Promise<string | undefined> {
  if (!userId || !isApiKeyCryptoConfigured()) return undefined;
  try {
    const stored = await getUserApiKey(userId, engine);
    if (!stored?.encryptedKey) return undefined;
    const plain = decryptApiKey(stored.encryptedKey).trim();
    return plain || undefined;
  } catch {
    // Пошкоджений або нерозшифровуваний ключ не має валити майстер —
    // просто вважаємо, що власного ключа немає.
    return undefined;
  }
}

/**
 * Обирає рушій для кроку майстра.
 *
 * @param requested — явний вибір користувача в UI майстра; якщо рушій
 *   недоступний, автовибір усе одно знайде робочий, замість того щоб
 *   зупинити майстер посеред кроку.
 */
export async function resolveEngineForWizard(
  userId: string | null,
  requested?: string
): Promise<EngineChoice | null> {
  const order: EngineId[] = [];
  if (requested && (PREFERRED as readonly string[]).includes(requested)) {
    order.push(requested as EngineId);
  }
  for (const e of PREFERRED) if (!order.includes(e)) order.push(e);

  for (const engine of order) {
    const key = await userKeyFor(userId, engine);
    if (key) {
      return { engine, modelId: defaultModelFor(engine), apiKeyOverride: key, source: 'user' };
    }
    if (engineConfigured(engine)) {
      return { engine, modelId: defaultModelFor(engine), source: 'server' };
    }
  }

  return null;
}

/** Що показати, коли жодного ключа немає — з переліком змінних оточення. */
export function noEngineMessage(): string {
  const names = PREFERRED.map((e) => ENGINE_ENV_KEY[e]).join(', ');
  return `Немає жодного налаштованого рушія ШІ. Додайте власний ключ у розділі «Ключі API» або задайте на сервері одну зі змінних: ${names}.`;
}

/** Перелік рушіїв для селектора в UI майстра. */
export async function availableEngines(
  userId: string | null
): Promise<Array<{ engine: EngineId; modelId: string; source: 'user' | 'server' }>> {
  const out: Array<{ engine: EngineId; modelId: string; source: 'user' | 'server' }> = [];
  for (const engine of PREFERRED) {
    const key = await userKeyFor(userId, engine);
    if (key) {
      out.push({ engine, modelId: defaultModelFor(engine), source: 'user' });
    } else if (engineConfigured(engine)) {
      out.push({ engine, modelId: defaultModelFor(engine), source: 'server' });
    }
  }
  return out;
}

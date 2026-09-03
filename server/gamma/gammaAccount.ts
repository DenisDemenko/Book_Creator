/**
 * Чия підписка Gamma працює: автора чи власника студії.
 *
 * ЧОМУ ЦЕ ВЗАГАЛІ ПИТАННЯ. Перша версія інтеграції ходила в Gamma одним
 * ключем із `.env` — тобто кожна генерація будь-якого автора списувала
 * кредити з рахунку ВЛАСНИКА. При ста авторах це не масштабується ніяк:
 * баланс вичерпується за вечір, і функція починає падати рівно тоді, коли
 * нею почали користуватись.
 *
 * ЧЕСНА СХЕМА (за вказівкою власника 03.09.2026): автор підключає ВЛАСНУ
 * підписку Gamma й платить за себе. Студія лише робить роботу — складає
 * запит із книги, веде облік і показує результат.
 *
 * ПРО «ЛОГІН». Gamma не має OAuth для API: доступ дається ключем із
 * кабінету (Settings → API). Тому «увійти» тут означає вставити свій ключ
 * один раз — і назвати це треба саме так, а не малювати кнопку «Увійти
 * через Gamma», якої не існує.
 *
 * КЛЮЧ ВЛАСНИКА НЕ ПІДМІНЯЄ КЛЮЧ АВТОРА. Якщо в автора свого ключа немає,
 * генерація НЕ падає мовчки на серверний ключ: це списало б чужі гроші без
 * відома обох сторін. Серверний ключ лишається лише для адміністратора —
 * тобто для того, чий рахунок і є.
 */

import { getUserApiKey } from '../store';
import { decryptApiKey, isApiKeyCryptoConfigured } from '../userApiKeyCrypto';
import { GAMMA_KEY_ENGINE, readGammaConfig } from './gammaConfig';

export type GammaKeyOwner = 'author' | 'studio' | 'none';

export interface ResolvedGammaKey {
  apiKey: string | null;
  owner: GammaKeyOwner;
  /** Чому ключа немає — текст для автора, а не код. */
  reasonUk?: string;
}

/**
 * Знаходить ключ для цього запиту.
 *
 * Порядок навмисний: спершу власний ключ автора, і лише потім — серверний,
 * та й то тільки для адміністратора.
 */
export async function resolveGammaKey(params: {
  userId?: string | null;
  role?: string | null;
}): Promise<ResolvedGammaKey> {
  const userId = params.userId ? String(params.userId) : '';

  if (userId && isApiKeyCryptoConfigured()) {
    try {
      const stored = await getUserApiKey(userId, GAMMA_KEY_ENGINE);
      if (stored?.encryptedKey) {
        const plain = decryptApiKey(stored.encryptedKey).trim();
        if (plain) return { apiKey: plain, owner: 'author' };
      }
    } catch {
      // Пошкоджений або нерозшифровуваний ключ — це стан налаштувань
      // автора, а не збій сервера: падаємо нижче до пояснення.
    }
  }

  const cfg = readGammaConfig();
  if (cfg.configured && params.role === 'admin') {
    return { apiKey: cfg.apiKey, owner: 'studio' };
  }

  return {
    apiKey: null,
    owner: 'none',
    reasonUk: cfg.configured
      ? 'Підключіть власну підписку Gamma: у кабінеті Gamma відкрийте Settings → API, ' +
        'створіть ключ і вставте його тут. Генерація списує кредити з ВАШОГО рахунку — ' +
        'ключ студії для цього не використовується.'
      : 'Підключіть власну підписку Gamma: у кабінеті Gamma відкрийте Settings → API, ' +
        'створіть ключ і вставте його тут. Потрібен тариф Pro, Ultra, Teams або Business — ' +
        'на безкоштовному API-доступу немає.',
  };
}

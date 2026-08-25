/**
 * Конфігурація інтеграції з Etsy Open API v3.
 *
 * Усі значення читаються з середовища й ніде більше не дублюються. Принцип
 * той самий, що вже діє в проєкті для AI-ключів: **відсутність ключа — це
 * стан конфігурації, а не помилка**. Без ETSY_API_KEY модуль публікації
 * показує зрозуміле повідомлення й лишається клікабельним, а не валить
 * сервер і не ламає решту сайту.
 */

export const ETSY_API_BASE = process.env.ETSY_API_BASE || 'https://openapi.etsy.com/v3';
export const ETSY_OAUTH_CONNECT_URL =
  process.env.ETSY_OAUTH_CONNECT_URL || 'https://www.etsy.com/oauth/connect';
export const ETSY_TOKEN_URL =
  process.env.ETSY_TOKEN_URL || 'https://api.etsy.com/v3/public/oauth/token';

/**
 * Скоупи. Рівно ті, що потрібні для «створити й опублікувати цифровий
 * лістинг», і жодного зайвого: зайвий скоуп — це зайва причина для автора
 * не натиснути «Дозволити» на екрані Etsy.
 */
export const ETSY_SCOPES = ['listings_r', 'listings_w', 'listings_d', 'shops_r', 'shops_w'];

export interface EtsyConfig {
  apiKey: string;
  sharedSecret: string;
  /** Явний redirect URI; якщо не заданий — збирається з APP_URL. */
  redirectUri: string;
  configured: boolean;
  /** Причина, чому інтеграція вимкнена — показуємо автору як є. */
  reasonUk?: string;
}

export function readEtsyConfig(appUrl?: string): EtsyConfig {
  const apiKey = process.env.ETSY_API_KEY || process.env.ETSY_KEYSTRING || '';
  const sharedSecret = process.env.ETSY_SHARED_SECRET || '';
  const base = (process.env.APP_URL || appUrl || '').replace(/\/+$/, '');
  const redirectUri = process.env.ETSY_REDIRECT_URI || (base ? `${base}/api/etsy/oauth/callback` : '');

  const missing: string[] = [];
  if (!apiKey) missing.push('ETSY_API_KEY');
  if (!sharedSecret) missing.push('ETSY_SHARED_SECRET');
  if (!redirectUri) missing.push('ETSY_REDIRECT_URI або APP_URL');

  return {
    apiKey,
    sharedSecret,
    redirectUri,
    configured: missing.length === 0,
    reasonUk: missing.length
      ? `Інтеграцію з Etsy не налаштовано: бракує ${missing.join(', ')}. Додайте ключі у файл .env — решта модуля публікації працює й без них (генерація файлів під KDP, пакувальник набору).`
      : undefined,
  };
}

/**
 * Ліміт швидкості Etsy — 10 запитів/секунду на застосунок (ТЗ 4.1).
 * Тримаємо трохи нижче стелі: кілька одночасних авторів не мають штовхати
 * одне одного в 429.
 */
export const ETSY_RATE_LIMIT_PER_SECOND = Number(process.env.ETSY_RATE_LIMIT_PER_SECOND || 8);

/** Скільки часу тримати результат дослідження теми (ТЗ 6.3: 24–72 год). */
export const RESEARCH_CACHE_HOURS = Number(process.env.ETSY_RESEARCH_CACHE_HOURS || 24);

/** Як часто планувальник оновлює вже досліджені теми. 0 — вимкнути. */
export const RESEARCH_REFRESH_INTERVAL_MINUTES = Number(
  process.env.ETSY_RESEARCH_REFRESH_MINUTES || 0
);

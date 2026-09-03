/**
 * Конфігурація інтеграції з Gamma Generate API.
 *
 * Той самий принцип, що вже діє для Etsy й AI-ключів: **відсутність ключа —
 * це стан конфігурації, а не помилка**. Без GAMMA_API_KEY маршрути
 * відповідають зрозумілим 503 із поясненням, а решта Студії працює.
 *
 * ЩО САМЕ ДОСТУПНЕ ЧЕРЕЗ API, А ЩО НІ (перевірено по документації 03.09.2026).
 * Публічний API вміє: генерацію документів, презентацій, лендінгів і
 * соцпостів (`POST /generations`), генерацію з шаблону, статус, теми, теки,
 * експорт у pdf/pptx/png та архівування.
 *
 * Окремої генерації ЗОБРАЖЕННЯ в публічному API **немає** — вона існує лише
 * в MCP-конекторі. Тому арт обкладинки книги цим шляхом зробити не можна:
 * картинки народжуються тільки всередині генерації (`imageOptions`). Це не
 * недоробка інтеграції, а межа самого API, і краще знати про неї тут, ніж
 * шукати причину в коді.
 *
 * Доступ до API потребує тарифу Pro, Ultra, Teams або Business на боці
 * Gamma — тобто ключ може бути валідним, а виклик усе одно відмовить.
 */

export const GAMMA_API_BASE = process.env.GAMMA_API_BASE || 'https://public-api.gamma.app/v1.0';

export interface GammaConfig {
  apiKey: string;
  configured: boolean;
  reasonUk?: string;
}

export function readGammaConfig(): GammaConfig {
  const apiKey = (process.env.GAMMA_API_KEY || '').trim();
  return {
    apiKey,
    configured: Boolean(apiKey),
    reasonUk: apiKey
      ? undefined
      : 'Інтеграцію з Gamma не налаштовано: у .env сервера немає GAMMA_API_KEY. ' +
        'Ключ видається в кабінеті Gamma і потребує тарифу Pro, Ultra, Teams або Business.',
  };
}

/**
 * Ліміт швидкості. Документованих обмежень Gamma не публікує, тож беремо
 * свідомо скромне значення: генерація й так триває 1–3 хвилини, і бити в
 * API частіше немає сенсу — а от вичерпати невідому квоту легко.
 */
export const GAMMA_RATE_LIMIT_PER_SECOND = Number(process.env.GAMMA_RATE_LIMIT_PER_SECOND || 2);

/** Як часто опитувати статус. Документація радить 5 секунд. */
export const GAMMA_POLL_INTERVAL_MS = Number(process.env.GAMMA_POLL_INTERVAL_MS || 5000);

/**
 * Скільки чекати на генерацію, перш ніж вважати її загубленою.
 * Типова триває 1–3 хвилини; десять — це вже точно щось не так, і тримати
 * задачу «в роботі» вічно означало б показувати авторові вічний спінер.
 */
export const GAMMA_MAX_WAIT_MS = Number(process.env.GAMMA_MAX_WAIT_MS || 10 * 60 * 1000);

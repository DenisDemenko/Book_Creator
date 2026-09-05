/**
 * Публічна адреса самої Студії — та, за якою її бачить СТОРОННІЙ браузер.
 *
 * Знадобилась вона рівно в одному місці й з однієї причини: у картку
 * маркетплейсу ми кладемо посилання на обкладинку, і відкриває його
 * покупець, а не ми. Тобто адреса має бути не «звідки я запускаю сервер»,
 * а «куди зміг би прийти хтось інший».
 *
 * Чому не просто `APP_URL`. Він у нас заданий як
 * `http://bookcreator-production-7304.up.railway.app` — без TLS і не
 * брендованим доменом. Http-посилання на https-сторінці браузер або тихо
 * підвищить, або заблокує як змішаний вміст: залежить від браузера, і
 * саме тому такі речі помічають не в себе, а в покупця.
 *
 * Тому за основу береться сам запит: за яким доменом до нас прийшли, той і
 * публічний. За зворотним проксі (Railway, і будь-який інший) справжні
 * значення лежать у `x-forwarded-*`, бо до Node доїжджає вже внутрішнє
 * зʼєднання.
 */

/** Мінімум, який нам потрібен від запиту — щоб це можна було тестувати без Express. */
export interface OriginRequestLike {
  protocol?: string;
  get(name: string): string | undefined;
}

/** Перше значення зі списку через кому: проксі можуть накопичувати ланцюг. */
function firstValue(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  return first || undefined;
}

/** Локальна розробка — єдиний випадок, де http доречний і https зламав би роботу. */
export function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || name === '[::1]';
}

/**
 * Зібрати публічну адресу з запиту, з відкотом на `APP_URL`.
 *
 * Поза локальною розробкою схема примусово https — навіть якщо проксі
 * сказав інакше. Це свідомо: посилання, яке ми віддаємо назовні, має
 * відкриватись у чужому браузері, а не відповідати тому, як до нас
 * достукались усередині мережі.
 */
export function publicOriginFrom(req: OriginRequestLike, appUrl = process.env.APP_URL): string {
  const host = firstValue(req.get('x-forwarded-host')) || firstValue(req.get('host'));

  if (host) {
    const proto = firstValue(req.get('x-forwarded-proto')) || req.protocol || 'https';
    const scheme = isLocalHost(host) ? proto : 'https';
    return `${scheme}://${host}`;
  }

  // Запит без Host — практично лише у внутрішніх викликах. Тоді лишається
  // налаштування, але й його доводимо до https з тієї самої причини.
  const fallback = (appUrl || '').replace(/\/+$/, '');
  if (!fallback) return '';
  const withoutScheme = fallback.replace(/^https?:\/\//i, '');
  return isLocalHost(withoutScheme) ? fallback : `https://${withoutScheme}`;
}

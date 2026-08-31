/**
 * Ідентифікація сесії автора: який це браузер і який пристрій.
 *
 * Навіщо. Одна людина відкриває книгу на ноутбуці й на робочому компʼютері —
 * або просто у двох браузерах. Доти обидві сесії виглядали однаково («Денис
 * Деменко»), а `clientId` вигадувався наново при кожному завантаженні
 * сторінки, тож:
 *   • у списку присутніх плодилися привиди тієї самої вкладки після
 *     кожного перезавантаження;
 *   • автор не бачив, що книга відкрита ще десь, і не розумів, звідки
 *     береться чужий стан.
 *
 * Тут два рішення, обидва навмисно прості:
 *   1) `clientId` живе в localStorage — сталий для цього браузера на цьому
 *      пристрої, переживає перезавантаження, але не переїжджає між
 *      браузерами (localStorage у кожного свій — це саме та межа, яку ми
 *      й хочемо бачити);
 *   2) підпис пристрою збирається з userAgent — без бібліотек-детекторів:
 *      нам потрібне впізнаване «Chrome · Windows», а не точна версія збірки.
 */

const CLIENT_ID_KEY = 'nova_client_id';

/**
 * Сталий ідентифікатор цього браузера. Якщо localStorage недоступний
 * (приватний режим, вимкнені дані сайтів), тихо відкочуємось на разовий id —
 * гірше, ніж сталий, але краще, ніж непрацездатна синхронізація.
 */
export function stableClientId(): string {
  const fresh = () => `usr-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  try {
    const saved = localStorage.getItem(CLIENT_ID_KEY);
    if (saved) return saved;
    const created = fresh();
    localStorage.setItem(CLIENT_ID_KEY, created);
    return created;
  } catch {
    return fresh();
  }
}

/** Назва браузера з userAgent. Порядок перевірок важливий: Edge й Opera теж містять «Chrome». */
function browserName(ua: string): string {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  if (/Electron/.test(ua)) return 'Застосунок';
  return 'Браузер';
}

/** Платформа з userAgent — грубо, але саме на тому рівні, який читає людина. */
function platformName(ua: string): string {
  if (/Android/.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'невідома система';
}

/** Підпис сесії для списку присутніх: «Chrome · Windows». */
export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Сервер';
  const ua = navigator.userAgent || '';
  return `${browserName(ua)} · ${platformName(ua)}`;
}

/**
 * Чи це та сама людина в іншій сесії. Порівнюємо за `userId` (акаунт), а не
 * за `clientId` (браузер): саме розбіжність цих двох і означає «та сама
 * книга відкрита в мене ж, але деінде».
 */
export function otherSessionsOfSameUser<T extends { userId: string; clientId: string }>(
  presence: T[],
  myUserId: string,
  myClientId: string
): T[] {
  if (!myUserId) return [];
  return presence.filter((p) => p.userId === myUserId && p.clientId !== myClientId);
}

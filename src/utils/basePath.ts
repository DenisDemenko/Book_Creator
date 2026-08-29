/**
 * Робота під префіксом шляху (docs/migration-plan.md Фаза G3).
 *
 * У проді Nova має відкриватись як `app.fusionlab.in.ua/studio`, а не на
 * власному домені — і це не косметика: стан входу Firebase браузер зберігає
 * **посценарно до origin**, тож спільна сесія з маркетплейсом можлива лише
 * тоді, коли обидва застосунки на одному origin. Префікс шляху — єдиний
 * спосіб цього досягти (піддомен `studio.` дав би окремий origin і зламав
 * би саме те, заради чого все робиться).
 *
 * Проксі перед Nova (rewrite у Next.js) префікс **зрізає**, тож серверний
 * бік не змінюється взагалі: Express і далі бачить `/api/...`. Змінюється
 * лише те, які URL **надсилає браузер**.
 *
 * Чому перехоплення `fetch`, а не 92 правки в 32 файлах: усі виклики API в
 * Nova починаються з літерального `/api/`, але записані по-різному — і
 * лапками, і шаблонними рядками з підстановками. Механічна заміна кожного
 * місця дала б 32 зміни з реальним шансом тихо зламати один із шаблонів,
 * тоді як префікс — це властивість транспорту, а не кожного окремого
 * виклику. Перехоплювач стоїть в одному місці, не може пропустити виклик і
 * знімається одним рядком, якщо схема зміниться.
 *
 * Коли BASE_URL = '/' (звичайний локальний запуск), не робиться нічого —
 * `installApiBasePath()` просто виходить, і `window.fetch` лишається
 * недоторканим.
 */

/** Префікс без кінцевого слеша: '/studio' або '' для кореня. */
export const API_BASE = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');

/** Чи треба взагалі щось префіксувати. */
export const hasBasePath = API_BASE !== '';

/** Абсолютний шлях до API з урахуванням префікса. */
export function apiPath(path: string): string {
  return hasBasePath && path.startsWith('/api/') ? `${API_BASE}${path}` : path;
}

/**
 * Адреса WebSocket спільного редагування.
 *
 * Виділена окремо, бо WebSocket **не проходить** через rewrite Vercel —
 * платформа не проксує upgrade-з'єднання. Тож у проді WS ходить напряму на
 * власний хост Nova (`VITE_NOVA_WS_URL`), тоді як увесь HTTP лишається під
 * `/studio` на спільному домені. Крос-оригінний WebSocket — це нормально:
 * на нього не діє правило одного походження, сервер сам перевіряє Origin.
 *
 * Без змінної (локальна розробка) — той самий хост, що й сторінка.
 */
export function realtimeSocketUrl(): string {
  const configured = import.meta.env.VITE_NOVA_WS_URL;
  if (configured) return configured;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${API_BASE}/ws`;
}

let installed = false;

/**
 * Ставить префікс на всі запити до `/api/...`. Викликається один раз із
 * main.tsx, до першого рендера.
 */
export function installApiBasePath(): void {
  if (installed || !hasBasePath || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);

  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    // Рядок — переважна більшість викликів у Nova.
    if (typeof input === 'string') {
      return nativeFetch(apiPath(input), init);
    }

    // Request зберігає власні заголовки й тіло, тож його не можна просто
    // підмінити рядком — перезбираємо з новим URL.
    if (input instanceof Request && input.url) {
      const url = new URL(input.url, window.location.origin);
      if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
        url.pathname = `${API_BASE}${url.pathname}`;
        return nativeFetch(new Request(url.toString(), input), init);
      }
    }

    return nativeFetch(input, init);
  };
}

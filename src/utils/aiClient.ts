/**
 * Єдина точка роботи з AI-ендпоінтами.
 *
 * Проблема, яку це вирішує: у проєкті 21 виклик /api/ai/*, і майже всі
 * ловили помилку в `catch { console.error(...) }`. Якщо GEMINI_API_KEY не
 * заданий або вичерпано квоту, кнопка просто переставала крутитися — і
 * користувач не мав жодного уявлення, що зламалося.
 *
 * Тут два механізми:
 *   1. `callAi()` — обгортка для нового коду: кидає AiError із готовим
 *      повідомленням українською.
 *   2. `installAiErrorReporter()` — перехоплювач, який один раз обгортає
 *      window.fetch і повідомляє про будь-яку невдалу відповідь /api/ai/*.
 *      Він нічого не змінює у відповіді й не заважає локальній обробці —
 *      лише гарантує, що жодна помилка не залишиться непоміченою, навіть
 *      у тих місцях, які ще не переписані на callAi.
 */

export type AiErrorKind =
  | 'no_key'
  | 'quota'
  | 'safety'
  | 'guest_restricted'
  | 'forbidden'
  | 'unauthenticated'
  | 'network'
  | 'server'
  | 'unknown';

export class AiError extends Error {
  kind: AiErrorKind;
  status: number;
  endpoint: string;

  constructor(kind: AiErrorKind, message: string, status: number, endpoint: string) {
    super(message);
    this.name = 'AiError';
    this.kind = kind;
    this.status = status;
    this.endpoint = endpoint;
  }
}

/** Подія, яку слухає застосунок, щоб показати банер. */
export const AI_ERROR_EVENT = 'nova:ai-error';

export interface AiErrorDetail {
  message: string;
  kind: AiErrorKind;
  status: number;
  endpoint: string;
}

function classify(status: number, payload: unknown): AiErrorKind {
  const kind = (payload as { kind?: string } | null)?.kind;
  if (kind === 'guest_restricted') return 'guest_restricted';
  if (kind === 'forbidden') return 'forbidden';
  if (kind === 'unauthenticated') return 'unauthenticated';
  if (kind === 'no_key' || status === 503) return 'no_key';
  if (kind === 'quota' || kind === 'quota_exceeded' || status === 429 || status === 402) return 'quota';
  if (kind === 'safety') return 'safety';
  if (status >= 500) return 'server';
  return 'unknown';
}

/** Людське пояснення, якщо сервер не надіслав власного. */
function fallbackMessage(kind: AiErrorKind): string {
  switch (kind) {
    case 'no_key':
      return 'Функції ШІ недоступні: на сервері не налаштований ключ Gemini (GEMINI_API_KEY).';
    case 'quota':
      return 'Вичерпано ліміт запитів до моделі або ліміт вашого тарифу. Спробуйте за кілька хвилин або перейдіть на сторінку «Підписка».';
    case 'safety':
      return 'Модель відхилила запит через фільтри безпеки. Спробуйте пом’якшити формулювання.';
    case 'guest_restricted':
      return 'Ця дія доступна зареєстрованим користувачам.';
    case 'unauthenticated':
      return 'Потрібен вхід у систему.';
    case 'forbidden':
      return 'Ваша роль не має дозволу на цю дію.';
    case 'network':
      return 'Сервер недоступний. Перевірте зʼєднання та спробуйте ще раз.';
    case 'server':
      return 'Помилка на сервері під час обробки запиту ШІ.';
    default:
      return 'Не вдалося виконати запит до ШІ.';
  }
}

/** Коротка назва операції для банера — з шляху ендпоінта. */
const ENDPOINT_LABELS: Record<string, string> = {
  'edit-text': 'Редагування тексту',
  'check-grammar': 'Перевірка граматики',
  'analyze-scene': 'Аналіз сцени',
  translate: 'Переклад',
  'generate-character': 'Генерація персонажа',
  'generate-character-art': 'Портрет персонажа',
  'generate-behavior-patterns': 'Шаблони поведінки персонажа',
  'craft-character-prompt': 'Складання промпту',
  'craft-illustration-prompt': 'Складання промпту',
  'generate-illustration-art': 'Генерація ілюстрації',
  'generate-prompt': 'Складання промпту',
  'generate-cover': 'Концепція обкладинки',
  'generate-cover-art': 'Малюнок обкладинки',
  'generate-synopsis': 'Генерація синопсису',
  'evaluate-skill-task': 'Оцінювання завдання',
  'diagnostic-assessment': 'Діагностика навичок',
  'coach-feedback': 'Розбір AI-Коуча',
  'generate-exercise': 'Генерація вправи',
  'generate-blueprint': 'Генерація плану проекту',
  'analyze-emotional-arc': 'Аналіз емоційної дуги',
};

export function endpointLabel(endpoint: string): string {
  const key = endpoint.split('/').pop() || '';
  return ENDPOINT_LABELS[key] || 'Запит до ШІ';
}

function emit(detail: AiErrorDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AiErrorDetail>(AI_ERROR_EVENT, { detail }));
}

/**
 * Виклик AI-ендпоінта з нормальною обробкою помилок.
 * Кидає AiError; викликач може показати повідомлення поруч із кнопкою.
 */
export async function callAi<T = unknown>(
  endpoint: string,
  body: unknown,
  options: { silent?: boolean } = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
  } catch {
    const error = new AiError('network', fallbackMessage('network'), 0, endpoint);
    if (!options.silent) emit({ message: error.message, kind: 'network', status: 0, endpoint });
    throw error;
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    const kind = classify(res.status, payload);
    const message =
      (payload as { error?: string } | null)?.error || fallbackMessage(kind);
    // Перехоплювач уже повідомив про цю відповідь — не дублюємо банер.
    throw new AiError(kind, message, res.status, endpoint);
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Глобальний перехоплювач
// ---------------------------------------------------------------------------

let installed = false;

/**
 * Обгортає window.fetch, щоб жодна невдала відповідь /api/ai/* не зникла
 * мовчки. Відповідь повертається незміненою (тіло клонується для читання),
 * тож локальна обробка в компонентах працює як раніше.
 */
export function installAiErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!url.includes('/api/ai/')) return originalFetch(input as RequestInfo, init);

    let res: Response;
    try {
      res = await originalFetch(input as RequestInfo, init);
    } catch (err) {
      emit({ message: fallbackMessage('network'), kind: 'network', status: 0, endpoint: url });
      throw err;
    }

    if (!res.ok) {
      // Клон, щоб не «зʼїсти» тіло у викликача.
      let payload: unknown = null;
      try {
        payload = await res.clone().json();
      } catch {
        payload = null;
      }
      const kind = classify(res.status, payload);
      const message =
        (payload as { error?: string } | null)?.error || fallbackMessage(kind);
      emit({ message, kind, status: res.status, endpoint: url });
    }

    return res;
  };
}

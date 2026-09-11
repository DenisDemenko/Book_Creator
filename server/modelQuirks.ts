/**
 * Особливості контракту КОНКРЕТНОЇ моделі — і самонавчання на помилках
 * провайдера.
 *
 * Навіщо це існує. `openAiCompatible()` у chatProviders.ts довго слав усім
 * чотирьом OpenAI-сумісним провайдерам (OpenAI, DeepSeek, Groq, Mistral) і
 * будь-якій їхній моделі ОДИН жорстко зашитий набір параметрів:
 * `max_tokens: 4096`, `temperature: 0.7`, `response_format` для JSON. Поки
 * всі моделі приймали цей набір, воно працювало. Далі провайдери почали
 * розходитись:
 *
 *   - новіші моделі OpenAI відхиляють `max_tokens` і вимагають
 *     `max_completion_tokens` («Unsupported parameter: 'max_tokens' is not
 *     supported with this model»);
 *   - частина з них приймає лише типову `temperature` і відхиляє 0.7;
 *   - не кожна модель уміє `response_format: json_object`.
 *
 * Кожен такий випадок вилазив до власника сирою помилкою провайдера, а
 * лікувався правкою коду під конкретну модель. Це і є «ядро сформовано
 * слабо»: список моделей змінюється частіше, ніж встигає код.
 *
 * Рішення — не вгадувати контракт наперед, а ВЧИТИСЬ йому з відповіді
 * провайдера. Провайдери формулюють ці помилки однозначно й самі кажуть,
 * чим замінити параметр. Тож:
 *
 *   1. Запит будується з поточного (за замовчуванням — найширшого) набору.
 *   2. Якщо провайдер відхилив саме ПАРАМЕТР — `adaptQuirks()` розпізнає
 *      це за текстом, звужує набір для цієї моделі й повертає новий.
 *   3. Виклик повторюється один раз уже з виправленим тілом.
 *   4. Виправлення запам'ятовується на час життя процесу, тож наступні
 *      запити цією моделлю йдуть правильними з першого разу.
 *
 * Помилки НЕ про параметри (невалідний ключ, немає балансу, ліміт) сюди не
 * потрапляють: `adaptQuirks()` повертає null, і помилка йде власнику як є —
 * повторювати її безглуздо.
 */

export interface ModelQuirks {
  /** Ім'я параметра ліміту вихідних токенів. */
  tokenParam: 'max_tokens' | 'max_completion_tokens';
  /** Чи можна задавати власну temperature (деякі моделі беруть лише типову). */
  supportsTemperature: boolean;
  /** Чи вміє модель режим гарантованого JSON (`response_format`). */
  supportsJsonMode: boolean;
}

export const DEFAULT_QUIRKS: ModelQuirks = {
  tokenParam: 'max_tokens',
  supportsTemperature: true,
  supportsJsonMode: true,
};

/**
 * Вивчені особливості моделей. Живе в пам'яті процесу: це кеш, а не
 * налаштування — після перезапуску система просто вивчить їх знову, за
 * одну зайву спробу на модель.
 */
const learned = new Map<string, ModelQuirks>();

export function quirksFor(modelId: string): ModelQuirks {
  return learned.get(modelId) ?? DEFAULT_QUIRKS;
}

export function rememberQuirks(modelId: string, quirks: ModelQuirks): void {
  learned.set(modelId, quirks);
}

/** Лише для тестів — щоб кожен прогін починався з чистого аркуша. */
export function __resetLearnedQuirks(): void {
  learned.clear();
}

/**
 * Розбирає повідомлення провайдера й каже, ЧИМ звузити набір параметрів.
 *
 * Повертає новий набір, якщо помилка справді про параметр і її видно як
 * виправити; null — якщо ні (тоді повторювати запит нема сенсу).
 *
 * Звіряємось із текстом, а не з кодом статусу: усі ці випадки — 400, і
 * відрізнити «не той параметр» від «зіпсований запит» можна лише за
 * формулюванням. Тому кожна умова шукає ДВІ ознаки: назву параметра і
 * слово про непідтримку — щоб не звузити набір через випадковий збіг.
 */
export function adaptQuirks(modelId: string, rawMessage: string): ModelQuirks | null {
  const msg = String(rawMessage || '').toLowerCase();
  if (!msg) return null;

  const current = quirksFor(modelId);
  const next: ModelQuirks = { ...current };
  let changed = false;

  const rejected = (what: string) =>
    msg.includes(what) &&
    (msg.includes('unsupported') ||
      msg.includes('not supported') ||
      msg.includes('unrecognized') ||
      msg.includes('unknown parameter') ||
      msg.includes('does not support') ||
      msg.includes('is not allowed') ||
      msg.includes('invalid parameter'));

  // Провайдер прямо називає заміну — найнадійніша ознака з усіх.
  if (msg.includes('max_completion_tokens') && current.tokenParam === 'max_tokens') {
    next.tokenParam = 'max_completion_tokens';
    changed = true;
  } else if (rejected('max_tokens') && current.tokenParam === 'max_tokens') {
    next.tokenParam = 'max_completion_tokens';
    changed = true;
  }

  if (rejected('temperature') && current.supportsTemperature) {
    next.supportsTemperature = false;
    changed = true;
  }
  // Окремий випадок: моделі, які приймають лише типове значення, кажуть це
  // не словом «unsupported», а переліком допустимих значень.
  if (
    current.supportsTemperature &&
    msg.includes('temperature') &&
    (msg.includes('only the default') || msg.includes('does not support') || msg.includes('only supports'))
  ) {
    next.supportsTemperature = false;
    changed = true;
  }

  if (rejected('response_format') && current.supportsJsonMode) {
    next.supportsJsonMode = false;
    changed = true;
  }
  if (current.supportsJsonMode && msg.includes('json_object') && msg.includes('not')) {
    next.supportsJsonMode = false;
    changed = true;
  }

  return changed ? next : null;
}

/**
 * Тіло запиту під поточні особливості моделі. Винесено сюди, щоб
 * `openAiCompatible()` не мав двох майже однакових копій — для першої
 * спроби і для повтору.
 */
export function buildOpenAiBody(params: {
  modelId: string;
  messages: unknown[];
  json?: boolean;
  maxOutputTokens?: number;
  quirks: ModelQuirks;
}): Record<string, unknown> {
  const { modelId, messages, json, quirks } = params;
  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream: false,
    [quirks.tokenParam]: params.maxOutputTokens ?? 4096,
  };
  if (quirks.supportsTemperature) body.temperature = 0.7;
  if (json && quirks.supportsJsonMode) body.response_format = { type: 'json_object' };
  return body;
}

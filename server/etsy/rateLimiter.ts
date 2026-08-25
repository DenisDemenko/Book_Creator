/**
 * Токен-бакет і exponential backoff для викликів Etsy.
 *
 * Два окремі бакети — не випадковість, а вимога ТЗ 6.4: «дослідницькі запити
 * не впливають на ліміт швидкості публікаційних викликів». Дослідження теми
 * робить десятки запитів поспіль, і якби вони жили в одному бакеті з
 * публікацією, автор натискав би «Опублікувати» і чекав, поки догориться
 * фонова аналітика.
 *
 * Час подається ззовні (`now`) — так поведінка бакета тестується детерміновано,
 * без реального очікування секунд у тестах.
 */

export interface TokenBucketOptions {
  /** Скільки запитів на секунду дозволено. */
  ratePerSecond: number;
  /** Максимальний «сплеск» — за замовчуванням дорівнює ratePerSecond. */
  capacity?: number;
  /** Джерело часу в мілісекундах (для тестів). */
  now?: () => number;
}

export interface TokenBucket {
  /** Скільки мс треба зачекати до наступного дозволеного запиту (0 — можна зараз). */
  reserve(): number;
  /** Дочекатись дозволу й зайняти токен. */
  acquire(): Promise<void>;
  /** Скільки токенів лишилось (для діагностики й тестів). */
  available(): number;
}

export function createTokenBucket(options: TokenBucketOptions): TokenBucket {
  const rate = Math.max(0.1, options.ratePerSecond);
  const capacity = Math.max(1, options.capacity ?? Math.ceil(rate));
  const now = options.now ?? (() => Date.now());

  let tokens = capacity;
  let lastRefill = now();

  function refill(): void {
    const current = now();
    const elapsedSec = Math.max(0, (current - lastRefill) / 1000);
    if (elapsedSec > 0) {
      tokens = Math.min(capacity, tokens + elapsedSec * rate);
      lastRefill = current;
    }
  }

  return {
    reserve(): number {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return 0;
      }
      // Скільки часу треба, щоб накопичився рівно один токен.
      const deficit = 1 - tokens;
      const waitMs = Math.ceil((deficit / rate) * 1000);
      // Токен усе одно резервуємо: викликач зачекає й піде — так порядок
      // черги зберігається, і два паралельні виклики не отримають один слот.
      tokens -= 1;
      return waitMs;
    },
    async acquire(): Promise<void> {
      const wait = this.reserve();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    },
    available(): number {
      refill();
      return Math.max(0, tokens);
    },
  };
}

/**
 * Затримка перед повтором (ТЗ 4.5: базова 1 с, максимум 5 спроб).
 *
 * Джитер обов'язковий: якщо Etsy на хвилину «ліг», усі задачі, що впали
 * одночасно, без джитера повернуться теж одночасно і покладуть його знову.
 * Множник джитера подається ззовні, щоб тест міг зафіксувати його на 1.
 */
export function computeBackoffDelayMs(
  attempt: number,
  options: { baseMs?: number; maxMs?: number; jitter?: () => number } = {}
): number {
  const base = options.baseMs ?? 1000;
  const max = options.maxMs ?? 60_000;
  const jitter = options.jitter ?? Math.random;
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = Math.min(max, base * 2 ** (safeAttempt - 1));
  // ±25% розкиду навколо розрахованої затримки.
  const spread = exponential * 0.25;
  return Math.round(Math.min(max, exponential - spread + jitter() * spread * 2));
}

/** Коди, після яких має сенс повторювати запит. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

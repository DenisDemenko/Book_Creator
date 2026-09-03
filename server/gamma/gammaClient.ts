/**
 * Клієнт Gamma Generate API.
 *
 * Побудований за зразком `server/etsy/etsyClient.ts` — те саме відро запитів,
 * ті самі повтори з експонентною затримкою, ті самі людські описи статусів.
 * Другий стиль клієнта в проєкті означав би, що правку в одному доведеться
 * вручну повторювати в іншому.
 *
 * КЛЮЧ НІКОЛИ НЕ ПОТРАПЛЯЄ В ЖУРНАЛ І В БАЗУ. Він живе в середовищі й
 * передається заголовком `X-API-KEY`; у логах лишається шлях і статус.
 */

import { GAMMA_API_BASE } from './gammaConfig';
import type { TokenBucket } from '../etsy/rateLimiter';

export type FetchLike = (url: string, init?: any) => Promise<any>;

export class GammaApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly kind: 'no_key' | 'no_credits' | 'plan' | 'bad_input' | 'upstream' = 'upstream',
    readonly rawBody = ''
  ) {
    super(message);
  }
}

export interface GammaClientDeps {
  apiKey: string;
  fetchImpl: FetchLike;
  bucket: TokenBucket;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  log?: (line: string) => void;
}

const DEFAULT_MAX_ATTEMPTS = 4;

/** 5xx і 429 варті повтору; 4xx — ні, вони не змінюються від наполегливості. */
function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function backoffMs(attempt: number): number {
  return Math.min(8000, 500 * 2 ** (attempt - 1));
}

/**
 * Опис статусу людською мовою.
 *
 * 402 винесено окремо не для краси: «недостатньо кредитів» — це стан
 * рахунку власника, а не збій, і автор має прочитати саме це, а не
 * «помилка 402».
 */
function describe(status: number): { message: string; kind: GammaApiError['kind'] } {
  if (status === 401) {
    return { message: 'Gamma відхилила ключ (401). Перевірте GAMMA_API_KEY у .env сервера.', kind: 'no_key' };
  }
  if (status === 402) {
    return {
      message:
        'У Gamma закінчились кредити (402). Генерація коштує кредитів рахунку власника — ' +
        'поповніть баланс або зменште обсяг завдання.',
      kind: 'no_credits',
    };
  }
  if (status === 403) {
    return {
      message:
        'Gamma відмовила в доступі (403). Найімовірніше тариф не дає доступу до API: ' +
        'потрібен Pro, Ultra, Teams або Business.',
      kind: 'plan',
    };
  }
  if (status === 400) {
    return { message: 'Gamma відхилила параметри генерації (400).', kind: 'bad_input' };
  }
  return { message: `Gamma відповіла помилкою ${status}.`, kind: 'upstream' };
}

export interface GammaClient {
  request<T>(pathname: string, options?: { method?: string; json?: unknown }): Promise<T>;
}

export function createGammaClient(deps: GammaClientDeps): GammaClient {
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const log = deps.log ?? ((line: string) => console.log(line));

  async function request<T>(pathname: string, options: { method?: string; json?: unknown } = {}): Promise<T> {
    const method = options.method || 'GET';
    const url = `${GAMMA_API_BASE}${pathname}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await deps.bucket.acquire();

      const headers: Record<string, string> = { 'X-API-KEY': deps.apiKey, Accept: 'application/json' };
      let body: string | undefined;
      if (options.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.json);
      }

      const startedAt = Date.now();
      try {
        const res = await deps.fetchImpl(url, { method, headers, body });
        const raw = await res.text();
        log(`[gamma] ${method} ${pathname} → ${res.status} за ${Date.now() - startedAt} мс (спроба ${attempt}/${maxAttempts})`);

        if (res.ok) {
          if (!raw) return undefined as T;
          try {
            return JSON.parse(raw) as T;
          } catch {
            throw new GammaApiError('Gamma повернула відповідь, яку не вдалося прочитати як JSON.', res.status, 'upstream', raw.slice(0, 300));
          }
        }

        if (isRetryable(res.status) && attempt < maxAttempts) {
          const delay = backoffMs(attempt);
          log(`[gamma] ${res.status} — повтор через ${delay} мс`);
          await sleep(delay);
          continue;
        }

        const { message, kind } = describe(res.status);
        throw new GammaApiError(message, res.status, kind, raw.slice(0, 500));
      } catch (err) {
        if (err instanceof GammaApiError) throw err;
        if (attempt < maxAttempts) {
          const delay = backoffMs(attempt);
          log(`[gamma] мережевий збій (${(err as Error)?.message}) — повтор через ${delay} мс`);
          await sleep(delay);
          continue;
        }
        throw new GammaApiError(
          'Не вдалося зʼєднатися з Gamma. Перевірте мережу й спробуйте ще раз.',
          0,
          'upstream',
          String((err as Error)?.message || err).slice(0, 300)
        );
      }
    }

    throw new GammaApiError('Gamma не відповіла після кількох спроб.', 504);
  }

  return { request };
}

// ---------------------------------------------------------------------------
// Операції
// ---------------------------------------------------------------------------

export type GammaFormat = 'presentation' | 'document' | 'social' | 'webpage';
export type GammaExportAs = 'pdf' | 'pptx' | 'png';

export interface CreateGenerationInput {
  inputText: string;
  format?: GammaFormat;
  numCards?: number;
  themeId?: string;
  title?: string;
  additionalInstructions?: string;
  textMode?: 'condense' | 'generate' | 'preserve';
  textOptions?: Record<string, unknown>;
  imageOptions?: Record<string, unknown>;
  cardOptions?: Record<string, unknown>;
  exportAs?: GammaExportAs;
}

export interface GenerationStatus {
  generationId: string;
  status: 'pending' | 'completed' | 'failed';
  gammaId?: string;
  gammaUrl?: string;
  exportUrl?: string;
  credits?: { deducted?: number; remaining?: number };
  error?: unknown;
}

export async function createGeneration(
  client: GammaClient,
  input: CreateGenerationInput
): Promise<{ generationId: string; warnings?: unknown }> {
  return client.request('/generations', { method: 'POST', json: input });
}

export async function getGeneration(client: GammaClient, id: string): Promise<GenerationStatus> {
  return client.request(`/generations/${encodeURIComponent(id)}`);
}

export async function listThemes(client: GammaClient): Promise<unknown> {
  return client.request('/themes');
}

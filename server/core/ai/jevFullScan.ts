/**
 * Повне сканування книги моделлю Jev за всіма типами сутностей (постановка
 * власника 03.11.2026): «якщо в абзаці є ознаки сутності за ймовірності не
 * менше 95% — поставити відповідний тег з числа 118».
 *
 * ЧОМУ ТУТ НЕМАЄ AI-1. Кнопка Jev у редакторі (`jevTags.ts` + маршрут) працює над
 * кандидатами, яких знайшов AI-1 у ядрі. Прогін по книзі локально ядра не має
 * (потрібен PostgreSQL), тож кандидатами стають УСІ типи, окрім структурних.
 * Це не нова логіка рішення: поріг, ліміт на абзац, відсів уже наявних типів і
 * порядок за певністю — ті самі `decideParagraph` і `JEV_TAG_THRESHOLD`.
 *
 * ПОПРАВКА ДО МОГО ЖЕ ЗАПИСУ #493. Там я писав, що питати Jev про всі 118 типів
 * на кожен абзац «неможливо». Це було перебільшенням, яке я не перевіряв: сто
 * десять коротких питань — це кілька тисяч токенів на запит, далеко під межею
 * 64 тис., а за ціною $0,042 за мільйон вхідних токенів увесь прогін по книзі
 * коштує порядку долара. Неможливим воно не є; дорогим чи ні — вирішує пілотний
 * прогін (`scripts/live-jevTagArhat.mts --pilot`), а не здогад.
 *
 * ЧОМУ ЗАПИТИ ЙДУТЬ ПО 24 ПИТАННЯ. Межа — моя власна обережність
 * (`JEV_MAX_QUESTIONS_PER_PARAGRAPH`): справжню межу провайдера на кількість
 * питань я не знаю, а 24 — це те, з чим тест працював. Сто десять типів — це
 * п'ять запитів на абзац.
 *
 * ЧОМУ Є КЕШ. Запити платні, а прогін на 1888 абзаців — це сотні хвилин
 * очікування за мережі. Кожна відповідь одразу пишеться в кеш, тож збій
 * посередині не пропалює вже оплачене, а повторний запуск лише доробляє. Ключ
 * кешу — відбиток видимого тексту абзацу, тож однакові абзаци («Так.») не
 * оплачуються двічі. Абзац, у якому хоч один запит не вдався, у кеш НЕ
 * потрапляє: інакше «не відповіли» осіло б як «відповіли, що ні».
 *
 * ЧОМУ ПОВТОРИ ТУТ, А НЕ В АДАПТЕРІ. Адаптер лише позначає помилку як
 * `retryable` (429, 529, 5xx, мережа) і не повторює сам. Повтор з наростаючою
 * паузою робиться тут, бо тільки сканер знає, що запитів буде тисячі.
 */

import fs from 'node:fs';
import { JevError, noulProbability, type JevAdapter } from '../../ai/adapters/jev';
import {
  JEV_MAX_QUESTIONS_PER_PARAGRAPH,
  JEV_TAG_THRESHOLD,
  decideParagraph,
  questionId,
  tagQuestions,
  tagState,
  type JevTagCandidate,
  type JevTagDecision,
} from './jevTags';

export interface ScanType {
  slug: string;
  nameUk: string;
}

/** Імовірності «так» за типами; `null` — на це питання відповіді не було. */
export type ScanProbabilities = Record<string, number | null>;

export interface ScanCache {
  get(key: string): ScanProbabilities | undefined;
  set(key: string, probabilities: ScanProbabilities): void;
}

/** Кеш у пам'яті з необов'язковим журналом у файлі (один JSON на рядок). */
export class JsonlScanCache implements ScanCache {
  private readonly map = new Map<string, ScanProbabilities>();
  constructor(private readonly file?: string) {
    if (file && fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line) as { k: string; p: ScanProbabilities };
          this.map.set(row.k, row.p);
        } catch {
          // Обірваний останній рядок після збою — просто пропускається.
        }
      }
    }
  }
  get size() {
    return this.map.size;
  }
  get(key: string) {
    return this.map.get(key);
  }
  set(key: string, probabilities: ScanProbabilities) {
    this.map.set(key, probabilities);
    if (this.file) fs.appendFileSync(this.file, `${JSON.stringify({ k: key, p: probabilities })}\n`, 'utf8');
  }
}

export interface ScanStats {
  paragraphs: number;
  fromCache: number;
  requests: number;
  retries: number;
  inputTokens: number;
  outputTokens: number;
  /** Абзаци, де хоч один запит так і не вдався. */
  failed: Array<{ id: string; error: string }>;
}

export interface ScanOptions {
  threshold?: number;
  maxPerParagraph?: number;
  /** Скільки абзаців одночасно в роботі. */
  concurrency?: number;
  /** Питань в одному запиті. */
  chunk?: number;
  /** Спроб на один запит, разом із першою. */
  attempts?: number;
  /** Пауза перед другою спробою, мс; далі подвоюється. Тест ставить 0. */
  backoffMs?: number;
  cache?: ScanCache;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, stats: ScanStats) => void;
}

export interface ScanParagraph {
  /** Будь-який стійкий ідентифікатор абзацу; повертається як є. */
  id: string;
  /** Текст абзацу разом з тегами: потрібен, щоб не дублювати наявні типи й рахувати місця. */
  text: string;
  /** Відбиток видимого тексту — ключ кешу. */
  key: string;
}

export interface ScanResult {
  /** Прийняті типи за спаданням певності Jev, для кожного абзацу. */
  accepted: Map<string, string[]>;
  /** Повні рішення: з імовірностями й причинами відмови. */
  decisions: Map<string, JevTagDecision[]>;
  probabilities: Map<string, ScanProbabilities>;
  stats: ScanStats;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function candidatesFor(types: readonly ScanType[], paragraphId: string): JevTagCandidate[] {
  return types.map((t) => ({
    findingId: t.slug,
    paragraphId,
    editorPid: null,
    entitySlug: t.slug,
    entityName: t.nameUk,
    tag: '',
  }));
}

/** Один запит із повторами. Повертає відповіді або кидає останню помилку. */
async function askWithRetry(
  adapter: JevAdapter,
  state: Record<string, unknown>,
  questions: ReturnType<typeof tagQuestions>,
  opts: Required<Pick<ScanOptions, 'attempts' | 'backoffMs'>> & { signal?: AbortSignal },
  stats: ScanStats
) {
  let lastError: Error = new Error('запит не виконувався');
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      stats.requests += 1;
      const raw = await adapter.askState!(state, questions, { signal: opts.signal });
      stats.inputTokens += raw.usage?.input_tokens ?? 0;
      stats.outputTokens += raw.usage?.output_tokens ?? 0;
      return raw;
    } catch (err) {
      lastError = err as Error;
      const retryable = err instanceof JevError ? err.retryable : false;
      if (!retryable || attempt === opts.attempts) break;
      stats.retries += 1;
      // Наростаюча пауза з розкидом, щоб паралельні абзаци не повторювали разом.
      await sleep(opts.backoffMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5));
    }
  }
  throw lastError;
}

/**
 * Скануватиме один абзац за всіма типами. Повертає імовірності за типами й
 * ознаку, чи всі запити вдались.
 */
export async function scanParagraph(
  paragraph: ScanParagraph,
  types: readonly ScanType[],
  adapter: JevAdapter,
  opts: Required<Pick<ScanOptions, 'chunk' | 'attempts' | 'backoffMs'>> & { signal?: AbortSignal },
  stats: ScanStats
): Promise<{ probabilities: ScanProbabilities; complete: boolean; error?: string }> {
  const probabilities: ScanProbabilities = {};
  let complete = true;
  let error: string | undefined;
  const state = tagState({ paragraphId: paragraph.id, editorPid: null, text: paragraph.text, candidates: [] });

  for (let from = 0; from < types.length; from += opts.chunk) {
    const slice = types.slice(from, from + opts.chunk);
    const questions = tagQuestions(candidatesFor(slice, paragraph.id));
    try {
      const raw = await askWithRetry(adapter, state, questions, opts, stats);
      slice.forEach((t, i) => {
        probabilities[t.slug] = noulProbability(raw.answers?.[questionId(i)]);
      });
    } catch (err) {
      complete = false;
      error = (err as Error).message;
      slice.forEach((t) => (probabilities[t.slug] = null));
    }
  }
  return { probabilities, complete, error };
}

/** Рішення для абзацу з уже отриманих імовірностей — те саме правило, що й у кнопці Jev. */
export function decideFromProbabilities(
  paragraph: ScanParagraph,
  types: readonly ScanType[],
  probabilities: ScanProbabilities,
  opts: { threshold?: number; maxPerParagraph?: number } = {}
): JevTagDecision[] {
  const answers = Object.fromEntries(
    types.map((t, i) => [questionId(i), probabilities[t.slug] == null ? undefined : { type: 'noul', noul: probabilities[t.slug] }])
  );
  return decideParagraph(
    { paragraphId: paragraph.id, editorPid: null, text: paragraph.text, candidates: candidatesFor(types, paragraph.id) },
    answers,
    { ...opts, maxQuestions: types.length }
  );
}

/** Скануватиме абзаци пулом із `concurrency` одночасних. */
export async function runJevFullScan(
  paragraphs: readonly ScanParagraph[],
  types: readonly ScanType[],
  adapter: JevAdapter,
  options: ScanOptions = {}
): Promise<ScanResult> {
  if (!adapter.askState) throw new Error('Адаптер Jev не вміє askState — повне сканування потребує питань над станом.');
  const chunk = Math.max(1, Math.min(options.chunk ?? JEV_MAX_QUESTIONS_PER_PARAGRAPH, JEV_MAX_QUESTIONS_PER_PARAGRAPH));
  const attempts = Math.max(1, options.attempts ?? 5);
  const backoffMs = options.backoffMs ?? 1000;
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const threshold = options.threshold ?? JEV_TAG_THRESHOLD;

  const stats: ScanStats = { paragraphs: paragraphs.length, fromCache: 0, requests: 0, retries: 0, inputTokens: 0, outputTokens: 0, failed: [] };
  const probabilities = new Map<string, ScanProbabilities>();
  const decisions = new Map<string, JevTagDecision[]>();
  const accepted = new Map<string, string[]>();
  let done = 0;
  let cursor = 0;

  const one = async (p: ScanParagraph) => {
    const cached = options.cache?.get(p.key);
    let probs: ScanProbabilities | undefined;
    if (cached && types.every((t) => t.slug in cached)) {
      probs = cached;
      stats.fromCache += 1;
    } else {
      const r = await scanParagraph(p, types, adapter, { chunk, attempts, backoffMs, signal: options.signal }, stats);
      probs = r.probabilities;
      if (r.complete) options.cache?.set(p.key, r.probabilities);
      else stats.failed.push({ id: p.id, error: r.error ?? 'невідома помилка' });
    }
    probabilities.set(p.id, probs);
    const d = decideFromProbabilities(p, types, probs, { threshold, maxPerParagraph: options.maxPerParagraph });
    decisions.set(p.id, d);
    accepted.set(
      p.id,
      d
        .filter((x) => x.accepted)
        .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))
        .map((x) => x.entitySlug)
    );
    done += 1;
    options.onProgress?.(done, paragraphs.length, stats);
  };

  const worker = async () => {
    while (cursor < paragraphs.length) {
      if (options.signal?.aborted) return;
      const p = paragraphs[cursor++];
      await one(p);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paragraphs.length) }, worker));
  return { accepted, decisions, probabilities, stats };
}

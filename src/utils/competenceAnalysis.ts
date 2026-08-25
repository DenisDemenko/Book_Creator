import { TextCompetenceAnalysis, SkillSnapshot, Book } from '../types';
import { SKILL_MARKERS } from '../data/skillMarkers';

/**
 * Клієнтська частина аналізу компетентностей (завдання 4 хвилі 1).
 *
 * Головне тут — кеш. 20 показників × кожна глава × кожне відкриття вкладки
 * означало б десятки платних викликів моделі на одну сесію. Тому результат
 * кешується за хешем тексту: доки автор не змінив розділ, повторний аналіз
 * не викликається взагалі.
 */

/**
 * Версія рушія аналізу. **Піднімати при кожній зміні промпту або набору
 * показників.** Зрізи з різними версіями не можна порівнювати між собою —
 * інакше «покращення» виявиться зміною поведінки моделі, а не тексту.
 */
export const ANALYSIS_ENGINE_VERSION = '1.0.0';

const CACHE_KEY = 'nova_competence_cache_v1';
/** Скільки результатів тримати. Більше — марно роздуває localStorage. */
const CACHE_LIMIT = 60;

/**
 * Стабільний хеш тексту (FNV-1a, 32 біти, у 36-й системі).
 *
 * Криптостійкість тут не потрібна — потрібна лише детермінованість і
 * дешевизна: той самий текст завжди дає той самий ключ кешу.
 */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Ключ кешу враховує версію рушія — після її підняття кеш не спрацює. */
function cacheKeyFor(sectionId: string, textHash: string): string {
  return `${ANALYSIS_ENGINE_VERSION}:${sectionId}:${textHash}`;
}

type CacheShape = Record<string, TextCompetenceAnalysis>;

function readCache(): CacheShape {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as CacheShape) : {};
  } catch {
    return {};
  }
}

function writeCache(cache: CacheShape): void {
  try {
    const entries = Object.entries(cache);
    // Тримаємо найсвіжіші — інакше localStorage з часом переповниться.
    const trimmed =
      entries.length <= CACHE_LIMIT
        ? entries
        : entries
            .sort((a, b) => (a[1].analyzedAt < b[1].analyzedAt ? 1 : -1))
            .slice(0, CACHE_LIMIT);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(trimmed)));
  } catch {
    /* сховище недоступне або переповнене — кеш не критичний */
  }
}

export function getCachedAnalysis(sectionId: string, text: string): TextCompetenceAnalysis | null {
  return readCache()[cacheKeyFor(sectionId, hashText(text))] ?? null;
}

/**
 * Аналізує розділ. Якщо для цього самого тексту результат уже є в кеші —
 * повертає його без звернення до сервера.
 *
 * @param force ігнорувати кеш (кнопка «переаналізувати»)
 */
export async function analyzeSection(
  sectionId: string,
  text: string,
  bookContext: { genre?: string; logline?: string; theme?: string; isNonFiction?: boolean },
  force = false
): Promise<TextCompetenceAnalysis> {
  const textHash = hashText(text);
  const key = cacheKeyFor(sectionId, textHash);

  if (!force) {
    const cached = readCache()[key];
    if (cached) return cached;
  }

  const res = await fetch('/api/ai/analyze-text-competences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      bookContext,
      skills: SKILL_MARKERS.filter(
        (s) => s.scope === 'both' || (bookContext.isNonFiction ? s.scope === 'nonfiction' : s.scope === 'fiction')
      ).map((s) => ({ id: s.id, title: s.titleUk, looksFor: s.looksFor, markerTypes: s.markerTypes })),
    }),
  });

  if (!res.ok) {
    throw new Error(`Аналіз не вдався: ${res.status}`);
  }

  const data = await res.json();
  const analysis: TextCompetenceAnalysis = {
    sectionId,
    textHash,
    markers: Array.isArray(data.markers) ? data.markers : [],
    skillScores: data.skillScores && typeof data.skillScores === 'object' ? data.skillScores : {},
    analyzedAt: new Date().toISOString(),
    engineVersion: ANALYSIS_ENGINE_VERSION,
  };

  const cache = readCache();
  cache[key] = analysis;
  writeCache(cache);
  return analysis;
}

/**
 * Знаходить маркер у тексті наново за цитатою.
 *
 * Після редагування розділу числові зсуви застарівають, тому саме цитата —
 * основний якір. Повертає null, якщо фрагмент зник: це коректний стан, а не
 * помилка, і означає, що маркер треба перерахувати.
 */
export function locateMarker(text: string, quote: string, hintOffset?: number): { start: number; end: number } | null {
  if (!quote) return null;

  // Збираємо ВСІ входження, а не перше. Якщо цитата в розділі повторюється
  // (а в діалогах це звична річ), потрібне те входження, що найближче до
  // збереженого зсуву. Пошук «уперед від вікна» тут не працює: коли зсув
  // менший за довжину вікна, воно зривається на початок тексту й повертає
  // завжди перше входження.
  const positions: number[] = [];
  let i = text.indexOf(quote);
  while (i !== -1) {
    positions.push(i);
    i = text.indexOf(quote, i + 1);
  }
  if (positions.length === 0) return null;

  const start =
    typeof hintOffset === 'number'
      ? positions.reduce((best, p) => (Math.abs(p - hintOffset) < Math.abs(best - hintOffset) ? p : best))
      : positions[0];

  return { start, end: start + quote.length };
}

/**
 * Зводить оцінки розділів у показники книги (просте середнє за наявними).
 * Показник, якого немає в жодному розділі, у зріз не потрапляє — краще
 * відсутність числа, ніж вигаданий нуль.
 */
export function aggregateScores(analyses: TextCompetenceAnalysis[]): Record<string, number> {
  const sums: Record<string, { total: number; count: number }> = {};
  analyses.forEach((a) => {
    Object.entries(a.skillScores).forEach(([k, v]) => {
      if (typeof v !== 'number' || Number.isNaN(v)) return;
      sums[k] = sums[k] || { total: 0, count: 0 };
      sums[k].total += v;
      sums[k].count += 1;
    });
  });
  return Object.fromEntries(
    Object.entries(sums).map(([k, { total, count }]) => [k, Math.round(total / count)])
  );
}

/** Створює зріз показників книги з уже наявних аналізів розділів. */
export function buildSnapshot(
  book: Book,
  analyses: TextCompetenceAnalysis[],
  trigger: SkillSnapshot['trigger'] = 'manual'
): SkillSnapshot {
  const wordCount = book.chapters.reduce(
    (sum, ch) => sum + ch.sections.reduce((s, sec) => s + (sec.wordCount || 0), 0),
    0
  );
  return {
    id: `snap-${Date.now()}`,
    bookId: book.id,
    takenAt: new Date().toISOString(),
    bookVersion: book.version,
    bookRevision: book.revisionNumber,
    scores: aggregateScores(analyses),
    wordCount,
    chapterCount: book.chapters.length,
    engineVersion: ANALYSIS_ENGINE_VERSION,
    trigger,
  };
}

/**
 * Порівнює два зрізи. Зрізи з різними версіями рушія не порівнюються —
 * повертається `comparable: false`, щоб інтерфейс показав чесне
 * попередження замість неправдивої дельти.
 */
export function compareSnapshots(
  before: SkillSnapshot,
  after: SkillSnapshot
): { comparable: boolean; deltas: { id: string; before: number; after: number; delta: number }[] } {
  if (before.engineVersion !== after.engineVersion) {
    return { comparable: false, deltas: [] };
  }
  const deltas = Object.keys(after.scores)
    .filter((k) => k in before.scores)
    .map((k) => ({
      id: k,
      before: before.scores[k],
      after: after.scores[k],
      delta: after.scores[k] - before.scores[k],
    }))
    .sort((a, b) => b.delta - a.delta);
  return { comparable: true, deltas };
}

/**
 * Автоматичне проставляння тегів сутностей моделлю Jev (постановка власника
 * 03.11.2026): «якщо в абзаці є ознаки сутності за ймовірності не менше 95
 * відсотків — поставити відповідний тег; більше 12 тегів на абзац не давати».
 *
 * ЧОМУ ЦЕ ВОРОТА, А НЕ ДРУГИЙ ПОШУК. У Студії вже є AI-1 (`mentions.ts`): він
 * читає абзаци розділу й пропонує згадки з доказом і готовим тегом, а автор
 * підтверджує кожну вручну. Jev тут робить іншу роботу — він НЕ шукає сутності
 * в тексті, а ВИРІШУЄ, чи кожна знайдена справді там є, і дає цьому число.
 * Саме тому поріг має сенс: `confidence` від LLM — це самооцінка моделі, а
 * `noul` від Jev — відкалібрована ймовірність «так» (ТЗ-H §6, адаптер
 * `server/ai/adapters/jev`). Ворота з чужим числом були б порогом ні на чому.
 *
 * ЧОМУ НЕ ПИТАЄМО ПРО ВСІ 118. Абзац × 118 питань — це і 64k токенів на запит
 * (ліміт провайдера; 32k із них — стан), і 1200 запитів/хв на книгу в
 * пів мільйона знаків, і гроші за кожну сутність, якої в тексті немає зовсім.
 * Кандидатів дає AI-1, Jev їх відсіює. Наслідок, який треба називати вголос:
 * сутність, якої AI-1 не помітив, Jev не підтвердить — її просто не спитають.
 *
 * ЧОМУ ЛІМІТ БЕРЕТЬСЯ З РЕЄСТРУ. `MAX_ENTITIES_PER_PARAGRAPH` уже є і вже
 * діє в редакторі та панелі сутностей. Друге число «12» у цьому файлі
 * розійшлося б із першим при першій же зміні, і розбіжність помітили б не
 * раніше, ніж автор побачив би тринадцятий тег.
 */

import { createHash } from 'node:crypto';
import { noulProbability, type JevAdapter, type JevQuestion } from '../../ai/adapters/jev';
import { MAX_ENTITIES_PER_PARAGRAPH, parseAnyEntityTags } from '../../../src/utils/coreEntities';

/** Поріг із постановки власника: 95 відсотків, не менше. */
export const JEV_TAG_THRESHOLD = 0.95;

/**
 * Межі порогу, який автор обирає сам (постановка власника 03.11.2026: «від 70 до
 * 100%»). Нижче 70% відповідь Jev — це вже здогад, а не ознака сутності; вище 100%
 * не буває. Межі живуть тут, а не в панелі, щоб сервер не повірив значенню з
 * запиту, якого панель ніколи б не надіслала.
 */
export const JEV_TAG_MIN_THRESHOLD = 0.7;
export const JEV_TAG_MAX_THRESHOLD = 1;

/**
 * Поріг із тіла запиту. Відсутній — типові 95%. Число поза 0,70–1,00 — відмова з
 * поясненням, а не тихе підтискання: автор, який ввів 40%, має дізнатись, що це
 * не прийнято, а не отримати теги за 70%.
 */
export function parseJevThreshold(raw: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: JEV_TAG_THRESHOLD };
  const n = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(n) || n < JEV_TAG_MIN_THRESHOLD - 1e-9 || n > JEV_TAG_MAX_THRESHOLD + 1e-9) {
    return {
      ok: false,
      error: `Толерантність має бути числом від ${Math.round(JEV_TAG_MIN_THRESHOLD * 100)}% до ${Math.round(JEV_TAG_MAX_THRESHOLD * 100)}% (передавайте частку від 0,70 до 1).`,
    };
  }
  return { ok: true, value: Math.round(n * 1000) / 1000 };
}

/**
 * Скільки кандидатів щонайбільше йде в один запит. Не ліміт тегів (той — 12),
 * а межа розміру запиту: питання несуть назви сутностей, і на довгому абзаці
 * з двома десятками кандидатів стан плюс питання вже підпирають 32k.
 */
export const JEV_MAX_QUESTIONS_PER_PARAGRAPH = 24;

/** Кандидат на тег: одна пропозиція AI-1 про один абзац. */
export interface JevTagCandidate {
  /** Id висновку AI-1 — щоб потім позначити його розглянутим. */
  findingId: string;
  paragraphId: string;
  /** Постійний номер блоку в редакторі; без нього тег нікуди поставити. */
  editorPid: string | null;
  entitySlug: string;
  entityName: string;
  /** Готовий тег `[/slug:значення]`, як його склав AI-1. */
  tag: string;
}

/** Абзац разом з усіма кандидатами на нього. */
export interface JevTagParagraph {
  paragraphId: string;
  editorPid: string | null;
  text: string;
  candidates: JevTagCandidate[];
}

export type JevTagRejection =
  | 'below_threshold'
  | 'paragraph_full'
  | 'duplicate'
  | 'no_answer'
  | 'not_asked';

/** Рішення про один тег. `accepted` — ставити; інакше `reason` каже чому ні. */
export interface JevTagDecision {
  findingId: string;
  paragraphId: string;
  editorPid: string | null;
  entitySlug: string;
  entityName: string;
  tag: string;
  /** Ймовірність від Jev, 0–1; `null`, якщо відповіді не було. */
  probability: number | null;
  accepted: boolean;
  reason?: JevTagRejection;
}

/** Id питання для кандидата. Детермінований: відповідь треба зіставити назад. */
export function questionId(index: number): string {
  return `tag_${index}`;
}

/**
 * Питання до Jev — по одному `noul` на кандидата, усі в одному запиті.
 *
 * Формулювання свідомо вузьке: «ознаки сутності В ЦЬОМУ абзаці», а не «чи
 * стосується абзац сутності». Друге дало б «так» майже на все, що згадано в
 * розділі, і поріг 95% перестав би щось відсівати.
 */
export function tagQuestion(c: JevTagCandidate, index: number): JevQuestion {
  return {
    id: questionId(index),
    kind: 'noul' as const,
    instructions:
      `Чи є в цьому абзаці ознаки сутності «${c.entityName}» (тип «${c.entitySlug}»)? ` +
      'Відповідай лише про наведений абзац, не про розділ і не про книгу загалом.',
  };
}

export function tagQuestions(candidates: readonly JevTagCandidate[]): JevQuestion[] {
  return candidates.slice(0, JEV_MAX_QUESTIONS_PER_PARAGRAPH).map((c, i) => tagQuestion(c, i));
}

/** Стан для Jev: сам абзац і нічого зайвого — ліміт 32k саме на стан. */
export function tagState(paragraph: JevTagParagraph): Record<string, unknown> {
  return { paragraph: paragraph.text };
}

/**
 * Рішення по одному абзацу з уже отриманих відповідей.
 *
 * Порядок саме такий: спершу поріг, потім відсів повторів, і лише потім
 * ліміт. Якби ліміт стояв першим, дванадцять місць могли б зайняти теги з
 * ймовірністю нижче порогу, і найпевніший кандидат не поміщався б.
 */
export function decideParagraph(
  paragraph: JevTagParagraph,
  answers: Record<string, unknown>,
  opts: { threshold?: number; maxPerParagraph?: number; maxQuestions?: number } = {}
): JevTagDecision[] {
  const threshold = opts.threshold ?? JEV_TAG_THRESHOLD;
  const limit = opts.maxPerParagraph ?? MAX_ENTITIES_PER_PARAGRAPH;
  // Скільки кандидатів реально спитано. Типово 24 — один запит; повне
  // сканування за всіма типами шле кілька запитів і передає тут своє число,
  // інакше все, що понад 24, мовчки вважалось би «не спитаним».
  const maxQuestions = opts.maxQuestions ?? JEV_MAX_QUESTIONS_PER_PARAGRAPH;
  const asked = paragraph.candidates.slice(0, maxQuestions);

  // Теги, які вже стоять у цьому абзаці, займають місця з тих самих 12 —
  // інакше автоматика додала б дванадцять поверх наявних.
  const present = parseAnyEntityTags(paragraph.text);
  const taken = new Set(present.map((t) => t.slug));
  let free = Math.max(0, limit - present.length);

  const scored = asked.map((c, i) => {
    const probability = noulProbability(answers[questionId(i)]);
    return { candidate: c, probability };
  });

  // Найпевніші першими: якщо вільних місць менше, ніж кандидатів над порогом,
  // мають лишитися ті, у яких Jev упевнений більше.
  const order = [...scored].sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1));
  const accepted = new Set<string>();

  for (const row of order) {
    if (row.probability === null) continue;
    if (row.probability < threshold) continue;
    if (taken.has(row.candidate.entitySlug)) continue;
    if (free <= 0) continue;
    accepted.add(row.candidate.findingId);
    taken.add(row.candidate.entitySlug);
    free -= 1;
  }

  const out: JevTagDecision[] = scored.map(({ candidate, probability }) => {
    const base = {
      findingId: candidate.findingId,
      paragraphId: candidate.paragraphId,
      editorPid: candidate.editorPid,
      entitySlug: candidate.entitySlug,
      entityName: candidate.entityName,
      tag: candidate.tag,
      probability,
    };
    if (accepted.has(candidate.findingId)) return { ...base, accepted: true };
    const reason: JevTagRejection =
      probability === null
        ? 'no_answer'
        : probability < threshold
          ? 'below_threshold'
          : present.some((t) => t.slug === candidate.entitySlug)
            ? 'duplicate'
            : 'paragraph_full';
    return { ...base, accepted: false, reason };
  });

  // Кандидати, які не влізли в один запит, чесно позначаються, а не зникають.
  for (const c of paragraph.candidates.slice(maxQuestions)) {
    out.push({
      findingId: c.findingId,
      paragraphId: c.paragraphId,
      editorPid: c.editorPid,
      entitySlug: c.entitySlug,
      entityName: c.entityName,
      tag: c.tag,
      probability: null,
      accepted: false,
      reason: 'not_asked',
    });
  }
  return out;
}

/**
 * Пам'ять відповідей Jev: ймовірність «сутність є в абзаці» за ключем
 * «проєкт · абзац · відбиток тексту · сутність».
 *
 * НАВІЩО. Автор знижує толерантність і повторює прогін для тих, кого не проставлено.
 * Jev на те саме питання про той самий текст відповів би тим самим числом, тож
 * платити за друге звернення нема за що: повтор лише перерішує вже відомі
 * ймовірності за новим порогом. Відбиток тексту в ключі — щоб правка абзацу не
 * віддала стару відповідь на новий текст.
 *
 * Пам'ять у процесі, не в базі: перезапуск сервера її обнуляє, і тоді повтор
 * просто спитає Jev ще раз. Це дешевше за окрему таблицю, а помилитись тут
 * неможливо — лише заплатити копійки.
 */
export class JevAnswerCache {
  private map = new Map<string, number>();
  constructor(private readonly max = 50_000) {}
  get(key: string): number | undefined {
    return this.map.get(key);
  }
  set(key: string, probability: number): void {
    if (this.map.size >= this.max && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, probability);
  }
  get size(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
}

/** Одна пам'ять на процес сервера — її ділять усі прогони кнопки Jev. */
export const sharedJevAnswerCache = new JevAnswerCache();

export function jevAnswerKey(scope: string, paragraph: JevTagParagraph, candidate: JevTagCandidate): string {
  const hash = createHash('sha1').update(paragraph.text).digest('hex').slice(0, 16);
  return `${scope}|${paragraph.paragraphId}|${hash}|${candidate.entitySlug}|${candidate.entityName}`;
}

export interface JevTagRunResult {
  decisions: JevTagDecision[];
  /** Абзаци, на яких Jev відмовив; прогін через це не зупиняється. */
  failures: Array<{ paragraphId: string; error: string }>;
  /** Скільки питань справді пішло до Jev (за них платить платформа). */
  asked: number;
  /** Скільки відповідей узято з пам'яті без звернення до Jev. */
  fromCache: number;
  inputTokens: number;
}

/**
 * Прогін по абзацах: один запит на абзац.
 *
 * Невдача на одному абзаці не валить решту — автор має отримати те, що
 * вдалося, а не порожній екран через один 429. Збій називається в `failures`,
 * бо «тегів не проставлено» і «Jev не відповів» — різні речі для того, хто
 * потім дивиться на результат.
 */
export async function runJevTagging(
  paragraphs: readonly JevTagParagraph[],
  adapter: JevAdapter,
  opts: {
    threshold?: number;
    maxPerParagraph?: number;
    signal?: AbortSignal;
    /** Пам'ять відповідей: що в ній є, до Jev не питається. */
    cache?: JevAnswerCache;
    /** Область ключів пам'яті — id проєкту. */
    scope?: string;
  } = {}
): Promise<JevTagRunResult> {
  if (!adapter.askState) {
    throw new Error('Адаптер Jev не вміє askState — автоматичні теги потребують питань над станом.');
  }
  const decisions: JevTagDecision[] = [];
  const failures: JevTagRunResult['failures'] = [];
  let asked = 0;
  let fromCache = 0;
  let inputTokens = 0;
  const scope = opts.scope ?? '';

  for (const paragraph of paragraphs) {
    if (!paragraph.candidates.length) continue;
    const candidates = paragraph.candidates.slice(0, JEV_MAX_QUESTIONS_PER_PARAGRAPH);
    const answers: Record<string, unknown> = {};
    const fresh: number[] = [];
    candidates.forEach((c, i) => {
      const hit = opts.cache?.get(jevAnswerKey(scope, paragraph, c));
      if (hit === undefined) fresh.push(i);
      else {
        answers[questionId(i)] = { type: 'noul', noul: hit };
        fromCache += 1;
      }
    });
    if (fresh.length) {
      try {
        // Ідентифікатори питань лишаються позиційними (`tag_<індекс у повному списку>`),
        // тож відповіді з пам'яті й свіжі лягають в одну таблицю без перенумерації.
        const raw = await adapter.askState(tagState(paragraph), fresh.map((i) => tagQuestion(candidates[i], i)), { signal: opts.signal });
        asked += fresh.length;
        inputTokens += raw.usage?.input_tokens ?? 0;
        for (const i of fresh) {
          const a = (raw.answers || {})[questionId(i)];
          answers[questionId(i)] = a;
          const p = noulProbability(a);
          if (p !== null) opts.cache?.set(jevAnswerKey(scope, paragraph, candidates[i]), p);
        }
      } catch (err) {
        failures.push({ paragraphId: paragraph.paragraphId, error: (err as Error).message });
        continue;
      }
    }
    decisions.push(...decideParagraph(paragraph, answers, opts));
  }
  return { decisions, failures, asked, fromCache, inputTokens };
}

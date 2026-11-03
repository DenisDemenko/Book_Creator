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

import { noulProbability, type JevAdapter, type JevQuestion } from '../../ai/adapters/jev';
import { MAX_ENTITIES_PER_PARAGRAPH, parseAnyEntityTags } from '../../../src/utils/coreEntities';

/** Поріг із постановки власника: 95 відсотків, не менше. */
export const JEV_TAG_THRESHOLD = 0.95;

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
export function tagQuestions(candidates: readonly JevTagCandidate[]): JevQuestion[] {
  return candidates.slice(0, JEV_MAX_QUESTIONS_PER_PARAGRAPH).map((c, i) => ({
    id: questionId(i),
    kind: 'noul' as const,
    instructions:
      `Чи є в цьому абзаці ознаки сутності «${c.entityName}» (тип «${c.entitySlug}»)? ` +
      'Відповідай лише про наведений абзац, не про розділ і не про книгу загалом.',
  }));
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

export interface JevTagRunResult {
  decisions: JevTagDecision[];
  /** Абзаци, на яких Jev відмовив; прогін через це не зупиняється. */
  failures: Array<{ paragraphId: string; error: string }>;
  asked: number;
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
  opts: { threshold?: number; maxPerParagraph?: number; signal?: AbortSignal } = {}
): Promise<JevTagRunResult> {
  if (!adapter.askState) {
    throw new Error('Адаптер Jev не вміє askState — автоматичні теги потребують питань над станом.');
  }
  const decisions: JevTagDecision[] = [];
  const failures: JevTagRunResult['failures'] = [];
  let asked = 0;
  let inputTokens = 0;

  for (const paragraph of paragraphs) {
    if (!paragraph.candidates.length) continue;
    const questions = tagQuestions(paragraph.candidates);
    try {
      const raw = await adapter.askState(tagState(paragraph), questions, { signal: opts.signal });
      asked += questions.length;
      inputTokens += raw.usage?.input_tokens ?? 0;
      decisions.push(...decideParagraph(paragraph, raw.answers || {}, opts));
    } catch (err) {
      failures.push({ paragraphId: paragraph.paragraphId, error: (err as Error).message });
    }
  }
  return { decisions, failures, asked, inputTokens };
}

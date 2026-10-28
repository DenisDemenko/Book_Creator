/**
 * Відправка чернетки за фото: з чого складається результат у Studio.
 * Чисті відображення (без сховищ) — їх перевіряє тест; запис робить
 * photoDraftSinks.ts.
 *
 *   course      → чернетка курсу (`status: draft`): модулі, уроки, фото уроків із
 *                 медіатеки автора. Ціну, категорію й відео автор додає в Studio.
 *   instruction → експрес-чернетка майстра «Інструкція з фото й техдокументації»
 *                 (track technical_instruction): кожен крок — підтверджене джерело з
 *                 кадром, готова пропозиція кроків чекає лише перевірки автора.
 *                 Експрес-чернетки живуть 24 години (expressStore.TTL_MS) — застосунок
 *                 має сказати про це автору.
 *   book        → «Вхідні» книги: по одному запису на урок із текстом уроку,
 *                 назвою модуля як главою й назвою уроку як розділом.
 */

import { LIBRARY_MEDIA_PREFIX } from '../../src/utils/libraryMediaUrl';
import { ORIGIN_LESSON_FIELDS, type CourseOrigin, type OriginLessonField } from '../courseOrigin';
import type { DraftLesson, DraftModule } from '../../shared/photoDraftContract';
import { technicalInputHash } from '../technicalInstruction';
import type { StoredDraft } from './photoDraftStore';

export const libraryUrl = (assetId: string): string => `${LIBRARY_MEDIA_PREFIX}/${assetId}`;

const LEVEL_UK: Record<string, string> = { beginner: 'початківці', intermediate: 'середній рівень', advanced: 'просунутий рівень' };

function assetOf(draft: StoredDraft, photoId: string): string | null {
  return draft.photos.find((p) => p.photoId === photoId)?.assetId ?? null;
}

// ---------------------------------------------------------------------------
// Курс
// ---------------------------------------------------------------------------

export interface CourseInputLesson {
  id: string;
  title: string;
  goal?: string;
  description?: string;
  topics: string[];
  photoUrls: string[];
}
export interface CourseInputModule {
  id: string;
  title: string;
  summary?: string;
  lessons: CourseInputLesson[];
  skillIds: string[];
}
export interface CourseInput {
  title: string;
  summary?: string;
  audience: string[];
  coverUrl?: string;
  /** Позначка «створено за фото» і поля, що написав ШІ (дивись server/courseOrigin.ts). */
  origin: CourseOrigin;
  modules: CourseInputModule[];
}

/** Поля уроку, написані ШІ й не правлені викладачем у чернетці; `body` у чернетці — це `description` курсу. */
function aiFieldsOf(lesson: DraftLesson): OriginLessonField[] {
  const fields = lesson.aiFields.map((f) => (f === 'body' ? 'description' : f)).filter((f): f is OriginLessonField => (ORIGIN_LESSON_FIELDS as readonly string[]).includes(f));
  return fields.filter((f) => (f === 'description' ? !!lesson.body : f === 'goal' ? !!lesson.goal : f === 'topics' ? lesson.topics.length > 0 : !!lesson.title));
}

export function toCourseInput(draft: StoredDraft, opts: { at: string; ai?: { calls: number; costUsd: number } | null }): CourseInput {
  const aiFields: Record<string, OriginLessonField[]> = {};
  for (const m of draft.structure?.modules ?? []) {
    for (const l of m.lessons) {
      const fields = aiFieldsOf(l);
      if (fields.length) aiFields[l.lessonId] = fields;
    }
  }
  const modules = (draft.structure?.modules ?? []).map(
    (m): CourseInputModule => ({
      id: m.moduleId,
      title: m.title,
      ...(m.summary ? { summary: m.summary } : {}),
      skillIds: [],
      lessons: m.lessons.map(
        (l): CourseInputLesson => ({
          id: l.lessonId,
          title: l.title,
          ...(l.goal ? { goal: l.goal } : {}),
          ...(l.body ? { description: l.body } : {}),
          topics: l.topics,
          photoUrls: l.photoIds.map((id) => assetOf(draft, id)).filter((a): a is string => !!a).map(libraryUrl),
        })
      ),
    })
  );
  const firstPhoto = [...draft.photos].sort((a, b) => a.order - b.order)[0];
  const summary = [draft.craft, draft.level ? `Рівень: ${LEVEL_UK[draft.level]}` : null].filter(Boolean).join('. ');
  return {
    title: (draft.title || '').trim(),
    ...(summary ? { summary } : {}),
    audience: draft.audience ? [draft.audience] : [],
    ...(firstPhoto ? { coverUrl: libraryUrl(firstPhoto.assetId) } : {}),
    origin: {
      kind: 'photo-draft',
      draftId: draft.id,
      createdAt: opts.at,
      photoCount: draft.photos.length,
      aiFields,
      ...(opts.ai ? { ai: opts.ai } : {}),
    },
    modules,
  };
}

// ---------------------------------------------------------------------------
// Експрес-інструкція (майстер «Інструкція з фото й техдокументації»)
// ---------------------------------------------------------------------------

/** Скільки джерел і кроків приймає майстер інструкцій Studio (wizardValidation, technicalInstruction). */
export const TECHNICAL_MAX_SOURCES = 20;
export const TECHNICAL_MAX_STEPS = 60;

const STEP_LINE = /^\s*\*\*(Деталі|Інструменти|Увага|Результат кроку):\*\*\s*(.*)$/;

export interface ParsedStepBody {
  description: string;
  components: string;
  toolsResources: string;
  warning: string;
  successCriterion: string;
}

/**
 * Текст кроку (Markdown з проходу 3) → поля кроку майстра інструкцій. Рядки
 * «**Деталі:** …», «**Інструменти:** …», «**Увага:** …», «**Результат кроку:** …»
 * стають окремими полями, решта — описом. Заголовок «## назва» на початку
 * відкидається: назва кроку є в самому кроці. Нерозпізнане не губиться: без
 * підписаних рядків увесь текст лишається описом.
 */
export function parseStepBody(body: string | null, title: string): ParsedStepBody {
  const fields: Record<string, string[]> = { Деталі: [], Інструменти: [], Увага: [], 'Результат кроку': [] };
  const rest: string[] = [];
  let first = true;
  for (const line of String(body ?? '').replace(/\r\n/g, '\n').split('\n')) {
    if (first && /^\s*#{1,6}\s/.test(line)) {
      first = false;
      continue;
    }
    if (line.trim()) first = false;
    const m = STEP_LINE.exec(line);
    if (m) {
      if (m[2].trim()) fields[m[1]].push(m[2].trim());
    } else rest.push(line);
  }
  const description = rest.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return {
    description: description || title,
    components: fields['Деталі'].join('; '),
    toolsResources: fields['Інструменти'].join('; '),
    warning: fields['Увага'].join('; '),
    successCriterion: fields['Результат кроку'].join('; '),
  };
}

const unique = (items: string[], max: number): string[] => [...new Set(items.map((i) => i.trim()).filter(Boolean))].slice(0, max);

export function toExpressPayload(draft: StoredDraft): Record<string, unknown> {
  const mode = draft.instructionMode ?? 'assembly';
  const byPhoto = new Map(draft.photos.map((p) => [p.photoId, p]));
  const lessons = (draft.structure?.modules ?? []).flatMap((m) => m.lessons.map((l) => ({ module: m, lesson: l })));

  // Одне джерело на крок (не більше 20): текст кроку + описи його кадрів; кадр — перший із кроку.
  const sources: Array<{ id: string; kind: 'photo' | 'note'; title: string; text: string; approved: true; assetId?: string }> = [];
  const sourceOf: string[] = [];
  lessons.forEach(({ lesson }, i) => {
    const frames = lesson.photoIds.map((id) => byPhoto.get(id)).filter((p): p is NonNullable<typeof p> => !!p);
    const text = [
      lesson.body?.trim() || lesson.title,
      ...frames.map((p) => `Кадр №${p.order}: ${p.description ?? '(без опису)'}`),
    ].join('\n\n');
    if (i < TECHNICAL_MAX_SOURCES) {
      const lead = frames[0];
      sources.push({
        id: `src-${i + 1}`,
        kind: lead ? 'photo' : 'note',
        title: lesson.title.slice(0, 300),
        text: text.slice(0, 100_000),
        approved: true,
        ...(lead ? { assetId: lead.assetId } : {}),
      });
      sourceOf.push(`src-${i + 1}`);
    } else {
      // Понад межу — крок лишається, а його джерелом стає останнє, куди й дописуємо текст.
      const last = sources[sources.length - 1];
      last.text = `${last.text}\n\n${lesson.title}\n${text}`.slice(0, 100_000);
      sourceOf.push(last.id);
    }
  });

  const parsed = lessons.map(({ lesson }) => ({ lesson, ...parseStepBody(lesson.body, lesson.title) }));
  const fallbackCriterion = 'Крок виконано, як показано на кадрах.';
  let steps = parsed.map((p, i) => ({
    title: p.lesson.title || `Крок ${i + 1}`,
    description: p.description,
    components: p.components,
    toolsResources: p.toolsResources,
    warning: p.warning,
    successCriterion: p.successCriterion || p.lesson.goal || fallbackCriterion,
    sourceIds: [sourceOf[i]],
    needsVerification: p.lesson.aiFields.includes('body'),
  }));
  if (steps.length > TECHNICAL_MAX_STEPS) {
    // Майстер приймає до 60 кроків: зайві дописуються до останнього, а не губляться.
    const keep = steps.slice(0, TECHNICAL_MAX_STEPS);
    const tail = steps.slice(TECHNICAL_MAX_STEPS);
    keep[keep.length - 1].description += '\n\n' + tail.map((s) => `${s.title}: ${s.description}`).join('\n\n');
    steps = keep;
  }

  const goal = (draft.structure?.modules ?? []).map((m) => m.summary).filter(Boolean).join(' ').slice(0, 10_000) || `Кроки за кадрами майстра${draft.craft ? `: ${draft.craft}` : ''}.`;
  const title = (draft.title || '').trim().slice(0, 500);
  const modelCode = (draft.modelCode || '').slice(0, 500);
  const settings = { mode, title, modelCode, goal };
  const proposal = {
    title,
    modelCode,
    description: goal,
    materials: [] as { code: string; name: string; qty: string }[],
    tools: unique(parsed.flatMap((p) => (p.toolsResources ? p.toolsResources.split(';') : [])), 100),
    warnings: unique(parsed.flatMap((p) => (p.warning ? [p.warning] : [])), 100),
    steps,
    finalChecks: [] as string[],
    questions: [] as string[],
    inputHash: technicalInputHash(settings, sources as any),
  };
  return {
    track: 'technical_instruction',
    useAi: true,
    ...(draft.audience ? { audience: draft.audience.slice(0, 500) } : {}),
    // Кадри — власні фото викладача, які він сам відправив: дозвіл на використання є.
    sourcesPermission: true,
    sourceMaterials: sources,
    technical: { ...settings, proposal },
  };
}

// ---------------------------------------------------------------------------
// «Вхідні» книги
// ---------------------------------------------------------------------------

export interface InboxItem {
  assetId: string;
  imageUrl: string;
  text: string;
  chapterTitle: string;
  sectionTitle: string;
}

export function toInboxItems(draft: StoredDraft): InboxItem[] {
  const fallback = [...draft.photos].sort((a, b) => a.order - b.order)[0]?.assetId ?? null;
  const items: InboxItem[] = [];
  for (const m of draft.structure?.modules ?? []) {
    for (const l of m.lessons as DraftLesson[]) {
      const assetId = (l.photoIds.map((id) => assetOf(draft, id)).find(Boolean) as string | undefined) ?? fallback;
      if (!assetId || !l.body) continue;
      items.push({ assetId, imageUrl: libraryUrl(assetId), text: l.body, chapterTitle: m.title, sectionTitle: l.title });
    }
  }
  return items;
}

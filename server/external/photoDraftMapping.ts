/**
 * Відправка чернетки за фото: з чого складається результат у Studio.
 * Чисті відображення (без сховищ) — їх перевіряє тест; запис робить
 * photoDraftSinks.ts.
 *
 *   course      → чернетка курсу (`status: draft`): модулі, уроки, фото уроків із
 *                 медіатеки автора. Ціну, категорію й відео автор додає в Studio.
 *   instruction → експрес-чернетка з напрямом «instruction»: кожен модуль — одне
 *                 підтверджене джерело-нотатка. Експрес-чернетки живуть 24 години
 *                 (expressStore.TTL_MS) — застосунок має про це сказати автору.
 *   book        → «Вхідні» книги: по одному запису на урок із текстом уроку,
 *                 назвою модуля як главою й назвою уроку як розділом.
 */

import { LIBRARY_MEDIA_PREFIX } from '../../src/utils/libraryMediaUrl';
import type { DraftLesson, DraftModule } from '../../shared/photoDraftContract';
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
  modules: CourseInputModule[];
}

export function toCourseInput(draft: StoredDraft): CourseInput {
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
    modules,
  };
}

// ---------------------------------------------------------------------------
// Експрес-інструкція
// ---------------------------------------------------------------------------

function moduleText(m: DraftModule): string {
  const parts: string[] = [];
  if (m.summary) parts.push(m.summary);
  for (const l of m.lessons) parts.push(l.body ? l.body.trim() : `## ${l.title}`);
  return parts.join('\n\n');
}

export function toExpressPayload(draft: StoredDraft): Record<string, unknown> {
  const modules = draft.structure?.modules ?? [];
  const sources = modules.map((m) => ({
    id: m.moduleId,
    kind: 'note' as const,
    title: m.title.slice(0, 300),
    text: moduleText(m).slice(0, 100_000),
    approved: true,
  }));
  return {
    track: 'instruction',
    useAi: true,
    entryMode: 'existing_materials',
    seed: (draft.title || '').slice(0, 4000),
    ...(draft.audience ? { audience: draft.audience.slice(0, 500) } : {}),
    scenarioInputs: {
      preserve: 'Кроки, послідовність і попередження зберегти як у джерелах: їх написано за кадрами майстра.',
      ...(draft.craft ? { missing: `Ремесло: ${draft.craft}`.slice(0, 16000) } : {}),
    },
    sourceMaterials: sources,
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

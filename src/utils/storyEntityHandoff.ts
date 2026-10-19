import type { Book, Chapter, Section } from '../types';
import { buildEntityTag, entityBySlug, MAX_ENTITIES_PER_PARAGRAPH, stripEntityTags } from './coreEntities';

/**
 * Story & Experience → manuscript handoff (author-owned Screenplay text).
 * Session-based sources MUST be verified and approved by the server first;
 * this client helper deliberately refuses to treat a demo session as proof.
 */
export type StoryHandoffKind = 'screenplay' | 'mafia' | 'constellation' | 'leela';
export interface StoryHandoffSource {
  kind: StoryHandoffKind;
  sourceId: string;
  title: string;
}
export interface StoryHandoffTag {
  slug: string;
  value: string;
}
export type StoryHandoffTarget =
  | { placement: 'existing'; chapterId: string; sectionId: string }
  | { placement: 'new-section'; chapterId: string; title: string }
  | { placement: 'new-chapter'; title: string };

export interface StoryHandoffRequest {
  source: StoryHandoffSource;
  text: string;
  target: StoryHandoffTarget;
  tags: StoryHandoffTag[];
  expectedRevision: number;
}
export interface StoryHandoffResult {
  book: Book;
  chapterId: string;
  sectionId: string;
}

const newId = (): string => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : 'handoff-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const cleanText = (text: string): string => stripEntityTags(text).trim();
const normalized = (text: string): string => text.replace(/\s+/g, ' ').trim().toLocaleLowerCase('uk-UA');
const hasHtml = (text: string): boolean => /<\/?(?:p|div|h[1-6]|ul|ol|li|strong|em|span|br)\b/i.test(text);
const htmlEscape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const formattedText = (text: string, tags: StoryHandoffTag[], richText: boolean): string => {
  const prefix = tags.map(tag => buildEntityTag(tag.slug, tag.value)).join(' ');
  if (!richText) return (prefix ? prefix + '\n\n' : '') + text;
  const paragraphs = text.split(/\n\s*\n/).map(p => '<p>' + htmlEscape(p.trim()).replace(/\n/g, '<br>') + '</p>');
  return (prefix ? '<p>' + htmlEscape(prefix) + '</p>' : '') + paragraphs.join('');
};

export function buildStoryHandoffBook(book: Book, request: StoryHandoffRequest): StoryHandoffResult {
  if (request.source.kind !== 'screenplay') {
    throw new Error('Для ігрових сесій потрібні серверне підтвердження дозволів та згод усіх учасників.');
  }
  if (request.expectedRevision !== book.revisionNumber) {
    throw new Error('Книгу змінено. Перевірте актуальний розділ та повторіть перенесення.');
  }
  const text = cleanText(request.text);
  if (!text) throw new Error('Додайте текст, який потрібно перенести.');
  if (text.length > 100000) throw new Error('Перенесіть фрагмент не довший за 100 000 символів.');
  if (!request.source.sourceId.trim()) throw new Error('Немає підтвердженого джерела фрагмента.');
  if (request.tags.length > MAX_ENTITIES_PER_PARAGRAPH) {
    throw new Error('Максимум 12 сутностей в одному абзаці. Зменште набір тегів.');
  }
  const tags: StoryHandoffTag[] = [];
  const seen = new Set<string>();
  for (const candidate of request.tags) {
    const entity = entityBySlug(candidate.slug);
    if (!entity || entity.deprecated) throw new Error('Невідомий або застарілий тип сутності: ' + candidate.slug);
    const value = candidate.value.trim().replace(/[\[\]\r\n]/g, ' ');
    if (!value || value.length > 250) throw new Error('Заповніть коротке значення для «' + entity.nameUk + '».');
    const key = entity.slug + ':' + normalized(value);
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push({ slug: entity.slug, value });
  }
  const target = request.target;
  const now = new Date().toISOString();
  let chapter: Chapter | undefined;
  let section: Section | undefined;
  if (target.placement !== 'new-chapter') {
    chapter = book.chapters.find(row => row.id === target.chapterId);
    if (!chapter) throw new Error('Цільову главу не знайдено.');
  }
  if (target.placement === 'existing') {
    section = chapter?.sections.find(row => row.id === target.sectionId);
    if (!section) throw new Error('Цільовий розділ не знайдено.');
  }
  if (target.placement !== 'existing' && !target.title.trim()) throw new Error('Зазначте назву нової глави або розділу.');
  const destinationContent = section?.content || '';
  // The author must not silently duplicate an existing passage already shown by Screenplay.
  if (section && normalized(stripEntityTags(destinationContent)).includes(normalized(text))) {
    throw new Error('Цей фрагмент уже є у вибраному розділі. Оберіть інше місце або змініть текст.');
  }
  if (section?.storyHandoffs?.some(item => item.kind === request.source.kind
    && item.sourceId === request.source.sourceId && item.text === text)) {
    throw new Error('Такий матеріал із цього джерела вже перенесено в розділ.');
  }
  const richText = hasHtml(destinationContent);
  const fragment = formattedText(text, tags, richText);
  const chapterId = chapter?.id || newId();
  const sectionId = section?.id || newId();
  const provenance = {
    kind: request.source.kind, sourceId: request.source.sourceId,
    sourceTitle: request.source.title, text, addedAt: now,
    tags: tags.map(tag => ({ ...tag })),
  };
  const content = destinationContent
    ? destinationContent + (richText ? '' : '\n\n') + fragment
    : fragment;
  const nextSection: Section = section
    ? { ...section, content, wordCount: cleanText(content).split(/\s+/).filter(Boolean).length,
        characterCount: cleanText(content).length, lastModified: now,
        storyHandoffs: [...(section.storyHandoffs || []), provenance] }
    : { id: sectionId, chapterId, title: target.placement === 'existing' ? '' : target.title.trim(),
        order: (chapter?.sections.length || 0) + 1,
        content, wordCount: cleanText(content).split(/\s+/).filter(Boolean).length,
        characterCount: cleanText(content).length, lastModified: now, storyHandoffs: [provenance] };
  const nextChapters = target.placement === 'new-chapter'
    ? [...book.chapters, { id: chapterId, bookId: book.id, title: target.title.trim(),
        order: book.chapters.length + 1, sections: [nextSection] }]
    : book.chapters.map(item => item.id !== chapterId ? item : {
        ...item, sections: target.placement === 'existing'
          ? item.sections.map(old => old.id === sectionId ? nextSection : old)
          : [...item.sections, nextSection],
      });
  return { book: { ...book, chapters: nextChapters, updatedAt: now }, chapterId, sectionId };
}

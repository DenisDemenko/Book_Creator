import type { Book, Character } from '../../types';
import type { SessionBookExportRequest } from './SessionExportToBookView';

export interface ReviewedSessionBookMaterial {
  /** Server-issued reference to a completed session, never fabricated client-side. */
  sessionId: string;
  /** Sanitized, explicitly exportable narrative content returned by the permission layer. */
  approvedText: string;
  /** True only when the permission layer has approved the export of this content. */
  exportAllowed: boolean;
}
export interface SessionBookCommitResult {
  book: Book;
  createdCharacterIds: string[];
  sectionId: string;
  chapterId: string;
}
const newId = () => typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID() : 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

/** Only accept sanitized, explicit permissions. Never use sample lobby people as source material. */
export function commitSessionToBook(book: Book, request: SessionBookExportRequest, material: ReviewedSessionBookMaterial): SessionBookCommitResult {
  if (!material.sessionId.trim() || !material.exportAllowed || !material.approvedText.trim()) {
    throw new Error('Немає підтвердженого матеріалу сесії, дозволеного для експорту.');
  }
  if (!request.formats.length) throw new Error('Оберіть формат.');
  if (request.privacy === 'none') throw new Error('Для досвіду реальних учасників потрібна анонімізація.');
  if (request.mappings.some((mapping) => !mapping.fictionalName.trim())) throw new Error('У кожного героя має бути вигадане ім’я.');
  if (request.mappings.some((mapping) => ['merge', 'split'].includes(mapping.action))) {
    throw new Error('Об’єднання та розділення героїв потребують підтвердженого mapping від технічного шару.');
  }
  const source = material.approvedText;
  // Refuse identity-containing text that has not been processed upstream.
  // Caller MUST provide already sanitized narrative, not raw transcript or private session state.
  const createdCharacterIds: string[] = [];
  const created: Character[] = [];
  for (const map of request.mappings) {
    const draft = request.characterDrafts.find((d) => d.participantId === map.participantId);
    if (map.action === 'existing') {
      if (!map.existingCharacterId || !book.characters.some(c => c.id === map.existingCharacterId)) {
        throw new Error('Обраного героя немає в цій книзі.');
      }
      continue;
    }
    if (map.action !== 'new') throw new Error('Невідомий тип зіставлення.');
    const id = newId();
    const character: Character = {
      id, bookId: book.id, name: map.fictionalName.trim(), role: 'minor',
      appearance: {}, personality: { strengths: [], weaknesses: [], fears: [], desires: [], goals: draft?.goal ? [draft.goal] : [], motivation: '', internalConflict: draft?.conflict || '' },
      biography: [draft?.bookRole, draft?.archetype].filter(Boolean).join(' · '),
      relationships: [], tags: ['session-derived', 'fictionalized'],
    };
    created.push(character);
    createdCharacterIds.push(id);
  }
  const chapterId = newId();
  const sectionId = newId();
  const now = new Date().toISOString();
  const chapter = {
    id: chapterId, bookId: book.id,
    title: 'Чернетка з досвіду: ' + request.sessionTitle,
    order: book.chapters.length + 1,
    sections: [{
      id: sectionId, chapterId, title: 'Художня адаптація',
      order: 1, content: source, wordCount: source.trim().split(/\s+/).length,
      characterCount: source.length, lastModified: now,
    }],
    cast: [...createdCharacterIds, ...request.mappings.filter(m => m.action === 'existing').map(m => m.existingCharacterId!).filter(Boolean)],
  };
  const next: Book = { ...book, chapters: [...book.chapters, chapter], characters: [...book.characters, ...created], updatedAt: now };
  return { book: next, createdCharacterIds, sectionId, chapterId };
}

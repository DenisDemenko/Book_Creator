/**
 * Server-side canonical registry for completed Story & Experience sessions.
 * No actual participant identities, raw transcripts or private/GM notes enter this shape.
 * Persistence is deliberately NOT implemented in this module; the authenticated
 * storage layer must own records and enforce book ownership on every operation.
 */
export type ExperienceKind = 'mafia' | 'constellation' | 'leela';
export interface ApprovedExperienceEvent {
  id: string;
  label: string;
  description: string;
  approvedForBook: boolean;
  visibility: 'public' | 'approved';
}
export interface CompletedExperienceRecord {
  id: string;
  bookId: string;
  ownerId: string;
  kind: ExperienceKind;
  title: string;
  status: 'completed';
  completedAt: string;
  publicParticipantLabels: string[];
  events: ApprovedExperienceEvent[];
}
export interface ExperienceExportMaterial {
  sessionId: string;
  exportAllowed: true;
  approvedText: string;
}
const validKinds = new Set<ExperienceKind>(['mafia', 'constellation', 'leela']);
export function safeCompletedSessionSummary(
  record: CompletedExperienceRecord,
  request: { ownerId: string; bookId: string; sessionId: string },
): ExperienceExportMaterial {
  if (record.ownerId !== request.ownerId || record.bookId !== request.bookId || record.id !== request.sessionId) {
    throw new Error('Сесію не знайдено.');
  }
  if (record.status !== 'completed' || !validKinds.has(record.kind)) throw new Error('Сесія не завершена.');
  const approved = record.events.filter(e => e.approvedForBook && e.visibility === 'approved');
  if (approved.length === 0) throw new Error('Немає дозволених подій для експорту.');
  const paragraphs = approved.map(e => e.label.trim() + ': ' + e.description.trim()).filter(Boolean);
  const text = paragraphs.join('\n\n').trim();
  if (!text) throw new Error('Дозволені події не містять тексту.');
  return { sessionId: record.id, exportAllowed: true, approvedText: text };
}

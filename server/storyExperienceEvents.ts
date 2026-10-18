/**
 * Canonical event contracts for Story & Experience Engine.
 * This is not an event ingest service: caller must authenticate the principal
 * and enforce session membership before recording an event.
 */
export type ExperienceEventVisibility = 'public' | 'approved' | 'private' | 'moderator-only' | 'secret';
export type ExperienceEventKind = 'game-action' | 'vote' | 'role-change' | 'figure-move' | 'snapshot' | 'leela-move' | 'journal' | 'note';
export interface ExperienceEventRecord {
  id: string;
  sessionId: string;
  sequence: number;
  kind: ExperienceEventKind;
  visibility: ExperienceEventVisibility;
  approvedForBook: boolean;
  label: string;
  description: string;
  occurredAt: string;
}
/** Fail-closed projection; private event content never appears in exportable data. */
export function projectEventsForBook(events: readonly ExperienceEventRecord[]): Array<Pick<ExperienceEventRecord,'id'|'label'|'description'|'visibility'|'approvedForBook'>> {
  return events
    .filter(e => e.visibility === 'approved' && e.approvedForBook === true && e.label.trim() && e.description.trim())
    .sort((a,b) => a.sequence - b.sequence)
    .map(e => ({ id:e.id, label:e.label, description:e.description, visibility:e.visibility, approvedForBook:true }));
}
export function appendEvent(existing: readonly ExperienceEventRecord[], candidate: ExperienceEventRecord): ExperienceEventRecord[] {
  if (existing.some(e => e.id === candidate.id)) throw new Error('Подія вже існує.');
  if (candidate.sequence !== existing.length + 1) throw new Error('Порушено послідовність подій.');
  if (existing.some(e => e.sessionId !== candidate.sessionId)) throw new Error('Події належать різним сесіям.');
  return [...existing, candidate];
}

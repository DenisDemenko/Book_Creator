import { createHash } from 'node:crypto';
/**
 * Server-side canonical registry for completed Story & Experience sessions.
 * No actual participant identities, raw transcripts or private/GM notes enter this shape.
 * Persistence is deliberately NOT implemented in this module; the authenticated
 * storage layer must own records and enforce book ownership on every operation.
 */
import { projectEventsForBook, type ExperienceEventRecord } from './storyExperienceEvents';

export type ExperienceKind = 'mafia' | 'constellation' | 'leela';
export interface ApprovedExperienceEvent {
  id: string;
  label: string;
  description: string;
  approvedForBook: boolean;
  visibility: 'public' | 'approved';
}
export interface SessionConsentDecision {
  participantId: string;
  status: 'granted' | 'revoked';
  decidedAt: string;
  scope: 'book-adaptation';
  materialHash?: string;
}
export interface CompletedExperienceRecord {
  consentRequiredParticipantIds?: string[];
  consentDecisions?: SessionConsentDecision[];
  id: string;
  bookId: string;
  ownerId: string;
  kind: ExperienceKind;
  title: string;
  status: 'completed';
  completedAt: string;
  publicParticipantLabels: string[];
  events: ApprovedExperienceEvent[];
  canonicalEvents?: ExperienceEventRecord[];
}
export interface ExperienceExportMaterial {
  sessionId: string;
  exportAllowed: true;
  approvedText: string;
}
export function consentMaterial(record: CompletedExperienceRecord): { text:string; hash:string } {
  const approved = record.canonicalEvents ? projectEventsForBook(record.canonicalEvents) : record.events.filter(e=>e.approvedForBook && e.visibility==='approved');
  const text = approved.map(e=>e.label.trim()+': '+e.description.trim()).filter(Boolean).join('\n\n').trim();
  return {text,hash:createHash('sha256').update(text,'utf8').digest('hex')};
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
  const material = consentMaterial(record);
  const required = record.consentRequiredParticipantIds ?? [];
  if (required.length && required.some(id => {
    const matching = (record.consentDecisions ?? []).filter(d => d.participantId === id && d.scope === 'book-adaptation');
    return matching.length === 0 || matching[matching.length - 1].status !== 'granted' || matching[matching.length - 1].materialHash !== material.hash;
  })) throw new Error('Згода учасників відсутня або відкликана.');
  const text = material.text;
  if (!text) throw new Error('Дозволені події не містять тексту.');
  return { sessionId: record.id, exportAllowed: true, approvedText: text };
}

/**
 * A narrow allowlist for transferring events from a session engine to the archive review.
 * It is deliberately not a privacy anonymizer or an automatic export permission.
 * Private and unknown visibility categories are excluded before any preview.
 */
export interface SessionEventCandidate {
  id: string;
  label: string;
  description: string;
  visibility: 'public' | 'approved' | 'private' | 'moderator-only' | 'secret';
  approvedForBook: boolean;
}
export interface SafeEventPreview { id: string; label: string; description: string; }
export function eligibleEventPreviews(events: readonly SessionEventCandidate[]): SafeEventPreview[] {
  const ids = new Set<string>();
  return events.filter(e => {
    if (!e || !e.approvedForBook || e.visibility !== 'approved' || typeof e.id !== 'string' || !e.id.trim() || ids.has(e.id)) return false;
    if (typeof e.label !== 'string' || typeof e.description !== 'string') return false;
    ids.add(e.id);
    return e.label.trim().length > 0 && e.description.trim().length > 0;
  }).map(({id,label,description}) => ({id, label:label.trim().slice(0,200), description:description.trim().slice(0,10000)}));
}

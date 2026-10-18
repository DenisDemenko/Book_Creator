import { describe, expect, it } from 'vitest';
import { appendEvent, projectEventsForBook, type ExperienceEventRecord } from './storyExperienceEvents';
import { safeCompletedSessionSummary, type CompletedExperienceRecord } from './storyExperienceRegistry';

const make = (sequence: number, visibility: ExperienceEventRecord['visibility'], approvedForBook = true): ExperienceEventRecord => ({
  id: 'event-' + sequence, sessionId: 'session-1', sequence, kind: 'note',
  visibility, approvedForBook, label:'Label '+sequence, description:'Description '+sequence, occurredAt:'2026-10-18T00:00:00Z',
});
describe('session event privacy boundary', () => {
  it('projects only expressly approved material', () => {
    const input = [make(3,'secret'), make(1,'approved'), make(2,'private'), make(4,'moderator-only'), make(5,'approved',false)];
    expect(projectEventsForBook(input).map(e => e.id)).toEqual(['event-1']);
  });
  it('rejects duplicates, mixed sessions and gaps', () => {
    const first = make(1,'approved');
    expect(appendEvent([],first)).toHaveLength(1);
    expect(() => appendEvent([first],first)).toThrow();
    expect(() => appendEvent([first],make(3,'approved'))).toThrow();
    expect(() => appendEvent([first],{...make(2,'approved'),sessionId:'other'})).toThrow();
  });
  it('does not leak private text through book export', () => {
    const session: CompletedExperienceRecord = {
      id:'session-1',bookId:'book-1',ownerId:'owner-1',kind:'mafia',status:'completed',
      completedAt:'2026-10-18T00:00:00Z',publicParticipantLabels:[],events:[],
      canonicalEvents:[make(1,'approved'),make(2,'secret'),make(3,'private')],
    };
    const result = safeCompletedSessionSummary(session,{ownerId:'owner-1',bookId:'book-1',sessionId:'session-1'});
    expect(result.approvedText).toContain('Description 1');
    expect(result.approvedText).not.toContain('Description 2');
    expect(result.approvedText).not.toContain('Description 3');
    expect(() => safeCompletedSessionSummary(session,{ownerId:'another',bookId:'book-1',sessionId:'session-1'})).toThrow();
  });
});

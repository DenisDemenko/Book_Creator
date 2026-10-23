import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { appendEvent, projectEventsForBook, type ExperienceEventRecord } from './storyExperienceEvents';
import { consentMaterial, safeCompletedSessionSummary, type CompletedExperienceRecord } from './storyExperienceRegistry';

const make = (sequence: number, visibility: ExperienceEventRecord['visibility'], approvedForBook = true): ExperienceEventRecord => ({
  id: 'event-' + sequence, sessionId: 'session-1', sequence, kind: 'note',
  visibility, approvedForBook, label:'Label '+sequence, description:'Description '+sequence, occurredAt:'2026-10-18T00:00:00Z',
});
describe('session event privacy boundary', () => {
  it('projects only expressly approved material', () => {
    const input = [make(3,'secret'), make(1,'approved'), make(2,'private'), make(4,'moderator-only'), make(5,'approved',false)];
    assert.deepEqual(projectEventsForBook(input).map(e => e.id), ['event-1']);
  });
  it('rejects duplicates, mixed sessions and gaps', () => {
    const first = make(1,'approved');
    assert.equal(appendEvent([],first).length, 1);
    assert.throws(() => appendEvent([first],first));
    assert.throws(() => appendEvent([first],make(3,'approved')));
    assert.throws(() => appendEvent([first],{...make(2,'approved'),sessionId:'other'}));
  });
  it('retains distinct IDs for sequential events', () => {
    const first = make(1,'approved');
    const second = make(2,'approved');
    const records = appendEvent(appendEvent([],first),second);
    assert.deepEqual(records.map(event => event.id),['event-1','event-2']);
  });
  it('rejects direct identifiers before presenting consent content', () => {
    const record: CompletedExperienceRecord = {
      id:'session-1',bookId:'book-1',ownerId:'owner-1',kind:'mafia',title:'Session',
      status:'completed',completedAt:'2026-10-18T00:00:00Z',
      publicParticipantLabels:[],events:[],
      canonicalEvents:[{...make(1,'approved'),description:'Contact: user@example.com'}],
      consentRequiredParticipantIds:['participant-1'],
    };
    assert.throws(() => consentMaterial(record));
    assert.throws(() => safeCompletedSessionSummary(record,{ownerId:'owner-1',bookId:'book-1',sessionId:'session-1'}));
  });
  it('blocks export when required consent is missing or revoked', () => {
    const record: CompletedExperienceRecord = {
      id:'session-1',bookId:'book-1',ownerId:'owner-1',kind:'mafia',title:'Session',
      status:'completed',completedAt:'2026-10-18T00:00:00Z',
      publicParticipantLabels:[],events:[],canonicalEvents:[make(1,'approved')],
      consentRequiredParticipantIds:['participant-1'],
    };
    const request={ownerId:'owner-1',bookId:'book-1',sessionId:'session-1'};
    assert.throws(()=>safeCompletedSessionSummary(record,request));
    record.consentDecisions=[{participantId:'participant-1',status:'granted',materialHash:consentMaterial(record).hash,decidedAt:'2026-10-18T00:00:00Z',scope:'book-adaptation'}];
    record.canonicalEvents=[make(1,'approved'),make(2,'approved')];
    assert.throws(()=>safeCompletedSessionSummary(record,request));
    record.canonicalEvents=[make(1,'approved')];
    assert.match(safeCompletedSessionSummary(record,request).approvedText,/Description 1/);
    record.consentDecisions.push({participantId:'participant-1',status:'revoked',decidedAt:'2026-10-18T00:01:00Z',scope:'book-adaptation'});
    assert.throws(()=>safeCompletedSessionSummary(record,request));
  });
  it('requires independent current approvals from every participant before exporting', () => {
    const record: CompletedExperienceRecord = {
      id:'session-1',bookId:'book-1',ownerId:'owner-1',kind:'leela',
      title:'Neutral session',status:'completed',completedAt:'2026-10-18T00:00:00Z',
      publicParticipantLabels:[],events:[],canonicalEvents:[make(1,'approved')],
      consentRequiredParticipantIds:['participant-a','participant-b'],
      consentDecisions:[],
    };
    const request={ownerId:'owner-1',bookId:'book-1',sessionId:'session-1'};
    const hash=consentMaterial(record).hash;
    const approve=(participantId:string,decidedAt:string) => {
      record.consentDecisions!.push({participantId,status:'granted',scope:'book-adaptation',materialHash:hash,decidedAt});
    };
    assert.throws(()=>safeCompletedSessionSummary(record,request),/Згода/);
    approve('participant-a','2026-10-18T00:01:00Z');
    assert.throws(()=>safeCompletedSessionSummary(record,request),/Згода/);
    // An unrelated third-party approval must not satisfy participant B.
    approve('participant-c','2026-10-18T00:02:00Z');
    assert.throws(()=>safeCompletedSessionSummary(record,request),/Згода/);
    approve('participant-b','2026-10-18T00:03:00Z');
    assert.match(safeCompletedSessionSummary(record,request).approvedText,/Description 1/);
    // A later revocation by either participant blocks all further exports.
    record.consentDecisions!.push({
      participantId:'participant-a',status:'revoked',scope:'book-adaptation',decidedAt:'2026-10-18T00:04:00Z'
    });
    assert.throws(()=>safeCompletedSessionSummary(record,request),/Згода/);
    approve('participant-a','2026-10-18T00:05:00Z');
    assert.match(safeCompletedSessionSummary(record,request).approvedText,/Description 1/);
    // Any approved edit changes the digest and invalidates BOTH approvals.
    record.canonicalEvents=[make(1,'approved'),make(2,'approved')];
    assert.throws(()=>safeCompletedSessionSummary(record,request),/Згода/);
  });
  it('does not export a completed session with no approved text', () => {
    const record: CompletedExperienceRecord = {
      id:'session-1',bookId:'book-1',ownerId:'owner-1',kind:'constellation',
      title:'Neutral session',status:'completed',completedAt:'2026-10-18T00:00:00Z',
      publicParticipantLabels:[],events:[],canonicalEvents:[make(1,'private')],
      consentRequiredParticipantIds:['participant-a'],
    };
    record.consentDecisions=[{
      participantId:'participant-a',status:'granted',scope:'book-adaptation',
      materialHash:consentMaterial(record).hash,decidedAt:'2026-10-18T00:01:00Z'
    }];
    assert.throws(()=>safeCompletedSessionSummary(record,{ownerId:'owner-1',bookId:'book-1',sessionId:'session-1'}),/не містять тексту/);
  });
  it('does not leak private text through book export', () => {
    const session: CompletedExperienceRecord = {
      id:'session-1',bookId:'book-1',ownerId:'owner-1',kind:'mafia',title:'Session',status:'completed',
      completedAt:'2026-10-18T00:00:00Z',publicParticipantLabels:[],events:[],
      canonicalEvents:[make(1,'approved'),make(2,'secret'),make(3,'private')],
      consentRequiredParticipantIds:['participant-1'],
    };
    session.consentDecisions=[{participantId:'participant-1',status:'granted',materialHash:consentMaterial(session).hash,decidedAt:'2026-10-18T00:00:00Z',scope:'book-adaptation'}];
    const result = safeCompletedSessionSummary(session,{ownerId:'owner-1',bookId:'book-1',sessionId:'session-1'});
    assert.match(result.approvedText, /Description 1/);
    assert.doesNotMatch(result.approvedText, /Description 2/);
    assert.doesNotMatch(result.approvedText, /Description 3/);
    assert.throws(() => safeCompletedSessionSummary(session,{ownerId:'another',bookId:'book-1',sessionId:'session-1'}));
  });
});

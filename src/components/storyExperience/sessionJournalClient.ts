export type SafeJournalKind = 'mafia' | 'constellation' | 'leela';
export interface JournalSession { sessionId: string; bookId: string; kind: SafeJournalKind; }
const json = async (response: Response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'Помилка журналу сесії');
  return body;
};
export async function createSessionJournal(bookId: string, kind: SafeJournalKind): Promise<JournalSession> {
  const body = await json(await fetch('/api/story-experience/journals', {
    method: 'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({bookId,kind}),
  }));
  if(typeof body.sessionId!=='string')throw new Error('Журнал не створений');
  return {sessionId:body.sessionId,bookId,kind};
}
export async function appendNeutralSessionEvent(session: JournalSession, event: {kind:'snapshot'|'leela-move'|'game-action'; label:string; description:string; eventId:string}): Promise<void> {
  await json(await fetch('/api/story-experience/journals/'+encodeURIComponent(session.sessionId)+'/events',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({...event,bookId:session.bookId}),
  }));
}

export interface JournalReviewEvent {id:string;kind:string;label:string;description:string;visibility:string;approvedForBook:false;}
export async function loadJournalReview(session:JournalSession):Promise<JournalReviewEvent[]> {
  const data=await json(await fetch('/api/story-experience/journals/'+encodeURIComponent(session.sessionId)+'/review?bookId='+encodeURIComponent(session.bookId),{credentials:'same-origin'}));
  return Array.isArray(data.events)?data.events:[];
}
export async function completeSessionJournal(session:JournalSession):Promise<void> {
  await json(await fetch('/api/story-experience/journals/'+encodeURIComponent(session.sessionId)+'/complete',{
    method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({bookId:session.bookId}),
  }));
}

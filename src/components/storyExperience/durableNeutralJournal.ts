import { createSessionJournal, appendNeutralSessionEvent, type JournalSession } from './sessionJournalClient';

export type NeutralEvent = {kind:'snapshot'|'leela-move';label:string;description:string;eventId:string};
type StoredQueue = {version:1;session?:JournalSession; events:NeutralEvent[]};
const prefix='story-experience-neutral-queue-v1:';
function storageKey(ownerId:string,bookId:string,kind:'leela'|'constellation') {return prefix+encodeURIComponent(ownerId)+':'+encodeURIComponent(bookId)+':'+kind;}
function read(ownerId:string,bookId:string,kind:'leela'|'constellation'):StoredQueue {
  try {
    const raw=localStorage.getItem(storageKey(ownerId,bookId,kind));
    if(!raw)return {version:1,events:[]};
    const data=JSON.parse(raw) as StoredQueue;
    if(data.version!==1 || !Array.isArray(data.events) || data.events.length>10000)return {version:1,events:[]};
    if(data.session && (data.session.bookId!==bookId || data.session.kind!==kind))return {version:1,events:[]};
    return data;
  } catch {return {version:1,events:[]};}
}
function persist(ownerId:string,bookId:string,kind:'leela'|'constellation',data:StoredQueue) {
  // Neutral event metadata only: never store real names, private reflections or raw snapshots.
  localStorage.setItem(storageKey(ownerId,bookId,kind),JSON.stringify(data));
}
export class DurableNeutralJournal {
  private queue:StoredQueue;
  private inFlight:Promise<void>=Promise.resolve();
  private error:unknown=null;
  constructor(private readonly ownerId:string,private readonly bookId:string,private readonly kind:'leela'|'constellation') {
    if (!ownerId.trim()) throw new Error('Для журналу потрібен авторизований користувач.');
    this.queue=read(ownerId,bookId,kind);
  }
  append(input:Omit<NeutralEvent,'eventId'>):Promise<void> {
    const event:NeutralEvent={...input,eventId:'event-'+crypto.randomUUID()};
    // Local persistence occurs before dispatch, so reload can replay the same idempotency key.
    this.queue.events.push(event);
    persist(this.ownerId,this.bookId,this.kind,this.queue);
    return this.flush();
  }
  flush():Promise<void> {
    this.inFlight=this.inFlight.catch(()=>undefined).then(async()=>{
      while(this.queue.events.length){
        if(!this.queue.session){
          this.queue.session=await createSessionJournal(this.bookId,this.kind);
          persist(this.ownerId,this.bookId,this.kind,this.queue);
        }
        const event=this.queue.events[0];
        await appendNeutralSessionEvent(this.queue.session,event);
        this.queue.events.shift();
        persist(this.ownerId,this.bookId,this.kind,this.queue);
      }
      this.error=null;
    }).catch(error=>{this.error=error;throw error;});
    return this.inFlight;
  }
  async prepare():Promise<JournalSession|undefined> {
    await this.flush();
    if(this.queue.events.length)throw new Error('Є незбережені події.');
    return this.queue.session;
  }
  get pendingCount(){return this.queue.events.length;}
  get lastError(){return this.error;}
}

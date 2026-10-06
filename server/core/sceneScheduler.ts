import {CoreRuleError} from './rules';
import {metric} from './performance';
const tails=new Map<string,Promise<unknown>>();
const counts=new Map<string,number>();
/** Bounded FIFO admission per project. CAS still owns cross-process turn ordering. */
export async function scheduleScene<T>(projectId:string,work:()=>Promise<T>):Promise<T>{
 const count=counts.get(projectId)??0;if(count>=16||[...counts.values()].reduce((a,b)=>a+b,0)>=128)throw new CoreRuleError('conflict','Черга сцен заповнена. Спробуйте пізніше.');
 counts.set(projectId,count+1);const previous=tails.get(projectId)??Promise.resolve();const queuedAt=performance.now();
 const next=previous.catch(()=>{}).then(async()=>{metric('queue_wait_ms',performance.now()-queuedAt);const start=performance.now();try{return await work();}finally{metric('operation_ms',performance.now()-start);metric('operation_count');}});
 tails.set(projectId,next);try{return await next;}finally{const remaining=counts.get(projectId)!-1;if(remaining)counts.set(projectId,remaining);else counts.delete(projectId);if(tails.get(projectId)===next)tails.delete(projectId);}
}
export class SceneTokenBudget {
 private reserved=0;
 constructor(readonly limit=96_000){}
 reserve(system:string,context:unknown,maxOutput=1800){
  // Conservative bound: UTF-8 bytes bound input tokens; output is provider capped.
  const tokens=Buffer.byteLength(system)+Buffer.byteLength(typeof context==='string'?context:JSON.stringify(context))+maxOutput;
  if(this.reserved+tokens>this.limit)throw new CoreRuleError('conflict','Бюджет токенів операції вичерпано. Скоротіть контекст сцени.');this.reserved+=tokens;return tokens;
 }
}

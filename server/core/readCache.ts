import {createHash} from 'node:crypto';
import {canonicalJson} from '../ai/contracts';
import type {CoreRepository} from './types';
import {metric} from './performance';
const digest=(value:unknown)=>createHash('sha256').update(canonicalJson(value??null)).digest('hex');
type Read={name:string;args:unknown[];hash:string};
type Entry={at:number;reads:Read[];value:unknown;bytes:number};
const caches=new WeakMap<CoreRepository,Map<string,Entry>>();
const roots=new WeakMap<CoreRepository,CoreRepository>();
const pending=new WeakMap<CoreRepository,Map<string,Promise<unknown>>>();
/** Revalidate EVERY repository dependency, including edits without a book revision.
 * Store only output + dependency digests, no plaintext input copies. No Vault reads.
 * The caller must authorize before invoking a builder; cache grants no permission.
 */
export async function cachedRead<T>(repo:CoreRepository,kind:'profile'|'snapshot',key:unknown,build:(tracked:CoreRepository)=>Promise<T>):Promise<T>{
 const root=roots.get(repo)??repo;
 let cache=caches.get(root);if(!cache)caches.set(root,cache=new Map());
 let flights=pending.get(root);if(!flights)pending.set(root,flights=new Map());
 const id=kind+digest(key);const existing=flights.get(id);if(existing){const value=await existing;const entry=cache.get(id);if(root!==repo&&!entry)return build(repo);if(root!==repo&&entry)await Promise.all(entry.reads.map(r=>(repo as any)[r.name](...r.args)));return structuredClone(value) as T;}
 const work=(async()=>{
  const old=cache!.get(id);
  if(old&&Date.now()-old.at<60_000){const fresh=await Promise.all(old.reads.map(async r=>digest(await (repo as any)[r.name](...r.args))===r.hash));if(fresh.every(Boolean)){cache!.delete(id);cache!.set(id,old);metric(`${kind}_hit`);return structuredClone(old.value) as T;}}
  cache!.delete(id);const reads:Read[]=[];
  const tracked=new Proxy(repo,{get(target,name){const method=Reflect.get(target,name);if(typeof method!=='function')return method;return async(...args:unknown[])=>{if(!/^(get|list|find|search|resolve|count)/.test(String(name))||/SecretVault/.test(String(name)))throw new Error('Cache accepts public repository reads only.');const value=await method.apply(target,args);reads.push({name:String(name),args:structuredClone(args),hash:digest(value)});return value;};}});
  roots.set(tracked,root);
  const value=await build(tracked);metric(`${kind}_build`);const bytes=Buffer.byteLength(JSON.stringify({value,reads}));
  if(bytes<1024*1024){cache!.set(id,{at:Date.now(),reads,value:structuredClone(value),bytes});let total=[...cache!.values()].reduce((n,e)=>n+e.bytes,0);while(cache!.size>128||total>8*1024*1024){const first=cache!.keys().next().value!;total-=cache!.get(first)!.bytes;cache!.delete(first);}}
  return value;
 })();flights.set(id,work);try{return structuredClone(await work);}finally{flights.delete(id);}
}

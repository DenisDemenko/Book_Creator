/** Guest storefront consultations use the Studio platform key and a separate platform budget. */
import type { Express, Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getDb } from './db';
import { requireAdmin, requireSupportAgent } from './auth';
import { readBridgeSettings } from './marketplaceBridge';
import { platformKeyFor } from './platformKeys';
import { CHAT_MODELS } from './chatProviders';
import { dispatch, recordTextUsageByModel } from './aiCore';
import { getAppSetting, setAppSetting, findUserById } from './store';

const SETTINGS_KEY='marketplace_assistant';
type Config={model:string;dailyRequests:number;dailyTokens:number;enabled:boolean};
async function config():Promise<Config>{
 const raw=await getAppSetting(SETTINGS_KEY);let v:Partial<Config>={};try{v=JSON.parse(raw||'{}');}catch{}
 return {model:v.model||CHAT_MODELS.find(x=>x.engine==='deepseek')?.id||'',dailyRequests:Math.min(10000,Math.max(1,Number(v.dailyRequests)||500)),dailyTokens:Math.min(20000000,Math.max(1000,Number(v.dailyTokens)||300000)),enabled:v.enabled!==false};
}
function database(){const db=getDb();if(!db)throw Error('database unavailable');db.exec(`CREATE TABLE IF NOT EXISTS marketplace_assistant_requests (id TEXT PRIMARY KEY, day TEXT NOT NULL, status TEXT NOT NULL, reserved INTEGER NOT NULL, tokens INTEGER NOT NULL DEFAULT 0, text TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS marketplace_assistant_budget (day TEXT PRIMARY KEY, requests INTEGER NOT NULL, tokens INTEGER NOT NULL);`);return db;}
function reserve(id:string,amount:number,c:Config){
 const db=database();const day=new Date().toISOString().slice(0,10);
 db.exec('BEGIN IMMEDIATE');
 try{
  const old=db.prepare('SELECT status,text FROM marketplace_assistant_requests WHERE id=?').get(id) as {status:string;text?:string}|undefined;
  if(old){db.exec('COMMIT');return old;}
  const used=db.prepare('SELECT requests,tokens FROM marketplace_assistant_budget WHERE day=?').get(day) as {requests:number;tokens:number}|undefined;
  if((used?.requests||0)>=c.dailyRequests||(used?.tokens||0)+amount>c.dailyTokens)throw Error('budget');
  db.prepare('INSERT INTO marketplace_assistant_budget(day,requests,tokens) VALUES (?,1,?) ON CONFLICT(day) DO UPDATE SET requests=requests+1,tokens=tokens+excluded.tokens').run(day,amount);
  db.prepare("INSERT INTO marketplace_assistant_requests(id,day,status,reserved,created_at) VALUES (?,?,'pending',?,?)").run(id,day,amount,new Date().toISOString());
  db.exec('COMMIT');return null;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
function finish(id:string,result:{text:string;inputTokens:number;outputTokens:number}|null){
 const db=database();db.exec('BEGIN IMMEDIATE');try{
 const row=db.prepare('SELECT day,reserved,status FROM marketplace_assistant_requests WHERE id=?').get(id) as {day:string;reserved:number;status:string};
 if(row.status!=='pending'){db.exec('COMMIT');return;}
 // Keep the reservation on uncertain failures, so a timeout never enables unbounded free retries.
 const tokens=result?result.inputTokens+result.outputTokens:row.reserved;
 db.prepare('UPDATE marketplace_assistant_budget SET tokens=MAX(0,tokens+?) WHERE day=?').run(tokens-row.reserved,row.day);
 db.prepare('UPDATE marketplace_assistant_requests SET status=?,tokens=?,text=? WHERE id=?').run(result?'done':'failed',tokens,result?.text||null,id);
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
async function marketplace(req:Request,path:string,method='GET',body?:unknown){
 const settings=await readBridgeSettings();
 const p=req.principal!;
 const actor=Buffer.from(JSON.stringify({id:p.id,name:(await findUserById(p.id))?.name||'Менеджерка',role:p.role})).toString('base64url');
 const r=await fetch(settings.url.replace(/\/$/,'')+'/assistant/bridge/'+path,{method,redirect:'error',headers:{'x-bridge-key':settings.key,'x-support-actor':actor,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 const value=await r.json().catch(()=>({message:'Маркетплейс тимчасово недоступний'}));return {status:r.status,value};
}
export function registerMarketplaceAssistant(app:Express,deps:{generate?:typeof dispatch}={}){
 app.post('/api/marketplace-assistant/generate',async(req,res)=>{
  let requestId='';let model='';let reserved=false;
  try{
   const settings=await readBridgeSettings();const expected=Buffer.from(settings.key);const actual=Buffer.from(req.get('x-bridge-key')||'');
   if(!expected.length||expected.length!==actual.length||!timingSafeEqual(expected,actual))return res.status(403).json({error:'Недійсний міст'});
   const b=req.body||{};requestId=b.requestId;
   if(typeof requestId!=='string'||!/^[a-zA-Z0-9:-]{1,160}$/.test(requestId)||typeof b.system!=='string'||b.system.length>12000||!Array.isArray(b.history)||b.history.length>10||b.history.some((x:any)=>!['user','assistant'].includes(x?.role)||typeof x.content!=='string'||x.content.length>6000)||!b.context||typeof b.context!=='object')return res.status(400).json({error:'Некоректна консультація'});
   const c=await config();model=c.model;
   if(!c.enabled||!CHAT_MODELS.some(x=>x.engine==='deepseek'&&x.id===model))return res.status(503).json({error:'Консультації вимкнено або модель не дозволена',code:'model_disabled'});
   const key=await platformKeyFor('deepseek');if(!key)return res.status(503).json({error:'Платформний ключ DeepSeek не налаштований у Студії',code:'platform_key_missing'});
   const prompt=JSON.stringify({sources:b.context,conversation:b.history});if(prompt.length>50000)return res.status(400).json({error:'Контекст завеликий'});
   const existing=reserve(requestId,prompt.length*2+800,c);
   if(existing){if(existing.status==='done')return res.json({text:existing.text,model,cached:true});return res.status(existing.status==='pending'?409:503).json({error:'Цей запит уже обробляється або завершився помилкою'});}
   reserved=true;
   const result=await (deps.generate||dispatch)('deepseek',model,prompt,b.system,key,undefined,false,{maxTokens:800,signal:AbortSignal.timeout(20000)});
   if(!result.text?.trim())throw Error('empty');result.text=result.text.slice(0,6000);
   finish(requestId,result);reserved=false;
   await recordTextUsageByModel(req,'marketplace-consultation',model,result.inputTokens,result.outputTokens,true);
   // No provider keys, customer contacts, user credit operations or manuscripts cross this response.
   return res.json({text:result.text,model});
  }catch(e){if(reserved){try{finish(requestId,null);}catch{}await recordTextUsageByModel(req,'marketplace-consultation',model,0,0,false).catch(()=>{});}return res.status(e instanceof Error&&e.message==='budget'?429:503).json({error:'Консультація тимчасово недоступна. Телефон менеджерки доступний на сайті.',code:e instanceof Error&&e.message==='budget'?'budget_exhausted':e instanceof Error&&/\b(?:401|403)\b/.test(e.message)?'provider_auth':e instanceof Error&&/\b404\b/.test(e.message)?'model_unavailable':'provider_unavailable'});}
 });
 const proxy=(path:(req:Request)=>string,method='GET')=>async(req:any,res:any)=>{res.setHeader('Cache-Control','no-store');try{const r=await marketplace(req,path(req),method,method==='GET'?undefined:req.body);res.status(r.status).json(r.value);}catch{res.status(503).json({error:'Не вдалося зв’язатися з маркетплейсом'});}};
 app.get('/api/support/marketplace/me',requireSupportAgent,(req,res)=>res.json({role:req.principal!.role}));
 app.get('/api/support/marketplace/stats',requireSupportAgent,proxy(()=> 'stats'));
 app.get('/api/support/marketplace/leads',requireSupportAgent,proxy(()=> 'leads'));
 app.get('/api/support/marketplace/threads/:id',requireSupportAgent,proxy(req=>'threads/'+encodeURIComponent(String(req.params.id))));
 app.post('/api/support/marketplace/threads/:id/:action',requireSupportAgent,async(req,res,next)=>{
  if(!['accept','reply','close','ai'].includes(String(req.params.action)))return res.status(400).json({error:'Невідома дія'});next();
 },proxy(req=>'threads/'+encodeURIComponent(String(req.params.id))+'/'+String(req.params.action),'POST'));
 app.get('/api/admin/marketplace-assistant/config',requireAdmin,async(_req,res)=>{try{res.json({...await config(),models:CHAT_MODELS.filter(x=>x.engine==='deepseek'),configured:!!await platformKeyFor('deepseek')});}catch{res.status(503).json({error:'Налаштування недоступні'});}});
 app.post('/api/admin/marketplace-assistant/config',requireAdmin,async(req,res)=>{
  if(!CHAT_MODELS.some(x=>x.engine==='deepseek'&&x.id===req.body?.model)||typeof req.body?.enabled!=='boolean'||!Number.isInteger(req.body?.dailyRequests)||req.body.dailyRequests<1||req.body.dailyRequests>10000||!Number.isInteger(req.body?.dailyTokens)||req.body.dailyTokens<1000||req.body.dailyTokens>20000000)return res.status(400).json({error:'Некоректні ліміти або модель'});
  const {model,enabled,dailyRequests,dailyTokens}=req.body;await setAppSetting(SETTINGS_KEY,JSON.stringify({model,enabled,dailyRequests,dailyTokens}));res.json({ok:true});
 });
 app.get('/api/admin/marketplace-assistant/settings',requireAdmin,proxy(()=> 'settings'));
 app.post('/api/admin/marketplace-assistant/settings',requireAdmin,proxy(()=> 'settings','POST'));
 const timer=setInterval(()=>{try{const db=database();db.prepare("DELETE FROM marketplace_assistant_requests WHERE created_at < ?").run(new Date(Date.now()-7*86400000).toISOString());db.prepare('DELETE FROM marketplace_assistant_budget WHERE day < ?').run(new Date(Date.now()-30*86400000).toISOString().slice(0,10));}catch{}},86400000);timer.unref();
 return ()=>clearInterval(timer);
}

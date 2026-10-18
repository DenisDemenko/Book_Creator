import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireAuth } from './auth';
import { getBook } from './bookStore';
import { DATA_DIR } from './db';

type Entry = {id:string; name:string; contact:string; role:'participant'|'representative'|'observer';status:'pending'|'confirmed'|'waitlist';createdAt:string};
type Event = {id:string;bookId:string;ownerId:string;theme:string;date:string;time:string;venue:string;address:string;price:string;announcement:string;createdAt:string;registrations:Entry[]};
const file=path.join(DATA_DIR,'constellation-events.json');
let chain:Promise<unknown>=Promise.resolve();
function exclusive<T>(f:()=>Promise<T>):Promise<T>{const next=chain.then(f,f);chain=next.then(()=>undefined,()=>undefined);return next;}
async function read():Promise<Event[]>{try{const value=JSON.parse(await fs.readFile(file,'utf8'));return Array.isArray(value)?value:[];}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}}
async function write(items:Event[]){await fs.mkdir(DATA_DIR,{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,JSON.stringify(items),{mode:0o600});await fs.rename(tmp,file);}
const clean=(v:unknown,n=200)=>typeof v==='string'?v.trim().slice(0,n):'';
async function check(req:Request,res:Response,bookId:unknown):Promise<string|null>{
  const ownerId=req.principal?.id;
  if(!ownerId){res.status(401).json({error:'Авторизація потрібна'});return null;}
  if(typeof bookId!=='string'||!bookId){res.status(400).json({error:'Немає bookId'});return null;}
  const book=await getBook(bookId);
  if(!book||book.ownerId!==ownerId){res.status(404).json({error:'Книгу не знайдено'});return null;}
  return ownerId;
}
export function registerConstellationEventRoutes(app:Express):void{
  app.get('/api/constellation/events',requireAuth,async(req,res)=>{
    try{const ownerId=await check(req,res,req.query.bookId);if(!ownerId)return;
      const rows=(await read()).filter(e=>e.ownerId===ownerId&&e.bookId===req.query.bookId);
      res.json({events:rows});
    }catch{res.status(500).json({error:'Не вдалося завантажити події'});}
  });
  app.post('/api/constellation/events',requireAuth,async(req,res)=>{
    try{const ownerId=await check(req,res,req.body?.bookId);if(!ownerId)return;
      const theme=clean(req.body?.theme);if(!theme){res.status(400).json({error:'Вкажіть тему події'});return;}
      const record:Event={id:randomUUID(),ownerId,bookId:req.body.bookId,theme,date:clean(req.body.date,80),time:clean(req.body.time,40),venue:clean(req.body.venue),address:clean(req.body.address),price:clean(req.body.price,40),announcement:clean(req.body.announcement,12000),createdAt:new Date().toISOString(),registrations:[]};
      await exclusive(async()=>{const items=await read();items.push(record);await write(items);});
      res.status(201).json({event:record});
    }catch{res.status(500).json({error:'Не вдалося створити подію'});}
  });
  app.post('/api/constellation/events/:id/registrations',requireAuth,async(req,res)=>{
    try{const ownerId=await check(req,res,req.body?.bookId);if(!ownerId)return;
      const name=clean(req.body?.name,120),contact=clean(req.body?.contact,200);
      const role=req.body?.role;
      if(!name||!contact||!['participant','representative','observer'].includes(role)){res.status(400).json({error:'Перевірте дані заявки'});return;}
      const entry:Entry={id:randomUUID(),name,contact,role,status:'pending',createdAt:new Date().toISOString()};
      const updated=await exclusive(async()=>{const events=await read();const event=events.find(e=>e.id===req.params.id&&e.bookId===req.body.bookId&&e.ownerId===ownerId);if(!event)return null;event.registrations.push(entry);await write(events);return event;});
      if(!updated){res.status(404).json({error:'Подію не знайдено'});return;}res.status(201).json({event:updated});
    }catch{res.status(500).json({error:'Не вдалося зберегти заявку'});}
  });
  app.patch('/api/constellation/events/:id/registrations/:registrationId',requireAuth,async(req,res)=>{
    try{const ownerId=await check(req,res,req.body?.bookId);if(!ownerId)return;
      const status=req.body?.status;if(!['pending','confirmed','waitlist'].includes(status)){res.status(400).json({error:'Невірний статус'});return;}
      const updated=await exclusive(async()=>{const events=await read();const event=events.find(e=>e.id===req.params.id&&e.ownerId===ownerId&&e.bookId===req.body.bookId);const entry=event?.registrations.find(x=>x.id===req.params.registrationId);if(!event||!entry)return null;entry.status=status;await write(events);return event;});
      if(!updated){res.status(404).json({error:'Заявку не знайдено'});return;}res.json({event:updated});
    }catch{res.status(500).json({error:'Не вдалося змінити статус'});}
  });
}

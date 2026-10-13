import type { Express,Request,Response } from "express";
import type { RealtimeAccessDeps, RealtimePrincipal } from "../../realtimeAuth";
import { resolveProjectAccess } from "../projectRoutes";
import { canRead } from "../collaboration/access";
import { LabyrinthError } from "./model";
import type { PgLabyrinthStore } from "./store";
import type { GroupGuard } from "./groupStore";
export interface GroupRouteDeps {
  access:RealtimeAccessDeps;store:()=>PgLabyrinthStore|null;refreshPrincipal?:(q:Request)=>Promise<void>;
  groupPrincipal?:(userId:string)=>Promise<(RealtimePrincipal & {name?:string})|null>;
  groupUserIds?:(projectId:string)=>Promise<string[]>;
}
const body=(q:Request,keys:string[])=>{
  const b=q.body;if(!b||typeof b!=="object"||Array.isArray(b)||Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k)))
    throw new LabyrinthError(422,"Некоректні поля запиту.");return b;
};
export function registerLabyrinthGroupRoutes(app:Express,d:GroupRouteDeps) {
  const base="/api/core/projects/:projectId/labyrinth";
  const check=async(q:Request,author:boolean)=>{
    if(!q.principal?.id||q.principal.isGuest)throw new LabyrinthError(401,"Увійдіть у систему.");
    await d.refreshPrincipal?.(q);
    if(!q.principal?.id||q.principal.isGuest||(q.principal as any).disabled)throw new LabyrinthError(401,"Обліковий запис недоступний.");
    const a=await resolveProjectAccess(q.principal,String(q.params.projectId),d.access);
    if(!a||(author?!a.isOwner&&a.role!=="admin":!canRead(a.effective.book)))throw new LabyrinthError(403,
      author?"Це дія власника книги або адміністратора.":"Потрібен чинний перегляд цієї книги.");
    return a;
  };
  const handle=(author:boolean,fn:(q:Request,r:Response,s:PgLabyrinthStore["group"],p:string,user:string,guard:GroupGuard)=>Promise<void>)=>
    async(q:Request,r:Response)=>{
      r.set("Cache-Control","no-store");
      try{
        const a=await check(q,author),s=d.store()?.group;
        if(!s)throw new LabyrinthError(503,"Потрібне доступне ядро PostgreSQL.");
        if(q.method==="GET"&&Object.keys(q.query).length)throw new LabyrinthError(422,"Некоректні параметри.");
        const guard:GroupGuard={
          recheck:async()=>{await check(q,author);},
          canReadUser:async user=>{
            // Never infer an account's administrator role or enabled state from submitted ids.
            if(!d.groupPrincipal)throw new LabyrinthError(503,"Перевірка облікових записів недоступна.");
            const principal=await d.groupPrincipal(user);
            if(!principal?.id||principal.isGuest)return false;
            const access=await resolveProjectAccess(principal,a.projectId,d.access);
            return !!access&&canRead(access.effective.book);
          }
        };
        await fn(q,r,s,a.projectId,a.userId,guard);
      }catch(e){
        if(e instanceof LabyrinthError){r.status(e.status).json({error:e.message});return;}
        if(["40001","40P01"].includes((e as any)?.code)){r.status(409).json({error:"Група вже змінилася. Оновіть стан."});return;}
        console.error("[labyrinth-group]",e);r.status(500).json({error:"Не вдалося отримати або змінити групове проходження."});
      }
    };
  app.get(base+"/group-candidates",handle(true,async(_q,r,_s,p,user,g)=>{
    const invited=await d.access.listAcceptedInvites(p);
    const ids=[...new Set([user,...invited.flatMap(i=>i.acceptedUserId?[i.acceptedUserId]:[]),...(await d.groupUserIds?.(p)??[])])];
    const users=[];
    for(const id of ids)if(await g.canReadUser(id)){const principal=await d.groupPrincipal!(id);users.push({userId:id,name:principal?.name??id});}
    await g.recheck();r.json({users});
  }));
  app.get(base+"/maps/:mapId/groups",handle(true,async(q,r,s,p,_u,g)=>{
    const groups=await s.authorGroups(p,String(q.params.mapId));await g.recheck();r.json({groups});
  }));
  app.post(base+"/maps/:mapId/groups",handle(true,async(q,r,s,p,u,g)=>{
    const b=body(q,["publicationRevision","bindings","rules","key"]);
    r.status(201).json(await s.create(p,String(q.params.mapId),b.publicationRevision,b.bindings,b.rules,u,b.key,g));
  }));
  app.post(base+"/groups/:runId/launch",handle(true,async(q,r,s,p,u,g)=>{
    const b=body(q,["expectedRevision","key"]);
    r.json(await s.execute(p,String(q.params.runId),b.expectedRevision,{kind:"launch"},u,b.key,g,true));
  }));
  app.get(base+"/groups/:runId/contributions",handle(true,async(q,r,s,p,_u,g)=>{
    const journal=await s.journal(p,String(q.params.runId));await g.recheck();r.json(journal);
  }));
  app.get(base+"/reader/groups",handle(false,async(_q,r,s,p,u,g)=>{
    const library=await s.library(p,u);await g.recheck();r.json(library);
  }));
  app.get(base+"/reader/groups/:runId",handle(false,async(q,r,s,p,u,g)=>{
    r.json(await s.get(p,String(q.params.runId),u,g));
  }));
  app.post(base+"/reader/groups/:runId/commands",handle(false,async(q,r,s,p,u,g)=>{
    const b=body(q,["expectedRevision","command","key"]);
    r.json(await s.execute(p,String(q.params.runId),b.expectedRevision,b.command,u,b.key,g));
  }));
}

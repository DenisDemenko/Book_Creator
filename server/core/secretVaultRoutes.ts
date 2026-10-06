import type {Express,Request,RequestHandler} from 'express';
import type {CoreRepository} from './types';
import type {RealtimeAccessDeps} from '../realtimeAuth';
import {resolveProjectAccess} from './projectRoutes';
import {CoreRuleError} from './rules';
import {createSecret,secretControl,directMystery,revealSecret,archiveSecretSimulation,revelationBranch,vaultMetadata,vaultKeyFromEnv,VaultUnavailableError} from './secretVault';
export interface VaultRoutesDeps {repo:()=>CoreRepository|null;access:RealtimeAccessDeps;key?:()=>Buffer;aiGuard?:RequestHandler;generate?:(req:Request,projectId:string,context:Record<string,unknown>)=>Promise<unknown>;direct?:(req:Request,projectId:string,context:Record<string,unknown>)=>Promise<unknown>}
export function registerSecretVaultRoutes(app:Express,d:VaultRoutesDeps){const base='/api/core/projects/:projectId/vault',key=d.key??vaultKeyFromEnv;
 const handle=(fn:(req:Request,repo:CoreRepository,p:string,actor:`user:${string}`)=>Promise<unknown>)=>async(req:Request,res:any)=>{res.set('Cache-Control','no-store');try{const p=String(req.params.projectId),a=await resolveProjectAccess(req.principal as never,p,d.access);if(!a){res.status(req.principal&&!req.principal.isGuest?403:401).json({error:'Немає доступу до книги.'});return;}if(!a.effective.full)throw new CoreRuleError('bad_actor','Vault доступний лише власнику й адміністратору.');const repo=d.repo();if(!repo){res.status(503).json({error:'Vault недоступний.'});return;}res.json(await fn(req,repo,p,`user:${a.userId}`));}catch(e){if(e instanceof VaultUnavailableError){res.status(503).json({error:e.message});return;}if(e instanceof CoreRuleError){res.status(({bad_input:400,bad_actor:403,not_found:404,conflict:409} as any)[e.code]??422).json({error:e.message});return;}res.status(500).json({error:'Vault не виконав дію. Приватний вміст не журналюється.'});}};
 app.get(base,handle(async(_req,repo,p)=>{let configured=true;try{key();}catch{configured=false;}return {...vaultMetadata(await repo.getSecretVault(p)),configured};}));
 const ai=d.aiGuard?[d.aiGuard]:[];
 app.post(base,...ai,handle((req,repo,p,actor)=>createSecret(repo,key(),p,req.body,actor,d.generate?ctx=>d.generate!(req,p,ctx):undefined)));
 app.post(base+'/:secretId/control',...(d.aiGuard?[(req:any,res:any,next:any)=>req.body?.action==='regenerate'?d.aiGuard!(req,res,next):next()]:[]),handle((req,repo,p,actor)=>secretControl(repo,key(),p,String(req.params.secretId),req.body,actor,d.generate?ctx=>d.generate!(req,p,ctx):undefined)));
 app.post(base+'/:secretId/director',...ai,handle((req,repo,p,actor)=>directMystery(repo,key(),p,String(req.params.secretId),req.body,actor,d.direct?ctx=>d.direct!(req,p,ctx):undefined)));
 app.post(base+'/:secretId/reveal',handle((req,repo,p,actor)=>revealSecret(repo,key(),p,String(req.params.secretId),req.body,actor)));
 app.post(base+'/:secretId/branch',handle((req,repo,p,actor)=>revelationBranch(repo,key(),p,String(req.params.secretId),req.body,actor)));
 app.post(base+'/simulations/:simulationId/archive',handle((req,repo,p,actor)=>archiveSecretSimulation(repo,key(),p,String(req.params.simulationId),req.body,actor)));
}

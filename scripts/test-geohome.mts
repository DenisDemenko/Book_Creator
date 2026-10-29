import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'studio-geohome-'));
process.env.DATA_DIR=temp;process.env.DATABASE_PATH=path.join(temp,'test.db');
const {initStore,saveUser,upsertSubscription,createSession}=await import('../server/store.ts');
const {attachPrincipal}=await import('../server/auth.ts');
const {registerGeoHomeRoutes}=await import('../server/geohome/routes.ts');
const {getDb}=await import('../server/db.ts');
const {default:express}=await import('express');
const {default:JSZip}=await import('jszip');
await initStore();
const until=new Date(Date.now()+86400000).toISOString(),now=new Date().toISOString();
for(const [id,plan,status,end] of [
 ['pro','pro','active',until],['ultra','ultra','active',until],['free','free','active',until],
 ['start','start','active',until],['team','team','active',until],['expired','pro','active','2020-01-01T00:00:00Z'],
 ['cancelled','ultra','cancelled',until],['admin','free','active',until],['other','pro','active',until],
] as const){
 await saveUser({id,email:id+'@test.dev',name:id,role:id==='admin'?'admin':'writer',firebaseUid:'uid-'+id,createdAt:now});
 await upsertSubscription({userId:id,plan,billingCycle:'monthly',status:status as any,currentPeriodStart:now,currentPeriodEnd:end,createdAt:now,updatedAt:now});
 await createSession({token:'session-'+id,userId:id,createdAt:now,expiresAt:until});
}
const app=express();app.use(express.json({limit:'10mb'}));app.use(attachPrincipal);registerGeoHomeRoutes(app);
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const port=(server.address() as {port:number}).port;
const headers=(id:string)=>({'Content-Type':'application/json',Cookie:'nova_session=session-'+id,'X-GeoHome-Client':'marketplace-v1','X-GeoHome-Uid':'uid-'+id});
const request=(id:string,route:string,body?:object,method?:string,custom?:Record<string,string>)=>fetch(`http://127.0.0.1:${port}/api/geohome`+route,{headers:custom??headers(id),method:method??(body?'POST':'GET'),body:body?JSON.stringify(body):undefined});
const pkg={schema:'fusion.geohome.project',version:1,units:'mm',settings:{params:{diameter:8000,height:4000,frequency:3,cutType:'1/2'},beamProfile:{},connectorParams:{},sheathingParams:{},windowParams:{},doorParams:{},solarParams:{},innerSheathingParams:{},displayLayers:{},windowFaceIds:[],doorFaceIds:[],solarFaceIds:[],fabricStripFaceIds:[]},model:{nodes:[{id:1,position:{x:0,y:0,z:0}},{id:2,position:{x:100,y:0,z:0}},{id:3,position:{x:0,y:100,z:0}}],edges:[{id:1,start:1,end:2,length:100}],faces:[{id:1,a:1,b:2,c:3}]},cad:{schema:'geohome.kumcad.interchange',version:1,units:'mm',coordinateSystem:'right-handed-z-up',vertices:[{id:1,position:{x:0,y:0,z:0}},{id:2,position:{x:100,y:0,z:0}},{id:3,position:{x:0,y:100,z:0}}],struts:[{id:1,startVertexId:1,endVertexId:2,nominalLengthMm:100}],triangles:[{id:1,vertexIds:[1,2,3]}]}};
const body={id:randomUUID(),requestId:randomUUID(),name:'Мій купол',baseVersion:0,package:pkg};
let passed=0;
const check=(label:string,condition:boolean)=>{assert.ok(condition,label);passed++;console.log('✓ '+label);};
try{
 check('guests denied',(await request('guest','/projects')).status===401);
 for(const id of ['free','start','team','expired','cancelled','admin']){
  check(id+' cannot save',(await request(id,'/projects',body)).status===403);
  check(id+' cannot export CAD',(await request(id,'/projects/'+body.id+'/cad',{version:1})).status===403);
 }
 check('client-selected plan cannot unlock free',(await request('free','/projects',{...body,plan:'ultra'})).status===403);
 check('CSRF header required',(await request('pro','/projects',body,'POST',{'Content-Type':'application/json',Cookie:'nova_session=session-pro'})).status===403);
 check('session account binding required',(await request('pro','/projects',body,'POST',{...headers('pro'),'X-GeoHome-Uid':'uid-other'})).status===403);
 let response=await request('pro','/projects',body);check('Pro can save',response.status===200);
 const saved=await response.json();check('server checksum',saved.sha256===createHash('sha256').update(JSON.stringify(pkg)).digest('hex'));
 check('full settings roundtrip',JSON.stringify(saved.package)===JSON.stringify(pkg));
 check('idempotent retry',(await (await request('pro','/projects',body)).json()).version===1);
 check('reused request ID conflicts',(await request('pro','/projects',{...body,name:'Changed'})).status===409);
 check('stale version conflicts',(await request('pro','/projects',{...body,requestId:randomUUID()})).status===409);
 check('new version saved',(await (await request('pro','/projects',{...body,baseVersion:1,requestId:randomUUID()})).json()).version===2);
 check('old version retained',(await (await request('pro','/projects/'+body.id+'?version=1')).json()).version===1);
 check('other owner cannot read',(await request('other','/projects/'+body.id)).status===404);
 check('other owner cannot overwrite',(await request('other','/projects',{...body,baseVersion:2,requestId:randomUUID()})).status===404);
 check('other owner cannot CAD export',(await request('other','/projects/'+body.id+'/cad',{version:1})).status===404);
 const cadResponse=await request('pro','/projects/'+body.id+'/cad',{version:1});
 const archive=await JSZip.loadAsync(await cadResponse.arrayBuffer());
 const manifest=JSON.parse(await archive.file('manifest.json')!.async('string'));
 check('CAD export checks saved revision',manifest.projectVersion===1);
 check('KumCAD receives native STEP',(await archive.file('dome.step')!.async('string')).startsWith('ISO-10303-21;'));
 check('KumCAD receives complete settings',JSON.stringify(JSON.parse(await archive.file('project.json')!.async('string')))===JSON.stringify(pkg));
 check('Ultra can save',(await request('ultra','/projects',{...body,id:randomUUID(),requestId:randomUUID()})).status===200);
 check('malformed model rejected',(await request('pro','/projects',{...body,id:randomUUID(),package:{...pkg,model:{...pkg.model,nodes:[]}}})).status===400);
 check('CAD tampering rejected',(await request('pro','/projects',{...body,id:randomUUID(),package:{...pkg,cad:{...pkg.cad,vertices:pkg.cad.vertices.map(v=>({...v,position:{x:999,y:0,z:0}}))}}})).status===400);
 const stored=getDb()!.prepare('SELECT package_json FROM geohome_versions WHERE project_id=? AND version=2').get(body.id) as any;
 getDb()!.prepare('UPDATE geohome_versions SET package_json=? WHERE project_id=? AND version=2').run('{}',body.id);
 check('corrupted snapshot rejected',(await request('pro','/projects/'+body.id)).status===500);
 getDb()!.prepare('UPDATE geohome_versions SET package_json=? WHERE project_id=? AND version=2').run(stored.package_json,body.id);
 await upsertSubscription({userId:'pro',plan:'free',billingCycle:'monthly',status:'active',currentPeriodStart:now,currentPeriodEnd:until,createdAt:now,updatedAt:now});
 check('downgrade blocks existing CAD export',(await request('pro','/projects/'+body.id+'/cad',{version:2})).status===403);
 check('downgrade blocks cloud reads',(await request('pro','/projects/'+body.id)).status===403);
 check('owner can delete after downgrade',(await request('pro','/projects/'+body.id,undefined,'DELETE')).status===204);
 check('deletion removes private versions',(getDb()!.prepare('SELECT COUNT(*) AS n FROM geohome_versions WHERE project_id=?').get(body.id) as any).n===0);
 console.log(`GeoHome cloud: ${passed} checks passed.`);
} finally {await new Promise<void>(resolve=>server.close(()=>resolve()));getDb()?.close?.();fs.rmSync(temp,{recursive:true,force:true});}

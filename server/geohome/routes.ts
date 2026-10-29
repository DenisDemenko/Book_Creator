import JSZip from 'jszip';
import { kumCadStep } from './step';
import type { Express, Request, Response } from 'express';
import { requireAuth } from '../auth';
import { resolveSubscription } from '../subscriptions';
import { GeoHomeError, initGeoHomeStore, listProjects, readProject, saveProject, deleteProject } from './store';

// No administrator/team bypass: the product rule is specifically active Pro/Ultra.
export function geoHomeAccess(sub: {plan:string;status:string;currentPeriodEnd:string}, now=Date.now()) {
  return ['pro','ultra'].includes(sub.plan) && sub.status==='active' && Number.isFinite(Date.parse(sub.currentPeriodEnd)) && Date.parse(sub.currentPeriodEnd)>now;
}
export function registerGeoHomeRoutes(app: Express) {
  // Fail closed per request if persistent SQLite is unavailable; do not stop unrelated Studio routes.
  try { initGeoHomeStore(); } catch {}
  const handle=(action:(req:Request,res:Response,owner:string)=>unknown, paid=true)=>(async(req:Request,res:Response)=>{
    res.set('Cache-Control','no-store');
    try {
      const user=req.principal;
      if (!user || user.isGuest) throw new GeoHomeError(401,'Увійдіть у свій акаунт.');
      const firebaseUid='firebaseUid' in user?user.firebaseUid:undefined;
      if (!firebaseUid || req.get('x-geohome-client')!=='marketplace-v1' || req.get('x-geohome-uid')!==firebaseUid)
        throw new GeoHomeError(403,'Оновіть вхід у GeoHome.');
      const sub=await resolveSubscription(user.id);
      if (paid && !geoHomeAccess(sub)) throw new GeoHomeError(403,'Хмарні проєкти та CAD IDE доступні за активною підпискою Pro або Ultra.');
      return await action(req,res,user.id);
    } catch(error) {
      const known=error instanceof GeoHomeError;
      return res.status(known?error.status:500).json({error:known?error.message:'Не вдалося обробити проєкт.',requiredPlans:['pro','ultra']});
    }
  });
  app.get('/api/geohome/access',requireAuth,handle(async(req,res,owner)=>{
    const sub=await resolveSubscription(owner);
    res.json({plan:sub.plan,allowed:geoHomeAccess(sub),requiredPlans:['pro','ultra'],expiresAt:sub.currentPeriodEnd});
  },false));
  app.get('/api/geohome/projects',requireAuth,handle((_req,res,owner)=>res.json(listProjects(owner))));
  app.post('/api/geohome/projects',requireAuth,handle((req,res,owner)=>res.json(saveProject(owner,req.body))));
  app.get('/api/geohome/projects/:id',requireAuth,handle((req,res,owner)=>{
    const version=req.query.version===undefined?undefined:Number(req.query.version);
    if(version!==undefined && (!Number.isInteger(version)||version<1)) throw new GeoHomeError(400,'Некоректна версія.');
    res.json(readProject(owner,String(req.params.id),version));
  }));
  app.delete('/api/geohome/projects/:id',requireAuth,handle((req,res,owner)=>{
    deleteProject(owner,String(req.params.id));res.status(204).end();
  },false));
  app.post('/api/geohome/projects/:id/cad',requireAuth,handle(async(req,res,owner)=>{
    const version=Number(req.body?.version);
    if(!Number.isInteger(version)||version<1)throw new GeoHomeError(400,'Оберіть збережену версію.');
    const project=readProject(owner,String(req.params.id),version);
    const zip=new JSZip();
    const manifest={schema:'fusion.geohome.cad',version:1,target:'https://github.com/todorw/KumCAD',projectId:project.id,
      projectVersion:project.version,name:project.name,units:'mm',sourceSha256:project.sha256};
    zip.file('manifest.json',JSON.stringify(manifest,null,2));
    zip.file('project.json',JSON.stringify(project.package,null,2));
    zip.file('cad.json',JSON.stringify(project.package.cad,null,2));
    zip.file('dome.step',kumCadStep(project.package.cad));
    zip.file('README.txt',`Fusion GeoHome → KumCAD\n\nOpen KumCAD's 3D window and use File → Import STEP... to open dome.step.\nRepository: https://github.com/todorw/KumCAD\nUnits: millimetres; right-handed Z-up.\nProject version: ${project.version}\nSHA-256 of project.json data: ${project.sha256} (hash of compact JSON).\n\nThe STEP model contains panel surfaces and beam centre lines. It does not claim solid timber end cuts or connector solids. Exact input profiles, cuts and connector data are retained in cad.json and project.json. Engineering verification is required before fabrication.\n\nKumCAD is a desktop Qt/OpenCASCADE application; no web HTTP receiver is available in the linked repository. This package is the supported file handoff.\n`);
    const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
    res.set('Content-Type','application/zip').set('Content-Disposition',`attachment; filename="geohome-${project.id}-v${project.version}-kumcad.zip"`).send(buffer);
  }));
}

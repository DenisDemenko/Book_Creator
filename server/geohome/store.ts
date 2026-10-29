import { createHash } from 'node:crypto';
import { getDb } from '../db';

export class GeoHomeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export interface DomePackage {
  schema: 'fusion.geohome.project'; version: 1; units: 'mm';
  settings: Record<string, any>; model: Record<string, any>; cad: Record<string, any>;
}
function object(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function validatePackage(value: unknown): asserts value is DomePackage {
  if (!object(value) || value.schema !== 'fusion.geohome.project' || value.version !== 1 || value.units !== 'mm')
    throw new GeoHomeError(400, 'Непідтримуваний формат проєкту купола.');
  if (Buffer.byteLength(JSON.stringify(value)) > 8 * 1024 * 1024)
    throw new GeoHomeError(413, 'Пакет перевищує 8 МБ.');
  if (!object(value.settings) || !object(value.settings.params) || !object(value.model) || !object(value.cad))
    throw new GeoHomeError(400, 'Неповні дані купола.');
  const params = value.settings.params;
  if (!Number.isFinite(params.diameter) || params.diameter <= 0 || !Number.isFinite(params.height) || params.height <= 0 || !Number.isInteger(params.frequency) || params.frequency < 1 || params.frequency > 8)
    throw new GeoHomeError(400, 'Некоректні параметри купола.');
  for (const key of ['beamProfile','connectorParams','sheathingParams','windowParams','doorParams','solarParams','innerSheathingParams','displayLayers'])
    if (!object(value.settings[key])) throw new GeoHomeError(400, `Відсутні налаштування: ${key}.`);
  for (const key of ['windowFaceIds','doorFaceIds','solarFaceIds','fabricStripFaceIds'])
    if (!Array.isArray(value.settings[key]) || value.settings[key].some((id: unknown) => !Number.isInteger(id))) throw new GeoHomeError(400, `Некоректні дані: ${key}.`);
  if (!Array.isArray(value.model.nodes) || !value.model.nodes.length || !Array.isArray(value.model.edges) || !Array.isArray(value.model.faces))
    throw new GeoHomeError(400, 'Відсутня геометрія купола.');
  const ids = new Set<number>();
  for (const node of value.model.nodes) {
    if (!object(node) || !Number.isInteger(node.id) || ids.has(node.id) || !object(node.position) || !['x','y','z'].every(key => Number.isFinite(node.position[key])))
      throw new GeoHomeError(400, 'Некоректні вузли купола.');
    ids.add(node.id);
  }
  for (const edge of value.model.edges)
    if (!object(edge) || !ids.has(edge.start) || !ids.has(edge.end) || !Number.isFinite(edge.length) || edge.length <= 0) throw new GeoHomeError(400, 'Некоректні ребра купола.');
  for (const face of value.model.faces)
    if (!object(face) || ![face.a,face.b,face.c].every(id=>ids.has(id))) throw new GeoHomeError(400, 'Некоректні панелі купола.');
  if (value.cad.schema !== 'geohome.kumcad.interchange' || value.cad.version !== 1 || value.cad.units !== 'mm' || value.cad.coordinateSystem !== 'right-handed-z-up' || !Array.isArray(value.cad.vertices) || !Array.isArray(value.cad.struts) || !Array.isArray(value.cad.triangles))
    throw new GeoHomeError(400, 'Некоректний CAD-пакет.');
  if (value.cad.vertices.length !== ids.size || value.cad.struts.length !== value.model.edges.length || value.cad.triangles.length !== value.model.faces.length)
    throw new GeoHomeError(400, 'CAD-пакет не відповідає геометрії купола.');
  for(const group of [value.model.edges,value.model.faces,value.cad.vertices,value.cad.struts,value.cad.triangles]) {
    if(group.some((item:any)=>!object(item)||!Number.isInteger(item.id)) || new Set(group.map((item:any)=>item.id)).size!==group.length)
      throw new GeoHomeError(400,'Ідентифікатори елементів геометрії мають бути унікальними.');
  }
  const positions=new Map(value.model.nodes.map((node:any)=>[node.id,node.position]));
  for(const vertex of value.cad.vertices) {
    const position=positions.get(vertex?.id) as any;
    if(!position || !object(vertex.position) || !['x','y','z'].every(key=>vertex.position[key]===position[key]))
      throw new GeoHomeError(400,'CAD-координати не відповідають моделі.');
  }
  const edges=new Map(value.model.edges.map((edge:any)=>[edge.id,edge]));
  for(const strut of value.cad.struts) {
    const edge=edges.get(strut?.id) as any;
    if(!edge || strut.startVertexId!==edge.start || strut.endVertexId!==edge.end || strut.nominalLengthMm!==edge.length)
      throw new GeoHomeError(400,'CAD-балки не відповідають моделі.');
  }
  const faces=new Map(value.model.faces.map((face:any)=>[face.id,face]));
  for(const triangle of value.cad.triangles) {
    const face=faces.get(triangle?.id) as any;
    if(!face || !Array.isArray(triangle.vertexIds) || triangle.vertexIds.length!==3 || !triangle.vertexIds.every((id:number,i:number)=>id===[face.a,face.b,face.c][i]))
      throw new GeoHomeError(400,'CAD-панелі не відповідають моделі.');
  }

}
function database() {
  const db = getDb();
  if (!db) throw new GeoHomeError(503, 'Хмарне сховище тимчасово недоступне.');
  return db;
}
export function initGeoHomeStore() {
  database().exec(`CREATE TABLE IF NOT EXISTS geohome_projects (
    id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, current_version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS geohome_owner ON geohome_projects(owner_id, updated_at);
  CREATE TABLE IF NOT EXISTS geohome_versions (
    project_id TEXT NOT NULL REFERENCES geohome_projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL, request_id TEXT NOT NULL, sha256 TEXT NOT NULL,
    package_json TEXT NOT NULL, created_at TEXT NOT NULL, request_hash TEXT NOT NULL,
    PRIMARY KEY(project_id,version), UNIQUE(project_id,request_id)
  );`);
}
function own(owner: string, id: string) {
  const row = database().prepare('SELECT * FROM geohome_projects WHERE id=? AND owner_id=?').get(id,owner) as any;
  if (!row) throw new GeoHomeError(404, 'Проєкт не знайдено.');
  return row;
}
function summary(row: any) {
  return { id:row.id, name:row.name, version:row.current_version, createdAt:row.created_at, updatedAt:row.updated_at };
}
export function listProjects(owner: string) {
  return database().prepare('SELECT * FROM geohome_projects WHERE owner_id=? ORDER BY updated_at DESC LIMIT 200').all(owner).map(summary);
}
export function readProject(owner: string, id: string, version?: number) {
  const project = own(owner,id);
  const rows = database().prepare('SELECT version,sha256,created_at FROM geohome_versions WHERE project_id=? ORDER BY version DESC').all(id) as any[];
  const row = database().prepare('SELECT * FROM geohome_versions WHERE project_id=? AND version=?').get(id,version??project.current_version) as any;
  if (!row) throw new GeoHomeError(404, 'Версію не знайдено.');
  const checksum=createHash('sha256').update(row.package_json).digest('hex');
  if (checksum!==row.sha256) throw new GeoHomeError(500,'Контрольна сума збереженого проєкту не збігається.');
  return { ...summary(project), version:row.version, headVersion:project.current_version, sha256:row.sha256, package:JSON.parse(row.package_json) as DomePackage,
    versions:rows.map(v=>({version:v.version,sha256:v.sha256,createdAt:v.created_at})) };
}
export function saveProject(owner: string, input: any) {
  if (!object(input) || typeof input.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.id) || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(input.requestId) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length>160 || !Number.isInteger(input.baseVersion) || input.baseVersion<0)
    throw new GeoHomeError(400, 'Некоректний запит збереження.');
  validatePackage(input.package);
  const serialized=JSON.stringify(input.package), hash=createHash('sha256').update(serialized).digest('hex'), db=database();
  const requestHash=createHash('sha256').update(JSON.stringify({name:input.name.trim(),baseVersion:input.baseVersion,package:input.package})).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    const existing=db.prepare('SELECT * FROM geohome_projects WHERE id=?').get(input.id) as any;
    if (existing && existing.owner_id!==owner) throw new GeoHomeError(404,'Проєкт не знайдено.');
    const replay=db.prepare('SELECT * FROM geohome_versions WHERE project_id=? AND request_id=?').get(input.id,input.requestId) as any;
    if (replay) {
      if (replay.request_hash!==requestHash) throw new GeoHomeError(409,'Ключ запиту вже використано для інших даних.');
      db.exec('COMMIT');
      return readProject(owner,input.id,replay.version);
    }
    if ((existing?.current_version??0)!==input.baseVersion) throw new GeoHomeError(409,'Є новіша версія. Відкрийте її або збережіть окрему копію.');
    const now=new Date().toISOString(), version=input.baseVersion+1;
    if (!existing) db.prepare('INSERT INTO geohome_projects VALUES (?,?,?,?,?,?)').run(input.id,owner,input.name.trim(),version,now,now);
    else db.prepare('UPDATE geohome_projects SET name=?,current_version=?,updated_at=? WHERE id=? AND owner_id=?').run(input.name.trim(),version,now,input.id,owner);
    db.prepare('INSERT INTO geohome_versions VALUES (?,?,?,?,?,?,?)').run(input.id,version,input.requestId,hash,serialized,now,requestHash);
    db.exec('COMMIT');
    return readProject(owner,input.id,version);
  } catch(error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}
export function deleteProject(owner: string,id: string) {
  own(owner,id);database().prepare('DELETE FROM geohome_projects WHERE id=? AND owner_id=?').run(id,owner);
}

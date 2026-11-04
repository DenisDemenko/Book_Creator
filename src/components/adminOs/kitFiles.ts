/**
 * Файли для виготовлення набору (трек K4 плану GrabFusion,
 * docs/proposals/GRABFUSION_PHOTO_COURSE_APP_2026-10-28.md, §4а): креслення, DXF, STL тощо —
 * з версіями, приватні, привʼязані до деталей специфікації (`KitLine.fileId`).
 *
 * Модуль чистий (без React і Node): це ПРАВИЛА й метадані. Самі байти лежать на сервері
 * (`server/kitFiles.ts`), у картці зберігається лише опис. Сервер — єдине джерело істини для
 * списку `kit.files`: при збереженні картки він бере цей список зі сховища, а не з тіла запиту
 * (клієнт не може підробити «файл», якого немає на диску); клієнт керує лише привʼязками
 * деталь→файл.
 *
 * Версії незмінні: нова версія додається, стара лишається (за нею можна повернутись і перевірити,
 * що саме різали). Ідентифікатори файлів і версій потрапляють у шлях на диску, тому нормалізація
 * приймає лише безпечні символи.
 *
 * Приватність: файли не їдуть на вітрину й не входять у `attributes` мосту.
 */
import type { KitSpec } from './kitSpec';

export type KitFileKind = 'drawing' | 'dxf' | 'stl' | 'model3d' | 'cnc' | 'archive';

/** Дозволені розширення → вид. Усе інше відхиляється (виконувані файли, скрипти, HTML тощо). */
export const KIT_FILE_EXTENSIONS: Record<string, KitFileKind> = {
  pdf: 'drawing', png: 'drawing', jpg: 'drawing', jpeg: 'drawing', svg: 'drawing', dwg: 'drawing',
  dxf: 'dxf',
  stl: 'stl',
  step: 'model3d', stp: 'model3d', '3mf': 'model3d', obj: 'model3d',
  gcode: 'cnc', nc: 'cnc',
  zip: 'archive',
};

export const KIT_FILE_KIND_LABELS: Record<KitFileKind, string> = {
  drawing: 'Креслення',
  dxf: 'DXF (різання)',
  stl: 'STL (друк)',
  model3d: '3D-модель',
  cnc: 'Програма ЧПК',
  archive: 'Архів',
};

export const MAX_KIT_FILES = 200;
export const MAX_KIT_FILE_VERSIONS = 50;
export const MAX_KIT_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_KIT_FILES_TOTAL_BYTES = 500 * 1024 * 1024;
export const KIT_FILE_NAME_MAX = 120;
export const KIT_FILE_NOTE_MAX = 300;

export interface KitFileVersion {
  /** Безпечний ідентифікатор (частина шляху на диску). */
  id: string;
  /** Порядковий номер: 1, 2, 3… Нова версія = попередня + 1. */
  version: number;
  /** Імʼя завантаженого файлу (очищене від шляху). */
  fileName: string;
  bytes: number;
  sha256: string;
  uploadedAt: string;
  note: string;
}

export interface KitFile {
  id: string;
  /** Підпис для людей: «Бокова панель — різання». */
  name: string;
  kind: KitFileKind;
  /** Від старої до нової; остання — чинна. */
  versions: KitFileVersion[];
}

export type KitFileError =
  | 'not_found'
  | 'bad_type'
  | 'empty'
  | 'too_large'
  | 'total_too_large'
  | 'too_many_files'
  | 'too_many_versions'
  | 'same_version';

export const KIT_FILE_ERRORS: Record<KitFileError, string> = {
  not_found: 'Файл не знайдено.',
  bad_type: 'Такий тип файлу не підтримується. Дозволено: ' + Object.keys(KIT_FILE_EXTENSIONS).join(', ') + '.',
  empty: 'Файл порожній.',
  too_large: `Файл завеликий (максимум ${Math.round(MAX_KIT_FILE_BYTES / 1024 / 1024)} МБ).`,
  total_too_large: `Усі файли набору разом перевищують ${Math.round(MAX_KIT_FILES_TOTAL_BYTES / 1024 / 1024)} МБ.`,
  too_many_files: `Забагато файлів (максимум ${MAX_KIT_FILES}).`,
  too_many_versions: `Забагато версій одного файлу (максимум ${MAX_KIT_FILE_VERSIONS}).`,
  same_version: 'Цей вміст збігається з чинною версією — нової версії не створено.',
};

export const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

// ---------------------------------------------------------------------------
// Імена й типи
// ---------------------------------------------------------------------------

/** Імʼя файлу без шляху й керівних символів; не довше `KIT_FILE_NAME_MAX`, розширення зберігається. */
export function sanitizeKitFileName(raw: unknown): string {
  let name = typeof raw === 'string' ? raw : '';
  name = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\\/g, '/');
  name = name.slice(name.lastIndexOf('/') + 1).replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!name) return 'file';
  if ([...name].length <= KIT_FILE_NAME_MAX) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : '';
  return [...name.slice(0, dot > 0 ? dot : undefined)].slice(0, KIT_FILE_NAME_MAX - ext.length).join('') + ext;
}

export function kitFileExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/** Вид за розширенням; `null` — тип не дозволений. */
export function kitFileKind(fileName: string): KitFileKind | null {
  const ext = kitFileExtension(fileName);
  return Object.prototype.hasOwnProperty.call(KIT_FILE_EXTENSIONS, ext) ? KIT_FILE_EXTENSIONS[ext] : null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace('.', ',')} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

// ---------------------------------------------------------------------------
// Приведення метаданих
// ---------------------------------------------------------------------------

const text = (value: unknown, max: number): string => {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return [...s].slice(0, max).join('');
};
const isoOrEmpty = (value: unknown): string => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : '');

/** Метадані файлів із будь-якого джерела → безпечний вигляд (небезпечні id відкидаються). */
export function normalizeKitFiles(value: unknown): KitFile[] {
  if (!Array.isArray(value)) return [];
  const out: KitFile[] = [];
  const seenFiles = new Set<string>();
  const seenVersions = new Set<string>();
  for (const raw of value.slice(0, MAX_KIT_FILES)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, any>;
    const id = typeof r.id === 'string' && SAFE_ID.test(r.id) ? r.id : '';
    if (!id || seenFiles.has(id)) continue;
    const versions: KitFileVersion[] = [];
    for (const rv of (Array.isArray(r.versions) ? r.versions : []).slice(0, MAX_KIT_FILE_VERSIONS)) {
      if (!rv || typeof rv !== 'object') continue;
      const vid = typeof rv.id === 'string' && SAFE_ID.test(rv.id) ? rv.id : '';
      const n = Number(rv.version);
      if (!vid || seenVersions.has(`${id}/${vid}`) || !Number.isInteger(n) || n < 1) continue;
      seenVersions.add(`${id}/${vid}`);
      const bytes = Math.max(0, Math.min(MAX_KIT_FILE_BYTES, Math.floor(Number(rv.bytes) || 0)));
      versions.push({
        id: vid,
        version: n,
        fileName: sanitizeKitFileName(rv.fileName),
        bytes,
        sha256: typeof rv.sha256 === 'string' && /^[0-9a-f]{64}$/.test(rv.sha256) ? rv.sha256 : '',
        uploadedAt: isoOrEmpty(rv.uploadedAt),
        note: text(rv.note, KIT_FILE_NOTE_MAX),
      });
    }
    if (!versions.length) continue;
    versions.sort((a, b) => a.version - b.version);
    seenFiles.add(id);
    const latest = versions[versions.length - 1];
    const kind: KitFileKind = Object.values(KIT_FILE_EXTENSIONS).includes(r.kind) ? r.kind : kitFileKind(latest.fileName) ?? 'drawing';
    out.push({ id, name: text(r.name, KIT_FILE_NAME_MAX) || latest.fileName, kind, versions });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Зміни списку (чисті; сервер викликає їх і лише потім пише на диск/в картку)
// ---------------------------------------------------------------------------

export const latestVersion = (file: KitFile): KitFileVersion => file.versions[file.versions.length - 1];
export const totalKitFileBytes = (files: KitFile[]): number => files.reduce((sum, f) => sum + f.versions.reduce((s, v) => s + v.bytes, 0), 0);

export interface KitFileUpload {
  fileName: string;
  bytes: number;
  sha256: string;
  fileId: string;
  versionId: string;
  name?: string;
  note?: string;
  now: Date;
}

export type KitFileResult = { ok: true; files: KitFile[]; file: KitFile; version: KitFileVersion } | { ok: false; error: KitFileError };

function checkUpload(files: KitFile[], u: KitFileUpload): KitFileError | null {
  if (!(u.bytes > 0)) return 'empty';
  if (u.bytes > MAX_KIT_FILE_BYTES) return 'too_large';
  if (kitFileKind(u.fileName) === null) return 'bad_type';
  if (totalKitFileBytes(files) + u.bytes > MAX_KIT_FILES_TOTAL_BYTES) return 'total_too_large';
  return null;
}

/** Новий файл (версія 1). */
export function addKitFile(files: KitFile[], u: KitFileUpload): KitFileResult {
  const fileName = sanitizeKitFileName(u.fileName);
  const err = checkUpload(files, { ...u, fileName });
  if (err) return { ok: false, error: err };
  if (files.length >= MAX_KIT_FILES) return { ok: false, error: 'too_many_files' };
  const version: KitFileVersion = { id: u.versionId, version: 1, fileName, bytes: u.bytes, sha256: u.sha256, uploadedAt: u.now.toISOString(), note: text(u.note, KIT_FILE_NOTE_MAX) };
  const file: KitFile = { id: u.fileId, name: text(u.name, KIT_FILE_NAME_MAX) || fileName.replace(/\.[^.]+$/, '') || fileName, kind: kitFileKind(fileName)!, versions: [version] };
  return { ok: true, files: [...files, file], file, version };
}

/** Нова версія наявного файлу (попередні лишаються). Той самий вміст, що й чинна версія, — відмова. */
export function addKitFileVersion(files: KitFile[], u: KitFileUpload): KitFileResult {
  const target = files.find((f) => f.id === u.fileId);
  if (!target) return { ok: false, error: 'not_found' };
  const fileName = sanitizeKitFileName(u.fileName);
  const err = checkUpload(files, { ...u, fileName });
  if (err) return { ok: false, error: err };
  if (target.versions.length >= MAX_KIT_FILE_VERSIONS) return { ok: false, error: 'too_many_versions' };
  const current = latestVersion(target);
  if (current.sha256 && current.sha256 === u.sha256) return { ok: false, error: 'same_version' };
  const version: KitFileVersion = { id: u.versionId, version: current.version + 1, fileName, bytes: u.bytes, sha256: u.sha256, uploadedAt: u.now.toISOString(), note: text(u.note, KIT_FILE_NOTE_MAX) };
  const file: KitFile = { ...target, kind: kitFileKind(fileName) ?? target.kind, versions: [...target.versions, version] };
  return { ok: true, files: files.map((f) => (f.id === file.id ? file : f)), file, version };
}

export function renameKitFile(files: KitFile[], fileId: string, name: unknown): KitFile[] | null {
  const label = text(name, KIT_FILE_NAME_MAX);
  if (!label || !files.some((f) => f.id === fileId)) return null;
  return files.map((f) => (f.id === fileId ? { ...f, name: label } : f));
}

export const removeKitFile = (files: KitFile[], fileId: string): KitFile[] => files.filter((f) => f.id !== fileId);

/** Деталі, які виготовляють за цим файлом. */
export function partsUsingFile(kit: Pick<KitSpec, 'parts'>, fileId: string) {
  return kit.parts.filter((p) => p.fileId === fileId);
}

// ---------------------------------------------------------------------------
// Перевірки (K4: «кожна деталь вказує на файл, у якому її виготовляють»)
// ---------------------------------------------------------------------------

/** Лише застереження: нічого не блокує, але показує, де специфікація не доведена до виробництва. */
export function kitFileIssues(kit: KitSpec | null | undefined): string[] {
  if (!kit || !kit.enabled) return [];
  const named = (kit.parts || []).filter((p) => p.name.trim());
  if (!named.length) return [];
  const files = kit.files || [];
  if (!files.length) return ['Файлів для виготовлення ще немає — додайте креслення, DXF чи STL і привʼяжіть їх до деталей.'];
  const out: string[] = [];
  for (const p of named) if (!p.fileId) out.push(`Деталь «${p.name.trim()}»: не вказано файл виготовлення.`);
  for (const f of files) if (!named.some((p) => p.fileId === f.id)) out.push(`Файл «${f.name}» не привʼязано до жодної деталі.`);
  return out;
}

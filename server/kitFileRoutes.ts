/**
 * REST для файлів виготовлення набору (K4). Лише адміністратор. Байти — у `KitFileStore`,
 * метадані — у `product.kit.files` (єдине джерело істини — цей модуль, а не тіло збереження картки).
 *
 *   POST   /api/admin/furniture-products/:id/kit-files                  — сирі байти; ?fileId= → нова версія; ?name=&note=
 *   GET    /api/admin/furniture-products/:id/kit-files/:fileId/download — чинна версія
 *   GET    /api/admin/furniture-products/:id/kit-files/:fileId/versions/:versionId
 *   PATCH  /api/admin/furniture-products/:id/kit-files/:fileId          — {name}
 *   DELETE /api/admin/furniture-products/:id/kit-files/:fileId          — файл з усіма версіями; привʼязки деталей скидаються
 *
 * Файли віддаються лише як вкладення (`attachment`, `nosniff`, `no-store`): SVG/HTML з вітрини
 * не мають виконатись у домені адмінки.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import type { FurnitureProduct } from '../src/components/adminOs/furnitureProduct';
import {
  addKitFile,
  addKitFileVersion,
  KIT_FILE_ERRORS,
  latestVersion,
  MAX_KIT_FILE_BYTES,
  removeKitFile,
  renameKitFile,
  SAFE_ID,
  sanitizeKitFileName,
  type KitFileError,
} from '../src/components/adminOs/kitFiles';
import type { KitFileStore } from './kitFiles';

export interface KitFileRouteDeps {
  auth: RequestHandler;
  readDrafts(): Promise<FurnitureProduct[]>;
  writeDrafts(list: FurnitureProduct[]): Promise<void>;
  store: KitFileStore;
  /** Для тестів; у бойовому режимі — `MAX_KIT_FILE_BYTES`. */
  maxBytes?: number;
  now?: () => Date;
}

const STATUS: Record<KitFileError, number> = {
  not_found: 404,
  bad_type: 415,
  empty: 400,
  too_large: 413,
  total_too_large: 413,
  too_many_files: 409,
  too_many_versions: 409,
  same_version: 409,
};

const newId = (prefix: string) => prefix + randomBytes(6).toString('hex');

// Усі зміни одного виробу виконуються по черзі: читання-зміна-запис списку не має гублювати чужу правку.
// Той самий замок бере збереження картки (furnitureProductRoutes), щоб воно не затерло щойно додану версію.
const queues = new Map<string, Promise<unknown>>();
export function serialKitFiles<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(job, job);
  const tail = run.catch(() => undefined);
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}
const serial = serialKitFiles;

export function registerKitFileRoutes(app: Express, deps: KitFileRouteDeps): void {
  const { auth, readDrafts, writeDrafts, store } = deps;
  const maxBytes = deps.maxBytes ?? MAX_KIT_FILE_BYTES;
  const now = deps.now ?? (() => new Date());
  const base = '/api/admin/furniture-products/:id/kit-files';

  const rawParser = express.raw({ type: '*/*', limit: maxBytes });
  const upload: RequestHandler = (req, res, next) =>
    rawParser(req, res, (err?: any) => {
      if (!err) return next();
      if (err.type === 'entity.too.large' || err.status === 413) return res.status(413).json({ error: KIT_FILE_ERRORS.too_large });
      return res.status(400).json({ error: 'Не вдалося прочитати файл.' });
    });

  const fail = (res: Response, error: KitFileError) => res.status(STATUS[error]).json({ error: KIT_FILE_ERRORS[error], code: error });

  const queryString = (v: unknown) => (typeof v === 'string' ? v : '');
  function decodeName(raw: string): string {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  app.post(base, auth, upload, async (req: Request, res: Response) => {
    try {
      const body = req.body;
      if (!Buffer.isBuffer(body)) return res.status(415).json({ error: 'Надішліть байти файлу (application/octet-stream).' });
      if (!body.length) return fail(res, 'empty');
      const rawName = decodeName(String(req.header('x-file-name') || ''));
      if (!rawName.trim()) return res.status(400).json({ error: 'Не вказано імʼя файлу (заголовок x-file-name).' });
      const fileName = sanitizeKitFileName(rawName);
      const sha256 = createHash('sha256').update(body).digest('hex');
      const fileIdParam = queryString(req.query.fileId);
      if (fileIdParam && !SAFE_ID.test(fileIdParam)) return fail(res, 'not_found');
      const productId = String(req.params.id);

      const outcome = await serial(productId, async () => {
        const drafts = await readDrafts();
        const idx = drafts.findIndex((d) => d.id === productId);
        if (idx < 0) return { status: 404, error: 'Чорнетку виробу не знайдено. Спершу збережіть картку.' } as const;
        const product = drafts[idx];
        if (!product.kit) return { status: 400, error: 'У цього виробу немає специфікації набору. Увімкніть набір і збережіть картку.' } as const;
        const files = product.kit.files ?? [];
        const input = {
          fileName, bytes: body.length, sha256,
          fileId: fileIdParam || newId('f'), versionId: newId('v'),
          name: queryString(req.query.name), note: queryString(req.query.note), now: now(),
        };
        const result = fileIdParam ? addKitFileVersion(files, input) : addKitFile(files, input);
        if (result.ok === false) return { status: STATUS[result.error], error: KIT_FILE_ERRORS[result.error], code: result.error } as const;
        await store.write(productId, result.file.id, result.version.id, body);
        try {
          drafts[idx] = { ...product, kit: { ...product.kit, files: result.files }, updatedAt: now().toISOString() };
          await writeDrafts(drafts);
        } catch (e) {
          await store.removeVersion(productId, result.file.id, result.version.id).catch(() => undefined);
          throw e;
        }
        return { status: 200, files: result.files, file: result.file, version: result.version } as const;
      });

      if (outcome.status !== 200) {
        const o = outcome as { status: number; error: string; code?: string };
        return res.status(o.status).json({ error: o.error, ...(o.code ? { code: o.code } : {}) });
      }
      const o = outcome as { files: unknown; file: unknown; version: unknown };
      res.json({ files: o.files, file: o.file, version: o.version });
    } catch (e) {
      console.error('[kit-files] upload', e);
      res.status(500).json({ error: 'Не вдалося зберегти файл.' });
    }
  });

  async function sendVersion(req: Request, res: Response, versionOf: 'latest' | 'param') {
    const productId = String(req.params.id);
    const fileId = String(req.params.fileId);
    const product = (await readDrafts()).find((d) => d.id === productId);
    const file = product?.kit?.files?.find((f) => f.id === fileId);
    if (!file) return fail(res, 'not_found');
    const version = versionOf === 'latest' ? latestVersion(file) : file.versions.find((v) => v.id === String(req.params.versionId));
    if (!version) return fail(res, 'not_found');
    const abs = await store.locate(productId, file.id, version.id);
    if (!abs) return fail(res, 'not_found');
    const asciiName = version.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(version.fileName)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    res.sendFile(abs, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(500).json({ error: 'Не вдалося віддати файл.' });
    });
  }

  app.get(`${base}/:fileId/download`, auth, (req, res) => {
    sendVersion(req, res, 'latest').catch(() => res.status(500).json({ error: 'Не вдалося віддати файл.' }));
  });
  app.get(`${base}/:fileId/versions/:versionId`, auth, (req, res) => {
    sendVersion(req, res, 'param').catch(() => res.status(500).json({ error: 'Не вдалося віддати файл.' }));
  });

  app.patch(`${base}/:fileId`, auth, express.json({ limit: '10kb' }), async (req, res) => {
    try {
      const productId = String(req.params.id);
      const fileId = String(req.params.fileId);
      const out = await serial(productId, async () => {
        const drafts = await readDrafts();
        const idx = drafts.findIndex((d) => d.id === productId);
        const product = drafts[idx];
        if (!product?.kit) return null;
        const files = renameKitFile(product.kit.files ?? [], fileId, req.body?.name);
        if (!files) return null;
        drafts[idx] = { ...product, kit: { ...product.kit, files }, updatedAt: now().toISOString() };
        await writeDrafts(drafts);
        return files;
      });
      if (!out) return res.status(404).json({ error: 'Файл не знайдено або назва порожня.' });
      res.json({ files: out });
    } catch (e) {
      console.error('[kit-files] rename', e);
      res.status(500).json({ error: 'Не вдалося перейменувати файл.' });
    }
  });

  app.delete(`${base}/:fileId`, auth, async (req, res) => {
    try {
      const productId = String(req.params.id);
      const fileId = String(req.params.fileId);
      const out = await serial(productId, async () => {
        const drafts = await readDrafts();
        const idx = drafts.findIndex((d) => d.id === productId);
        const product = drafts[idx];
        if (!product?.kit || !(product.kit.files ?? []).some((f) => f.id === fileId)) return null;
        const kit = {
          ...product.kit,
          files: removeKitFile(product.kit.files, fileId),
          parts: (product.kit.parts ?? []).map((p) => (p.fileId === fileId ? { ...p, fileId: '' } : p)),
          packaging: (product.kit.packaging ?? []).map((p) => (p.fileId === fileId ? { ...p, fileId: '' } : p)),
        };
        drafts[idx] = { ...product, kit, updatedAt: now().toISOString() };
        await writeDrafts(drafts);
        await store.removeFile(productId, fileId).catch((e) => console.error('[kit-files] remove bytes', e));
        return kit;
      });
      if (!out) return fail(res, 'not_found');
      res.json({ kit: out });
    } catch (e) {
      console.error('[kit-files] delete', e);
      res.status(500).json({ error: 'Не вдалося видалити файл.' });
    }
  });
}

/**
 * Сховище байтів файлів набору (K4): `<root>/<productId>/<fileId>.<versionId>.bin`.
 *
 * Метадані (імена, версії, sha256) живуть у картці виробу (`kit.files`), тут лише байти.
 * Усі ідентифікатори в шляху перевіряються на `SAFE_ID`; ідентифікатор виробу, що не підходить,
 * замінюється хешем, тому вийти за межі `root` неможливо за жодного вводу.
 *
 * Запис атомарний: спершу тимчасовий файл у тій самій теці, потім `rename`.
 */
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SAFE_ID } from '../src/components/adminOs/kitFiles';

export interface KitFileStore {
  write(productId: string, fileId: string, versionId: string, bytes: Buffer): Promise<void>;
  /** Абсолютний шлях до наявного файлу або `null`. */
  locate(productId: string, fileId: string, versionId: string): Promise<string | null>;
  removeVersion(productId: string, fileId: string, versionId: string): Promise<void>;
  removeFile(productId: string, fileId: string): Promise<void>;
  removeProduct(productId: string): Promise<void>;
}

export function productDirName(productId: string): string {
  return SAFE_ID.test(productId) ? productId : 'h_' + createHash('sha1').update(String(productId)).digest('hex').slice(0, 32);
}

export function createKitFileStore(root: string): KitFileStore {
  const base = path.resolve(root);
  const dirOf = (productId: string) => path.join(base, productDirName(productId));
  const need = (id: string) => {
    if (!SAFE_ID.test(id)) throw new Error('Небезпечний ідентифікатор файлу.');
    return id;
  };
  const fileOf = (productId: string, fileId: string, versionId: string) =>
    path.join(dirOf(productId), `${need(fileId)}.${need(versionId)}.bin`);

  return {
    async write(productId, fileId, versionId, bytes) {
      const target = fileOf(productId, fileId, versionId);
      await fs.mkdir(path.dirname(target), { recursive: true });
      const tmp = path.join(path.dirname(target), `.${randomBytes(6).toString('hex')}.tmp`);
      try {
        await fs.writeFile(tmp, bytes);
        await fs.rename(tmp, target);
      } catch (e) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw e;
      }
    },
    async locate(productId, fileId, versionId) {
      const target = fileOf(productId, fileId, versionId);
      try {
        const st = await fs.stat(target);
        return st.isFile() ? target : null;
      } catch {
        return null;
      }
    },
    async removeVersion(productId, fileId, versionId) {
      await fs.rm(fileOf(productId, fileId, versionId), { force: true });
    },
    async removeFile(productId, fileId) {
      need(fileId);
      const dir = dirOf(productId);
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      await Promise.all(names.filter((n) => n.startsWith(`${fileId}.`)).map((n) => fs.rm(path.join(dir, n), { force: true })));
    },
    async removeProduct(productId) {
      await fs.rm(dirOf(productId), { recursive: true, force: true });
    },
  };
}

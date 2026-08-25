/**
 * Сховище підготовлених файлів товару.
 *
 * Навіщо взагалі класти файли на диск, а не тримати їх у пам'яті задачі:
 * черга публікації зобов'язана пережити рестарт сервера (ТЗ 8), а байти в
 * пам'яті процесу рестарт не переживають. Тому в задачі лежать лише імена
 * файлів, а самі файли — тут, поруч із базою, у DATA_DIR/publishing/<товар>/.
 *
 * Ім'я файлу нормалізується й ніколи не використовується як шлях: інакше
 * назва на кшталт `../../server/auth.ts` перетворилася б на запис поза текою
 * товару.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../db';

export const PRODUCT_FILES_ROOT = path.join(DATA_DIR, 'publishing');

export class ProductFileError extends Error {}

/** Лишає лише базове ім'я й прибирає все, що може вивести за межі теки. */
export function sanitizeFileName(name: string): string {
  const base = path.basename(String(name || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^\.+/, '').slice(0, 120);
  if (!cleaned || cleaned === '_') throw new ProductFileError('Некоректне ім’я файлу.');
  return cleaned;
}

function productDir(productId: string): string {
  const safeId = sanitizeFileName(productId);
  return path.join(PRODUCT_FILES_ROOT, safeId);
}

export interface StoredProductFile {
  name: string;
  bytes: number;
  updatedAt: string;
}

export async function saveProductFile(
  productId: string,
  name: string,
  data: Uint8Array
): Promise<StoredProductFile> {
  const dir = productDir(productId);
  await fsp.mkdir(dir, { recursive: true });
  const safeName = sanitizeFileName(name);
  await fsp.writeFile(path.join(dir, safeName), data);
  return { name: safeName, bytes: data.length, updatedAt: new Date().toISOString() };
}

export async function readProductFile(productId: string, name: string): Promise<Uint8Array> {
  const file = path.join(productDir(productId), sanitizeFileName(name));
  return new Uint8Array(await fsp.readFile(file));
}

export async function listProductFiles(productId: string): Promise<StoredProductFile[]> {
  const dir = productDir(productId);
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  const out: StoredProductFile[] = [];
  for (const name of names) {
    try {
      const stat = await fsp.stat(path.join(dir, name));
      if (stat.isFile()) {
        out.push({ name, bytes: stat.size, updatedAt: stat.mtime.toISOString() });
      }
    } catch {
      /* файл зник між readdir і stat — пропускаємо */
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function deleteProductFile(productId: string, name: string): Promise<boolean> {
  try {
    await fsp.unlink(path.join(productDir(productId), sanitizeFileName(name)));
    return true;
  } catch {
    return false;
  }
}

export async function deleteProductFiles(productId: string): Promise<void> {
  try {
    await fsp.rm(productDir(productId), { recursive: true, force: true });
  } catch {
    /* нічого не було — нічого й прибирати */
  }
}

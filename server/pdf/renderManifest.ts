import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../db';
import type { CanonicalPageMap } from '../../shared/canonicalPageMap';

export type PdfArtifactFormat = 'digital' | 'print';

export interface PdfRenderManifest {
  version: 1;
  bookId: string;
  format: PdfArtifactFormat;
  bookRevision: number;
  engineId: string;
  filename: string;
  sizeBytes: number;
  pageCount: number;
  pageMap: CanonicalPageMap;
  builtAt: string;
}

function safeBookId(bookId: string): string {
  return String(bookId || '').trim().replace(/[^A-Za-z0-9._-]/g, '_');
}

function manifestPath(bookId: string, format: PdfArtifactFormat): string {
  return path.join(DATA_DIR, 'books', safeBookId(bookId), `pdf-${format}.manifest.json`);
}

/**
 * Persist the provenance of the SAME final PDF that produced pageMap.
 * A temporary file + rename prevents readers from seeing half-written JSON.
 */
export async function savePdfRenderManifest(manifest: PdfRenderManifest): Promise<PdfRenderManifest> {
  if (!manifest.bookId.trim()) throw new Error('Render manifest без id книги.');
  if (manifest.pageMap.engineId !== manifest.engineId) {
    throw new Error(
      `Render manifest неузгоджений: PDF engine=${manifest.engineId}, PageMap engine=${manifest.pageMap.engineId}.`
    );
  }
  if (manifest.pageMap.pageCount !== manifest.pageCount) {
    throw new Error(
      `Render manifest неузгоджений: PDF має ${manifest.pageCount} стор., PageMap — ${manifest.pageMap.pageCount}.`
    );
  }

  const target = manifestPath(manifest.bookId, manifest.format);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(manifest, null, 2), 'utf8');
  await fs.rename(temp, target);
  return manifest;
}

export async function readPdfRenderManifest(
  bookId: string,
  format: PdfArtifactFormat = 'digital'
): Promise<PdfRenderManifest | null> {
  try {
    const raw = await fs.readFile(manifestPath(bookId, format), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PdfRenderManifest>;
    if (
      parsed.version !== 1 ||
      parsed.bookId !== bookId ||
      parsed.format !== format ||
      typeof parsed.engineId !== 'string' ||
      typeof parsed.bookRevision !== 'number' ||
      typeof parsed.filename !== 'string' ||
      typeof parsed.sizeBytes !== 'number' ||
      typeof parsed.pageCount !== 'number' ||
      typeof parsed.builtAt !== 'string' ||
      !parsed.pageMap ||
      parsed.pageMap.version !== 1 ||
      parsed.pageMap.engineId !== parsed.engineId ||
      parsed.pageMap.pageCount !== parsed.pageCount
    ) {
      return null;
    }
    return parsed as PdfRenderManifest;
  } catch {
    return null;
  }
}

export async function removePdfRenderManifest(
  bookId: string,
  format: PdfArtifactFormat = 'digital'
): Promise<void> {
  try {
    await fs.unlink(manifestPath(bookId, format));
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
  }
}

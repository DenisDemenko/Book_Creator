import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = path.join(os.tmpdir(), `nova-pdf-render-manifest-${process.pid}-${Date.now()}`);
process.env.DATA_DIR = dataDir;

const {
  readPdfRenderManifest,
  removePdfRenderManifest,
  savePdfRenderManifest,
} = await import('../server/pdf/renderManifest.ts');

const manifest = {
  version: 1 as const,
  bookId: 'book-manifest-test',
  format: 'digital' as const,
  bookRevision: 7,
  engineId: 'pandoc',
  filename: 'Book.pdf',
  sizeBytes: 1234,
  pageCount: 3,
  pageMap: {
    version: 1 as const,
    source: 'pandoc-pdf' as const,
    engineId: 'pandoc',
    precision: 'exact' as const,
    pageCount: 3,
    bodyStartPageIndex: null,
    landmarks: [
      {
        kind: 'chapter' as const,
        id: 'chapter-1',
        chapterId: 'chapter-1',
        title: 'Розділ 1',
        filePageIndex: 0,
        filePageNumber: 1,
        displayPageNumber: null,
      },
    ],
  },
  builtAt: '2026-10-16T12:00:00.000Z',
};

try {
  await savePdfRenderManifest(manifest);
  assert.deepEqual(await readPdfRenderManifest(manifest.bookId, manifest.format), manifest);

  await assert.rejects(
    () => savePdfRenderManifest({
      ...manifest,
      engineId: 'nova',
    }),
    /PageMap engine=pandoc/,
    'manifest must reject a PageMap produced by another engine',
  );

  await assert.rejects(
    () => savePdfRenderManifest({
      ...manifest,
      pageCount: 4,
    }),
    /PDF має 4 стор\., PageMap — 3/,
    'manifest must reject a PageMap with another final page count',
  );

  await removePdfRenderManifest(manifest.bookId, manifest.format);
  assert.equal(await readPdfRenderManifest(manifest.bookId, manifest.format), null);

  const routesSource = await fs.readFile(new URL('../server/bookRoutes.ts', import.meta.url), 'utf8');
  assert.match(routesSource, /\/api\/books\/:id\/artifact\/pdf\/manifest/);
  assert.match(routesSource, /manifest\.bookRevision === pdf\.record\.bookRevision/);
  assert.match(routesSource, /manifest\.filename === pdf\.record\.filename/);
  assert.match(routesSource, /manifest\.sizeBytes === pdf\.record\.sizeBytes/);
  assert.match(routesSource, /manifest\.pageCount === pdf\.record\.pageCount/);
  assert.match(routesSource, /X-Pdf-Engine/);
  assert.match(routesSource, /X-Pdf-PageMap-Precision/);
  assert.match(routesSource, /X-Pdf-PageMap-Source/);
  assert.match(routesSource, /engineId: req\.body\?\.engineId/);
  assert.match(routesSource, /hasBleed: Boolean\(req\.body\?\.hasBleed\)/);

  const pdfRoutesSource = await fs.readFile(new URL('../server/pdfRoutesBase.ts', import.meta.url), 'utf8');
  assert.match(pdfRoutesSource, /readPdfRenderManifest\(stored\.id, format\)/);
  assert.match(pdfRoutesSource, /renderManifest\.builtAt === pdf\.record\.builtAt/);
  assert.match(pdfRoutesSource, /const engineId = renderManifest\?\.engineId \|\| DEFAULT_PDF_ENGINE/);
  assert.match(pdfRoutesSource, /const bridgeEngineId = engineId === DEFAULT_PDF_ENGINE \? undefined : engineId/);
  assert.match(pdfRoutesSource, /engineId: bridgeEngineId/);
  assert.match(pdfRoutesSource, /provenance: renderManifest \? 'render-manifest' : 'legacy-nova'/);
  assert.match(pdfRoutesSource, /engineStaleUk/);

  console.log('PDF render manifest contract: OK');
} finally {
  await fs.rm(dataDir, { recursive: true, force: true });
}

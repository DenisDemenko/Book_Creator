import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const coverRaster = await fs.readFile(new URL('../src/utils/pdfCover.ts', import.meta.url), 'utf8');
const publishingHub = await fs.readFile(new URL('../src/components/PublishingHubView.tsx', import.meta.url), 'utf8');
const coverDesigner = await fs.readFile(new URL('../src/components/CoverDesignerView.tsx', import.meta.url), 'utf8');
const bookRoutes = await fs.readFile(new URL('../server/bookRoutes.ts', import.meta.url), 'utf8');
const pdfRoutes = await fs.readFile(new URL('../server/pdfRoutesBase.ts', import.meta.url), 'utf8');
const bridge = await fs.readFile(new URL('../server/marketplaceBridge.ts', import.meta.url), 'utf8');
const store = await fs.readFile(new URL('../server/bookStore.ts', import.meta.url), 'utf8');

// Cover Studio keeps all production fields on the canonical book object.
assert.match(coverDesigner, /coverConfig:\s*\{\s*\.\.\.cover,\s*\.\.\.updated,?\s*\}/s);
assert.match(coverDesigner, /frontArtUrl/);
assert.match(coverDesigner, /backArtUrl/);
assert.match(coverDesigner, /paperStock/);
assert.match(coverDesigner, /coverMaterial/);
assert.match(coverDesigner, /finish/);

// Marketplace cover raster now prefers Cover Designer, not the interior title page.
assert.match(coverRaster, /renderBookFrontCoverToPng/);
assert.match(coverRaster, /book\.coverConfig\?\.frontArtUrl/);
assert.match(coverRaster, /book\.coverConfig\?\.coverImageUrl/);
assert.match(coverRaster, /loadBook\(\)/);
assert.match(coverRaster, /pdfBelongsToBook/);
assert.match(coverRaster, /return await renderBookFrontCoverToPng\(activeBook/);
assert.match(coverRaster, /legacy fallback/);

// Normal Fusion Lab storefront publication still creates coverBase64 before publish.
assert.match(publishingHub, /renderPdfFirstPageToPng\(await previewRes\.blob\(\)\)/);
assert.match(publishingHub, /coverBase64/);
assert.match(publishingHub, /\/api\/admin\/pdf\/publish/);

// Stored book JSON remains lossless for cover production fields (no whitelist projection).
assert.match(store, /book:\s*JSON\.parse\(JSON\.stringify\(params\.book \|\| \{\}\)\)/);
assert.match(store, /const payload = JSON\.stringify\(book\)/);
assert.match(store, /JSON\.parse\(String\(row\.payload\)\)/);

// Public cover route is intentionally unauthenticated and versionable for marketplace cards.
assert.match(bookRoutes, /app\.get\('\/api\/public\/books\/:id\/cover'/);
assert.match(bookRoutes, /readArtifact\(req\.params\.id, 'cover', format\)/);
assert.match(bookRoutes, /readArtifact\(req\.params\.id, 'cover', 'digital'\)/);
assert.match(bookRoutes, /Cache-Control/);
assert.match(bookRoutes, /public, max-age=86400/);
assert.match(bookRoutes, /app\.post\('\/api\/books\/:id\/artifact\/cover'/);

// Stored publication cannot silently create a blank storefront card.
assert.match(pdfRoutes, /readArtifact\(stored\.id, 'cover', format\)/);
assert.match(pdfRoutes, /readArtifact\(stored\.id, 'cover', 'digital'\)/);
assert.match(pdfRoutes, /const coverUrl =/);
assert.match(pdfRoutes, /\/api\/public\/books\/\$\{encodeURIComponent\(stored\.id\)\}\/cover/);
assert.match(pdfRoutes, /publishBookToMarketplace/);
assert.match(pdfRoutes, /attachBookFileToMarketplace/);
assert.match(pdfRoutes, /bytes:\s*cover\.bytes/);
assert.match(pdfRoutes, /kind:\s*'cover'/);

// Marketplace bridge receives both a URL fallback and binary cover upload.
assert.match(bridge, /coverUrl:\s*input\.coverUrl/);
assert.match(bridge, /export async function attachBookFileToMarketplace/);
assert.match(bridge, /export type BridgeFileKind = 'attachment' \| 'cover' \| 'sample'/);
assert.match(bridge, /form\.append\('kind', input\.kind \|\| 'attachment'\)/);

console.log('Marketplace Cover Designer publishing contract: OK');

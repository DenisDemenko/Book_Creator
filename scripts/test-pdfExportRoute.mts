import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const routeSource = await fs.readFile(new URL('../server/pdfExportRoutes.ts', import.meta.url), 'utf8');
const routerSource = await fs.readFile(new URL('../server/pdfRoutes.ts', import.meta.url), 'utf8');
const exportViewSource = await fs.readFile(new URL('../src/components/ExportView.tsx', import.meta.url), 'utf8');

assert.match(routeSource, /app\.post\('\/api\/pdf\/export', requireAuth/);
assert.match(routeSource, /resolveBookPdfEngineId\(book, req\.body\?\.engineId\)/);
assert.match(routeSource, /renderWithEngine\(engineId,/);
assert.match(routeSource, /bookToPdfInput\(book\)/);
assert.match(routeSource, /specFromBook\(book\)/);
assert.match(routeSource, /Content-Disposition/);
assert.match(routeSource, /X-Pdf-Engine/);
assert.match(routeSource, /X-Pdf-PageMap-Precision/);
assert.doesNotMatch(routeSource, /saveArtifact\(/, 'direct download must not mutate stored artifacts');
assert.doesNotMatch(routeSource, /publishBookToMarketplace/, 'direct download must not publish');
assert.doesNotMatch(routeSource, /generateText/, 'direct download must not trigger AI layout generation');

assert.match(routerSource, /registerPdfExportRoutes\(app\)/);

assert.match(exportViewSource, /fetch\('\/api\/pdf\/export'/);
assert.match(exportViewSource, /preferredPdfEngineId/);
assert.match(exportViewSource, /handleExportServerPdf\('digital'\)/);
assert.match(exportViewSource, /handleExportServerPdf\('print', 'nova'\)/);
assert.match(exportViewSource, /Print PDF · явно через Nova/);
assert.match(exportViewSource, /Legacy \/ Browser Print/);
assert.match(exportViewSource, /const handleLegacyBrowserPrint = \(\) =>/);
assert.match(exportViewSource, /printWindow\.print\(\)/);

assert.match(
  exportViewSource,
  /onClick=\{\(\) => handleExportServerPdf\('digital'\)\}[\s\S]{0,400}data-tour="export__2"/,
  'primary PDF tour action must call the canonical server renderer',
);
assert.doesNotMatch(
  exportViewSource,
  /onClick=\{handleLegacyBrowserPrint\}[\s\S]{0,300}data-tour="export__2"/,
  'legacy browser print must not own the primary PDF action',
);

console.log('Canonical PDF export route/UI contract: OK');

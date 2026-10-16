import assert from 'node:assert/strict';
import fs from 'node:fs';

const picker = fs.readFileSync(new URL('../src/components/KdpEngineExport.tsx', import.meta.url), 'utf8');
const exportView = fs.readFileSync(new URL('../src/components/ExportView.tsx', import.meta.url), 'utf8');
const modal = fs.readFileSync(new URL('../src/components/KdpPublishingModal.tsx', import.meta.url), 'utf8');
const registry = fs.readFileSync(new URL('../server/pdf/engines/registry.ts', import.meta.url), 'utf8');

assert.match(picker, /engine\.supportsPrint/);
assert.match(picker, /engineId: selected\.id/);
assert.match(picker, /format: 'print'/);
assert.match(picker, /Studio не підмінює KDP-рушій автоматично/);

assert.match(exportView, /<KdpEngineExport/);
assert.doesNotMatch(exportView, /handleExportServerPdf\('print', 'nova'\)/);

assert.match(modal, /<KdpEngineExport/);
assert.match(modal, /handleLegacyKdpBrowserPrint/);
assert.match(modal, /Legacy \/ Browser Print/);
assert.doesNotMatch(modal, /onClick=\{handleExportKdpPrintPdf\}/);

assert.match(registry, /Оберіть Nova або DesignCraft/);
assert.match(registry, /designcraft: designcraftEngineV3/);

console.log('KDP engine choice UI contract: ok');

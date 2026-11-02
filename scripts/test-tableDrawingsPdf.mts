// PDF-креслення столу: специфікація із замовником, скрипт DesignCraft з аркушів, справжній запуск (якщо є бінарник).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { PDFDocument } from 'pdf-lib';
import {
  PAGE,
  buildDrawingsScript,
  customerOf,
  drawingsFileName,
  loadProduction,
  renderDrawingsPdf,
  slabStudioDir,
  specLines,
  DrawingsError,
  type DrawingsOrder,
} from '../server/tableDrawingsPdf';

const dir = slabStudioDir();
const context: Record<string, any> = vm.createContext({ TextEncoder });
context.window = context;
for (const f of ['geometry.js', 'table-legs.js', 'table-edges.js', 'table-production.js'])
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), context as any, { filename: f });
const TL = context.TableLegs;

// Замовлення так, як його віддає адмін-API: композиція, слеби, котирування ніжок і покупець.
const slabs = [
  { id: 'a', number: 'SL-001', species: 'Горіх', w: 160, h: 40, t: 4, points: [[0, 0.1], [0.5, 0], [1, 0.15], [1, 0.9], [0.45, 1], [0, 0.85]] },
  { id: 'b', number: 'SL-002', species: 'Дуб', w: 150, h: 36, t: 4, points: [[0, 0], [1, 0.1], [1, 1], [0, 0.9]] },
];
const plateSpec = { id: 'p', name: 'Пластина 150', widthCm: 15, depthCm: 15, holeDiameterMm: 6, holeInsetMm: 15, countersink: true };
function order(extra: Record<string, unknown> = {}): DrawingsOrder {
  const set = { columnDims: { top: 30, foot: 60 }, slats: { thick: 2, radius: 0.8 } };
  const o: any = {
    id: 'o1', number: 'T-100', shape: 'rect', l: 200, w: 100, t: 4, color: '#24474b', cornerMm: 100,
    edgeTopMm: 8, edgeBottomMm: 4, edgeTopStyle: 'round', edgeBottomStyle: 'chamfer', resinAngle: 30, resinTransparency: 50,
    pieces: [{ id: 'a', uid: '1', x: 0, y: -20, angle: 0 }, { id: 'b', uid: '2', x: 5, y: 22, angle: 4 }],
    slabs, quote: { litres: 12.5, kg: 14, resin: 0.5 },
    legSet: { scheme: 'pedestal', height: 75, thickness: 9, material: 'oak', ...set },
    buyer: { displayName: 'Іван Тест', email: 'ivan@example.com' },
    ...extra,
  };
  const input = { shape: o.shape, l: o.l, w: o.w, t: o.t, corner: o.cornerMm / 10, scheme: 'pedestal', height: 75, thickness: 9, plateT: 2, inset: 5, plateCm: 15, ...set };
  const base = TL.layout(input);
  const plates = TL.plates(base.mounts, plateSpec, 2, base.legLength, { l: o.l, w: o.w });
  o.quote.legs = {
    scheme: 'pedestal', schemeName: 'Центральна колона', height: 75, thickness: 9, inset: 5, plateThicknessCm: 2, legLength: base.legLength,
    columnDims: set.columnDims, slats: set.slats, slatCount: TL.slatCount(base), material: { name: 'Дуб' },
    plate: { ...plateSpec, holeInsetMm: plates[0].holeInsetMm },
    mounts: plates.map((p: any) => ({ x: p.x, y: p.y, w: p.w, d: p.d })),
  };
  return o;
}

// ---- замовник: з профілю, а коли є знімок customer — з нього
const o = order();
assert.deepEqual(customerOf(o), { name: 'Іван Тест', email: 'ivan@example.com', phone: '', address: '' });
const withCustomer = order({ customer: { name: 'Марія Петренко', email: 'm@example.com', shipping: { recipientName: 'Марія Петренко', phone: '+380501112233', city: 'Київ', branch: 'Відділення 5' } } });
assert.deepEqual(customerOf(withCustomer), { name: 'Марія Петренко', email: 'm@example.com', phone: '+380501112233', address: 'Київ, Відділення 5' });

// ---- специфікація містить замовника й усе, що вибрано
const text = specLines(o).join('\n');
for (const piece of [
  'Креслення столу №T-100', 'Ім’я: Іван Тест', 'Email: ivan@example.com',
  'прямокутник, 2000 × 1000 × 40 мм', 'Радіус кутів: 100 мм', 'верх — скруглення 8 мм', 'низ — фаска 45° 4 мм',
  'ЕПОКСИДНА СМОЛА', 'Колір: #24474b', 'Прозорість: 50 %', 'Поворот текстури: 30°', 'Обсяг: 12,5 л',
  'SL-001 · Горіх · 400 × 1600 × 40 мм', 'SL-002 · Дуб',
  'Схема: Центральна колона', 'Колона: верхнє коло Ø300 → нижнє Ø600 мм', 'Рейки: товщина 20 мм, скруглення 8 мм', 'Пластини: 1 ×', '4 отвори Ø6 мм',
])
  assert.ok(text.includes(piece), 'специфікація має «' + piece + '»');
assert.ok(specLines(withCustomer).join('\n').includes('Телефон: +380501112233') && specLines(withCustomer).join('\n').includes('Доставка: Київ, Відділення 5'));
const bare = order();
delete (bare.quote as any).legs;
assert.ok(!specLines(bare).join('\n').includes('НІЖКИ'), 'без ніжок немає й розділу');

// ---- скрипт: сторінка на аркуш + специфікація, SVG вміщується, масштаб написаний
const { steps, pages, scales } = buildDrawingsScript(o);
const production = loadProduction();
const sheets = production.sheets(o);
assert.equal(pages, sheets.length + 1);
assert.equal(steps[0].command, 'file.new');
assert.equal(steps[0].params.pages, pages);
assert.equal(steps[steps.length - 1].command, 'file.exportPdf');
const pastes = steps.filter((s) => s.command === 'edit.pasteSvg');
assert.equal(pastes.length, sheets.length + 1, 'аркуші й зразок кольору');
const areaW = PAGE.w - 2 * PAGE.margin, areaH = PAGE.h - 2 * PAGE.margin - PAGE.footer;
sheets.forEach((s, i) => {
  const svg = String(pastes[i + 1].params.svg);
  const m = /width="([0-9.]+)mm" height="([0-9.]+)mm" viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(svg)!;
  assert.ok(m, s.id);
  const wPt = (Number(m[1]) * 72) / 25.4, hPt = (Number(m[2]) * 72) / 25.4;
  assert.ok(wPt <= areaW + 1e-6 && hPt <= areaH + 1e-6, `${s.id}: вміщується на A4 (${wPt.toFixed(0)}×${hPt.toFixed(0)} пт)`);
  assert.ok(Math.abs(Number(m[3]) * scales[i] - s.w) < 0.01 && Math.abs(Number(m[1]) * scales[i] - s.w) < 0.01, `${s.id}: аркуш зменшений рівно в ${scales[i]} разів`);
  assert.equal(pastes[i + 1].params.spread, i + 1);
});
assert.ok(scales.every((n) => n >= 1), 'масштаб не більший за 1:1');
const footers = steps.filter((s) => s.command === 'frame.create' && String(s.params.text).startsWith('Fusion Lab'));
assert.equal(footers.length, pages, 'підпис на кожній сторінці');
assert.ok(footers.every((f) => String(f.params.text).includes('замовник: Іван Тест') && String(f.params.text).includes('№T-100')), 'підпис із замовником');
assert.ok(String(footers[2].params.text).includes(`масштаб 1:${scales[1]}`) && String(footers[2].params.text).includes(`лист 3 з ${pages}`));
// скрипт серіалізується в один рядок на команду
for (const s of steps) assert.ok(!JSON.stringify(s.params).includes('\n'));
// лінія на папері не тонша за 0,2 мм: у зменшеному аркуші ширини підвищено
const reduced = production.svg(sheets[0], o, { scale: 0.1 });
assert.ok(!/stroke-width="0\.[01]/.test(reduced) && /stroke-width="0\.2"/.test(reduced), 'тонкі лінії підвищено до 0,2 мм на папері');
assert.ok(!reduced.includes('transform="scale('), 'аркуш намальовано малим, а не розтягнуто');
assert.ok(/масштаб 1:10/.test(reduced));
assert.ok(production.svg(sheets[0], o).includes('масштаб 1:1.'));
assert.equal(drawingsFileName(o), 'stil-T-100-kreslennya.pdf');

// ---- без бінарника — зрозуміла помилка, а не падіння
const keep = process.env.DESIGNCRAFT_DRAWINGS_PATH;
delete process.env.DESIGNCRAFT_DRAWINGS_PATH;
await assert.rejects(renderDrawingsPdf(o), (e: unknown) => e instanceof DrawingsError && (e as DrawingsError).status === 503);
if (keep) process.env.DESIGNCRAFT_DRAWINGS_PATH = keep;

// ---- справжній DesignCraft (локально: DESIGNCRAFT_DRAWINGS_PATH=…/designcraft-cli), у CI пропускається
const cli = keep;
if (cli) {
  const pdf = await renderDrawingsPdf(o, { cli });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const doc = await PDFDocument.load(pdf);
  assert.equal(doc.getPageCount(), pages, 'у PDF стільки сторінок, скільки аркушів + специфікація');
  const { width, height } = doc.getPage(0).getSize();
  assert.ok(Math.abs(width - 595.28) < 1 && Math.abs(height - 841.89) < 1 && width < height, 'A4 книжна: вужча, ніж висока');
  if (process.env.KEEP_DRAWINGS_PDF) fs.writeFileSync(process.env.KEEP_DRAWINGS_PDF, pdf);
  console.log(`✓ креслення: PDF ${pdf.length} Б, ${pages} сторінок, зібрано справжнім DesignCraft`);
} else {
  console.log('✓ креслення: специфікація, замовник, скрипт DesignCraft (справжній запуск пропущено: немає DESIGNCRAFT_DRAWINGS_PATH)');
}

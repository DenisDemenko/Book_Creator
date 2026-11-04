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
  DEFAULT_DRAWINGS_TEMPLATE,
  listDrawingsTemplates,
  resolveDrawingsTemplate,
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

// ---- шаблони дизайну: ті самі теми, що й у книг Студії
const templates = listDrawingsTemplates();
assert.equal(templates.length, 17, 'усі дизайн-теми книг');
assert.ok(templates.every((t) => t.id && t.label && t.description), 'кожен шаблон має назву й опис');
assert.equal(templates.filter((t) => t.default).length, 1);
assert.equal(templates.find((t) => t.default)!.id, DEFAULT_DRAWINGS_TEMPLATE);
assert.equal(resolveDrawingsTemplate('sci-fi'), 'sci-fi');
assert.equal(resolveDrawingsTemplate('nonsense'), DEFAULT_DRAWINGS_TEMPLATE, 'невідомий шаблон — типовий, а не помилка');
assert.equal(resolveDrawingsTemplate(undefined), DEFAULT_DRAWINGS_TEMPLATE);
assert.equal(resolveDrawingsTemplate(['sci-fi']), DEFAULT_DRAWINGS_TEMPLATE, 'масив із запиту не пропускається');
const styled = (template?: string) => buildDrawingsScript(o, undefined, { template });
for (const id of ['academic-research', 'modern-fiction', 'sci-fi', 'children']) {
  const { steps: ss, template } = styled(id);
  assert.equal(template, id);
  const created = ss.filter((x) => x.command === 'style.paragraph.create');
  assert.deepEqual(created.map((x) => x.params.name).slice(0, 3), ['Body', 'Heading 1', 'Heading 2'], id + ': стилі абзаців теми');
  // шрифти беруться з теми, тож різні теми дають різні стилі
  assert.ok(created.every((x) => (x.params.chars as any).fontFamily), id + ': у стилях є шрифт');
}
const a1 = JSON.stringify(styled('academic-research').steps.filter((x) => x.command === 'style.paragraph.create'));
const a2 = JSON.stringify(styled('modern-fiction').steps.filter((x) => x.command === 'style.paragraph.create'));
assert.notEqual(a1, a2, 'різні теми — різний вигляд');
{
  const { steps: ss } = styled('sci-fi');
  const at = ss.findIndex((x) => x.command === 'frame.create' && String(x.params.text).startsWith('Креслення столу'));
  assert.ok(at > 0);
  const after = ss.slice(at + 1, at + 40);
  const selects = after.filter((x) => x.command === 'text.select');
  assert.ok(selects.every((x) => x.params.story === '$' + at + '.story'), 'абзаци адресуються до рамки специфікації');
  const applies = after.filter((x) => x.command === 'style.paragraph.apply').map((x) => x.params.name);
  assert.equal(applies[0], 'Body');
  assert.equal(applies[1], 'Heading 1', 'перший рядок — заголовок');
  assert.equal(applies.filter((n) => n === 'Heading 2').length, 5, 'п’ять розділів: замовник, стільниця, смола, слеби, ніжки');
  // межі абзаців у байтах UTF-8: рядок «Креслення столу №T-100» — перший
  const first = specLines(o)[0];
  assert.deepEqual([selects[1].params.anchor, selects[1].params.focus], [0, Buffer.byteLength(first, 'utf8')]);
}

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
  for (const id of ['sci-fi', 'children']) {
    const other = await renderDrawingsPdf(o, { cli, template: id });
    assert.equal((await PDFDocument.load(other)).getPageCount(), pages, id + ': шаблон не змінює кількість сторінок');
    assert.notDeepEqual(new Uint8Array(other), new Uint8Array(pdf), id + ': інший шаблон — інший файл');
  }
  console.log(`✓ креслення: PDF ${pdf.length} Б, ${pages} сторінок, зібрано справжнім DesignCraft`);
} else {
  console.log('✓ креслення: специфікація, замовник, скрипт DesignCraft (справжній запуск пропущено: немає DESIGNCRAFT_DRAWINGS_PATH)');
}

const apronOrder = order() as any;
apronOrder.legSet = {scheme:'straight',height:75,thickness:6,material:'oak',apron:{height:6,thickness:2.4}};
apronOrder.quote.legs = {...apronOrder.quote.legs,scheme:'straight',schemeName:'Прямі квадратні',columnDims:null,slats:null,apron:{height:6,thickness:2.4},legLength:63};
assert(specLines(apronOrder).some(line=>line.includes('ЦАРГИ')&&line.includes('60 мм')&&line.includes('24 мм')));
const apronBase = context.TableProduction.legsOf(apronOrder).base;
assert.equal(apronBase.parts.filter((p:any)=>p.id.startsWith('apron.')).length,4);
assert.equal(apronBase.legLength,63);
console.log('✓ PDF apron specification and shared four-board geometry agree with the order');

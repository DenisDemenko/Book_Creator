/**
 * Тести інструкції набору (трек K3). Запуск: npm run test:kit-instruction
 *
 *  1. Коди й підписи деталей.
 *  2. Побудова інструкції зі специфікації (комплектація + безпека).
 *  3. Синхронізація: зміна специфікації видна в інструкції, ручне лишається, коди стабільні.
 *  4. Приведення стороннього документа.
 *  5. Сервер: збереження картки доганяє інструкцію за специфікацією.
 */
const DIR = '/tmp/nova-kit-instruction-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const kit = await import('../src/components/adminOs/kitSpec');
const safety = await import('../src/components/adminOs/kitSafety');
const ki = await import('../src/utils/kitInstruction');
const fp = await import('../src/components/adminOs/furnitureProduct');
const routes = await import('../server/furnitureProductRoutes');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
type K = import('../src/components/adminOs/kitSpec').KitSpec;
const part = (over: Partial<import('../src/components/adminOs/kitSpec').KitLine> = {}) => ({ ...kit.blankKitLine(), name: 'Деталь', unitPriceUah: 1, ...over });
const makeKit = (over: Partial<K> = {}): K => ({
  ...kit.blankKit(),
  enabled: true,
  safety: { ...safety.blankSafety(), ageMinYears: 8, smallParts: false, warnings: ['Збирати з дорослим.'] },
  parts: [
    part({ id: 'p1', name: 'Бокова панель', qty: 2, material: 'береза 6 мм' }),
    part({ id: 'p2', name: 'Шканта', qty: 10, unit: 'шт' }),
    part({ id: 'p3', name: 'Шнур', qty: 0.5, unit: 'м' }),
  ],
  packaging: [part({ id: 'k1', name: 'Коробка', qty: 1 })],
  ...over,
});
const now = new Date('2026-10-29T12:00:00Z');
const later = new Date('2026-10-30T12:00:00Z');
const codes = (d: import('../src/types').Instruction) => d.materials.map((m) => `${m.code}:${m.name}`).join('|');

console.log('\nКоди й підписи');
t('коди: A…Z, AA, AB, BA', ki.kitPartCode(0) === 'A' && ki.kitPartCode(25) === 'Z' && ki.kitPartCode(26) === 'AA' && ki.kitPartCode(27) === 'AB' && ki.kitPartCode(52) === 'BA');
t('підпис деталі з матеріалом і без', ki.kitPartLabel({ name: ' Панель ', material: 'береза 6 мм' }) === 'Панель (береза 6 мм)' && ki.kitPartLabel({ name: 'Шканта', material: '' }) === 'Шканта');
t('кількість з одиницею, дробова з комою, одиниця за замовчуванням', ki.kitPartQty({ qty: 10, unit: 'шт' }) === '10 шт' && ki.kitPartQty({ qty: 0.5, unit: 'м' }) === '0,5 м' && ki.kitPartQty({ qty: 2, unit: '' }) === '2 шт');
t('у комплектацію йдуть лише деталі з назвою, без пакування', ki.kitInstructionParts(makeKit({ parts: [part({ id: 'a', name: '' }), part({ id: 'b', name: 'Є' })] })).length === 1);

console.log('\nПобудова');
const built = ki.buildKitInstruction({ name: ' Конструктор «Міст» ', sku: ' KIT-1 ' }, makeKit(), now);
t('назва й код — з картки виробу, тип «складання»', built.title === 'Конструктор «Міст»' && built.modelCode === 'KIT-1' && built.docType === 'assembly');
t('комплектація: A, B, C зі специфікації, кількість з одиницею', codes(built) === 'A:Бокова панель (береза 6 мм)|B:Шканта|C:Шнур' && built.materials[0].qty === '2 шт' && built.materials[2].qty === '0,5 м', codes(built));
t('рядки привʼязані до деталей', built.materials.map((m) => m.specLineId).join() === 'p1,p2,p3');
t('порожнього рядка-заглушки немає', built.materials.every((m) => m.name.trim()));
t('безпека: вік і попередження зі специфікації', built.warnings.join('|') === 'Вік: 8+.|Збирати з дорослим.' && built.kitSource?.specWarnings.length === 2);
t('кроки: один порожній, готові до заповнення', built.steps.length === 1 && built.steps[0].title === '');
t('безпека неповна — розділ без спецрядків, порожній рядок для автора', ki.buildKitInstruction({ name: 'X', sku: 'X' }, makeKit({ safety: safety.blankSafety() }), now).warnings.join() === '' && ki.buildKitInstruction({ name: 'X', sku: 'X' }, makeKit({ safety: safety.blankSafety() }), now).warnings.length === 1);
t('дрібні деталі: автоматичне попередження теж у розділі', ki.buildKitInstruction({ name: 'X', sku: 'X' }, makeKit({ safety: { ...safety.blankSafety(), ageMinYears: 5, smallParts: true } }), now).warnings.includes(safety.SMALL_PARTS_WARNING));

console.log('\nСинхронізація');
const same = ki.syncInstructionWithKit(built, makeKit(), later);
t('без змін — той самий обʼєкт і changed=false', same.doc === built && !same.changed && Object.values(same.changes).every((n) => n === 0));
t('drift: без змін немає', !ki.kitInstructionDrift(built, makeKit()));
const qtyChanged = ki.syncInstructionWithKit(built, makeKit({ parts: [part({ id: 'p1', name: 'Бокова панель', qty: 4, material: 'береза 6 мм' }), makeKit().parts[1], makeKit().parts[2]] }), later);
t('зміна кількості видна в інструкції', qtyChanged.changed && qtyChanged.doc.materials[0].qty === '4 шт' && qtyChanged.changes.materialsUpdated === 1 && qtyChanged.doc.updatedAt === later.toISOString());
t('drift: зміна специфікації помітна', ki.kitInstructionDrift(built, makeKit({ parts: [part({ id: 'p1', name: 'Інша', qty: 1 })] })));
t('зміна ціни деталі інструкцію не чіпає', !ki.syncInstructionWithKit(built, makeKit({ parts: makeKit().parts.map((p) => ({ ...p, unitPriceUah: 999 })) }), later).changed);
const renamed = ki.syncInstructionWithKit(built, makeKit({ parts: [part({ id: 'p1', name: 'Панель бічна', qty: 2, material: 'береза 6 мм' }), makeKit().parts[1], makeKit().parts[2]] }), later);
t('перейменування лишає код деталі', renamed.doc.materials[0].code === 'A' && renamed.doc.materials[0].name === 'Панель бічна (береза 6 мм)');
const removed = ki.syncInstructionWithKit(built, makeKit({ parts: [makeKit().parts[1], makeKit().parts[2]] }), later);
t('видалена деталь зникає, коди інших СТАБІЛЬНІ (B, C)', codes(removed.doc) === 'B:Шканта|C:Шнур' && removed.changes.materialsRemoved === 1, codes(removed.doc));
const readded = ki.syncInstructionWithKit(removed.doc, makeKit({ parts: [part({ id: 'p9', name: 'Нова', qty: 1 }), makeKit().parts[1], makeKit().parts[2]] }), later);
t('нова деталь отримує перший вільний код (A)', readded.doc.materials.find((m) => m.specLineId === 'p9')?.code === 'A' && readded.changes.materialsAdded === 1, codes(readded.doc));
t('порядок: за специфікацією', readded.doc.materials.map((m) => m.specLineId).join() === 'p9,p2,p3');

const withManual = { ...built, materials: [...built.materials, { id: 'm-x', code: 'Z1', name: 'Клей ПВА', qty: '1 пляшка' }], warnings: [...built.warnings, 'Клей — лише дорослим.'] };
const syncedManual = ki.syncInstructionWithKit(withManual, makeKit({ parts: [makeKit().parts[0]] }), later);
t('ручні рядки комплектації лишаються після специфікації', codes(syncedManual.doc) === 'A:Бокова панель (береза 6 мм)|Z1:Клей ПВА', codes(syncedManual.doc));
t('ручні попередження лишаються', syncedManual.doc.warnings.includes('Клей — лише дорослим.') && syncedManual.doc.warnings[0] === 'Вік: 8+.');
const collide = ki.syncInstructionWithKit({ ...withManual, materials: [{ id: 'm-a', code: 'A', name: 'Ручний A', qty: '1' }] }, makeKit(), later);
t('код ручного рядка не віддається деталі', collide.doc.materials.filter((m) => m.specLineId).map((m) => m.code).join() === 'B,C,D', collide.doc.materials.map((m) => m.code).join());
const ageUp = ki.syncInstructionWithKit(withManual, makeKit({ safety: { ...makeKit().safety, ageMinYears: 12, warnings: ['Нове попередження.'] } }), later);
t('вік і попередження оновились, старі спецрядки зникли, ручні лишились', ageUp.doc.warnings.join('|') === 'Вік: 12+.|Нове попередження.|Клей — лише дорослим.' && ageUp.changes.warningsRemoved === 2 && ageUp.changes.warningsAdded === 2, ageUp.doc.warnings.join('|'));
const unsafe = ki.syncInstructionWithKit(withManual, makeKit({ safety: safety.blankSafety() }), later);
t('безпека стала неповною — спецрядків немає, ручні лишаються', unsafe.doc.warnings.join('|') === 'Клей — лише дорослим.');
t('вимкнений набір — нічого не змінюється', ki.syncInstructionWithKit(built, makeKit({ enabled: false, parts: [] }), later).doc === built && ki.syncInstructionWithKit(built, null, later).doc === built);
t('усі деталі прибрано — лишається один порожній рядок', (() => {
  const r = ki.syncInstructionWithKit(built, makeKit({ parts: [] }), later).doc;
  return r.materials.length === 1 && !r.materials[0].name && !r.materials[0].specLineId;
})());
t('друга синхронізація після змін — без змін (ідемпотентність)', (() => {
  const k2 = makeKit({ parts: [part({ id: 'p1', name: 'Інша', qty: 3 })] });
  const a = ki.syncInstructionWithKit(withManual, k2, later).doc;
  return !ki.syncInstructionWithKit(a, k2, later).changed;
})());
t('вхідний документ не мутується', JSON.stringify(withManual.materials.map((m) => m.name)) === JSON.stringify(['Бокова панель (береза 6 мм)', 'Шканта', 'Шнур', 'Клей ПВА']));
t('ручна частина (кроки, інструменти) не змінюється', (() => {
  const doc = { ...built, steps: [{ ...built.steps[0], id: 's1', title: 'Склейте борти', description: 'Деталь A до B' }], tools: ['Киянка'] };
  const r = ki.syncInstructionWithKit(doc, makeKit({ parts: [part({ id: 'p1', name: 'X', qty: 1 })] }), later).doc;
  return r.steps === doc.steps && r.tools === doc.tools && r.title === doc.title;
})());

console.log('\nПриведення');
t('не інструкція — undefined', ki.normalizeKitInstruction(null) === undefined && ki.normalizeKitInstruction('x') === undefined && ki.normalizeKitInstruction([]) === undefined);
const n = ki.normalizeKitInstruction({
  docType: 'hack', title: '  Назва  ', description: 'я'.repeat(5000), modelCode: 'K'.repeat(500),
  materials: [{ id: 'd', code: 'A', name: 'x', qty: '1', specLineId: 'p1' }, { id: 'd', name: 'y' }, 'сміття'],
  steps: [{ id: 's', title: 'T', needsVerification: 'так', aiGenerated: true, sourceIds: ['a', 5] }, null],
  tools: 'не масив', warnings: ['a', 'b'],
  warranty: { period: 'p' }, knowledgeBase: [{ title: 'k' }, 7],
  kitSource: { specWarnings: ['w', 3, ''], syncedAt: 'вчора' },
  updatedAt: 'не дата',
}, now)!;
t('тип за замовчуванням «складання», назва обрізана', n.docType === 'assembly' && n.title === 'Назва');
t('довгі тексти обмежено', n.description.length === ki.INSTRUCTION_TEXT_MAX && n.modelCode.length === 60);
t('рядки матеріалів: specLineId лишається, дубль id отримав новий, сміття відкинуто', n.materials.length === 2 && n.materials[0].specLineId === 'p1' && n.materials[1].id !== 'd' && n.materials[1].specLineId === undefined);
t('крок: прапорці лише true, sourceIds — лише рядки', n.steps.length === 1 && n.steps[0].needsVerification === undefined && n.steps[0].aiGenerated === true && n.steps[0].sourceIds?.join() === 'a');
t('списки: не масив → один порожній рядок', n.tools.length === 1 && n.tools[0] === '' && n.warnings.join() === 'a,b');
t('kitSource: лише непорожні рядки, хибна дата → порожньо', n.kitSource?.specWarnings.join() === 'w' && n.kitSource?.syncedAt === '');
t('хибний updatedAt → now', n.updatedAt === now.toISOString());
t('повторне приведення нічого не змінює', JSON.stringify(ki.normalizeKitInstruction(n, now)) === JSON.stringify(n));
t('кількість кроків і рядків обмежена', ki.normalizeKitInstruction({ steps: Array.from({ length: 500 }, () => ({ title: 'x' })), materials: Array.from({ length: 500 }, () => ({ name: 'x' })) })!.steps.length === ki.INSTRUCTION_STEPS_MAX);
const viaKit = kit.normalizeKit({ ...makeKit(), instruction: { ...built, materials: [{ id: 'mat-p1', code: 'A', name: 'Застаріла', qty: '9 шт', specLineId: 'p1' }] } })!;
t('normalizeKit доганяє інструкцію за специфікацією', viaKit.instruction?.materials[0].name === 'Бокова панель (береза 6 мм)' && viaKit.instruction?.materials[0].qty === '2 шт' && viaKit.instruction?.materials.length === 3, viaKit.instruction?.materials.map((m) => m.name + m.qty).join('|'));
t('normalizeKit: сміття замість інструкції — поля немає', kit.normalizeKit({ ...makeKit(), instruction: 'сміття' })!.instruction === undefined && kit.normalizeKit(makeKit())!.instruction === undefined);
t('normalizeKit ідемпотентний з інструкцією', (() => {
  const a = kit.normalizeKit({ ...makeKit(), instruction: built })!;
  return JSON.stringify(kit.normalizeKit(a)) === JSON.stringify(a);
})());

console.log('\nСервер');
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  req.principal = req.headers['x-admin'] ? { id: 'admin', role: 'admin', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
routes.registerFurnitureProductRoutes(app);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = { 'x-admin': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}
const product = { ...fp.blankFurnitureProduct(), id: 'fp-ki', sku: 'KIT-K3', name: 'Конструктор K3', priceUah: 100, kit: { ...makeKit(), instruction: built } };
const saved = await call('POST', '/api/admin/furniture-products', { product });
t('збереження картки з інструкцією — 200, інструкція на місці', saved.status === 200 && saved.data.product.kit.instruction.materials.length === 3);
const edited = JSON.parse(JSON.stringify(saved.data.product));
edited.kit.parts[0].qty = 6;
edited.kit.parts.push({ ...kit.blankKitLine(), id: 'p4', name: 'Кришка', qty: 1 });
const resaved = await call('POST', '/api/admin/furniture-products', { product: edited });
const mats = resaved.data.product.kit.instruction.materials;
t('зміна специфікації при збереженні видна в інструкції (кількість, нова деталь з вільним кодом)', resaved.status === 200 && mats[0].qty === '6 шт' && mats.find((m: any) => m.specLineId === 'p4')?.code === 'D', JSON.stringify(mats));
const list = (await call('GET', '/api/admin/furniture-products')).data.products.find((x: any) => x.id === 'fp-ki');
t('у сховищі лежить синхронізована інструкція', list.kit.instruction.materials.length === 4 && list.kit.instruction.kitSource.specWarnings.length === 2);
const junk = await call('POST', '/api/admin/furniture-products', { product: { ...product, id: 'fp-ki2', sku: 'KIT-K3B', kit: { ...makeKit(), instruction: { materials: 'сміття', steps: 5, docType: 'x' } } } });
t('сміття в інструкції не ламає збереження', junk.status === 200 && junk.data.product.kit.instruction.docType === 'assembly' && junk.data.product.kit.instruction.materials.length === 3);

server.close();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);

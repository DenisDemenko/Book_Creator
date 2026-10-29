/**
 * Тести специфікації й собівартості набору (трек K1). Запуск: npm run test:kit-spec
 *
 *  1. Арифметика: деталі, пакування, робота, націнка, округлення ціни вгору.
 *  2. «Зміна ціни деталі перераховує набір» — підсумки не зберігаються, а рахуються.
 *  3. Приведення стороннього вводу (межі, унікальні id, сміття).
 *  4. Перевірки: помилки й попередження.
 *  5. Сервер: картка з `kit` зберігається нормалізованою, `kit-cost` віддає ті самі цифри.
 */
const DIR = '/tmp/nova-kit-spec-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const kit = await import('../src/components/adminOs/kitSpec');
const fp = await import('../src/components/adminOs/furnitureProduct');
const routes = await import('../server/furnitureProductRoutes');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const line = (over: Partial<import('../src/components/adminOs/kitSpec').KitLine> = {}) => ({ ...kit.blankKitLine(), name: 'Деталь', ...over });
const sample = () => ({
  ...kit.blankKit(),
  enabled: true,
  // Вік і безпека (K2) заповнені, щоб K1-перевірки лишились про специфікацію, а не про безпеку.
  safety: { ageMinYears: 8, smallParts: false, warnings: ['Збирати разом із дорослим.'], noWarningsConfirmed: false, materialsNote: '', documents: [{ id: 'd1', title: 'Декларація відповідності', number: '1', issuedBy: 'Лабораторія', validUntil: '', note: '' }] },
  // Файли виготовлення (K4) привʼязані, щоб K1-перевірки лишились про специфікацію, а не про файли.
  files: [{ id: 'f1', name: 'Різання', kind: 'dxf' as const, versions: [{ id: 'v1', version: 1, fileName: 'cut.dxf', bytes: 10, sha256: 'a'.repeat(64), uploadedAt: '2026-10-29T10:00:00.000Z', note: '' }] }],
  parts: [line({ id: 'p1', name: 'Бокова панель', qty: 2, unitPriceUah: 12.5, material: 'береза 6 мм', fileId: 'f1' }), line({ id: 'p2', name: 'Шканта', qty: 10, unit: 'шт', unitPriceUah: 0.3, fileId: 'f1' })],
  packaging: [line({ id: 'k1', name: 'Коробка', qty: 1, unitPriceUah: 18 })],
  laborMinutes: 30,
  laborRateUahPerHour: 200,
  marginPercent: 30,
  roundToUah: 5,
});

console.log('\nАрифметика');
const c = kit.kitCost(sample());
t('деталі: 2×12,5 + 10×0,3 = 28', c.partsUah === 28, String(c.partsUah));
t('пакування 18', c.packagingUah === 18);
t('робота: 30 хв × 200/год = 100', c.laborUah === 100);
t('собівартість 146', c.totalUah === 146, String(c.totalUah));
t('націнка 30% = 43,80', c.marginUah === 43.8, String(c.marginUah));
t('рекомендована 189,80 → вгору до кроку 5 = 190', c.recommendedPriceUah === 190, String(c.recommendedPriceUah));
t('вартість кожного рядка за id', c.lineTotals.p1 === 25 && c.lineTotals.p2 === 3 && c.lineTotals.k1 === 18);
t('копійки не накопичують похибки (0,1 + 0,2)', (() => {
  const k = { ...sample(), parts: [line({ id: 'a', qty: 1, unitPriceUah: 0.1 }), line({ id: 'b', qty: 1, unitPriceUah: 0.2 })], packaging: [], laborMinutes: 0 };
  return kit.kitCost(k).partsUah === 0.3;
})());
t('точно на межі кроку не стрибає вгору зайвий раз', (() => {
  const k = { ...sample(), parts: [line({ id: 'a', qty: 1, unitPriceUah: 100 })], packaging: [], laborMinutes: 0, marginPercent: 0, roundToUah: 5 };
  return kit.kitCost(k).recommendedPriceUah === 100;
})());
t('крок 1 — округлення до гривні вгору', kit.kitCost({ ...sample(), roundToUah: 1 }).recommendedPriceUah === 190);
t('порожній набір і null — нулі', kit.kitCost(kit.blankKit()).recommendedPriceUah === 0 && kit.kitCost(null).totalUah === 0 && kit.kitCost(undefined).partsUah === 0);
t('дробова кількість: 0,5 м × 40 = 20', kit.kitCost({ ...sample(), parts: [line({ id: 'a', qty: 0.5, unit: 'м', unitPriceUah: 40 })], packaging: [], laborMinutes: 0 }).partsUah === 20);

console.log('\nЗміна ціни деталі перераховує набір');
const s2 = sample();
s2.parts[0].unitPriceUah = 20;
const c2 = kit.kitCost(s2);
t('ціна панелі 12,5 → 20: деталі 43, собівартість 161', c2.partsUah === 43 && c2.totalUah === 161, `${c2.partsUah}/${c2.totalUah}`);
t('рекомендована 161×1,3 = 209,30 → 210', c2.recommendedPriceUah === 210, String(c2.recommendedPriceUah));
t('вхідну специфікацію функції не мутують', kit.kitCost(sample()).totalUah === 146);
const patch = kit.kitPricePatch(sample());
t('kitPricePatch: ціна й базова ціна = рекомендована', patch?.priceUah === 190 && patch?.basePriceUah === 190);
t('вимкнений набір або нульова собівартість — нічого застосовувати', kit.kitPricePatch({ ...sample(), enabled: false }) === null && kit.kitPricePatch({ ...kit.blankKit(), enabled: true }) === null);

console.log('\nПриведення вводу');
t('не специфікація — undefined', kit.normalizeKit(null) === undefined && kit.normalizeKit('x') === undefined && kit.normalizeKit([]) === undefined);
const n = kit.normalizeKit({
  enabled: 'так',
  parts: [{ id: 'dup', name: '  Панель  ', qty: '2,5', unit: '', unitPriceUah: -4 }, { id: 'dup', name: 'Друга', qty: 1e12, unitPriceUah: '7.999' }, 'сміття', null],
  packaging: 'не масив',
  laborMinutes: 'abc',
  marginPercent: 99999,
  roundToUah: 0,
  steamTeam: { id: '  t-1 ', name: 'Команда' },
})!;
t('enabled лише для true', n.enabled === false);
t('назва обрізана, кількість з комою, одиниця за замовчуванням, від’ємна ціна → 0', n.parts[0].name === 'Панель' && n.parts[0].qty === 2.5 && n.parts[0].unit === 'шт' && n.parts[0].unitPriceUah === 0);
t('кількість обмежена, ціна округлена до копійок', n.parts[1].qty === kit.KIT_QTY_MAX && n.parts[1].unitPriceUah === 8);
t('дублікат id отримав новий, сміття відкинуто', n.parts.length === 2 && n.parts[0].id === 'dup' && n.parts[1].id !== 'dup');
t('пакування не масив — порожнє', n.packaging.length === 0);
t('числа в межах: хвилини 0, націнка ≤ 1000, крок ≥ 1', n.laborMinutes === 0 && n.marginPercent === kit.KIT_MARGIN_MAX && n.roundToUah === 1);
t('команда: id обрізаний', n.steamTeam?.id === 't-1' && n.steamTeam?.name === 'Команда');
t('команда без id — null', kit.normalizeKit({ steamTeam: { name: 'x' } })!.steamTeam === null);
t('кількість деталей обмежена', kit.normalizeKit({ parts: Array.from({ length: 500 }, () => ({ name: 'x', qty: 1 })) })!.parts.length === kit.MAX_KIT_PARTS);
t('повторне приведення нічого не змінює', JSON.stringify(kit.normalizeKit(n)) === JSON.stringify(n));

console.log('\nПеревірки');
const ok = kit.kitIssues({ ...sample(), steamTeam: { id: 't', name: 'T' } });
t('повна специфікація без помилок і попереджень', ok.errors.length === 0 && ok.warnings.length === 1 && /матеріал/.test(ok.warnings[0]), JSON.stringify(ok));
t('вимкнений набір не перевіряється', kit.kitIssues({ ...kit.blankKit() }).errors.length === 0);
t('без деталей — помилка', kit.kitIssues({ ...kit.blankKit(), enabled: true }).errors.some((e) => /жодної деталі/.test(e)));
const bad = kit.kitIssues({ ...sample(), parts: [line({ id: 'a', name: '', qty: 0 }), line({ id: 'b', name: 'Шканта', material: 'бук' }), line({ id: 'c', name: 'шканта' })] });
t('деталь без назви й з нульовою кількістю — помилки', bad.errors.length === 2);
t('нульова ціна, повтор назви — попередження', bad.warnings.some((w) => /ціну не вказано/.test(w)) && bad.warnings.some((w) => /повторюється 2 рази/.test(w)));
t('час без ставки й відсутня команда — попередження', (() => {
  const w = kit.kitIssues({ ...sample(), laborRateUahPerHour: 0 }).warnings;
  return w.some((x) => /не ставку/.test(x)) && w.some((x) => /STEAM-команду/.test(x));
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
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(method: string, p: string, body?: unknown, admin = true) {
  const headers: Record<string, string> = {};
  if (admin) headers['x-admin'] = '1';
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}
const product = { ...fp.blankFurnitureProduct(), name: 'Конструктор «Міст»', sku: 'KIT-1', priceUah: 100, kit: { ...sample(), parts: [...sample().parts, { id: 'p1', name: 'Дубль id', qty: 1, unitPriceUah: 1 }], marginPercent: 5000 } };
const saved = await call('POST', '/api/admin/furniture-products', { product });
t('збереження — 200', saved.status === 200);
t('специфікація нормалізована: межа націнки, унікальні id', saved.data.product.kit.marginPercent === kit.KIT_MARGIN_MAX && new Set(saved.data.product.kit.parts.map((p: any) => p.id)).size === 3);
const stored = (await call('GET', '/api/admin/furniture-products')).data.products.find((x: any) => x.id === product.id);
t('у сховищі лежить нормалізована специфікація', stored.kit.parts.length === 3 && stored.kit.enabled === true);
const costRes = await call('GET', `/api/admin/furniture-products/${product.id}/kit-cost`);
const expected = kit.kitCost(stored.kit);
t('kit-cost віддає ті самі цифри, що й модуль', costRes.status === 200 && costRes.data.cost.totalUah === expected.totalUah && costRes.data.cost.recommendedPriceUah === expected.recommendedPriceUah, JSON.stringify(costRes.data.cost));
t('kit-cost віддає перевірки', Array.isArray(costRes.data.issues.errors) && Array.isArray(costRes.data.issues.warnings));
const edited = JSON.parse(JSON.stringify(stored));
edited.kit.parts[0].unitPriceUah = 100;
await call('POST', '/api/admin/furniture-products', { product: edited });
const recalculated = (await call('GET', `/api/admin/furniture-products/${product.id}/kit-cost`)).data.cost;
t('зміна ціни деталі змінила собівартість у збереженому наборі', recalculated.totalUah > costRes.data.cost.totalUah, `${costRes.data.cost.totalUah} → ${recalculated.totalUah}`);
const junk = await call('POST', '/api/admin/furniture-products', { product: { ...product, id: 'fp-junk', kit: 'сміття' } });
t('kit-сміття не потрапляє в картку', junk.status === 200 && junk.data.product.kit === undefined);
const plain = await call('POST', '/api/admin/furniture-products', { product: { ...fp.blankFurnitureProduct(), id: 'fp-plain', sku: 'P-1', name: 'Звичайний' } });
t('звичайний виріб не отримує kit', plain.status === 200 && plain.data.product.kit === undefined);
t('kit-cost звичайного виробу — 404', (await call('GET', '/api/admin/furniture-products/fp-plain/kit-cost')).status === 404);
t('kit-cost невідомого — 404', (await call('GET', '/api/admin/furniture-products/nope/kit-cost')).status === 404);
const off = JSON.parse(JSON.stringify(stored));
off.kit.enabled = false;
await call('POST', '/api/admin/furniture-products', { product: off });
t('вимкнений набір — kit-cost 404', (await call('GET', `/api/admin/furniture-products/${product.id}/kit-cost`)).status === 404);
t('не адмін — 403', (await call('GET', `/api/admin/furniture-products/${product.id}/kit-cost`, undefined, false)).status === 403);

server.close();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);

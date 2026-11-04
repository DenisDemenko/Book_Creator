/**
 * Тести «Вік і безпека» набору (трек K2). Запуск: npm run test:kit-safety
 *
 *  1. Приведення вводу: вік, дрібні деталі, попередження, документи, дати.
 *  2. Перевірки: що блокує публікацію, а що лише підказує.
 *  3. Похідні: матеріали зі специфікації, вітрина, рядки для інструкції.
 *  4. Публікація: клієнтський і серверний бар'єр, `attributes.safety` мосту без документів.
 */
const DIR = '/tmp/nova-kit-safety-test';
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
const fp = await import('../src/components/adminOs/furnitureProduct');
const routes = await import('../server/furnitureProductRoutes');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const part = (over: Partial<import('../src/components/adminOs/kitSpec').KitLine> = {}) => ({ ...kit.blankKitLine(), name: 'Деталь', unitPriceUah: 1, material: 'береза 6 мм', ...over });
const full = (over: Partial<import('../src/components/adminOs/kitSafety').KitSafety> = {}) => ({
  ...safety.blankSafety(),
  ageMinYears: 8,
  smallParts: false,
  warnings: ['Збирати разом із дорослим.'],
  documents: [{ id: 'd1', title: 'Декларація', number: '1', issuedBy: 'Лаб', validUntil: '', note: '' }],
  ...over,
});
const makeKit = (s: Partial<import('../src/components/adminOs/kitSafety').KitSafety> = {}) => ({
  ...kit.blankKit(),
  enabled: true,
  steamTeam: { id: 't', name: 'T' },
  laborMinutes: 10,
  laborRateUahPerHour: 100,
  parts: [part({ id: 'a', name: 'Панель' }), part({ id: 'b', name: 'Шканта', material: 'Бук' })],
  safety: full(s),
});

console.log('\nПриведення');
t('порожній набір — безпека не заповнена', kit.blankKit().safety.ageMinYears === null && kit.blankKit().safety.smallParts === null);
t('не обʼєкт — порожня безпека', safety.normalizeSafety(null).ageMinYears === null && safety.normalizeSafety('x').smallParts === null && safety.normalizeSafety([]).documents.length === 0);
const n = safety.normalizeSafety({
  ageMinYears: '7,9',
  smallParts: 'так',
  warnings: ['  Гаряче  ', 'гаряче', '', 5, safety.SMALL_PARTS_WARNING, 'Інше'],
  noWarningsConfirmed: true,
  materialsNote: '  лак   на воді ',
  documents: [{ id: 'x', title: ' Декларація ', validUntil: '2027-02-30' }, { id: 'x', title: 'Протокол', validUntil: '2027-05-01' }, 'сміття'],
});
t('вік: ціле вниз (7,9 → 7)', n.ageMinYears === 7, String(n.ageMinYears));
t('вік у межах 0…18', safety.normalizeSafety({ ageMinYears: 99 }).ageMinYears === 18 && safety.normalizeSafety({ ageMinYears: -4 }).ageMinYears === 0);
t('вік-сміття й порожнє → null', safety.normalizeSafety({ ageMinYears: 'abc' }).ageMinYears === null && safety.normalizeSafety({ ageMinYears: '' }).ageMinYears === null);
t('smallParts лише true/false, інше → null', n.smallParts === null && safety.normalizeSafety({ smallParts: true }).smallParts === true && safety.normalizeSafety({ smallParts: false }).smallParts === false);
t('попередження: обрізані, без дублів, без порожніх і без автоматичного', n.warnings.length === 2 && n.warnings[0] === 'Гаряче' && n.warnings[1] === 'Інше', JSON.stringify(n.warnings));
t('«попереджень немає» знімається, коли вони є', n.noWarningsConfirmed === false);
t('«попереджень немає» лишається, коли їх справді немає', safety.normalizeSafety({ noWarningsConfirmed: true, smallParts: false }).noWarningsConfirmed === true);
t('…але не з дрібними деталями', safety.normalizeSafety({ noWarningsConfirmed: true, smallParts: true }).noWarningsConfirmed === false);
t('примітка про матеріали стиснута', n.materialsNote === 'лак на воді');
t('документи: хибна дата → порожньо, дубль id отримав новий, сміття відкинуто', n.documents.length === 2 && n.documents[0].validUntil === '' && n.documents[0].title === 'Декларація' && n.documents[1].id !== 'x' && n.documents[1].validUntil === '2027-05-01');
t('кількість попереджень і документів обмежена', safety.normalizeSafety({ warnings: Array.from({ length: 50 }, (_, i) => `w${i}`), documents: Array.from({ length: 50 }, () => ({})) }).warnings.length === safety.MAX_SAFETY_WARNINGS && safety.normalizeSafety({ documents: Array.from({ length: 50 }, () => ({})) }).documents.length === safety.MAX_SAFETY_DOCS);
t('повторне приведення нічого не змінює', JSON.stringify(safety.normalizeSafety(n)) === JSON.stringify(n));
t('normalizeKit несе безпеку; старий набір без поля — порожня безпека', kit.normalizeKit({ enabled: true, safety: { ageMinYears: 5 } })!.safety.ageMinYears === 5 && kit.normalizeKit({ enabled: true })!.safety.ageMinYears === null);

console.log('\nПеревірки');
const now = new Date('2026-10-29T10:00:00Z');
const okIssues = safety.safetyIssues(makeKit(), now);
t('повний набір — без помилок і застережень', okIssues.errors.length === 0 && okIssues.warnings.length === 0, JSON.stringify(okIssues));
t('вимкнений набір не перевіряється', safety.safetyIssues({ ...makeKit(), enabled: false }, now).errors.length === 0 && safety.safetyIssues(null, now).errors.length === 0);
const empty = safety.safetyIssues({ ...makeKit(), safety: safety.blankSafety() }, now);
t('без віку, без відповіді про дрібні деталі й без попереджень — три помилки', empty.errors.length === 3 && empty.errors.some((e) => /Вікова група/.test(e)) && empty.errors.some((e) => /дрібні деталі/.test(e)) && empty.errors.some((e) => /попередження/.test(e)), JSON.stringify(empty.errors));
t('вік 0 — це відповідь, а не порожнє', !safety.safetyIssues(makeKit({ ageMinYears: 0 }), now).errors.some((e) => /Вікова група/.test(e)));
t('дрібні деталі й вік 2 — помилка', safety.safetyIssues(makeKit({ smallParts: true, ageMinYears: 2 }), now).errors.some((e) => /до 3 років/.test(e)));
t('дрібні деталі й вік 3 — ок (автоматичне попередження рахується)', safety.safetyIssues(makeKit({ smallParts: true, ageMinYears: 3, warnings: [] }), now).errors.length === 0);
t('без попереджень потрібне явне підтвердження', safety.safetyIssues(makeKit({ warnings: [] }), now).errors.some((e) => /попередження/.test(e)) && safety.safetyIssues(makeKit({ warnings: [], noWarningsConfirmed: true }), now).errors.length === 0);
const noMat = safety.safetyIssues({ ...makeKit(), parts: [part({ material: '' })] }, now);
t('жодного матеріалу — помилка', noMat.errors.some((e) => /матеріал/.test(e)));
const someMat = safety.safetyIssues({ ...makeKit(), parts: [part({ id: 'a' }), part({ id: 'b', name: 'Друга', material: '' })] }, now);
t('частина деталей без матеріалу — не помилка безпеки (per-деталь попереджає kitIssues)', someMat.errors.length === 0 && kit.kitIssues({ ...makeKit(), parts: [part({ id: 'a' }), part({ id: 'b', name: 'Друга', material: '' })] }).warnings.filter((w) => /матеріал/.test(w)).length === 1);
t('немає документів — застереження, не помилка', safety.safetyIssues(makeKit({ documents: [] }), now).errors.length === 0 && safety.safetyIssues(makeKit({ documents: [] }), now).warnings.some((w) => /Документів відповідності/.test(w)));
const expired = safety.safetyIssues(makeKit({ documents: [{ id: 'd', title: 'Протокол', number: '', issuedBy: '', validUntil: '2026-10-01', note: '' }, { id: 'e', title: 'Декларація', number: '', issuedBy: '', validUntil: '2026-10-29', note: '' }] }), now);
t('прострочений документ — застереження; діє до сьогодні включно — ні', expired.warnings.length === 1 && /прострочений/.test(expired.warnings[0]), JSON.stringify(expired.warnings));
t('kitIssues включає безпеку', kit.kitIssues({ ...makeKit(), safety: safety.blankSafety() }).errors.some((e) => /Вікова група/.test(e)) && kit.kitIssues(makeKit()).errors.length === 0);

console.log('\nПохідні');
t('матеріали: унікальні без регістру в порядку появи', JSON.stringify(safety.kitMaterials({ parts: [part({ material: 'Бук' }), part({ material: ' береза ' }), part({ material: 'бук' }), part({ material: '' })] })) === JSON.stringify(['Бук', 'береза']));
t('попередження: автоматичне про дрібні деталі — першим', safety.effectiveWarnings(full({ smallParts: true, ageMinYears: 5, warnings: ['Своє'] }))[0] === safety.SMALL_PARTS_WARNING && safety.effectiveWarnings(full({ smallParts: true, ageMinYears: 5, warnings: ['Своє'] })).length === 2);
const pub = safety.kitSafetyPublic(makeKit({ smallParts: true, ageMinYears: 6 }));
t('вітрина: вік 6+, попередження, матеріали', pub?.ageLabel === '6+' && pub.smallParts === true && pub.warnings[0] === safety.SMALL_PARTS_WARNING && pub.materials.join() === 'береза 6 мм,Бук');
t('вітрина: документів немає серед полів', pub !== undefined && !('documents' in pub));
t('вітрина: неповна безпека або вимкнений набір — undefined', safety.kitSafetyPublic({ ...makeKit(), safety: safety.blankSafety() }) === undefined && safety.kitSafetyPublic({ ...makeKit(), enabled: false }) === undefined && safety.kitSafetyPublic(null) === undefined);
const lines = safety.kitSafetyLines(makeKit({ materialsNote: 'Лак на водній основі', ageMinYears: 8 }));
t('рядки для інструкції: вік, попередження, матеріали з приміткою', lines[0] === 'Вік: 8+.' && lines[1] === 'Збирати разом із дорослим.' && lines[2] === 'Матеріали: береза 6 мм, Бук. Лак на водній основі', JSON.stringify(lines));
t('рядки для неповної безпеки — порожньо', safety.kitSafetyLines({ ...makeKit(), safety: safety.blankSafety() }).length === 0);

console.log('\nПублікація');
const base = fp.blankFurnitureProduct();
const withMedia = { ...base, name: 'Конструктор', sku: 'KS-1', priceUah: 100, media: [{ id: 'm1', kind: 'image', url: '/x.jpg', alt: '', order: 0 } as any] };
const clientOk = fp.furniturePublishIssues({ ...withMedia, kit: makeKit() } as any);
t('клієнт: повний набір не має зауважень до безпеки', !clientOk.some((m) => /^Набір:/.test(m)), JSON.stringify(clientOk));
const clientBad = fp.furniturePublishIssues({ ...withMedia, kit: { ...makeKit(), safety: safety.blankSafety() } } as any);
t('клієнт: без віку й попереджень — публікація заблокована з причиною', clientBad.filter((m) => /^Набір:/.test(m)).length === 3, JSON.stringify(clientBad));
t('клієнт: вимкнений набір публікації не заважає', !fp.furniturePublishIssues({ ...withMedia, kit: { ...makeKit(), enabled: false, safety: safety.blankSafety() } } as any).some((m) => /^Набір:/.test(m)));
t('клієнт: звичайний виріб — як раніше', !fp.furniturePublishIssues(withMedia as any).some((m) => /^Набір:/.test(m)));
const attrs = routes.toBridgeAttributes({ ...withMedia, kit: makeKit({ smallParts: true, ageMinYears: 4 }) } as any);
t('міст: attributes.safety є, без документів', attrs.safety?.ageLabel === '4+' && attrs.safety.smallParts === true && !JSON.stringify(attrs).includes('Декларація'));
t('міст: звичайний виріб без safety', routes.toBridgeAttributes(withMedia as any).safety === undefined);

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
const saved = await call('POST', '/api/admin/furniture-products', { product: { ...withMedia, id: 'fp-ks', kit: { ...makeKit(), safety: { ageMinYears: 150, smallParts: 'так', warnings: ['  Гаряче '], documents: [{ title: 'Д', validUntil: 'вчора' }] } } } });
const stored = saved.data.product.kit.safety;
t('сервер: безпека нормалізована при збереженні', saved.status === 200 && stored.ageMinYears === 18 && stored.smallParts === null && stored.warnings[0] === 'Гаряче' && stored.documents[0].validUntil === '' && stored.documents[0].id, JSON.stringify(stored));
const blocked = await call('POST', '/api/admin/furniture-products/fp-ks/publish');
t('сервер: публікація набору без відповіді про дрібні деталі — 400 з причиною', blocked.status === 400 && /Набір: Позначте, чи є в наборі дрібні деталі/.test(blocked.data.error), JSON.stringify(blocked.data));
const noAge = await call('POST', '/api/admin/furniture-products', { product: { ...withMedia, id: 'fp-ks2', kit: { ...makeKit(), safety: safety.blankSafety() } } });
const blocked2 = await call('POST', '/api/admin/furniture-products/fp-ks2/publish');
t('сервер: без віку — 400', noAge.status === 200 && blocked2.status === 400 && /Вікова група/.test(blocked2.data.error), JSON.stringify(blocked2.data));
const cost = await call('GET', '/api/admin/furniture-products/fp-ks/kit-cost');
t('kit-cost віддає safety (null, поки неповна) і safetyLines', cost.status === 200 && cost.data.safety === null && Array.isArray(cost.data.safetyLines) && cost.data.issues.errors.length >= 1);
await call('POST', '/api/admin/furniture-products', { product: { ...withMedia, id: 'fp-ks3', sku: 'KS-3', kit: makeKit({ ageMinYears: 10 }) } });
const cost3 = await call('GET', '/api/admin/furniture-products/fp-ks3/kit-cost');
t('kit-cost повного набору: safety і рядки для інструкції', cost3.data.safety?.ageLabel === '10+' && cost3.data.safetyLines[0] === 'Вік: 10+.' && cost3.data.issues.errors.length === 0, JSON.stringify(cost3.data.issues));

server.close();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);

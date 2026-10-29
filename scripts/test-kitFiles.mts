/**
 * Тести «Файли для виготовлення» набору (трек K4). Запуск: npm run test:kit-files
 *
 *  1. Правила й метадані: типи, імена, версії, ліміти, нормалізація, привʼязка деталей.
 *  2. Сховище: безпечні шляхи, атомарний запис, прибирання.
 *  3. HTTP через справжні маршрути: завантаження, версії, завантаження назад, перейменування,
 *     видалення, збереження картки не підробляє список, видалення виробу чистить диск.
 *  4. Ліміти розміру, права, приватність (міст не бачить файлів).
 */
const DIR = '/tmp/nova-kit-files-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;
process.env.KIT_FILES_DIR = `${DIR}/kit-files`;

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const kf = await import('../src/components/adminOs/kitFiles');
const kit = await import('../src/components/adminOs/kitSpec');
const fp = await import('../src/components/adminOs/furnitureProduct');
const routes = await import('../server/furnitureProductRoutes');
const store = await import('../server/kitFiles');
const kitRoutes = await import('../server/kitFileRoutes');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const now = new Date('2026-10-29T10:00:00Z');
const errOf = (r: { ok: boolean }): string => ((r as any).ok ? '' : (r as any).error);
const up = (over: Partial<import('../src/components/adminOs/kitFiles').KitFileUpload> = {}) => ({ fileName: 'side.dxf', bytes: 100, sha256: sha('a'), fileId: 'f1', versionId: 'v1', now, ...over });

console.log('\nТипи й імена');
t('dxf/stl/pdf дозволені', kf.kitFileKind('a.DXF') === 'dxf' && kf.kitFileKind('x.stl') === 'stl' && kf.kitFileKind('x.pdf') === 'drawing' && kf.kitFileKind('x.step') === 'model3d');
t('exe, html, js, без розширення — ні', ['a.exe', 'a.html', 'a.js', 'noext', '.dxf', 'a.dxf.exe'].every((n) => kf.kitFileKind(n) === null));
t('імʼя без шляху й керівних символів', kf.sanitizeKitFileName('C:\\x\\..\\y/cut\u0000.dxf') === 'cut.dxf' && kf.sanitizeKitFileName('') === 'file' && kf.sanitizeKitFileName('../../etc/passwd') === 'passwd');
t('довге імʼя обрізається, розширення лишається', (() => { const n = kf.sanitizeKitFileName('а'.repeat(300) + '.dxf'); return [...n].length <= 120 && n.endsWith('.dxf'); })());
t('розмір читабельний', kf.formatBytes(500) === '500 Б' && kf.formatBytes(2048) === '2,0 КБ' && kf.formatBytes(3 * 1024 * 1024) === '3,0 МБ');

console.log('\nДодавання й версії');
const a = kf.addKitFile([], up({ name: 'Бокова панель — різання' }));
t('новий файл: версія 1, вид за розширенням', a.ok && a.file.versions.length === 1 && a.file.versions[0].version === 1 && a.file.kind === 'dxf' && a.file.name === 'Бокова панель — різання');
t('без назви — імʼя файлу без розширення', (() => { const r = kf.addKitFile([], up()); return r.ok && r.file.name === 'side'; })());
const files1 = a.ok ? a.files : [];
const b = kf.addKitFileVersion(files1, up({ versionId: 'v2', sha256: sha('b'), note: 'виправлено паз' }));
t('нова версія: 2, стара лишається, чинна — остання', b.ok && b.file.versions.length === 2 && b.version.version === 2 && kf.latestVersion(b.file).id === 'v2' && b.file.versions[0].id === 'v1');
t('вхідний список не мутується', files1[0].versions.length === 1);
const same = kf.addKitFileVersion(b.ok ? b.files : [], up({ versionId: 'v3', sha256: sha('b') }));
t('той самий вміст, що й чинна версія — відмова', errOf(same) === 'same_version');
t('повернення до старого вмісту — дозволено (це нова чинна версія)', (() => { const r = kf.addKitFileVersion(b.ok ? b.files : [], up({ versionId: 'v3', sha256: sha('a') })); return r.ok && r.version.version === 3; })());
t('версія неіснуючого файлу', (() => { const r = kf.addKitFileVersion(files1, up({ fileId: 'zzz' })); return errOf(r) === 'not_found'; })());
t('порожній, завеликий, чужий тип', (() => {
  const e = (o: any) => errOf(kf.addKitFile([], up(o)));
  return e({ bytes: 0 }) === 'empty' && e({ bytes: kf.MAX_KIT_FILE_BYTES + 1 }) === 'too_large' && e({ fileName: 'x.exe' }) === 'bad_type';
})());
t('сумарний ліміт', (() => {
  const big = kf.addKitFile([], up({ bytes: kf.MAX_KIT_FILE_BYTES }));
  let list = big.ok ? big.files : [];
  for (let i = 0; i < 9; i++) { const r = kf.addKitFile(list, up({ fileId: 'g' + i, versionId: 'w' + i, bytes: kf.MAX_KIT_FILE_BYTES })); if (r.ok) list = r.files; }
  const over = kf.addKitFile(list, up({ fileId: 'zz', versionId: 'zv', bytes: kf.MAX_KIT_FILE_BYTES }));
  return list.length === 10 && errOf(over) === 'total_too_large';
})());
t('ліміт кількості файлів', (() => {
  const list: any[] = [];
  for (let i = 0; i < kf.MAX_KIT_FILES; i++) list.push({ id: 'f' + i, name: 'n', kind: 'dxf', versions: [{ id: 'v', version: 1, fileName: 'a.dxf', bytes: 1, sha256: '', uploadedAt: '', note: '' }] });
  const r = kf.addKitFile(list, up({ fileId: 'new', bytes: 1 }));
  return errOf(r) === 'too_many_files';
})());
t('ліміт версій', (() => {
  let list = a.ok ? a.files : [];
  let last: any;
  for (let i = 0; i < kf.MAX_KIT_FILE_VERSIONS + 2; i++) { last = kf.addKitFileVersion(list, up({ versionId: 'x' + i, sha256: sha('v' + i), bytes: 1 })); if (last.ok) list = last.files; }
  return list[0].versions.length === kf.MAX_KIT_FILE_VERSIONS && errOf(last) === 'too_many_versions';
})());
t('перейменування: пусте — відмова, інакше нова назва', kf.renameKitFile(files1, 'f1', '   ') === null && kf.renameKitFile(files1, 'f1', ' Нова ')![0].name === 'Нова' && kf.renameKitFile(files1, 'nope', 'x') === null);

console.log('\nНормалізація');
const messy = kf.normalizeKitFiles([
  { id: '../evil', versions: [{ id: 'v', version: 1, fileName: 'a.dxf', bytes: 1 }] },
  { id: 'ok1', name: '  Назва ', kind: 'bogus', versions: [{ id: 'v2', version: 2, fileName: '../../x.stl', bytes: 5, sha256: 'zz', uploadedAt: 'вчора' }, { id: 'v1', version: 1, fileName: 'x.stl', bytes: 1e12 }, { id: 'bad id', version: 3, fileName: 'a.stl' }, null] },
  { id: 'ok1', versions: [{ id: 'v', version: 1, fileName: 'a.dxf' }] },
  { id: 'empty', versions: [] },
  'рядок',
]);
t('небезпечні id, дублі й порожні файли відкинуті', messy.length === 1 && messy[0].id === 'ok1');
t('версії відсортовані, зайве прибране', messy[0].versions.map((v) => v.id).join() === 'v1,v2' && messy[0].versions[1].fileName === 'x.stl');
t('невалідний sha/дата/розмір → безпечні значення', messy[0].versions[1].sha256 === '' && messy[0].versions[1].uploadedAt === '' && messy[0].versions[0].bytes === kf.MAX_KIT_FILE_BYTES);
t('невідомий вид — за розширенням', messy[0].kind === 'stl' && messy[0].name === 'Назва');
t('нормалізація ідемпотентна', JSON.stringify(kf.normalizeKitFiles(messy)) === JSON.stringify(messy));
t('не масив → порожньо', kf.normalizeKitFiles(null).length === 0 && kf.normalizeKitFiles({}).length === 0);

console.log('\nПривʼязка деталей і перевірки');
const part = (over: Partial<import('../src/components/adminOs/kitSpec').KitLine> = {}) => ({ ...kit.blankKitLine(), name: 'Деталь', unitPriceUah: 1, material: 'береза', ...over });
const k0 = { ...kit.blankKit(), enabled: true, parts: [part({ id: 'p1', name: 'Бок' }), part({ id: 'p2', name: 'Дно' })] };
t('набір без файлів — одне підсумкове застереження', kf.kitFileIssues(k0).length === 1 && /Файлів для виготовлення ще немає/.test(kf.kitFileIssues(k0)[0]));
const k1 = { ...k0, files: files1, parts: [{ ...k0.parts[0], fileId: 'f1' }, k0.parts[1]] };
t('деталь без файлу — застереження за назвою', kf.kitFileIssues(k1).length === 1 && /«Дно»: не вказано файл/.test(kf.kitFileIssues(k1)[0]));
t('файл без деталей — застереження', kf.kitFileIssues({ ...k1, parts: k0.parts }).some((m) => /не привʼязано до жодної деталі/.test(m)));
t('усе привʼязано — тиша', kf.kitFileIssues({ ...k1, parts: k1.parts.map((p) => ({ ...p, fileId: 'f1' })) }).length === 0);
t('вимкнений набір і набір без деталей — тиша', kf.kitFileIssues({ ...k0, enabled: false }).length === 0 && kf.kitFileIssues({ ...kit.blankKit(), enabled: true }).length === 0 && kf.kitFileIssues(undefined).length === 0);
t('partsUsingFile', kf.partsUsingFile(k1, 'f1').length === 1 && kf.partsUsingFile(k1, 'zz').length === 0);
const nk = kit.normalizeKit({ ...k1, parts: [{ ...k1.parts[0], fileId: 'ghost' }, { ...k1.parts[1], fileId: 'f1' }], packaging: [part({ id: 'k1', name: 'Коробка', fileId: 'f1' })] })!;
t('normalizeKit: посилання на невідомий файл скинуто, на відомий — лишилось', nk.parts[0].fileId === '' && nk.parts[1].fileId === 'f1');
t('normalizeKit: пакування файлів не має', nk.packaging[0].fileId === '');
t('kitIssues несе застереження K4 і лише як warnings', (() => { const r = kit.kitIssues({ ...k0, steamTeam: { id: 't', name: 'T' } } as any); return r.warnings.some((w) => /Файлів для виготовлення/.test(w)) && !r.errors.some((e) => /файл/i.test(e)); })());

console.log('\nСховище');
const root = path.join(DIR, 'unit-store');
const st = store.createKitFileStore(root);
await st.write('prod1', 'f1', 'v1', Buffer.from('hello'));
t('запис і пошук', fs.readFileSync((await st.locate('prod1', 'f1', 'v1'))!, 'utf8') === 'hello');
t('немає файлу — null', (await st.locate('prod1', 'f1', 'nope')) === null);
t('тимчасових файлів не лишається', fs.readdirSync(path.join(root, 'prod1')).every((n) => !n.endsWith('.tmp')));
t('небезпечний id файлу — помилка', await st.write('prod1', '../x', 'v', Buffer.from('x')).then(() => false, () => true));
await st.write('../../weird id', 'f1', 'v1', Buffer.from('x'));
t('небезпечний id виробу не виходить за корінь', fs.readdirSync(root).every((n) => n === 'prod1' || n.startsWith('h_')) && !fs.existsSync(path.join(DIR, 'weird id')));
await st.write('prod1', 'f1', 'v2', Buffer.from('2'));
await st.write('prod1', 'f2', 'v1', Buffer.from('3'));
await st.removeFile('prod1', 'f1');
t('removeFile прибирає всі версії файлу, чужі лишає', (await st.locate('prod1', 'f1', 'v1')) === null && (await st.locate('prod1', 'f1', 'v2')) === null && (await st.locate('prod1', 'f2', 'v1')) !== null);
await st.removeProduct('prod1');
t('removeProduct прибирає теку', !fs.existsSync(path.join(root, 'prod1')));

console.log('\nHTTP: справжні маршрути');
const app = express();
app.use(express.json({ limit: '40mb' }));
app.use((req: any, _res, next) => {
  req.principal = req.headers['x-admin'] ? { id: 'admin', role: 'admin', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
routes.registerFurnitureProductRoutes(app);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${(server.address() as any).port}`;
async function json(method: string, p: string, body?: unknown, admin = true) {
  const headers: Record<string, string> = admin ? { 'x-admin': '1' } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}
async function send(p: string, bytes: Buffer | string, name: string, admin = true, ctype = 'application/octet-stream') {
  const headers: Record<string, string> = { 'content-type': ctype, 'x-file-name': encodeURIComponent(name) };
  if (admin) headers['x-admin'] = '1';
  const res = await fetch(url + p, { method: 'POST', headers, body: bytes });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}
async function get(p: string, admin = true) {
  const res = await fetch(url + p, { headers: admin ? { 'x-admin': '1' } : {} });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
}

const base = fp.blankFurnitureProduct();
const PID = 'fp-files';
const R = `/api/admin/furniture-products/${PID}/kit-files`;
const mk = () => ({ ...kit.blankKit(), enabled: true, parts: [part({ id: 'p1', name: 'Бокова панель' }), part({ id: 'p2', name: 'Дно' })] });

const early = await send(R, Buffer.from('x'), 'a.dxf');
t('до збереження картки — 404 з підказкою', early.status === 404 && /збережіть картку/.test(early.data.error), JSON.stringify(early.data));
await json('POST', '/api/admin/furniture-products', { product: { ...base, id: PID, name: 'Н', sku: 'KF-1' } });
const nokit = await send(R, Buffer.from('x'), 'a.dxf');
t('виріб без набору — 400', nokit.status === 400 && /специфікації набору/.test(nokit.data.error));
await json('POST', '/api/admin/furniture-products', { product: { ...base, id: PID, name: 'Н', sku: 'KF-1', kit: mk() } });

t('гість не завантажує', [401, 403].includes((await send(R, Buffer.from('x'), 'a.dxf', false)).status));
t('гість не качає', [401, 403].includes((await get(`${R}/x/download`, false)).status));

const dxf1 = Buffer.from('0\nSECTION\n1');
const r1 = await send(`${R}?name=${encodeURIComponent('Бокова панель — різання')}`, dxf1, 'бокова панель.dxf');
t('завантаження: 200, файл і версія 1', r1.status === 200 && r1.data.file.versions.length === 1 && r1.data.file.name === 'Бокова панель — різання' && r1.data.version.sha256 === sha(dxf1) && r1.data.version.fileName === 'бокова панель.dxf', JSON.stringify(r1.data));
const F = r1.data.file.id as string;
const onDisk = path.join(DIR, 'kit-files', PID, `${F}.${r1.data.version.id}.bin`);
t('байти на диску, а не в базі', fs.existsSync(onDisk) && fs.readFileSync(onDisk).equals(dxf1));
const list1 = await json('GET', '/api/admin/furniture-products');
const prod1 = list1.data.products.find((p: any) => p.id === PID);
t('опис файлу є в картці, байтів у картці немає', prod1.kit.files.length === 1 && !JSON.stringify(prod1).includes('SECTION'));

const dl = await get(`${R}/${F}/download`);
t('завантаження назад: ті самі байти, вкладення, no-store, nosniff', dl.status === 200 && dl.buf.equals(dxf1) && /attachment/.test(dl.headers.get('content-disposition') || '') && /no-store/.test(dl.headers.get('cache-control') || '') && dl.headers.get('x-content-type-options') === 'nosniff' && dl.headers.get('content-type') === 'application/octet-stream');
t('імʼя файлу в заголовку закодоване (кирилиця)', /filename\*=UTF-8''%D0%B1/.test(dl.headers.get('content-disposition') || ''), dl.headers.get('content-disposition') || '');

const dxf2 = Buffer.from('0\nSECTION\n2 новий паз');
const r2 = await send(`${R}?fileId=${F}&note=${encodeURIComponent('паз ширший')}`, dxf2, 'side-v2.dxf');
t('нова версія: 2, чинна — нова', r2.status === 200 && r2.data.file.versions.length === 2 && r2.data.version.version === 2 && r2.data.version.note === 'паз ширший');
const dl2 = await get(`${R}/${F}/download`);
const old = await get(`${R}/${F}/versions/${r1.data.version.id}`);
t('download — чинна, versions/:id — стара збереглась', dl2.buf.equals(dxf2) && old.status === 200 && old.buf.equals(dxf1));
const dup = await send(`${R}?fileId=${F}`, dxf2, 'copy.dxf');
t('той самий вміст — 409 same_version', dup.status === 409 && dup.data.code === 'same_version');
t('версія неіснуючого файлу — 404', (await send(`${R}?fileId=nope`, dxf2, 'a.dxf')).status === 404);
t('небезпечний fileId у query — 404', (await send(`${R}?fileId=${encodeURIComponent('../../x')}`, dxf2, 'a.dxf')).status === 404);
t('небезпечний тип — 415', (await send(R, Buffer.from('MZ'), 'virus.exe')).status === 415);
t('порожнє тіло — 400', (await send(R, Buffer.alloc(0), 'a.dxf')).status === 400);
t('без імені — 400', (await send(R, Buffer.from('x'), '')).status === 400);
t('JSON замість байтів — 400/415, не падіння', [400, 415].includes((await send(R, JSON.stringify({ a: 1 }), 'a.dxf', true, 'application/json')).status));
t('чужа версія чи файл — 404', (await get(`${R}/${F}/versions/nope`)).status === 404 && (await get(`${R}/zzz/download`)).status === 404);

// Збереження картки: клієнт не може підробити список файлів і привʼязати деталь до неіснуючого файлу.
const forged = { ...mk(), files: [{ id: 'fake', name: 'Підробка', kind: 'dxf', versions: [{ id: 'v', version: 1, fileName: 'x.dxf', bytes: 1, sha256: '' }] }], parts: [{ ...mk().parts[0], id: 'p1', fileId: F }, { ...mk().parts[1], id: 'p2', fileId: 'fake' }] };
const sv = await json('POST', '/api/admin/furniture-products', { product: { ...base, id: PID, name: 'Н', sku: 'KF-1', kit: forged } });
t('збереження: список файлів — зі сховища, а не з тіла', sv.data.product.kit.files.length === 1 && sv.data.product.kit.files[0].id === F && sv.data.product.kit.files[0].versions.length === 2);
t('збереження: привʼязка до справжнього файлу лишилась, до підробки — скинута', sv.data.product.kit.parts[0].fileId === F && sv.data.product.kit.parts[1].fileId === '');
t('оновлення картки не стирає завантажених файлів', (await get(`${R}/${F}/download`)).buf.equals(dxf2));

const rn = await json('PATCH', `${R}/${F}`, { name: '  Бокова — v2  ' });
t('перейменування', rn.status === 200 && rn.data.files[0].name === 'Бокова — v2');
t('порожня назва — відмова, стара лишається', (await json('PATCH', `${R}/${F}`, { name: '  ' })).status === 404 && (await json('GET', '/api/admin/furniture-products')).data.products.find((p: any) => p.id === PID).kit.files[0].name === 'Бокова — v2');

const attrs = routes.toBridgeAttributes({ ...base, kit: sv.data.product.kit } as any);
t('міст не отримує файлів', !JSON.stringify(attrs).includes('dxf') && !('files' in attrs));
const costRes = await json('GET', `/api/admin/furniture-products/${PID}/kit-cost`);
t('kit-cost показує застереження про деталі без файлу (лише warnings)', costRes.status === 200 && costRes.data.issues.warnings.some((w: string) => /«Дно»: не вказано файл/.test(w)) && !costRes.data.issues.errors.some((e: string) => /файл/i.test(e)));

const parallel = await Promise.all([1, 2, 3, 4, 5].map((i) => send(R, Buffer.from('parallel-' + i), `p${i}.stl`)));
const afterPar = (await json('GET', '/api/admin/furniture-products')).data.products.find((p: any) => p.id === PID);
t('5 паралельних завантажень — усі 5 у картці', parallel.every((r) => r.status === 200) && afterPar.kit.files.length === 6, String(afterPar.kit.files.length));
t('кожен має байти на диску', afterPar.kit.files.every((f: any) => fs.existsSync(path.join(DIR, 'kit-files', PID, `${f.id}.${f.versions[f.versions.length - 1].id}.bin`))));

const withLink = { ...afterPar.kit, parts: afterPar.kit.parts.map((p: any, i: number) => (i === 0 ? { ...p, fileId: F } : p)) };
await json('POST', '/api/admin/furniture-products', { product: { ...afterPar, kit: withLink } });
const del = await json('DELETE', `${R}/${F}`);
t('видалення: файл зник, привʼязку деталі скинуто', del.status === 200 && !del.data.kit.files.some((f: any) => f.id === F) && del.data.kit.parts.every((p: any) => p.fileId !== F));
t('байти всіх версій видалено з диска', fs.readdirSync(path.join(DIR, 'kit-files', PID)).every((n) => !n.startsWith(F + '.')));
t('після видалення скачати не можна', (await get(`${R}/${F}/download`)).status === 404);
t('повторне видалення — 404', (await json('DELETE', `${R}/${F}`)).status === 404);

await json('DELETE', `/api/admin/furniture-products/${PID}`);
t('видалення виробу прибирає теку файлів', !fs.existsSync(path.join(DIR, 'kit-files', PID)));
server.close();

console.log('\nЛіміти розміру (окремий застосунок з малою межею)');
let drafts: any[] = [{ ...base, id: 'small', kit: mk() }];
const smallStore = store.createKitFileStore(path.join(DIR, 'small-store'));
const noAuth = (_q: any, _s: any, n: any) => n();
const app2 = express();
kitRoutes.registerKitFileRoutes(app2, { auth: noAuth, readDrafts: async () => drafts, writeDrafts: async (l) => { drafts = l; }, store: smallStore, maxBytes: 1000 });
const server2 = app2.listen(0);
await new Promise((r) => server2.once('listening', r));
const url2 = `http://127.0.0.1:${(server2.address() as any).port}`;
const post2 = (body: Buffer) => fetch(`${url2}/api/admin/furniture-products/small/kit-files`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'a.stl' }, body });
const okSmall = await post2(Buffer.alloc(900, 1));
t('у межі — приймається', okSmall.status === 200);
const tooBig = await post2(Buffer.alloc(1200, 2));
const tb = (await tooBig.json()) as any;
t('понад межу — 413 українською, нічого не записано', tooBig.status === 413 && /завеликий/.test(tb.error) && drafts[0].kit.files.length === 1);
server2.close();

const before = fs.readdirSync(path.join(DIR, 'small-store', 'small')).length;
const app3 = express();
kitRoutes.registerKitFileRoutes(app3, { auth: noAuth, readDrafts: async () => drafts, writeDrafts: async () => { throw new Error('disk'); }, store: smallStore, maxBytes: 1000 });
const server3 = app3.listen(0);
await new Promise((r) => server3.once('listening', r));
const res3 = await fetch(`http://127.0.0.1:${(server3.address() as any).port}/api/admin/furniture-products/small/kit-files`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-file-name': 'b.stl' }, body: Buffer.alloc(10, 7) });
t('збій запису картки — 500 і байти-сироти не лишаються', res3.status === 500 && fs.readdirSync(path.join(DIR, 'small-store', 'small')).length === before);
server3.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

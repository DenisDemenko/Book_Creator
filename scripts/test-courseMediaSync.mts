/**
 * Етап 0 «Курс за фото»: фото курсу з медіатеки Студії доходять до вітрини.
 *   - посилання медіатеки розпізнаються одним чистим модулем (і збігаються зі сховищем);
 *   - збирач payload кладе в зміст `media:<id>` лише для приймача з `course-media-v1`,
 *     інакше фото відкидаються, як і раніше; обкладинка з медіатеки в `coverUrl` не йде;
 *   - правила подання приймають обкладинку з медіатеки;
 *   - `syncCourseMedia`: обкладинка публічна, фото уроків платні з `sourceKey`, чуже / зниклe /
 *     не-зображення пропускається зі звітом, збій зупиняє публікацію й не стирає старі фото;
 *   - погодження модерації проходить увесь шлях: лістинг → обкладинка → фото → очищення.
 * Запуск: npm run test:course-media
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = path.join(os.tmpdir(), 'nova-course-media');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;
process.env.BRIDGE_SELLER_SLUG = 'fusion-lab';
process.env.USER_API_KEY_SECRET = process.env.USER_API_KEY_SECRET || 'test-secret-for-course-media-0123456789ab';

const { initStore, saveUser } = await import('../server/store.ts');
const bridge = await import('../server/marketplaceBridge.ts');
const library = await import('../server/media/mediaLibraryStore.ts');
const { libraryAssetId, LIBRARY_MEDIA_PREFIX, mediaToken } = await import('../src/utils/libraryMediaUrl.ts');
const { buildCoursePublishInput } = await import('../server/courseMarketplacePayload.ts');
const { courseSubmitProblems } = await import('../src/utils/coursePublishRules.ts');
const { collectCoursePhotoIds, syncCourseMedia } = await import('../server/courseMediaSync.ts');
const { registerModerationRoutes } = await import('../server/moderationRoutes.ts');
const { submitForModeration } = await import('../server/moderationStore.ts');
const { createCourse, getCourse, updateCourse } = await import('../server/courseStore.ts');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 1, 2, 3, 4]);

await initStore();
await saveUser({ id: 'u-teacher', email: 'teacher@test.dev', name: 'Олена Коваль', role: 'writer', createdAt: new Date().toISOString() } as any);
await bridge.saveBridgeSettings({ url: 'https://api.example.test', key: 'bridge-secret' });

const save = (ownerId: string, bytes: Uint8Array, mimeType: string, filename: string) =>
  library.saveAsset({ ownerId, kind: 'upload', filename, mimeType, bytes });
const coverAsset = await save('u-teacher', PNG, 'image/png', 'cover.png');
const photoA = await save('u-teacher', JPG, 'image/jpeg', 'a.jpg');
const photoB = await save('u-teacher', PNG, 'image/png', 'b.png');
const modCover = await save('u-teacher', JPG, 'image/jpeg', 'mod.jpg');
const gifAsset = await save('u-teacher', GIF, 'image/gif', 'anim.gif');
const foreign = await save('u-other', PNG, 'image/png', 'чуже.png');
const urlOf = (a: { id: string }) => `${LIBRARY_MEDIA_PREFIX}/${a.id}`;

console.log('\nПосилання медіатеки:');
t('id із посилання', libraryAssetId(urlOf(photoA)) === photoA.id);
t('запит і якір відсікаються', libraryAssetId(`${urlOf(photoA)}?v=2#x`) === photoA.id);
t('зовнішнє, відносне, порожнє → null', libraryAssetId('https://x.test/a.jpg') === null && libraryAssetId('/uploads/a.jpg') === null && libraryAssetId('') === null && libraryAssetId(undefined) === null);
t('«../» в id не проходить', libraryAssetId(`${LIBRARY_MEDIA_PREFIX}/../etc/passwd`) === null);
t('префікс збігається зі сховищем', LIBRARY_MEDIA_PREFIX === library.MEDIA_URL_PREFIX);
t('те саме розпізнавання, що у сховища', libraryAssetId(urlOf(photoB)) === library.assetIdFromUrl(urlOf(photoB)));

const courseInput = (over: Record<string, unknown> = {}) => ({
  title: 'Курс із фото',
  subtitle: 'Від нуля',
  summary: 'Коротко',
  description: 'Довго',
  audience: ['Школярі'],
  outcomes: ['Зробите деталь'],
  highlights: ['a', 'b', 'c'],
  coverUrl: urlOf(coverAsset),
  categorySlug: 'chpu',
  priceMinor: 150000,
  skills: [{ id: 's1', name: 'Безпека', level: 'base' as const, whyItMatters: 'x', howToDevelop: [], practiceIdeas: [] }],
  modules: [
    {
      id: 'm1',
      title: 'Модуль 1',
      coverPhotoUrl: urlOf(modCover),
      skillIds: [],
      lessons: [
        {
          id: 'l1',
          title: 'Урок 1',
          topics: [],
          photoUrls: [urlOf(photoA), 'https://example.test/ext.jpg', '/uploads/relative.jpg', urlOf(photoB), urlOf(photoA)],
        },
        { id: 'l2', title: 'Урок 2', topics: [], photoUrls: [urlOf(gifAsset), urlOf(foreign), `${LIBRARY_MEDIA_PREFIX}/md-gone`] },
      ],
    },
  ],
  ...over,
});
const base = courseInput() as any;

console.log('\nЗбирач і правила:');
const withUpload = buildCoursePublishInput(base, 'fusion-lab', { richContent: true, photoUpload: true });
const lessonPhotos = withUpload.modules![0].lessons[0].photoUrls!;
t('приймач з media-v1: фото медіатеки → media:<id>, зовнішнє лишається',
  lessonPhotos.join('|') === [mediaToken(photoA.id), 'https://example.test/ext.jpg', mediaToken(photoB.id), mediaToken(photoA.id)].join('|'), lessonPhotos.join('|'));
t('відносне посилання поза медіатекою відкидається', !lessonPhotos.some((u) => u.includes('relative')));
t('обкладинка модуля з медіатеки → media:<id>', withUpload.modules![0].coverPhotoUrl === mediaToken(modCover.id));
t('обкладинка курсу з медіатеки НЕ йде як coverUrl (вона їде файлом)', withUpload.coverUrl === undefined);
const noUpload = buildCoursePublishInput(base, 'fusion-lab', { richContent: true });
t('без media-v1 фото медіатеки відкидаються, як і раніше', noUpload.modules![0].lessons[0].photoUrls!.join('|') === 'https://example.test/ext.jpg' && noUpload.modules![0].coverPhotoUrl === undefined);
const legacy = buildCoursePublishInput(base, 'fusion-lab', { richContent: false, photoUpload: true });
t('старий приймач без content-v2 фото не отримує навіть з прапором', (legacy.modules![0].lessons[0] as any).photoUrls === undefined);
t('зовнішня обкладинка http(s) іде як coverUrl', buildCoursePublishInput({ ...base, coverUrl: 'https://example.test/c.png' }, 'fusion-lab').coverUrl === 'https://example.test/c.png');
t('правила: обкладинка з медіатеки приймається', !courseSubmitProblems(base).some((p) => p.includes('Обкладинка')));
t('правила: відносне посилання поза медіатекою — ні', courseSubmitProblems({ ...base, coverUrl: '/uploads/c.png' }).some((p) => p.includes('Обкладинка')));

console.log('\nЗбір активів:');
const collected = collectCoursePhotoIds({ ...base, id: 'c', ownerId: 'u-teacher' });
t('порядок курсу, без повторів і без зовнішніх', collected.join('|') === [modCover.id, photoA.id, photoB.id, gifAsset.id, foreign.id, 'md-gone'].join('|'), collected.join('|'));

type Call = { url: string; method: string; json?: any; form?: Record<string, any> };
const realFetch = globalThis.fetch;
let calls: Call[] = [];
let capabilities: string[] = ['course-content-v2', 'course-media-v1'];
let mediaStatus = 201;
let failOn: string | null = null;
let throwOnMedia = false;
globalThis.fetch = (async (url: string, init: any = {}) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(url, init);
  const method = init?.method || 'GET';
  const call: Call = { url: u, method };
  if (init?.body instanceof FormData) {
    const form: Record<string, any> = {};
    for (const [k, v] of init.body.entries()) {
      form[k] = typeof v === 'string' ? v : { name: (v as File).name, type: (v as File).type, size: (v as File).size };
    }
    call.form = form;
  } else if (typeof init?.body === 'string') {
    call.json = JSON.parse(init.body);
  }
  calls.push(call);
  if (u.endsWith('/bridge/categories')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ categories: [], capabilities }) } as any;
  }
  if (u.endsWith('/media/prune')) {
    return { ok: true, status: 201, text: async () => JSON.stringify({ pruned: 2 }) } as any;
  }
  if (u.includes('/media')) {
    if (throwOnMedia) throw new Error('offline');
    const key = call.form?.sourceKey;
    const status = failOn && key === failOn ? 500 : mediaStatus;
    return { ok: status < 400, status, text: async () => JSON.stringify({ attached: true, role: call.form?.role, replaced: 0, media: { id: 'x' } }) } as any;
  }
  return { ok: true, status: 201, text: async () => JSON.stringify({ created: true, listing: { slug: 'kurs' } }) } as any;
}) as never;

const syncCourse = (over: Record<string, unknown> = {}) => ({ ...(courseInput(over) as any), id: 'book-1', ownerId: 'u-teacher' });
const mediaCalls = () => calls.filter((c) => c.method === 'POST' && /\/media$/.test(c.url));

console.log('\nСинхронізація:');
calls = [];
const report = await syncCourseMedia(syncCourse(), { photoUpload: true });
const cover = mediaCalls().find((c) => c.form?.role === 'cover');
t('обкладинка йде файлом із role=cover і без sourceKey', !!cover && cover.form!.sourceKey === undefined && cover.form!.file.type === 'image/png');
t('адреса — externalId курсу', cover!.url === 'https://api.example.test/bridge/courses/book-1%3Acourse/media', cover!.url);
const lesson = mediaCalls().filter((c) => c.form?.role === 'lesson_photo');
t('фото уроків: sourceKey = id активу, у порядку курсу',
  lesson.map((c) => c.form!.sourceKey).join('|') === [modCover.id, photoA.id, photoB.id].join('|'), lesson.map((c) => c.form!.sourceKey).join('|'));
t('позиція = порядок у курсі', lesson.map((c) => c.form!.position).join('|') === '0|1|2');
t('mime зберігається', lesson[2].form!.file.type === 'image/png' && lesson[1].form!.file.type === 'image/jpeg');
t('звіт: завантажено 3, обкладинка з медіатеки', report.uploaded === 3 && report.cover === 'library', JSON.stringify(report));
const reasons = Object.fromEntries(report.skipped.map((s) => [s.id, s.reason]));
t('gif / чуже / зниклe — пропущені з причиною',
  reasons[gifAsset.id] === 'unsupported_format' && reasons[foreign.id] === 'foreign' && reasons['md-gone'] === 'missing', JSON.stringify(reasons));
t('чужий файл у вітрину НЕ пішов', !lesson.some((c) => c.form!.sourceKey === foreign.id));
const prune = calls.filter((c) => c.url.endsWith('/media/prune'));
t('після завантаження — очищення з усім переліком у змісті', prune.length === 1 && prune[0].json.keep.includes(photoA.id) && prune[0].json.keep.includes(gifAsset.id), JSON.stringify(prune[0]?.json));
t('очищення йде ПІСЛЯ усіх завантажень', calls.indexOf(prune[0]) > calls.indexOf(lesson[lesson.length - 1]));
t('pruned береться з відповіді', report.pruned === 2);

calls = [];
const ext = await syncCourseMedia(syncCourse({ coverUrl: 'https://example.test/c.png' }), { photoUpload: true });
t('зовнішня обкладинка: файл-обкладинка не надсилається', !mediaCalls().some((c) => c.form?.role === 'cover') && ext.cover === 'external');

calls = [];
let err: any = null;
try { await syncCourseMedia(syncCourse(), { photoUpload: false }); } catch (e) { err = e; }
t('приймач без media-v1 + обкладинка з медіатеки → публікація зупиняється з поясненням', err instanceof bridge.MarketplaceBridgeError && /деплой/.test(err.message) && calls.length === 0, err?.message);
calls = [];
const old = await syncCourseMedia(syncCourse({ coverUrl: 'https://example.test/c.png' }), { photoUpload: false });
t('приймач без media-v1 + зовнішня обкладинка → працює, фото лише рахуються', old.unsupported === 6 && old.uploaded === 0 && calls.length === 0, JSON.stringify(old));

err = null;
try { await syncCourseMedia(syncCourse({ coverUrl: `${LIBRARY_MEDIA_PREFIX}/md-nope` }), { photoUpload: true }); } catch (e) { err = e; }
t('обкладинки немає в медіатеці → cover_required', err?.kind === 'cover_required' && err.status === 400, err?.message);

calls = [];
failOn = photoB.id;
err = null;
try { await syncCourseMedia(syncCourse(), { photoUpload: true }); } catch (e) { err = e; }
failOn = null;
t('збій одного фото → помилка з підсумком', err instanceof bridge.MarketplaceBridgeError && /1 із/.test(err.message), err?.message);
t('…і очищення НЕ викликається (старі фото не стираються)', !calls.some((c) => c.url.endsWith('/media/prune')));

calls = [];
throwOnMedia = true;
err = null;
try { await syncCourseMedia(syncCourse(), { photoUpload: true }); } catch (e) { err = e; }
throwOnMedia = false;
t('немає звʼязку → одразу unreachable, без перебору всіх фото', err?.kind === 'unreachable' && mediaCalls().length === 1, `${err?.kind}/${mediaCalls().length}`);

console.log('\nПогодження модерації:');
const ROLES: Record<string, string> = { 'u-admin': 'admin' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLES[id] ?? 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
registerModerationRoutes(app);
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const approve = async (id: string) => {
  const res = await realFetch(`${baseUrl}/api/admin/moderation/${id}/approve`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-who': 'u-admin' }, body: '{}' });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const submit = (courseId: string) => {
  updateCourse(courseId, { status: 'ready' });
  const c = getCourse(courseId)!;
  return submitForModeration({ itemType: 'course', itemId: courseId, authorId: 'u-teacher', title: c.title, snapshot: JSON.stringify(c) } as any) as any;
};

try {
  capabilities = ['course-content-v2', 'course-media-v1'];
  const c1 = createCourse('u-teacher', courseInput() as any);
  const e1 = submit(c1.id);
  calls = [];
  const ok1 = await approve(e1.id);
  t('погодження → 200', ok1.status === 200, JSON.stringify(ok1.body).slice(0, 200));
  const order = calls.filter((c) => c.method === 'POST').map((c) => (c.url.endsWith('/bridge/courses') ? 'course' : c.url.endsWith('/prune') ? 'prune' : c.form?.role ?? '?'));
  t('порядок: лістинг → обкладинка → фото → очищення', order[0] === 'course' && order[1] === 'cover' && order.slice(2, 5).every((r) => r === 'lesson_photo') && order[order.length - 1] === 'prune', order.join(','));
  const sent = calls.find((c) => c.url.endsWith('/bridge/courses'))!.json;
  t('у лістингу — media:<id>, а coverUrl порожній', sent.modules[0].lessons[0].photoUrls.includes(mediaToken(photoA.id)) && sent.coverUrl === undefined);
  t('відповідь містить звіт про фото', ok1.body.published?.media?.uploaded === 3 && ok1.body.published?.media?.cover === 'library', JSON.stringify(ok1.body.published?.media));
  t('курс опубліковано', getCourse(c1.id)?.status === 'published');

  const c2 = createCourse('u-teacher', courseInput() as any);
  const e2 = submit(c2.id);
  failOn = photoA.id;
  const bad = await approve(e2.id);
  failOn = null;
  t('збій фото → погодження не завершене (502), курс не позначено опублікованим', bad.status === 502 && getCourse(c2.id)?.status !== 'published', `${bad.status} ${getCourse(c2.id)?.status}`);
  const again = await approve(e2.id);
  t('повторне погодження проходить', again.status === 200 && getCourse(c2.id)?.status === 'published', `${again.status}`);

  capabilities = ['course-content-v2'];
  const c3 = createCourse('u-teacher', courseInput({ coverUrl: 'https://example.test/c.png' }) as any);
  const e3 = submit(c3.id);
  calls = [];
  const oldRecv = await approve(e3.id);
  t('старий приймач із зовнішньою обкладинкою: 200, жодного запиту фото', oldRecv.status === 200 && mediaCalls().length === 0 && oldRecv.body.published?.media?.unsupported === 6, JSON.stringify(oldRecv.body.published?.media));
  const sentOld = calls.find((c) => c.url.endsWith('/bridge/courses'))!.json;
  t('…і в лістингу немає media: ознак', !JSON.stringify(sentOld.modules).includes('media:'));
} finally {
  server.close();
  globalThis.fetch = realFetch;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * Що з курсу йде у вітрину (етап 3 аудиту курсів, 27.10.2026):
 *   - ОДИН збирач payload для погодження модерації й адмінського `publish-course`;
 *   - повний платний зміст (опис, фото, завдання, id) іде лише приймачу, що заявив
 *     `course-content-v2`; старому — безпечний обсяг (програма + відео);
 *   - адмінський маршрут не приймає з тіла ні ціну, ні програму: бере курс зі сховища
 *     й проходить ті самі перевірки, що й погодження.
 * Запуск: npm run test:course-marketplace-payload
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = path.join(os.tmpdir(), 'nova-course-payload');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;
process.env.BRIDGE_SELLER_SLUG = 'fusion-lab';
process.env.USER_API_KEY_SECRET = process.env.USER_API_KEY_SECRET || 'test-secret-for-course-payload-0123456789';

const { initStore } = await import('../server/store.ts');
const bridge = await import('../server/marketplaceBridge.ts');
const { buildCoursePublishInput } = await import('../server/courseMarketplacePayload.ts');
const { registerModerationRoutes } = await import('../server/moderationRoutes.ts');
const { registerAdminRoutes } = await import('../server/adminRoutes.ts');
const { submitForModeration } = await import('../server/moderationStore.ts');
const { createCourse, getCourse, updateCourse } = await import('../server/courseStore.ts');
const { saveUser } = await import('../server/store.ts');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const ASSIGN = {
  id: 'a1',
  title: 'Зібрати стенд',
  brief: 'Покроково.',
  steps: ['Крок 1', '  ', 'Крок 2'],
  deliverable: 'Фото',
  acceptanceCriteria: ['Працює', ''],
  estimateMin: 40,
};
const courseInput = () => ({
  title: 'Курс з основ ЧПУ',
  subtitle: 'Від нуля',
  summary: 'Коротко',
  description: 'Довго',
  audience: ['Школярі', ' '],
  outcomes: ['Зробите деталь'],
  highlights: ['a', 'b', 'c'],
  coverUrl: 'https://example.test/cover.png',
  categorySlug: 'chpu',
  priceMinor: 150000,
  skills: [{ id: 's1', name: 'Безпека', level: 'base' as const, whyItMatters: 'x', howToDevelop: ['секрет'], practiceIdeas: ['секрет'] }],
  modules: [
    {
      id: 'm1',
      title: 'Модуль 1',
      summary: 'Про модуль',
      coverPhotoUrl: 'https://example.test/m1.jpg',
      introVideoUrl: 'https://vimeo.com/123456789',
      finalAssignment: ASSIGN,
      skillIds: [],
      lessons: [
        {
          id: 'l1',
          title: 'Урок 1',
          goal: 'Мета',
          description: 'Текст уроку',
          topics: ['Тема 1', ''],
          videoUrl: 'https://youtu.be/dQw4w9WgXcQ',
          photoUrls: ['https://example.test/a.jpg', '/uploads/relative.jpg', 'data:image/png;base64,AAAA'],
          assignment: ASSIGN,
          durationMin: 12,
        },
      ],
    },
  ],
});

console.log('\nЗбирач:');
const base = courseInput() as any;
const rich = buildCoursePublishInput(base, 'fusion-lab', { richContent: true });
const lesson = rich.modules![0].lessons[0];
t('id модуля й уроку передаються', rich.modules![0].id === 'm1' && lesson.id === 'l1');
t('мета, теми (без порожніх), опис, відео', lesson.goal === 'Мета' && lesson.topics!.length === 1 && lesson.description === 'Текст уроку' && !!lesson.videoUrl);
t('у фото лишаються лише абсолютні http(s)', lesson.photoUrls!.length === 1 && lesson.photoUrls![0] === 'https://example.test/a.jpg', JSON.stringify(lesson.photoUrls));
t('завдання: порожні кроки й критерії прибрано, id завдання не йде', lesson.assignment!.steps!.length === 2 && lesson.assignment!.acceptanceCriteria!.length === 1 && !('id' in lesson.assignment!));
t('підсумкове завдання й обкладинка модуля', !!rich.modules![0].finalAssignment && rich.modules![0].coverPhotoUrl === 'https://example.test/m1.jpg');
t('навички — лише назва/рівень/навіщо (без «як розвивати»)', JSON.stringify(rich.skills) === JSON.stringify([{ name: 'Безпека', level: 'base', whyItMatters: 'x' }]));
t('порожні рядки аудиторії відсіяно', rich.audience!.length === 1);
t('ціна й UAH', rich.priceMinor === 150000 && rich.currency === 'UAH');
t('ім\'я викладача з опцій, обрізане; порожнє → не йде', buildCoursePublishInput(base, 'fusion-lab', { instructorName: '  Олена Коваль ' }).instructorName === 'Олена Коваль' && buildCoursePublishInput(base, 'fusion-lab', { instructorName: '  ' }).instructorName === undefined && rich.instructorName === undefined);

const safe = buildCoursePublishInput(base, 'fusion-lab');
const sl = safe.modules![0].lessons[0] as any;
t('за замовчуванням — безпечний обсяг: лише програма й відео', sl.description === undefined && sl.assignment === undefined && sl.photoUrls === undefined && sl.id === undefined && !!sl.videoUrl);
t('…і без підсумкового завдання модуля', (safe.modules![0] as any).finalAssignment === undefined && (safe.modules![0] as any).id === undefined);

console.log('\nРукостискання:');
let capabilities: string[] | null = ['course-content-v2'];
const bridgeCalls: Array<{ url: string; method: string; body: any }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any = {}) => {
  const method = init?.method || 'GET';
  bridgeCalls.push({ url: String(url), method, body: init?.body ? JSON.parse(init.body) : undefined });
  if (String(url).endsWith('/bridge/categories')) {
    return { ok: true, status: 200, text: async () => JSON.stringify({ categories: [], ...(capabilities ? { capabilities } : {}) }) };
  }
  return { ok: true, status: 201, text: async () => JSON.stringify({ created: true, listing: { slug: 'kurs' } }) };
}) as never;

await initStore();
await bridge.saveBridgeSettings({ url: 'https://api.example.test', key: 'bridge-secret' });
t('приймач заявив v2 → true', (await bridge.bridgeSupportsCourseContent()) === true);
capabilities = null;
t('старий приймач (без capabilities) → false', (await bridge.bridgeSupportsCourseContent()) === false);
capabilities = ['інше'];
t('інша можливість → false', (await bridge.bridgeSupportsCourseContent()) === false);
const failingFetch = globalThis.fetch;
globalThis.fetch = (async () => { throw new Error('offline'); }) as never;
t('мережева помилка → false, а не виняток', (await bridge.bridgeSupportsCourseContent()) === false);
globalThis.fetch = failingFetch;

console.log('\nМаршрути:');
const ROLES: Record<string, string> = { 'u-admin': 'admin' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLES[id] ?? 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
registerModerationRoutes(app);
registerAdminRoutes(app);
const server = app.listen(0);
const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await realFetch(`${baseUrl}${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-who': who },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};
const sentCourse = () => bridgeCalls.filter((c) => c.url.endsWith('/bridge/courses')).pop()?.body;

try {
  await saveUser({ id: 'u-teacher', email: 'teacher@test.dev', name: 'Олена Коваль', role: 'writer', createdAt: new Date().toISOString() } as any);

  // Погодження, приймач із v2.
  capabilities = ['course-content-v2'];
  const c1 = createCourse('u-teacher', courseInput() as any);
  updateCourse(c1.id, { status: 'ready' });
  const e1 = submitForModeration({ itemType: 'course', itemId: c1.id, authorId: 'u-teacher', title: c1.title, snapshot: JSON.stringify(getCourse(c1.id)) } as any);
  bridgeCalls.length = 0;
  const ok1 = await call('POST', `/api/admin/moderation/${(e1 as any).id}/approve`, 'u-admin');
  const s1 = sentCourse();
  t('погодження (приймач v2) → 200, contentMode=full', ok1.status === 200 && ok1.body.published?.contentMode === 'full', JSON.stringify(ok1.body).slice(0, 160));
  t('продавець — платформа, а ім\'я автора курсу йде як викладач', s1?.sellerSlug === 'fusion-lab' && s1?.instructorName === 'Олена Коваль', `${s1?.sellerSlug}/${s1?.instructorName}`);
  t('у мост ішов повний зміст з id', s1?.modules?.[0]?.lessons?.[0]?.id === 'l1' && !!s1.modules[0].lessons[0].assignment);

  // Погодження, старий приймач.
  capabilities = null;
  const c2 = createCourse('u-teacher', courseInput() as any);
  updateCourse(c2.id, { status: 'ready' });
  const e2 = submitForModeration({ itemType: 'course', itemId: c2.id, authorId: 'u-teacher', title: c2.title, snapshot: JSON.stringify(getCourse(c2.id)) } as any);
  bridgeCalls.length = 0;
  const ok2 = await call('POST', `/api/admin/moderation/${(e2 as any).id}/approve`, 'u-admin');
  const s2 = sentCourse();
  t('погодження (старий приймач) → 200, contentMode=programme', ok2.status === 200 && ok2.body.published?.contentMode === 'programme');
  const l2 = s2?.modules?.[0]?.lessons?.[0] ?? {};
  t('старому приймачу НЕ йдуть опис, фото, завдання', l2.description === undefined && l2.assignment === undefined && l2.photoUrls === undefined && !!l2.videoUrl);

  // Адмінський маршрут.
  capabilities = ['course-content-v2'];
  const noBody = await call('POST', '/api/admin/marketplace-bridge/publish-course', 'u-admin', {});
  t('без courseId → 400', noBody.status === 400);
  const unknown = await call('POST', '/api/admin/marketplace-bridge/publish-course', 'u-admin', { courseId: 'нема' });
  t('невідомий курс → 404', unknown.status === 404);
  const anon = await call('POST', '/api/admin/marketplace-bridge/publish-course', '', { courseId: c1.id });
  t('без прав адміна → заборонено', anon.status === 401 || anon.status === 403, String(anon.status));

  const c3 = createCourse('u-teacher', { ...(courseInput() as any), priceMinor: undefined });
  const noPrice = await call('POST', '/api/admin/marketplace-bridge/publish-course', 'u-admin', { courseId: c3.id });
  t('курс без ціни не публікується (400 not_ready)', noPrice.status === 400 && noPrice.body.kind === 'not_ready');

  const c4 = createCourse('u-teacher', courseInput() as any);
  bridgeCalls.length = 0;
  const forged = await call('POST', '/api/admin/marketplace-bridge/publish-course', 'u-admin', {
    courseId: c4.id,
    priceMinor: 1,
    title: 'ПІДМІНА',
    modules: [{ title: 'підмінений', lessons: [{ title: 'x', videoUrl: 'https://youtu.be/leak' }] }],
    skills: [{ name: 'підмінена' }],
  });
  const s4 = sentCourse();
  t('адмін-роут → 200 і публікує курс', forged.status === 200 && forged.body.contentMode === 'full', JSON.stringify(forged.body).slice(0, 160));
  t('адмінська публікація теж передає викладача', s4?.instructorName === 'Олена Коваль');
  t('тіло запиту не підміняє ціну/назву/програму/навички', s4?.priceMinor === 150000 && s4.title === 'Курс з основ ЧПУ' && s4.modules[0].title === 'Модуль 1' && s4.skills[0].name === 'Безпека');
  t('адмінська публікація теж ставить «Опубліковано»', getCourse(c4.id)?.status === 'published');
} finally {
  server.close();
  globalThis.fetch = realFetch;
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

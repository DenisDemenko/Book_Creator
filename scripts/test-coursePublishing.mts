/**
 * Подання курсу у вітрину: спільні правила (src/utils/coursePublishRules.ts),
 * маршрути автора (server/courseRoutes.ts) і погодження/відхилення адміном
 * (server/moderationRoutes.ts). Мережі нема: міст відповідає заглушкою.
 * Запуск: npm run test:course-publishing
 *
 * Що стережемо (аудит курсів 27.10.2026, етап 1):
 *   - курс без ціни НЕ стає безкоштовним (раніше `priceMinor ?? 0`);
 *   - статус «Опубліковано» ставить лише погодження, не автор;
 *   - обкладинка, ціна, відео й тривалість перевіряються вже при поданні;
 *   - валюта завжди UAH; категорія вітрини доходить до мосту;
 *   - відхилити можна лише те, що чекає, і автор бачить причину.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';

const DIR = path.join(os.tmpdir(), 'nova-course-publishing');
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova.db`;
process.env.BRIDGE_SELLER_SLUG = 'fusion-lab';
process.env.USER_API_KEY_SECRET = process.env.USER_API_KEY_SECRET || 'test-secret-for-course-publishing-0123456789';

const rules = await import('../src/utils/coursePublishRules.ts');
const { initStore } = await import('../server/store.ts');
const bridge = await import('../server/marketplaceBridge.ts');
const { registerCourseRoutes } = await import('../server/courseRoutes.ts');
const { registerModerationRoutes } = await import('../server/moderationRoutes.ts');
const { submitForModeration } = await import('../server/moderationStore.ts');
const { courseSnapshotChanges } = await import('../src/utils/courseSnapshotDiff.ts');
const { getCourse, updateCourse } = await import('../server/courseStore.ts');
const { setModerationMailer } = await import('../server/moderationNotify.ts');
const { saveUser } = await import('../server/store.ts');

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// ── Правила ──────────────────────────────────────────────────────────────
console.log('\nПравила подання:');
const full = () => ({
  title: 'Курс з основ ЧПУ',
  subtitle: 'Від нуля до першої деталі',
  audience: ['Школярі'],
  outcomes: ['Зробите деталь'],
  highlights: ['a', 'b', 'c'],
  coverUrl: 'https://example.test/cover.png',
  priceMinor: 150000,
  skills: [{ id: 's1' }],
  modules: [
    {
      title: 'Модуль 1',
      introVideoUrl: 'https://vimeo.com/123456789/abcdef1234',
      lessons: [{ title: 'Урок 1', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', durationMin: 12 }],
    },
  ],
});
t('повний курс — без зауважень', rules.courseSubmitProblems(full()).length === 0, rules.courseSubmitProblems(full()).join(' | '));
{
  const p = rules.courseSubmitProblems({ ...full(), priceMinor: undefined });
  t('без ціни — блокує, а не «безкоштовний»', p.some((x) => /Не вказано ціну/.test(x)), p.join(' | '));
  t('ціна 0 без позначки — блокує', rules.courseSubmitProblems({ ...full(), priceMinor: 0 }).some((x) => /Безкоштовний/.test(x)));
  t('«Безкоштовний» з ціною 0 — можна', rules.courseSubmitProblems({ ...full(), priceMinor: 0, free: true }).length === 0);
  t('«Безкоштовний» без ціни — можна', rules.courseSubmitProblems({ ...full(), priceMinor: undefined, free: true }).length === 0);
  t('«Безкоштовний» і ціна разом — суперечність', rules.courseSubmitProblems({ ...full(), free: true }).some((x) => /щось одне/.test(x)));
  t('дробові копійки — некоректна ціна', rules.courseSubmitProblems({ ...full(), priceMinor: 10.5 }).some((x) => /некоректно/.test(x)));
  t('без обкладинки — блокує вже при поданні', rules.courseSubmitProblems({ ...full(), coverUrl: '' }).some((x) => /обкладинки/.test(x)));
  t('обкладинка не http(s) — блокує', rules.courseSubmitProblems({ ...full(), coverUrl: 'cover.png' }).some((x) => /http/.test(x)));
  t('валюта USD — блокує', rules.courseSubmitProblems({ ...full(), currency: 'USD' }).some((x) => /гривнях/.test(x)));
  t('валюта uah — можна', rules.courseSubmitProblems({ ...full(), currency: 'uah' }).length === 0);
}
{
  const ok = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://youtube.com/shorts/dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ',
    'https://vimeo.com/123456789',
    'https://vimeo.com/123456789/abcdef1234',
    'https://player.vimeo.com/video/123456789',
  ];
  t('YouTube і Vimeo (усі звичні форми) — приймаються', ok.every((u) => rules.videoUrlProblem(u) === null), ok.filter((u) => rules.videoUrlProblem(u)).join(' '));
  t('порожнє відео — не помилка', rules.videoUrlProblem('') === null && rules.videoUrlProblem(undefined) === null);
  const bad = ['https://drive.google.com/file/d/xyz/view', 'відео тут', 'https://rutube.ru/video/abc'];
  t('інші посилання — помилка', bad.every((u) => rules.videoUrlProblem(u) !== null));
  const withBadVideo = full();
  withBadVideo.modules[0].lessons[0].videoUrl = 'https://drive.google.com/x';
  t('погане відео уроку блокує подання з номером уроку', rules.courseSubmitProblems(withBadVideo).some((x) => /Урок 1\.1, відео/.test(x)));
  t('тривалість 0, 1.5 і 601 — помилка', [0, 1.5, 601].every((v) => rules.lessonDurationProblem(v) !== null));
  t('тривалість 45 і порожня — норма', rules.lessonDurationProblem(45) === null && rules.lessonDurationProblem(undefined) === null);
}

console.log('\nКатегорія в правилах:');
{
  const noCat = { ...full(), categorySlug: undefined };
  t('без вимоги категорії курс без категорії проходить', rules.courseSubmitProblems(noCat).length === 0);
  t('з вимогою — без категорії блокує', rules.courseSubmitProblems(noCat, { categoryRequired: true }).some((x) => /категорію/.test(x)));
  t('з вимогою — порожній slug («без категорії») теж блокує', rules.courseSubmitProblems({ ...full(), categorySlug: '' }, { categoryRequired: true }).some((x) => /категорію/.test(x)));
  t('з вимогою й категорією — можна', rules.courseSubmitProblems({ ...full(), categorySlug: 'chpu' }, { categoryRequired: true }).length === 0);
}

// ── Маршрути ─────────────────────────────────────────────────────────────
await initStore();
await bridge.saveBridgeSettings({ url: 'https://api.example.test', key: 'bridge-secret' });

const bridgeCalls: Array<{ url: string; method: string; body: any }> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string, init: any = {}) => {
  bridgeCalls.push({ url: String(url), method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
  return { ok: true, status: 201, text: async () => JSON.stringify({ created: true, listing: { slug: 'kurs' } }) };
}) as never;

const ROLES: Record<string, string> = { 'u-admin': 'admin', 'u-teacher': 'teacher' };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  const id = String(req.headers['x-who'] || '');
  (req as any).principal = id ? { id, role: ROLES[id] ?? 'writer', isGuest: false } : { id: null, role: 'guest', isGuest: true };
  next();
});
registerCourseRoutes(app, {
  listCategories: async () => [{ slug: 'chpu', name: 'ЧПУ та верстати' }],
});
registerModerationRoutes(app);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = async (method: string, p: string, who: string, body?: unknown) => {
  const res = await realFetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-who': who },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
};

try {
  console.log('\nАвтор:');
  const cats = await call('GET', '/api/courses/storefront-categories', 'u-teacher');
  t('категорії вітрини доступні автору (не лише адміну)', cats.status === 200 && cats.body.categories?.[0]?.slug === 'chpu', JSON.stringify(cats.body));

  const created = await call('POST', '/api/courses', 'u-teacher', { title: 'Курс з основ ЧПУ', status: 'published', currency: 'USD' });
  const id = created.body.course?.id as string;
  t('створення: статус з тіла ігнорується — чернетка', created.status === 201 && created.body.course.status === 'draft', created.body.course?.status);
  t('створення: валюта завжди UAH', created.body.course?.currency === 'UAH', created.body.course?.currency);

  const { title: _t, ...rest } = full();
  const put1 = await call('PUT', `/api/courses/${id}`, 'u-teacher', {
    ...rest, priceMinor: undefined, status: 'published', categorySlug: 'chpu', skills: [{ id: 's1', name: 'Безпека', level: 'base', whyItMatters: 'x', howToDevelop: [], practiceIdeas: [] }],
    modules: [{ id: 'm1', title: 'Модуль 1', skillIds: [], introVideoUrl: 'https://vimeo.com/123456789', lessons: [{ id: 'l1', title: 'Урок 1', topics: [], photoUrls: [], videoUrl: 'https://youtu.be/dQw4w9WgXcQ', durationMin: 12 }] }],
  });
  t('збереження: «Опубліковано» з тіла не приймається', put1.status === 200 && put1.body.course.status === 'draft', put1.body.course?.status);

  const noPrice = await call('POST', `/api/courses/${id}/publish`, 'u-teacher');
  t('подання без ціни → 400 з причиною', noPrice.status === 400 && (noPrice.body.problems || []).some((p: string) => /ціну/.test(p)), JSON.stringify(noPrice.body.problems));

  await call('PUT', `/api/courses/${id}`, 'u-teacher', { priceMinor: 150000 });
  const submitted = await call('POST', `/api/courses/${id}/publish`, 'u-teacher');
  t('подання повного курсу → 200, статус «на модерації» (ready)', submitted.status === 200 && submitted.body.course?.status === 'ready', JSON.stringify(submitted.body).slice(0, 160));
  const opened = await call('GET', `/api/courses/${id}`, 'u-teacher');
  t('автор бачить, що курс чекає на модерацію', opened.body.moderation?.status === 'pending');

  console.log('\nАдмін:');
  const queue = await call('GET', '/api/admin/moderation?status=pending', 'u-admin');
  const entryId = queue.body.moderation?.find((m: any) => m.itemId === id)?.id as string;
  t('курс у черзі', !!entryId);

  bridgeCalls.length = 0;
  const approved = await call('POST', `/api/admin/moderation/${entryId}/approve`, 'u-admin');
  const sent = bridgeCalls.find((c) => c.url.endsWith('/bridge/courses'))?.body ?? {};
  t('погодження → 200', approved.status === 200, JSON.stringify(approved.body).slice(0, 200));
  t('у мост іде справжня ціна', sent.priceMinor === 150000, String(sent.priceMinor));
  t('валюта в мосту — UAH', sent.currency === 'UAH', String(sent.currency));
  t('категорія вітрини доходить до мосту', sent.categorySlug === 'chpu' && sent.category === undefined, `${sent.categorySlug}/${sent.category}`);
  t('курс став «Опубліковано» лише після погодження', getCourse(id)?.status === 'published');

  const again = await call('POST', `/api/admin/moderation/${entryId}/reject`, 'u-admin', { reason: 'пізно' });
  t('відхилити вже погоджене — 409', again.status === 409, String(again.status));
  t('…і курс лишився опублікованим', getCourse(id)?.status === 'published');

  console.log('\nКурс, що змінився після подання:');
  const c2 = (await call('POST', '/api/courses', 'u-teacher', { title: 'Другий курс' })).body.course;
  await call('PUT', `/api/courses/${c2.id}`, 'u-teacher', { ...put1.body.course, id: undefined, title: 'Другий курс', priceMinor: 9900 });
  const sub2 = await call('POST', `/api/courses/${c2.id}/publish`, 'u-teacher');
  t('подано', sub2.status === 200, JSON.stringify(sub2.body).slice(0, 160));
  // Автор стер ціну вже після подання (або це старий запис черги без перевірки ціни).
  // Так шле редактор: стерта ціна — null (undefined випав би з JSON).
  const cleared = await call('PUT', `/api/courses/${c2.id}`, 'u-teacher', { priceMinor: null, free: false });
  t('стерта в редакторі ціна справді стирається на сервері', cleared.body.course?.priceMinor === undefined && cleared.body.course?.free === undefined, JSON.stringify({ p: cleared.body.course?.priceMinor, f: cleared.body.course?.free }));
  const entry2 = (await call('GET', '/api/admin/moderation?status=pending', 'u-admin')).body.moderation.find((m: any) => m.itemId === c2.id).id;

  console.log('\nЗнімок на момент подання (етап 2):');
  const detail = await call('GET', `/api/admin/moderation/${entry2}`, 'u-admin');
  t('картка запису віддає повний курс із знімка', detail.status === 200 && detail.body.source === 'snapshot' && detail.body.course?.modules?.length === 1 && detail.body.course?.priceMinor === 9900, JSON.stringify(detail.body).slice(0, 160));
  t('картка: категорія вітрини названа', detail.body.category === null || typeof detail.body.category?.name === 'string');
  t('картка: знімок правилам відповідає — зауважень немає', (detail.body.problems || []).length === 0, JSON.stringify(detail.body.problems));
  t('картка: ціна стерта вже після подання видна як зміна', (detail.body.changes || []).some((x: string) => /Ціна: 99 грн → не вказано/.test(x)), JSON.stringify(detail.body.changes));
  const guestDetail = await call('GET', `/api/admin/moderation/${entry2}`, 'u-teacher');
  t('картка запису — лише адміну', guestDetail.status === 403 || guestDetail.status === 401, String(guestDetail.status));

  // Автор виправляє дрібницю й подає знову, поки запис чекає: знімок оновлюється, нового запису нема.
  await call('PUT', `/api/courses/${c2.id}`, 'u-teacher', { priceMinor: 12000, title: 'Другий курс (виправлено)' });
  const resub = await call('POST', `/api/courses/${c2.id}/publish`, 'u-teacher');
  const pendingNow = (await call('GET', '/api/admin/moderation?status=pending', 'u-admin')).body.moderation.filter((m: any) => m.itemId === c2.id);
  t('повторне подання, поки чекає, не плодить записи', resub.status === 200 && pendingNow.length === 1 && pendingNow[0].id === entry2, String(pendingNow.length));
  const detail2 = await call('GET', `/api/admin/moderation/${entry2}`, 'u-admin');
  t('знімок оновився до нової версії', detail2.body.course?.priceMinor === 12000 && detail2.body.course?.title === 'Другий курс (виправлено)');
  t('після оновлення знімка змін нема', (detail2.body.changes || []).length === 0, JSON.stringify(detail2.body.changes));

  // Автор править ще раз ПІСЛЯ подання — до вітрини піде те, що розглядав адмін.
  await call('PUT', `/api/courses/${c2.id}`, 'u-teacher', { priceMinor: 99900, title: 'Третя назва' });
  bridgeCalls.length = 0;
  const approvedSnap = await call('POST', `/api/admin/moderation/${entry2}/approve`, 'u-admin');
  const snapSent = bridgeCalls.find((c) => c.url.endsWith('/bridge/courses'))?.body ?? {};
  t('погодження публікує ПОДАНУ версію, а не живу', approvedSnap.status === 200 && snapSent.priceMinor === 12000 && snapSent.title === 'Другий курс (виправлено)', `${approvedSnap.status} ${snapSent.priceMinor} ${snapSent.title}`);
  t('правки автора лишилися в чернетці, а не пішли у вітрину', getCourse(c2.id)?.priceMinor === 99900 && getCourse(c2.id)?.status === 'published');

  console.log('\nСтарий запис без знімка (до етапу 2):');
  const c3 = (await call('POST', '/api/courses', 'u-teacher', { title: 'Старий курс' })).body.course;
  await call('PUT', `/api/courses/${c3.id}`, 'u-teacher', { ...put1.body.course, id: undefined, title: 'Старий курс', priceMinor: 5000 });
  updateCourse(c3.id, { status: 'ready' });
  const legacy = submitForModeration({ itemType: 'course', itemId: c3.id, title: 'Старий курс', authorId: 'u-teacher' });
  const legacyDetail = await call('GET', `/api/admin/moderation/${legacy.id}`, 'u-admin');
  t('без знімка показується живий стан і це сказано', legacyDetail.body.source === 'live' && legacyDetail.body.course?.priceMinor === 5000);
  updateCourse(c3.id, { priceMinor: undefined });
  bridgeCalls.length = 0;
  const legacyApprove = await call('POST', `/api/admin/moderation/${legacy.id}/approve`, 'u-admin');
  t('старий запис без ціни → 400, а не безкоштовний курс', legacyApprove.status === 400 && legacyApprove.body.kind === 'not_ready' && bridgeCalls.length === 0, JSON.stringify(legacyApprove.body).slice(0, 160));

  console.log('\nПовернути із зауваженнями:');
  const noNote = await call('POST', `/api/admin/moderation/${legacy.id}/request-changes`, 'u-admin', { note: '  ' });
  t('без тексту зауважень → 400', noNote.status === 400);
  const back = await call('POST', `/api/admin/moderation/${legacy.id}/request-changes`, 'u-admin', { note: 'Додайте ціну' });
  t('повернення із зауваженнями → 200', back.status === 200 && back.body.moderation?.status === 'changes_requested');
  t('курс повернувся в чернетку', getCourse(c3.id)?.status === 'draft', getCourse(c3.id)?.status);
  const authorSees = await call('GET', `/api/courses/${c3.id}`, 'u-teacher');
  t('автор бачить зауваження', authorSees.body.moderation?.status === 'changes_requested' && authorSees.body.moderation?.reason === 'Додайте ціну');
  const twice = await call('POST', `/api/admin/moderation/${legacy.id}/request-changes`, 'u-admin', { note: 'ще раз' });
  t('повернути вдруге те саме — 409', twice.status === 409);
  const approveAfter = await call('POST', `/api/admin/moderation/${legacy.id}/approve`, 'u-admin');
  t('погодити повернуте — 409', approveAfter.status === 409);
  const listed = await call('GET', '/api/admin/moderation?status=changes_requested', 'u-admin');
  t('фільтр «З зауваженнями»', listed.body.moderation?.some((m: any) => m.id === legacy.id));
  // Виправив і подав знову — той самий курс, новий запис черги.
  await call('PUT', `/api/courses/${c3.id}`, 'u-teacher', { priceMinor: 5000 });
  const again2 = await call('POST', `/api/courses/${c3.id}/publish`, 'u-teacher');
  t('після зауважень курс подається знову (той самий курс)', again2.status === 200 && again2.body.moderation?.id !== legacy.id && again2.body.moderation?.status === 'pending');
  const seen2 = await call('GET', `/api/courses/${c3.id}`, 'u-teacher');
  t('автор бачить: знову на модерації', seen2.body.moderation?.status === 'pending');

  console.log('\nПорівняння версій:');
  const same = courseSnapshotChanges(full() as any, full() as any);
  t('однакові версії — без змін', same.length === 0, same.join('|'));
  const other: any = full();
  other.modules[0].lessons.push({ title: 'Новий урок', durationMin: 5 });
  other.coverUrl = 'https://example.test/other.png';
  const diff = courseSnapshotChanges(full() as any, other);
  t('нові уроки й обкладинка видно в різниці', diff.some((x) => /Обкладинка/.test(x)) && diff.some((x) => /уроків 1 → 2.*Новий урок/.test(x)), diff.join(' | '));

  const rejected_ = await call('POST', `/api/admin/moderation/${entry2}/reject`, 'u-admin', { reason: 'Немає ціни' });
  t('вже погоджений запис не відхиляється', rejected_.status === 409);
  const c2b = (await call('POST', '/api/courses', 'u-teacher', { title: 'Курс для відхилення' })).body.course;
  await call('PUT', `/api/courses/${c2b.id}`, 'u-teacher', { ...put1.body.course, id: undefined, title: 'Курс для відхилення', priceMinor: 7000 });
  const subB = await call('POST', `/api/courses/${c2b.id}/publish`, 'u-teacher');
  const rejectedB = await call('POST', `/api/admin/moderation/${subB.body.moderation.id}/reject`, 'u-admin', { reason: 'Немає ціни' });
  t('відхилення того, що чекає → 200', rejectedB.status === 200);
  t('відхилений курс повернувся в чернетку', getCourse(c2b.id)?.status === 'draft', getCourse(c2b.id)?.status);
  const seen = await call('GET', `/api/courses/${c2b.id}`, 'u-teacher');
  t('автор бачить причину відмови', seen.body.moderation?.status === 'rejected' && seen.body.moderation?.reason === 'Немає ціни');

  console.log('\nБезкоштовний курс:');
  await call('PUT', `/api/courses/${c2.id}`, 'u-teacher', { free: true, priceMinor: 0 });
  await call('POST', `/api/courses/${c2.id}/publish`, 'u-teacher');
  const entry3 = (await call('GET', '/api/admin/moderation?status=pending', 'u-admin')).body.moderation.find((m: any) => m.itemId === c2.id).id;
  bridgeCalls.length = 0;
  const freeOk = await call('POST', `/api/admin/moderation/${entry3}/approve`, 'u-admin');
  const freeSent = bridgeCalls.find((c) => c.url.endsWith('/bridge/courses'))?.body ?? {};
  t('явно безкоштовний курс погоджується з ціною 0', freeOk.status === 200 && freeSent.priceMinor === 0, `${freeOk.status} ${freeSent.priceMinor}`);

  console.log('\nКатегорія при поданні:');
  const c5 = (await call('POST', '/api/courses', 'u-teacher', { title: 'Курс без категорії' })).body.course;
  await call('PUT', `/api/courses/${c5.id}`, 'u-teacher', { ...put1.body.course, id: undefined, title: 'Курс без категорії', priceMinor: 8000, categorySlug: '' });
  const noCatSub = await call('POST', `/api/courses/${c5.id}/publish`, 'u-teacher');
  t('вітрина віддала перелік → без категорії подати не можна', noCatSub.status === 400 && (noCatSub.body.problems || []).some((x: string) => /категорію/.test(x)), JSON.stringify(noCatSub.body.problems));
  await call('PUT', `/api/courses/${c5.id}`, 'u-teacher', { categorySlug: 'зниклий-розділ' });
  const staleSub = await call('POST', `/api/courses/${c5.id}/publish`, 'u-teacher');
  t('категорія, якої вже нема на вітрині → 400', staleSub.status === 400 && (staleSub.body.problems || []).some((x: string) => /більше не існує/.test(x)), JSON.stringify(staleSub.body.problems));
  await call('PUT', `/api/courses/${c5.id}`, 'u-teacher', { categorySlug: 'chpu' });
  const okSub = await call('POST', `/api/courses/${c5.id}/publish`, 'u-teacher');
  t('з існуючою категорією — подано', okSub.status === 200, JSON.stringify(okSub.body).slice(0, 120));

  for (const name of ['Курс для листа 2', 'Курс для листа 3']) {
    const cx = (await call('POST', '/api/courses', 'u-teacher', { title: name })).body.course;
    await call('PUT', `/api/courses/${cx.id}`, 'u-teacher', { ...put1.body.course, id: undefined, title: name, priceMinor: 8000, categorySlug: 'chpu' });
    await call('POST', `/api/courses/${cx.id}/publish`, 'u-teacher');
  }

  console.log('\nЛічильник черги:');
  const sum = await call('GET', '/api/admin/moderation/summary', 'u-admin');
  const pendingReal = (await call('GET', '/api/admin/moderation?status=pending', 'u-admin')).body.moderation.length;
  t('підсумок: pending збігається з довжиною черги', sum.status === 200 && sum.body.pending === pendingReal && sum.body.counts.pending === pendingReal, JSON.stringify(sum.body));
  t('підсумок: курси пораховано окремо', sum.body.pendingByType?.course === pendingReal, JSON.stringify(sum.body.pendingByType));
  t('підсумок: є й інші статуси', typeof sum.body.counts.approved === 'number' && sum.body.counts.rejected >= 1);
  const guestSum = await call('GET', '/api/admin/moderation/summary', 'u-teacher');
  t('підсумок — лише адміну', guestSum.status === 403 || guestSum.status === 401, String(guestSum.status));

  console.log('\nЛист автору про рішення:');
  await saveUser({ id: 'u-teacher', email: 'teacher@test.dev', name: 'Олена Коваль', role: 'writer', createdAt: new Date().toISOString() } as any);
  const mails: any[] = [];
  let mailOk = true;
  setModerationMailer(async (input) => {
    mails.push(input);
    return mailOk ? { ok: true } : { ok: false, error: 'SMTP не налаштовано' };
  });
  const queueNow = (await call('GET', '/api/admin/moderation?status=pending', 'u-admin')).body.moderation as any[];
  const [mA, mB, mC] = queueNow;
  const mApprove = await call('POST', `/api/admin/moderation/${mA.id}/approve`, 'u-admin');
  t('погодження → лист автору', mApprove.status === 200 && mApprove.body.notification?.sent === true && mails.at(-1)?.to === 'teacher@test.dev' && /Погоджено/.test(mails.at(-1)?.subject), JSON.stringify(mApprove.body.notification));
  const mChanges = await call('POST', `/api/admin/moderation/${mB.id}/request-changes`, 'u-admin', { note: 'Додайте <b>фото</b> & приклади' });
  t('зауваження → лист із текстом зауважень', mChanges.body.notification?.sent === true && /Додайте/.test(mails.at(-1)?.text) && /зауваженн/.test(mails.at(-1)?.subject));
  t('текст у HTML-листі екранований', /&lt;b&gt;фото&lt;\/b&gt; &amp; приклади/.test(mails.at(-1)?.html) && !/<b>/.test(mails.at(-1)?.html), mails.at(-1)?.html);
  mailOk = false;
  const mReject = await call('POST', `/api/admin/moderation/${mC.id}/reject`, 'u-admin', { reason: 'Не підходить' });
  t('збій листа не скасовує рішення', mReject.status === 200 && mReject.body.moderation?.status === 'rejected' && mReject.body.notification?.sent === false && /SMTP/.test(mReject.body.notification?.reason), JSON.stringify(mReject.body.notification));
  const mailsBefore = mails.length;
  await saveUser({ id: 'u-nomail', email: '', name: 'Без пошти', role: 'writer', createdAt: new Date().toISOString() } as any);
  const orphan = { id: 'x', itemType: 'course', itemId: 'x', title: 'T', authorId: 'u-nomail', status: 'pending', createdAt: '' } as any;
  const { notifyAuthorOfDecision } = await import('../server/moderationNotify.ts');
  const noMail = await notifyAuthorOfDecision(orphan, 'approved');
  const noUser = await notifyAuthorOfDecision({ ...orphan, authorId: 'нема-такого' }, 'approved');
  t('автор без пошти / без акаунта: не надіслано з причиною, без винятку', !noMail.sent && !!noMail.reason && !noUser.sent && !!noUser.reason && mails.length === mailsBefore, `${noMail.reason} / ${noUser.reason}`);
  setModerationMailer(null);
} finally {
  server.close();
  globalThis.fetch = realFetch;
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

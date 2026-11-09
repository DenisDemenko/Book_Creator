/**
 * Тести «Моїх робіт» на дашборді (журнал #532). Запуск: npm run test:my-works
 *
 * Справжній Express і справжня SQLite; перевіряється:
 *  1. Збір переліку: експрес-чернетки інструкцій, відновлювані інструкції з телефона, незавершені чернетки.
 *  2. Живі чернетки користувача (чужі й прострочені не потрапляють).
 *  3. Маршрути: доступ, «чужого» немає, відновлення інструкції з телефона і зв'язок із новою чернеткою.
 *  4. Презентаційні блоки дашборда (без мережі).
 */
const DIR = '/tmp/nova-my-works-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import express from 'express';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const dbMod = await import('../server/db');
const store = await import('../server/external/photoDraftStore');
const expressStore = await import('../server/expressStore');
const mapping = await import('../server/external/photoDraftMapping');
const mw = await import('../server/myWorksRoutes');
const storeMod = await import('../server/store');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

const NOW = '2026-11-09T18:00:00.000Z';
const photo = (i: number) => ({
  photoId: `p${i}`, clientId: `c${i}`, status: 'described' as const, order: i, takenAt: null, assetId: `as${i}`, mimeType: 'image/jpeg', modelId: null,
  description: `Кадр ${i} на верстаку.`, tags: [], error: null, createdAt: NOW, updatedAt: NOW,
});
function draft(id: string, over: Record<string, any> = {}): any {
  const photos = [photo(1), photo(2), photo(3)];
  return {
    id, ownerId: 'u-a', kind: 'instruction', status: 'written', revision: 3, title: 'Складання полиці', craft: 'меблі', audience: 'дорослі', level: 'beginner',
    instructionMode: 'assembly', modelCode: 'ПОЛ-120', bookId: null, photos, notes: [],
    structure: {
      modules: [{
        moduleId: 'm-1', title: 'Складання', summary: 'Збираємо каркас.', written: true,
        lessons: photos.map((p, i) => ({ lessonId: `l-${i + 1}`, title: `Крок ${i + 1}`, goal: null, photoIds: [p.photoId], body: `## Крок ${i + 1}\n\nРобимо крок ${i + 1}.`, topics: [], aiFields: ['title', 'body'] })),
      }],
    },
    assumptions: [], job: null, submitted: null, tokenId: null, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

// ---------------------------------------------------------------------------
console.log('\nЗбір переліку (чиста частина)');
{
  const ex = (id: string, over: Record<string, any> = {}) => ({
    id, userId: 'u-a', step: 1, revision: 1, createdAt: NOW, updatedAt: NOW, expiresAt: '2026-11-10T18:00:00.000Z',
    payload: { track: 'technical_instruction', technical: { title: 'Полиця', proposal: { steps: [{}, {}] } }, sourceMaterials: [{ assetId: 'a1', assetIds: ['a1', 'a2'] }, { assetId: 'a3' }] },
    ...over,
  }) as any;
  const submitted = draft('pd_1', { status: 'submitted', submitted: { kind: 'express', id: 'ex-live', studioUrl: '/express/ex-live' }, updatedAt: '2026-11-09T17:00:00.000Z' });
  const expired = draft('pd_2', { title: 'Лавка', status: 'submitted', submitted: { kind: 'express', id: 'ex-gone', studioUrl: '/express/ex-gone' }, updatedAt: '2026-11-09T16:00:00.000Z' });
  const working = draft('pd_3', { kind: 'course', status: 'structured', title: 'Курс з різьби' });
  const manuscript = draft('pd_4', { kind: 'manuscript', status: 'collecting', title: null, structure: null });
  const done = draft('pd_5', { kind: 'book', status: 'submitted', submitted: { kind: 'inbox', id: 'x', studioUrl: '/media?tab=inbox' } });
  const dead = draft('pd_6', { status: 'discarded' });
  const w = mw.buildMyWorks([ex('ex-live'), ex('ex-book', { payload: { track: 'book', seed: 'х' } })], [submitted, expired, working, manuscript, done, dead], 'https://gf.example');
  t('експрес-інструкція в переліку, книжкова чернетка — ні', w.instructions.filter((i) => i.origin === 'express').map((i) => i.id).join() === 'ex-live');
  t('кроки й кадри експрес-чернетки пораховано (кадри без повторів)', w.instructions[0].steps === 2 && w.instructions[0].frames === 3, JSON.stringify(w.instructions[0]));
  t('зв\'язок із чернеткою за фото, з якої її створено', w.instructions.find((i) => i.id === 'ex-live')!.phoneDraftId === 'pd_1');
  t('згасла експрес-чернетка → інструкцію з телефона можна відновити', w.instructions.some((i) => i.origin === 'phone' && i.id === 'pd_2' && i.steps === 3 && i.frames === 3 && i.expiresAt === null));
  t('жива експрес-чернетка не дублюється рядком із телефона', !w.instructions.some((i) => i.origin === 'phone' && i.id === 'pd_1'));
  t('інструкції — найновіші першими', w.instructions[0].updatedAt >= w.instructions[w.instructions.length - 1].updatedAt);
  t('незавершені чернетки з телефона: курс і рукопис (без назви — «Набір книги»)', w.phoneDrafts.map((d) => d.id).sort().join() === 'pd_3,pd_4' && w.phoneDrafts.find((d) => d.id === 'pd_4')!.title === 'Набір книги');
  t('відправлені й відкинуті — не в «чернетках»', !w.phoneDrafts.some((d) => ['pd_1', 'pd_2', 'pd_5', 'pd_6'].includes(d.id)));
  t('посилання на GrabFusion передано', w.grabfusionUrl === 'https://gf.example');
  t('без структури відновлювати нічого — рядка з телефона нема', !mw.buildMyWorks([], [draft('pd_7', { status: 'submitted', structure: null, submitted: { kind: 'express', id: 'zzz', studioUrl: '/express/zzz' } })], null).instructions.length);
  t('GRABFUSION_PUBLIC_URL: слеші прибрано, сміття відкинуто', mw.grabfusionPublicUrl({ GRABFUSION_PUBLIC_URL: ' https://gf.example/app/ ' } as any) === 'https://gf.example/app' && mw.grabfusionPublicUrl({ GRABFUSION_PUBLIC_URL: 'javascript:alert(1)' } as any) === null && mw.grabfusionPublicUrl({} as any) === null);
}

// ---------------------------------------------------------------------------
console.log('\nЖиві чернетки користувача (експрес-сховище)');
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', createdAt: NOW } as any);
await storeMod.saveUser({ id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', createdAt: NOW } as any);
{
  const stored = draft('pd_seed');
  const payload = mapping.toExpressPayload(stored);
  const mine = expressStore.createDraft('u-a', payload as any);
  const old = expressStore.createDraft('u-a', payload as any);
  const theirs = expressStore.createDraft('u-b', payload as any);
  dbMod.getDb()!.prepare('UPDATE express_drafts SET expires_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', old.id);
  const list = expressStore.listUserDrafts('u-a');
  t('у переліку лише живі чернетки цього користувача', list.length === 1 && list[0].id === mine.id && !list.some((d) => d.id === theirs.id || d.id === old.id));
  t('порожньо, коли чернеток немає', expressStore.listUserDrafts('nobody').length === 0);
  expressStore.deleteDraft(mine.id);
  expressStore.deleteDraft(theirs.id);
  expressStore.deleteDraft(old.id);
}

// ---------------------------------------------------------------------------
console.log('\nМаршрути');
const users: Record<string, any> = {
  'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', isGuest: false },
  'u-b': { id: 'u-b', email: 'b@test.ua', name: 'Інший', role: 'writer', isGuest: false },
};
const app = express();
app.use(express.json());
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : { id: null, email: 'guest@local', name: 'Гість', role: 'guest', isGuest: true };
  next();
});
mw.registerMyWorksRoutes(app);
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(method: string, p: string, session?: string) {
  const res = await fetch(base + p, { method, headers: session ? { 'x-test-session': session } : {} });
  return { status: res.status, data: (await res.json().catch(() => null)) as any };
}

await store.insertDraft(draft('pd_live', { submitted: { kind: 'express', id: 'ex-old', studioUrl: '/express/ex-old' }, status: 'submitted' }));
await store.insertDraft(draft('pd_open', { kind: 'course', status: 'structured', title: 'Курс' }));
await store.insertDraft(draft('pd_nostruct', { status: 'collecting', structure: null }));
await store.insertDraft(draft('pd_foreign', { ownerId: 'u-b', status: 'submitted', submitted: { kind: 'express', id: 'ex-zz', studioUrl: '/express/ex-zz' } }));

t('без входу — 401', (await call('GET', '/api/my-works')).status === 401);
{
  const a = await call('GET', '/api/my-works', 'u-a');
  t('перелік автора: відновлювана інструкція й чернетка курсу', a.status === 200 && a.data.instructions.some((i: any) => i.id === 'pd_live' && i.origin === 'phone') && a.data.phoneDrafts.some((d: any) => d.id === 'pd_open'), JSON.stringify(a.data));
  t('чужих робіт немає', !JSON.stringify(a.data).includes('pd_foreign'));
  const b = await call('GET', '/api/my-works', 'u-b');
  t('інший автор бачить лише своє', b.data.instructions.length === 1 && b.data.instructions[0].id === 'pd_foreign');
}
t('відновлення без входу — 401', (await call('POST', '/api/my-works/phone-drafts/pd_live/reopen-instruction')).status === 401);
t('чужу чернетку відновити не можна — 404', (await call('POST', '/api/my-works/phone-drafts/pd_live/reopen-instruction', 'u-b')).status === 404);
t('чернетка не-інструкція — 404', (await call('POST', '/api/my-works/phone-drafts/pd_open/reopen-instruction', 'u-a')).status === 404);
t('без структури — 404', (await call('POST', '/api/my-works/phone-drafts/pd_nostruct/reopen-instruction', 'u-a')).status === 404);
t('невідома чернетка — 404', (await call('POST', '/api/my-works/phone-drafts/pd_none/reopen-instruction', 'u-a')).status === 404);
{
  const before = (await store.getDraft('pd_live', 'u-a'))!;
  const r = await call('POST', '/api/my-works/phone-drafts/pd_live/reopen-instruction', 'u-a');
  t('відновлення — 200 і id нової експрес-чернетки', r.status === 200 && typeof r.data.draftId === 'string', JSON.stringify(r.data));
  const created = expressStore.getDraft(r.data.draftId);
  t('нова чернетка жива, належить автору й несе кадри та кроки', !!created && created.userId === 'u-a' && (created.payload.technical as any).proposal.steps.length === 3 && (created.payload.sourceMaterials as any[]).every((s) => s.assetIds?.length === 1));
  const after = (await store.getDraft('pd_live', 'u-a'))!;
  t('посилання «Відкрити в Studio» у чернетці за фото веде на нову', after.submitted?.id === r.data.draftId && after.submitted?.studioUrl === `/express/${r.data.draftId}` && after.status === 'submitted');
  t('ревізію чернетки за фото відновлення не змінює (це не правка викладача)', after.revision === before.revision);
  const list = await call('GET', '/api/my-works', 'u-a');
  const mine = list.data.instructions.filter((i: any) => i.id === r.data.draftId || i.id === 'pd_live');
  t('тепер це жива експрес-інструкція, а не рядок «відновити»', mine.length === 1 && mine[0].origin === 'express' && mine[0].phoneDraftId === 'pd_live', JSON.stringify(mine));
}
server.close();

// ---------------------------------------------------------------------------
console.log('\nБлоки дашборда');
{
  const { LanguageProvider } = await import('../src/i18n/LanguageContext');
  const blocks = await import('../src/components/MyWorksBlocks');
  const works = mw.buildMyWorks(
    [{ id: 'ex-1', userId: 'u-a', step: 1, revision: 1, createdAt: NOW, updatedAt: NOW, expiresAt: '2026-11-09T21:30:00.000Z', payload: { track: 'technical_instruction', technical: { title: 'Полиця', proposal: { steps: [{}, {}] } }, sourceMaterials: [{ assetId: 'a1', assetIds: ['a1', 'a2'] }] } } as any],
    [draft('pd_g', { status: 'submitted', title: 'Лавка', submitted: { kind: 'express', id: 'gone', studioUrl: '/express/gone' } }), draft('pd_h', { kind: 'manuscript', status: 'collecting', title: 'Глава 1', structure: null })],
    'https://gf.example'
  );
  const state = { works, courses: [blocks.toCourseBrief({ id: 'c1', title: 'Різьба для початківців', status: 'draft', updatedAt: NOW, modules: [{}, {}], origin: { kind: 'photo' } }, false), blocks.toCourseBrief({ id: 'c2', title: 'Чужий курс', status: 'published', updatedAt: NOW, modules: [] }, true)], coursesLocked: false, loading: false, error: null };
  const wrap = (el: React.ReactElement) => renderToStaticMarkup(React.createElement(LanguageProvider, null, el));
  const noop = () => undefined;
  const ins = wrap(React.createElement(blocks.InstructionsBlock, { state, localTitle: 'Мій стіл', restoringId: null, error: null, onOpenExpress: noop, onRestore: noop, onOpenLocal: noop, now: new Date('2026-11-09T12:00:00.000Z') }));
  t('інструкції: експрес-чернетка з кроками, кадрами й терміном', ins.includes('Полиця') && ins.includes('кроків: 2 · кадрів: 2') && ins.includes('діє до'));
  t('інструкції: відновлювана з телефона має «Відновити»', ins.includes('Лавка') && ins.includes('Відновити') && ins.includes('data-my-instruction="phone"'));
  t('інструкції: локальна з цього браузера', ins.includes('Мій стіл') && ins.includes('data-my-instruction="local"'));
  t('інструкції: пояснення про 24 години', ins.includes('24 години'));
  const empty = wrap(React.createElement(InstructionsBlockEmpty()));
  t('порожній перелік — підказка, а не порожнеча', empty.includes('data-my-works-empty'));
  const cs = wrap(React.createElement(blocks.CoursesBlock, { state, onOpenCourse: noop }));
  t('курси: назва, статус, модулі, позначка телефона й спільного', cs.includes('Різьба для початківців') && cs.includes('чернетка') && cs.includes('модулів: 2') && cs.includes('📱') && cs.includes('Чужий курс') && cs.includes('спільний') && cs.includes('опубліковано'));
  const locked = wrap(React.createElement(blocks.CoursesBlock, { state: { ...state, courses: [], coursesLocked: true }, onOpenCourse: noop }));
  t('курси: роль без права авторства бачить пояснення', locked.includes('data-my-works-locked') && locked.includes('експерти й викладачі'));
  const ph = wrap(React.createElement(blocks.PhoneDraftsBlock, { state }));
  t('чернетки з телефона: вид, статус, кадри й посилання на GrabFusion', ph.includes('Глава 1') && ph.includes('набір книги') && ph.includes('збір кадрів') && ph.includes('https://gf.example') && ph.includes('data-open-grabfusion'));
  const phNoUrl = wrap(React.createElement(blocks.PhoneDraftsBlock, { state: { ...state, works: { ...works, grabfusionUrl: null } } }));
  t('без адреси GrabFusion посилання не показуємо', !phNoUrl.includes('data-open-grabfusion'));
  t('whenLabel: сьогодні — лише час, інший день — з датою', /^\d{2}:\d{2}$/.test(blocks.whenLabel('2026-11-09T21:30:00.000Z', new Date('2026-11-09T10:00:00.000Z'))) && /^\d{2}\.\d{2}, \d{2}:\d{2}$/.test(blocks.whenLabel('2026-11-10T21:30:00.000Z', new Date('2026-11-09T10:00:00.000Z'))) && blocks.whenLabel('нісенітниця') === '');

  function InstructionsBlockEmpty() {
    return () => React.createElement(blocks.InstructionsBlock, { state: { ...state, works: { instructions: [], phoneDrafts: [], grabfusionUrl: null } }, localTitle: null, restoringId: null, error: null, onOpenExpress: noop, onRestore: noop, onOpenLocal: noop });
  }
}

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);

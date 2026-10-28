/**
 * Тести походження курсу (GrabFusion, A3). Запуск: npm run test:course-origin
 *
 * Курс, створений з чернетки за фото, пам'ятає це (`origin`) і те, що в ньому
 * написав ШІ та автор ще не правив. Перевіряємо:
 *  1. Чисті функції: приведення, «правка автора знімає позначку», урок зник.
 *  2. Сховище курсів: origin зберігається, правка уроку знімає позначку лише
 *     з правленого поля, підроблений origin із редактора не приймається.
 *  3. Відображення чернетки в курс: `body` → `description`, порожнє не позначається.
 */
const DIR = '/tmp/nova-course-origin-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const origin = await import('../server/courseOrigin');
const courses = await import('../server/courseStore');
const courseRoutes = await import('../server/courseRoutes');
const mapping = await import('../server/external/photoDraftMapping');
const storeMod = await import('../server/store');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

console.log('\nПриведення origin');
t('не схоже на origin — відкидається', origin.normalizeOrigin(null) === undefined && origin.normalizeOrigin({ kind: 'x', draftId: 'a' }) === undefined && origin.normalizeOrigin({ kind: 'photo-draft' }) === undefined);
const norm = origin.normalizeOrigin({
  kind: 'photo-draft',
  draftId: 'pd_1',
  createdAt: '2026-10-28T10:00:00.000Z',
  photoCount: 5.7,
  aiFields: { 'l-1': ['description', 'description', 'bogus', 'title'], 'l-2': ['nope'], 'l-3': 'не масив' },
  ai: { calls: '7', costUsd: -3 },
});
t('невідомі поля й порожні уроки прибрано, повтори злито', JSON.stringify(norm?.aiFields) === '{"l-1":["description","title"]}', JSON.stringify(norm?.aiFields));
t('числа приведено до розумних меж', norm?.photoCount === 6 && norm?.ai?.calls === 7 && norm?.ai?.costUsd === 0);

console.log('\nreconcileOrigin');
const o = (): import('../server/courseOrigin').CourseOrigin => ({
  kind: 'photo-draft',
  draftId: 'pd_1',
  createdAt: '2026-10-28T10:00:00.000Z',
  photoCount: 2,
  aiFields: { 'l-1': ['title', 'goal', 'description', 'topics'], 'l-2': ['description'] },
});
const mods = (over: Record<string, any> = {}) => [
  { lessons: [{ id: 'l-1', title: 'Розмітка', goal: 'Контур', description: '## Розмітка\n\nТекст', topics: ['а', 'б'], ...over }, { id: 'l-2', title: 'Чаша', description: 'Текст 2', topics: [] }] },
];
t('без змін — позначки лишаються', JSON.stringify(origin.reconcileOrigin(o(), mods(), mods())?.aiFields) === JSON.stringify(o().aiFields));
t('змінили текст — знімається лише description цього уроку', (() => {
  const r = origin.reconcileOrigin(o(), mods(), mods({ description: 'Мій текст' }))!;
  return r.aiFields['l-1'].join() === 'title,goal,topics' && r.aiFields['l-2'].join() === 'description';
})());
t('пробіли по краях — не правка', origin.reconcileOrigin(o(), mods(), mods({ description: '  ## Розмітка\n\nТекст \n' }))!.aiFields['l-1'].includes('description'));
t('змінили теми й мету — знімаються обидві', (() => {
  const r = origin.reconcileOrigin(o(), mods(), mods({ topics: ['а'], goal: 'Інша' }))!;
  return r.aiFields['l-1'].join() === 'title,description';
})());
t('урок прибрано — запис про нього зникає', !('l-2' in origin.reconcileOrigin(o(), mods(), [{ lessons: [mods()[0].lessons[0]] }])!.aiFields));
t('усі поля уроку правлені — запис зникає цілком', (() => {
  const r = origin.reconcileOrigin(o(), mods(), mods({ title: 'Нова', goal: 'Нова', description: 'Нова', topics: ['в'] }))!;
  return !('l-1' in r.aiFields) && 'l-2' in r.aiFields;
})());
t('вхідний origin не мутується', (() => {
  const src = o();
  origin.reconcileOrigin(src, mods(), mods({ description: 'інший' }));
  return src.aiFields['l-1'].includes('description');
})());
t('без origin — undefined', origin.reconcileOrigin(undefined, mods(), mods()) === undefined);
t('countAiFields', origin.countAiFields(o()) === 5 && origin.countAiFields(undefined) === 0);

console.log('\nСховище курсів');
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Викладачка', role: 'writer', createdAt: new Date().toISOString() } as any);
const input = {
  title: 'Курс за фото',
  origin: o(),
  modules: [
    {
      id: 'm-1',
      title: 'Модуль',
      skillIds: [],
      lessons: [
        { id: 'l-1', title: 'Розмітка', goal: 'Контур', description: '## Розмітка\n\nТекст', topics: ['а', 'б'], photoUrls: [] },
        { id: 'l-2', title: 'Чаша', description: 'Текст 2', topics: [], photoUrls: [] },
      ],
    },
  ],
};
const created = courses.createCourse('u-a', input as any);
t('origin зберігається й читається назад', JSON.stringify(courses.getCourse(created.id)?.origin?.aiFields) === JSON.stringify(o().aiFields) && courses.getCourse(created.id)?.origin?.draftId === 'pd_1');
t('кривий origin при створенні відкидається', courses.createCourse('u-a', { title: 'Звичайний', origin: { kind: 'x' } as any }).origin === undefined);

const edited = courses.getCourse(created.id)!;
edited.modules[0].lessons[0].description = 'Мій текст';
const saved = courses.updateCourse(created.id, { modules: edited.modules });
t('правка тексту уроку знімає позначку лише з нього', saved?.origin?.aiFields['l-1'].join() === 'title,goal,topics' && saved?.origin?.aiFields['l-2'].join() === 'description', JSON.stringify(saved?.origin?.aiFields));
t('і це лежить у сховищі, а не лише у відповіді', courses.getCourse(created.id)?.origin?.aiFields['l-1'].includes('description') === false);
const resave = courses.updateCourse(created.id, { title: 'Нова назва' });
t('правка іншого поля позначок не чіпає', JSON.stringify(resave?.origin?.aiFields) === JSON.stringify(saved?.origin?.aiFields));

console.log('\nПідробка з редактора');
const forged = courses.updateCourse(created.id, { origin: { ...o(), aiFields: { 'l-1': ['description'], 'l-9': ['title'] }, draftId: 'підроблено' } as any });
t('origin із запиту не приймається', forged?.origin?.draftId === 'pd_1' && !('l-9' in (forged?.origin?.aiFields ?? {})) && forged?.origin?.aiFields['l-1'].includes('description') === false);
const patch = courseRoutes.authorPatch({ title: 'X', origin: { kind: 'photo-draft', draftId: 'z' }, status: 'published' });
t('authorPatch вирізає origin (і далі status)', !('origin' in patch) && !('status' in patch) && patch.title === 'X');
const plain = courses.createCourse('u-a', { title: 'Власний' });
t('звичайний курс origin не отримує і після правки', courses.updateCourse(plain.id, { title: 'Власний 2' })?.origin === undefined);

console.log('\nВідображення чернетки в курс');
const draft: any = {
  id: 'pd_map',
  ownerId: 'u-a',
  kind: 'course',
  title: 'Ложка',
  craft: 'різьблення',
  audience: 'початківці',
  level: 'beginner',
  photos: [
    { photoId: 'p1', order: 1, assetId: 'as1' },
    { photoId: 'p2', order: 2, assetId: 'as2' },
  ],
  structure: {
    modules: [
      {
        moduleId: 'm-1',
        title: 'Підготовка',
        summary: null,
        written: true,
        lessons: [
          { lessonId: 'l-1', title: 'Розмітка', goal: 'Контур', photoIds: ['p1'], body: '## Розмітка', topics: ['а'], aiFields: ['title', 'goal', 'body', 'topics'] },
          { lessonId: 'l-2', title: 'Чаша', goal: null, photoIds: ['p2'], body: 'Мій текст', topics: [], aiFields: ['title', 'goal', 'topics'] },
        ],
      },
    ],
  },
};
const input2 = mapping.toCourseInput(draft, { at: '2026-10-28T12:00:00.000Z', ai: { calls: 3, costUsd: 0.0123 } });
t('origin: чернетка, час, кількість кадрів, витрати', input2.origin.draftId === 'pd_map' && input2.origin.createdAt === '2026-10-28T12:00:00.000Z' && input2.origin.photoCount === 2 && input2.origin.ai?.calls === 3);
t('body чернетки — це description курсу', input2.origin.aiFields['l-1'].join() === 'title,goal,description,topics', input2.origin.aiFields['l-1'].join());
t('порожнє поле й текст викладача не позначаються як ШІ', input2.origin.aiFields['l-2'].join() === 'title', input2.origin.aiFields['l-2'].join());
t('без даних про витрати — без ai', mapping.toCourseInput(draft, { at: 'x', ai: null }).origin.ai === undefined);
const round = courses.createCourse('u-a', input2 as any);
t('результат придатний для createCourse і читається назад', courses.getCourse(round.id)?.origin?.aiFields['l-1'].includes('description') === true && courses.getCourse(round.id)?.origin?.ai?.costUsd === 0.0123);

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);

/**
 * Тести «курсу зі скану документа» (GrabFusion, контракт 1.6.0, журнал #548). Запуск: npm run test:course-document
 *
 * Чернетка `kind: course` з `courseSource: document`: фото чи скани документа (друкований або рукописний текст) →
 * дослівне розпізнавання сторінок (як у рукописі) → модулі й уроки з цього тексту → курс у Studio з полями
 * `summary`, `outcomes`, уроками (`description` із тексту). Курс із кадрів майстер-класу (`photos`) лишається як був.
 *  1. Чисті функції: промпти, розбір структури, блокери, відображення в курс.
 *  2. Повний шлях через HTTP: створення, сторінки, правка тексту, «Розкласти», «Написати», відправка.
 */
const DIR = '/tmp/nova-course-document-test';
process.env.DATA_DIR = DIR;
process.env.DATABASE_PATH = `${DIR}/nova-studio.db`;

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import Ajv from 'ajv';

fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });

const db = await import('../server/db');
await db.initDb();
const xroutes = await import('../server/external/externalApiRoutes');
const routes = await import('../server/external/photoDraftRoutes');
const passes = await import('../server/external/photoDraftPasses');
const mapping = await import('../server/external/photoDraftMapping');
const sinks = await import('../server/external/photoDraftSinks');
const contract = await import('../shared/photoDraftContract');
const courseStore = await import('../server/courseStore');
const storeMod = await import('../server/store');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/photo-drafts-api/schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(schema, 'pd');
const conforms = (def: string, data: unknown) => {
  const fn = ajv.getSchema(`pd#/definitions/${def}`)!;
  return fn(data) ? '' : ajv.errorsText(fn.errors);
};

// ---------------------------------------------------------------------------
console.log('\nЧисті функції: що вважається сторінками тексту');
t('рукопис — сторінки тексту', contract.hasPageText({ kind: 'manuscript' }));
t('курс зі скану документа — сторінки тексту', contract.hasPageText({ kind: 'course', courseSource: 'document' }));
t('курс з кадрів і курс без джерела — ні', !contract.hasPageText({ kind: 'course', courseSource: 'photos' }) && !contract.hasPageText({ kind: 'course' }) && !contract.hasPageText({ kind: 'course', courseSource: null }));
t('інструкція й книга — ні, навіть якщо хтось передав джерело', !contract.hasPageText({ kind: 'instruction', courseSource: 'document' }) && !contract.hasPageText({ kind: 'book', courseSource: 'document' }));
t('джерела курсу: photos, document', JSON.stringify(contract.PHOTO_DRAFT_COURSE_SOURCES) === JSON.stringify(['photos', 'document']));

console.log('\nПромпти');
const sysDoc = passes.structureSystemInstruction('course', null, 'document');
const sysPhotos = passes.structureSystemInstruction('course', null, 'photos');
const sysInstr = passes.structureSystemInstruction('instruction', 'assembly');
t('документ: редактор з тексту сканів, а не з кадрів', /розпізнаного тексту сканів документа/.test(sysDoc) && !/кадрів, зроблених майстром/.test(sysDoc));
t('документ: текст — ДАНІ, вигадувати заборонено', /ДАНІ/.test(sysDoc) && /ЛИШЕ зміст документа/.test(sysDoc) && /Не додавай фактів/.test(sysDoc));
t('документ: у відповіді є summary й outcomes, id СТОРІНОК', /"summary"/.test(sysDoc) && /"outcomes"/.test(sysDoc) && /id СТОРІНОК/.test(sysDoc));
t('курс з кадрів: теж просить summary й outcomes, але про кадри', /"summary"/.test(sysPhotos) && /"outcomes"/.test(sysPhotos) && /id кадрів/.test(sysPhotos) && /кадрів, зроблених майстром/.test(sysPhotos));
t('курс без джерела поводиться як з кадрів', passes.structureSystemInstruction('course') === sysPhotos);
t('інструкція не змінилась: без summary й outcomes', !/"outcomes"/.test(sysInstr) && !/"summary":"1–2 речення/.test(sysInstr));
const genDoc = passes.generateSystemInstruction('course', null, 'document');
t('текст уроку з документа: основа — текст сторінок, фактів не додавати', /Основа кожного уроку — текст його сторінок/.test(genDoc) && /НЕ додавай фактів/.test(genDoc) && /ДАНІ/.test(genDoc));
t('текст уроку курсу з кадрів без змін', !/Основа кожного уроку/.test(passes.generateSystemInstruction('course', null, 'photos')));

const longText = 'а'.repeat(3000);
const pg = (n: number, text: string, over: Record<string, unknown> = {}) => ({ photoId: `ph_${n}`, order: n, status: 'described', description: null, tags: [], text, ...over });
const docDraft: any = {
  kind: 'course',
  courseSource: 'document',
  title: 'Безпека',
  craft: null,
  audience: null,
  level: null,
  bookId: null,
  photos: [pg(1, longText), pg(2, 'Друга сторінка.')],
  notes: [{ noteId: 'n1', photoIds: ['ph_2'], text: 'Це розділ про окуляри', updatedAt: 'x' }],
  structure: null,
  assumptions: [],
};
const sp = passes.buildStructurePrompt(docDraft);
t('структура: «Сторінки документа», а не «Кадри»', /Сторінки документа \(за порядком\):/.test(sp) && !/Кадри \(за порядком зйомки\)/.test(sp));
t('структура: тексти сторінок іде між <<< і >>>', /Сторінка ph_1 \(№1\)\nТекст сторінки: <<</.test(sp) && /Текст сторінки: <<<Друга сторінка\.>>>/.test(sp));
t('структура: довга сторінка обрізається до початку', sp.includes('а'.repeat(passes.PAGE_TEXT_IN_STRUCTURE)) && !sp.includes('а'.repeat(passes.PAGE_TEXT_IN_STRUCTURE + 1)));
t('структура: слова викладача лишаються', /Слова викладача: <<<Це розділ про окуляри>>>/.test(sp));
const gp = passes.buildGeneratePrompt({ ...docDraft }, { moduleId: 'm-1', title: 'Модуль', summary: null, written: false, lessons: [{ lessonId: 'l-1', title: 'Урок', goal: null, photoIds: ['ph_1'], body: null, topics: [], aiFields: [] }] });
t('текст уроку: сторінка іде цілою', gp.includes(longText) && /Текст сторінки: <<</.test(gp));
const emptyPage = passes.buildStructurePrompt({ ...docDraft, photos: [pg(1, '   ')] });
t('порожня сторінка в промпті позначена', /\(тексту немає\)/.test(emptyPage));
t('курс з кадрів: промпт як і був (описи кадрів)', /Опис кадру: <<</.test(passes.buildStructurePrompt({ ...docDraft, courseSource: 'photos', photos: [{ ...pg(1, ''), description: 'Заготовка.', text: undefined }] })));

console.log('\nРозбір відповіді «Розкласти»');
const photosIn = [{ photoId: 'ph_1', order: 1 }, { photoId: 'ph_2', order: 2 }];
const parsed = passes.parseStructureResult(
  JSON.stringify({
    title: 'Курс',
    summary: '  Про безпеку   і першу допомогу. ',
    outcomes: ['Перевіряти шнур', 'Перевіряти шнур', 'Діяти при порізі', 5, ''],
    modules: [{ title: 'М1', lessons: [{ title: 'У1', photoIds: ['ph_1', 'ph_2'] }] }],
  }),
  photosIn
);
t('summary чиститься від зайвих пробілів', parsed.summary === 'Про безпеку і першу допомогу.', String(parsed.summary));
t('outcomes: без повторів, не-рядків і порожніх', JSON.stringify(parsed.outcomes) === JSON.stringify(['Перевіряти шнур', 'Діяти при порізі']));
const noExtras = passes.parseStructureResult(JSON.stringify({ modules: [{ title: 'М', lessons: [{ title: 'У', photoIds: ['ph_1'] }] }] }), photosIn);
t('без summary й outcomes — null й []', noExtras.summary === null && noExtras.outcomes.length === 0);
const manyOutcomes = passes.parseStructureResult(JSON.stringify({ outcomes: Array.from({ length: 20 }, (_, i) => `Результат ${i}`), modules: [{ title: 'М', lessons: [{ title: 'У', photoIds: ['ph_1'] }] }] }), photosIn);
t('outcomes — не більше 8', manyOutcomes.outcomes.length === 8);

console.log('\nБлокери відправки');
const kinds = (d: any) => passes.computeSubmitBlockers(d, {}).map((b) => b.kind);
const structured = {
  modules: [{ moduleId: 'm-1', title: 'М', summary: null, written: true, lessons: [{ lessonId: 'l-1', title: 'У', goal: null, photoIds: ['ph_1'], body: 'Текст', topics: [], aiFields: [] }] }],
};
t('готовий курс зі скану — без блокерів', kinds({ ...docDraft, photos: [pg(1, 'Текст.')], structure: structured }).length === 0);
t('сторінка без тексту — empty_page з photoId', (() => {
  const b = passes.computeSubmitBlockers({ ...docDraft, photos: [pg(1, 'Текст.'), pg(2, '  ')], structure: structured } as any, {});
  return b.length === 1 && b[0].kind === 'empty_page' && b[0].photoId === 'ph_2';
})());
t('курс з кадрів: порожнього тексту не вимагає', kinds({ ...docDraft, courseSource: 'photos', photos: [pg(1, '')], structure: structured }).length === 0);

console.log('\nВідображення в курс Studio');
const stored = (over: Record<string, unknown> = {}): any => ({
  id: 'pd_x',
  ownerId: 'u-a',
  kind: 'course',
  status: 'written',
  title: 'Безпека',
  craft: 'ремонт',
  audience: 'новачки',
  level: 'beginner',
  courseSource: 'document',
  bookId: null,
  photos: [
    { photoId: 'ph_1', order: 1, status: 'described', assetId: 'as1', text: 'Текст 1', description: null, tags: [] },
    { photoId: 'ph_2', order: 2, status: 'described', assetId: 'as2', text: 'Текст 2', description: null, tags: [] },
  ],
  notes: [],
  structure: {
    summary: 'Про безпеку.',
    outcomes: ['Перевіряти шнур', 'Діяти при порізі'],
    modules: [{ moduleId: 'm-1', title: 'М', summary: null, written: true, lessons: [{ lessonId: 'l-1', title: 'У', goal: 'Мета', photoIds: ['ph_1', 'ph_2'], body: 'Текст уроку', topics: ['т'], aiFields: ['title', 'body'] }] }],
  },
  assumptions: [],
  ...over,
});
const docInput = mapping.toCourseInput(stored(), { at: '2026-11-11T10:00:00.000Z' });
t('документ: summary і outcomes з ШІ', docInput.summary === 'Про безпеку.' && JSON.stringify(docInput.outcomes) === JSON.stringify(['Перевіряти шнур', 'Діяти при порізі']));
t('документ: без обкладинки й фото в уроках', docInput.coverUrl === undefined && docInput.modules[0].lessons[0].photoUrls.length === 0);
t('документ: текст уроку — description, мета й теми на місці', docInput.modules[0].lessons[0].description === 'Текст уроку' && docInput.modules[0].lessons[0].goal === 'Мета' && docInput.modules[0].lessons[0].topics[0] === 'т');
t('документ: origin рахує сторінки й поля ШІ', docInput.origin.photoCount === 2 && [...docInput.origin.aiFields['l-1']].sort().join() === 'description,title');
const photosInput = mapping.toCourseInput(stored({ courseSource: 'photos', structure: { modules: stored().structure.modules } }), { at: '2026-11-11T10:00:00.000Z' });
t('кадри: обкладинка з першого кадру й фото в уроці — як і було', !!photosInput.coverUrl && photosInput.modules[0].lessons[0].photoUrls.length === 2);
t('кадри без ШІ-полів: summary з ремесла й рівня, outcomes немає', photosInput.summary === 'ремонт. Рівень: початківці' && photosInput.outcomes === undefined, String(photosInput.summary));
const legacy = mapping.toCourseInput(stored({ courseSource: undefined, structure: { modules: stored().structure.modules } }), { at: '2026-11-11T10:00:00.000Z' });
t('стара чернетка без courseSource — як з кадрів', !!legacy.coverUrl && legacy.modules[0].lessons[0].photoUrls.length === 2);

// ---------------------------------------------------------------------------
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', createdAt: new Date().toISOString() } as any);
const users: Record<string, any> = { 'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Авторка', role: 'writer', isGuest: false } };
const tasks: Array<() => Promise<void>> = [];
const flush = async () => {
  while (tasks.length) await tasks.shift()!();
};
const seen = { recognize: [] as any[], describe: 0, write: [] as any[] };
let recognizeImpl: (p: any) => Promise<{ text: string; modelId: string }> = async () => ({ text: 'x', modelId: 'm' });

/** Підставна модель: з промпту бере id сторінок (прохід 2) або уроків (прохід 3) і ПОВТОРЮЄ текст сторінок у тілі уроку. */
const fakeWrite = async (p: any) => {
  seen.write.push({ system: p.system, prompt: p.prompt });
  if (/Сторінки документа \(за порядком\)/.test(p.prompt)) {
    const ids = [...p.prompt.matchAll(/Сторінка (ph_\w+)/g)].map((m: any) => m[1] as string);
    const half = Math.ceil(ids.length / 2);
    return {
      text: JSON.stringify({
        title: 'Безпечна робота з електроінструментом',
        summary: 'Короткий курс про безпеку під час роботи з електроінструментом.',
        outcomes: ['Перевіряти інструмент перед роботою', 'Користуватися захисним спорядженням'],
        modules: [
          { title: 'Підготовка', summary: 'Інструмент і заготовка.', lessons: [{ title: 'Перевірка', goal: 'Що перевірити', photoIds: ids.slice(0, half), topics: ['шнур'] }] },
          ...(ids.length > half ? [{ title: 'Захист', summary: null, lessons: [{ title: 'Окуляри', photoIds: ids.slice(half), topics: ['окуляри'] }] }] : []),
        ],
        assumptions: [{ text: 'Номер телефону в тексті не вказано', photoId: ids[ids.length - 1] }],
      }),
      modelId: 'test-text',
    };
  }
  const lessons = [...p.prompt.matchAll(/=== Урок (l-\d+): <<<([^>]*)>>>([\s\S]*?)(?==== Урок |$)/g)].map((m: any) => ({ id: m[1] as string, title: m[2] as string, block: m[3] as string }));
  return {
    text: JSON.stringify({
      lessons: lessons.map((l) => ({
        lessonId: l.id,
        goal: `Мета: ${l.title}`,
        body: `## ${l.title}\n\n${[...l.block.matchAll(/Текст сторінки: <<<([\s\S]*?)>>>/g)].map((m) => m[1]).join('\n\n')}`,
        topics: ['тема'],
      })),
      assumptions: [],
    }),
    modelId: 'test-text',
  };
};

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use((req: any, _res, next) => {
  const u = req.headers['x-test-session'];
  req.principal = typeof u === 'string' && users[u] ? users[u] : { id: null, role: 'guest', isGuest: true };
  next();
});
xroutes.registerExternalApiRoutes(app, { recognize: async () => ({ text: 'x', modelId: 'm' }), schedule: () => undefined });
routes.registerPhotoDraftRoutes(app, {
  describe: async () => {
    seen.describe++;
    return { description: 'Кадр.', tags: [], modelId: 'v' };
  },
  recognize: async (p) => {
    seen.recognize.push({ note: p.note, bookId: p.bookId, draftId: p.draftId });
    return recognizeImpl(p);
  },
  checkAiBudget: async () => ({ allowed: true }),
  writeText: fakeWrite,
  sinks: { createCourse: sinks.createCourseDraft, createExpress: sinks.createExpressInstruction, createInboxScans: sinks.createInboxScans },
  schedule: (task) => {
    tasks.push(task);
  },
});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(method: string, p: string, opts: { token?: string; session?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(baseUrl + p, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  return { status: res.status, data: (await res.json()) as any };
}
const errs: string[] = [];
const ok = (r: { data: any }, def: string) => {
  const bad = conforms(def, r.data);
  if (bad) errs.push(`${def}: ${bad}`);
  return !bad;
};
const PD = '/api/external/v1/photo-drafts';
const code = await call('POST', '/api/external-tokens/pairing-code', { session: 'u-a', body: { scope: 'photo-drafts' } });
const grab: string = (await call('POST', '/api/external/v1/pair', { body: { code: code.data.code } })).data.token;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const image = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
const get = async (id: string) => (await call('GET', `${PD}/${id}`, { token: grab })).data.draft;
const addPage = (id: string, n: number | string, extra: Record<string, unknown> = {}) => call('POST', `${PD}/${id}/photos`, { token: grab, body: { clientId: `cd-${id}-${n}`, image, ...extra } });

console.log('\nСтворення');
const created = await call('POST', PD, { token: grab, body: { kind: 'course', courseSource: 'document', title: 'Безпечна робота', audience: 'майстри-початківці' } });
const id: string = created.data.draft.draftId;
t('курс зі скану документа — 201, courseSource у відповіді, за схемою', created.status === 201 && created.data.draft.courseSource === 'document' && ok(created, 'DraftResponse'));
const plainCourse = await call('POST', PD, { token: grab, body: { kind: 'course', title: 'З кадрів' } });
t('курс без джерела — courseSource: photos', plainCourse.status === 201 && plainCourse.data.draft.courseSource === 'photos');
const instr = await call('POST', PD, { token: grab, body: { kind: 'instruction', title: 'Інструкція' } });
t('у інших видів поля courseSource у відповіді немає', instr.data.draft.courseSource === undefined);
t('courseSource у інструкції — 400', (await call('POST', PD, { token: grab, body: { kind: 'instruction', courseSource: 'document' } })).data.kind === 'bad_input');
t('невідоме джерело — 400', (await call('POST', PD, { token: grab, body: { kind: 'course', courseSource: 'video' } })).data.kind === 'bad_input');
const listed = await call('GET', PD, { token: grab });
t('перелік чернеток несе courseSource курсів, за схемою', listed.data.drafts.find((d: any) => d.draftId === id)?.courseSource === 'document' && listed.data.drafts.find((d: any) => d.draftId === instr.data.draft.draftId)?.courseSource === undefined && ok(listed, 'DraftListResponse'));

console.log('\nСторінки: розпізнавання замість опису');
recognizeImpl = async (p) => ({
  text: p.draftId ? '```\nПРАВИЛА БЕЗПЕКИ\n\n\n\n1. Перевірте шнур.\n```' : '',
  modelId: 'test-vision',
});
const p1 = await addPage(id, 1, { note: 'Це машинописна сторінка' });
t('сторінка — 202, text: null і textEdited: false, за схемою', p1.status === 202 && p1.data.photo.text === null && p1.data.photo.textEdited === false && ok(p1, 'PhotoResponse'));
await flush();
let d = await get(id);
t('розпізнавання викликано з підказкою, а опис кадру — ні', seen.recognize.length === 1 && seen.recognize[0].note === 'Це машинописна сторінка' && seen.recognize[0].bookId === '' && seen.describe === 0);
t('текст сторінки очищено від огорожі й зайвих порожніх рядків', d.photos[0].status === 'described' && d.photos[0].text === 'ПРАВИЛА БЕЗПЕКИ\n\n1. Перевірте шнур.', JSON.stringify(d.photos[0].text));
t('опису й міток немає', d.photos[0].description === null && d.photos[0].tags.length === 0);
recognizeImpl = async () => ({ text: '3. Надягніть захисні окуляри.', modelId: 'test-vision' });
await addPage(id, 2);
await flush();
const crsPhoto = await addPage(plainCourse.data.draft.draftId, 1);
await flush();
const photoDraft = await get(plainCourse.data.draft.draftId);
t('курс з кадрів: описується, а не розпізнається; поля text немає', seen.describe === 1 && photoDraft.photos[0].description === 'Кадр.' && photoDraft.photos[0].text === undefined && crsPhoto.status === 202);
d = await get(id);
const pageId = d.photos[0].photoId;
const edited = await call('PUT', `${PD}/${id}/photos/${pageId}/text`, { token: grab, body: { text: 'ПРАВИЛА БЕЗПЕЧНОЇ РОБОТИ\n\n1. Перевірте шнур і вилку.' } });
t('правка тексту сторінки курсу — 200, textEdited: true', edited.status === 200 && edited.data.photo.textEdited === true && edited.data.photo.text.startsWith('ПРАВИЛА БЕЗПЕЧНОЇ') && ok(edited, 'PhotoResponse'));
const editPhotos = await call('PUT', `${PD}/${plainCourse.data.draft.draftId}/photos/${photoDraft.photos[0].photoId}/text`, { token: grab, body: { text: 'Х' } });
t('правка тексту курсу з кадрів — 409 wrong_status', editPhotos.status === 409 && editPhotos.data.kind === 'wrong_status');

console.log('\nБлокери: порожня сторінка');
recognizeImpl = async () => ({ text: '', modelId: 'test-vision' });
const emptyDraft = (await call('POST', PD, { token: grab, body: { kind: 'course', courseSource: 'document', title: 'Порожній' } })).data.draft.draftId;
await addPage(emptyDraft, 1);
await flush();
const emptyStruct = await call('POST', `${PD}/${emptyDraft}/structure`, { token: grab });
await flush();
const emptyD = await get(emptyDraft);
const emptySubmit = await call('POST', `${PD}/${emptyDraft}/submit`, { token: grab });
t('відправка сторінки без тексту — 400 submit_blocked з empty_page', emptySubmit.status === 400 && emptySubmit.data.kind === 'submit_blocked' && emptySubmit.data.blockers.some((b: any) => b.kind === 'empty_page'), JSON.stringify(emptySubmit.data).slice(0, 200));
t('«Розкласти» для порожньої сторінки не падає зі статусом, структуру ще не відправлено', emptyStruct.status === 202 && emptyD.status !== 'submitted');

console.log('\n«Розкласти» і «Написати» з тексту сторінок');
const s1 = await call('POST', `${PD}/${id}/structure`, { token: grab });
await flush();
d = await get(id);
t('«Розкласти» — 202; структура з модулями й заголовком', s1.status === 202 && d.status === 'structured' && d.structure.modules.length === 2 && d.title === 'Безпечна робота');
const sc = seen.write[seen.write.length - 1];
t('моделі пішов документний промпт із текстом сторінок', /розпізнаного тексту сканів документа/.test(sc.system) && sc.prompt.includes('ПРАВИЛА БЕЗПЕЧНОЇ РОБОТИ') && sc.prompt.includes('3. Надягніть захисні окуляри.') && /Слова викладача: <<<Це машинописна сторінка>>>/.test(sc.prompt));
t('summary і outcomes від ШІ збережено в структурі', d.structure.summary === 'Короткий курс про безпеку під час роботи з електроінструментом.' && d.structure.outcomes.length === 2 && ok({ data: { draft: d } }, 'DraftResponse'));
t('припущення ШІ чекає підтвердження', d.assumptions.length === 1 && d.assumptions[0].status === 'open');

// правка структури застосунком (лише модулі) не стирає summary/outcomes
const patchStruct = await call('PATCH', `${PD}/${id}`, { token: grab, body: { ifRevision: d.revision, structure: { modules: d.structure.modules } } });
t('PATCH структури без summary/outcomes не стирає їх', patchStruct.status === 200 && patchStruct.data.draft.structure.summary === d.structure.summary && patchStruct.data.draft.structure.outcomes.length === 2);
const patchSummary = await call('PATCH', `${PD}/${id}`, { token: grab, body: { ifRevision: patchStruct.data.draft.revision, structure: { modules: d.structure.modules, summary: 'Мій опис курсу.', outcomes: ['Один результат'] } } });
t('PATCH структури з summary/outcomes — правка автора', patchSummary.status === 200 && patchSummary.data.draft.structure.summary === 'Мій опис курсу.' && JSON.stringify(patchSummary.data.draft.structure.outcomes) === JSON.stringify(['Один результат']));
// повертаємо опис від ШІ, щоб перевірити відображення нижче
await call('PATCH', `${PD}/${id}`, { token: grab, body: { ifRevision: patchSummary.data.draft.revision, structure: { modules: d.structure.modules, summary: d.structure.summary, outcomes: d.structure.outcomes } } });

d = await get(id);
for (const m of d.structure.modules) {
  await call('POST', `${PD}/${id}/modules/${m.moduleId}/generate`, { token: grab });
  await flush();
}
d = await get(id);
const gen = seen.write[seen.write.length - 1];
t('«Написати» — документний промпт з повним текстом уроку', /перетворює розпізнаний текст документа на уроки/.test(gen.system) && /Текст сторінки: <<</.test(gen.prompt));
t('усі модулі написані, статус written', d.status === 'written' && d.structure.modules.every((m: any) => m.written));
t('тіло уроку виросло з тексту сторінки', d.structure.modules[0].lessons[0].body.includes('ПРАВИЛА БЕЗПЕЧНОЇ РОБОТИ') && d.structure.modules[1].lessons[0].body.includes('3. Надягніть захисні окуляри.'));

console.log('\nВідправка в «Курси»');
const open = await call('POST', `${PD}/${id}/submit`, { token: grab });
t('відкрите припущення блокує відправку', open.status === 400 && open.data.blockers.some((b: any) => b.kind === 'open_assumptions'));
await call('PATCH', `${PD}/${id}`, { token: grab, body: { ifRevision: (await get(id)).revision, assumptions: [{ assumptionId: 'as-1', status: 'confirmed' }] } });
const sub = await call('POST', `${PD}/${id}/submit`, { token: grab });
t('відправка — 201, ціль course, за схемою', sub.status === 201 && sub.data.target.kind === 'course' && ok(sub, 'SubmitResponse'), JSON.stringify(sub.data).slice(0, 200));
const course: any = courseStore.getCourse(sub.data.target.id);
t('курс створено чернеткою автора, studioUrl веде на нього', !!course && course.status === 'draft' && course.ownerId === 'u-a' && sub.data.target.studioUrl === `/courses/${course.id}`);
t('поля курсу: назва, summary, outcomes, аудиторія', course.title === 'Безпечна робота' && course.summary === 'Короткий курс про безпеку під час роботи з електроінструментом.' && course.outcomes.length === 2 && course.audience[0] === 'майстри-початківці');
t('модулі й уроки: назва, мета, теми, текст уроку з документа', course.modules.length === 2 && course.modules[0].lessons[0].title === 'Перевірка' && course.modules[0].lessons[0].goal === 'Мета: Перевірка' && course.modules[0].lessons[0].topics[0] === 'тема' && course.modules[0].lessons[0].description.includes('ПРАВИЛА БЕЗПЕЧНОЇ РОБОТИ'));
t('скани не стали ні обкладинкою, ні фото уроків', !course.coverUrl && course.modules.every((m: any) => m.lessons.every((l: any) => l.photoUrls.length === 0)));
t('походження: чернетка, 2 сторінки, поля ШІ в уроках', course.origin?.draftId === id && course.origin.photoCount === 2 && Object.keys(course.origin.aiFields).length === 2);

await new Promise((r) => server.close(r));
(server as any).closeAllConnections?.();
db.closeDb();
console.log(`\n${pass} пройдено, ${fail} не пройдено${errs.length ? `\nЗа схемою: ${errs.slice(0, 5).join(' | ')}` : ''}`);
process.exitCode = fail || errs.length ? 1 : 0;

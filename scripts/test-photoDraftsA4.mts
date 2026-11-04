/**
 * Тести режиму «Інструкція» чернеток за фото (GrabFusion, A4 / етап 5).
 * Запуск: npm run test:photo-drafts-a4
 *
 * Кадри інструкції стають чернеткою майстра «Інструкція з фото й техдокументації»
 * Studio вже з готовою пропозицією кроків: кожен крок — на власному джерелі з
 * кадром, поля кроку (деталі, інструменти, увага, результат) розібрано з тексту.
 *  1. Режим складання / користування: поле чернетки, промпти трьох проходів.
 *  2. parseStepBody і відображення в пропозицію; межі майстра (20 джерел, 60 кроків).
 *  3. Пропозиція проходить ту саму перевірку, що й відповідь моделі в майстрі
 *     (parseTechnicalProposal) і валідацію чернетки експресу.
 *  4. Повний шлях через HTTP: створення, правка режиму, проходи, submit.
 */
const DIR = '/tmp/nova-photo-drafts-a4-test';
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
const prompts = await import('../server/external/photoDraftPrompts');
const passes = await import('../server/external/photoDraftPasses');
const mapping = await import('../server/external/photoDraftMapping');
const sinks = await import('../server/external/photoDraftSinks');
const technical = await import('../server/technicalInstruction');
const wizard = await import('../server/wizardValidation');
const expressStore = await import('../server/expressStore');
const contract = await import('../shared/photoDraftContract');
const storeMod = await import('../server/store');

let pass = 0;
let fail = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e && !c ? ' — ' + e : ''}`);
};
const throws = (fn: () => unknown) => {
  try {
    fn();
    return '';
  } catch (e) {
    return String((e as Error).message);
  }
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
console.log('\nПромпти режиму');
const asm = prompts.buildDescribePrompt({ kind: 'instruction', instructionMode: 'assembly' });
const opr = prompts.buildDescribePrompt({ kind: 'instruction', instructionMode: 'operation' });
t('складання: кадр етапу складання, деталі й кріплення', /етапу складання/.test(asm) && /кріплення/.test(asm));
t('користування: орган керування, дія користувача', /користування виробом/.test(opr) && /орган керування/.test(opr));
t('режим не підмішується в курс', !/складання/.test(prompts.buildDescribePrompt({ kind: 'course', instructionMode: 'assembly' })));
t('без режиму — загальний опис інструкції', /технічної інструкції/.test(prompts.buildDescribePrompt({ kind: 'instruction' })));
t('структура інструкції: режим і межа кроків', (() => {
  const s = passes.structureSystemInstruction('instruction', 'operation');
  return /користування готовим виробом/.test(s) && s.includes(`не більше ${passes.INSTRUCTION_MAX_STEPS} кроків`) && /крок інструкції/.test(s);
})());
t('структура курсу — без межі кроків і режиму', !/не більше 20 кроків/.test(passes.structureSystemInstruction('course', 'assembly')));
t('текст кроку: підписані рядки Деталі / Інструменти / Увага / Результат кроку', (() => {
  const s = passes.generateSystemInstruction('instruction', 'assembly');
  return passes.STEP_LABELS.every((l) => s.includes(`**${l}:**`)) && /складання виробу/.test(s);
})());
t('текст уроку курсу — без підписаних рядків', !/\*\*Деталі:\*\*/.test(passes.generateSystemInstruction('course')));

console.log('\nМежа кроків у розборі');
const ph = Array.from({ length: 30 }, (_, i) => ({ photoId: `p${i + 1}`, order: i + 1 }));
const raw30 = JSON.stringify({
  modules: [{ title: 'Складання', lessons: ph.map((p, i) => ({ title: `Крок ${i + 1}`, photoIds: [p.photoId] })) }],
});
const capped = passes.parseStructureResult(raw30, ph, { maxLessons: passes.INSTRUCTION_MAX_STEPS });
const capIds = capped.modules.flatMap((m) => m.lessons.flatMap((l) => l.photoIds));
t('30 кроків від моделі → 20, кадри не губляться', capped.modules.flatMap((m) => m.lessons).length === 20 && capIds.length === 30 && new Set(capIds).size === 30);
t('без межі (курс) — усі 30', passes.parseStructureResult(raw30, ph).modules[0].lessons.length === 30);

// ---------------------------------------------------------------------------
console.log('\nparseStepBody');
const body = '## Закріплюємо ніжку\n\nВставте ніжку в паз до упору.\n\n**Деталі:** ніжка 4 шт\n**Інструменти:** молоток; киянка\n**Увага:** не бити по торцю\n**Результат кроку:** ніжка не хитається';
const sb = mapping.parseStepBody(body, 'Закріплюємо ніжку');
t('заголовок відкидається, опис — решта', sb.description === 'Вставте ніжку в паз до упору.', sb.description);
t('підписані рядки — окремими полями', sb.components === 'ніжка 4 шт' && sb.toolsResources === 'молоток; киянка' && sb.warning === 'не бити по торцю' && sb.successCriterion === 'ніжка не хитається');
t('без підписаних рядків увесь текст — опис', mapping.parseStepBody('Просто текст.\n\nДругий абзац.', 'К').description === 'Просто текст.\n\nДругий абзац.');
t('порожній текст — опис = назва кроку (поле не може бути порожнім)', mapping.parseStepBody(null, 'Назва').description === 'Назва' && mapping.parseStepBody('## Лише заголовок', 'Назва').description === 'Назва');
t('кілька рядків одного підпису зливаються', mapping.parseStepBody('x\n**Увага:** а\n**Увага:** б', 'К').warning === 'а; б');
t('порожнє значення підпису ігнорується', mapping.parseStepBody('x\n**Деталі:**  ', 'К').components === '');

// ---------------------------------------------------------------------------
console.log('\nПропозиція для майстра інструкцій');
const mkDraft = (lessonCount: number, over: Record<string, any> = {}): any => {
  const photos = Array.from({ length: lessonCount }, (_, i) => ({ photoId: `p${i + 1}`, order: i + 1, assetId: `as${i + 1}`, description: `Кадр ${i + 1} на верстаку.` }));
  return {
    id: 'pd_a4',
    ownerId: 'u-a',
    kind: 'instruction',
    instructionMode: 'assembly',
    modelCode: 'ПОЛ-120',
    title: 'Складання полиці',
    craft: 'меблі',
    audience: 'дорослі',
    photos,
    structure: {
      modules: [
        {
          moduleId: 'm-1',
          title: 'Складання',
          summary: 'Збираємо каркас.',
          written: true,
          lessons: photos.map((p, i) => ({
            lessonId: `l-${i + 1}`,
            title: `Крок ${i + 1}`,
            goal: i === 1 ? 'Мета кроку 2' : null,
            photoIds: [p.photoId],
            body: i === 0 ? body : `## Крок ${i + 1}\n\nРобимо крок ${i + 1}.`,
            topics: [],
            aiFields: i === 2 ? ['title'] : ['title', 'body'],
          })),
        },
      ],
    },
    ...over,
  };
};
const payload = mapping.toExpressPayload(mkDraft(3)) as any;
const srcs = payload.sourceMaterials as any[];
t('напрям — майстер технічної інструкції, режим і код виробу', payload.track === 'technical_instruction' && payload.technical.mode === 'assembly' && payload.technical.modelCode === 'ПОЛ-120' && payload.technical.title === 'Складання полиці');
t('по джерелу на крок: кадр і його опис, підтверджені', srcs.length === 3 && srcs.every((s) => s.approved && s.kind === 'photo' && /^as\d$/.test(s.assetId) && s.text.includes('Кадр №')), JSON.stringify(srcs[0]).slice(0, 160));
const prop = payload.technical.proposal;
t('кожен крок посилається на своє джерело', prop.steps.every((s: any, i: number) => s.sourceIds.length === 1 && s.sourceIds[0] === srcs[i].id));
t('поля кроку розібрано з тексту, критерій є завжди', prop.steps[0].toolsResources === 'молоток; киянка' && prop.steps[0].successCriterion === 'ніжка не хитається' && prop.steps[1].successCriterion === 'Мета кроку 2' && prop.steps[2].successCriterion.length > 0);
t('needsVerification: так, поки текст написав ШІ й автор його не правив', prop.steps[0].needsVerification === true && prop.steps[2].needsVerification === false);
t('інструменти й попередження зібрано без повторів', prop.tools.join() === 'молоток,киянка' && prop.warnings.join() === 'не бити по торцю', prop.tools.join());
t('хеш входу — як рахує майстер (пропозиція «свіжа»)', prop.inputHash === technical.technicalInputHash({ mode: 'assembly', title: 'Складання полиці', modelCode: 'ПОЛ-120', goal: 'Збираємо каркас.' }, srcs));
t('пропозицію приймає перевірка відповіді моделі майстра', throws(() => technical.parseTechnicalProposal(JSON.stringify(prop), srcs)) === '');
t('чернетку приймає валідація експресу', throws(() => wizard.validateWizardPatch(payload)) === '');
t('режим користування — у налаштуваннях', (mapping.toExpressPayload(mkDraft(2, { instructionMode: 'operation' })) as any).technical.mode === 'operation');
t('старі чернетки без режиму — складання', (mapping.toExpressPayload(mkDraft(2, { instructionMode: undefined })) as any).technical.mode === 'assembly');

const big = mapping.toExpressPayload(mkDraft(70)) as any;
t(`70 кроків: джерел ${mapping.TECHNICAL_MAX_SOURCES}, кроків ${mapping.TECHNICAL_MAX_STEPS}, нічого не падає`, big.sourceMaterials.length === 20 && big.technical.proposal.steps.length === 60);
t('зайві кроки дописані до останнього, а не втрачені', big.technical.proposal.steps[59].description.includes('Крок 70'));
t('кроки понад 20 посилаються на останнє джерело', big.technical.proposal.steps[40].sourceIds[0] === 'src-20' && big.sourceMaterials[19].text.includes('Крок 25'));
t('велика інструкція теж проходить обидві перевірки', throws(() => technical.parseTechnicalProposal(JSON.stringify(big.technical.proposal), big.sourceMaterials)) === '' && throws(() => wizard.validateWizardPatch(big)) === '');
const noPhoto = mapping.toExpressPayload(mkDraft(2, { photos: [] })) as any;
t('крок без кадрів — джерело-нотатка, а не помилка', noPhoto.sourceMaterials.every((s: any) => s.kind === 'note' && !s.assetId) && throws(() => wizard.validateWizardPatch(noPhoto)) === '');

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
await storeMod.saveUser({ id: 'u-a', email: 'a@test.ua', name: 'Майстер', role: 'writer', createdAt: new Date().toISOString() } as any);
const users: Record<string, any> = { 'u-a': { id: 'u-a', email: 'a@test.ua', name: 'Майстер', role: 'writer', isGuest: false } };
const tasks: Array<() => Promise<void>> = [];
const flush = async () => {
  while (tasks.length) await tasks.shift()!();
};
const seen = { describe: [] as any[], system: [] as string[] };
const fakeWrite = async (p: any) => {
  seen.system.push(p.system);
  if (/Кадри \(за порядком зйомки\)/.test(p.prompt)) {
    const ids = [...p.prompt.matchAll(/Кадр (ph_\w+)/g)].map((m: any) => m[1] as string);
    return {
      text: JSON.stringify({
        title: 'Полиця від ШІ',
        modules: [{ title: 'Складання', summary: 'Збираємо каркас.', lessons: ids.map((id, i) => ({ title: `Крок ${i + 1}`, photoIds: [id] })) }],
        assumptions: [],
      }),
      modelId: 'test-text',
    };
  }
  const lessons = [...p.prompt.matchAll(/=== Урок (l-\d+): <<<([^>]*)>>>/g)].map((m: any) => ({ id: m[1] as string, title: m[2] as string }));
  return {
    text: JSON.stringify({
      lessons: lessons.map((l) => ({
        lessonId: l.id,
        body: `## ${l.title}\n\nСобираємо.\n\n**Деталі:** ніжка\n**Інструменти:** викрутка\n**Увага:** не перетягувати\n**Результат кроку:** деталь стоїть рівно`,
      })),
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
  describe: async (p) => {
    seen.describe.push(p.context);
    return { description: 'Деталь на верстаку.', tags: ['деталь'], modelId: 'test-vision' };
  },
  writeText: fakeWrite,
  sinks: { createCourse: sinks.createCourseDraft, createExpress: sinks.createExpressInstruction, createInboxScans: sinks.createInboxScans },
  schedule: (task) => {
    tasks.push(task);
  },
});
const server = app.listen(0);
await new Promise((r) => server.once('listening', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
async function call(method: string, p: string, opts: { token?: string; session?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (opts.session) headers['x-test-session'] = opts.session;
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + p, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
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

console.log('\nРежим у чернетці');
const def = await call('POST', PD, { token: grab, body: { kind: 'instruction', title: 'Полиця' } });
t('інструкція без режиму — складання, код виробу порожній', def.status === 201 && def.data.draft.instructionMode === 'assembly' && def.data.draft.modelCode === null && ok(def, 'DraftResponse'));
const course = await call('POST', PD, { token: grab, body: { kind: 'course', title: 'Курс' } });
t('для курсу режиму немає', course.data.draft.instructionMode === null);
t('режим у курсу — 400 bad_input', (await call('POST', PD, { token: grab, body: { kind: 'course', instructionMode: 'assembly' } })).data.kind === 'bad_input');
t('невідомий режим — 400 bad_input', (await call('POST', PD, { token: grab, body: { kind: 'instruction', instructionMode: 'repair' } })).data.kind === 'bad_input');
t('задовгий код виробу — 400', (await call('POST', PD, { token: grab, body: { kind: 'instruction', modelCode: 'я'.repeat(201) } })).status === 400);
const made = await call('POST', PD, { token: grab, body: { kind: 'instruction', title: 'Полиця ПОЛ-120', instructionMode: 'operation', modelCode: 'ПОЛ-120', craft: 'меблі' } });
const id: string = made.data.draft.draftId;
t('режим користування й код виробу збережено', made.data.draft.instructionMode === 'operation' && made.data.draft.modelCode === 'ПОЛ-120' && ok(made, 'DraftResponse'));
const patched = await call('PATCH', `${PD}/${id}`, { token: grab, body: { ifRevision: made.data.draft.revision, instructionMode: 'assembly', modelCode: 'ПОЛ-121' } });
t('правка режиму й коду — 200, ревізія +1', patched.status === 200 && patched.data.draft.instructionMode === 'assembly' && patched.data.draft.modelCode === 'ПОЛ-121' && patched.data.draft.revision === made.data.draft.revision + 1 && ok(patched, 'DraftResponse'));
t('PATCH режиму в курсу — 400', (await call('PATCH', `${PD}/${course.data.draft.draftId}`, { token: grab, body: { ifRevision: 1, instructionMode: 'assembly' } })).data.kind === 'bad_input');
const cleared = await call('PATCH', `${PD}/${id}`, { token: grab, body: { ifRevision: patched.data.draft.revision, modelCode: null, instructionMode: 'operation' } });
t('код виробу можна стерти', cleared.data.draft.modelCode === null && cleared.data.draft.instructionMode === 'operation');

console.log('\nПовний шлях інструкції');
for (let i = 0; i < 3; i++) await call('POST', `${PD}/${id}/photos`, { token: grab, body: { clientId: `a4-${i}`, image } });
await flush();
t('опис кадрів знає режим користування', seen.describe.length === 3 && seen.describe.every((c) => c.kind === 'instruction' && c.instructionMode === 'operation'), JSON.stringify(seen.describe[0]));
await call('POST', `${PD}/${id}/structure`, { token: grab });
await flush();
let d = await get(id);
t('структура: кроки на кадр, назва від ШІ не затирає свою', d.status === 'structured' && d.structure.modules[0].lessons.length === 3 && d.title === 'Полиця ПОЛ-120');
t('промпт структури: користування й межа кроків', /користування готовим виробом/.test(seen.system[0]) && /не більше 20 кроків/.test(seen.system[0]));
await call('POST', `${PD}/${id}/modules/m-1/generate`, { token: grab });
await flush();
d = await get(id);
t('текст кроків написано, промпт тексту з підписаними рядками', d.status === 'written' && /\*\*Деталі:\*\*/.test(seen.system[1]) && d.structure.modules[0].lessons.every((l: any) => /\*\*Інструменти:\*\* викрутка/.test(l.body)));
const sub = await call('POST', `${PD}/${id}/submit`, { token: grab });
t('submit — 201, target express за схемою', sub.status === 201 && ok(sub, 'SubmitResponse') && sub.data.target.kind === 'express', JSON.stringify(sub.data).slice(0, 160));
const ex = expressStore.getDraft(sub.data.target.id)!;
const exp = ex.payload as any;
t('експрес-чернетка: технічний напрям, режим користування, власник', ex.userId === 'u-a' && exp.track === 'technical_instruction' && exp.technical.mode === 'operation' && exp.technical.title === 'Полиця ПОЛ-120');
t('у ній готова пропозиція: 3 кроки з полями й джерелами', exp.technical.proposal.steps.length === 3 && exp.technical.proposal.steps.every((s: any) => s.toolsResources === 'викрутка' && s.warning === 'не перетягувати' && s.successCriterion === 'деталь стоїть рівно' && s.needsVerification === true));
t('джерел 3, усі з кадром і підтверджені', exp.sourceMaterials.length === 3 && exp.sourceMaterials.every((s: any) => s.kind === 'photo' && s.approved && !!s.assetId));
t('збережена пропозиція проходить перевірку майстра', throws(() => technical.parseTechnicalProposal(JSON.stringify(exp.technical.proposal), exp.sourceMaterials)) === '');
t('усі відповіді сервера відповідають схемі контракту', errs.length === 0, errs.slice(0, 4).join(' | '));
t('версія контракту 1.x', /^1\.\d+\.\d+$/.test(contract.PHOTO_DRAFT_CONTRACT_VERSION));

server.close();
console.log(`\n${pass} пройдено, ${fail} не пройдено`);
process.exit(fail ? 1 : 0);

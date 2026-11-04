/**
 * Контрактний тест «чернеток за фото» (A0). Запуск: npm run test:photo-draft-contract
 *
 * Стежить, щоб три джерела контракту не розійшлися:
 *   1. shared/photoDraftContract.ts — типи, перелічення, межі, маршрути;
 *   2. docs/photo-drafts-api/schema.json — JSON Schema для застосунку на Python;
 *   3. docs/photo-drafts-api/fixtures/*.json — приклади відповідей, на яких
 *      застосунок будує мок-сервер.
 * А також щоб опис API docs/photo-drafts-api.md згадував кожен маршрут.
 *
 * З етапу 1 (A1) сюди ж додаються перевірки справжніх відповідей сервера
 * проти тієї самої схеми — тоді розбіжність сервера й моку видно одразу.
 */
import fs from 'node:fs';
import path from 'node:path';
import Ajv from 'ajv';
import * as c from '../shared/photoDraftContract';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SCHEMA_PATH = path.join(ROOT, 'docs/photo-drafts-api/schema.json');
const FIXTURES = path.join(ROOT, 'docs/photo-drafts-api/fixtures');
const DOC_PATH = path.join(ROOT, 'docs/photo-drafts-api.md');

let pass = 0;
let fail = 0;
const t = (n: string, ok: boolean, e = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};
const same = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify([...a]) === JSON.stringify([...b]);

const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
const defs = schema.definitions as Record<string, any>;
// Формати дат перевіряємо нижче власноруч: окремого пакета форматів у проєкті немає.
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
ajv.addSchema(schema, 'photo-drafts');
const validate = (def: string, data: unknown) => {
  const fn = ajv.getSchema(`photo-drafts#/definitions/${def}`);
  if (!fn) return `немає визначення ${def}`;
  return fn(data) ? '' : ajv.errorsText(fn.errors, { separator: '; ' });
};

// ---------------------------------------------------------------------------
console.log('\nПерелічення: TypeScript ↔ схема');
const enums: [string, readonly string[]][] = [
  ['Kind', c.PHOTO_DRAFT_KINDS],
  ['DraftStatus', c.PHOTO_DRAFT_STATUSES],
  ['PhotoStatus', c.PHOTO_STATUSES],
  ['Level', c.PHOTO_DRAFT_LEVELS],
  ['InstructionMode', c.PHOTO_DRAFT_INSTRUCTION_MODES],
  ['JobKind', c.PHOTO_DRAFT_JOB_KINDS],
  ['JobStatus', c.PHOTO_DRAFT_JOB_STATUSES],
  ['AssumptionStatus', c.ASSUMPTION_STATUSES],
  ['TargetKind', c.SUBMIT_TARGET_KINDS],
  ['ErrorKind', c.PHOTO_DRAFT_ERROR_KINDS],
  ['BlockerKind', c.SUBMIT_BLOCKER_KINDS],
];
for (const [def, values] of enums) {
  t(`${def} збігається`, same(defs[def]?.enum ?? [], values), `схема: ${JSON.stringify(defs[def]?.enum)}`);
}
t(
  'межі: ключі схеми = ключі PHOTO_DRAFT_LIMITS',
  same([...(defs.Limits.required as string[])].sort(), Object.keys(c.PHOTO_DRAFT_LIMITS).sort())
);
t('ліміт опису — 500 символів', c.PHOTO_DRAFT_LIMITS.maxNoteChars === 500);
t('схема обмежує опис тією ж межею', defs.Note.properties.text.maxLength === c.PHOTO_DRAFT_LIMITS.maxNoteChars);
t('схема обмежує назву тією ж межею', defs.Draft.properties.title.maxLength === c.PHOTO_DRAFT_LIMITS.maxTitleChars);
t(
  'схема рахує символи так само (500 емодзі — так, 501 — ні)',
  !validate('Note', { noteId: 'n', photoIds: ['p'], text: '👍'.repeat(500), updatedAt: '2026-10-28T10:00:00.000Z' }) &&
    !!validate('Note', { noteId: 'n', photoIds: ['p'], text: '👍'.repeat(501), updatedAt: '2026-10-28T10:00:00.000Z' })
);

// ---------------------------------------------------------------------------
console.log('\nПідрахунок символів');
t('латиниця', c.countNoteChars('abc') === 3);
t('кирилиця', c.countNoteChars('Вишня') === 5);
t('емодзі — один символ', c.countNoteChars('👍') === 1 && '👍'.length === 2);
t('рівно 500 символів вміщається', c.noteFits('я'.repeat(500)));
t('501 символ — ні', !c.noteFits('я'.repeat(501)));
t('500 емодзі вміщаються (хоча UTF-16 — 1000)', c.noteFits('👍'.repeat(500)));

// ---------------------------------------------------------------------------
console.log('\nМаршрути й фікстури');
const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const expected = new Map<string, string>();
for (const r of c.PHOTO_DRAFT_ROUTES) {
  t(`${r.method} ${r.path}: фікстура і схема задані разом`, (r.fixture === null) === (r.response === null));
  if (r.fixture && r.response) expected.set(r.fixture, r.response);
}
for (const [name, def] of Object.entries(c.PHOTO_DRAFT_EXTRA_FIXTURES)) expected.set(name, def);
t('кожна фікстура згадана в контракті', files.every((f) => expected.has(f)), files.filter((f) => !expected.has(f)).join(', '));
t('кожна згадана фікстура існує', [...expected.keys()].every((f) => files.includes(f)), [...expected.keys()].filter((f) => !files.includes(f)).join(', '));
const keys = c.PHOTO_DRAFT_ROUTES.map((r) => `${r.method} ${r.path}`);
t('маршрути без повторів', new Set(keys).size === keys.length);

const isIso = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(v) && !Number.isNaN(Date.parse(v));
const walkDates = (v: unknown, at: string, bad: string[]) => {
  if (Array.isArray(v)) v.forEach((x, i) => walkDates(x, `${at}[${i}]`, bad));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (/At$/.test(k) && x !== null && !isIso(x)) bad.push(`${at}.${k}`);
      walkDates(x, `${at}.${k}`, bad);
    }
  }
};

const drafts: { name: string; draft: c.PhotoDraft }[] = [];
for (const [name, def] of expected) {
  if (!files.includes(name)) continue;
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
  const err = validate(def, data);
  t(`${name}.json відповідає ${def}`, !err, err);
  const bad: string[] = [];
  walkDates(data, name, bad);
  t(`${name}.json: дати в ISO 8601 UTC`, !bad.length, bad.join(', '));
  if (data.draft) drafts.push({ name, draft: data.draft });
}

// ---------------------------------------------------------------------------
console.log('\nВнутрішня узгодженість чернеток у фікстурах');
for (const { name, draft } of drafts) {
  const ids = new Set(draft.photos.map((p) => p.photoId));
  const orders = draft.photos.map((p) => p.order).sort((a, b) => a - b);
  t(`${name}: порядок кадрів 1…n без пропусків`, orders.every((o, i) => o === i + 1));
  t(`${name}: imageUrl веде на свою чернетку`, draft.photos.every((p) => p.imageUrl.includes(`/photo-drafts/${draft.draftId}/photos/${p.photoId}/`)));
  t(`${name}: описи посилаються на наявні кадри`, draft.notes.every((n) => n.photoIds.every((id) => ids.has(id))));
  t(`${name}: описи вміщаються в 500 символів`, draft.notes.every((n) => c.noteFits(n.text)));
  const lessonPhotos = (draft.structure?.modules ?? []).flatMap((m) => m.lessons.flatMap((l) => l.photoIds));
  t(`${name}: уроки посилаються на наявні кадри`, lessonPhotos.every((id) => ids.has(id)));
  t(`${name}: book має bookId, інші — ні`, (draft.kind === 'book') === (draft.bookId !== null));
  t(`${name}: submitted ⇔ є ціль`, (draft.status === 'submitted') === (draft.submitted !== null));
  if (draft.status === 'written') {
    t(`${name}: written — усі модулі написані`, (draft.structure?.modules ?? []).every((m) => m.written));
  }
  if (draft.job?.kind === 'generate') {
    t(`${name}: generate вказує модуль`, !!draft.structure?.modules.some((m) => m.moduleId === draft.job!.moduleId));
  }
}
const target = { course: 'course', instruction: 'express', book: 'inbox' } as const;
for (const name of ['submit-course', 'submit-instruction', 'submit-book']) {
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf8'));
  t(`${name}: ціль відповідає виду чернетки`, data.target.kind === target[data.draft.kind as c.PhotoDraftKind]);
  t(`${name}: target = draft.submitted`, JSON.stringify(data.target) === JSON.stringify(data.draft.submitted));
}

// ---------------------------------------------------------------------------
console.log('\nОпис API');
const doc = fs.existsSync(DOC_PATH) ? fs.readFileSync(DOC_PATH, 'utf8') : '';
t('docs/photo-drafts-api.md існує', !!doc);
for (const r of c.PHOTO_DRAFT_ROUTES) {
  t(`опис згадує ${r.method} ${r.path}`, doc.includes(`\`${r.method} ${r.path}\``));
}
for (const kind of c.PHOTO_DRAFT_ERROR_KINDS) {
  t(`опис пояснює помилку ${kind}`, doc.includes(`\`${kind}\``));
}
t('опис називає версію контракту', doc.includes(c.PHOTO_DRAFT_CONTRACT_VERSION));

console.log(`\n${pass} пройдено, ${fail} не пройдено`);
if (fail) process.exit(1);

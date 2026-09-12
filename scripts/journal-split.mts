/**
 * Одноразове розділення `log.md` на індекс + частини в теці `log/`.
 *
 * ЧОМУ. Журнал доріс до 840 КБ / 9640 рядків. Кожна нова сесія читає його
 * цілком, щоб відновити контекст — у цьому весь його сенс. При такому
 * темпі (≈90 рядків на запис) він скоро перестане вміщатися, і журнал
 * почне мовчати саме тоді, коли найпотрібніший. Тому: індекс, який
 * читається завжди, і частини, з яких береться лише потрібний запис.
 *
 * ЩО НЕ МОЖНА ЗЛАМАТИ. У файлі три покоління конвенцій і 19 секцій, які
 * записами не є, але містять найважливіше для нової сесії: стан гілок,
 * «⚠️ Прод зараз не працює», «Вітрина: НІЧОГО НЕ ВИДАЛЯТИ», чому пуш
 * робить власник. Усе це лишається в індексі — саме його читають першим.
 *
 * Окремо: записи #114–#118 існують ЛИШЕ у блоці «Журнал сесій» (форма C,
 * де заголовком служить мітка сесії). Записи #119–#123 є і там, і в
 * основному тілі. Тому блок «Журнал сесій» переїжджає окремим файлом
 * цілком, а не розкидається — інакше п'ять записів зникли б.
 *
 * ІНВАРІАНТ. Скрипт не записує нічого, поки не переконається, що розбір
 * ДО і ПІСЛЯ дає той самий результат: ті самі 151 записів, ті самі назви,
 * статуси, уривки і той самий повний текст кожного. Розділення, яке
 * змінює зміст, — це втрата даних, а не переформатування.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseHeading, parseJournal, extractEntryText, type JournalEntry } from '../server/journal.ts';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'log.md');
const OUT_DIR = path.join(ROOT, 'log');
const force = process.argv.includes('--force');

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(SOURCE)) fail('log.md не знайдено — скрипт запускають із кореня проєкту.');
if (fs.existsSync(OUT_DIR) && !force) {
  fail('Тека log/ уже існує — розділення вже зроблено. Повторний запуск: --force.');
}

const original = fs.readFileSync(SOURCE, 'utf8');
const lines = original.split('\n');

/** Номер рядка (0-based) першого заголовка запису з таким номером і формою. */
function findEntry(n: number, form: 'A' | 'B' | 'C'): number {
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeading(lines[i]);
    if (h && h.n === n && h.form === form) return i;
  }
  fail(`не знайдено заголовок запису #${n} форми ${form} — структура файлу не та, на яку розраховано`);
}

/** Номер рядка (0-based) рядка, що починається із заданого тексту. */
function findLine(prefix: string): number {
  const i = lines.findIndex((l) => l.startsWith(prefix));
  if (i === -1) fail(`не знайдено рядок «${prefix}» — структура файлу не та, на яку розраховано`);
  return i;
}

// Межі беремо пошуком, а не числами: якщо структура зміниться, скрипт
// має впасти з поясненням, а не тихо порізати файл не там.
const sessionsStart = findLine('# Журнал сесій');
const rollupStart = findLine('## До 02.09.2026 — записи #1–#60');
const e48 = findEntry(48, 'A');
const e119 = findEntry(119, 'A');

if (!(sessionsStart < rollupStart && rollupStart < e48 && e48 < e119)) {
  fail('межі секцій ідуть не в тому порядку, на який розраховано — розділення скасовано');
}

const slice = (from: number, to: number) => lines.slice(from, to).join('\n').trim();

const header = slice(0, sessionsStart);
const parts: { file: string; title: string; body: string }[] = [
  {
    file: 'sessions.md',
    title: 'Журнал сесій — і єдиний дім записів #114–#118',
    body: slice(sessionsStart, rollupStart),
  },
  { file: '001-047.md', title: 'Записи #1–#47', body: slice(rollupStart, e48) },
  { file: '048-113.md', title: 'Записи #48–#113', body: slice(e48, e119) },
  { file: '119-151.md', title: 'Записи #119–#151', body: slice(e119, lines.length) },
];

// ── Індекс ────────────────────────────────────────────────────────────────
const before = parseJournal(original);
const entryFile = new Map<number, string>();
for (const p of parts) {
  for (const [n] of parseJournal(p.body)) {
    if (!entryFile.has(n)) entryFile.set(n, p.file);
  }
}
// Форма A виграє над C і у файловій прив'язці: якщо запис є і в основному
// тілі, і в «Журналі сесій», показуємо той файл, де в нього є назва.
for (const p of parts) {
  if (p.file === 'sessions.md') continue;
  for (const [n, e] of parseJournal(p.body)) if (e.form !== 'C') entryFile.set(n, p.file);
}

const nums = [...before.keys()].sort((a, b) => b - a);
const rows = nums.map((n) => {
  const e = before.get(n)!;
  const file = entryFile.get(n) || '—';
  const title = e.title.replace(/\|/g, '\\|');
  return `| ${n} | ${title} | ${e.status || ''} | [${file}](log/${file}) |`;
});

/** 1 запис, 2–4 записи, 5–20 записів — із урахуванням 11–14 і сотень. */
function pluralEntries(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'записів';
  if (mod10 === 1) return 'запис';
  if (mod10 >= 2 && mod10 <= 4) return 'записи';
  return 'записів';
}

const index = `${header}

---

# Покажчик записів (${nums.length} ${pluralEntries(nums.length)}, #${Math.min(...nums)}–#${Math.max(...nums)})

> Повні тексти записів лежать у теці \`log/\`, розбиті на частини — журнал
> одним файлом доріс до 840 КБ, а його читає кожна нова сесія. Цей
> покажчик читається завжди; конкретний запис береться з його файлу.
>
> Три покоління конвенцій заголовків (\`## #N — Назва\`, \`## N. Назва\`,
> \`## Сесія … — запис #N\`) лишені як є: переписати 151 заголовок означало б
> переписати історію. Їх усі розбирає \`server/journal.ts\`.
>
> Новий запис додається скриптом \`npm run journal:new\` — він сам ставить
> наступний номер, дату й перелік комітів після останнього запису.

| # | Назва | Статус | Файл |
|---:|---|---|---|
${rows.join('\n')}
`;

// ── Перевірка інваріанту ДО запису ───────────────────────────────────────
const rebuilt = [index, ...parts.map((p) => `# ${p.title}\n\n${p.body}`)].join('\n\n');
const after = parseJournal(rebuilt);

const problems: string[] = [];
if (after.size !== before.size) problems.push(`записів було ${before.size}, стало ${after.size}`);
for (const [n, e] of before) {
  const a = after.get(n);
  if (!a) { problems.push(`запис #${n} зник`); continue; }
  const cmp = (k: keyof JournalEntry) =>
    String(a[k]) !== String(e[k]) && problems.push(`#${n}: ${k} змінилось`);
  cmp('title'); cmp('status'); cmp('excerpt'); cmp('form');
  const tb = extractEntryText(original, n);
  const ta = extractEntryText(rebuilt, n);
  if ((tb || '') !== (ta || '')) problems.push(`#${n}: повний текст змінився`);
}

if (problems.length) {
  console.error('✗ Розділення ЗМІНИЛО б зміст журналу — нічого не записано:');
  for (const p of problems.slice(0, 20)) console.error(`   • ${p}`);
  if (problems.length > 20) console.error(`   … і ще ${problems.length - 20}`);
  process.exit(1);
}

// ── Запис ────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
for (const p of parts) {
  fs.writeFileSync(path.join(OUT_DIR, p.file), `# ${p.title}\n\n${p.body}\n`, 'utf8');
}
fs.writeFileSync(SOURCE, index, 'utf8');

const kb = (s: string) => `${Math.round(Buffer.byteLength(s, 'utf8') / 1024)} КБ`;
console.log(`✓ Розбір ДО і ПІСЛЯ збігається: ${before.size} записів, назви, статуси, уривки й повні тексти.`);
console.log(`✓ Індекс log.md: ${kb(index)} (було ${kb(original)})`);
for (const p of parts) console.log(`✓ log/${p.file}: ${kb(p.body)}`);

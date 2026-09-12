/**
 * `npm run journal:new` — скелет нового запису журналу.
 *
 * ЧОМУ ЦЕ СКРИПТ, А НЕ ПРАВИЛО. Механічна частина запису — це саме те, де
 * робились помилки: номер треба взяти наступний (а записи лежать у
 * зворотному порядку, у трьох конвенціях заголовків і тепер у чотирьох
 * файлах), дату поставити сьогоднішню, а перелік комітів після минулого
 * запису — згадати. Людина (і я) тут помиляється; скрипт — ні.
 *
 * ЩО РОБИТЬ:
 *  - знаходить максимальний номер серед ВСІХ трьох форм заголовків і
 *    бере наступний;
 *  - визначає номер сесії за сьогоднішню дату (#01, #02 …) — конвенція з
 *    шапки журналу;
 *  - перелічує коміти, зроблені після останнього запису, щоб не писати
 *    «що зроблено» з пам'яті;
 *  - дописує скелет у потрібну частину `log/` і оновлює рядок у покажчику.
 *
 * ЧОГО НЕ РОБИТЬ: не пише зміст. Зміст — це постановка, рішення, чесно
 * названі межі й перевірка; згенерувати це зі списку комітів неможливо, і
 * підробка тут гірша за порожній шаблон.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseJournal, readJournalSource } from '../server/journal.ts';

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'log.md');
const OUT_DIR = path.join(ROOT, 'log');

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  } catch {
    return '';
  }
}

const source = readJournalSource();
if (!source) {
  console.error('✗ Журнал не знайдено (ні log.md, ні теки log/). Скрипт запускають із кореня проєкту.');
  process.exit(1);
}

const entries = parseJournal(source);
if (!entries.size) {
  console.error('✗ У журналі не розпізнано жодного запису — це майже напевно зламаний парсер, а не порожній журнал.');
  process.exit(1);
}

const next = Math.max(...entries.keys()) + 1;

// ── Дата й номер сесії ───────────────────────────────────────────────────
const now = new Date();
const dd = String(now.getDate()).padStart(2, '0');
const mm = String(now.getMonth() + 1).padStart(2, '0');
const today = `${dd}.${mm}.${now.getFullYear()}`;

// Скільком записам уже стоїть сьогоднішня дата — стільком сесіям сьогодні.
// Конвенція з шапки: «Сесія Claude: ДД.ММ.РРРР #NN».
const sessionMarks = [...source.matchAll(/Сесія Claude:\s*(\d{2}\.\d{2}\.\d{4})(?:\s*#(\d{2}))?/g)];
const todayMarks = sessionMarks.filter((m) => m[1] === today);
const sessionNo = String(
  todayMarks.reduce((max, m) => Math.max(max, Number(m[2] || 1)), 0) + 1
).padStart(2, '0');

// ── Коміти після останнього запису ───────────────────────────────────────
// Орієнтир — останній коміт, що ТОРКАВСЯ журналу. Це точна відповідь на
// потрібне питання («що зроблено з часу минулого запису») і не залежить
// ні від дат, ні від того, чи згадали номер у темі коміта.
//
// Чому не дата: коміти, застосовані патчем (`git am` — саме так робота з
// хмарної сесії потрапляє в репозиторій), зберігають СВОЮ дату авторства,
// тож «за останню добу» дало б не те.
//
// Чому не «коміт зі згадкою #N у темі»: спершу орієнтир шукався саме так,
// і на першому ж запуску не знайшовся — запис #151 приїхав комітом, у
// темі якого номера немає. Пошук по темі лишається другим шансом.
const prev = next - 1;
let sinceRef = git(['log', '-1', '--format=%H', '--', 'log.md', 'log/']).trim();
let anchorKind = sinceRef ? 'останній коміт, що торкався журналу' : '';
if (!sinceRef) {
  const rows = git(['log', '--format=%H%x1f%B%x1e', '-200'])
    .split('\x1e')
    .filter((r) => r.includes('\x1f'))
    .map((r) => r.split('\x1f', 2));
  const anchor = rows.find(([, b]) => new RegExp(`#${prev}\\b`).test(b || ''));
  if (anchor) { sinceRef = anchor[0].trim(); anchorKind = `коміт зі згадкою #${prev}`; }
}

const commits = sinceRef
  ? git(['log', '--format=%h %s', `${sinceRef}..HEAD`]).split('\n').filter(Boolean)
  : [];

const commitBlock = commits.length
  ? commits.map((c) => `> - \`${c}\``).join('\n')
  : '> _(після попереднього запису комітів ще немає — або орієнтир не знайдено)_';

// ── Куди дописати ────────────────────────────────────────────────────────
// Скелет іде в частину з найбільшими номерами: саме туди лягають нові
// записи. Файл визначаємо за вмістом, а не за іменем.
let target = '';
let targetMax = -1;
if (fs.existsSync(OUT_DIR)) {
  for (const f of fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.md'))) {
    const parsed = parseJournal(fs.readFileSync(path.join(OUT_DIR, f), 'utf8'));
    // «Журнал сесій» тримає лише старі записи форми C — туди не пишемо.
    const hasNamed = [...parsed.values()].some((e) => e.form !== 'C');
    if (!hasNamed || !parsed.size) continue;
    const max = Math.max(...parsed.keys());
    if (max > targetMax) { targetMax = max; target = f; }
  }
}
if (!target) {
  console.error('✗ Не знайдено частину журналу, куди дописувати. Чи зроблено розділення (scripts/journal-split.mts)?');
  process.exit(1);
}

const skeleton = `
## ${next}. НАЗВА ЗАВДАННЯ → 🚧 У роботі

**Сесія Claude: ${today} #${sessionNo}**

**Постановка (власник).** «…»

**Реалізація.**
-

**Перевірка.**
-

**Свідомо поза межами.**
-

<!-- Коміти після запису #${prev}, для пам'яті — прибрати перед комітом:
${commitBlock}
-->
`;

const targetPath = path.join(OUT_DIR, target);
fs.appendFileSync(targetPath, skeleton, 'utf8');

// ── Рядок у покажчику ────────────────────────────────────────────────────
// Покажчик відсортований від новішого до старішого, тож новий рядок іде
// першим після шапки таблиці.
/** 1 запис, 2–4 записи, 5–20 записів — із урахуванням 11–14. */
function pluralEntries(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'записів';
  if (mod10 === 1) return 'запис';
  if (mod10 >= 2 && mod10 <= 4) return 'записи';
  return 'записів';
}

let index = fs.readFileSync(INDEX, 'utf8');
const headerRow = '|---:|---|---|---|';
const at = index.indexOf(headerRow);
if (at === -1) {
  console.warn('⚠ У покажчику не знайдено таблицю — рядок доведеться додати руками.');
} else {
  const insertAt = at + headerRow.length;
  const row = `\n| ${next} | НАЗВА ЗАВДАННЯ | 🚧 У роботі | [${target}](log/${target}) |`;
  index = index.slice(0, insertAt) + row + index.slice(insertAt);

  // Заголовок покажчика теж рахує записи — без цього він одразу ж
  // розходиться з таблицею під ним. Дрібниця, але саме з таких
  // розходжень і виростає недовіра до журналу.
  const lowest = Math.min(...entries.keys());
  index = index.replace(
    /^# Покажчик записів \(\d+ \S+, #\d+–#\d+\)/m,
    `# Покажчик записів (${next} ${pluralEntries(next)}, #${lowest}–#${next})`
  );
  fs.writeFileSync(INDEX, index, 'utf8');
}

console.log(`✓ Запис #${next} — скелет дописано у log/${target}`);
console.log(`✓ Покажчик log.md оновлено (рядок #${next})`);
console.log(`  сесія: ${today} #${sessionNo}`);
console.log(
  commits.length
    ? `  комітів після запису #${prev}: ${commits.length} (орієнтир — ${anchorKind}; перелічені в скелеті)`
    : anchorKind
      ? `  комітів після запису #${prev} ще немає (орієнтир — ${anchorKind})`
      : '  орієнтир не знайдено — перелік комітів порожній'
);
// Ім'я частини — це діапазон НА МОМЕНТ створення, і новий запис його
// переростає. Перейменувати файл автоматично не можна: на нього
// посилається кожен рядок покажчика в цій частині. Тому просто кажемо —
// щоб розбіжність між іменем і вмістом не виглядала потім як помилка.
const bound = target.match(/-(\d{1,3})\.md$/);
if (bound && next > Number(bound[1])) {
  console.log(
    `\n⚠ log/${target} тепер містить записи понад #${bound[1]} — ім'я файлу відстає від вмісту.\n` +
      '  Це не помилка: покажчик веде правильно. Коли частина розростеться, її варто розділити\n' +
      `  наново (scripts/journal-split.mts переписано під це не буде — це ручне рішення).`
  );
}

console.log('\n  Далі — заповнити назву, постановку, реалізацію й перевірку. Скрипт зміст не пише.');

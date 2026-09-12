/**
 * Тести парсера журналу (`server/journal.ts`).
 *
 * Головний із них — регресія на помилку 12.09.2026: парсер знав одну
 * конвенцію заголовків із трьох, знаходив 99 записів зі 151, і 52 коміти
 * показували бейдж, що вів у порожнечу. Записи були на місці. Тому тут
 * перевіряється не «парсер щось розбирає», а конкретно: ЖОДЕН із трьох
 * форматів не втрачається, і кількість знайденого звіряється зі
 * СПРАВЖНІМ журналом, а не з очікуванням, яке я сам же й написав.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  parseHeading,
  parseJournal,
  extractEntryText,
  extractExcerpt,
  parseJournalEntry,
  readJournalSource,
  splitTitleStatus,
} from '../server/journal.ts';

let pass = 0;
let fail = 0;

function ok(name: string, cond: boolean, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}
function eq(name: string, actual: unknown, expected: unknown) {
  ok(name, actual === expected, actual === expected ? '' : `отримано ${JSON.stringify(actual)}, очікували ${JSON.stringify(expected)}`);
}

console.log('\n── Три форми заголовків ──');
{
  const a = parseHeading('## 150. Схема всіх комітів в адмінці → ✅ Зроблено');
  eq('форма A: номер', a?.n, 150);
  eq('форма A: назва', a?.title, 'Схема всіх комітів в адмінці');
  eq('форма A: статус', a?.status, '✅ Зроблено');
  eq('форма A: позначка', a?.form, 'A');

  const b = parseHeading('## #12 — Обкладинка з шаблону → ✅ Виконано');
  eq('форма B: номер', b?.n, 12);
  eq('форма B: назва', b?.title, 'Обкладинка з шаблону');
  eq('форма B: позначка', b?.form, 'B');

  const c = parseHeading('## Сесія 05.09.2026 #06 — запис #118');
  eq('форма C: номер запису, а НЕ номер сесії', c?.n, 118);
  eq('форма C: позначка', c?.form, 'C');
}

console.log('\n── Що заголовком НЕ є ──');
{
  ok('діапазонне зведення не є записом', parseHeading('## Сесія 03.09.2026 #01 — записи #83–#101') === null);
  ok('діапазон «До …» не є записом', parseHeading('## До 02.09.2026 — записи #1–#60') === null);
  ok('службова секція не є записом', parseHeading('## Вітрина: НІЧОГО НЕ ВИДАЛЯТИ (вказівка власника)') === null);
  ok('H1 не є записом', parseHeading('# Журнал сесій') === null);
  ok('порожній рядок', parseHeading('') === null);
  ok('звичайний текст', parseHeading('Постановка: зробити щось') === null);
}

console.log('\n── Назва проти статусу (стрілка в самій назві) ──');
{
  const s1 = splitTitleStatus('Конвеєр публікації замкнено: макет → PDF → лістинг → файл');
  eq('без емодзі статусу назва ціла', s1.title, 'Конвеєр публікації замкнено: макет → PDF → лістинг → файл');
  eq('статусу немає', s1.status, '');

  const s2 = splitTitleStatus('макет → PDF → лістинг → ✅ Зроблено');
  eq('емодзі після останньої стрілки — це статус', s2.status, '✅ Зроблено');
  eq('назва до нього', s2.title, 'макет → PDF → лістинг');
}

console.log('\n── Справжній журнал цього репозиторію ──');
const source = readJournalSource();
if (!source) {
  console.log('  (журналу немає — решту пропускаємо)');
} else {
  const entries = parseJournal(source);
  const nums = [...entries.keys()].sort((a, b) => a - b);

  // Звірка з файлами, а не з моїм очікуванням: рахуємо заголовки самі.
  let headings = 0;
  const seen = new Set<number>();
  for (const line of source.split('\n')) {
    const h = parseHeading(line);
    if (!h) continue;
    headings += 1;
    seen.add(h.n);
  }
  eq('унікальних номерів = розмір карти', entries.size, seen.size);
  ok('заголовків більше, ніж записів (форма C дублює 119–123)', headings > entries.size,
    `заголовків ${headings}, записів ${entries.size}`);

  eq('нумерація починається з 1', nums[0], 1);
  const gaps = [];
  for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!entries.has(n)) gaps.push(n);
  eq('пропусків у нумерації немає', gaps.length, 0);

  // Кожна форма справді присутня — інакше тест зеленів би на зламаному парсері.
  const byForm: Record<string, number> = {};
  for (const e of entries.values()) byForm[e.form] = (byForm[e.form] || 0) + 1;
  ok('форма A присутня', (byForm.A || 0) > 0, `${byForm.A || 0}`);
  ok('форма B присутня', (byForm.B || 0) > 0, `${byForm.B || 0}`);
  ok('форма C присутня', (byForm.C || 0) > 0, `${byForm.C || 0}`);

  ok('усі записи віддають повний текст', nums.every((n) => !!extractEntryText(source, n)));
  ok('усі записи мають непорожню назву', [...entries.values()].every((e) => e.title.trim().length > 0));

  // Форма A має вигравати над C там, де є обидві: у C назви немає.
  const e123 = entries.get(123);
  eq('#123 узято формою A, не сесійною міткою', e123?.form, 'A');

  // Записи, які існують ЛИШЕ формою C — саме вони й «пропадали».
  for (const n of [114, 115, 116, 117, 118]) {
    const e = entries.get(n);
    ok(`#${n} знайдено (лише форма C)`, !!e && e.form === 'C', e ? `"${e.title.slice(0, 44)}"` : 'НЕ ЗНАЙДЕНО');
    ok(`#${n} має осмислену назву, а не ярлик`, !!e && e.title.length > 8 && !/^Тема$/.test(e.title));
  }

  console.log('\n── Регресія: парсер лише форми A (як було) ──');
  {
    const onlyA = new Set<number>();
    for (const line of source.split('\n')) {
      const m = line.match(/^##\s+(\d{1,3})\.\s+(.+)$/);
      if (m) onlyA.add(Number(m[1]));
    }
    ok('парсер-як-був бачив МЕНШЕ записів', onlyA.size < entries.size,
      `${onlyA.size} проти ${entries.size}`);
    const lost = nums.filter((n) => !onlyA.has(n));
    ok('і губив саме записи форм B та C', lost.length > 0, `губилось ${lost.length}`);
    ok('серед утрачених — #1 і #118', lost.includes(1) && lost.includes(118));
  }

  console.log('\n── Розділений розклад читається як одне ціле ──');
  {
    const dir = path.join(process.cwd(), 'log');
    if (!fs.existsSync(dir)) {
      console.log('  (теки log/ немає — розділення ще не зроблено, пропускаємо)');
    } else {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
      ok('частини журналу існують', files.length >= 2, files.join(', '));
      // Жодна частина сама по собі не має всіх записів — інакше
      // розділення не відбулось, а файл просто скопіювався.
      const perFile = files.map((f) => parseJournal(fs.readFileSync(path.join(dir, f), 'utf8')).size);
      ok('жодна частина не містить усе', perFile.every((c) => c < entries.size), perFile.join(' / '));
      eq('сума частин ≥ кількості записів (119–123 є двічі)',
        perFile.reduce((a, b) => a + b, 0) >= entries.size, true);

      const index = fs.readFileSync(path.join(process.cwd(), 'log.md'), 'utf8');
      ok('покажчик згадує кожен номер', nums.every((n) => index.includes(`| ${n} |`)));
      ok('покажчик компактний (його читає кожна сесія)',
        Buffer.byteLength(index, 'utf8') < 120 * 1024,
        `${Math.round(Buffer.byteLength(index, 'utf8') / 1024)} КБ`);
      // Критичні операційні секції мусять лишитись у покажчику.
      for (const s of ['Вітрина: НІЧОГО НЕ ВИДАЛЯТИ', 'Чому пуш робить власник', 'Репозиторії, з якими працюємо']) {
        ok(`покажчик зберіг секцію «${s.slice(0, 26)}…»`, index.includes(s));
      }
    }
  }

  console.log(`\nЖурнал: ${entries.size} записів (#${nums[0]}–#${nums[nums.length - 1]}), форми: ${JSON.stringify(byForm)}`);
}

console.log('\n── Уривок і посилання з теми коміта ──');
{
  const ex = extractExcerpt(['**Сесія Claude: 12.09.2026**', '', '**Постановка (власник).** «Зроби X»', '', 'Деталі далі.']);
  ok('позначка сесії не потрапила в уривок', !ex.includes('Сесія Claude'));
  ok('узято постановку', ex.startsWith('Постановка'));
  ok('розмітку прибрано', !ex.includes('**'));

  eq('#151 у темі', parseJournalEntry('feat: щось (#151)'), 151);
  eq('немає решітки — немає номера', parseJournalEntry('feat: щось'), null);
  eq('4 цифри — не запис', parseJournalEntry('ключ ****3986 недійсний'), null);
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

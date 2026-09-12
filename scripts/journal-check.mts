/**
 * Перевірка посилань на журнал — для хука `pre-push` і для `npm test`.
 *
 * ЩО САМЕ СТЕЖИТЬ. Кожен коміт, який згадує «#N», має вести на запис, який
 * парсер СПРАВДІ знаходить. Не «на запис, який десь у файлі є» — саме
 * знаходить, тим самим кодом, яким його шукає адмінка.
 *
 * ЧОМУ ЦЕ ВАРТО ПЕРЕВІРЯТИ. Це рівно та помилка, яку я зробив 12.09.2026:
 * парсер знав одну конвенцію заголовків із трьох, знаходив 99 записів зі
 * 151, і 52 коміти показували бейдж, що вів у порожнечу. Записи були на
 * місці — їх не бачив читач. Ззовні це виглядало як дірки в журналі, і я
 * спершу так і доповів власнику, помилково.
 *
 * Тобто перевіряється не дисциплінованість автора, а цілісність зв'язку
 * «коміт → запис» при будь-яких майбутніх змінах формату чи розкладу
 * файлів. Якщо хтось знову розділить журнал або заведе четверту форму
 * заголовка — впаде тут, а не в інтерфейсі власника.
 *
 * ЯК ЗАПУСКАЄТЬСЯ:
 *   npx tsx scripts/journal-check.mts              — уся історія
 *   npx tsx scripts/journal-check.mts <ref>..<ref> — лише цей діапазон
 *
 * Хук `pre-push` передає діапазон того, що пушиться: судити коміт за
 * посилання, зроблене іншим комітом у минулому, було б безглуздо.
 */

import { execFileSync } from 'node:child_process';
import { parseJournal, extractEntryText, readJournalSource } from '../server/journal.ts';

const range = process.argv[2] || '';

function git(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch {
    return '';
  }
}

const source = readJournalSource();
if (!source) {
  console.log('journal-check: журналу не знайдено — пропускаємо (це не помилка поза репозиторієм).');
  process.exit(0);
}

const entries = parseJournal(source);
if (!entries.size) {
  console.error('✗ journal-check: у журналі не розпізнано ЖОДНОГО запису.');
  console.error('  Це майже напевно зламаний парсер (server/journal.ts), а не порожній журнал.');
  process.exit(1);
}

const spec = range ? [range] : [];
const raw = git(['log', '--format=%H%x1f%s%x1f%B%x1e', ...spec]);
const commits = raw
  .split('\x1e')
  .filter((c) => c.includes('\x1f'))
  .map((c) => {
    const [hash, subject, body] = c.split('\x1f');
    return { hash: (hash || '').trim(), subject: subject || '', body: body || '' };
  })
  .filter((c) => c.hash);

/**
 * Номери, на які посилається коміт. Беремо і тему, і тіло, але лише в
 * контексті, що справді означає запис: «#151», «log.md #151», «запис #151».
 * Гола решітка з числом трапляється і в іншому значенні (ключі, quota,
 * номери портів), тож 4+ цифр відкидаємо — записів стільки не буде.
 */
function referenced(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/#(\d{1,3})\b/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 999) out.add(n);
  }
  return [...out];
}

const dangling: { hash: string; subject: string; n: number }[] = [];
let checked = 0;

for (const c of commits) {
  // Хвіст коміта службовий: у ньому «Co-Authored-By» і посилання на
  // сесію, і жодних згадок журналу там бути не може.
  const text = `${c.subject}\n${c.body.split(/^(?:Co-Authored-By|Claude-Session):/m)[0]}`;
  for (const n of referenced(text)) {
    checked += 1;
    if (!entries.has(n) || !extractEntryText(source, n)) {
      dangling.push({ hash: c.hash.slice(0, 9), subject: c.subject.slice(0, 62), n });
    }
  }
}

const nums = [...entries.keys()].sort((a, b) => a - b);
const gaps: number[] = [];
for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!entries.has(n)) gaps.push(n);

console.log(
  `journal-check: записів знайдено ${entries.size} (#${nums[0]}–#${nums[nums.length - 1]})` +
    `, комітів перевірено ${commits.length}${range ? ` у ${range}` : ''}, посилань ${checked}`
);
if (gaps.length) console.log(`  пропуски в нумерації: ${gaps.join(', ')}`);

if (dangling.length) {
  console.error(`\n✗ Посилання на записи, яких парсер НЕ знаходить (${dangling.length}):`);
  for (const d of dangling.slice(0, 25)) console.error(`   #${d.n}  ${d.hash}  ${d.subject}`);
  if (dangling.length > 25) console.error(`   … і ще ${dangling.length - 25}`);
  console.error('\n  Причина зазвичай одна з двох:');
  console.error('   • запису справді немає — допишіть його (npm run journal:new);');
  console.error('   • запис є, але новою/іншою формою заголовка — навчіть server/journal.ts її читати.');
  console.error('  Друге саме й ламало бейджі в схемі комітів, лишаючи журнал цілим.');
  process.exit(1);
}

console.log('✓ Кожне посилання на журнал розв’язується в запис із повним текстом.');

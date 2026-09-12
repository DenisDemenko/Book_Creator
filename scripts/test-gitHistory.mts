/**
 * Розбір `git log` для схеми комітів в адмінці (server/gitHistoryRoutes.ts).
 * Запуск: npm run test:git-history
 *
 * Перевіряється на СПРАВЖНІЙ історії цього репозиторію, а не на зліпку:
 * кількість комітів звіряється з `git rev-list --count`, тож якщо парсер
 * загубить хоч один запис — тест впаде. Якщо запускати поза git-репозиторієм
 * (наприклад у продакшн-образі), тест чесно повідомляє про це й виходить
 * без помилки: перевіряти там нічого.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const REPO = process.cwd();
if (!fs.existsSync(`${REPO}/.git`)) {
  console.log('Не git-репозиторій — перевіряти нічого, пропускаємо.');
  process.exit(0);
}

const { parseGitLog, parseJournalEntry, parseJournal, extractEntryText } = await import('../server/gitHistoryRoutes');

const REC = '\u001e';
const FLD = '\u001f';

const git = (args: string[]) =>
  execFileSync('git', args, { cwd: REPO, maxBuffer: 24 * 1024 * 1024 }).toString();

const raw = git([
  'log',
  '--date=iso-strict',
  '--numstat',
  '--format=%x1e%H%x1f%aI%x1f%cI%x1f%an%x1f%P%x1f%s',
]);
const commits = parseGitLog(raw).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
const realTotal = Number(git(['rev-list', '--count', 'HEAD']).trim());
const realMerges = Number(git(['rev-list', '--merges', '--count', 'HEAD']).trim());

let pass = 0, fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

console.log('Повнота розбору (звірка з самим git):');
t('розібрано рівно стільки комітів, скільки в історії', commits.length === realTotal,
  `${commits.length} проти ${realTotal}`);
t('мерджі пораховані так само, як у git', commits.filter((c) => c.isMerge).length === realMerges,
  `${commits.filter((c) => c.isMerge).length} проти ${realMerges}`);
t('жодного коміта без хеша', commits.every((c) => /^[0-9a-f]{40}$/.test(c.hash)));
t('короткий хеш — 7 символів', commits.every((c) => c.shortHash.length === 7));
t('дата у кожного і розбирається як дата',
  commits.every((c) => !Number.isNaN(Date.parse(c.date))));
t('автор не порожній', commits.every((c) => !!c.author && c.author !== '—'));

console.log('\nПорядок і межі:');
const newest = commits[0];
const oldest = commits[commits.length - 1];
t('перший у списку — найновіший',
  Date.parse(newest.date) >= Date.parse(oldest.date), `${newest.date} ≥ ${oldest.date}`);
t('найстаріший — це справді перший коміт репозиторію',
  oldest.hash === git(['rev-list', '--max-parents=0', 'HEAD']).trim(), oldest.subject);
t('після сортування стрічка строго від новіших до старіших',
  commits.every((c, i) => i === 0 || Date.parse(commits[i - 1].date) >= Date.parse(c.date)));
t('дата попадання в історію не раніша за дату авторства',
  commits.every((c) => Date.parse(c.commitDate) >= Date.parse(c.date) - 60_000));
{
  // Коміти, застосовані патчем, мають розбіжність дат — саме тому
  // сортування вище й потрібне. Якщо колись робочий процес зміниться і
  // таких не стане, тест не впаде: він лише повідомить число.
  const shifted = commits.filter((c) => Date.parse(c.commitDate) - Date.parse(c.date) > 3600_000);
  console.log(`  · комітів, застосованих патчем пізніше за авторство: ${shifted.length}`);
}

console.log('\nСтатистика змін:');
t('у звичайних комітів є змінені файли',
  commits.filter((c) => !c.isMerge && c.filesChanged > 0).length > commits.length * 0.9);
t('мердж не приписує собі змін',
  commits.filter((c) => c.isMerge).every((c) => c.filesChanged === 0));
t('додано/вилучено — невід\'ємні числа',
  commits.every((c) => c.insertions >= 0 && c.deletions >= 0 &&
    Number.isFinite(c.insertions) && Number.isFinite(c.deletions)));

console.log('\nЗв\'язок із журналом log.md:');
t('посилання на записи знайдені', commits.filter((c) => c.journalEntry !== null).length > 50,
  `${commits.filter((c) => c.journalEntry !== null).length} комітів`);
t('«записати #140» → 140', parseJournalEntry('docs: записати #140 — живе QA') === 140);
t('«(#139)» у дужках → 139', parseJournalEntry('feat(crm): admin CRM tab (#139)') === 139);
t('без посилання → null', parseJournalEntry('chore: init repository') === null);
t('#0 не вважається записом', parseJournalEntry('bad #0 ref') === null);
t('чотиризначне не вважається записом', parseJournalEntry('ref #1234 here') === null);

console.log('\nПозначка «де вже є коміт»:');
{
  // Поле має бути масивом завжди — інтерфейс на ньому робить .includes().
  t('pushedTo є масивом у кожного коміта', commits.every((c) => Array.isArray(c.pushedTo)));
}

console.log('\nСтійкість розбору:');
t('порожній вивід → порожній масив', parseGitLog('').length === 0);
t('сміття без розділювачів нічого не ламає', parseGitLog('не той формат\nзовсім').length === 0);
t('коміт без numstat (мердж) розбирається',
  parseGitLog(`${REC}${'a'.repeat(40)}${FLD}2026-09-01T10:00:00+03:00${FLD}2026-09-01T10:00:00+03:00${FLD}Хтось${FLD}p1 p2${FLD}Merge branch`).length === 1);

console.log('\nРозбір журналу log.md:');
{
  const md = fs.existsSync(`${REPO}/log.md`) ? fs.readFileSync(`${REPO}/log.md`, 'utf8') : '';
  const entries = parseJournal(md);
  const headingCount = (md.match(/^##\s+\d{1,3}\./gm) || []).length;
  t('розібрано всі нумеровані записи', entries.size === headingCount, `${entries.size} проти ${headingCount}`);
  t('у кожного запису є назва', [...entries.values()].every((e) => e.title.length > 0));
  // Статус є не в кожного запису: у 42 із 98 його немає зовсім (старіші
  // записи). Тому перевіряємо не «майже в усіх», а що там, де він є,
  // він розібраний правильно.
  const withStatus = [...entries.values()].filter((e) => e.status);
  t('статуси знайдені', withStatus.length > 40, `${withStatus.length} із ${entries.size}`);
  t('кожен статус починається з емодзі-позначки',
    withStatus.every((e) => /^[\u2700-\u27bf\u2b00-\u2bff\u2600-\u26ff\ufe0f\u{1f300}-\u{1faff}]/u.test(e.status)),
    withStatus.map((e) => e.status.slice(0, 3)).filter((x) => !/^[✅⚠️❌🚧📋🔧]/u.test(x)).join('|'));
  t('стрілка в самій назві не з\'їдає слово (запис #78)',
    entries.get(78)?.title.endsWith('файл') === true, entries.get(78)?.title.slice(-28));
  t('там, де статусу немає, назва лишається цілою',
    (entries.get(48)?.title || '').startsWith('Канва: картка персонажа'), entries.get(48)?.title);
  t('уривок непорожній у більшості записів',
    [...entries.values()].filter((e) => e.excerpt.length > 20).length > entries.size * 0.8);
  t('уривок не довший за межу', [...entries.values()].every((e) => e.excerpt.length <= 400));
  t('позначка сесії не потрапила в уривок',
    [...entries.values()].every((e) => !e.excerpt.startsWith('Сесія Claude')));
  t('розмітка з уривка прибрана',
    [...entries.values()].every((e) => !e.excerpt.includes('**')));

  // Службові «##»-заголовки записами не є.
  t('«Вітрина» не вважається записом',
    ![...entries.values()].some((e) => e.title.includes('НІЧОГО НЕ ВИДАЛЯТИ')));

  const full = extractEntryText(md, 150);
  t('повний текст запису #150 знайдено', !!full && full.startsWith('## 150.'), (full || '').slice(0, 24));
  t('повний текст не захоплює наступний запис',
    !!full && (full.match(/^##\s+\d{1,3}\./gm) || []).length === 1);
  t('неіснуючий запис → null', extractEntryText(md, 998) === null);
}

const byDay = new Map<string, number>();
for (const c of commits) {
  const day = c.date.slice(0, 10);
  byDay.set(day, (byDay.get(day) || 0) + 1);
}
console.log(`\nІсторія: ${commits.length} комітів, ${byDay.size} днів, ${oldest.date.slice(0, 10)} … ${newest.date.slice(0, 10)}`);
console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

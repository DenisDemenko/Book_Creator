/**
 * Тести панелі git-команд (server/gitCommands.ts + gitCommandRoutes.ts).
 * Запуск: npm run test:git-commands
 *
 * Головне, що тут перевіряється, — НЕ «команда працює», а межа безпеки:
 *
 *  1. жодна команда рівня `manual` не виконується сервером, навіть якщо
 *     запит надіслати напряму, минаючи кнопки (клієнтові вірити не можна);
 *     і окремо — що «не виконується панеллю» та «небезпечна» це РІЗНІ
 *     ознаки: checkout панель не виконує, але небезпечним він не є;
 *  2. хеш, якого немає в репозиторії, відкидається;
 *  3. ім'я теґа чи гілки, яке git прийняв би за прапорець або яке ламає
 *     посилання, відкидається;
 *  4. підстановка в аргументи лишає їх СПИСКОМ — ім'я не може
 *     «розклеїтись» на два аргументи чи внести прапорець.
 *
 * Виконання перевіряється на СПРАВЖНЬОМУ одноразовому репозиторії в
 * /tmp, а не на цьому: тест, який робить `git tag` у робочому
 * репозиторії, лишав би по собі сміття.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ARG_PLACEHOLDER,
  GIT_PREFIX_ARGS,
  GIT_COMMANDS,
  buildArgs,
  commandById,
  isPlausibleHash,
  isSafeMessage,
  isSafePath,
  isSafeRefName,
  needsCommit,
  renderDisplay,
} from '../server/gitCommands.ts';

let pass = 0;
let fail = 0;
function t(name: string, cond: boolean, extra = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { fail += 1; console.error(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`); }
}

console.log('\n── Каталог ──');
{
  t('команд принаймні тридцять', GIT_COMMANDS.length >= 30, `${GIT_COMMANDS.length}`);
  t('у кожної команди є група', GIT_COMMANDS.every((c) => !!c.group));
  t('усі шість груп заповнені',
    new Set(GIT_COMMANDS.map((c) => c.group)).size === 6,
    [...new Set(GIT_COMMANDS.map((c) => c.group))].join(','));
  t('id унікальні', new Set(GIT_COMMANDS.map((c) => c.id)).size === GIT_COMMANDS.length);
  t('у кожної є підпис, команда і підказка',
    GIT_COMMANDS.every((c) => c.label && c.display && c.tooltip));
  t('підказка не переказує назву, а пояснює (довша за 60 символів)',
    GIT_COMMANDS.every((c) => c.tooltip.length > 60),
    `найкоротша ${Math.min(...GIT_COMMANDS.map((c) => c.tooltip.length))}`);
  t('усі три рівні представлені',
    new Set(GIT_COMMANDS.map((c) => c.tier)).size === 3);

  const manual = GIT_COMMANDS.filter((c) => c.tier === 'manual');
  t('команди, які панель не виконує, не мають аргументів',
    manual.every((c) => c.args.length === 0),
    `${manual.length} команд рівня manual`);

  // Дві осі: не кожна невиконувана команда небезпечна. Саме на цьому
  // перша версія тесту й впала — і мала рацію.
  const danger = GIT_COMMANDS.filter((c) => c.danger);
  t('небезпечні попереджають прямим словом у підказці',
    danger.every((c) => /НЕБЕЗПЕЧНО/.test(c.tooltip)),
    danger.map((c) => c.id).join(','));
  t('усе небезпечне панель не виконує', danger.every((c) => c.tier === 'manual'));
  t('є невиконувана команда, яка НЕ небезпечна (checkout)',
    manual.some((c) => !c.danger) && !commandById('checkout-detached')?.danger);
  t('підказка checkout не називає його небезпечним',
    !/НЕБЕЗПЕЧНО/.test(commandById('checkout-detached')?.tooltip || ''));
  t('виконувані команди не позначені небезпечними',
    GIT_COMMANDS.filter((c) => c.tier !== 'manual').every((c) => !c.danger));
  t('reset згадує незворотність',
    /НЕЗВОРОТНО|не можна/.test(commandById('reset-hard')?.tooltip || ''));

  // Чистого дерева вимагають рівно ті, що при конфлікті лишають півстан:
  // revert, cherry-pick і merge. Список перелічений повністю, а не «хоч
  // щось», щоб нова така команда без цієї вимоги впала тут, а не в роботі.
  const needsClean = GIT_COMMANDS.filter((c) => c.needsCleanTree);
  t('чистого дерева вимагають рівно revert, cherry-pick і merge',
    needsClean.map((c) => c.id).sort().join(',') === 'cherry-pick,merge,revert',
    needsClean.map((c) => c.id).join(','));
  t('у них є команда виходу з півстану', needsClean.every((c) => !!c.abortHint));

  // Мережевих операцій не має бути ні в аргументах, ні в показі.
  const netWords = /\b(push|fetch|pull|clone|remote)\b/;
  t('жодна команда не звертається до мережі',
    GIT_COMMANDS.every((c) => !netWords.test(c.args.join(' '))));
}

console.log('\n── Перевірка імен ──');
{
  for (const good of ['v1.0', 'stable-12-09', 'fix/media-library', 'a_b.c-d']) {
    t(`дозволено «${good}»`, isSafeRefName(good));
  }
  // Кожен із цих рядків небезпечний з конкретної причини.
  const bad: [string, string][] = [
    ['--force', 'git прийняв би за прапорець'],
    ['-f', 'те саме, коротко'],
    ['a b', 'пробіл розклеїв би аргумент'],
    ['a..b', '«..» — це діапазон'],
    ['a~1', 'тильда — це посилання на предка'],
    ['a^', 'дашок — теж посилання'],
    ['a:b', 'двокрапка — синтаксис refspec'],
    ['/abs', 'починається зі слеша'],
    ['trail/', 'закінчується слешем'],
    ['name.lock', 'git службово використовує .lock'],
    ['dot.', 'закінчується точкою'],
    ['HEAD@{1}', 'reflog-синтаксис'],
    ['', 'порожнє'],
    ['a'.repeat(101), 'надто довге'],
    ['іменяукраїнською', 'не латиниця — git дозволив би, але ми ні'],
  ];
  for (const [b, why] of bad) t(`відкинуто «${b.slice(0, 14)}»`, !isSafeRefName(b), why);
}

console.log('\n── Перевірка хеша ──');
{
  t('короткий хеш', isPlausibleHash('a63caff'));
  t('повний хеш', isPlausibleHash('a'.repeat(40)));
  t('6 символів — замало', !isPlausibleHash('a63caf'));
  t('41 — забагато', !isPlausibleHash('a'.repeat(41)));
  t('не шістнадцяткове', !isPlausibleHash('zzzzzzz'));
  t('з прапорцем', !isPlausibleHash('--all'));
  t('з пробілом', !isPlausibleHash('a63caff '.trim() + ' x'));
}

console.log('\n── Підстановка лишає аргументи списком ──');
{
  const tag = commandById('tag')!;
  const args = buildArgs(tag, 'deadbee', 'v1.0');
  t('кількість аргументів не змінилась', args.length === tag.args.length, args.join(' | '));
  t('хеш підставлено', args.includes('deadbee'));
  t('ім’я підставлено', args.includes('v1.0'));

  // Навіть якби небезпечне ім'я дійшло до підстановки (не дійде —
  // isSafeRefName відсіює), воно лишається ОДНИМ аргументом.
  const evil = buildArgs(tag, 'deadbee', 'v1.0 --force');
  t('ім’я з пробілом лишається одним аргументом',
    evil.length === tag.args.length && evil.includes('v1.0 --force'));

  const show = commandById('show')!;
  t('хеш у складеному аргументі', buildArgs(commandById('diff-head')!, 'abc1234').includes('abc1234..HEAD'));
  t('show не має %ARG', !show.args.join('').includes('%ARG'));

  t('показ команди підставляє хеш',
    renderDisplay(commandById('reset-hard')!, 'abc1234') === 'git reset --hard abc1234');
  t('показ без імені лишає підказку',
    renderDisplay(tag, 'abc1234').includes('<ім’я>'));
}


console.log('\n── Шляхи: нова поверхня для помилок ──');
{
  for (const good of ['server/db.ts', 'log/001-047.md', 'a.txt', 'src/components/Panel.tsx']) {
    t(`дозволено «${good}»`, isSafePath(good));
  }
  const badPaths: [string, string][] = [
    ['-f', 'git прийняв би за прапорець'],
    ['--force', 'те саме, довго'],
    ['../../etc/passwd', 'вихід за межі репозиторію'],
    ['a/../../b', '«..» у середині шляху'],
    ['..\\..\\x', 'зворотні слеші теж треба нормалізувати'],
    ['/etc/passwd', 'абсолютний шлях'],
    ['C:\\Windows\\x', 'абсолютний шлях Windows'],
    ['', 'порожній'],
    ['x'.repeat(401), 'надто довгий'],
  ];
  for (const [bad, why] of badPaths) t(`відхилено «${bad.slice(0, 16)}»`, !isSafePath(bad), why);

  // Усі шляхові команди мусять передавати шлях ПІСЛЯ `--`, інакше навіть
  // дозволений рядок git міг би прочитати як ревізію.
  const pathCmds = GIT_COMMANDS.filter((c) => c.needs === 'path' && c.args.length);
  t('шляхові команди використовують розділювач --',
    pathCmds.every((c) => c.args.includes('--')),
    pathCmds.map((c) => c.id).join(','));
  t('шлях іде ПІСЛЯ --',
    pathCmds.every((c) => c.args.indexOf('%ARG') > c.args.indexOf('--')));
}

console.log('\n── Опис коміта ──');
{
  t('нормальний опис', isSafeMessage('fix: полагодив лінійку'));
  t('лапки й символи оболонки дозволені (оболонки немає)',
    isSafeMessage('fix: "лапки", $VAR, `бектіки`, ; && rm -rf /'));
  t('порожній відхилено', !isSafeMessage('   '));
  t('керуючі символи відхилено', !isSafeMessage('опис\u0007дзвінок'));
  t('надто довгий відхилено', !isSafeMessage('я'.repeat(2001)));
  t('переніс рядка дозволено', isSafeMessage('перший рядок\nдругий'));
}

console.log('\n── Потреба в коміті виводиться з даних ──');
{
  t('show потребує коміт', needsCommit(commandById('show')!));
  t('tag потребує коміт І назву',
    needsCommit(commandById('tag')!) && commandById('tag')!.needs === 'ref');
  t('status коміт НЕ потребує', !needsCommit(commandById('status')!));
  t('add-path коміт НЕ потребує', !needsCommit(commandById('add-path')!));
  t('merge коміт НЕ потребує', !needsCommit(commandById('merge')!));
  // Якби потребу оголошували полем, а не виводили, tag втратив би одне з двох.
  const both = GIT_COMMANDS.filter((c) => needsCommit(c) && c.needs && c.needs !== 'none');
  t('є команди з ДВОМА аргументами', both.length >= 2, both.map((c) => c.id).join(','));
}

console.log('\n── Мережа: жодної виконуваної команди ──');
{
  const sync = GIT_COMMANDS.filter((c) => c.group === 'sync');
  t('група синхронізації непорожня', sync.length >= 4, `${sync.length}`);
  t('ЖОДНА команда синхронізації не виконується',
    sync.every((c) => c.tier === 'manual' && c.args.length === 0),
    sync.map((c) => c.id).join(','));
  // Тут перша версія тесту була надто широкою і справедливо впала:
  // `git remote add` мережі НЕ потребує, тож причина «немає доступу» до
  // нього не стосується — у нього причина інша. Тому дві окремі перевірки.
  t('кожна підказка синхронізації каже, що панель цього не виконує',
    sync.every((c) => /не виконує|довідкова|не варто/.test(c.tooltip)),
    sync.filter((c) => !/не виконує|довідкова|не варто/.test(c.tooltip)).map((c) => c.id).join(',') || 'усі кажуть');
  const networked = ['pull', 'push', 'push-first'];
  t('мережеві називають саме брак доступу до GitHub',
    networked.every((id) => /доступ|логін/.test(commandById(id)!.tooltip)),
    networked.filter((id) => !/доступ|логін/.test(commandById(id)!.tooltip)).join(',') || 'усі називають');
  const setup = GIT_COMMANDS.filter((c) => c.group === 'setup');
  t('створення/клонування теж не виконується',
    setup.every((c) => c.tier === 'manual' && c.args.length === 0));
  // І взагалі ніде в аргументах не має бути мережевих слів.
  t('у жодних аргументах немає push/pull/clone/fetch',
    GIT_COMMANDS.every((c) => !/\b(push|pull|clone|fetch)\b/.test(c.args.join(' '))));
}

console.log('\n── Заповнювачі в показі команди ──');
{
  for (const c of GIT_COMMANDS) {
    const token = ARG_PLACEHOLDER[c.needs || 'none'];
    if (!token) continue;
    t(`«${c.id}»: показ містить свій заповнювач ${token}`, c.display.includes(token));
  }
  t('шлях підставляється в показ',
    renderDisplay(commandById('add-path')!, '', 'server/db.ts') === 'git add server/db.ts');
  t('опис підставляється в показ',
    renderDisplay(commandById('commit')!, '', 'моя правка').includes('моя правка'));
}

// ── Виконання на одноразовому репозиторії ────────────────────────────────
console.log('\n── Виконання на справжньому одноразовому репозиторії ──');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcmd-'));
function g(args: string[], cwd = tmp): string {
  return execFileSync('git', [...GIT_PREFIX_ARGS, ...args], { cwd, encoding: 'utf8' });
}
try {
  g(['init', '-q', '-b', 'main']);
  g(['config', 'user.email', 'test@local.invalid']);
  g(['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'перший\n');
  g(['add', '.']); g(['commit', '-q', '-m', 'перший коміт']);
  const first = g(['rev-parse', 'HEAD']).trim();
  fs.writeFileSync(path.join(tmp, 'a.txt'), 'перший\nдругий\n');
  g(['add', '.']); g(['commit', '-q', '-m', 'другий коміт']);
  const second = g(['rev-parse', 'HEAD']).trim();

  const run = (id: string, hash: string, name?: string) => {
    const spec = commandById(id)!;
    try {
      // Той самий префікс, що й на сервері, — інакше тест перевіряв би не
      // те, що насправді виконується.
      return { ok: true, out: execFileSync('git', [...GIT_PREFIX_ARGS, ...buildArgs(spec, hash, name)], { cwd: tmp, encoding: 'utf8' }) };
    } catch (e: any) {
      return { ok: false, out: String(e?.stdout || '') + String(e?.stderr || e?.message || '') };
    }
  };

  const show = run('show', second);
  t('show показує зміни', show.ok && show.out.includes('другий'), show.ok ? '' : show.out.slice(0, 80));

  const stat = run('stat', second);
  t('stat перелічує файл', stat.ok && stat.out.includes('a.txt'));

  const contains = run('contains', first);
  t('contains знаходить гілку', contains.ok && contains.out.includes('main'));

  const diff = run('diff-head', first);
  t('diff з HEAD непорожній', diff.ok && diff.out.includes('a.txt'));

  const tagRes = run('tag', first, 'v-test');
  t('tag створюється', tagRes.ok && g(['tag']).includes('v-test'));

  const brRes = run('branch', first, 'fix/test');
  t('гілка створюється від вибраного коміта',
    brRes.ok && g(['rev-parse', 'fix/test']).trim() === first);

  const revert = run('revert', second);
  t('revert створює НОВИЙ коміт, не прибираючи старий',
    revert.ok && g(['rev-list', '--count', 'HEAD']).trim() === '3' && g(['cat-file', '-t', second]).trim() === 'commit');

  // Головне: аргументів у rewrite-команд немає, тож виконати їх нічим.
  for (const id of ['reset-hard', 'squash', 'checkout-detached']) {
    t(`«${commandById(id)!.label}» нічим виконувати (args порожні)`,
      buildArgs(commandById(id)!, second).length === 0);
  }

  // Те, що команда `stat` справді віддає перелік файлів, а не один рядок
  // теми, перевіряється вище — і саме там зловився `--no-patch`, який
  // прибирав і сам `--stat`.
  t('stat не збігається зі show (це різні команди, а не однакові)',
    run('stat', second).out !== run('show', second).out);


  // ── Друга порція команд: щоденне, гілки, історія ──────────────────────
  console.log('');
  const status = run('status', '');
  t('status показує стан', status.ok && /branch|On branch|main/i.test(status.out));

  const logOne = run('log-oneline', '');
  t('log --oneline дає рядки комітів', logOne.ok && logOne.out.trim().split('\n').length >= 3);

  const brList = run('branch-list', '');
  t('список гілок містить активну із зірочкою', brList.ok && /\*\s/.test(brList.out));

  // add <file> + commit: працюємо на новому файлі, щоб не чіпати наявні.
  fs.writeFileSync(path.join(tmp, 'нове.txt'), 'вміст\n');
  const addOne = run('add-path', '', 'нове.txt');
  t('add <файл> додає саме його',
    addOne.ok && g(['diff', '--cached', '--name-only']).includes('нове.txt'));

  const unstage = run('restore-staged', '', 'нове.txt');
  t('restore --staged знімає з індексу, але файл лишається',
    unstage.ok &&
    !g(['diff', '--cached', '--name-only']).includes('нове.txt') &&
    fs.existsSync(path.join(tmp, 'нове.txt')));

  const addAll = run('add-all', '');
  t('add . додає все', addAll.ok && g(['diff', '--cached', '--name-only']).includes('нове.txt'));

  const before = Number(g(['rev-list', '--count', 'HEAD']).trim());
  const commitRes = run('commit', '', 'test: коміт із панелі');
  const after = Number(g(['rev-list', '--count', 'HEAD']).trim());
  t('commit -m створює коміт', commitRes.ok && after === before + 1, `${before} → ${after}`);
  t('опис коміта збережено дослівно',
    g(['log', '-1', '--format=%s']).trim() === 'test: коміт із панелі');

  // Гілки: створити, перейти, злити, видалити.
  // Назва латиницею — саме такі й пропускає isSafeRefName; кириличну він
  // відхиляє ще до виконання, тож перевіряти нею створення безглуздо.
  const bh = run('branch-here', '', 'proba/gilka');
  t('нова гілка від поточного стану створюється',
    bh.ok && g(['rev-parse', 'proba/gilka']).trim() === g(['rev-parse', 'HEAD']).trim());
  t('поточна гілка при цьому НЕ перемкнулась',
    g(['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'main');

  const sc = run('switch-create', '', 'feature-x');
  t('switch -c створює і переходить',
    sc.ok && g(['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'feature-x');

  fs.writeFileSync(path.join(tmp, 'фіча.txt'), 'фіча\n');
  g(['add', '.']); g(['commit', '-q', '-m', 'фіча']);
  const sw = run('switch', '', 'main');
  t('switch повертає на main',
    sw.ok && g(['rev-parse', '--abbrev-ref', 'HEAD']).trim() === 'main');

  const mergeRes = run('merge', '', 'feature-x');
  t('merge приводить зміни гілки',
    mergeRes.ok && fs.existsSync(path.join(tmp, 'фіча.txt')));

  const del = run('branch-delete', '', 'feature-x');
  t('branch -d видаляє злиту гілку', del.ok && !g(['branch']).includes('feature-x'));

  // -d мусить ВІДМОВИТИСЬ на незлитій гілці — це і є його безпечність.
  g(['branch', 'незлита', 'main']);
  g(['checkout', '-q', 'незлита']);
  fs.writeFileSync(path.join(tmp, 'незлите.txt'), 'x\n');
  g(['add', '.']); g(['commit', '-q', '-m', 'незлитий коміт']);
  g(['checkout', '-q', 'main']);
  const delUnmerged = run('branch-delete', '', 'незлита');
  t('branch -d ВІДМОВЛЯЄТЬСЯ видаляти незлиту гілку',
    !delUnmerged.ok && g(['branch']).includes('незлита'));

  // Команди, які панель не виконує — нічим виконувати.
  for (const id of ['restore-file', 'init', 'clone', 'remote-add', 'pull', 'push', 'push-first']) {
    t(`«${commandById(id)!.label}» нічим виконувати`,
      buildArgs(commandById(id)!, 'deadbee', 'x').length === 0);
  }

  // Стан репозиторію після тестів — щоб було видно, що revert справді
  // додав коміт, а не переписав історію.
  // Суть не в конкретному числі (нижні тести додають свої коміти), а в
  // тому, що revert НЕ прибрав початковий коміт.
  t('початковий коміт уцілів після revert', g(['cat-file', '-t', second]).trim() === 'commit');
  t('історія лише зростала', Number(g(['rev-list', '--count', 'HEAD']).trim()) >= 3);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

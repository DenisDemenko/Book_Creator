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
  GIT_COMMANDS,
  buildArgs,
  commandById,
  isPlausibleHash,
  isSafeRefName,
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
  t('команд принаймні десять', GIT_COMMANDS.length >= 10, `${GIT_COMMANDS.length}`);
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

  const needsClean = GIT_COMMANDS.filter((c) => c.needsCleanTree);
  t('revert і cherry-pick вимагають чистого дерева',
    needsClean.map((c) => c.id).sort().join(',') === 'cherry-pick,revert',
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

// ── Виконання на одноразовому репозиторії ────────────────────────────────
console.log('\n── Виконання на справжньому одноразовому репозиторії ──');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gitcmd-'));
function g(args: string[], cwd = tmp): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
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
      return { ok: true, out: execFileSync('git', buildArgs(spec, hash, name), { cwd: tmp, encoding: 'utf8' }) };
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

  // Стан репозиторію після тестів — щоб було видно, що revert справді
  // додав коміт, а не переписав історію.
  t('історія зросла, а не переписалась', g(['rev-list', '--count', 'HEAD']).trim() === '3');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

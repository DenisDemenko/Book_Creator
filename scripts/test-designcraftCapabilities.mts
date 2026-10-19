/**
 * Проба можливостей DesignCraft замість awk-шима. Запуск:
 * npm run test:designcraft-capabilities
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. До цього розбіжність версій лагодив awk у
 * `scripts/designcraft-cli-compat.sh`: він переписував текст згенерованого
 * скрипта. Така правка тиха — вона маскує й справжню регресію виробника
 * скрипта. Тому перевіряти треба не «скрипт запустився», а три речі:
 *
 *  1. РОЗБІЖНІСТЬ ВЕРСІЙ — ЦЕ ДАНІ. Якщо встановлений бінарник не має
 *     команди, яку емітує рушій, це має бути явна помилка з назвою команди,
 *     а не поломка посеред рендера. Випадок `text.selectStory` перевіряється
 *     в обидві сторони: бінарник без команди і з нею.
 *  2. РЕГРЕСІЯ ВИРОБНИКА НЕ ХОВАЄТЬСЯ. `"align":"justify"` рушій не приймає
 *     (`leftJustified` — єдине правильне написання). Раніше awk тихо
 *     виправляв; тепер це має бути видно.
 *  3. СПРАВЖНІ ВИРОБНИКИ ЧИСТІ. Скрипти, які будує production-код для всіх
 *     тем і всіх семантичних стилів, не містять нічого, що awk мусив би
 *     правити. Саме цей тест робить шим непотрібним.
 *
 * Перевірка проти ЖИВОГО бінарника виконується лише коли він є
 * (`DESIGNCRAFT_PATH`, або локальна збірка). Без неї константа
 * `DESIGNCRAFT_ALIGN_VALUES` лишається непідтвердженою — про це тест каже
 * прямо, а не замовчує.
 */
process.env.DATA_DIR ||= '/tmp/nova-designcraft-capabilities';

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let pass = 0;
let fail = 0;
let skipped = 0;
function t(name: string, condition: boolean, details = ''): void {
  if (condition) pass += 1;
  else fail += 1;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${details ? ` — ${details}` : ''}`);
}
function skip(name: string, why: string): void {
  skipped += 1;
  console.log(`  — ${name} — пропущено: ${why}`);
}

const {
  DESIGNCRAFT_ALIGN_VALUES,
  parseDesigncraftCapabilities,
  readDesigncraftCapabilities,
  findUnsupportedScriptSteps,
  __resetDesigncraftCapabilitiesCache,
} = await import('../server/pdf/designcraft/capabilities');
const { serializeDesigncraftParagraphStyles } = await import('../server/pdf/designcraft/styleCommands');
const { BOOK_DESIGN_THEME_ORDER } = await import('../server/pdf/designcraft/themes');
const { DEFAULT_LAYOUT_SPEC } = await import('../server/pdf/pdfTypes');

const ALL_SEMANTIC = [
  'Body', 'Heading 1', 'Heading 2', 'Quote', 'Epigraph', 'Letter', 'InnerThought',
  'ChatMessage', 'SceneBreak', 'Caption', 'LocationTime', 'SystemMessage', 'Evidence',
  'Lore', 'CaseStudy', 'KeyIdea', 'Footnote',
] as const;

/** Перелік команд, який віддав би бінарник. */
function fakeCommands(ids: readonly string[]): string {
  return JSON.stringify(ids.map((id) => ({ id, label: id, menu: [], shortcut: null, params: '{}' })));
}

const V3_COMMAND_IDS = [
  'file.new', 'file.place', 'file.exportPdf', 'frame.create', 'type.para', 'type.char',
  'text.select', 'story.get', 'story.replaceRange', 'layout.documentSetup', 'layout.section',
  'layout.pages.applyParent', 'anchored.insert', 'anchored.list', 'toc.generate', 'toc.update',
  'toc.entries', 'document.inspect', 'variables.define', 'variables.insert',
  'style.paragraph.create', 'swatch.create',
];

// ---------------------------------------------------------------------------
console.log('\nРозбір виводу `designcraft-cli commands`');
{
  const caps = parseDesigncraftCapabilities(fakeCommands(['file.new', 'type.para']));
  t('id команд зібрані', caps.commandIds.has('file.new') && caps.commandIds.has('type.para'));
  t('кількість команд відома', caps.commandCount === 2, String(caps.commandCount));

  const fromValue = parseDesigncraftCapabilities([{ id: 'file.new' }]);
  t('приймає вже розібраний масив', fromValue.commandIds.has('file.new'));

  let threw = '';
  try {
    parseDesigncraftCapabilities('{"not":"array"}');
  } catch (err) {
    threw = (err as Error).message;
  }
  t('не масив — помилка', threw.includes('не масив'), threw);

  threw = '';
  try {
    parseDesigncraftCapabilities('[{"label":"без id"}]');
  } catch (err) {
    threw = (err as Error).message;
  }
  t('масив без id — помилка', threw.includes('без жодного id'), threw);

  threw = '';
  try {
    parseDesigncraftCapabilities('це не json');
  } catch (err) {
    threw = (err as Error).message;
  }
  t('не JSON — помилка з уривком виводу', threw.includes('не JSON'), threw);

  threw = '';
  try {
    parseDesigncraftCapabilities('   ');
  } catch (err) {
    threw = (err as Error).message;
  }
  t('порожній вивід — помилка', threw.includes('не повернув нічого'), threw);
}

// ---------------------------------------------------------------------------
console.log('\nПроба бінарника й кеш');
{
  __resetDesigncraftCapabilitiesCache();
  let calls = 0;
  const runner = async (args: string[]) => {
    calls += 1;
    t(`проба питає саме commands (виклик ${calls})`, args.length === 1 && args[0] === 'commands', args.join(' '));
    return { code: 0, stdout: fakeCommands(['file.new']), stderr: '' };
  };
  const first = await readDesigncraftCapabilities('/fake/cli', runner);
  const second = await readDesigncraftCapabilities('/fake/cli', runner);
  t('успішна проба кешується на процес', calls === 1, `викликів: ${calls}`);
  t('повертається той самий набір', first === second);

  // Інший шлях до бінарника — інша проба: образ може мати обидва.
  await readDesigncraftCapabilities('/other/cli', runner);
  t('кеш за шляхом, не глобальний', calls === 2, `викликів: ${calls}`);

  __resetDesigncraftCapabilitiesCache();
  let failing = 0;
  const badRunner = async () => {
    failing += 1;
    return { code: 1, stdout: '', stderr: 'не той бінарник' };
  };
  let message = '';
  try {
    await readDesigncraftCapabilities('/broken/cli', badRunner);
  } catch (err) {
    message = (err as Error).message;
  }
  t('ненульовий код — помилка з текстом stderr', message.includes('не той бінарник'), message);
  try {
    await readDesigncraftCapabilities('/broken/cli', badRunner);
  } catch {
    /* очікувано */
  }
  t('невдала проба НЕ кешується', failing === 2, `спроб: ${failing}`);
}

// ---------------------------------------------------------------------------
console.log('\nРозбіжність версій: text.selectStory в обидві сторони');
{
  const script = 'text.selectStory {"frame":8,"point":[10,10]}\n';
  const without = parseDesigncraftCapabilities(fakeCommands(['text.select', 'file.new']));
  const with_ = parseDesigncraftCapabilities(fakeCommands(['text.select', 'text.selectStory', 'file.new']));

  const problems = findUnsupportedScriptSteps(script, without);
  t('бінарник без команди — явна помилка', problems.length === 1, problems.join(' '));
  t('помилка називає команду', problems[0]?.includes('text.selectStory') === true, problems[0] || '');
  t('помилка називає крок', problems[0]?.includes('Крок 0') === true, problems[0] || '');
  t(
    'помилка каже, що це версії, а не книга',
    problems[0]?.includes('розбіжність версій') === true,
    problems[0] || ''
  );
  t('бінарник із командою — чисто', findUnsupportedScriptSteps(script, with_).length === 0);
}

// ---------------------------------------------------------------------------
console.log('\nРегресія виробника: align');
{
  const caps = parseDesigncraftCapabilities(fakeCommands(V3_COMMAND_IDS));

  const justify = findUnsupportedScriptSteps('type.para {"attrs":{"align":"justify"}}\n', caps);
  t('align justify — помилка', justify.length === 1, justify.join(' '));
  t('помилка перелічує дозволені значення', justify[0]?.includes('leftJustified') === true, justify[0] || '');

  t(
    'align justify видно навіть без проби бінарника',
    findUnsupportedScriptSteps('type.para {"attrs":{"align":"justify"}}\n', null).length === 1
  );

  t(
    'leftJustified — чисто',
    findUnsupportedScriptSteps('type.para {"attrs":{"align":"leftJustified"}}\n', caps).length === 0
  );
  t(
    'align у вкладеному para (style.paragraph.create) теж перевіряється',
    findUnsupportedScriptSteps(
      'style.paragraph.create {"name":"Body","para":{"align":"justify"},"chars":{"size":10}}\n',
      caps
    ).length === 1
  );
  t(
    'посилання "$0.align" не вважається значенням',
    findUnsupportedScriptSteps('type.para {"attrs":{"align":"$0.align"}}\n', caps).length === 0
  );
  for (const value of DESIGNCRAFT_ALIGN_VALUES) {
    t(
      `дозволене значення ${value} проходить`,
      findUnsupportedScriptSteps(`type.para {"attrs":{"align":${JSON.stringify(value)}}}\n`, caps).length === 0
    );
  }
}

// ---------------------------------------------------------------------------
console.log('\nФорми запису скрипта');
{
  const caps = parseDesigncraftCapabilities(fakeCommands(V3_COMMAND_IDS));

  t('невідому команду видно', findUnsupportedScriptSteps('нема.такої {}\n', caps).length === 1);
  t(
    'форма id={json}',
    findUnsupportedScriptSteps('type.para={"attrs":{"align":"justify"}}\n', caps).length === 1
  );
  t('команда без параметрів', findUnsupportedScriptSteps('toc.update\n', caps).length === 0);
  t(
    'рядок JSON {"command":…}',
    findUnsupportedScriptSteps('{"command":"type.para","params":{"attrs":{"align":"justify"}}}\n', caps)
      .length === 1
  );
  t(
    'цілий JSON-масив не перевіряється (цю форму ніхто не емітує)',
    findUnsupportedScriptSteps('[{"command":"нема.такої","params":{}}]\n', caps).length === 0
  );

  // Нумерація кроків має збігатися з нумерацією рушія: коментарі й порожні
  // рядки кроками не є, інакше "$N" у повідомленні вказував би не туди.
  const numbered = findUnsupportedScriptSteps(
    ['# коментар', '', 'toc.update', '// ще коментар', 'type.para {"attrs":{"align":"justify"}}'].join('\n'),
    caps
  );
  t('коментарі й порожні рядки не рахуються кроками', numbered[0]?.includes('Крок 1') === true, numbered[0] || '');
}

// ---------------------------------------------------------------------------
console.log('\nСправжні виробники скриптів чисті (замість awk)');
{
  const caps = parseDesigncraftCapabilities(fakeCommands(V3_COMMAND_IDS));
  let dirty = 0;
  let checked = 0;
  for (const themeId of BOOK_DESIGN_THEME_ORDER) {
    for (const bodyAlign of ['justify', 'left'] as const) {
      const spec = { ...DEFAULT_LAYOUT_SPEC, bodyAlign, themeId } as never;
      const script = serializeDesigncraftParagraphStyles(spec, ALL_SEMANTIC as never).join('\n') + '\n';
      const problems = findUnsupportedScriptSteps(script, caps);
      checked += 1;
      if (problems.length) {
        dirty += 1;
        console.log(`      ${themeId}/${bodyAlign}: ${problems.join(' ')}`);
      }
    }
  }
  t(`стилі всіх ${BOOK_DESIGN_THEME_ORDER.length} тем × 2 вирівнювання чисті`, dirty === 0, `перевірено ${checked}`);

  // Без теми (themeId не заданий) — теж production-шлях.
  const plain = serializeDesigncraftParagraphStyles(
    { ...DEFAULT_LAYOUT_SPEC, bodyAlign: 'justify' } as never,
    ALL_SEMANTIC as never
  ).join('\n') + '\n';
  t('стилі без теми чисті', findUnsupportedScriptSteps(plain, caps).length === 0);
  t('і справді містять leftJustified, а не justify', plain.includes('leftJustified') && !/"align":"justify"/.test(plain));
}

// ---------------------------------------------------------------------------
console.log('\nЖивий бінарник');
{
  const candidates = [
    process.env.DESIGNCRAFT_PATH,
    process.env.DESIGNCRAFT_REAL_PATH,
    'D:/Rama/designcraft/target/release/designcraft-cli.exe',
  ].filter((value): value is string => !!value);
  const cli = candidates.find((value) => value === 'designcraft-cli' || fs.existsSync(value));

  if (!cli) {
    skip('константа DESIGNCRAFT_ALIGN_VALUES звірена з рушієм', 'бінарника немає (задайте DESIGNCRAFT_PATH)');
    skip('перелік команд рушія містить словник V3', 'бінарника немає');
  } else {
    const run = (args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> =>
      new Promise((resolve) => {
        const child = spawn(cli, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (d) => { stdout += String(d); });
        child.stderr.on('data', (d) => { stderr += String(d); });
        child.on('error', (err) => resolve({ code: null, stdout, stderr: stderr + String(err) }));
        child.on('close', (code) => resolve({ code, stdout, stderr }));
      });

    __resetDesigncraftCapabilitiesCache();
    let live: Awaited<ReturnType<typeof readDesigncraftCapabilities>> | null = null;
    try {
      live = await readDesigncraftCapabilities(cli, run);
    } catch (err) {
      t('перелік команд рушія читається', false, (err as Error).message);
    }

    if (live) {
      const missing = V3_COMMAND_IDS.filter((id) => !live!.commandIds.has(id));
      t(
        `перелік команд рушія містить словник V3 (${live.commandCount} команд)`,
        missing.length === 0,
        missing.length ? `немає: ${missing.join(', ')}` : ''
      );
    }

    // Пряма перевірка константи: рушій мусить відмовити на justify і
    // прийняти leftJustified. Якщо колись приймуть обидва — тест скаже.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-align-'));
    const probe = async (align: string): Promise<string> => {
      const file = path.join(dir, `align-${align}.dcs`);
      fs.writeFileSync(
        file,
        [
          'file.new {}',
          'frame.create {"spread":0,"rect":[36,36,300,200],"content":"text","text":"x"}',
          `type.para {"attrs":{"align":${JSON.stringify(align)}}}`,
        ].join('\n') + '\n',
        'utf8'
      );
      const out = await run(['script', file]);
      return out.stdout + out.stderr;
    };
    try {
      const bad = await probe('justify');
      t('рушій відмовляє на align justify', /unknown variant `?justify/.test(bad), bad.slice(-220).trim());
      const good = await probe('leftJustified');
      t('рушій приймає align leftJustified', !/unknown variant/.test(good), good.slice(-220).trim());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

console.log(
  `\nDesignCraft capabilities: ${pass} пройдено, ${fail} провалено${skipped ? `, ${skipped} пропущено` : ''}.`
);
if (skipped) {
  console.log('  Пропущене НЕ покрито: без живого бінарника константа align лишається непідтвердженою.');
}
if (fail > 0) process.exit(1);

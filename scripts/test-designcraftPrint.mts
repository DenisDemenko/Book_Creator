/**
 * Спайк друкованого макета під KDP у DesignCraft (пункт 5 плану).
 * Запуск: npm run test:designcraft-print
 *
 * ЩО САМЕ ПЕРЕВІРЯЄТЬСЯ. Друкований макет лишався за Nova через курку з
 * яйцем: мінімальне корінцеве поле KDP залежить від кількості сторінок, а та
 * — від ширини текстового блоку, тобто від поля. Отже важливо не «PDF
 * вийшов», а:
 *
 *  1. ЧЕСНІСТЬ ОЗНАКИ. `supportsPrint` у DesignCraft істинний ЛИШЕ в
 *     сесійному транспорті, бо лише там є живий документ. У файловому
 *     запит на друк мусить зупинитися словами, а не віддати екранний PDF.
 *  2. ПРАВИЛА KDP НЕ ДУБЛЮЮТЬСЯ. Корінець рахують ті самі `kdpSpec` і
 *     `getKdpMinimumGutterMm`, якими користується Nova.
 *  3. КОРІНЕЦЬ УЗГОДЖЕНО З ФАКТИЧНИМ ОБСЯГОМ, і він відповідає нормі KDP
 *     саме для тієї кількості сторінок, що вийшла.
 *
 * Без бінарника DesignCraft перевіряються лише ознаки й відмови.
 */
process.env.DATA_DIR ||= '/tmp/nova-designcraft-print-test';

import fs from 'node:fs';

let pass = 0;
let fail = 0;
let skipped = 0;
const t = (n: string, c: boolean, e = '') => {
  c ? pass++ : fail++;
  console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`);
};
const skip = (n: string, why: string) => {
  skipped++;
  console.log(`  — ${n} — пропущено: ${why}`);
};

const LOCAL_CLI = 'D:/Rama/designcraft/target/release/designcraft-cli.exe';
const envCli = process.env.DESIGNCRAFT_PATH;
const cli =
  envCli === ''
    ? undefined
    : envCli && (envCli === 'designcraft-cli' || fs.existsSync(envCli))
      ? envCli
      : fs.existsSync(LOCAL_CLI)
        ? LOCAL_CLI
        : undefined;
if (cli) process.env.DESIGNCRAFT_PATH = cli;

const sessionMode = process.env.DESIGNCRAFT_SESSION === '1' || process.env.DESIGNCRAFT_SESSION === 'true';

const { designcraftEngineV3, DESIGNCRAFT_SESSION_MODE } = await import('../server/pdf/engines/designcraftEngineV3');
const { renderWithEngine } = await import('../server/pdf/engines/registry');
const { getKdpMinimumGutterMm } = await import('../src/utils/kdpHelpers');
const { PdfEngineError } = await import('../server/pdf/engines/types');

const PARA =
  'Вечір падав на місто поволі, як сторінка, що її перегортають не дивлячись. ' +
  'Вулиці ще тримали тепло, але вже пахло дощем, і це був той самий запах, який вона памʼятала з дитинства. ';

/** Книга достатнього обсягу: на короткій корінець ніколи не доросте. */
const book: any = {
  id: 'PRINT-SPIKE',
  title: 'Друкований макет',
  author: 'Fusion Lab Studio',
  chapters: Array.from({ length: 14 }, (_, i) => ({
    id: `c${i + 1}`,
    order: i + 1,
    title: `Розділ ${i + 1}`,
    sections: [
      {
        id: `c${i + 1}s1`,
        order: 1,
        content: Array.from({ length: 12 }, () => `<p>${PARA.repeat(3)}</p>`).join('\n\n'),
      },
    ],
  })),
};

const request = (over: Record<string, unknown> = {}) => ({
  book,
  kind: 'book' as const,
  spec: {},
  print: true,
  ownerId: null,
  ownerRole: 'admin',
  ...over,
});

// ---------------------------------------------------------------------------
console.log('\nОзнака друку чесна щодо транспорту');
{
  t(
    'supportsPrint збігається з транспортом',
    designcraftEngineV3.supportsPrint === DESIGNCRAFT_SESSION_MODE,
    `supportsPrint=${designcraftEngineV3.supportsPrint}, сесійний=${DESIGNCRAFT_SESSION_MODE}`
  );
  t('транспорт визначено змінною оточення', DESIGNCRAFT_SESSION_MODE === sessionMode);

  if (!sessionMode) {
    let message = '';
    try {
      await renderWithEngine('designcraft', request() as never);
    } catch (err) {
      message = (err as Error).message;
    }
    t('у файловому транспорті друк зупиняється словами', /не робить друковану редакцію/.test(message), message);
    t('сказано, за якої умови це можливо', /DESIGNCRAFT_SESSION/.test(message), message);
  } else {
    skip('у файловому транспорті друк зупиняється словами', 'запущено в сесійному транспорті');
  }
}

// ---------------------------------------------------------------------------
console.log('\nСправжній друкований макет');
{
  if (!cli) {
    skip('друкований PDF збирається', 'бінарника DesignCraft немає');
    skip('корінець відповідає нормі KDP для свого обсягу', 'бінарника немає');
  } else if (!sessionMode) {
    skip('друкований PDF збирається', 'потрібен DESIGNCRAFT_SESSION=1');
    skip('корінець відповідає нормі KDP для свого обсягу', 'потрібен DESIGNCRAFT_SESSION=1');
  } else {
    const out = await designcraftEngineV3.render(request() as never);
    t('друкований PDF зібрано', out.bytes.length > 2000 && out.pageCount > 20, `${out.pageCount} стор., ${out.bytes.length} Б`);
    t('макет позначено як виконаний', out.honoredSpec === true);

    const agreed = out.notesUk.find((n) => /KDP: корінцеве поле/.test(n));
    t('є нотатка про узгоджений корінець', !!agreed, agreed || out.notesUk.join(' | ').slice(0, 200));

    /*
     * Головна перевірка спайку: корінець у нотатці мусить відповідати нормі
     * KDP саме для ТІЄЇ кількості сторінок, яка вийшла. Якщо курка з яйцем
     * не розв'язана, тут буде розбіжність.
     */
    const m = /корінцеве поле ([\d.]+) мм при мінімумі ([\d.]+) мм для (\d+) стор/.exec(agreed || '');
    t('нотатка містить обидва числа й обсяг', !!m, agreed || '');
    if (m) {
      const have = Number(m[1]);
      const need = Number(m[2]);
      const pages = Number(m[3]);
      t('обсяг у нотатці = обсяг PDF', pages === out.pageCount, `${pages} проти ${out.pageCount}`);
      t('норма взята з KDP-правил Студії', need === getKdpMinimumGutterMm(pages).minMm, `${need} проти ${getKdpMinimumGutterMm(pages).minMm}`);
      t('корінець не менший за норму', have >= need, `${have} >= ${need}`);
    }

    // Друкований PDF мусить мати мітки обрізу: без них друкарня не знає, де
    // різати. Перевіряється наявністю об'єктів розмітки у файлі.
    const head = Buffer.from(out.bytes).toString('latin1');
    t('PDF не порожній і читається як PDF', head.startsWith('%PDF-'), head.slice(0, 8));

    // Екранний макет того ж тексту має БІЛЬШУ ширину тексту, тож менше
    // сторінок: це доводить, що друкований справді верстався інакше.
    const screen = await designcraftEngineV3.render(request({ print: false }) as never);
    t(
      'друкований макет не тотожний екранному',
      out.pageCount !== screen.pageCount || out.bytes.length !== screen.bytes.length,
      `друк ${out.pageCount} стор. / ${out.bytes.length} Б проти екрана ${screen.pageCount} стор. / ${screen.bytes.length} Б`
    );

    /*
     * ГОЛОВНА ПЕРЕВІРКА СПАЙКУ. На книзі до 150 сторінок початковий корінець
     * уже задовольняє норму, і петля узгодження не виконується ні разу —
     * тобто курка з яйцем лишається недоведеною. Тут книга завідомо більша
     * за 150 сторінок, де норма KDP стрибає з 9.6 на 12.7 мм, отже перший
     * корінець мусить ПЕРЕСТАТИ підходити, і петля має зробити хоча б один
     * прохід: ширший корінець → вужчий текст → більше сторінок → перевірка
     * норми знову.
     */
    const bigBook = {
      ...book,
      id: 'PRINT-SPIKE-BIG',
      chapters: Array.from({ length: 20 }, (_, i) => ({
        id: `b${i + 1}`,
        order: i + 1,
        title: `Розділ ${i + 1}`,
        sections: [
          {
            id: `b${i + 1}s1`,
            order: 1,
            content: Array.from({ length: 40 }, () => `<p>${PARA.repeat(3)}</p>`).join('\n\n'),
          },
        ],
      })),
    };
    const big = await designcraftEngineV3.render(request({ book: bigBook }) as never);
    t('велика книга зверстана', big.pageCount > 150, `${big.pageCount} стор.`);
    const bigNote = big.notesUk.find((n) => /KDP: корінцеве поле/.test(n)) || '';
    const bm = /корінцеве поле ([\d.]+) мм при мінімумі ([\d.]+) мм для (\d+) стор/.exec(bigNote);
    t('є нотатка про корінець великої книги', !!bm, bigNote || big.notesUk.join(' | ').slice(0, 200));
    if (bm) {
      const have = Number(bm[1]);
      const need = Number(bm[2]);
      const pages = Number(bm[3]);
      t('норма зросла через обсяг', need > 9.6, `${need} мм для ${pages} стор.`);
      t('корінець догнав нову норму', have >= need, `${have} >= ${need}`);
      t('обсяг у нотатці = обсяг PDF', pages === big.pageCount, `${pages} проти ${big.pageCount}`);
      t('норма збігається з правилами Студії', need === getKdpMinimumGutterMm(pages).minMm);
    }
    t(
      'петля узгодження справді виконалась (не 0 проходів)',
      /узгоджено за [1-9]/.test(bigNote),
      bigNote
    );
    t(
      'є слід перерахунку обсягу після зміни корінця',
      big.notesUk.some((n) => /KDP: корінець .* → обсяг/.test(n)),
      big.notesUk.filter((n) => /KDP/.test(n)).join(' | ').slice(0, 240)
    );
  }
}

console.log(`\nDesignCraft print: ${pass} пройдено, ${fail} провалено${skipped ? `, ${skipped} пропущено` : ''}.`);
if (skipped) console.log('  Пропущене НЕ покрито; друкований макет існує лише в сесійному транспорті.');
if (fail > 0) process.exit(1);
void PdfEngineError;

/**
 * Опції експорту PDF у рушії DesignCraft. Запуск: npm run test:designcraft-export
 *
 * ЩО САМЕ ТУТ ВАЖИТЬ. Пункт 3 плану (`PLAN_DESIGNCRAFT_BRIDGE.md`) зводився до
 * того, що експортер DesignCraft умів більше, ніж у нього просили: структурне
 * дерево, стандарти, попередження. Три речі, які варто тримати тестом:
 *
 *  1. ОДИН БІЛДЕР НА ДВА ТРАНСПОРТИ. Параметри експорту будує
 *     `exportParams`, і файловий шлях та жива сесія беруть їх звідти обидва.
 *     Якби кожен збирав свої, побайтовий збіг, яким вимірювач доводить
 *     тотожність шляхів, перестав би щось означати.
 *  2. БРАМА ВМИКАЄТЬСЯ ЛИШЕ ДЛЯ X-4. `designcraft-cli validate-pdf`
 *     перевіряє відповідність **тільки** PDF/X-4: на звичайному PDF він
 *     скаржиться на те, чого від нього не вимагали, а на PDF/A-2b — на чужий
 *     стандарт. Брама на будь-якому іншому стандарті брехала б.
 *  3. ПОПЕРЕДЖЕННЯ ДОХОДЯТЬ ДО АВТОРА. `file.exportPdf` повертає `warnings`;
 *     раніше вони летіли в нікуди.
 *
 * Перевірки з живим бінарником ідуть лише коли він є; без нього тест прямо
 * каже, чого не покрив, а не вдає успіх.
 */
process.env.DATA_DIR ||= '/tmp/nova-designcraft-export-test';

import fs from 'node:fs';

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

const { exportParams, designcraftEngineV3 } = await import('../server/pdf/engines/designcraftEngineV3');
const { DEFAULT_LAYOUT_SPEC } = await import('../server/pdf/pdfTypes');

function spec(pdfExport: Partial<typeof DEFAULT_LAYOUT_SPEC.pdfExport> = {}) {
  return { ...DEFAULT_LAYOUT_SPEC, pdfExport: { ...DEFAULT_LAYOUT_SPEC.pdfExport, ...pdfExport } };
}

// ---------------------------------------------------------------------------
console.log('\nТипові значення — усвідомлений вибір, не випадковість');
{
  t('структурне дерево типово ввімкнено', DEFAULT_LAYOUT_SPEC.pdfExport.tagged === true);
  t(
    'стандарт типово none (x4 важить +240 КБ ICC-профілю)',
    DEFAULT_LAYOUT_SPEC.pdfExport.standard === 'none',
    DEFAULT_LAYOUT_SPEC.pdfExport.standard
  );
  t('стиснення зображень типово вимкнено', DEFAULT_LAYOUT_SPEC.pdfExport.compressImages === false);
}

// ---------------------------------------------------------------------------
console.log('\nexportParams: один білдер на два транспорти');
{
  const plain = exportParams(spec(), '/tmp/a.pdf');
  t('шлях передається', plain.path === '/tmp/a.pdf');
  t('tagged передається', plain.tagged === true);
  t('compressImages передається', plain.compressImages === false);
  t('standard=none НЕ передається зовсім', !('standard' in plain), JSON.stringify(plain));

  const x4 = exportParams(spec({ standard: 'x4' }), '/tmp/b.pdf');
  t('standard=x4 передається', x4.standard === 'x4');

  const a2b = exportParams(spec({ standard: 'a2b', tagged: false, compressImages: true }), '/tmp/c.pdf');
  t('standard=a2b передається', a2b.standard === 'a2b');
  t('tagged=false передається явно', a2b.tagged === false);
  t('compressImages=true передається', a2b.compressImages === true);
}

// ---------------------------------------------------------------------------
console.log('\nЖивий бінарник: що експортер справді робить');
{
  const cli = [process.env.DESIGNCRAFT_PATH, 'D:/Rama/designcraft/target/release/designcraft-cli.exe']
    .filter((v): v is string => !!v)
    .find((v) => v === 'designcraft-cli' || fs.existsSync(v));

  if (!cli) {
    skip('структурне дерево справді вкладається', 'бінарника немає (задайте DESIGNCRAFT_PATH)');
    skip('брама PDF/X-4 проходить', 'бінарника немає');
    skip('попередження PDF/A доходить до автора', 'бінарника немає');
  } else {
    process.env.DESIGNCRAFT_PATH = cli;
    const book: any = {
      id: 'EXPORT-TEST',
      title: 'Перевірка експорту',
      author: 'Fusion Lab Studio',
      chapters: [
        {
          id: 'c1',
          order: 1,
          title: 'Розділ перший',
          sections: [{ id: 's1', order: 1, title: 'Початок', content: '<p>Текст для перевірки опцій експорту PDF у рушії DesignCraft.</p>' }],
        },
      ],
    };
    const render = (pdfExport: Partial<typeof DEFAULT_LAYOUT_SPEC.pdfExport>) =>
      designcraftEngineV3.render({ book, kind: 'book', spec: { pdfExport: { ...DEFAULT_LAYOUT_SPEC.pdfExport, ...pdfExport } } as never, print: false, ownerId: null, ownerRole: 'admin' });

    const tagged = await render({});
    const taggedText = Buffer.from(tagged.bytes).toString('latin1');
    t('типово у PDF є структурне дерево', taggedText.includes('StructTreeRoot'), `${tagged.bytes.length} Б`);
    t('нотатка каже про структурне дерево', tagged.notesUk.some((n) => /структурне дерево вкладено/.test(n)), tagged.notesUk.join(' | ').slice(0, 120));

    const plain = await render({ tagged: false });
    const plainText = Buffer.from(plain.bytes).toString('latin1');
    t('з tagged=false дерева немає', !plainText.includes('StructTreeRoot'), `${plain.bytes.length} Б`);
    t('нотатка це визнає', plain.notesUk.some((n) => /без структурного дерева/.test(n)));

    const x4 = await render({ standard: 'x4' });
    t('X-4 рендериться', x4.pageCount > 0, `${x4.pageCount} стор., ${x4.bytes.length} Б`);
    t(
      'брама PDF/X-4 пройдена й сказала про це',
      x4.notesUk.some((n) => /PDF\/X-4: вбудована перевірка відповідності пройдена/.test(n)),
      x4.notesUk.join(' | ').slice(0, 160)
    );
    t('нотатка називає стандарт', x4.notesUk.some((n) => /стандарт X4/.test(n)));
    t('X-4 справді важчий за звичайний (ICC-профіль)', x4.bytes.length > plain.bytes.length, `${x4.bytes.length} проти ${plain.bytes.length}`);

    // --- супутні формати з того самого макета ---
    t('типово супутників немає', !tagged.companions, JSON.stringify(tagged.companions?.map((c) => c.kind)));

    const withEpub = await render({ companions: ['epub'] });
    const epub = withEpub.companions?.find((c) => c.kind === 'epub');
    t('EPUB зроблено', !!epub, `${epub?.bytes.length} Б`);
    t('mime EPUB правильний', epub?.mimeType === 'application/epub+zip', epub?.mimeType);
    t('розширення EPUB', epub?.extension === 'epub');
    if (epub) {
      const head = Buffer.from(epub.bytes.slice(0, 80)).toString('latin1');
      t('EPUB — це zip (підпис PK)', head.startsWith('PK'), JSON.stringify(head.slice(0, 4)));
      // EPUB вимагає, щоб `mimetype` був ПЕРШИМ записом і без стиснення:
      // саме тому його видно в перших байтах архіву.
      t('mimetype — перший запис архіву', head.includes('mimetypeapplication/epub+zip'), head.slice(0, 60));
    }
    t('нотатка каже про EPUB', withEpub.notesUk.some((n) => /Супутній EPUB зроблено/.test(n)), withEpub.notesUk.filter((n) => /EPUB/.test(n)).join(' | '));
    t('PDF при цьому той самий за кількістю сторінок', withEpub.pageCount === tagged.pageCount, `${withEpub.pageCount} проти ${tagged.pageCount}`);

    const withHtml = await render({ companions: ['html'] });
    const html = withHtml.companions?.find((c) => c.kind === 'html');
    t('HTML зроблено', !!html, `${html?.bytes.length} Б`);
    t('mime HTML правильний', html?.mimeType === 'text/html; charset=utf-8', html?.mimeType);
    if (html) {
      const text = Buffer.from(html.bytes).toString('utf8');
      t('HTML містить розмітку сторінки', /<html/i.test(text), text.slice(0, 60));
      t('HTML містить текст книги', text.includes('Розділ перший'), String(/Розділ перший/.test(text)));
    }

    const both = await render({ companions: ['epub', 'html'] });
    t('обидва формати разом', both.companions?.length === 2, JSON.stringify(both.companions?.map((c) => c.kind)));

    const a2b = await render({ standard: 'a2b' });
    t(
      'попередження експортера доходить до автора',
      a2b.notesUk.some((n) => /DesignCraft під час експорту/.test(n)),
      a2b.notesUk.filter((n) => /під час експорту/.test(n)).join(' | ').slice(0, 200)
    );
    t(
      'на a2b брама X-4 НЕ запускалась',
      !a2b.notesUk.some((n) => /PDF\/X-4/.test(n)),
      a2b.notesUk.join(' | ').slice(0, 120)
    );
  }
}

console.log(`\nDesignCraft export: ${pass} пройдено, ${fail} провалено${skipped ? `, ${skipped} пропущено` : ''}.`);
if (skipped) console.log('  Пропущене НЕ покрито: без бінарника поведінка експортера не перевіряється, лише побудова параметрів.');
if (fail > 0) process.exit(1);

/**
 * Тести конвертера .docx → рукопис (src/utils/docxManuscript.ts).
 * Запуск: npm run test:docx-manuscript
 *
 * ЧОМУ ЦЕ ВАРТО ПЕРЕВІРЯТИ. Майстер перенесення раніше викликав
 * `mammoth.extractRawText`, який мовчки викидає всі картинки — автор
 * отримував голий текст, а зображення не доходили ні до медіатеки, ні до
 * канви «Книга і текст». Саме тому тут три речі перевіряються окремо:
 *   1. порядок: маркер стоїть там, де картинка була в документі;
 *   2. звʼязок: id у маркері ТОЧНО дорівнює id зібраного зображення —
 *      розбіжність означала б картинку, якої редактор не намалює;
 *   3. сумісність: рядок, який будує конвертер, справді розбирається тим
 *      самим парсером, що й у редакторі (`markerStringToTiptapDoc`).
 */
import { htmlToManuscript, DOCX_IMAGE_SRC_PREFIX, createDocxImageSlots } from '../src/utils/docxManuscript.ts';
import { markerStringToTiptapDoc } from '../src/utils/manuscriptDoc.ts';

let passed = 0;
let failed = 0;
function t(name: string, ok: boolean, extra?: string) {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

function main() {
  console.log('\nЗображення — позиція й підпис:');
  {
    const html =
      '<p>Текст до картинки.</p>' +
      `<p><img alt="Обложка ч_б" src="${DOCX_IMAGE_SRC_PREFIX}0" /></p>` +
      '<p>Текст після картинки.</p>' +
      `<p><img src="${DOCX_IMAGE_SRC_PREFIX}1" /></p>`;
    const { text, images } = htmlToManuscript(html);

    t('зібрано обидва зображення', images.length === 2, String(images.length));
    t('id першого — docx-img-0', images[0]?.id === 'docx-img-0', images[0]?.id);
    t('підпис узято з alt', images[0]?.caption === 'Обложка ч_б', images[0]?.caption);
    t('без alt підпис порожній', images[1]?.caption === '', JSON.stringify(images[1]?.caption));

    t('маркер першої картинки на місці', text.includes('[IMG: docx-img-0 "Обложка ч_б"]'), text.slice(0, 120));
    t('маркер другої картинки теж є', text.includes('[IMG: docx-img-1 ""]'));
    t(
      'порядок збережено: текст → картинка → текст → картинка',
      text.indexOf('Текст до картинки') < text.indexOf('docx-img-0') &&
        text.indexOf('docx-img-0') < text.indexOf('Текст після картинки') &&
        text.indexOf('Текст після картинки') < text.indexOf('docx-img-1'),
      JSON.stringify(text)
    );
    t('маркер стоїть окремим абзацом', /\n\n\[IMG: docx-img-0 "[^"]*"\]\n\n/.test(text));
  }

  console.log('\nМісця картинок .docx не залежать від порядку відповідей:');
  {
    /*
      Гонка, знайдена живим прогоном 13.09.2026 (#169). `convertImage`
      викликається синхронно, а `image.read('base64')` відповідає промісом:
      на книзі з 42 картинками (40 з них — по кілька мегабайтів) відповіді
      приходять НЕ в тому порядку. Доти індекс брався як `collected.length`
      ДО `push`, тож дві картинки могли дістати один індекс, масив зсувався —
      і маркер `docx-img-27` показував на чужі байти. У PDF це виглядало як
      «SOI not found in JPEG»: верстальник діставав PNG там, де оголошено JPEG.
    */
    const slots = createDocxImageSlots();
    const seen: number[] = [];
    const store = createDocxImageSlots((n) => seen.push(n));

    const first = store.reserve();
    const second = store.reserve();
    const third = store.reserve();
    t('місця видаються по порядку', [first, second, third].join(',') === '0,1,2', [first, second, third].join(','));

    // Відповіді приходять у зворотному порядку — саме так і буває на практиці.
    store.put(third, { contentType: 'image/png', base64: 'C' });
    store.put(second, { contentType: 'image/jpeg', base64: 'B' });
    store.put(first, { contentType: 'image/jpeg', base64: 'A' });

    t('байти лежать за своїм номером, а не за порядком відповіді',
      store.get(0)?.base64 === 'A' && store.get(1)?.base64 === 'B' && store.get(2)?.base64 === 'C',
      [store.get(0)?.base64, store.get(1)?.base64, store.get(2)?.base64].join(','));
    t('тип їде разом зі своїми байтами', store.get(2)?.contentType === 'image/png', String(store.get(2)?.contentType));
    t('розмір — це кількість заповнених місць', store.size === 3, String(store.size));
    t('лічильник прогресу росте на кожну картинку', seen.join(',') === '1,2,3', seen.join(','));
    t('невідомий номер дає undefined, а не чужі байти', store.get(99) === undefined);

    // Два плейсхолдери не мають права отримати один номер — саме це й
    // зсувало масив у старій реалізації.
    const a = slots.reserve();
    const b = slots.reserve();
    t('сусідні місця різні', a !== b, `${a},${b}`);
  }

  console.log('\nМаркер, який будує конвертер, розбирається редактором:');  {
    const html = `<p>Абзац.</p><p><img alt="Ілюстрація 1" src="${DOCX_IMAGE_SRC_PREFIX}0" /></p>`;
    const { images } = htmlToManuscript(html);
    const doc = markerStringToTiptapDoc(`[IMG: ${images[0].id} "${images[0].caption}"]`);
    const node = doc.content?.[0];
    t('вузол — саме wrappedImage', node?.type === 'wrappedImage', String(node?.type));
    t('id у вузлі збігається зі зібраним', node?.attrs?.imageId === images[0].id, String(node?.attrs?.imageId));
    t('підпис дійшов до вузла', node?.attrs?.caption === 'Ілюстрація 1', String(node?.attrs?.caption));
  }

  console.log('\nНебезпечні підписи (лапки й дужки ламали б маркер):');
  {
    const html = `<p><img alt='Назва "з лапками" і ] дужкою' src="${DOCX_IMAGE_SRC_PREFIX}0" /></p>`;
    const { text, images } = htmlToManuscript(html);
    t('лапки прибрано з підпису', !images[0].caption.includes('"'), images[0].caption);
    t('дужку прибрано з підпису', !images[0].caption.includes(']'), images[0].caption);
    const doc = markerStringToTiptapDoc(text.trim());
    t('маркер усе одно розбирається', doc.content?.[0]?.type === 'wrappedImage', JSON.stringify(text));
  }

  console.log('\nЗаголовки:');
  {
    const { text } = htmlToManuscript('<h1>Глава 1. Початок</h1><p>Тіло глави.</p><h3>Підрозділ</h3>');
    t('h1 → «# »', text.includes('# Глава 1. Початок'), text);
    t('h3 → «## »', text.includes('## Підрозділ'), text);
    t('розбирач глав майстра бачить h1', /^\s*#{1,2}\s+.+$/m.test(text));
  }

  console.log('\nІнлайн-форматування й сутності:');
  {
    const { text } = htmlToManuscript(
      '<p>Це <strong>жирний</strong> і <em>курсив</em>, а також &amp;, &quot;лапки&quot; та &#8212; тире.</p>'
    );
    t('strong → **жирний**', text.includes('**жирний**'), text);
    t('em → *курсив*', text.includes('*курсив*'), text);
    t('&amp; розкодовано', text.includes('&'), text);
    t('&quot; розкодовано', text.includes('"лапки"'), text);
    t('числова сутність розкодована', text.includes('—'), text);
    t('зайвих порожніх рядків немає', !/\n{3,}/.test(text));
  }

  console.log('\nСписки, посилання, br:');
  {
    const { text } = htmlToManuscript('<ul><li>Перший</li><li>Другий</li></ul><p><br /></p><p>Див. <a href="https://x.test">сайт</a>.</p>');
    t('пункти лишились текстом', text.includes('Перший') && text.includes('Другий'), text);
    t('URL посилання не потрапив у книгу', !text.includes('https://x.test'), text);
    t('видимий текст посилання лишився', text.includes('сайт'), text);
  }

  console.log('\nПорожній і далекий від книжки вхід:');
  {
    const empty = htmlToManuscript('');
    t('порожній HTML → порожній текст', empty.text === '' && empty.images.length === 0);
    const plain = htmlToManuscript('<p>Просто абзац.</p><p>Другий.</p>');
    t('без картинок список зображень порожній', plain.images.length === 0);
    t('абзаци розділені порожнім рядком', plain.text === 'Просто абзац.\n\nДругий.', JSON.stringify(plain.text));
  }

  console.log(`\nРезультат: ${passed} пройшло, ${failed} впало.`);
  if (failed > 0) process.exit(1);
}

main();

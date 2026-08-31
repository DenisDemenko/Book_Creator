/**
 * Тести клієнтської частини скіла /design (Завдання 3в).
 * Запуск: npm run test:design-suggestion
 *
 * Три речі, які тут стережуться, — саме ті, через які оформлення тихо
 * псує книгу:
 *   1) у зразок для моделі потрапляє розмітка рукопису, і модель підбирає
 *      типографіку під квадратні дужки, а не під прозу;
 *   2) список «було → стане» показує рядки, де нічого не змінилось, —
 *      автор перестає його читати, і сенс підтвердження зникає;
 *   3) застосування правки поверхневим злиттям витирає поля, яких
 *      /design не стосується (формат, виліт, дзеркальність, шрифти автора).
 */
import {
  availableFontFamilies,
  stripManuscriptMarkup,
  designSampleText,
  describeDesignChanges,
  applyDesignPatch,
  BUILT_IN_FONTS,
} from '../src/utils/designSuggestion.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const layout = () => ({
  formatPreset: '6x9',
  pageWidthMm: 152.4,
  pageHeightMm: 228.6,
  margins: { topMm: 15, bottomMm: 15, insideMm: 19, outsideMm: 13, bleedMm: 3, mirrored: true },
  typography: {
    bodyFont: 'Literata',
    headingsFont: 'Outfit',
    fontSizePt: 11,
    lineHeight: 1.4,
    firstLineIndentMm: 5,
    paragraphSpacingMm: 0,
    textAlign: 'justify',
    pageNumberPosition: 'bottom-center',
    showHeaders: true,
    showPageNumbers: true,
  },
  customFonts: [{ family: 'EB Garamond', href: 'x', addedAt: 'y' }],
  designTheme: 'classic',
}) as any;

const patch = () => ({
  typography: {
    bodyFont: 'Cormorant Garamond',
    headingsFont: 'Outfit',
    fontSizePt: 10.5,
    lineHeight: 1.4,
    firstLineIndentMm: 6,
    paragraphSpacingMm: 0,
    textAlign: 'justify',
    pageNumberPosition: 'bottom-outside',
    showHeaders: true,
  },
  margins: { topMm: 16, bottomMm: 15, insideMm: 19, outsideMm: 13 },
  rationale: 'Щільна проза потребує спокійної антикви.',
  corrections: [],
}) as any;

console.log('\nДоступні гарнітури:');
{
  const f = availableFontFamilies({ layoutConfig: layout() });
  t('вшиті гарнітури присутні', BUILT_IN_FONTS.every((x) => f.includes(x)));
  t('шрифт автора додано', f.includes('EB Garamond'));
  t('без книжкових шрифтів не падає', availableFontFamilies({ layoutConfig: { ...layout(), customFonts: undefined } }).length === BUILT_IN_FONTS.length);
  const dup = availableFontFamilies({ layoutConfig: { ...layout(), customFonts: [{ family: 'literata', href: '', addedAt: '' }] } } as any);
  t('дублікат у іншому регістрі не задвоюється', dup.filter((x) => x.toLowerCase() === 'literata').length === 1);
}

console.log('\nОчищення розмітки рукопису:');
{
  t('маркер зображення прибрано', !stripManuscriptMarkup('Текст [IMG: a1 "підпис" wrap=left width=60mm] далі').includes('IMG'));
  t('блок чернетки ШІ прибрано', !stripManuscriptMarkup('[AI-DRAFT]чернетка[/AI-DRAFT]').includes('AI-DRAFT'));
  t('текст чернетки лишився', stripManuscriptMarkup('[AI-DRAFT]чернетка[/AI-DRAFT]').includes('чернетка'));
  t('вказівка гарнітури прибрана', !stripManuscriptMarkup('[FONT="Literata"]слово').includes('FONT'));
  t('html-теги прибрано', stripManuscriptMarkup('<p>слово</p>').trim() === 'слово');
  t('порожній рядок не ламає', stripManuscriptMarkup('') === '');
  t('поділ на абзаци збережено', stripManuscriptMarkup('перший\n\nдругий').includes('\n\n'));
}

console.log('\nЗразок тексту:');
{
  const book = {
    chapters: [
      { order: 2, sections: [{ order: 1, content: 'ДРУГА глава.' }] },
      { order: 1, sections: [{ order: 2, content: 'Другий розділ.' }, { order: 1, content: 'Перший розділ.' }] },
    ],
  } as any;
  const s = designSampleText(book);
  t('глави й розділи в правильному порядку',
    s.indexOf('Перший розділ') < s.indexOf('Другий розділ') && s.indexOf('Другий розділ') < s.indexOf('ДРУГА глава'), s.replace(/\n/g, ' | '));
  t('порожня книга — порожній зразок', designSampleText({ chapters: [] } as any) === '');
  t('книга без глав не кидає', designSampleText({} as any) === '');
  const long = { chapters: [{ order: 1, sections: [{ order: 1, content: 'я'.repeat(9000) }] }] } as any;
  t('зразок обмежено', designSampleText(long, 500).length === 500);
  t('порожні розділи пропускаються', !designSampleText({ chapters: [{ order: 1, sections: [{ order: 1, content: '  ' }, { order: 2, content: 'зміст' }] }] } as any).startsWith('\n'));
}

console.log('\nСписок «було → стане»:');
{
  const ch = describeDesignChanges(layout(), patch());
  const labels = ch.map((c) => c.label);
  t('змінені поля показані', labels.includes('Гарнітура тексту') && labels.includes('Кегль') && labels.includes('Верхнє поле'));
  t('незмінені поля НЕ показані', !labels.includes('Інтерліньяж') && !labels.includes('Гарнітура заголовків') && !labels.includes('Нижнє поле'));
  t('однакові значення відсіяно повністю', describeDesignChanges(layout(), {
    ...patch(),
    typography: { ...layout().typography },
    margins: { topMm: 15, bottomMm: 15, insideMm: 19, outsideMm: 13 },
  } as any).length === 0);
  const kegl = ch.find((c) => c.label === 'Кегль')!;
  t('кегль підписано одиницями', kegl.before === '11 pt' && kegl.after === '10.5 pt');
  const pole = ch.find((c) => c.label === 'Верхнє поле')!;
  t('поля підписано міліметрами', pole.before === '15 мм' && pole.after === '16 мм');
  const num = ch.find((c) => c.label === 'Номер сторінки')!;
  t('позиція номера — людською мовою', num.after === 'внизу із зовнішнього боку');
  t('відсутнє поле в правці не вигадується',
    !describeDesignChanges(layout(), { ...patch(), typography: { ...patch().typography, bodyFont: undefined } } as any)
      .some((c) => c.label === 'Гарнітура тексту'));
  const bool = describeDesignChanges(layout(), { ...patch(), typography: { ...patch().typography, showHeaders: false } } as any)
    .find((c) => c.label === 'Колонтитули')!;
  t('перемикач описано словами', bool.before === 'показувати' && bool.after === 'сховати');
}

console.log('\nЗастосування правки:');
{
  const book = { id: 'b1', title: 'Кристал', layoutConfig: layout() } as any;
  const out = applyDesignPatch(book, patch());
  t('нові значення застосовані', out.layoutConfig.typography.fontSizePt === 10.5 && out.layoutConfig.margins.topMm === 16);
  t('формат сторінки не зачеплено', out.layoutConfig.formatPreset === '6x9' && out.layoutConfig.pageWidthMm === 152.4);
  t('виліт під обріз збережено', out.layoutConfig.margins.bleedMm === 3);
  t('дзеркальність збережена', out.layoutConfig.margins.mirrored === true);
  t('шрифти автора збережені', out.layoutConfig.customFonts?.[0]?.family === 'EB Garamond');
  t('нумерація сторінок збережена', out.layoutConfig.typography.showPageNumbers === true);
  t('вихідну книгу не мутовано', book.layoutConfig.typography.fontSizePt === 11);
  t('решта книги на місці', out.title === 'Кристал' && out.id === 'b1');

  // Модель не назвала гарнітуру — лишаємо теперішню, а не порожню.
  const noFont = applyDesignPatch(book, { ...patch(), typography: { ...patch().typography, bodyFont: '' } } as any);
  t('порожня гарнітура не затирає наявну', noFont.layoutConfig.typography.bodyFont === 'Literata');
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

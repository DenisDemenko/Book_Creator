/**
 * Тести модуля `/design` (server/designLayoutPrompt.ts): шаблон, розбір
 * відповіді моделі й — головне — приведення її чисел до друкарських меж.
 * Запуск: npm run test:design-layout
 */
import {
  factoryDesignLayoutTemplate,
  renderDesignLayoutTemplate,
  designLayoutSystemInstruction,
  clampDesignPatch,
  parseDesignResponse,
  MIN_MARGIN_MM,
  MAX_MARGIN_MM,
} from '../server/designLayoutPrompt.ts';
import {
  CORE_MODULE_KEYS,
  CORE_MODULE_HAS_JSON_SCHEMA,
  factoryCoreTemplate,
  resolveCoreTemplate,
  renderCoreTemplate,
  splitAtSchemaMarker,
} from '../server/coreAiRegistry.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const FONTS = ['Literata', 'PT Serif', 'Inter'];
const SAMPLE = 'Скляні куполи Верхнього Печерська відбивали перші промені холодного серпневого сонця. '.repeat(4);

console.log('\nШаблон:');
{
  const tpl = factoryDesignLayoutTemplate();
  t('містить перелік гарнітур', tpl.includes('{ШРИФТИ}'));
  t('містить фрагмент тексту', tpl.includes('{ФРАГМЕНТ}'));
  t('системна інструкція несе схему', designLayoutSystemInstruction().includes('"lineHeight"'));

  const rendered = renderDesignLayoutTemplate(tpl, {
    bookTitle: 'Тіні Нео-Києва',
    genre: 'кіберпанк',
    audience: 'дорослі 25+',
    pageFormat: '152×229 мм',
    availableFonts: FONTS.join(', '),
    sampleText: SAMPLE,
  });
  t('усі значення підставились', rendered.includes('Тіні Нео-Києва') && rendered.includes('Literata') && rendered.includes('152×229'));
  t('без невитертих плейсхолдерів', !/\{[А-ЯІЇЄҐ_]+\}/.test(rendered));

  const sparse = renderDesignLayoutTemplate(tpl, { availableFonts: FONTS.join(', '), sampleText: SAMPLE });
  t('порожні поля прибирають свої абзаци', !sparse.includes('Жанр:') && !sparse.includes('Цільова аудиторія:'));
}

console.log('\nСхема захищена від правок адміна:');
{
  t('модуль позначений як JSON-схемний', CORE_MODULE_HAS_JSON_SCHEMA.designLayout === true);
  t('модуль у переліку ядра', (CORE_MODULE_KEYS as readonly string[]).includes('designLayout'));

  const factory = factoryCoreTemplate('designLayout');
  const split = splitAtSchemaMarker(factory.system);
  t('схема відділяється маркером', split.schema.includes('"typography"'));

  // Адмін «переписав» системну інструкцію без схеми — вона має повернутись.
  const resolved = resolveCoreTemplate('designLayout', {
    designLayout: { system: 'Ти — суворий типограф.', user: 'Оформи {НАЗВА_КНИГИ}.' },
  });
  t('схема дописується назад до адмінського тексту', resolved.system.includes('"lineHeight"'));
  t('текст адміна збережено', resolved.system.includes('суворий типограф'));
}

console.log('\nРозбір відповіді моделі:');
{
  t('чистий JSON', parseDesignResponse('{"a":1}').a === 1);
  t('JSON в markdown-обгортці', parseDesignResponse('```json\n{"a":2}\n```').a === 2);
  let threw = false;
  try { parseDesignResponse('це не json'); } catch { threw = true; }
  t('сміття кидає помилку, а не тихо проходить', threw);
}

console.log('\nПриведення до друкарських меж:');
{
  const good = clampDesignPatch(
    {
      typography: {
        bodyFont: 'Literata', headingsFont: 'Inter', fontSizePt: 10.5, lineHeight: 1.45,
        firstLineIndentMm: 5, paragraphSpacingMm: 0, textAlign: 'justify',
        pageNumberPosition: 'bottom-outside', showHeaders: true,
      },
      margins: { topMm: 20, bottomMm: 20, insideMm: 19, outsideMm: 15 },
      rationale: 'Класична антиква для довгої прози.',
    },
    FONTS
  );
  t('коректні значення проходять без правок', good.corrections.length === 0, good.corrections.join('; '));
  t('гарнітури збережено', good.typography.bodyFont === 'Literata' && good.typography.headingsFont === 'Inter');
  t('пояснення збережено', good.rationale.includes('антиква'));

  const bad = clampDesignPatch(
    {
      typography: {
        bodyFont: 'Comic Sans', fontSizePt: 6, lineHeight: 3.5, firstLineIndentMm: 40,
        paragraphSpacingMm: 30, textAlign: 'center', pageNumberPosition: 'середина', showHeaders: true,
      },
      margins: { topMm: 2, bottomMm: 2, insideMm: 4, outsideMm: 2 },
    },
    FONTS
  );
  t('невідома гарнітура відкинута', bad.typography.bodyFont === undefined);
  t('кегль піднято до мінімуму', bad.typography.fontSizePt === 8);
  t('інтерліньяж опущено до максимуму', bad.typography.lineHeight === 2);
  t('корінець піднято до друкарського мінімуму', bad.margins.insideMm === MIN_MARGIN_MM.inside);
  t('верхнє поле піднято до мінімуму', bad.margins.topMm === MIN_MARGIN_MM.top);
  t('невідоме вирівнювання зведено до justify', bad.typography.textAlign === 'justify');
  t('невідома колонцифра зведена до низу по центру', bad.typography.pageNumberPosition === 'bottom-center');
  t('усі правки перелічені для автора', bad.corrections.length >= 5, String(bad.corrections.length));

  const huge = clampDesignPatch({ margins: { topMm: 200, bottomMm: 200, insideMm: 200, outsideMm: 200 } }, FONTS);
  t('надмірні поля обрізані згори', huge.margins.topMm === MAX_MARGIN_MM);

  const empty = clampDesignPatch({}, FONTS);
  t('порожня відповідь дає робочі значення за замовчуванням', empty.typography.fontSizePt === 11 && empty.margins.insideMm === 19);
  t('порожня відповідь не вигадує гарнітуру', empty.typography.bodyFont === undefined);

  const nonsense = clampDesignPatch({ typography: { fontSizePt: 'багато', lineHeight: null } }, FONTS);
  t('нечислові значення відкочуються на дефолт', nonsense.typography.fontSizePt === 11 && nonsense.typography.lineHeight === 1.45);
}

console.log('\nРендер через реєстр ядра:');
{
  const template = resolveCoreTemplate('designLayout');
  const rendered = renderCoreTemplate('designLayout', template, {
    bookTitle: 'Тіні Нео-Києва',
    availableFonts: FONTS.join(', '),
    // Форма конструктора шле фрагмент під ключем `selection` — модуль має його прийняти.
    selection: SAMPLE,
  });
  t('фрагмент із поля конструктора дійшов у промпт', rendered.user.includes('Скляні куполи'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

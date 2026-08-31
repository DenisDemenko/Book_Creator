/**
 * Тести модуля «Абзац за виділеним фрагментом» (завдання 3б):
 * server/selectionParagraphsPrompt.ts + його реєстрація в «Ядрі AI».
 * Запуск: npm run test:selection-paragraphs
 *
 * Чисті функції, без Express і БД — той самий підхід, що в решті scripts/.
 */
import {
  factorySelectionParagraphsTemplate,
  renderSelectionParagraphsTemplate,
  buildSelectionParagraphsPrompt,
  selectionParagraphsSystemInstruction,
  type SelectionParagraphsPromptValues,
} from '../server/selectionParagraphsPrompt.ts';
import {
  CORE_MODULE_KEYS,
  CORE_MODULE_PLACEHOLDERS,
  CORE_MODULE_HAS_JSON_SCHEMA,
  factoryCoreTemplate,
  resolveCoreTemplate,
  renderCoreTemplate,
  usedCorePlaceholders,
} from '../server/coreAiRegistry.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const SELECTION = 'Вона стояла біля вікна й дивилась, як над дахами піднімається дим. Місто прокидалось повільно, ніби не хотіло.';

const fullValues: SelectionParagraphsPromptValues = {
  selection: SELECTION,
  language: 'uk',
  paragraphCount: 2,
  bookTitle: 'Тіні Нео-Києва',
  genre: 'кіберпанк',
  chapterTitle: 'Глава 3',
  styleGuide: 'Короткі речення. Багато дієслів.',
  contextAfter: 'Двері зачинились за її спиною.',
};

console.log('\nЗаводський шаблон:');
{
  const tpl = factorySelectionParagraphsTemplate();
  t('шаблон непорожній', tpl.trim().length > 100);
  t('містить плейсхолдер виділення', tpl.includes('{ФРАГМЕНТ}'));
  t('містить кількість абзаців і обсяг', tpl.includes('{КІЛЬКІСТЬ_АБЗАЦІВ}') && tpl.includes('{ОБСЯГ}'));
  t('системна інструкція непорожня', selectionParagraphsSystemInstruction().length > 20);
}

console.log('\nПідстановка значень:');
{
  const out = renderSelectionParagraphsTemplate(factorySelectionParagraphsTemplate(), fullValues);
  t('виділення потрапило в промпт', out.includes(SELECTION));
  t('назва книги підставлена', out.includes('Тіні Нео-Києва'));
  t('жанр підставлений', out.includes('кіберпанк'));
  t('розділ підставлений', out.includes('Глава 3'));
  t('файл стилю підставлений', out.includes('Багато дієслів'));
  t('контекст після виділення підставлений', out.includes('Двері зачинились'));
  t('кількість абзаців словами', out.includes('ДВА абзаци'));
  t('бюджет слів для 2 абзаців', out.includes('150-230'));
  t('мова відповіді названа', out.includes('УКРАЇНСЬКОЮ'));
  t('жодного невитертого плейсхолдера', !/\{[А-ЯІЇЄҐ_]+\}/.test(out), out.match(/\{[А-ЯІЇЄҐ_]+\}/)?.[0] || '');
}

console.log('\nПорожні поля прибирають свій абзац:');
{
  const out = renderSelectionParagraphsTemplate(factorySelectionParagraphsTemplate(), { selection: SELECTION });
  t('виділення на місці', out.includes(SELECTION));
  t('немає порожнього рядка «Жанр: .»', !out.includes('Жанр:'));
  t('немає порожнього рядка «Розділ: .»', !out.includes('Розділ:'));
  t('немає блоку стилю', !out.includes('аналіз авторського стилю'));
  t('немає блоку контексту після', !out.includes('ОДРАЗУ ПІСЛЯ виділення'));
  t('за замовчуванням один абзац', out.includes('ОДИН абзац'));
  t('жодного невитертого плейсхолдера', !/\{[А-ЯІЇЄҐ_]+\}/.test(out));
}

console.log('\nАнглійський редактор:');
{
  const out = renderSelectionParagraphsTemplate(factorySelectionParagraphsTemplate(), {
    ...fullValues,
    language: 'en',
    paragraphCount: 3,
  });
  t('кількість абзаців англійською', out.includes('THREE paragraphs'));
  t('мова відповіді — англійська', out.includes('АНГЛІЙСЬКОЮ'));
  t('бюджет слів для 3 абзаців', out.includes('230-340'));
}

console.log('\nОбрізання надто довгого входу:');
{
  // Наповнювач — символ, якого свідомо немає в тексті самого шаблону,
  // інакше .match() зловив би першу-ліпшу літеру інструкції, а не вставку.
  const huge = '§'.repeat(20000);
  const out = renderSelectionParagraphsTemplate(factorySelectionParagraphsTemplate(), { selection: huge });
  t('виділення обрізане до 6000 символів', (out.match(/§+/)?.[0].length ?? 0) === 6000, String(out.match(/§+/)?.[0].length));

  const longStyle = renderSelectionParagraphsTemplate(factorySelectionParagraphsTemplate(), {
    selection: SELECTION,
    styleGuide: '¤'.repeat(9000),
  });
  t('файл стилю обрізаний до 3000 символів', (longStyle.match(/¤+/)?.[0].length ?? 0) === 3000, String(longStyle.match(/¤+/)?.[0].length));
}

console.log('\nВласний обсяг від адміна:');
{
  const out = renderSelectionParagraphsTemplate(factorySelectionParagraphsTemplate(), {
    selection: SELECTION,
    paragraphCount: 1,
    wordBudget: '400-500',
  });
  t('поле «Обсяг» з форми перекриває розрахунок', out.includes('400-500') && !out.includes('70-110'));
}

console.log('\nРеєстрація в «Ядрі AI»:');
{
  t('модуль у переліку ключів', (CORE_MODULE_KEYS as readonly string[]).includes('selectionToParagraphs'));
  t('має свої плейсхолдери', CORE_MODULE_PLACEHOLDERS.selectionToParagraphs.includes('{ФРАГМЕНТ}'));
  t('не JSON-модуль', CORE_MODULE_HAS_JSON_SCHEMA.selectionToParagraphs === false);

  const factory = factoryCoreTemplate('selectionToParagraphs');
  t('заводський шаблон має обидві половини', factory.system.length > 10 && factory.user.includes('{ФРАГМЕНТ}'));

  const resolved = resolveCoreTemplate('selectionToParagraphs', {
    selectionToParagraphs: { system: 'Адмінська інструкція.', user: 'Розвинь: {ФРАГМЕНТ}' },
  });
  t('адмінський шар перекриває заводський', resolved.system === 'Адмінська інструкція.');

  const rendered = renderCoreTemplate('selectionToParagraphs', resolved, {
    selection: SELECTION,
    paragraphCount: '3',
    language: 'uk',
  });
  t('рендер через реєстр підставляє виділення', rendered.user.includes(SELECTION));

  // Порожній шар — тихий відкат на заводський, а не порожній запит.
  const emptyLayer = resolveCoreTemplate('selectionToParagraphs', {
    selectionToParagraphs: { system: '   ', user: '  ' },
  });
  t('порожній адмінський шар відкочується на заводський', emptyLayer.user.includes('{ФРАГМЕНТ}'));

  t('usedCorePlaceholders бачить ужиті токени', usedCorePlaceholders('selectionToParagraphs', 'Ось {ФРАГМЕНТ} і {ЖАНР}').length === 2);

  // Сміття в кількості абзаців не має ламати рендер — роут відсікає так само.
  const junk = renderCoreTemplate('selectionToParagraphs', factory, { selection: SELECTION, paragraphCount: '99' });
  t('некоректна кількість абзаців відкочується на 1', junk.user.includes('ОДИН абзац'));
}

console.log('\nЗаводська збірка промту:');
{
  const built = buildSelectionParagraphsPrompt(fullValues);
  t('повертає system і user', built.system.length > 10 && built.user.includes(SELECTION));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

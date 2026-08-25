/**
 * Тести шаблонів «Конструктора промтів» (server/promptTemplates.ts):
 * зведення трьох шарів (автор → адмін → заводський), підстановка
 * плейсхолдерів і поведінка на зіпсованому шаблоні.
 * Запуск: npm run test:prompt-templates
 *
 * Чисті функції, без Express і БД — той самий підхід, що в решті scripts/.
 */
import {
  PLACEHOLDERS,
  factoryTemplate,
  factoryTemplateSet,
  resolveTemplate,
  renderTemplate,
  usedPlaceholders,
  buildPromptFromTemplate,
  buildFactoryPrompt,
  type PromptTemplateBundle,
  type PromptPlaceholderValues,
} from '../server/promptTemplates.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

const fullValues: PromptPlaceholderValues = {
  language: 'uk',
  paragraphCount: 2,
  bookTitle: 'Тіні Нео-Києва',
  genre: 'кіберпанк',
  chapterTitle: 'Глава 3',
  imageCaption: 'Львів, 1943',
  styleGuide: 'Короткі речення. Багато дієслів.',
  contextBefore: 'Вона стояла біля вікна.',
  contextAfter: 'Двері зачинились.',
};

console.log('\nЗаводські шаблони:');
{
  const set = factoryTemplateSet();
  t('є шаблони на 1, 2 і 3 абзаци', !!set['1'] && !!set['2'] && !!set['3']);
  t('у промпті користувача є плейсхолдери', usedPlaceholders(set['2'].user).length > 0);
  t('є системна інструкція', set['2'].system.trim().length > 0);
  t('{ПІДПИС_ФОТО} присутній — підпис автора більше не викидається',
    set['1'].user.includes('{ПІДПИС_ФОТО}'));
}

console.log('\nresolveTemplate — три шари:');
{
  const admin: PromptTemplateBundle = {
    manuscriptPhoto: { '2': { system: 'АДМІН-СИСТЕМА', user: 'АДМІН-ПРОМПТ {МОВА}' } },
  };
  const user: PromptTemplateBundle = {
    manuscriptPhoto: { '2': { system: '', user: 'АВТОР-ПРОМПТ {МОВА}' } },
  };

  t('без шарів — заводський', resolveTemplate(2).user === factoryTemplate(2).user);
  t('шар адміна перекриває заводський', resolveTemplate(2, undefined, admin).user === 'АДМІН-ПРОМПТ {МОВА}');
  t('шар автора перекриває адмінський', resolveTemplate(2, user, admin).user === 'АВТОР-ПРОМПТ {МОВА}');
  t('ПОРОЖНЄ поле автора тихо відкочується на шар нижче (адмінський)',
    resolveTemplate(2, user, admin).system === 'АДМІН-СИСТЕМА',
    resolveTemplate(2, user, admin).system);
  t('шар, у якому немає цієї кількості абзаців, не заважає',
    resolveTemplate(1, user, admin).user === factoryTemplate(1).user);
}

console.log('\nrenderTemplate — підстановка:');
{
  const out = renderTemplate('Книга «{НАЗВА_КНИГИ}», жанр {ЖАНР}, підпис «{ПІДПИС_ФОТО}».', fullValues);
  t('підставляє назву, жанр і підпис фото',
    out === 'Книга «Тіні Нео-Києва», жанр кіберпанк, підпис «Львів, 1943».', out);

  t('{МОВА} для української', renderTemplate('{МОВА}', fullValues) === 'УКРАЇНСЬКОЮ');
  t('{МОВА} для англійської',
    renderTemplate('{МОВА}', { ...fullValues, language: 'en' }).includes('АНГЛІЙСЬКОЮ'));
  t('{КІЛЬКІСТЬ_АБЗАЦІВ} словами', renderTemplate('{КІЛЬКІСТЬ_АБЗАЦІВ}', fullValues) === 'ДВА абзаци');
  t('{СЛІВ} — бюджет слів для цієї кількості', renderTemplate('{СЛІВ}', fullValues) === '150-230');
  t('бюджет для 1 абзацу інший',
    renderTemplate('{СЛІВ}', { ...fullValues, paragraphCount: 1 }) === '70-110');
}

console.log('\nrenderTemplate — порожні дані прибирають свій абзац:');
{
  const template = 'Перший абзац.\n\nСтиль автора:\n"""\n{СТИЛЬ}\n"""\n\nОстанній абзац.';
  const withStyle = renderTemplate(template, fullValues);
  t('зі стилем — абзац лишається', withStyle.includes('Короткі речення.'));

  const noStyle = renderTemplate(template, { ...fullValues, styleGuide: undefined });
  t('без стилю — абзац зникає ЦІЛКОМ, без висячої підводки',
    !noStyle.includes('Стиль автора') && !noStyle.includes('"""'), noStyle);
  t('сусідні абзаци не постраждали',
    noStyle.includes('Перший абзац.') && noStyle.includes('Останній абзац.'));
}

{
  const template = 'Напиши {КІЛЬКІСТЬ_АБЗАЦІВ} про «{ПІДПИС_ФОТО}».';
  const out = renderTemplate(template, { ...fullValues, imageCaption: undefined });
  t('абзац із ЗМІШАНИМИ плейсхолдерами лишається, порожній просто зникає',
    out === 'Напиши ДВА абзаци про «».', out);
}

console.log('\nrenderTemplate — межі:');
{
  const longStyle = 'я'.repeat(5000);
  const out = renderTemplate('{СТИЛЬ}', { ...fullValues, styleGuide: longStyle });
  t('файл стилю обрізається до 3000 символів', out.length === 3000, String(out.length));

  const longBefore = 'а'.repeat(2000) + 'КІНЕЦЬ';
  const before = renderTemplate('{КОНТЕКСТ_ДО}', { ...fullValues, contextBefore: longBefore });
  t('абзац ПЕРЕД фото береться з КІНЦЯ (останні 700 символів)',
    before.endsWith('КІНЕЦЬ') && before.length === 700, String(before.length));

  const longAfter = 'ПОЧАТОК' + 'б'.repeat(2000);
  const after = renderTemplate('{КОНТЕКСТ_ПІСЛЯ}', { ...fullValues, contextAfter: longAfter });
  t('абзац ПІСЛЯ фото береться з ПОЧАТКУ (перші 700 символів)',
    after.startsWith('ПОЧАТОК') && after.length === 700, String(after.length));
}

console.log('\nusedPlaceholders:');
{
  t('знаходить наявні', usedPlaceholders('{МОВА} і {ЖАНР}').length === 2);
  t('порожньо, коли підстановок немає', usedPlaceholders('просто текст').length === 0);
  t('усі задекларовані підстановки розпізнаються',
    usedPlaceholders(PLACEHOLDERS.join(' ')).length === PLACEHOLDERS.length);
}

console.log('\nbuildPromptFromTemplate / buildFactoryPrompt:');
{
  const built = buildPromptFromTemplate(
    { system: 'СИСТЕМА', user: 'Книга «{НАЗВА_КНИГИ}»' },
    fullValues
  );
  t('повертає і system, і user', built.system === 'СИСТЕМА' && built.user === 'Книга «Тіні Нео-Києва»');

  const noPlaceholders = buildPromptFromTemplate({ system: 'С', user: 'Просто пиши' }, fullValues);
  t('шаблон БЕЗ підстановок виконується як написано (це легальний вибір автора)',
    noPlaceholders.user === 'Просто пиши');

  const factory = buildFactoryPrompt(fullValues);
  t('заводський шлях (гість) будує непорожній промпт', factory.user.length > 100 && factory.system.length > 0);
  t('заводський шлях згадує назву книги', factory.user.includes('Тіні Нео-Києва'));
}

console.log(`\n${pass} пройдено, ${fail} провалено\n`);
if (fail > 0) process.exit(1);

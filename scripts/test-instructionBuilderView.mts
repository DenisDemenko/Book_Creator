/**
 * Конструктор інструкцій — перевірка НА РЕАЛЬНОМУ КОМПОНЕНТІ, без браузера.
 * Запуск: npm run test:instruction-builder-view
 *
 * Той самий прийом, що й у test-pageRuler.mts: `renderToStaticMarkup`
 * рендерить справжній InstructionBuilderView.tsx (не переказ розмітки), тож
 * тест ловить розсинхрон між кодом і тим, що реально виявиться на екрані —
 * наприклад, якщо хтось перейменує ключ розділу в instructionTypes.ts, але
 * забуде оновити `type.sections[key]` десь у компоненті.
 *
 * `localStorage` у Node відсутній — loadInstructionDraft() ловить це сама
 * (try/catch, повертає null), тож перший рендер завжди стартує без чернетки:
 * тип за замовчуванням «Зі складання», і одразу відкритий діалог вибору
 * типу (як і в живому застосунку при першому вході без збереженої чернетки).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { InstructionBuilderView } from '../src/components/InstructionBuilderView.tsx';
import { INSTRUCTION_TYPES } from '../src/data/instructionTypes.ts';
import { createEmptyInstruction, createEmptyStep } from '../src/utils/instructionDraft.ts';

let pass = 0, fail = 0;
const t = (n: string, c: boolean, e = '') => { c ? pass++ : fail++; console.log(`${c ? '  ✓' : '  ✗'} ${n}${e ? ' — ' + e : ''}`); };

console.log('\nПерший вхід (без чернетки в localStorage):');
{
  const html = renderToStaticMarkup(React.createElement(InstructionBuilderView, {}));
  t('рендериться без винятку', html.length > 0);
  t('за замовчуванням тип «Зі складання»', html.includes('ІНСТРУКЦІЯ ЗІ СКЛАДАННЯ'));
  t('діалог вибору типу відкритий одразу', html.includes('Оберіть тип документа'));
  t('усі чотири картки типу показані в діалозі', INSTRUCTION_TYPES.every((x) => html.includes(x.cardTitle)));
  t('бічна навігація показує всі 9 розділів типу «Зі складання»',
    ['Опис виробу', 'Комплектація', 'Інструменти', 'Безпека', 'Кроки складання', 'Фінальна перевірка', 'Типові помилки', 'Гарантія', 'База знань']
      .every((label) => html.includes(label)));
  t('кнопка «Додати крок» присутня', html.includes('Додати крок'));
  t('кнопки верхньої панелі присутні', html.includes('Експорт') && html.includes('Друкувати / PDF'));
  t('прев\'ю документа показує назву-плейсхолдер', html.includes('Новий виріб'));
  t('перемикачі типу документа в розділі 1 присутні (без втрати даних)',
    INSTRUCTION_TYPES.every((x) => html.includes(x.cardSubtitle)));
}

// Компонент сам тримає активний тип у useState (не пропс), тож
// renderToStaticMarkup не може відрендерити його одразу в кожному з 4
// станів — перший рендер завжди стартує з «Зі складання» (перевірено вище).
// Те, що індексація `type.sections[key]` не впаде для ІНШИХ трьох типів,
// вичерпно покрито в test-instructionTypes.mts (кожен ключ кожного типу
// звірено окремо). Тут лишається перевірити те, чого той файл не бачить:
// що компонент справді знає іконку для кожного з 4 ідентифікаторів типу —
// пропущений запис у TYPE_ICONS обвалив би рендер лише ПІСЛЯ перемикання
// на цей тип, у браузері, а не одразу.
console.log('\nБез onChangeTrack кнопка «До вибору напряму» не рендериться:');
{
  const html = renderToStaticMarkup(React.createElement(InstructionBuilderView, {}));
  t('кнопки немає, коли onChangeTrack не передано', !html.includes('До вибору напряму'));
}

console.log('\nЗ onChangeTrack кнопка «До вибору напряму» з\'являється:');
{
  const html = renderToStaticMarkup(React.createElement(InstructionBuilderView, { onChangeTrack: () => {} }));
  t('кнопка є, коли onChangeTrack передано', html.includes('До вибору напряму'));
}

console.log('Кадри кроків у перегляді й друці:');
{
  const doc = createEmptyInstruction('assembly');
  doc.title = 'Стіл';
  doc.steps = [
    { ...createEmptyStep(), id: 's1', title: 'Огляд', description: 'Подивіться на схему.', images: [{ assetId: 'a1', url: '/api/media/file/a1', caption: 'Огляд, кадр 1' }, { assetId: 'a2', url: '/api/media/file/a2' }] },
    { ...createEmptyStep(), id: 's2', title: 'Кріплення', description: 'Закрутіть болти.' },
  ];
  const html = renderToStaticMarkup(React.createElement(InstructionBuilderView, { initialInstruction: doc }));
  t('кадри кроку показані в перегляді', html.includes('/api/media/file/a1') && html.includes('/api/media/file/a2') && html.includes('data-step-images'));
  t('підпис кадру показано, а без підпису — альтернативний текст кроку', html.includes('Огляд, кадр 1') && html.includes('alt="Крок 1, кадр 2"') || html.includes('кадр 2'));
  t('кадри лише у кроку, що їх має (2 кадри × панель і вузький екран)', (html.match(/<figure/g) || []).length === 4, String((html.match(/<figure/g) || []).length));
  t('«Друкувати / PDF» відкриває вибір, а не друк напряму', html.includes('data-instruction-print') && !html.includes('data-pdf-choice'));
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

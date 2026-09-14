/**
 * Контракт блоку «Швидка типографіка + вставки» в тулбарі редактора.
 * Запуск: npm run test:editor-toolbar
 *
 * НАВІЩО. Власник попросив прибрати з кнопок цього блоку видимий текст —
 * підписи зʼїдали місце для правки книги, — лишивши самі іконки з підказкою
 * при наведенні. Ця вимога тримається на дрібниці, яку легко зламати під час
 * наступної правки: підпис має жити в `title` і `aria-label`, а НЕ як текст
 * усередині кнопки. Тому кожен підпис перевіряється на місце, де він стоїть.
 *
 * Чому перевірка читає вихідний файл, а не рендерить компонент: React-тестів
 * із DOM у проєкті немає, а тягнути jsdom заради десяти кнопок — окрема
 * інфраструктура. Тут читається текст `EditorView.tsx`.
 */
import fs from 'node:fs';
import path from 'node:path';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const SRC = path.resolve('src/components/EditorView.tsx');
const src = fs.readFileSync(SRC, 'utf8');
const lines = src.split(/\r?\n/);

/** Рядки, у яких ключ стоїть у позиції видимого тексту кнопки: `{t('…')}` сам собою. */
const asVisibleText = (key: string) =>
  lines.some((l) => new RegExp(`^\\s*\\{t\\('${key}'\\)\\}`).test(l));

/** Рядки, де ключ використано як атрибут (підказка або підпис для скрін-рідера). */
const asAttribute = (key: string, attr: 'label' | 'title') =>
  lines.some((l) => l.includes(`t('${key}')`) && new RegExp(`${attr}=\\{`).test(l));

/** Підписи, які мають лишитися ТІЛЬКИ в підказці (title) і для скрін-рідера (aria-label). */
const LABELS = [
  'editor.dashBtn',
  'editor.quotesBtn',
  'editor.insertFootnoteBtn',
  'editor.insertQrBtn',
  'editor.imgFromGalleryBtn',
  'editor.insertIllustrationBtn',
  'editor.insertBookTagBtn',
  'editor.showTagsBtn',
  'editor.hideTagsBtn',
  'editor.gotoTagBtn',
];

/** Підказки — вони були в коді й до правки, тож перевіряємо, що не зникли. */
const TITLES = [
  'editor.dashTitle',
  'editor.quotesTitle',
  'editor.ellipsisTitle',
  'editor.insertFootnoteTitle',
  'editor.insertQrTitle',
  'editor.imgFromGalleryTitle',
  'editor.insertIllustrationTitle',
  'editor.insertTagTitle',
  'editor.hideTagsTitle',
  'editor.showTagsTitle',
  'editor.gotoTagTitle',
];

console.log('Спільний хелпер кнопки:');
{
  t('хелпер IconToolBtn оголошено', src.includes('const IconToolBtn: React.FC<{'));
  t('кнопка має title (нативна підказка)', src.includes('title={title}'));
  t('кнопка має aria-label (підпис для скрін-рідера)', src.includes('aria-label={label}'));
  t('видимий текст усередині кнопки не малюється', !/\{label\}\s*<\/button>/.test(src));
}

console.log('\nПідписи живуть у підказці, а не в тексті кнопки:');
for (const key of LABELS) {
  t(`«${key}» використано`, src.includes(`t('${key}')`));
  // Головна вимога власника: підпис не має бути видно на кнопці.
  t(`«${key}» не надруковано на кнопці`, !asVisibleText(key));
  // І водночас він не має зникнути зовсім: скрін-рідер читає саме aria-label.
  t(`«${key}» їде в label`, asAttribute(key, 'label'));
}

console.log('\nПідказки при наведенні на місці:');
for (const key of TITLES) {
  t(`«${key}» використовується як title`, asAttribute(key, 'title'));
}

console.log('\nІконки (без них кнопка стала б порожньою):');
for (const icon of ['Minus', 'TextQuote', 'MoreHorizontal', 'BookMarked', 'QrCode', 'ImagePlus', 'Sparkles', 'Tag', 'Eye', 'EyeOff', 'CornerDownRight']) {
  t(`іконка ${icon} у блоці`, src.includes(`<${icon} `));
}

console.log('\nЛогіка не зачеплена:');
{
  // Поповер «Перейти до тегу» позиціонується від кнопки — втрата ref зламала б
  // його без будь-якої помилки збірки.
  t('кнопка «Перейти до тегу» отримує btnRef', src.includes('btnRef={tagMenuBtnRef}'));
  t('обробники вставок ті самі', ['insertTextAtCursor(\'— \')', "insertTextAtCursor('«»')", "insertTextAtCursor('…')", 'setShowFootnoteModal(true)', 'setShowQrModal(true)', 'setShowInsertImageModal(true)', 'setShowIllustrationModal(true)', 'handleInsertTag', 'setTagsHidden((v) => !v)', 'openTagMenu'].every((s) => src.includes(s)));
  t('розділювачі блоку лишились', (src.match(/h-4 w-px bg-slate-800/g) || []).length >= 3);
}

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);

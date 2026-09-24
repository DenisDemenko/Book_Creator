/**
 * Плаваючий блок інструментів редактора (запис #235). Запуск: npm run test:tool-dock
 *
 * Дві частини:
 *  1. Геометрія (`src/utils/toolDockLayout.ts`) — до якого краю прилипнути,
 *     скільки місця звільнити полю тексту, як відновити зіпсований стан.
 *  2. Контракт `EditorView.tsx` (читаємо вихідний текст — DOM-тестів у
 *     проєкті немає): над полем тексту не лишилося смуг, а всі функції, що
 *     там жили, тепер у блоці. Саме це легко тихо зламати наступною правкою.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_TOOL_DOCK,
  DOCK_GAP,
  SNAP_DISTANCE,
  TOOL_DOCK_MIN_WIDTH,
  dockWidth,
  normalizeToolDockState,
  reserveFor,
  snapTarget,
} from '../src/utils/toolDockLayout';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const anchor = { left: 300, top: 100, right: 1300, bottom: 900 };
const box = (left: number, top: number, w = 400, h = 60) => ({ left, top, right: left + w, bottom: top + h });

console.log('Примагнічування:');
t('біля верху поля → top', snapTarget(box(600, 110), anchor) === 'top');
t('біля низу поля → bottom', snapTarget(box(600, 830), anchor) === 'bottom');
t('біля лівого краю (меню студії) → left', snapTarget(box(310, 400), anchor) === 'left');
t('біля правої панелі → right', snapTarget(box(890, 400), anchor) === 'right');
t('посередині — вільно (null)', snapTarget(box(600, 400), anchor) === null);
t('межа рівно на відстані притягування — ще липне', snapTarget(box(600, 100 + SNAP_DISTANCE), anchor) === 'top');
t('на піксель далі — вже ні', snapTarget(box(600, 100 + SNAP_DISTANCE + 1), anchor) === null);
t('кут: перемагає ближчий край', snapTarget(box(302, 120), anchor) === 'left');

console.log('\nМісце під прилиплим блоком:');
const size = { width: 210.4, height: 88.2 };
t('вільний блок нічого не забирає', JSON.stringify(reserveFor(null, size)) === JSON.stringify({ top: 0, bottom: 0, left: 0, right: 0 }));
t('згори — висота блока + проміжок', reserveFor('top', size).top === 89 + DOCK_GAP);
t('знизу — висота блока + проміжок', reserveFor('bottom', size).bottom === 89 + DOCK_GAP);
t('ліворуч — ширина блока + проміжок', reserveFor('left', size).left === 211 + DOCK_GAP);
t('праворуч — ширина блока + проміжок', reserveFor('right', size).right === 211 + DOCK_GAP);
t('резерв лише з одного боку', Object.values(reserveFor('right', size)).filter(Boolean).length === 1);

console.log('\nШирина:');
t('згори/знизу — на всю ширину поля', dockWidth({ ...DEFAULT_TOOL_DOCK, dock: 'top' }, anchor) === 1000);
t('збоку — власна ширина колонки', dockWidth({ ...DEFAULT_TOOL_DOCK, dock: 'left', vw: 220 }, anchor) === 220);
t('вільний — власна ширина', dockWidth({ ...DEFAULT_TOOL_DOCK, dock: null, w: 640 }, anchor) === 640);

console.log('\nВідновлення збереженого стану:');
const vp = { width: 1440, height: 900 };
t('сміття → типовий стан (прилип згори)', normalizeToolDockState('xx', vp).dock === 'top');
t('null — «вільний», а не типовий', normalizeToolDockState({ dock: null }, vp).dock === null);
t('невідомий край → типовий', normalizeToolDockState({ dock: 'diagonal' }, vp).dock === DEFAULT_TOOL_DOCK.dock);
t('позиція за межами вікна затискається', (() => { const s = normalizeToolDockState({ dock: null, x: 5000, y: -40 }, vp); return s.x <= vp.width - 80 && s.y === 0; })());
t('ширина не менша за мінімальну', normalizeToolDockState({ w: 10, vw: 10 }, vp).w === TOOL_DOCK_MIN_WIDTH);
t('ширина не більша за вікно', normalizeToolDockState({ w: 99999 }, vp).w === vp.width - 16);
t('згорнутість зберігається лише як true', normalizeToolDockState({ minimized: 'yes' }, vp).minimized === false);

console.log('\nКонтракт EditorView: над полем тексту — нічого:');
const src = fs.readFileSync(path.resolve('src/components/EditorView.tsx'), 'utf8');
const main = src.slice(src.indexOf('{/* LEFT / CENTER: MAIN WRITING AREA'), src.indexOf('{/* 1. SINGLE UA MODE'));
t('немає шапки з назвою розділу', !src.includes('{/* Editor Top Title Bar'));
t('немає рядка «Formatting & Insert Toolbar»', !src.includes('{/* Formatting & Insert Toolbar */}'));
t('немає мобільної смуги над текстом', !src.includes('{/* Mobile Top Navigation Bar */}'));
t('немає банерів ролей над текстом', !src.includes('{/* Role Status Banners */}'));
t('немає підвалу «мова та словник» під текстом', !src.includes('{/* Підвал блока тексту: мова та словник перевірки */}'));
t('між початком <main> і полем тексту немає жодної кнопки', !/<button|<select|<input|IconToolBtn/.test(main));
t('панелі тексту без шапок (title={null}, без headerExtra)', !/<DockedEditorPanel[^>]*headerExtra/s.test(src.slice(src.indexOf('{/* 1. SINGLE UA MODE'), src.indexOf('{/* RIGHT PANEL:'))));

console.log('\nУсе, що було над текстом, — у блоці:');
const dock = src.slice(src.indexOf('const renderToolDockContent'), src.indexOf('const editorSurface = ('));
const expectations: Array<[string, string]> = [
  ['зміст книги (editor__1)', 'data-tour="editor__1"'],
  ['мова UA / UA|EN / EN (editor__3)', 'data-tour="editor__3"'],
  ['переклад (editor__4)', 'data-tour="editor__4"'],
  ['назва розділу', "t('editor.sectionTitlePlaceholder')"],
  ['назва розділу EN', 'titleEn: e.target.value'],
  ['перемикач розділів', "t('editor.sectionSwitcherTitle')"],
  ['пошук по книзі', 'setShowBookSearch(true)'],
  ['реакція читача', 'handleRunReaderResponse'],
  ['показники глави', 'handleAnalyzeChapterMetrics'],
  ['збереження', 'onSaveBook'],
  ['права панель', 'setShowRightPanel(!showRightPanel)'],
  ['мова та словник перевірки', 'setShowProofingModal(true)'],
  ['статус перевірки', "t('editor.proofingStatusOn'"],
  ['«Покращити AI»', "handleTriggerAiEdit('improve')"],
  ['кількість слів і час читання', "t('editor.readingTimeShort'"],
  ['формат аркуша', 'handleChangePageFormat'],
  ['масштаб сторінки', "t('editor.pageZoomTitle')"],
  ['лінійка', 'renderRulerToggle()'],
  ['швидкі вставки й теги', 'handleInsertTag'],
  ['ілюстрація', 'setShowIllustrationModal(true)'],
  ['цитата', "insertTextAtCursor('\\n\\n> Цитата...\\n\\n')"],
  ['форматування', 'renderFormatToolbar(dockFormatIsEn'],
  ['горизонтально форматування тече одним потоком', 'renderFormatToolbar(dockFormatIsEn, !vertical)'],
  ['банер читача', "t('editor.readerBannerTitle')"],
  ['банер перекладача', "t('editor.translatorBannerTitle')"],
];
for (const [name, needle] of expectations) t(name, dock.includes(needle));
t('у розвороті — вибір колонки для форматування', dock.includes('setFormatTarget(k)'));
t('блок підключено до поля тексту', src.includes('anchorRef={mainAreaRef}') && src.includes('onReserveChange={setToolReserve}'));
t('поле звільняє місце під прилиплим блоком', src.includes('paddingTop: toolReserve.top'));

console.log(`\nРезультат: ${pass} пройшло, ${fail} впало.`);
if (fail > 0) process.exit(1);

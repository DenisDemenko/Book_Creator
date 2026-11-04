/**
 * Права панель розділу «Книга і текст»: на старті згорнута, розгортається стрілкою на правому
 * краї, згортається зворотною стрілкою в шапці (постановка власника 04.11.2026).
 *
 * ЧОМУ ТЕСТ ЧИТАЄ ВИХІДНИЙ КОД. EditorView — один великий компонент без розбиття на частини, які
 * можна змонтувати в Node; а ломається тут якраз нудне: хтось поверне `usePersistentState(…, true)`
 * і панель знову відкриватиметься на старті, або додасть нову AI-дію, що пише результат у
 * приховану панель. Живу поведінку (старт згорнутою, розгортання й згортання справжніми кліками,
 * вузький екран) перевірено в браузері й записано в журнал; тут — що її не зіпсують мовчки.
 *
 * Запуск: npm run test:editor-right-panel
 */
import fs from 'node:fs';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

// `core.autocrlf=true` дає на диску Windows CRLF, а в репозиторії LF: тест не має залежати від того, де його запустили.
const read = (rel: string) => fs.readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const src = read('../src/components/EditorView.tsx');
const dict = read('../src/i18n/dictionaries/editor.ts');
const tour = read('../src/onboarding/tourSteps.ts');

console.log('\nСтартовий стан:');
{
  const decl = src.match(/const \[showRightPanel, setShowRightPanel\] = ([^;]+);/)?.[1] ?? '';
  t('панель на старті згорнута: useState(false)', decl === 'useState<boolean>(false)', decl);
  t('стан НЕ береться зі сховища (старе збережене «відкрита» не діє)', !decl.includes('usePersistentState') && !src.includes("'nova_editor_showRightPanel'"));
}

console.log('\nСтрілки:');
{
  const expandAt = src.indexOf('{!showRightPanel && (');
  const expand = src.slice(expandAt, expandAt + 1100);
  t('стрілка «Розгорнути» є лише коли панель згорнута', /\{!showRightPanel && \(\s*<button/.test(src) && src.includes('data-right-panel-expand'));
  t('вона розгортає панель і дивиться вліво (ChevronLeft)', expand.includes('setShowRightPanel(true)') && expand.includes('<ChevronLeft'));
  t('підписана для читачів екрана й каже стан', expand.includes("t('editor.rightPanelExpand')") && expand.includes('aria-expanded={false}'));
  t('тур «Панель сцени» не втрачає мішені: на згорнутій панелі editor__5 стоїть на стрілці', expand.includes('data-tour="editor__5"'));

  const collapseAt = src.lastIndexOf('data-right-panel-collapse');
  const collapse = src.slice(collapseAt - 200, collapseAt + 600);
  t('стрілка «Згорнути» є в шапці розгорнутої панелі', collapseAt > 0);
  t('вона згортає панель і дивиться вправо (ChevronRight)', collapse.includes('setShowRightPanel(false)') && collapse.includes('<ChevronRight'));
  t('підписана й каже стан', collapse.includes("t('editor.rightPanelCollapse')") && collapse.includes('aria-expanded={true}'));
  t('видима на всіх екранах (не `lg:hidden`)', !collapse.includes('lg:hidden'));

  // Кнопка стоїть ПОЗА прокручуваним рядком вкладок, інакше на вузькій панелі її видно лише прокруткою.
  const header = src.slice(src.indexOf('Шапка: вкладки (прокручуються)'), collapseAt);
  t('стрілка згортання — поза рядком вкладок, що прокручується', header.includes('overflow-x-auto no-scrollbar">') && header.lastIndexOf('</div>') > header.indexOf('overflow-x-auto'));
  t('кнопка «Персонажі» на панелі інструментів і далі перемикає панель', src.includes('setShowRightPanel(!showRightPanel)'));
}

console.log('\nДії, що показують результат у правій панелі, розгортають її самі:');
{
  // Обробник — це рядок `setRightPanelTab('workAi')` з відступом у 4 пробіли (JSX-кнопки вкладок мають глибший відступ).
  const handlers = [...src.matchAll(/\n {4}(setShowRightPanel\(true\);\n {4})?setRightPanelTab\('workAi'\);/g)];
  const opened = handlers.filter((m) => !!m[1]);
  t('є п’ять обробників AI-дій (покращення, правопис, реакція читача, показники глави, сила початку)', handlers.length === 5, String(handlers.length));
  t('кожен із них перед вибором вкладки розгортає панель', opened.length === handlers.length, `${opened.length}/${handlers.length}`);
}

console.log('\nТексти:');
{
  t('укр.: «Розгорнути праву панель» / «Згорнути праву панель»', dict.includes("rightPanelExpand: 'Розгорнути праву панель'") && dict.includes("rightPanelCollapse: 'Згорнути праву панель'"));
  t('англ.: Expand / Collapse the right panel', dict.includes("rightPanelExpand: 'Expand the right panel'") && dict.includes("rightPanelCollapse: 'Collapse the right panel'"));
  t('тур каже, що панель згорнута і як її розгорнути', tour.includes('Панель згорнута до правого краю — натисніть стрілку'));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

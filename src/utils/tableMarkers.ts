/**
 * Маркери таблиці `[TABLE]\n[ROW][CELL align=режим]текст[/CELL]…[/ROW]\n…\n[/TABLE]`.
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ ФАЙЛ, А НЕ РЯДОК У ДВОХ МІСЦЯХ — той самий принцип, що й
 * `imageMarkers.ts` (запис #169): маркер — конвенція між редактором
 * (`manuscriptEditor/*`, `utils/manuscriptDoc.ts`), браузерним
 * HTML/PDF-експортом (`utils/helpers.ts`) і серверною версткою PDF
 * (`server/pdf/*`). Один спільний парсер — і жоден із цих трьох споживачів
 * не malюватиме таблицю по-своєму чи не забуде розгорнути маркер.
 *
 * Формат рядка НАВМИСНО без порожніх рядків усередині `[TABLE]…[/TABLE]`:
 * увесь блок (відкриваючий маркер, усі `[ROW]…[/ROW]`, закриваючий маркер)
 * — рівно ОДИН «абзац» для парсера `manuscriptDoc.ts` (той ділить текст на
 * абзаци через 2+ переносів рядка) — так само, як однорядкові `[IMG:…]` і
 * `[DIVIDER]`, лише багаторядковий. Це дозволяє додати таблицю в
 * `markerStringToTiptapDoc`/`renderSectionContentHtml` як ЩЕ ОДИН
 * цілий-абзац-маркер, без окремого механізму буферизації (як у
 * [AI-DRAFT]…[/AI-DRAFT], де вміст справді багатоабзацний).
 *
 * Текст усередині `[CELL]…[/CELL]` — не літерал: той самий інлайн-формат
 * маркерів, що й у звичайному абзаці (`**жирний**`, `[COLOR="…"]…[/COLOR]`
 * тощо), тож і в редакторі (parseInline/serializeInline), і в експорті
 * (ланцюжок render*Markers у utils/helpers.ts) додаткового розбору не
 * потрібно — досить прогнати вміст клітинки через ті самі функції.
 *
 * Файл навмисно чистий: жодних імпортів, ні DOM, ні Node — щоб його могли
 * тягнути і браузер, і сервер (той самий принцип, що й imageMarkers.ts).
 */

export type TableCellAlign = 'left' | 'right' | 'center' | null;

export interface TableMarkerCell {
  /** null = дефолт (ліворуч) — у рядку маркера атрибут `align=` тоді взагалі не пишеться. */
  align: TableCellAlign;
  /** Вміст клітинки — рядок з інлайн-маркерами (не розібраний далі тут). */
  text: string;
}

export interface TableMarkerRow {
  cells: TableMarkerCell[];
}

export interface TableMarkerBlock {
  rows: TableMarkerRow[];
}

const CELL_SOURCE = '\\[CELL(?:\\s+align=(left|right|center))?\\]([\\s\\S]*?)\\[\\/CELL\\]';
/** Ціле поле `[TABLE]\n…\n[/TABLE]`, без урахування зайвих пробілів по краях рядка — саме так виглядає абзац-цілком. */
const TABLE_BLOCK_WHOLE_RE = /^\[TABLE\]\n([\s\S]*)\n\[\/TABLE\]$/;

export function hasTableMarkers(text: unknown): boolean {
  return String(text ?? '').includes('[TABLE]');
}

/**
 * Свіжий `/g`-вираз, що знаходить `[TABLE]…[/TABLE]`-блоки БУДЬ-ДЕ у
 * довшому тексті (кілька абзаців одразу) — для HTML/PDF-експорту, який
 * отримує весь вміст розділу за раз, а не по абзацу.
 *
 * Фабрика, не спільний обʼєкт: `lastIndex` глобального регексу зламав би
 * другий прохід по тому самому тексту (той самий урок, що й
 * `imageMarkerRegexp()`).
 */
export function tableBlockRegexp(): RegExp {
  return /\[TABLE\]\n[\s\S]*?\n\[\/TABLE\]/g;
}

/** Розбирає ОДНУ клітинку `[ROW]…[/ROW]`-рядка (вже без зовнішніх [ROW]/[/ROW]) на клітинки. */
function parseRowCells(rowInner: string): TableMarkerCell[] {
  const cells: TableMarkerCell[] = [];
  const re = new RegExp(CELL_SOURCE, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(rowInner))) {
    cells.push({ align: (m[1] as TableCellAlign) || null, text: m[2] });
  }
  return cells;
}

/**
 * Розбирає рядок, що складається РІВНО з `[TABLE]\n…\n[/TABLE]` (весь
 * рядок — блок, як абзац у `markerStringToTiptapDoc`). Інакше — `null`.
 * Рядки `[ROW]…[/ROW]` усередині розділені ОДИНАРНИМ переносом рядка.
 */
export function parseTableMarkerBlock(raw: string): TableMarkerBlock | null {
  const trimmed = String(raw ?? '').trim();
  const outer = TABLE_BLOCK_WHOLE_RE.exec(trimmed);
  if (!outer) return null;

  // НЕ ділимо на рядки через '\n' — клітинка може мати «жорсткий перенос»
  // (Shift+Enter у редакторі серіалізується як '\n', manuscriptDoc.ts
  // hardBreak): такий рядок мав би два фрагменти БЕЗ парного [ROW]/[/ROW],
  // і рядкове ділення мовчки губило б увесь [ROW] — реальна втрата даних,
  // яку впіймав тест «перенос рядка в клітинці не розриває рядок таблиці».
  // Замість цього шукаємо кожен [ROW]…[/ROW] нежадібним глобальним
  // виразом просто в цільному тексті блоку — байдуже, скільки в ньому
  // власних переносів рядка.
  const rows: TableMarkerRow[] = [];
  const rowRe = /\[ROW\]([\s\S]*?)\[\/ROW\]/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(outer[1]))) {
    rows.push({ cells: parseRowCells(m[1]) });
  }
  return { rows };
}

/** Канонічний рядок-маркер `[TABLE]\n[ROW]…[/ROW]\n…\n[/TABLE]` з розібраної структури. */
export function tableMarkerString(table: TableMarkerBlock): string {
  const rowLines = table.rows.map(
    (row) =>
      `[ROW]${row.cells
        .map((c) => `[CELL${c.align ? ` align=${c.align}` : ''}]${c.text}[/CELL]`)
        .join('')}[/ROW]`
  );
  return `[TABLE]\n${rowLines.join('\n')}\n[/TABLE]`;
}

/**
 * Замінює кожен `[TABLE]…[/TABLE]`-блок у довшому тексті на те, що поверне
 * `render` — спільна точка для HTML-експорту (utils/helpers.ts, малює
 * `<table>`), серверної markdown-конвертації (server/pdf/bookToMarkdown.ts,
 * малює GFM-таблицю для pandoc/Chromium) і фолбек-сплощення там, де
 * власної верстки таблиць немає (server/pdf/pdfRenderer.ts). Блок, що не
 * розібрався (пошкоджені дані), лишається як є — мовчазна порожнеча гірша
 * за видиму проблему в тексті.
 */
export function replaceTableBlocks(text: string, render: (table: TableMarkerBlock, raw: string) => string): string {
  const source = String(text ?? '');
  if (!hasTableMarkers(source)) return source;
  return source.replace(tableBlockRegexp(), (full) => {
    const table = parseTableMarkerBlock(full);
    return table ? render(table, full) : full;
  });
}

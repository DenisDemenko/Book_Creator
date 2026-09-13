/**
 * Чистий алгоритм розбиття на сторінки — без DOM, без ProseMirror.
 * Приймає вже виміряні висоти блоків (px) і бюджет висоти однієї сторінки
 * (px), повертає індекси блоків, з яких має починатися нова сторінка.
 *
 * Навмисно відокремлений від вимірювання (яке контекстно-залежне: живий
 * ProseMirror-документ редактора проти офлайн-рендеру розділів у
 * «Розвороті книги») — сам алгоритм розбиття спільний і легко тестується.
 *
 * Блок, вищий за цілу сторінку (наприклад, величезна картинка), просто
 * лишається на своїй сторінці, навіть якщо переповнює її, — так само, як
 * повелася б будь-яка настільна видавнича система.
 */
/** Верхня й нижня межа блоку (px) у СПІЛЬНІЙ системі координат колонки сторінки. */
export interface BlockBounds {
  top: number;
  bottom: number;
}

/**
 * Те саме розбиття, але за реальними вертикальними межами блоків, а не за
 * їхніми окремими висотами.
 *
 * Навіщо друга функція: сума власних висот перестає збігатися з реальною
 * висотою сторінки, щойно в тексті з'являється обтічне (float) зображення.
 * Картинка й абзаци, що її обтікають, займають ОДНУ вертикаль, але у
 * висотах вони рахувались двічі — а сам плаваючий вузол ще й повертав
 * `offsetHeight: 0`, бо вийшов з потоку. Через це розриви сторінок лягали
 * не туди, і текст навколо фото «перестрибував».
 *
 * Межі `top`/`bottom` беруться вже з відрендереної розкладки, тож float
 * у них врахований самим браузером. Сторінка «закривається», коли її
 * найнижча точка (максимум по всіх блоках сторінки — картинка може
 * звисати нижче за текст поруч) виходить за бюджет висоти.
 *
 * Блок, вищий за цілу сторінку, лишається на своїй сторінці — так само,
 * як у computeBreaks вище.
 */
export function computeBreaksFromBounds(
  bounds: BlockBounds[],
  pageContentHeightPx: number,
  /**
   * `true` для блоку, який не можна лишати останнім на сторінці —
   * на практиці це обтічне (float) зображення. Розрив одразу ЗА таким
   * блоком лишив би картинку саму, з порожнім місцем збоку, там де
   * автор навмисне поставив текст в обтікання. Розрив у такому разі
   * переноситься на позицію ПЕРЕД картинкою, і вона їде на наступну
   * сторінку разом зі своїм текстом — так само, як «не відривати від
   * наступного» в будь-якій настільній видавничій системі.
   */
  keepWithNext?: boolean[]
): number[] {
  const breaks: number[] = [];
  if (pageContentHeightPx <= 0 || bounds.length === 0) return breaks;

  let pageTop = bounds[0].top;
  let pageBottom = bounds[0].bottom;

  for (let i = 1; i < bounds.length; i += 1) {
    const candidateBottom = Math.max(pageBottom, bounds[i].bottom);
    if (candidateBottom - pageTop > pageContentHeightPx) {
      // Відступаємо назад через усі блоки, що мусять лишитися разом із
      // наступним. Далі за початок поточної сторінки не відступаємо:
      // інакше сторінка вийшла б порожньою, а цикл — нескінченним.
      let at = i;
      while (keepWithNext?.[at - 1] && bounds[at - 1].top > pageTop) {
        at -= 1;
      }
      breaks.push(at);
      pageTop = bounds[at].top;
      pageBottom = bounds[at].bottom;
      // Блоки, які ми перенесли на нову сторінку, треба врахувати в її висоті.
      for (let k = at + 1; k <= i; k += 1) {
        pageBottom = Math.max(pageBottom, bounds[k].bottom);
      }
    } else {
      pageBottom = candidateBottom;
    }
  }

  return breaks;
}

export function computeBreaks(blockHeightsPx: number[], pageContentHeightPx: number): number[] {
  const breaks: number[] = [];
  if (pageContentHeightPx <= 0) return breaks;

  let currentHeight = 0;
  blockHeightsPx.forEach((h, i) => {
    if (i === 0) {
      currentHeight = h;
      return;
    }
    if (currentHeight + h > pageContentHeightPx) {
      breaks.push(i);
      currentHeight = h;
    } else {
      currentHeight += h;
    }
  });

  return breaks;
}

/** Блок у вже ВІДРЕНДЕРНІЙ системі координат колонки (px, без масштабу). */
export interface RenderedBlock {
  top: number;
  bottom: number;
}

/**
 * Знімок живої пагінації — те, що потрібне вертикальній лінійці, щоб
 * показати сторінки такими, якими вони Є на екрані.
 *
 * ЧОМУ ЦЕ ОКРЕМИЙ ТИП, А НЕ ПРОСТО ТРИ ЧИСЛА В КОМПОНЕНТІ. Раніше
 * вертикальна лінійка малювала одну суцільну шкалу від 0 до загальної
 * висоти ВМІСТУ (для глави це могло бути 1300 мм). Числа на ній не мали
 * жодного відношення до формату аркуша — саме на це й скаржився власник
 * («не відповідає аркушам розмітки сторінки ні по висоті»). Щоб шкала
 * відповідала сторінкам, лінійка мусить знати, де кожна сторінка
 * починається й де закінчується ЇЇ заповнений текст.
 *
 * ВАЖЛИВО: координати — вже ВІДРЕНДЕРНІ, тобто разом зі смугами розривів
 * (PaginationPlugin вставляє між сторінками віджет). «Чисті» виміри, за
 * якими рахуються розриви, і видимі позиції відрізняються на суму висот
 * цих смуг: друга сторінка на екрані стоїть нижче, ніж у чистому вимірі,
 * тож лінійка, намальована за чистими числами, «пливла» б униз із кожною
 * сторінкою.
 */
export interface PaginationSnapshot {
  /** Верх кожної сторінки, px. */
  pageTopsPx: number[];
  /** Низ ЗАПОВНЕНОГО тексту кожної сторінки, px (для останньої — там, де текст закінчується). */
  pageBottomsPx: number[];
  /** Бюджет висоти тексту на сторінку, px — той самий, за яким робились розриви. */
  contentHeightPx: number;
  /**
   * Чи сторінка ПЕРЕПОВНЕНА — тобто чи її вміст вищий за бюджет.
   *
   * Так буває з блоком, вищим за сторінку (величезне фото або абзац на
   * кілька тисяч символів): алгоритм лишає такий блок на своїй сторінці, і
   * вона виходить вищою за формат. Друк розриває такий блок УСЕРЕДИНІ
   * (обидва рушії це вміють), а живий редактор — поки що ні, і саме тут
   * канва свідомо розходиться з PDF. Цей прапорець існує, щоб розходження
   * було ВИДНО (вертикальна лінійка малює таку зону бурштиновою), а не щоб
   * удавати, ніби його немає.
   */
  pageOverflows: boolean[];
}

/**
 * Складає знімок пагінації з відрендерених меж блоків і списку розривів.
 *
 * Чиста функція (без DOM і ProseMirror) — самі виміри робить плагін, а вся
 * арифметика «котрий блок на якій сторінці й доки вона заповнена» живе тут
 * і перевіряється тестом. Розрив на початку списку (індекс 0) і поза межами
 * відкидаються: першу сторінку відкриває сам початок документа, а не
 * розрив, і «сторінка» з нуля блоків не має сенсу.
 */
export function buildPaginationSnapshot(
  blocks: RenderedBlock[],
  breakIndices: number[],
  contentHeightPx: number
): PaginationSnapshot {
  const starts = [0, ...breakIndices.filter((i) => i > 0 && i < blocks.length)];
  const pageTopsPx: number[] = [];
  const pageBottomsPx: number[] = [];
  const pageOverflows: boolean[] = [];

  for (let k = 0; k < starts.length; k += 1) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : blocks.length;
    if (from >= blocks.length || to <= from) continue;

    let top = Infinity;
    let bottom = -Infinity;
    for (let i = from; i < to; i += 1) {
      top = Math.min(top, blocks[i].top);
      bottom = Math.max(bottom, blocks[i].bottom);
    }
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) continue;

    pageTopsPx.push(top);
    // Низ не може бути вищим за верх: блоки з нульовою висотою (обтічне
    // фото повертає offsetHeight 0) дали б від'ємну зону, а від'ємна
    // висота смуги на лінійці — це вже не «порожня сторінка», а зламана
    // розмітка.
    pageBottomsPx.push(Math.max(bottom, top));
    // Допуск 0.5 px — на округлення субпіксельної розкладки: сторінка, що
    // влізла рівно в бюджет, не має світитись як переповнена.
    pageOverflows.push(contentHeightPx > 0 && bottom - top > contentHeightPx + 0.5);
  }

  return { pageTopsPx, pageBottomsPx, contentHeightPx, pageOverflows };
}

/**
 * Чи знімки однакові. Потрібно, щоб кожен вимір пагінації (раз на 200 мс
 * після правки) не перемальовував увесь редактор: поки автор пише всередині
 * абзацу, межі сторінок не рухаються, і знімок той самий.
 */
export function paginationSnapshotsEqual(
  a: PaginationSnapshot | null,
  b: PaginationSnapshot | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.contentHeightPx !== b.contentHeightPx) return false;
  if (a.pageTopsPx.length !== b.pageTopsPx.length) return false;
  if (a.pageBottomsPx.length !== b.pageBottomsPx.length) return false;
  if (a.pageOverflows.length !== b.pageOverflows.length) return false;
  return (
    a.pageTopsPx.every((t, i) => t === b.pageTopsPx[i] && a.pageBottomsPx[i] === b.pageBottomsPx[i]) &&
    a.pageOverflows.every((f, i) => f === b.pageOverflows[i])
  );
}

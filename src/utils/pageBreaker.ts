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

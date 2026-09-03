/**
 * Обкладинка книги для вітрини: перша сторінка PDF → PNG.
 *
 * ЧОМУ ЦЕ В БРАУЗЕРІ, А НЕ НА СЕРВЕРІ. Маркетплейс приймає для картки лише
 * растр (`image/jpeg|png|webp|avif`), а растеризувати PDF на сервері нічим:
 * знадобився б або нативний модуль, або wasm-рендерер в образі — і те, й те
 * заради однієї картинки. У браузері ж `canvas` є завжди, а `pdfjs-dist`
 * уже стоїть у залежностях Студії й уже вживається для читання PDF у чаті.
 *
 * ЧОМУ САМЕ ПЕРША СТОРІНКА. Верстка Студії ставить першою титульну — назву
 * й автора великим кеглем. Це найближче до обкладинки, що взагалі існує в
 * зверстаному блоці; окремого файлу обкладинки в книзі може не бути зовсім.
 * Тому картка показує титул, а не вигадану картинку — і покупець бачить те,
 * що справді лежить у файлі.
 */

let workerConfigured = false;

/**
 * Той самий завантажувач, що в `extractChatFileText.ts`: динамічний імпорт
 * (pdfjs важкий і потрібен рідко) плюс URL воркера через `?url` Vite.
 * Прапорець — модульний навмисно: воркер налаштовується раз на сторінку.
 */
async function loadPdfJs() {
  const pdfjsLib = await import('pdfjs-dist');
  if (!workerConfigured) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
    workerConfigured = true;
  }
  return pdfjsLib;
}

/** Довша сторона картинки обкладинки. */
export const COVER_TARGET_LONG_SIDE = 1600;
/**
 * Нижня межа розміру PNG, за якою вважаємо, що полотно лишилось порожнім.
 *
 * Порожній canvas дає крихітний PNG (суцільна заливка стискається майже в
 * нуль), і без цієї перевірки «обкладинка» з білого прямокутника доїхала б
 * до вітрини як успіх. Сервер має власну, ще грубішу межу — тут ловимо
 * раніше, щоб не витрачати запит і показати причину одразу.
 */
export const COVER_MIN_BYTES = 3000;

/**
 * Масштаб рендера так, щоб довша сторона дорівнювала `COVER_TARGET_LONG_SIDE`.
 *
 * Винесено окремо й без залежності від pdfjs — це вся арифметика функції
 * нижче, і саме її має сенс перевіряти тестами.
 */
export function coverScaleFor(
  width: number,
  height: number,
  targetLongSide: number = COVER_TARGET_LONG_SIDE
): number {
  const longSide = Math.max(width, height);
  if (!Number.isFinite(longSide) || longSide <= 0) return 1;
  // Не збільшуємо понад 4×: сторінка PDF задана у пунктах, і для дрібного
  // формату надмірний масштаб дав би величезний файл без нової деталізації —
  // збільшився б лише розмір пікселів, а не кількість інформації.
  return Math.min(4, Math.max(0.1, targetLongSide / longSide));
}

/** Скільки байтів у base64-рядку. Без декодування — лише арифметика. */
export function base64Bytes(dataUrl: string): number {
  const base64 = dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
  if (!base64) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export class CoverRenderError extends Error {}

/**
 * Малює першу сторінку PDF і повертає `data:image/png;base64,…`.
 *
 * Кидає `CoverRenderError` із причиною людською мовою: цей виклик іде з
 * кнопки, і автор має прочитати, ЩО не вдалося, а не побачити мовчазну
 * бездіяльність.
 */
export async function renderPdfFirstPageToPng(
  source: Blob | ArrayBuffer,
  targetLongSide: number = COVER_TARGET_LONG_SIDE
): Promise<string> {
  const buffer = source instanceof Blob ? await source.arrayBuffer() : source;
  if (!buffer || buffer.byteLength === 0) {
    throw new CoverRenderError('PDF порожній — малювати обкладинку нема з чого.');
  }

  const pdfjsLib = await loadPdfJs();
  // Тримаємо саме loadingTask: звільняє і воркер, і памʼять під сторінки,
  // тоді як `doc.cleanup()` лише скидає кеші всередині живого документа.
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const doc = await loadingTask.promise;
  try {
    if (doc.numPages < 1) throw new CoverRenderError('У PDF немає жодної сторінки.');

    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: coverScaleFor(base.width, base.height, targetLongSide) });

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d');
    if (!context) throw new CoverRenderError('Браузер не дав полотна для малювання (canvas 2d).');

    // Сторінки PDF прозорі: без заливки титул ліг би на чорне тло вітрини
    // білим текстом по прозорому — тобто зник би.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvas, canvasContext: context, viewport } as never).promise;

    const dataUrl = canvas.toDataURL('image/png');
    if (base64Bytes(dataUrl) < COVER_MIN_BYTES) {
      throw new CoverRenderError(
        'Сторінка намалювалась порожньою — обкладинку не надсилаємо, щоб у вітрині не зʼявився білий прямокутник.'
      );
    }
    return dataUrl;
  } finally {
    // Без цього кілька натискань поспіль лишили б по копії кожного PDF у
    // памʼяті вкладки. `catch {}` — бо помилка прибирання не має підмінити
    // собою справжню причину, якщо ми вже падаємо.
    await loadingTask.destroy().catch(() => {});
  }
}

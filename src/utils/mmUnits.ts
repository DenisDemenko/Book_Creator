/** CSS-специфікація визначає 1mm = 96/25.4 px незалежно від реального DPI екрана — фіксована, передбачувана величина. */
export const PX_PER_MM = 96 / 25.4;

/**
 * Пункт → CSS-піксель. Теж фіксоване співвідношення: 1 pt = 1/72 дюйма,
 * а дюйм у CSS — це 96 px, тобто 1 pt = 96/72 = 4/3 px.
 *
 * НАВІЩО ОКРЕМА КОНСТАНТА. У живому редакторі кегль рахувався як
 * `fontSizePt * 1.3` — «майже правильно», і ця похибка в 2.6 % розходилась
 * із друкарськими рушіями (там кегль у пунктах, як у книзі) по кількості
 * рядків, а отже й по розбиттю на сторінки. Одне число тут — це єдине
 * місце, де взагалі можна помилитись.
 */
export const PT_TO_PX = 96 / 72;

/**
 * Міліметри для підпису: ціле число — без дробу, дробове — з одним знаком
 * (12.7 мм — реальне поле KDP для 6×9″, і «13» тут було б неправдою).
 * Спільна для обох лінійок (PageRuler.tsx і PageColumn.tsx), щоб «170 » та
 * «170.0» не з'являлись в одному інтерфейсі поруч.
 */
export function formatMm(v: number): string {
  if (!Number.isFinite(v)) return '0';
  return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
}

export interface RulerMark {
  /** Відстань позначки від початку лінійки, у мм. */
  mm: number;
  /** Велика поділка (кожні 10 мм) — з цифрою; мала (кожні 5 мм між ними) — без цифри. */
  major: boolean;
}

/**
 * Позначки лінійки в РЕАЛЬНИХ міліметрах — спільна логіка для
 * PageRuler.tsx (горизонтальна) і PageColumn.tsx (вертикальна), щоб обидві
 * лінійки завжди мали однаковий крок і не могли розійтись.
 *
 * Раніше PageRuler.tsx мав позначку щокожні 10мм, але ЦИФРУ показував лише
 * на кожній 5-й (тобто щокожні 50мм) — і саме як `cm/10`, тож підписи
 * виглядали як «0.5, 1, 1.5, 2…» замість очікуваних круглих чисел. Це і
 * сприймалось як «вигадані одиниці». Тепер: велика поділка з цифрою
 * (реальне значення в мм) кожні 10мм, дрібна без цифри — кожні 5мм.
 */
export function buildRulerMarks(lengthMm: number): RulerMark[] {
  const marks: RulerMark[] = [];
  const totalSteps = Math.floor(lengthMm / 5);
  for (let i = 0; i <= totalSteps; i++) {
    const mm = i * 5;
    marks.push({ mm, major: mm % 10 === 0 });
  }
  return marks;
}

export interface RulerSheetLayout {
  /** Повна ширина аркуша в px, БЕЗ масштабу — аркуш у лінійці сам несе `transform: scale()`. */
  sheetWidthPx: number;
  insidePx: number;
  outsidePx: number;
  textWidthPx: number;
  /**
   * Зсув ЛІВОГО КРАЮ аркуша від центру доступної ширини, УЖЕ з масштабом
   * (бо це позиція самого аркуша в контейнері, а не дитина всередині нього).
   */
  sheetLeftScaledPx: number;
}

/**
 * Розкладка аркуша на горизонтальній лінійці редактора (PageRuler.tsx):
 * лінійка міряє АРКУШ, а текстова колонка під нею — лише його середину,
 * тож аркуш доводиться малювати навколо колонки. Функція відповідає на
 * єдине питання, яке тут можна переплутати: на скільки px ліва межа аркуша
 * лівіше за центр доступної ширини.
 *
 * Виведення (і чому саме так):
 *   • колонка тексту в PageColumn центрується як `left: 50%` мінус пів
 *     ширини і масштабується тим самим `scale`, тож її лівий край лежить
 *     на `-textWidthPx * scale / 2` від центру;
 *   • ліва межа аркуша відходить від краю колонки ще на внутрішнє поле
 *     (`insideMm`), тому зсув аркуша = `(textWidthPx / 2 + insidePx) * scale`.
 * Обидва числа рахуються від того самого центру — саме тому світла зона
 * тексту на лінійці стоїть точно над текстом під нею. Тримається це лише
 * на цій рівності, тож вона зафіксована тестом (`npm run test:ruler-layout`).
 */
export function buildRulerSheetLayout(params: {
  sheetWidthMm: number;
  textWidthMm: number;
  insideMm: number;
  outsideMm: number;
  scale: number;
}): RulerSheetLayout {
  const textWidthPx = params.textWidthMm * PX_PER_MM;
  const insidePx = params.insideMm * PX_PER_MM;
  return {
    sheetWidthPx: params.sheetWidthMm * PX_PER_MM,
    insidePx,
    outsidePx: params.outsideMm * PX_PER_MM,
    textWidthPx,
    sheetLeftScaledPx: (textWidthPx / 2 + insidePx) * params.scale,
  };
}

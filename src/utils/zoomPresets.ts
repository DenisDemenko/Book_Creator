/**
 * Масштаб перегляду в конструкторі власного шаблону верстки.
 *
 * Власник просив «перемикач масштабу від 10 % до 150 % зі списку з кроком
 * 10 %». Логіку винесено з компонента, щоб її можна було перевірити тестом
 * без браузера і щоб значення не розходилися між екранами.
 *
 * `fit` — окремий режим «підігнати» (старий за замовчуванням): він не є
 * відсотком, тому живе поруч зі списком, а не всередині нього.
 */

export const ZOOM_MIN_PERCENT = 10;
export const ZOOM_MAX_PERCENT = 150;
export const ZOOM_STEP_PERCENT = 10;

/** 10, 20, … 150 — п'ятнадцять значень. */
export const ZOOM_PRESETS: readonly number[] = Array.from(
  { length: (ZOOM_MAX_PERCENT - ZOOM_MIN_PERCENT) / ZOOM_STEP_PERCENT + 1 },
  (_, index) => ZOOM_MIN_PERCENT + index * ZOOM_STEP_PERCENT,
);

export type ZoomValue = number | 'fit';

/** Масштаб режиму «підігнати» — залишено таким, яким був раніше (0,82). */
export const ZOOM_FIT_SCALE = 0.82;

/** Привести довільне число до найближчого допустимого кроку в межах 10–150. */
export function snapZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return 100;
  const clamped = Math.min(ZOOM_MAX_PERCENT, Math.max(ZOOM_MIN_PERCENT, percent));
  return Math.round(clamped / ZOOM_STEP_PERCENT) * ZOOM_STEP_PERCENT;
}

/** Множник для CSS: `fit` → 0,82, інакше відсоток / 100. */
export function zoomScaleOf(value: ZoomValue, fitScale: number = ZOOM_FIT_SCALE): number {
  return value === 'fit' ? fitScale : snapZoomPercent(value) / 100;
}

/** Значення `<select>` → ZoomValue. Невідоме значення дає `fit`, а не NaN. */
export function parseZoomValue(raw: string): ZoomValue {
  if (raw === 'fit' || raw.trim() === '') return 'fit';
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? snapZoomPercent(parsed) : 'fit';
}

/** Підпис пункту списку: «Підігнати» або «70%». */
export function zoomLabel(value: ZoomValue): string {
  return value === 'fit' ? 'Підігнати' : `${value}%`;
}

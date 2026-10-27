/**
 * Ціна з поля вводу → копійки.
 *
 * Порожнє поле, «abc» чи «1,5,0» раніше давали NaN або 0, а 0 у маркетплейсі
 * означає «безкоштовно». Тут нуль — окреме рішення («Безкоштовна»), а не
 * наслідок поганого вводу.
 */
export type PriceResult = { ok: true; minor: number; free: boolean } | { ok: false; error: string };

/** «1 250,50» / «150» / «99.9» → копійки; усе інше — null. */
export function parsePriceMinor(raw: string): number | null {
  const cleaned = String(raw ?? '').trim().replace(/\s+/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function resolvePrice(raw: string, free: boolean, what: string): PriceResult {
  if (free) return { ok: true, minor: 0, free: true };
  const minor = parsePriceMinor(raw);
  if (minor === null) {
    return { ok: false, error: `Ціна ${what} вказана некоректно — потрібне число, наприклад 150 або 99,50.` };
  }
  if (minor === 0) {
    return { ok: false, error: `Ціна ${what} дорівнює нулю. Вкажіть ціну або позначте «Безкоштовна».` };
  }
  return { ok: true, minor, free: false };
}

/**
 * Таблиця довідника плит (ДСП, фанера): рядки для редагування й перевірка
 * перед публікацією.
 *
 * Сервер Marketplace (`apps/api/src/tables/board-prices.ts`) приймає рівно
 * `BoardPrice[]` і відхиляє весь список, якщо хоч один рядок не проходить.
 * Тож ті самі межі перевіряються тут, до запиту, і помилка показується біля
 * конкретної клітинки, а не одним рядком «Рядок 7: перевірте…».
 *
 * Числові поля в чернетці — рядки: людина набирає «1250,5», і поле не має
 * перетворюватися на NaN посеред набору.
 */

import type { BoardPrice } from './materialPricesXml';

export interface BoardDraft {
  /** Стабільний ключ React — не плутати з кодом позиції `id`, який можна редагувати. */
  key: string;
  id: string;
  kind: BoardPrice['kind'];
  name: string;
  decor: string;
  lengthMm: string;
  widthMm: string;
  thicknessMm: string;
  grain: BoardPrice['grain'];
  unit: BoardPrice['unit'];
  /** Гривні з копійками, напр. «2 450,50»; порожньо — ціну ще не встановлено. */
  price: string;
}

export type DraftField = Exclude<keyof BoardDraft, 'key'>;
export type DraftErrors = Partial<Record<DraftField, string>>;

export const KIND_LABEL: Record<BoardPrice['kind'], string> = { chipboard: 'ДСП', plywood: 'Фанера' };
export const GRAIN_LABEL: Record<BoardPrice['grain'], string> = {
  length: 'вздовж',
  width: 'впоперек',
  none: 'без текстури',
};
export const UNIT_LABEL: Record<BoardPrice['unit'], string> = { sheet: 'лист', m2: 'м²' };

let keySeq = 0;
const nextKey = () => `row-${Date.now().toString(36)}-${(keySeq++).toString(36)}`;

/** Копійки → «2450,50» (без пробілів-розділювачів: поле редагується). */
export function formatPriceInput(priceMinor: number | null): string {
  if (priceMinor === null) return '';
  const whole = Math.trunc(priceMinor / 100);
  const cents = Math.abs(priceMinor % 100);
  return cents ? `${whole},${String(cents).padStart(2, '0')}` : String(whole);
}

/**
 * «2 450,50» / «2450.5» → 245050 копійок. Порожньо → null. Некоректне →
 * undefined (щоб відрізнити «не задано» від «помилка»).
 */
export function parsePriceInput(text: string): number | null | undefined {
  const clean = text.replace(/[\s ₴]/g, '').replace(',', '.');
  if (clean === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return undefined;
  const minor = Math.round(Number(clean) * 100);
  return Number.isSafeInteger(minor) && minor <= 2147483647 ? minor : undefined;
}

function parseNumber(text: string): number | undefined {
  const clean = text.replace(/[\s ]/g, '').replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return undefined;
  const value = Number(clean);
  return Number.isFinite(value) ? value : undefined;
}

export function toDraft(board: BoardPrice): BoardDraft {
  return {
    key: nextKey(),
    id: board.id,
    kind: board.kind,
    name: board.name,
    decor: board.decor,
    lengthMm: String(board.lengthMm),
    widthMm: String(board.widthMm),
    thicknessMm: String(board.thicknessMm),
    grain: board.grain,
    unit: board.unit,
    price: formatPriceInput(board.priceMinor),
  };
}

/** Новий порожній рядок — формат типового листа ДСП, щоб не набирати з нуля. */
export function blankDraft(existingIds: string[]): BoardDraft {
  let n = existingIds.length + 1;
  while (existingIds.includes(`board-${n}`)) n++;
  return {
    key: nextKey(),
    id: `board-${n}`,
    kind: 'chipboard',
    name: '',
    decor: '',
    lengthMm: '2800',
    widthMm: '2070',
    thicknessMm: '18',
    grain: 'length',
    unit: 'sheet',
    price: '',
  };
}

/** Межі — ті самі, що в `readBoardPriceUpdate` Marketplace. */
export function validateDraft(draft: BoardDraft, allIds: string[]): DraftErrors {
  const errors: DraftErrors = {};
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(draft.id)) errors.id = 'Латиниця, цифри, «-» або «_», до 64 знаків.';
  else if (allIds.filter((id) => id === draft.id).length > 1) errors.id = 'Такий код уже є в таблиці.';
  if (!draft.name.trim()) errors.name = 'Вкажіть назву.';
  else if (draft.name.length > 120) errors.name = 'До 120 знаків.';
  if (draft.decor.length > 60) errors.decor = 'До 60 знаків.';
  const dim = (field: 'lengthMm' | 'widthMm' | 'thicknessMm', min: number, max: number) => {
    const v = parseNumber(draft[field]);
    if (v === undefined || v < min || v > max) errors[field] = `${min}–${max} мм.`;
  };
  dim('lengthMm', 200, 6000);
  dim('widthMm', 200, 6000);
  dim('thicknessMm', 3, 100);
  if (parsePriceInput(draft.price) === undefined) errors.price = 'Сума в гривнях, до двох знаків після коми.';
  return errors;
}

/** Чернетки → `BoardPrice[]` для публікації; кидає помилку, якщо є невалідний рядок. */
export function fromDrafts(drafts: BoardDraft[]): BoardPrice[] {
  const ids = drafts.map((d) => d.id);
  return drafts.map((d, index) => {
    const errors = validateDraft(d, ids);
    const first = Object.values(errors)[0];
    if (first) throw new Error(`Рядок ${index + 1}${d.name ? ` («${d.name}»)` : ''}: ${first}`);
    return {
      id: d.id,
      kind: d.kind,
      name: d.name.trim(),
      decor: d.decor.trim(),
      lengthMm: parseNumber(d.lengthMm)!,
      widthMm: parseNumber(d.widthMm)!,
      thicknessMm: parseNumber(d.thicknessMm)!,
      grain: d.grain,
      unit: d.unit,
      priceMinor: parsePriceInput(d.price) as number | null,
    };
  });
}

/**
 * Ціна за лист і за м² — одна задана, друга розрахована з площі листа.
 * `null` там, де ціни немає або формат некоректний.
 */
export function derivedPrices(draft: BoardDraft): { perSheetMinor: number | null; perM2Minor: number | null; areaM2: number | null } {
  const length = parseNumber(draft.lengthMm);
  const width = parseNumber(draft.widthMm);
  const areaM2 = length && width ? (length * width) / 1_000_000 : null;
  const price = parsePriceInput(draft.price);
  if (price === null || price === undefined || !areaM2) return { perSheetMinor: null, perM2Minor: null, areaM2 };
  return draft.unit === 'sheet'
    ? { perSheetMinor: price, perM2Minor: Math.round(price / areaM2), areaM2 }
    : { perSheetMinor: Math.round(price * areaM2), perM2Minor: price, areaM2 };
}

/**
 * Чи є незбережені зміни. Порівнюємо значення полів, а не JSON об'єктів:
 * сервер повертає ті самі поля в іншому порядку ключів.
 */
export function sameBoards(a: BoardPrice[], drafts: BoardDraft[]): boolean {
  const canon = (list: BoardPrice[]) =>
    JSON.stringify(
      list.map((b) => [b.id, b.kind, b.name, b.decor, b.lengthMm, b.widthMm, b.thicknessMm, b.grain, b.unit, b.priceMinor]),
    );
  try {
    return canon(a) === canon(fromDrafts(drafts));
  } catch {
    return false;
  }
}

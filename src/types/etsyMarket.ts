/**
 * Клієнтські типи набору Etsy-аналітики (`src/components/etsy/*`).
 *
 * Перенесено з набору «Etsy Analytics & Trend Tracker». З вихідного файлу
 * лишено тільки те, що справді використовується сьогодні: решта його типів
 * описувала форму ВИГАДАНИХ даних (мокові конкуренти, аудити, сповіщення) —
 * а ці екрани в студії будуть підключені до реального скринінгу
 * `/api/market/*`, де форма інша. Тримати тут контракт, який гарантовано
 * зміниться, означало б писати його двічі: спершу неправильно, потім
 * правильно. Типи додаються разом із екраном, який їх насправді читає.
 *
 * Дані модуля, що приходять із сервера, живуть не тут, а в
 * `server/market/marketTypes.ts` — один опис на клієнт і сервер.
 */

/** Стан калькулятора комісій Etsy. Усі суми — в доларах США. */
export interface ProfitCalcState {
  itemSalePrice: number;
  shippingCharged: number;
  itemCost: number;
  shippingCost: number;
  packagingCost: number;
  marketingBudgetPerItem: number;
  monthlySalesQuantity: number;
  /** Ставка Offsite Ads часткою одиниці: 0, 0.12 або 0.15. */
  offsiteAdsRate: number;
  isEtsyPlus: boolean;
  isDomesticFreeShipping: boolean;
  discountPercent: number;
}

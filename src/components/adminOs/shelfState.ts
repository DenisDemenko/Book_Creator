/**
 * Стан лістинга у вітрині — словами, і в одному місці.
 *
 * ЧОМУ ОКРЕМИЙ ФАЙЛ. Міст віддає і те, що стоїть у вітрині, і те, що з неї вже
 * зняли, одним переліком. Доки адмінка друкувала сире `archived` сірим рядком
 * поруч із тією самою кнопкою «Зняти з вітрини», зняття не змінювало на екрані
 * нічого: рядок лишався на місці, кнопка лишалась активною — і «Підтвердити»
 * читалось як кнопка, що не працює. Насправді лістинг зникав із вітрини одразу
 * (сторінка товару віддає 404), просто адмінка про це мовчала. Скарга власника
 * 15.11.2026.
 *
 * Тут лише правила перекладу й порядку, без React: так їх можна перевірити
 * тестом, а не оглядом тексту компонента.
 */

export interface ShelfStateView {
  /** Що показати людині. */
  label: string;
  /** Чи товар справді стоїть у вітрині (а отже, чи є що з неї знімати). */
  live: boolean;
}

const STATES: Record<string, ShelfStateView> = {
  published: { label: 'у вітрині', live: true },
  active: { label: 'у вітрині', live: true },
  archived: { label: 'знято з вітрини', live: false },
  draft: { label: 'чорнетка', live: false },
};

/**
 * Невідомий стан вважається живим НАВМИСНО: якщо маркетплейс колись додасть
 * свій стан, краще залишити кнопку зняття доступною, ніж тихо сховати її й
 * позбавити адміністратора єдиного способу прибрати товар із вітрини.
 */
export function shelfState(status: unknown): ShelfStateView {
  const key = String(status ?? '').trim().toLowerCase();
  return STATES[key] ?? { label: key || 'невідомо', live: true };
}

/** Скільки позицій справді стоїть у вітрині. */
export function countLive<T extends { status: string }>(rows: readonly T[]): number {
  return rows.filter((row) => shelfState(row.status).live).length;
}

/**
 * Живі вгорі, зняті внизу, решта порядку збережена.
 *
 * Перелік має відповідати на питання «що зараз продається», а не ховати
 * відповідь серед архіву. Сортування стабільне: усередині кожної групи
 * лишається той порядок, у якому прийшов міст.
 */
export function orderByShelf<T extends { status: string }>(rows: readonly T[]): T[] {
  const live: T[] = [];
  const gone: T[] = [];
  for (const row of rows) (shelfState(row.status).live ? live : gone).push(row);
  return [...live, ...gone];
}

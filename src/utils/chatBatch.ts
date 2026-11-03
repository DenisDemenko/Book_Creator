/**
 * Пачка абзаців для чату ШІ: усе знайдене за тегом разом із місцем у книзі,
 * щоб обговорити й виправити кожен абзац окремо (постановка власника
 * 03.11.2026).
 *
 * ЧОМУ КОЖЕН АБЗАЦ НЕСЕ СВОЇ «АДРЕСУ». Чат не бачить книги: він бачить лише те,
 * що йому дали. Щоб відповідь «в абзаці #412 слабка середина» можна було
 * зіставити з книгою, кожен абзац іде з номером (`[/paragraph:#N]`), главою,
 * розділом і тегами, за якими його знайшли. Без адреси ШІ відповів би
 * «в третьому абзаці», і автор мусив би рахувати, який із ста це третій.
 *
 * ЧОМУ ЛІМІТ ІДЕ ЗА СИМВОЛАМИ, А НЕ ЗА АБЗАЦАМИ. Абзаци бувають по сорок знаків
 * і по дві тисячі; вісімдесят абзаців діалогу влізуть, а вісімдесят довгих —
 * ні. Межа за символами тримає запит у розумному розмірі в обох випадках, а
 * все, що не влізло, ЧЕСНО називається в повідомленні й у картці, щоб автор не
 * думав, що модель бачила все.
 *
 * ЧОМУ ЦЕ ЧИСТА ЛОГІКА. Формат повідомлення — це те, що прочитає модель; його
 * потрібно перевіряти тестом, а не оком у браузері.
 */

import { CHAT_FRAGMENT_LIMIT } from './bookText';

/** Найбільший загальний розмір тексту пачки в запиті, у символах. */
export const CHAT_BATCH_CHAR_LIMIT = 40_000;

export interface ChatBatchItem {
  /** Стійкий ідентифікатор абзацу: за ним картка прибирає окремі абзаци. */
  id: string;
  /** Де в книзі: «Глава 3 «Фотограф» · Розділ «Початок»». */
  where: string;
  /** Номер абзацу з тега `[/paragraph:#N]`, якщо він є. */
  number?: number;
  /** Теги, за якими знайдено, у читному вигляді: `emotion #17`. */
  tags: string[];
  /** Повний текст абзацу без тегів. */
  text: string;
}

export interface ChatBatch {
  /** Чим знайдено: `/emotion #17` — іде в заголовок повідомлення й картки. */
  title: string;
  items: ChatBatchItem[];
}

export interface FormattedBatch {
  message: string;
  /** Скільки абзаців потрапило в повідомлення. */
  included: number;
  /** Скільки не влізло в межу. */
  omitted: number;
}

/** Підпис одного абзацу: `[абзац #412 · Глава 3 «Фотограф» · теги: emotion #17]`. */
export function batchItemLabel(item: ChatBatchItem): string {
  const parts = [item.number !== undefined ? `абзац #${item.number}` : 'абзац без номера'];
  if (item.where.trim()) parts.push(item.where.trim());
  if (item.tags.length) parts.push(`теги: ${item.tags.join(', ')}`);
  return `[${parts.join(' · ')}]`;
}

function trimBody(text: string, limit: number): string {
  const clean = String(text ?? '').replace(/\r/g, '').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/**
 * Повідомлення для чату. Лише ОПИС того, що додано, і самі абзаци: питання
 * формулює автор. Модель, якій дали абзаци без питання, починає їх переписувати,
 * а просили обговорити — тому ніяких вказівок «перепиши» тут немає.
 */
export function formatBatchForChat(
  batch: ChatBatch,
  opts: { charLimit?: number; itemLimit?: number } = {}
): FormattedBatch {
  const charLimit = opts.charLimit ?? CHAT_BATCH_CHAR_LIMIT;
  const itemLimit = opts.itemLimit ?? CHAT_FRAGMENT_LIMIT;
  const blocks: string[] = [];
  let used = 0;
  let included = 0;
  for (const item of batch.items) {
    const body = trimBody(item.text, itemLimit);
    if (!body) continue;
    const block = `▸ ${batchItemLabel(item)}\n«${body}»`;
    // Перший абзац беремо завжди: порожня пачка нічого б не обговорювала.
    if (included > 0 && used + block.length > charLimit) break;
    blocks.push(block);
    used += block.length;
    included += 1;
  }
  const withText = batch.items.filter((i) => trimBody(i.text, 1) !== '').length;
  const omitted = Math.max(0, withText - included);
  const header =
    `Абзаци книги за тегом ${batch.title}: передано ${included}` +
    (omitted ? ` із ${withText} (решта ${omitted} не вмістилась — звузьте пошук)` : '') +
    '. Кожен позначено номером абзацу, місцем у книзі й тегами; посилайся на цей номер, коли відповідаєш про окремий абзац.';
  return { message: [header, ...blocks].join('\n\n'), included, omitted };
}

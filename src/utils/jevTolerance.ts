/**
 * Толерантність Jev і пояснення вартості для кнопки «Проставити теги автоматично».
 * Чисті функції без React — щоб числа й текст про гроші перевіряв тест.
 */

/** Толерантність Jev: від 70 до 100% (постановка власника 03.11.2026). Межі збігаються із сервером. */
export const JEV_TOLERANCE_MIN = 70;
export const JEV_TOLERANCE_MAX = 100;
export const JEV_TOLERANCE_DEFAULT = 95;

export const clampTolerance = (n: number) => Math.min(JEV_TOLERANCE_MAX, Math.max(JEV_TOLERANCE_MIN, Math.round(n)));

/**
 * Скільки пропозицій додасться, якщо знизити толерантність до `pct`: ті, у кого Jev
 * упевнений не менше. Це верхня межа — ще діють ліміт 12 на абзац і відсів повторів.
 */
export function addableAt(probabilities: readonly number[], pct: number): number {
  return probabilities.filter((p) => p >= pct / 100 - 1e-9).length;
}

/**
 * З якого відсотка почати повтор: найвищий, що вже додасть хоч один тег (найпевніша з
 * непроставлених), але строго нижчий за поточний. Автор далі може знизити вручну.
 */
export function suggestRetryTolerance(probabilities: readonly number[], currentPct: number): number {
  const best = probabilities.length ? Math.floor(Math.max(...probabilities) * 100 + 1e-9) : currentPct - 5;
  return Math.min(Math.max(JEV_TOLERANCE_MIN, best), Math.max(JEV_TOLERANCE_MIN, currentPct - 1));
}

export interface JevUsage {
  inputTokens: number;
  usd: number;
  usdPerMTok: number;
  creditsEquivalent: number | null;
  charged: boolean;
}

export interface JevRunSummary {
  threshold: number;
  placed: number;
  /** Ймовірності непроставлених через поріг пропозицій — з них рахується, що дасть нижчий поріг. */
  below: number[];
  belowParagraphs: number;
  usage: JevUsage | null;
  asked: number;
  fromCache: number;
}

const fmtUsd = (usd: number) => (usd > 0 && usd < 0.0001 ? '<$0,0001' : `$${usd.toFixed(4).replace('.', ',')}`);
const fmtInt = (n: number) => n.toLocaleString('uk-UA');

/**
 * Пояснення, що Jev тарифікується за мінімальною ставкою. Окремою чистою функцією, щоб
 * текст було видно й перевірити тестом: він говорить про гроші, а вигадане число
 * тут гірше за відсутнє.
 */
export function jevTariffNote(u: JevUsage | null, asked: number, fromCache: number): string {
  const rate = `Jev тарифікується за мінімальною ставкою: $${String(u?.usdPerMTok ?? 0.042).replace('.', ',')} за 1 млн вхідних токенів.`;
  if (!u) return rate;
  const credits =
    u.creditsEquivalent === null ? '' : ` (≈ ${fmtInt(u.creditsEquivalent)} бал. в еквіваленті за курсом зображень)`;
  const wallet = u.charged ? '' : ' З вашого гаманця бали за Jev не знімаються: бали діють лише для зображень, Jev входить у текстовий бюджет плану.';
  const memory = fromCache > 0
    ? ` Цей прогін: ${fmtInt(asked)} нових питань до Jev і ${fmtInt(fromCache)} відповідей із пам'яті сервера.`
    : ` Цей прогін: ${fmtInt(asked)} питань до Jev.`;
  return `${rate} Тут витрачено ${fmtInt(u.inputTokens)} токенів ≈ ${fmtUsd(u.usd)}${credits}.${wallet}${memory} Повтор для тих самих абзаців бере відповіді з пам'яті сервера й нових звернень не потребує (після перезапуску сервера Jev спитають знову).`;
}

/**
 * Теги, які Jev вирішив поставити, у формі, що її очікує панель. Сервер віддає рішення з
 * полем `findingId` (id висновку AI-1), а підтвердження йде за `/suggestions/:id/confirm`.
 *
 * ЧОМУ ЦЕ ОКРЕМА ФУНКЦІЯ. З #493 до 03.11.2026 панель читала `d.id`, якого в рішенні
 * немає, тож `/suggestions/undefined/confirm` не підтверджував жодного тега, а
 * повідомлення чесно казало «поставив тегів: 0». Помилку знайшов лише живий прогін:
 * юніт-тести перевіряли сервер і правило порогу, але не те, як клієнт читає відповідь.
 * Тепер розбір відповіді один і перевіряється на справжньому виході маршруту.
 */
export function decidedFromResponse(body: unknown): Array<{ id: string; tag: string; editorPid: string | null }> {
  const tags = (body as { tags?: unknown } | null)?.tags;
  if (!Array.isArray(tags)) return [];
  return tags
    .filter((d): d is { findingId: string; tag?: string; editorPid?: string | null } => !!d && typeof (d as any).findingId === 'string')
    .map((d) => ({ id: d.findingId, tag: typeof d.tag === 'string' ? d.tag : '', editorPid: d.editorPid ?? null }));
}

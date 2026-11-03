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
  /** Собівартість Jev, $ за 1 млн вхідних токенів. */
  usdPerMTok: number;
  /** Тариф у балах за 1 млн токенів (конфіг цін адмінки); 0 — Jev безкоштовний. */
  creditsPerMTok: number;
  /** Скільки це коштувало б за тарифом. */
  creditsAtRate: number;
  /** Скільки балів справді списано. */
  credits: number;
  charged: boolean;
  /** Витрата перевищила резерв: списано лише резерв. */
  capped: boolean;
}

/** Тариф і баланс до прогону (`GET /ai/jev-tags/tariff`). */
export interface JevTariff {
  creditsPerMillionTokens: number;
  unlimited: boolean;
  balance: number | null;
}

/**
 * Типовий абзац коштує до ≈ 2 600 токенів Jev (пілот: 24 питання на абзац, 2599 токенів
 * на запит). Це верхня оцінка для підказки перед прогоном, а не гарантія.
 */
export const JEV_TYPICAL_PARAGRAPH_TOKENS = 2600;

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

/** «1 бал», «2 бали», «5 балів», «21 бал», «23 бали», «11 балів» — українська множина. */
const fmtCredits = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? 'бал' : m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14) ? 'бали' : 'балів';
  return `${fmtInt(n)} ${word}`;
};

/**
 * Рядок про тариф ПЕРЕД прогоном: скільки коштує Jev і що на балансі. Окремою чистою
 * функцією, щоб текст про гроші й бали перевіряв тест: вигадане число тут гірше за відсутнє.
 */
export function jevRateLine(t: JevTariff | null): string {
  if (!t) return '';
  if (!(t.creditsPerMillionTokens > 0)) return 'Jev зараз без списання балів.';
  const perParagraph = Math.max(1, Math.ceil((JEV_TYPICAL_PARAGRAPH_TOKENS * t.creditsPerMillionTokens) / 1_000_000));
  const rate = `Тариф Jev: ${fmtCredits(t.creditsPerMillionTokens)} за 1 млн токенів; типовий абзац — до ≈ ${fmtInt(JEV_TYPICAL_PARAGRAPH_TOKENS)} токенів ≈ ${fmtCredits(perParagraph)}.`;
  const tail = t.unlimited || t.balance === null ? ' Для вас без списання.' : ` На балансі: ${fmtCredits(t.balance)}.`;
  return `${rate}${tail} Повтор для тих самих абзаців балів не коштує.`;
}

/**
 * Пояснення після прогону: тариф, скільки витрачено й списано, і що повтор для тих самих
 * абзаців бере відповіді з пам'яті сервера й нічого не коштує.
 */
export function jevTariffNote(u: JevUsage | null, asked: number, fromCache: number): string {
  const free = !!u && !(u.creditsPerMTok > 0);
  const rate = free
    ? 'Jev зараз без списання балів.'
    : `Тариф Jev: ${fmtCredits(u?.creditsPerMTok ?? 0)} за 1 млн токенів (собівартість $${String(u?.usdPerMTok ?? 0.042).replace('.', ',')} за 1 млн).`;
  if (!u) return rate;
  const spent = `Тут витрачено ${fmtInt(u.inputTokens)} токенів ≈ ${fmtUsd(u.usd)}.`;
  let charge: string;
  if (free) charge = '';
  else if (u.charged) charge = ` Списано ${fmtCredits(u.credits)} з вашого гаманця.${u.capped ? ' Витрата перевищила резерв — зайве вбрала платформа.' : ''}`;
  else if (u.inputTokens === 0) charge = ' Балів не списано: нових звернень до Jev не було.';
  else charge = ` Для вас без списання (адміністратор або бали вимкнено); за тарифом це було б ${fmtCredits(u.creditsAtRate)}.`;
  const memory = fromCache > 0
    ? ` Цей прогін: ${fmtInt(asked)} нових питань до Jev і ${fmtInt(fromCache)} відповідей із пам'яті сервера.`
    : ` Цей прогін: ${fmtInt(asked)} питань до Jev.`;
  return `${rate} ${spent}${charge}${memory} Повтор для тих самих абзаців бере відповіді з пам'яті сервера й не коштує балів (після перезапуску сервера Jev спитають знову).`;
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

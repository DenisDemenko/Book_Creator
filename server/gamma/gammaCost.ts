/**
 * Оцінка вартості генерації в кредитах Gamma.
 *
 * НАВІЩО ЦЕ ОКРЕМИЙ МОДУЛЬ. Кожна генерація списує гроші з рахунку власника
 * студії, а правити згенероване Gamma не вміє — невдалий результат означає
 * повторну оплату. Отже автор має бачити ціну ДО натискання, і ця ціна має
 * рахуватись, а не бути написаною в інтерфейсі константою, яка застаріє.
 *
 * ЦИФРИ — З ДОКУМЕНТАЦІЇ GAMMA (звірено 03.09.2026), а не з нашого досвіду:
 *   • текст: 1–3 кредити за картку, залежно від моделі, яку Gamma обирає
 *     сама — тому це діапазон, а не число;
 *   • зображення: 2–15 (звичайні), 20–33 (просунуті), 34–75 (преміальні),
 *     30–125 (ultra) за штуку.
 *
 * ЧОМУ ДІАПАЗОН, А НЕ ОДНЕ ЧИСЛО. Точну вартість знає лише Gamma після
 * генерації (вона повертає її в `credits.deducted`). Показати одне число
 * означало б пообіцяти те, чого ми не контролюємо: модель тексту обирається
 * на їхньому боці. Діапазон чесний, а факт приходить у відповіді.
 *
 * ГОЛОВНИЙ ВИСНОВОК, ЯКИЙ ВАРТО ЗНАТИ: у деку платять переважно за
 * КАРТИНКИ, а не за текст. Дев'ять карток тексту — це 9–27 кредитів, а
 * дев'ять преміальних зображень — 306–675. Тому `noImages` економить
 * більше, ніж будь-яке скорочення тексту.
 */

export type ImageTier = 'none' | 'standard' | 'advanced' | 'premium' | 'ultra';

/** Вартість одного зображення за рівнем моделі (з документації Gamma). */
export const IMAGE_TIER_COST: Record<ImageTier, { min: number; max: number }> = {
  none: { min: 0, max: 0 },
  standard: { min: 2, max: 15 },
  advanced: { min: 20, max: 33 },
  premium: { min: 34, max: 75 },
  ultra: { min: 30, max: 125 },
};

/** Вартість однієї картки тексту. */
export const CARD_COST = { min: 1, max: 3 };

/** Межі, які документує Gamma. Порушення — 400 від їхнього боку. */
export const LIMITS = {
  inputTextMax: 400_000,
  numCardsMin: 1,
  numCardsMax: 75,
  additionalInstructionsMax: 5_000,
  imagePromptMax: 5_000,
  folderIdsMax: 1,
  referenceImagesMax: 4,
};

export interface CostEstimate {
  min: number;
  max: number;
  /** Скільки з цього припадає на картинки — щоб було видно, де гроші. */
  imagesMin: number;
  imagesMax: number;
  noteUk: string;
}

/**
 * Оцінка для генерації документа/презентації.
 *
 * `images` за замовчуванням дорівнює кількості карток: коли джерело
 * `aiGenerated`, Gamma ставить приблизно по картинці на картку. Це
 * припущення, і воно назване в `noteUk` — краще перебільшити очікувану
 * ціну, ніж здивувати автора рахунком.
 */
export function estimateGeneration(params: {
  numCards: number;
  imageTier: ImageTier;
  imagesPerCard?: number;
}): CostEstimate {
  const cards = Math.max(0, Math.round(params.numCards) || 0);
  const perCard = params.imageTier === 'none' ? 0 : params.imagesPerCard ?? 1;
  const images = Math.round(cards * perCard);
  const tier = IMAGE_TIER_COST[params.imageTier];

  const textMin = cards * CARD_COST.min;
  const textMax = cards * CARD_COST.max;
  const imagesMin = images * tier.min;
  const imagesMax = images * tier.max;

  const noteUk =
    params.imageTier === 'none'
      ? `${cards} карток тексту без зображень. Точну суму Gamma повідомляє після генерації.`
      : `${cards} карток тексту (${textMin}–${textMax}) плюс приблизно ${images} зображень ` +
        `(${imagesMin}–${imagesMax}). Кількість картинок Gamma вирішує сама — це оцінка. ` +
        'Вимкнення зображень економить більше, ніж скорочення тексту.';

  return { min: textMin + imagesMin, max: textMax + imagesMax, imagesMin, imagesMax, noteUk };
}

/** Оцінка для окремого зображення (`POST /images`). */
export function estimateImage(tier: ImageTier): CostEstimate {
  const t = IMAGE_TIER_COST[tier];
  return {
    min: t.min,
    max: t.max,
    imagesMin: t.min,
    imagesMax: t.max,
    noteUk:
      tier === 'none'
        ? 'Без зображення — нічого не списується.'
        : 'Одне зображення. Точну суму Gamma повідомляє після генерації.',
  };
}

/**
 * До якого рівня належить модель зображень.
 *
 * Перелік неповний за побудовою: Gamma додає моделі частіше, ніж ми
 * оновлюємо код. Невідома модель вважається `premium` — навмисно
 * найдорожчою з ходових: помилитись у бік «дорожче, ніж буде» безпечніше,
 * ніж пообіцяти дешевину й списати втричі більше.
 */
export function tierOfModel(model?: string | null): ImageTier {
  const id = String(model || '').toLowerCase();
  if (!id) return 'standard';
  if (/klein|flash-image-mini|turbo|fast/.test(id)) return 'standard';
  if (/recraft-v3|ideogram-v3$|luma-photon-flash|gemini-2\.5-flash/.test(id)) return 'advanced';
  if (/ultra|pro-image-hd|gpt-image-1-high|flux-2-max/.test(id)) return 'ultra';
  return 'premium';
}

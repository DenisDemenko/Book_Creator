/**
 * Правила Etsy для цифрового лістингу — у вигляді чистих функцій.
 *
 * Головна ідея цього файлу: **усі обмеження платформи перевіряються ДО того,
 * як ми звернемось до API** (критерій приймання 4.6: «спроба прикріпити 6-й
 * файл або файл >20 МБ блокується на етапі підготовки… до звернення до API»).
 * Причина не формальна: якщо ловити такі помилки відповіддю Etsy, автор
 * дізнається про проблему після п'яти хвилин завантаження, а половина файлів
 * уже висітиме в чернетці.
 *
 * Тут немає ані мережі, ані бази — лише правила, тож вони покриті тестами
 * напряму й однаково використовуються і роутом підготовки, і воркером черги.
 */

/** ТЗ 4.1 — максимум 5 цифрових файлів на лістинг. */
export const MAX_DIGITAL_FILES = 5;
/** ТЗ 4.1 — до 20 МБ кожен. */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Обкладинка + до 9 додаткових прев'ю. */
export const MAX_LISTING_IMAGES = 10;
/** ТЗ 6.2 — до 13 тегів, кожен ≤20 символів. */
export const MAX_TAGS = 13;
export const MAX_TAG_CHARS = 20;
/** Обмеження Etsy на заголовок лістингу. */
export const MAX_TITLE_CHARS = 140;
export const MAX_DESCRIPTION_CHARS = 12_000;

/** ТЗ 4.1 — дозволені розширення цифрових файлів. */
export const ALLOWED_FILE_EXTENSIONS = [
  '.pdf', '.doc', '.zip', '.mp3', '.mov', '.epub', '.mobi',
  '.txt', '.rtf', '.png', '.jpg', '.gif', '.bmp', '.psp', '.stl', '.ibook',
];

export interface ListingFileInput {
  name: string;
  bytes: number;
}

export interface ListingDraftInput {
  title: string;
  description: string;
  priceUsd: number;
  tags?: string[];
  files: ListingFileInput[];
  imageCount?: number;
  /** Для цифрового товару варіації недоступні — ловимо це як явну помилку. */
  hasVariations?: boolean;
}

export type IssueSeverity = 'blocker' | 'warning';

export interface ListingIssue {
  severity: IssueSeverity;
  field: string;
  messageUk: string;
}

export interface ListingValidation {
  ok: boolean;
  issues: ListingIssue[];
  totalBytes: number;
}

export function fileExtension(name: string): string {
  const match = /\.[^.\\/]+$/.exec(String(name).trim().toLowerCase());
  return match ? match[0] : '';
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${bytes} Б`;
}

/**
 * Нормалізація тега під вимоги Etsy: без розділових знаків, ≤20 символів,
 * без дублів. Обрізаємо по межі слова, а не посеред нього — обрубок на кшталт
 * «watercolor journ» гірший за коротший, але цілий тег.
 */
export function normalizeTag(raw: string): string | null {
  const cleaned = String(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (cleaned.length <= MAX_TAG_CHARS) return cleaned;

  const words = cleaned.split(' ');
  let acc = '';
  for (const word of words) {
    const candidate = acc ? `${acc} ${word}` : word;
    if (candidate.length > MAX_TAG_CHARS) break;
    acc = candidate;
  }
  return acc || cleaned.slice(0, MAX_TAG_CHARS).trim();
}

export function normalizeTags(raw: string[]): string[] {
  const out: string[] = [];
  for (const tag of raw || []) {
    const normalized = normalizeTag(tag);
    if (normalized && !out.includes(normalized)) out.push(normalized);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

export function validateListingDraft(draft: ListingDraftInput): ListingValidation {
  const issues: ListingIssue[] = [];
  const files = draft.files || [];
  const totalBytes = files.reduce((sum, f) => sum + (Number(f.bytes) || 0), 0);

  const title = String(draft.title || '').trim();
  if (!title) {
    issues.push({ severity: 'blocker', field: 'title', messageUk: 'Назва лістингу порожня.' });
  } else if (title.length > MAX_TITLE_CHARS) {
    issues.push({
      severity: 'blocker',
      field: 'title',
      messageUk: `Назва задовга: ${title.length} символів із дозволених ${MAX_TITLE_CHARS}.`,
    });
  }

  const description = String(draft.description || '').trim();
  if (!description) {
    issues.push({
      severity: 'warning',
      field: 'description',
      messageUk: 'Опис порожній — покупець на Etsy майже завжди читає саме опис.',
    });
  } else if (description.length > MAX_DESCRIPTION_CHARS) {
    issues.push({
      severity: 'blocker',
      field: 'description',
      messageUk: `Опис задовгий: ${description.length} символів із дозволених ${MAX_DESCRIPTION_CHARS}.`,
    });
  }

  const price = Number(draft.priceUsd);
  if (!Number.isFinite(price) || price <= 0) {
    issues.push({ severity: 'blocker', field: 'price', messageUk: 'Ціна має бути більшою за нуль.' });
  }

  if (draft.hasVariations) {
    issues.push({
      severity: 'blocker',
      field: 'variations',
      messageUk: 'Для цифрового товару Etsy не підтримує варіації (розміри, кольори) — приберіть їх.',
    });
  }

  if (files.length === 0) {
    issues.push({
      severity: 'blocker',
      field: 'files',
      messageUk: 'До лістингу не додано жодного цифрового файлу.',
    });
  }
  if (files.length > MAX_DIGITAL_FILES) {
    issues.push({
      severity: 'blocker',
      field: 'files',
      messageUk: `Etsy дозволяє максимум ${MAX_DIGITAL_FILES} файлів на лістинг, а тут ${files.length}. Спакуйте частину в один .zip або скористайтесь сценарієм А (лінк на повний курс).`,
    });
  }

  for (const file of files) {
    const ext = fileExtension(file.name);
    if (!ext) {
      issues.push({
        severity: 'blocker',
        field: `file:${file.name}`,
        messageUk: `Файл «${file.name}» без розширення — Etsy не прийме такий.`,
      });
    } else if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
      issues.push({
        severity: 'blocker',
        field: `file:${file.name}`,
        messageUk: `Формат ${ext} не входить у перелік дозволених Etsy (${ALLOWED_FILE_EXTENSIONS.join(' ')}).`,
      });
    }
    if ((Number(file.bytes) || 0) > MAX_FILE_BYTES) {
      issues.push({
        severity: 'blocker',
        field: `file:${file.name}`,
        messageUk: `Файл «${file.name}» важить ${formatBytes(file.bytes)} — це більше за ліміт Etsy у 20 МБ.`,
      });
    }
    if ((Number(file.bytes) || 0) === 0) {
      issues.push({
        severity: 'warning',
        field: `file:${file.name}`,
        messageUk: `Файл «${file.name}» порожній — перевірте, чи він сформувався.`,
      });
    }
  }

  const imageCount = Number(draft.imageCount ?? 0);
  if (imageCount === 0) {
    issues.push({
      severity: 'warning',
      field: 'images',
      messageUk: 'Немає жодного зображення. Лістинг без обкладинки майже не має шансів у пошуку Etsy.',
    });
  }
  if (imageCount > MAX_LISTING_IMAGES) {
    issues.push({
      severity: 'blocker',
      field: 'images',
      messageUk: `Зображень ${imageCount}, а Etsy приймає максимум ${MAX_LISTING_IMAGES} (обкладинка + 9 прев'ю).`,
    });
  }

  const tags = draft.tags || [];
  if (tags.length > MAX_TAGS) {
    issues.push({
      severity: 'blocker',
      field: 'tags',
      messageUk: `Тегів ${tags.length}, дозволено ${MAX_TAGS}.`,
    });
  }
  for (const tag of tags) {
    if (String(tag).length > MAX_TAG_CHARS) {
      issues.push({
        severity: 'blocker',
        field: `tag:${tag}`,
        messageUk: `Тег «${tag}» довший за ${MAX_TAG_CHARS} символів.`,
      });
    }
  }

  return { ok: !issues.some((i) => i.severity === 'blocker'), issues, totalBytes };
}

// ---------------------------------------------------------------------------
// Стратегія доставки курсу (ТЗ 4.4)
// ---------------------------------------------------------------------------

export type DeliveryScenario = 'A' | 'B';

export interface ScenarioRecommendation {
  scenario: DeliveryScenario;
  reasonUk: string;
  totalBytes: number;
  fileCount: number;
  fitsEtsy: boolean;
}

/**
 * Обирає між «Etsy як вхідна лійка» (А) і «компактний курс одним zip» (Б).
 *
 * Поріг навмисно нижчий за 20 МБ: набір, що важить 19,5 МБ, формально
 * влазить, але будь-яке доповнення матеріалів наступного місяця вимагатиме
 * перепаковувати товар. Тому від 90% ліміту радимо сценарій А, чесно
 * пояснюючи причину.
 */
export function recommendDeliveryScenario(
  components: { name: string; bytes: number }[],
  options: { limitBytes?: number; safetyRatio?: number } = {}
): ScenarioRecommendation {
  const limit = options.limitBytes ?? MAX_FILE_BYTES;
  const safety = options.safetyRatio ?? 0.9;
  const totalBytes = (components || []).reduce((sum, c) => sum + (Number(c.bytes) || 0), 0);
  const fileCount = (components || []).length;
  const fitsEtsy = totalBytes <= limit && fileCount <= MAX_DIGITAL_FILES;

  if (totalBytes > limit) {
    return {
      scenario: 'A',
      reasonUk: `Матеріали важать ${formatBytes(totalBytes)} — більше за ліміт Etsy у ${formatBytes(limit)}. Публікуємо PDF-путівник із лінком доступу, а сам курс лишається на вашій платформі.`,
      totalBytes,
      fileCount,
      fitsEtsy,
    };
  }
  if (fileCount > MAX_DIGITAL_FILES) {
    return {
      scenario: 'A',
      reasonUk: `Компонентів ${fileCount}, а Etsy приймає ${MAX_DIGITAL_FILES} файлів. Навіть спаковані в один .zip вони лишаються керованішими через лінк доступу.`,
      totalBytes,
      fileCount,
      fitsEtsy,
    };
  }
  if (totalBytes > limit * safety) {
    return {
      scenario: 'A',
      reasonUk: `Набір займає ${formatBytes(totalBytes)} — це понад ${Math.round(safety * 100)}% ліміту. Формально влізе, але будь-яке доповнення матеріалів вимагатиме перепаковування; надійніше публікувати путівник із лінком.`,
      totalBytes,
      fileCount,
      fitsEtsy,
    };
  }
  return {
    scenario: 'B',
    reasonUk: `Набір займає ${formatBytes(totalBytes)} із ${formatBytes(limit)} — вміщується в один .zip і публікується як єдиний цифровий товар.`,
    totalBytes,
    fileCount,
    fitsEtsy,
  };
}

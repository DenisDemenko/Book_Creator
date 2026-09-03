/**
 * Аудит лістинга Etsy — детерміновані перевірки за задокументованими
 * правилами майданчика.
 *
 * ЧОМУ ЦЕ НАПИСАНО НАНОВО, А НЕ ПЕРЕНЕСЕНО. У наборі «Etsy Analytics &
 * Trend Tracker» екран аудиту рахував так:
 *
 *     searchVolume: Math.floor(Math.random() * 30000) + 5000,
 *     competition: t.length < 12 ? 'High' : t.length < 18 ? 'Medium' : 'Low',
 *     mediaQuality: 90, pricingScore: 84, conversionStrength: 88,
 *
 * Тобто частоту запиту він кидав кубиком, конкуренцію виводив із ДОВЖИНИ
 * тега, а три з п'яти складників підсумкового бала були константами. Автор,
 * який назве товар за такою «аналітикою», ухвалить рішення за випадковим
 * числом. Перенести це поруч зі скринінгом, де кожне значення несе позначку
 * походження, було б гірше, ніж не мати вкладки взагалі.
 *
 * ЩО ТУТ НАТОМІСТЬ. Тільки те, що можна перевірити з самого лістинга, не
 * знаючи нічого про ринок: ліміти Etsy (140 символів у назві, 13 тегів, 20
 * символів на тег) і правила, які майданчик описує у власній довідці. Кожна
 * перевірка відтворюється з видимого тексту — її можна перерахувати вручну
 * й отримати те саме число.
 *
 * ЧОГО ТУТ НЕМАЄ І НЕ БУДЕ БЕЗ ДАНИХ: частоти запитів, рівня конкуренції,
 * прогнозу конверсії, «передбаченого» бала SEO. Etsy не публікує ці
 * величини, а вигадати їх — те саме, що збрехати впевненим тоном.
 */

/** Ліміти майданчика. Винесені, бо на них спирається і текст підказок. */
export const ETSY_TITLE_MAX = 140;
export const ETSY_TAG_MAX = 13;
export const ETSY_TAG_CHARS_MAX = 20;
/** Скільки перших символів назви люди й пошук бачать першими. */
export const TITLE_HEAD_CHARS = 40;

export type AuditStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface AuditCheck {
  id: string;
  /** Коротка назва перевірки — те, що читають першим. */
  label: string;
  status: AuditStatus;
  /** Що саме знайдено. Завжди з числом, щоб перевірку можна було звірити. */
  detail: string;
  /**
   * Вага в підсумковому балі. `0` — довідкова перевірка: вона щось
   * повідомляє, але не має права рухати бал (наприклад, підказка про
   * мову тегів, яка залежить від того, на який ринок працює продавець).
   */
  weight: number;
}

export interface ListingAuditInput {
  title: string;
  /** Теги рядком через кому — саме так їх копіюють з Etsy. */
  tags: string;
  description?: string;
  priceUsd?: number | null;
}

export interface ListingAuditReport {
  checks: AuditCheck[];
  /** 0–100. Частка ваги пройдених перевірок, і нічого більше. */
  score: number;
  /** Скільки ваги дав кожен статус — щоб бал відтворювався очима. */
  breakdown: { earned: number; possible: number };
  titleLength: number;
  tags: string[];
  /** Теги, які дослівно зустрічаються в назві. */
  tagsInTitle: string[];
}

/** Розбір рядка тегів. Порожні відкидаються, регістр приводиться до нижнього. */
export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter((tag) => tag.length > 0);
}

/** Груба нормалізація для пошуку дублів: «mugs» і «mug» — той самий слот. */
function tagStem(tag: string): string {
  return tag
    .split(' ')
    .map((word) => word.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''))
    .join(' ');
}

/**
 * Перевірка, якій нічого перевіряти.
 *
 * Порожній лістинг спершу набирав 43 бали зі 100 — і кожен доданок був
 * формально правдивий: у нього справді немає задовгих тегів, немає дублів,
 * немає САПС у назві. Правдиві доданки склались у брехливий підсумок:
 * автор побачив би, що він на третину шляху, не ввівши жодного символу.
 * Тому відсутність даних дає `info` з вагою 0 — «нічого перевіряти», а не
 * «перевірку пройдено».
 */
const NOTHING_TO_CHECK = (label: string, detail: string): AuditCheck => ({
  id: '',
  label,
  status: 'info',
  detail,
  weight: 0,
});

function statusOf(ok: boolean, softFail: boolean): AuditStatus {
  if (ok) return 'pass';
  return softFail ? 'warn' : 'fail';
}

export function auditListing(input: ListingAuditInput): ListingAuditReport {
  const title = (input.title || '').trim();
  const description = (input.description || '').trim();
  const tags = parseTags(input.tags || '');
  const titleLower = title.toLowerCase();
  const titleHead = titleLower.slice(0, TITLE_HEAD_CHARS);
  const tagsInTitle = tags.filter((tag) => titleLower.includes(tag));

  const checks: AuditCheck[] = [];

  // --- Назва -------------------------------------------------------------
  checks.push({
    id: 'title-length',
    label: 'Довжина назви',
    ...(title.length === 0
      ? { status: 'fail' as AuditStatus, detail: 'Назва порожня.' }
      : title.length > ETSY_TITLE_MAX
        ? {
            status: 'fail' as AuditStatus,
            detail: `${title.length} символів — Etsy обріже на ${ETSY_TITLE_MAX}.`,
          }
        : title.length < 60
          ? {
              status: 'warn' as AuditStatus,
              detail: `${title.length} символів зі ${ETSY_TITLE_MAX} доступних — половина місця під ключові слова не використана.`,
            }
          : {
              status: 'pass' as AuditStatus,
              detail: `${title.length} зі ${ETSY_TITLE_MAX} символів.`,
            }),
    weight: 2,
  });

  const headTag = tags.find((tag) => titleHead.includes(tag));
  checks.push({
    id: 'title-head',
    label: `Головне ключове слово в перших ${TITLE_HEAD_CHARS} символах`,
    status: tags.length === 0 ? 'info' : headTag ? 'pass' : 'warn',
    detail:
      tags.length === 0
        ? 'Немає тегів, з чим порівнювати.'
        : headTag
          ? `Знайдено «${headTag}».`
          : `Жоден із ${tags.length} тегів не трапляється на початку назви. Саме цей уривок покупець бачить у видачі й у вкладці браузера.`,
    weight: tags.length === 0 ? 0 : 2,
  });

  const capsWords = title.split(/\s+/).filter((word) => word.length >= 4 && word === word.toUpperCase() && /[A-ZА-ЯЇІЄҐ]/.test(word));
  checks.push(
    title.length === 0
      ? { ...NOTHING_TO_CHECK('Слова САПС у назві', 'Назви немає.'), id: 'title-caps' }
      : {
          id: 'title-caps',
          label: 'Слова САПС у назві',
          status: capsWords.length === 0 ? 'pass' : 'warn',
          detail:
            capsWords.length === 0
              ? 'Немає.'
              : `${capsWords.length}: ${capsWords.slice(0, 4).join(', ')}. Etsy не забороняє, але в видачі це читається як реклама.`,
          weight: 1,
        }
  );

  const separators = (title.match(/[|,\-–—]/g) || []).length;
  checks.push(
    title.length === 0
      ? { ...NOTHING_TO_CHECK('Роздільники в назві', 'Назви немає.'), id: 'title-separators' }
      : {
          id: 'title-separators',
          label: 'Роздільники в назві',
          status: separators <= 6 ? 'pass' : 'warn',
          detail:
            separators <= 6
              ? `${separators} — у межах читабельного.`
              : `${separators} роздільників: назва перетворилась на список ключових слів, який людина не дочитує.`,
          weight: 1,
        }
  );

  // --- Теги --------------------------------------------------------------
  checks.push({
    id: 'tag-count',
    label: 'Кількість тегів',
    status: statusOf(tags.length === ETSY_TAG_MAX, tags.length >= 10),
    detail:
      tags.length === ETSY_TAG_MAX
        ? `${ETSY_TAG_MAX} із ${ETSY_TAG_MAX} — усі слоти зайняті.`
        : `${tags.length} із ${ETSY_TAG_MAX}. Незаповнений слот — це запит, за яким товар не знайдуть; вони безкоштовні.`,
    weight: 3,
  });

  const tooLong = tags.filter((tag) => tag.length > ETSY_TAG_CHARS_MAX);
  checks.push(
    tags.length === 0
      ? { ...NOTHING_TO_CHECK(`Довжина тега ≤ ${ETSY_TAG_CHARS_MAX} символів`, 'Тегів немає.'), id: 'tag-length' }
      : {
          id: 'tag-length',
          label: `Довжина тега ≤ ${ETSY_TAG_CHARS_MAX} символів`,
          status: tooLong.length === 0 ? 'pass' : 'fail',
          detail:
            tooLong.length === 0
              ? 'Усі теги вкладаються в ліміт.'
              : `${tooLong.length} задовгих — Etsy їх не прийме: ${tooLong.slice(0, 3).map((tag) => `«${tag}» (${tag.length})`).join(', ')}.`,
          weight: 2,
        }
  );

  const seen = new Map<string, string>();
  const duplicates: string[] = [];
  for (const tag of tags) {
    const stem = tagStem(tag);
    const first = seen.get(stem);
    if (first) duplicates.push(`«${first}» / «${tag}»`);
    else seen.set(stem, tag);
  }
  checks.push(
    tags.length === 0
      ? { ...NOTHING_TO_CHECK('Теги-дублі', 'Тегів немає.'), id: 'tag-duplicates' }
      : {
          id: 'tag-duplicates',
          label: 'Теги-дублі',
          status: duplicates.length === 0 ? 'pass' : 'warn',
          detail:
            duplicates.length === 0
              ? 'Немає.'
              : `${duplicates.length}: ${duplicates.slice(0, 3).join(', ')}. Etsy зводить однину й множину в один запит, тож другий слот витрачено даремно.`,
          weight: 2,
        }
  );

  const singleWord = tags.filter((tag) => !tag.includes(' '));
  checks.push({
    id: 'tag-longtail',
    label: 'Однослівні теги',
    status: tags.length === 0 ? 'info' : singleWord.length <= 3 ? 'pass' : 'warn',
    detail:
      tags.length === 0
        ? 'Тегів немає.'
        : `${singleWord.length} з ${tags.length}. За однослівним запитом конкурують сотні тисяч лістингів; фрази з 2–3 слів дають шанс вийти в перших рядках.`,
    weight: tags.length === 0 ? 0 : 2,
  });

  checks.push({
    id: 'tag-title-overlap',
    label: 'Збіг тегів із назвою',
    status: tags.length === 0 ? 'info' : tagsInTitle.length >= 3 ? 'pass' : 'warn',
    detail:
      tags.length === 0
        ? 'Тегів немає.'
        : `${tagsInTitle.length} з ${tags.length} тегів дослівно є в назві. Збіг назви й тега — найсильніший сигнал релевантності, який продавець може дати сам.`,
    weight: tags.length === 0 ? 0 : 2,
  });

  // Мова тегів. Це ДОВІДКОВА перевірка (вага 0): продавець може свідомо
  // працювати на україномовний ринок, і знімати за це бали було б
  // самовпевненістю. Але мовчати теж не можна — кирилиця в тегах на
  // англомовну авдиторію означає нуль показів.
  const cyrillicTags = tags.filter((tag) => /[а-яїієґ]/i.test(tag));
  if (cyrillicTags.length > 0) {
    checks.push({
      id: 'tag-language',
      label: 'Мова тегів',
      status: 'info',
      detail: `${cyrillicTags.length} тегів кирилицею. Пошук Etsy мовно-залежний: за англомовним запитом такий тег не спрацює. Якщо ринок збуту — США чи ЄС, теги мають бути англійською.`,
      weight: 0,
    });
  }

  // --- Опис і ціна -------------------------------------------------------
  checks.push({
    id: 'description-head',
    label: 'Перші 160 символів опису',
    status: description.length === 0 ? 'fail' : description.length < 160 ? 'warn' : 'pass',
    detail:
      description.length === 0
        ? 'Опис порожній. Саме його початок Google показує під посиланням на лістинг.'
        : description.length < 160
          ? `${description.length} символів — коротше за уривок, який показує Google.`
          : `${description.length} символів.`,
    weight: 2,
  });

  const price = typeof input.priceUsd === 'number' && Number.isFinite(input.priceUsd) ? input.priceUsd : null;
  checks.push({
    id: 'price-set',
    label: 'Ціна',
    status: price === null || price <= 0 ? 'fail' : 'pass',
    detail: price === null || price <= 0 ? 'Не вказана.' : `$${price.toFixed(2)}.`,
    weight: 1,
  });

  // --- Бал ---------------------------------------------------------------
  //
  // Бал складається ЛИШЕ з перевірок вище: пройдена — вся вага,
  // попередження — половина, провал — нуль, довідкова — не рахується.
  // Ніяких доданків «за красу», яких не видно в переліку.
  let earned = 0;
  let possible = 0;
  for (const check of checks) {
    if (check.weight === 0) continue;
    possible += check.weight;
    if (check.status === 'pass') earned += check.weight;
    else if (check.status === 'warn') earned += check.weight / 2;
  }
  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);

  return {
    checks,
    score,
    breakdown: { earned: Math.round(earned * 100) / 100, possible },
    titleLength: title.length,
    tags,
    tagsInTitle,
  };
}

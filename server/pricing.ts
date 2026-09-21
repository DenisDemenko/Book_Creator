/**
 * Тарифи Google Gemini API та розрахунок вартості генерацій.
 *
 * Ціни взяті з офіційної сторінки тарифів (стандартний, не пакетний рівень)
 * станом на серпень 2026. Вони змінюються, тож кожен запис має поле
 * `updatedAt`, а адміністратор бачить цю дату в панелі й може перевизначити
 * тариф через змінні оточення, не чекаючи оновлення коду.
 *
 * Джерело: https://ai.google.dev/gemini-api/docs/pricing
 */

export const PRICING_UPDATED_AT = '2026-08-18';

/** Вартість однієї згенерованої картинки в доларах, за роздільністю. */
export interface ImagePriceTable {
  modelId: string;
  label: string;
  /** Ключ — роздільність ('1K' | '2K' | '4K'). */
  perImageUsd: Record<string, number>;
}

/**
 * Ідентифікатори моделей Seedream. Живуть тут, бо тариф прив’язаний
 * саме до моделі: v4.0 і v4.5 на fal коштують по-різному, і логувати
 * витрату під назвою двигуна означало б занижувати рахунок на чверть,
 * щойно хтось перемкнеться на 4.5.
 */
export const SEEDREAM_ARK_MODEL = process.env.SEEDREAM_MODEL || 'seedream-4-0-250828';
export const SEEDREAM_FAL_MODEL =
  process.env.SEEDREAM_FAL_MODEL || 'fal-ai/bytedance/seedream/v4.5/text-to-image';
/**
 * Окрема модель fal для мультиреференсної генерації (задача #52) —
 * text-to-image і edit це РІЗНІ ендпоїнти fal з різними схемами полів
 * (edit приймає image_urls), тож і модель для тарифу окрема.
 */
export const SEEDREAM_FAL_EDIT_MODEL =
  process.env.SEEDREAM_FAL_EDIT_MODEL || 'fal-ai/bytedance/seedream/v4.5/edit';

export const IMAGE_PRICING: Record<string, ImagePriceTable> = {
  'nano-banana-2-lite': {
    modelId: 'gemini-3.1-flash-lite-image',
    label: 'Nano Banana 2 Lite',
    perImageUsd: { '1K': 0.0336 },
  },
  'nano-banana-2': {
    modelId: 'gemini-3.1-flash-image',
    label: 'Nano Banana 2',
    perImageUsd: { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  },
  'nano-banana-pro': {
    modelId: 'gemini-3-pro-image',
    label: 'Nano Banana Pro',
    perImageUsd: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
  },
  seedream: {
    modelId: SEEDREAM_ARK_MODEL,
    label: 'Seedream 4.0 (ByteDance, Ark)',
    // Офіційна ціна BytePlus ModelArk — флет $0.03/зображення незалежно
    // від роздільності (1K–4K). Джерело: docs.byteplus.com/en/docs/ModelArk/1544106
    // (звірено серпень 2026). До цього запису тут не було — engine_id
    // 'seedream' коректно писався в usage_log, але priceForImage()
    // мовчки повертав 0, бо не знаходив тариф.
    perImageUsd: { '1K': 0.03 },
  },

  // Та сама модель ByteDance, але через fal.ai. Ціни різні за версіями,
  // і саме fal лишається єдиним доступом до Seedream для країн, яким
  // ModelArk відмовляє в реєстрації.
  'fal-ai/bytedance/seedream/v4/text-to-image': {
    modelId: 'fal-ai/bytedance/seedream/v4/text-to-image',
    label: 'Seedream 4.0 (ByteDance, fal.ai)',
    perImageUsd: { '1K': 0.03 },
  },
  'fal-ai/bytedance/seedream/v4.5/text-to-image': {
    modelId: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    label: 'Seedream 4.5 (ByteDance, fal.ai)',
    // $0.04 — дорожче за 4.0 на чверть. Джерело: сторінка моделі на
    // fal.ai, звірено серпень 2026.
    perImageUsd: { '1K': 0.04 },
  },
  // Мультиреференсна генерація (задача #52) — той самий рушій, окремий
  // ендпоїнт fal, та сама ціна.
  'fal-ai/bytedance/seedream/v4.5/edit': {
    modelId: 'fal-ai/bytedance/seedream/v4.5/edit',
    label: 'Seedream 4.5 Edit (ByteDance, fal.ai)',
    perImageUsd: { '1K': 0.04 },
  },
  // GPT Image (OpenAI) — на відміну від решти таблиці, офіційна ціна
  // залежить головно від ЯКОСТІ (low/medium/high), а не роздільності:
  // gpt-image-1.5, medium, 1024x1024 = $0.034 (developers.openai.com/api/docs/models/gpt-image-1.5,
  // звірено вересень 2026). Двигун завжди запитує 'medium', якщо автор не
  // обрав інше через supportsQualityControl (server/imageGeneration.ts),
  // тож цей запис — реальна ціна ТИПОВОГО запиту, а не оцінка навмання;
  // за явного 'low'/'high' фактична ціна відхиляється від цієї цифри —
  // окремого лічильника токенів під усі три рівні поки не підключено.
  'gpt-image': {
    modelId: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1.5',
    label: 'GPT Image (OpenAI)',
    perImageUsd: { '1K': 0.034 },
  },

  // --- Задача #214: ПРИБЛИЗНІ тарифи 6 фото-двигунів Leonardo.Ai v2 -------
  // --- (та типової моделі платформи 'leonardo') -----------------------
  //
  // Leonardo.Ai НЕ публікує офіційну доларову ціну за генерацію (лише
  // токенну систему без розкритої прив'язки $ → 1 токен для кожної
  // конкретної моделі) — той самий факт, що вже задокументований у
  // server/aiCore.ts для відео (задача #201). Записи нижче спочатку
  // (задача #214) були оцінкою за ринковою/офіційною ціною ТІЄЇ Ж моделі
  // в її першоджерела — а тепер (задача #216) УТОЧНЕНІ за фактичним
  // білінгом: власник звірив прогноз із реальним «Generation History»
  // на app.leonardo.ai (19.09.2026, ключ Fusion Lab) і надіслав скріншот
  // із фактичними списаннями за кожну модель. Де реальне число відоме —
  // стоїть воно, а не ринкова оцінка; де ще ні (типова модель платформи
  // 'leonardo' нижче) — оцінка лишається оцінкою, позначена як така.
  //
  // Ключ у таблиці — САМЕ modelId, який реально йде в usage_log для цього
  // двигуна (engine.modelId з ImageEngineInfo у server/imageGeneration.ts),
  // а не назва двигуна — так само, як уже влаштовано для Seedream/fal вище.
  // Виняток — 'leonardo-nano-banana-2-lite' нижче, і чому саме, пояснено
  // під тим записом.
  'openai/gpt-image-2.5-flare': {
    modelId: 'openai/gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare (через Leonardo.Ai)',
    // Задача #216 — уточнено за фактичним білінгом Leonardo.Ai (Generation
    // History власника, 19.09.2026): дві реальні генерації, ОБИДВІ рівно
    // $0.0762 — стабільно, без розкиду. Раніша оцінка ($0.03, задача #214,
    // за токенною ціною OpenAI) була занижена приблизно вдвічі: Leonardo,
    // вочевидь, додає власну націнку зверху на "сирову" ціну провайдера,
    // а не перепродає за собівартістю.
    perImageUsd: { '1K': 0.0762 },
  },
  'openai/gpt-image-2.5-sunburst': {
    modelId: 'openai/gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst (через Leonardo.Ai)',
    // Задача #216 — та сама реальна ставка $0.0762, що й у Flare вище
    // (одна реальна генерація, 19.09.2026): підтверджує коментар із
    // задачі #214 про те, що OpenAI не розрізняє ціну Flare/Sunburst —
    // тепер підтверджено фактичним білінгом, а не лише документацією.
    perImageUsd: { '1K': 0.0762 },
  },
  'seedream-4.5': {
    modelId: 'seedream-4.5',
    label: 'Seedream 4.5 (через Leonardo.Ai)',
    // Задача #216 — уточнено за фактичним білінгом Leonardo.Ai (одна
    // реальна генерація, 19.09.2026): $0.0419, дуже близько до попередньої
    // ринкової оцінки $0.04 (задача #214) — саме той рідкісний випадок,
    // коли оцінка за ціною тієї ж моделі на fal.ai майже влучила.
    perImageUsd: { '1K': 0.0419 },
  },
  'seedream-5.0-pro': {
    modelId: 'seedream-5.0-pro',
    label: 'Seedream 5.0 Pro (через Leonardo.Ai)',
    // Задача #216 — уточнено за фактичним білінгом Leonardo.Ai (Generation
    // History власника, 19.09.2026): ШІСТЬ реальних генерацій ПОСПІЛЬ,
    // усі рівно $0.1121 — жодного розкиду, попри те, що частина запитів
    // була з referenceImage (задача #215 саме про них), а частина без.
    // Це прямо суперечить розбивці за роздільністю з задачі #214
    // (0.045/0.09 за оцінкою atlascloud.ai) — реальний рахунок Leonardo,
    // вочевидь, не розрізняє тут 1K/2K узагалі, тож таблиця тепер одна
    // флет-ціна на обидва розміри, а не оцінка «як має бути» за чужим
    // прайсом.
    perImageUsd: { '1K': 0.1121, '2K': 0.1121 },
  },
  'flux-dev': {
    modelId: 'flux-dev',
    label: 'FLUX Dev (через Leonardo.Ai)',
    // Задача #216 — уточнено за фактичним білінгом Leonardo.Ai (одна
    // реальна генерація, 19.09.2026): $0.0120 — більш ніж удвічі дешевше
    // за попередню ринкову оцінку $0.025 (задача #214, середній рівень
    // ринку хостерів FLUX.1 Dev). Реальна ціна виявилась ближчою до
    // найдешевшого хостера з тодішнього порівняння (pricepertoken.com:
    // $0.009), а не до «типового» рівня.
    perImageUsd: { '1K': 0.012, '2K': 0.012 },
  },
  // Типова модель платформи Leonardo (двигун 'leonardo' вище, коли
  // LEONARDO_MODEL_ID не задано — modelId '' і пошук іде за engineId).
  // Джерело — власний Help Center Leonardo (intercom.help/leonardo-ai/
  // en/articles/8044033-token-usage, звірено вересень 2026): «Default
  // Image (768×768) — 1 токен», а $/токен ≈ $0.0010-0.0014 виходить із
  // цін підписок ($12/8500, $30/25000, $60/60000 — leonardo.ai/pricing).
  // Тут дефолтний розмір трохи більший (1024px), тому оцінка округлена
  // вгору, а не взята буквально $0.0014.
  leonardo: {
    modelId: '',
    label: 'Leonardo.Ai (типова модель платформи)',
    // Досі оцінка, НЕ уточнена задачею #216 — жодної генерації через цей
    // типовий (без явного modelId) двигун не було в наданому Generation
    // History власника, тому звірити нема з чим. Лишено як було в задачі
    // #214, дата тарифу нижче — довідкова, не дата звірки.
    perImageUsd: { '1K': 0.01 },
  },

  // Задача #216. Leonardo-маршрут Nano Banana 2 Lite надсилає той самий
  // рядок modelId ('nano-banana-2-lite'), що й ПРЯМИЙ google-двигун вище
  // (див. коментар «НЕ плутати...» у server/imageGeneration.ts) — до цього
  // коміту priceForImage() тому й тарифікував обидва маршрути ОДНАКОВО за
  // офіційною ціною Google ($0.0336), хоча реально Leonardo бере свою
  // націнку зверху. Generation History власника (19.09.2026) показав
  // РЕАЛЬНУ ставку через Leonardo — $0.0449, на ~34% дорожче за пряму
  // ціну Google. Ключ — пара `engineId::modelId` (найспецифічніший рівень
  // пошуку priceForImage(), див. коментар над функцією) — САМЕ рядок
  // modelId сам по собі й далі веде на Google-запис вище, як і мусить для
  // прямого двигуна.
  'leonardo-nano-banana-2-lite::nano-banana-2-lite': {
    modelId: 'nano-banana-2-lite',
    label: 'Nano Banana 2 Lite (через Leonardo.Ai)',
    perImageUsd: { '1K': 0.0449 },
  },
};

/** Тариф текстової моделі, долари за мільйон токенів. */
export const TEXT_PRICING = {
  modelId: process.env.GEMINI_MODEL || 'gemini-3.7-flash',
  inputPerMillionUsd: Number(process.env.GEMINI_INPUT_PRICE) || 0.75,
  outputPerMillionUsd: Number(process.env.GEMINI_OUTPUT_PRICE) || 3.75,
  note: 'Ціна діє до 31 грудня 2026; з 1 січня 2027 подвоюється.',
};

/**
 * Тариф GPT (OpenAI), долари за мільйон токенів. Використовується лише
 * двигуном «ШІ-текст за зображенням» (server/textFromImage.ts) — там,
 * де письменник сам обирає GPT замість Gemini. Значення за замовчуванням
 * орієнтовані на gpt-4o; якщо OPENAI_MODEL змінили на іншу модель,
 * звірте ціну на https://openai.com/api/pricing і задайте через env.
 */
export const GPT_TEXT_PRICING = {
  modelId: process.env.OPENAI_MODEL || 'gpt-4o',
  inputPerMillionUsd: Number(process.env.OPENAI_INPUT_PRICE) || 2.5,
  outputPerMillionUsd: Number(process.env.OPENAI_OUTPUT_PRICE) || 10,
  note: 'Орієнтовний тариф для gpt-4o (vision). Якщо OPENAI_MODEL інша — перевірте ціну вручну.',
};

/**
 * Тариф Anthropic Claude, долари за мільйон токенів. Використовується лише
 * інструментом «Форматування готового файлу під Amazon KDP» (доступний
 * підписникам Pro/Ultra) — server/claudeManuscript.ts. За замовчуванням
 * Claude Sonnet 5 (офіційна ціна станом на серпень 2026, платформа
 * platform.claude.com/docs/en/about-claude/pricing): $2 / $10 за млн
 * вхідних/вихідних токенів. Якщо ANTHROPIC_MODEL змінили — звірте ціну
 * там само і задайте через env.
 */
export const CLAUDE_TEXT_PRICING = {
  modelId: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  inputPerMillionUsd: Number(process.env.ANTHROPIC_INPUT_PRICE) || 2,
  outputPerMillionUsd: Number(process.env.ANTHROPIC_OUTPUT_PRICE) || 10,
  note: 'Офіційна ціна Claude Sonnet 5 (серпень 2026). Якщо ANTHROPIC_MODEL інша — перевірте ціну на platform.claude.com вручну.',
};

/**
 * Тарифи ВСІХ моделей Claude, доступних у селекторі чату (server/chatProviders.ts
 * CHAT_MODELS) — на відміну від CLAUDE_TEXT_PRICING вище (одна модель для
 * інструменту форматування KDP), тут потрібна ціна саме тієї моделі Claude,
 * яку автор обрав для розмови: Opus дорожчий за Sonnet, Haiku дешевший.
 * Звірено на platform.claude.com/docs/en/about-claude/pricing (22 серпня 2026).
 */
export const CLAUDE_MODEL_PRICING: Record<
  string,
  { inputPerMillionUsd: number; outputPerMillionUsd: number; note: string }
> = {
  'claude-sonnet-5': {
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 10,
    note: 'Claude Sonnet 5 — базова модель для більшості задач.',
  },
  'claude-opus-5': {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 25,
    note: 'Claude Opus 5 — найпотужніша модель, для складних задач.',
  },
  'claude-haiku-4-5-20251001': {
    inputPerMillionUsd: 1,
    outputPerMillionUsd: 5,
    note: 'Claude Haiku 4.5 — найшвидша й найдешевша модель Claude.',
  },
};

/** Вартість генерації Claude з урахуванням КОНКРЕТНОЇ моделі (Sonnet/Opus/Haiku). */
export function priceForClaudeModel(modelId: string, inputTokens: number, outputTokens: number): number {
  const rate = CLAUDE_MODEL_PRICING[modelId] || CLAUDE_TEXT_PRICING;
  return (inputTokens / 1_000_000) * rate.inputPerMillionUsd + (outputTokens / 1_000_000) * rate.outputPerMillionUsd;
}

/**
 * Тарифи ВСІХ моделей OpenAI, доступних у селекторі чату (server/chatProviders.ts
 * CHAT_MODELS) — той самий принцип, що й CLAUDE_MODEL_PRICING вище: ціна за
 * КОНКРЕТНУ модель, а не за рушій 'gpt' загалом (GPT-5.4 Mini у 40+ разів
 * дешевший за GPT-6 Astra — усереднена ціна на рушій тут була б безглуздою).
 *
 * Лінійку gpt-5.5…gpt-5.6-luna додано за переліком із вкладки «Rate limits»
 * акаунту власника (platform.openai.com/settings/organization/limits) —
 * ціни звірено на офіційних сторінках моделей
 * developers.openai.com/api/docs/models/<id> (вересень 2026), долари за
 * мільйон токенів, стандартний (не Batch/Fast) тариф Chat/Responses API.
 * `gpt-4o` лишає власний запис у GPT_TEXT_PRICING нижче — priceForGptModel
 * падає на нього, якщо модель не знайдена в цій таблиці.
 *
 * Кешований вхід (cached input) тут НЕ трекається окремим полем: жоден
 * виклик у цьому коді (aiCore.ts/chatRoutes.ts) поки не рахує кешовані
 * токени окремо від звичайних вхідних — додавати поле, яким нема кому
 * скористатись, означало б лише роздути таблицю. Для довідки в note
 * лишено офіційну ціну кешованого входу, якщо вона є.
 */
export const GPT_MODEL_PRICING: Record<
  string,
  { inputPerMillionUsd: number; outputPerMillionUsd: number; note: string }
> = {
  'gpt-5.5': {
    inputPerMillionUsd: 5,
    outputPerMillionUsd: 30,
    note: 'GPT-5.5 — флагман для найскладніших професійних задач (глибоке міркування, код). Кешований вхід: $0.50/млн.',
  },
  'gpt-5.5-pro': {
    inputPerMillionUsd: 30,
    outputPerMillionUsd: 180,
    note: 'GPT-5.5 Pro — версія з підвищеними обчисленнями для точніших відповідей. Кешованого входу не пропонує (немає знижки).',
  },
  'gpt-5.4-mini': {
    inputPerMillionUsd: 0.75,
    outputPerMillionUsd: 4.5,
    note: 'GPT-5.4 Mini — компактна модель під код/агентні задачі. Кешований вхід: $0.075/млн.',
  },
  'gpt-6-astra': {
    inputPerMillionUsd: 10,
    outputPerMillionUsd: 50,
    note: 'GPT-6 Astra — поточний флагман OpenAI (найпотужніша модель лінійки). Кешований вхід: $1/млн.',
  },
  'gpt-5.6-sol': {
    inputPerMillionUsd: 4,
    outputPerMillionUsd: 20,
    note: 'GPT-5.6 Sol — флагман лінійки 5.6. Офіційна сторінка позначає це промо-тарифом щонайменше до 21.11.2026 — після цієї дати звірте ціну вручну.',
  },
  'gpt-5.6-terra': {
    inputPerMillionUsd: 2,
    outputPerMillionUsd: 12,
    note: 'GPT-5.6 Terra — середній рівень лінійки 5.6 (баланс ціни й якості). Кешований вхід: $0.20/млн.',
  },
  'gpt-5.6-luna': {
    inputPerMillionUsd: 0.2,
    outputPerMillionUsd: 1.2,
    note: 'GPT-5.6 Luna — найдешевший рівень лінійки 5.6, для масових задач. Кешований вхід: $0.02/млн.',
  },
};

/** Вартість текстової генерації OpenAI з урахуванням КОНКРЕТНОЇ моделі (5.5/5.5 Pro/5.4 Mini/6 Astra/5.6 Sol/Terra/Luna). */
export function priceForGptModel(modelId: string, inputTokens: number, outputTokens: number): number {
  const rate = GPT_MODEL_PRICING[modelId] || GPT_TEXT_PRICING;
  return (inputTokens / 1_000_000) * rate.inputPerMillionUsd + (outputTokens / 1_000_000) * rate.outputPerMillionUsd;
}

/**
 * Тариф DeepSeek, долари за мільйон токенів. Для чат-сесій. Це тариф
 * РУШІЯ-за-замовчуванням — конкретні моделі див. `DEEPSEEK_MODEL_PRICING`,
 * бо вони різняться вчетверо.
 *
 * Звірено 21.09.2026 на api-docs.deepseek.com/quick_start/pricing:
 * `deepseek-flash` (DeepSeek-V4.1-Flash) — $0.15 / $0.60 за млн вхідних/
 * вихідних у позапіковий час; у пік — удвічі дорожче ($0.30 / $1.20). Беремо
 * позапікову ціну (консервативно: краще недооцінити, ніж завищити рахунок).
 *
 * Ім'я моделі змінилось зі `deepseek-chat` на `deepseek-flash`: моделей у
 * документації лишилось дві (flash і pro), а стара назва — мертвий id, який
 * провайдер більше не приймає (див. LEGACY_MODEL_ALIASES у chatProviders.ts).
 */
export const DEEPSEEK_TEXT_PRICING = {
  modelId: process.env.DEEPSEEK_MODEL || 'deepseek-flash',
  inputPerMillionUsd: Number(process.env.DEEPSEEK_INPUT_PRICE) || 0.15,
  outputPerMillionUsd: Number(process.env.DEEPSEEK_OUTPUT_PRICE) || 0.6,
  note: 'DeepSeek V4.1 Flash, позапіковий тариф (21.09.2026, api-docs.deepseek.com). У пік — удвічі дорожче. Якщо DEEPSEEK_MODEL інша — перевірте ціну вручну.',
};

/**
 * Ціни моделей DeepSeek — окремо на кожну, бо вони різні за порядком:
 * flash $0.15 / $0.60, pro $0.66 / $1.98 за млн (та сама сторінка,
 * 21.09.2026). Один рядок у селекторі — одна модель, і показана ціна
 * має бути ціною САМЕ цієї моделі.
 */
export const DEEPSEEK_MODEL_PRICING: Record<
  string,
  { inputPerMillionUsd: number; outputPerMillionUsd: number; note?: string }
> = {
  'deepseek-flash': {
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.6,
    note: 'DeepSeek V4.1 Flash, позапіковий тариф (21.09.2026, api-docs.deepseek.com).',
  },
  'deepseek-v4-pro': {
    inputPerMillionUsd: 0.66,
    outputPerMillionUsd: 1.98,
    note: 'DeepSeek V4 Pro (21.09.2026, api-docs.deepseek.com). Зору не має — для аналізу фото обирайте flash.',
  },
};

/**
 * Ціни моделей Groq. `llama-3.3-70b-versatile` — $0.59 / $0.79 за млн
 * (звірено з groq.com у серпні 2026).
 *
 * Для `meta-llama/llama-4-scout-17b-16e-instruct` тариф НЕ звірено:
 * консоль документації Groq недоступна для читання ззовні, а підставити
 * ціну іншого вендора (OpenRouter) означало б показати автору число, за
 * яким його не виставлять. Тому — `null`: картка тарифу показує «—», а
 * калькулятор таку модель пропускає. Ціну треба вписати після звірки
 * руками на groq.com/pricing.
 */
export const GROQ_MODEL_PRICING: Record<
  string,
  { inputPerMillionUsd: number | null; outputPerMillionUsd: number | null; note?: string }
> = {
  'llama-3.3-70b-versatile': {
    inputPerMillionUsd: 0.59,
    outputPerMillionUsd: 0.79,
    note: 'Llama 3.3 70B через Groq (серпень 2026, groq.com).',
  },
  'meta-llama/llama-4-scout-17b-16e-instruct': {
    inputPerMillionUsd: null,
    outputPerMillionUsd: null,
    note: 'Тариф Groq для Llama 4 Scout не звірено — впишіть після перевірки на groq.com/pricing. Модель бачить зображення.',
  },
};

/**
 * Ціни моделей Mistral. `mistral-large-latest` (Mistral Large 3) —
 * $0.5 / $1.5 за млн (mistral.ai/pricing, серпень 2026). Інші моделі
 * Mistral у списку не з'являлись, тож таблиця наразі з одного запису.
 */
export const MISTRAL_MODEL_PRICING: Record<
  string,
  { inputPerMillionUsd: number; outputPerMillionUsd: number; note?: string }
> = {
  'mistral-large-latest': {
    inputPerMillionUsd: 0.5,
    outputPerMillionUsd: 1.5,
    note: 'Mistral Large 3 (серпень 2026, mistral.ai/pricing). Бачить зображення.',
  },
};

/**
 * Тариф Groq (Llama), долари за мільйон токенів. Для чат-сесій. За
 * замовчуванням llama-3.3-70b-versatile ($0.59 / $0.79 за млн). Ціну
 * звірено з офіційною сторінкою groq.com та даними Modul_token
 * (серпень 2026); перед зміною моделі перевірте ціну вручну.
 */
export const GROQ_TEXT_PRICING = {
  modelId: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  inputPerMillionUsd: Number(process.env.GROQ_INPUT_PRICE) || 0.59,
  outputPerMillionUsd: Number(process.env.GROQ_OUTPUT_PRICE) || 0.79,
  note: 'Llama 3.3 70B через Groq (серпень 2026). Якщо GROQ_MODEL інша — перевірте ціну на groq.com вручну.',
};

/**
 * Тариф Mistral, долари за мільйон токенів. Для чат-сесій. За замовчуванням
 * mistral-large-latest: офіційна сторінка mistral.ai/pricing (серпень 2026)
 * наводить $0.5 / $1.5 за млн вхідних/вихідних токенів.
 */
export const MISTRAL_TEXT_PRICING = {
  modelId: process.env.MISTRAL_MODEL || 'mistral-large-latest',
  inputPerMillionUsd: Number(process.env.MISTRAL_INPUT_PRICE) || 0.5,
  outputPerMillionUsd: Number(process.env.MISTRAL_OUTPUT_PRICE) || 1.5,
  note: 'Mistral Large (серпень 2026, mistral.ai/pricing). Якщо MISTRAL_MODEL інша — перевірте ціну вручну.',
};

/** Вартість текстової генерації DeepSeek. */
export function priceForDeepSeekText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * DEEPSEEK_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * DEEPSEEK_TEXT_PRICING.outputPerMillionUsd
  );
}

/** Вартість текстової генерації Groq. */
export function priceForGroqText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * GROQ_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * GROQ_TEXT_PRICING.outputPerMillionUsd
  );
}

/** Вартість текстової генерації Mistral. */
export function priceForMistralText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * MISTRAL_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * MISTRAL_TEXT_PRICING.outputPerMillionUsd
  );
}

/**
 * Вартість одного зображення. Якщо для запитаної роздільності тарифу немає,
 * беремо найближчу меншу — краще недооцінити на копійку, ніж вигадати число.
 */
/**
 * Пошук у три рівні, від найспецифічнішого до найзагальнішого:
 *
 *  1. `${engineId}::${modelId}` — точна пара двигун+модель. Задача #216:
 *     Nano Banana 2 Lite ходить ОДНИМ modelId ('nano-banana-2-lite') і
 *     напряму через Google, і через 'leonardo-nano-banana-2-lite' — але
 *     реальний білінг Leonardo (Generation History власника, 19.09.2026)
 *     довів, що ціна РІЗНА (Leonardo бере націнку). Просто `modelId` не
 *     розрізнить два двигуни з ОДНАКОВИМ рядком моделі — потрібна саме
 *     пара. Цей рівень порожній для всіх інших записів у таблиці, тому
 *     нікого, крім нового запису нижче, не зачіпає.
 *  2. `modelId` — сам по собі, коли пара не потрібна: один двигун може
 *     ходити до РІЗНИХ моделей із різними цінами (Seedream через Ark і
 *     через fal — обидва мають ОДИН і той самий `engineId`, а modelId
 *     розрізняє, яка з двох реально викликалась).
 *  3. `engineId` — запасний, генерик-тариф двигуна, коли жодна з двох
 *     точніших пар не знайшлася.
 */
export function priceForImage(engineId: string, imageSize = '2K', modelId?: string): number {
  const table =
    (modelId && IMAGE_PRICING[`${engineId}::${modelId}`]) ||
    (modelId && IMAGE_PRICING[modelId]) ||
    IMAGE_PRICING[engineId];
  if (!table) return 0;

  const exact = table.perImageUsd[imageSize];
  if (typeof exact === 'number') return exact;

  const known = Object.keys(table.perImageUsd);
  if (known.length === 0) return 0;
  // Єдиний доступний тариф (як у Lite) або найдешевший із наявних.
  return Math.min(...known.map((k) => table.perImageUsd[k]));
}

/**
 * Тариф ОДНІЄЇ секунди відео в доларах — задача #214. На відміну від фото
 * (ціна за зображення), відео Leonardo.Ai рахує за тривалість (і подекуди
 * роздільність), тому базова одиниця тут — секунда, а не генерація.
 *
 * `flatUsd` — для моделей БЕЗ контролю тривалості (Motion 2.0/2.0 Fast,
 * durationsSec: null у VIDEO_ENGINES): фіксована ціна за один кліп.
 * `perSecondUsdByResolution` — коли знайдено офіційну ціну саме по
 * роздільності (FLUX 3 Video). `perSecondUsd` — єдина ставка на всі
 * роздільності, коли джерело не розрізняло тариф по роздільності
 * (Wan 3.0) або коли в нас лише одна роздільність цього двигуна
 * (Seedance 2.5, Kling — усі '1080' чи '720' окремо).
 *
 * ВАЖЛИВО: Leonardo.Ai не публікує власну доларову ціну за генерацію
 * (той самий факт, що й для фото-таблиці вище й задокументований у
 * server/aiCore.ts, задача #201) — усі числа нижче виведені з
 * ОФІЦІЙНОЇ або ринкової ціни ТІЄЇ Ж моделі в її першоджерела (Google
 * Veo3, Kling, ByteDance Seedance, Alibaba Wan, Black Forest Labs FLUX)
 * станом на вересень 2026, а не вигадані. Це приблизний орієнтир для
 * звірки з реальною витратою по рахунку Leonardo — не офіційний прайс.
 */
export interface VideoPriceTable {
  label: string;
  perSecondUsd?: number;
  perSecondUsdByResolution?: Record<string, number>;
  flatUsd?: number;
  note: string;
}

export const VIDEO_PRICING: Record<string, VideoPriceTable> = {
  MOTION2: {
    label: 'Leonardo Motion 2.0',
    // Власна модель Leonardo, без контролю тривалості й без стороннього
    // першоджерела для звірки. Leonardo сама позиціонує Motion як дешеву/
    // «relaxed»-модель (навіть безлімітну на тарифі Ultimate) — тому це
    // свідомо низька орієнтовна оцінка, а не розрахунок від чужої ціни.
    flatUsd: 0.03,
    note: 'Орієнтовно, без першоджерела — власна дешева модель Leonardo.',
  },
  MOTION2FAST: {
    label: 'Leonardo Motion 2.0 Fast',
    flatUsd: 0.02,
    note: 'Орієнтовно, без першоджерела — швидший/дешевший варіант Motion 2.0.',
  },
  VEO3: {
    label: 'Google Veo 3 (через Leonardo.Ai)',
    // quickref.me (аналіз тарифів Leonardo, звірено вересень 2026):
    // ~2500 токенів Leonardo за 8-секундний кліп; $/токен ≈$0.0012
    // (виведено з підписки Artisan $30/25000) → ≈$3.00/8с → $0.375/с.
    // Це СТОРОННІЙ аналіз тарифів Leonardo, не офіційне число самої
    // Leonardo.Ai чи Google — найменш певна оцінка в цій таблиці.
    perSecondUsd: 0.375,
    note: 'Сторонній аналіз тарифів Leonardo (quickref.me), не офіційний прайс.',
  },
  VEO3FAST: {
    label: 'Google Veo 3 Fast (через Leonardo.Ai)',
    // Той самий аналіз: ~2000 токенів/8с → ≈$2.40/8с → $0.30/с.
    perSecondUsd: 0.30,
    note: 'Сторонній аналіз тарифів Leonardo (quickref.me), не офіційний прайс.',
  },
  KLING2_1: {
    label: 'Kling 2.1 Pro (через Leonardo.Ai)',
    // akool.com/blog-posts/kling-2-5-cost-guide (звірено вересень 2026):
    // Kling 2.1 Pro витрачає на ~30% більше кредитів за 5с, ніж 2.5 Turbo
    // (35 проти 25) на ВЛАСНІЙ платформі Kling; той самий множник
    // застосовано до ринкової ціни 2.5 Turbo нижче.
    perSecondUsd: 0.08,
    note: 'Виведено з offіційної ціни Kling API того самого класу моделі (akool.com), не з Leonardo.',
  },
  KLING2_5: {
    label: 'Kling 2.5 Turbo (через Leonardo.Ai)',
    // akool.com/blog-posts/kling-2-5-cost-guide: офіційна ціна Kling API
    // «~$0.21-$0.35 за 5-секундне відео» → середина ≈$0.28/5с → $0.056/с,
    // округлено до $0.06/с.
    perSecondUsd: 0.06,
    note: 'Офіційна ціна Kling API за той самий клас моделі (akool.com), не з Leonardo.',
  },
  'bytedance/seedance-2.5': {
    label: 'Seedance 2.5 (ByteDance, через Leonardo.Ai)',
    // Задача #216 — уточнено за фактичним білінгом Leonardo.Ai (Generation
    // History власника, 19.09.2026): ДВІ реальні генерації 720p —
    // $2.6192 і $1.6370. Відношення точно 1.6 (2.6192 ÷ 1.6370 = 1.6001).
    // durationSec НЕ пишеться в наш usage_log (рахується лише для
    // costUsd на льоту, server/aiCore.ts::logVideoUsage) — тому точну
    // тривалість цих двох генерацій звірити з власного журналу не можна.
    // Найправдоподібніша пара з відношенням 1.6 в межах діапазону
    // двигуна (4-30с, server/videoGeneration.ts) — 8с/5с: 8с це буквально
    // defaultDurationSec цього ж двигуна (тобто перша спроба цілком могла
    // піти з незміненим повзунком за замовчуванням). Обидва реальні числа
    // тоді дають ОДНУ Й ТУ САМУ ставку: 2.6192÷8 = 1.6370÷5 = $0.3274/с
    // — більш ніж удвічі дорожче за попередню оцінку $0.15/с (задача
    // #214, перерахунок із ціни AIMLAPI за 480p). Якщо коли-небудь
    // durationSec почне логуватись, звірити цю пару припущень.
    perSecondUsdByResolution: { '720': 0.3274 },
    note: 'Уточнено за фактичним білінгом Leonardo.Ai (19.09.2026) — дивись коментар вище щодо припущення про тривалість 8с/5с.',
  },
  'alibaba/wan-3.0': {
    label: 'Wan 3.0 (Alibaba, через Leonardo.Ai)',
    // openrouter.ai/alibaba/wan-3.0 (звірено вересень 2026): «from
    // $0.0425/с» до «$0.085/с» залежно від провайдера; джерело НЕ
    // розрізняє ціну по роздільності — тому одна ставка на всі три
    // тарифи (480/720/1080), а не вигадана різниця.
    perSecondUsd: 0.06,
    note: 'Середина діапазону OpenRouter для Wan 3.0 (openrouter.ai), не з Leonardo; без розбивки по роздільності.',
  },
  'kling-video-o-3': {
    label: 'Kling O3 (через Leonardo.Ai)',
    // Наймолодша модель у списку — окремого прайсу (ні в Leonardo, ні на
    // біржах на кшталт OpenRouter/fal) не знайдено. Використано ту саму
    // ставку, що й Kling 2.5 Turbo (найближчий за поколінням і класом) —
    // явно позначено як грубе наближення, а не звірену ціну.
    perSecondUsd: 0.06,
    note: 'ГРУБЕ наближення — прирівняно до Kling 2.5 Turbo, окремого прайсу не знайдено.',
  },
  'bfl/flux-3-video': {
    label: 'FLUX 3 Video (Black Forest Labs, через Leonardo.Ai)',
    // docs.bfl.ml/quick_start/pricing (офіційний прайс Black Forest Labs,
    // звірено вересень 2026), text-to-video/image-to-video, звичайний
    // (не draft) режим: HD $0.17/с, FHD $0.29/с. Найнадійніша оцінка в
    // цій таблиці — першоджерело самого розробника моделі.
    perSecondUsdByResolution: { '720': 0.17, '1080': 0.29 },
    note: 'Офіційний прайс Black Forest Labs (docs.bfl.ml) — найнадійніша оцінка в цій таблиці.',
  },
};

/** Якщо тривалість невідома (напр. запис про невдалу спробу до визначення durationSec) — розумний дефолт для приблизної оцінки. */
const FALLBACK_VIDEO_DURATION_SEC = 5;

/**
 * Вартість одного відео в доларах. `modelId` — реальний рядок моделі
 * (leonardoModel для v1-двигунів на кшталт 'VEO3', modelSlug для
 * v2-двигунів на кшталт 'bytedance/seedance-2.5' — engineModelId() у
 * server/videoGeneration.ts), має пріоритет над `engineId`, той самий
 * принцип, що й priceForImage() вище.
 */
export function priceForVideo(
  engineId: string,
  modelId: string,
  resolution: string,
  durationSec: number | null
): number {
  const table = (modelId && VIDEO_PRICING[modelId]) || VIDEO_PRICING[engineId];
  if (!table) return 0;

  if (typeof table.flatUsd === 'number') return table.flatUsd;

  let perSecond: number | undefined;
  if (table.perSecondUsdByResolution) {
    perSecond = table.perSecondUsdByResolution[resolution];
    if (typeof perSecond !== 'number') {
      const known = Object.values(table.perSecondUsdByResolution);
      perSecond = known.length ? Math.min(...known) : undefined;
    }
  }
  if (typeof perSecond !== 'number') perSecond = table.perSecondUsd;
  if (typeof perSecond !== 'number') return 0;

  const sec = durationSec && durationSec > 0 ? durationSec : FALLBACK_VIDEO_DURATION_SEC;
  return perSecond * sec;
}

export function priceForText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * TEXT_PRICING.outputPerMillionUsd
  );
}

export function priceForGptText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * GPT_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * GPT_TEXT_PRICING.outputPerMillionUsd
  );
}

export function priceForClaudeText(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * CLAUDE_TEXT_PRICING.inputPerMillionUsd +
    (outputTokens / 1_000_000) * CLAUDE_TEXT_PRICING.outputPerMillionUsd
  );
}

/** Рушії текстової генерації, які розуміє priceForTextEngine. */
export type TextEngine = 'gemini' | 'gpt' | 'claude' | 'deepseek' | 'groq' | 'mistral';

/**
 * Вартість текстової генерації для конкретного двигуна (gemini, gpt, claude,
 * deepseek, groq, mistral). `modelId` — опційний: для claude визначає, яка
 * саме модель (Sonnet/Opus/Haiku) рахується за CLAUDE_MODEL_PRICING; без
 * нього claude падає на CLAUDE_TEXT_PRICING (типово Sonnet 5).
 */
export function priceForTextEngine(
  engine: TextEngine,
  inputTokens: number,
  outputTokens: number,
  modelId?: string
): number {
  if (engine === 'gpt') {
    return modelId
      ? priceForGptModel(modelId, inputTokens, outputTokens)
      : priceForGptText(inputTokens, outputTokens);
  }
  if (engine === 'claude') {
    return modelId
      ? priceForClaudeModel(modelId, inputTokens, outputTokens)
      : priceForClaudeText(inputTokens, outputTokens);
  }
  if (engine === 'deepseek') return priceForDeepSeekText(inputTokens, outputTokens);
  if (engine === 'groq') return priceForGroqText(inputTokens, outputTokens);
  if (engine === 'mistral') return priceForMistralText(inputTokens, outputTokens);
  return priceForText(inputTokens, outputTokens);
}

/**
 * Тариф (вхід/вихід за млн) для конкретної моделі — для відображення в
 * селекторі чату (`/api/chat/models`) і в таблиці «Тарифи та аналітика
 * ШІ» (`/api/admin/ai/pricing`). `note` необов'язковий у типі лише тому,
 * що снепшот gemini/deepseek/groq/mistral (`pricingSnapshot().textEngines`)
 * теоретично міг би колись повернути запис без нього — на практиці він
 * завжди є в усіх джерел цієї функції.
 */
export function priceRateForModel(
  engine: TextEngine,
  modelId: string
): { inputPerMillionUsd: number | null; outputPerMillionUsd: number | null; note?: string } {
  if (engine === 'claude') return CLAUDE_MODEL_PRICING[modelId] || CLAUDE_TEXT_PRICING;
  if (engine === 'gpt') return GPT_MODEL_PRICING[modelId] || GPT_TEXT_PRICING;
  // DeepSeek/Groq/Mistral теж мають таблиці ПО МОДЕЛЯХ: у DeepSeek різниця
  // між flash і pro вчетверо, а в Groq мультимодальна Scout коштує інакше
  // за текстову 3.3. `null` у таблиці — чесне «не звірено», не нуль.
  if (engine === 'deepseek') return DEEPSEEK_MODEL_PRICING[modelId] || DEEPSEEK_TEXT_PRICING;
  if (engine === 'groq') return GROQ_MODEL_PRICING[modelId] || GROQ_TEXT_PRICING;
  if (engine === 'mistral') return MISTRAL_MODEL_PRICING[modelId] || MISTRAL_TEXT_PRICING;
  const snap = pricingSnapshot().textEngines;
  return snap[engine as keyof typeof snap] || TEXT_PRICING;
}

/** Прайс у зручному для інтерфейсу вигляді. */
/**
 * Тариф озвучення ElevenLabs (Text-to-Speech), долари за 1000 символів.
 * Джерело: https://elevenlabs.io/pricing/api (звірено вересень 2026) —
 * $0.10/1000 символів для eleven_multilingual_v2 (та v3), однаково на
 * всіх тарифних рівнях ElevenLabs; сама платформа моделі eleven_flash/
 * turbo ($0.05/1000) не використовує — якість вимови важливіша за
 * швидкість для аудіокниги, а не для розмовного агента.
 *
 * voiceId — типовий голос ElevenLabs (Rachel, мультимовний). Це не
 * підтверджений «найкращий голос для української» — лише робочий
 * дефолт, який адміністратор може перевизначити через ELEVENLABS_VOICE_ID
 * після прослуховування варіантів у бібліотеці голосів ElevenLabs.
 * Мова не прив'язана до голосу: одна eleven_multilingual_v2-модель
 * озвучує і українську, і англійську, а `language_code` лише уточнює
 * вимову — тому окремих голосів на мову тут немає.
 */
export const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
export const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
export const NARRATION_PRICING = {
  modelId: ELEVENLABS_MODEL,
  label: 'ElevenLabs Text-to-Speech',
  perThousandCharsUsd: Number(process.env.ELEVENLABS_PRICE_PER_1K) || 0.10,
  note: 'ElevenLabs, eleven_multilingual_v2, $0.10/1000 символів (звірено вересень 2026, elevenlabs.io/pricing/api). Якщо ELEVENLABS_MODEL інша — перевірте ціну вручну.',
};

/** Вартість озвучення заданої кількості символів тексту. */
export function priceForNarration(charCount: number): number {
  return (charCount / 1000) * NARRATION_PRICING.perThousandCharsUsd;
}

export function pricingSnapshot() {
  return {
    updatedAt: PRICING_UPDATED_AT,
    currency: 'USD',
    source: 'https://ai.google.dev/gemini-api/docs/pricing',
    images: Object.entries(IMAGE_PRICING).map(([engineId, table]) => ({
      engineId,
      modelId: table.modelId,
      label: table.label,
      perImageUsd: table.perImageUsd,
    })),
    // Задача #214: те саме для відео — ключ тут це modelId (leonardoModel/
    // modelSlug), а не engineId, бо саме за modelId шукає priceForVideo().
    videos: Object.entries(VIDEO_PRICING).map(([modelId, table]) => ({
      modelId,
      label: table.label,
      perSecondUsd: table.perSecondUsd,
      perSecondUsdByResolution: table.perSecondUsdByResolution,
      flatUsd: table.flatUsd,
      note: table.note,
    })),
    narration: NARRATION_PRICING,
    text: TEXT_PRICING,
    textEngines: {
      gemini: TEXT_PRICING,
      gpt: GPT_TEXT_PRICING,
      claude: CLAUDE_TEXT_PRICING,
      deepseek: DEEPSEEK_TEXT_PRICING,
      groq: GROQ_TEXT_PRICING,
      mistral: MISTRAL_TEXT_PRICING,
    },
  };
}

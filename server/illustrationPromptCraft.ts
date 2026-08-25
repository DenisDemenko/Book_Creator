/**
 * Промпт «Промпт ілюстрації» — модель перетворює виділений уривок тексту
 * книги на англомовний промпт для генерації ілюстрації (саму картинку
 * генерує окремий крок, server/imageGeneration.ts). Винесено з
 * інлайн-коду `/api/ai/craft-illustration-prompt` у server.ts.
 *
 * Модель має повернути СУВОРИЙ JSON — схема лишається жорсткою в коді.
 */

export interface IllustrationPromptCraftValues {
  selectedText: string;
  modelLabel?: string;
  stylePreset?: string;
  aspectRatio?: string;
  genre?: string;
  bookTitle?: string;
  chapterTitle?: string;
  /** JSON-серіалізований Visual Bible (visualBible.artStyle тощо). */
  visualBibleJson?: string;
}

export function factoryIllustrationPromptCraftSystemTemplate(): string {
  return [
    'Ти — провідний AI Prompt Engineer для генерації ілюстрацій для книг світового рівня.',
    'Твоє завдання — проаналізувати виділений уривок художнього тексту та перетворити його на ідеальний ' +
      'структурований англомовний промпт (English Masterpiece Prompt) для моделі "{МОДЕЛЬ}".',
    'Врахуй візуальні деталі: об\'єкти, оточення, ракурс камери, глибину різкості, освітлення, колірну ' +
      'гаму, настрій та стилістику книги.',
    '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):\n' +
      'Поверни чистий JSON наступного формату:\n' +
      '{\n' +
      '  "prompt": "Detailed English prompt for image generation with rich lighting, composition, 8k...",\n' +
      '  "negativePrompt": "blurry, distorted anatomy, extra limbs, bad eyes, text, watermark, cartoonish, low resolution",\n' +
      '  "sceneSummaryUa": "Короткий опис ключової сцени українською (1 речення)",\n' +
      '  "suggestedStyle": "{СТИЛЬ_ПРЕСЕТ}",\n' +
      '  "aspectRatio": "{СПІВВІДНОШЕННЯ}",\n' +
      '  "cameraKeywords": "cinematic 35mm wide-angle lens, dramatic low angle, f/2.8, depth of field",\n' +
      '  "lightingKeywords": "volumetric rim light, atmospheric neon cyan and amber bounce reflections",\n' +
      '  "colorPalette": ["#0ea5e9", "#6366f1", "#f59e0b", "#0f172a"]\n' +
      '}',
  ].join('\n\n');
}

export function factoryIllustrationPromptCraftUserTemplate(): string {
  return [
    'Книга: "{НАЗВА_КНИГИ}"\n' +
      'Глава/Розділ: "{РОЗДІЛ}"\n' +
      'Жанр: "{ЖАНР}"\n' +
      'Visual Bible стиль: {VISUAL_BIBLE}\n' +
      'Вибраний сервіс: {МОДЕЛЬ}\n' +
      'Стильовий пресет: {СТИЛЬ_ПРЕСЕТ}\n' +
      'Співвідношення сторін: {СПІВВІДНОШЕННЯ}',
    'ВИДІЛЕНИЙ ТЕКСТ ДЛЯ ІЛЮСТРАЦІЇ:\n"""{ТЕКСТ}"""',
    'Сформуй професійний промпт для візуалізації цієї сцени.',
  ].join('\n\n');
}

function renderCommon(template: string, values: IllustrationPromptCraftValues): string {
  return template
    .replace(/\{МОДЕЛЬ\}/g, values.modelLabel?.trim() || 'nano-banana')
    .replace(/\{СТИЛЬ_ПРЕСЕТ\}/g, values.stylePreset?.trim() || 'cyberpunk-photoreal')
    .replace(/\{СПІВВІДНОШЕННЯ\}/g, values.aspectRatio?.trim() || '16:9');
}

export function renderIllustrationPromptCraftSystemTemplate(
  template: string,
  values: IllustrationPromptCraftValues
): string {
  return renderCommon(template, values);
}

export function renderIllustrationPromptCraftUserTemplate(
  template: string,
  values: IllustrationPromptCraftValues
): string {
  return renderCommon(template, values)
    .replace('{НАЗВА_КНИГИ}', values.bookTitle?.trim() || 'Художній твір')
    .replace('{РОЗДІЛ}', values.chapterTitle?.trim() || 'Сцена')
    .replace(/\{ЖАНР\}/g, values.genre?.trim() || 'Кіберпанк / Наукова фантастика')
    .replace('{VISUAL_BIBLE}', values.visualBibleJson || '{}')
    .replace('{ТЕКСТ}', values.selectedText || '');
}

/** Заводська поведінка (без адмінського шаблону) — точна копія колишнього інлайн-промту з server.ts. */
export function buildIllustrationPromptCraft(values: IllustrationPromptCraftValues): { system: string; user: string } {
  return {
    system: renderIllustrationPromptCraftSystemTemplate(factoryIllustrationPromptCraftSystemTemplate(), values),
    user: renderIllustrationPromptCraftUserTemplate(factoryIllustrationPromptCraftUserTemplate(), values),
  };
}

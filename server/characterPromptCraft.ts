/**
 * Промпт «Промпт персонажа» — модель формує англомовний промпт для
 * генерації ПОРТРЕТА персонажа (сам портрет генерує окремий крок,
 * server/imageGeneration.ts, з готовим текстовим промптом на вхід).
 * Винесено з інлайн-коду `/api/ai/craft-character-prompt` у server.ts.
 *
 * Модель має повернути СУВОРИЙ JSON — схема лишається жорсткою в коді.
 */

export interface CharacterPromptCraftValues {
  characterName?: string;
  characterSurname?: string;
  characterRole?: string;
  characterProfession?: string;
  /** JSON-серіалізований опис зовнішності (character.appearance). */
  appearanceJson?: string;
  /** JSON-серіалізований опис психології/цілей (character.personality). */
  personalityJson?: string;
  genre?: string;
  stylePreset?: string;
  modelLabel?: string;
}

export function factoryCharacterPromptCraftSystemTemplate(): string {
  return 'Ти — провідний AI Prompt Engineer для портретної фотографії та концепт-арту.';
}

export function factoryCharacterPromptCraftUserTemplate(): string {
  return [
    'Сформуй англомовний промпт найвищої якості для генерації портрета персонажа книги у моделі "{МОДЕЛЬ}".',
    'Персонаж:\n' +
      'Ім\'я: {ІМ_Я} {ПРІЗВИЩЕ}\n' +
      'Роль: {РОЛЬ}\n' +
      'Професія: {ПРОФЕСІЯ}\n' +
      'Зовнішність: {ЗОВНІШНІСТЬ}\n' +
      'Психологія та ціль: {ПСИХОЛОГІЯ}\n' +
      'Жанр твору: {ЖАНР}\n' +
      'Стиль: {СТИЛЬ_ПРЕСЕТ}',
    '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):\n' +
      'Поверни JSON:\n' +
      '{\n' +
      '  "prompt": "Detailed English prompt for image generator...",\n' +
      '  "negativePrompt": "blurry, distorted, lowres, text, watermark, bad anatomy, deformed eyes",\n' +
      '  "styleTag": "{СТИЛЬ_ПРЕСЕТ}",\n' +
      '  "recommendedAspect": "1:1",\n' +
      '  "lightingKeywords": "volumetric rim lighting, neon cyan and amber bounce light",\n' +
      '  "cameraKeywords": "85mm f/1.4 portrait lens, shallow depth of field"\n' +
      '}',
  ].join('\n\n');
}

export function renderCharacterPromptCraftUserTemplate(template: string, values: CharacterPromptCraftValues): string {
  return template
    .replace(/\{МОДЕЛЬ\}/g, values.modelLabel?.trim() || 'nano-banana')
    .replace('{ІМ_Я}', values.characterName?.trim() || '')
    .replace('{ПРІЗВИЩЕ}', values.characterSurname?.trim() || '')
    .replace('{РОЛЬ}', values.characterRole?.trim() || '')
    .replace('{ПРОФЕСІЯ}', values.characterProfession?.trim() || 'Герой')
    .replace('{ЗОВНІШНІСТЬ}', values.appearanceJson || '{}')
    .replace('{ПСИХОЛОГІЯ}', values.personalityJson || '{}')
    .replace(/\{ЖАНР\}/g, values.genre?.trim() || 'Кіберпанк / Наукова фантастика')
    .replace(/\{СТИЛЬ_ПРЕСЕТ\}/g, values.stylePreset?.trim() || 'cyberpunk-photoreal');
}

/** Заводська поведінка (без адмінського шаблону) — точна копія колишнього інлайн-промту з server.ts. */
export function buildCharacterPromptCraft(values: CharacterPromptCraftValues): { system: string; user: string } {
  return {
    system: factoryCharacterPromptCraftSystemTemplate(),
    user: renderCharacterPromptCraftUserTemplate(factoryCharacterPromptCraftUserTemplate(), values),
  };
}

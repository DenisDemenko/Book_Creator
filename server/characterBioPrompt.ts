/**
 * Промпт «Генерація персонажа» (біографія й характеристика, без картинки) —
 * винесено з інлайн-коду `/api/ai/generate-character` у server.ts в чистий
 * файл за принципом manuscriptImagePrompt.ts.
 *
 * Модель має повернути СУВОРИЙ JSON зі схемою персонажа — ця схема
 * лишається жорсткою в коді («Ядро AI» показує її як readonly-текст).
 */

export interface CharacterBioPromptValues {
  role?: string;
  genre?: string;
  /** Вільний опис ідеї персонажа від автора («старий контрабандист з совістю»). */
  promptDescription: string;
}

/**
 * Системна інструкція + жорсткий контракт JSON-відповіді. Частина після
 * позначки ⚠️ не редагується в конструкторі (readonly у «Ядрі AI»).
 */
export function factoryCharacterBioSystemTemplate(): string {
  return [
    'Ти — майстер створення глибоких, тривимірних літературних персонажів. Створи детального персонажа ' +
      'для книги у жанрі «{ЖАНР}».',
    '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ (не редагується в конструкторі промтів):\n' +
      'Поверни JSON:\n' +
      '{\n' +
      '  "name": "Ім\'я",\n' +
      '  "surname": "Прізвище",\n' +
      '  "alias": "Псевдонім / Позивний",\n' +
      '  "role": "{РОЛЬ}",\n' +
      '  "age": 30,\n' +
      '  "gender": "Жіноча / Чоловіча / Інше",\n' +
      '  "profession": "Професія",\n' +
      '  "appearance": {\n' +
      '    "height": "175 см", "build": "статура", "hair": "волосся", "eyes": "очі", "face": "обличчя",\n' +
      '    "clothing": "стиль одягу", "distinguishingMarks": "особливі прикмети"\n' +
      '  },\n' +
      '  "personality": {\n' +
      '    "strengths": ["сила 1", "сила 2"], "weaknesses": ["слабкість 1", "слабкість 2"],\n' +
      '    "fears": ["страх 1"], "desires": ["бажання 1"], "goals": ["мета 1"],\n' +
      '    "motivation": "головна рушійна сила", "internalConflict": "глибокий внутрішній розлом"\n' +
      '  },\n' +
      '  "biography": "Коротка біографія (1-2 абзаци)",\n' +
      '  "tags": ["тег1", "тег2"]\n' +
      '}',
  ].join('\n\n');
}

/** Заводський шаблон user-промту. */
export function factoryCharacterBioUserTemplate(): string {
  return 'Створи персонажа згідно з описом: {ОПИС}';
}

export function renderCharacterBioSystemTemplate(template: string, values: CharacterBioPromptValues): string {
  return template
    .replace(/\{ЖАНР\}/g, values.genre?.trim() || 'Фантастика')
    .replace(/\{РОЛЬ\}/g, values.role?.trim() || 'protagonist');
}

export function renderCharacterBioUserTemplate(template: string, values: CharacterBioPromptValues): string {
  return template.replace('{ОПИС}', values.promptDescription || '');
}

/** Заводська поведінка (без адмінського шаблону) — точна копія колишнього інлайн-промту з server.ts. */
export function buildCharacterBioPrompt(values: CharacterBioPromptValues): { system: string; user: string } {
  return {
    system: renderCharacterBioSystemTemplate(factoryCharacterBioSystemTemplate(), values),
    user: renderCharacterBioUserTemplate(factoryCharacterBioUserTemplate(), values),
  };
}

import type { Character } from '../types';

/**
 * Гарантує, що AI-згенерований (чи інакше отриманий ззовні) персонаж має
 * форму, якої вимагає тип `Character` (`tags`/`appearance`/`personality`
 * оголошені ОБОВ'ЯЗКОВИМИ, не опційними полями).
 *
 * Навіщо: `/api/ai/generate-character` повертає JSON, побудований МОДЕЛЛЮ
 * за текстовою інструкцією-схемою (server/characterBioPrompt.ts), а не
 * структурою, яку валідує код. Модель, що гірше тримає інструкцію,
 * запросто поверне персонажа БЕЗ поля `tags` чи без `personality.goals` —
 * TypeScript-каст `const dossier: Character = data` це не ловить, бо це
 * лише компіляторна анотація, не рантайм-перевірка. Такий персонаж, раз
 * збережений у книгу, назавжди ламає рендер картки: `selectedChar.tags.map(...)`
 * і `selectedChar.personality.strengths.map(...)` кидають TypeError на
 * `undefined`, і крах підхоплює ErrorBoundary — уся вкладка «Персонажі»
 * стає недоступною, поки з БД не прибрати саме цей запис.
 *
 * Викликається у двох місцях: одразу після відповіді AI (не дати биту
 * форму потрапити в book.characters взагалі) і при читанні вже
 * збереженого персонажа для редагування (лікує те, що встигло
 * потрапити в книгу до цього виправлення).
 */
export function normalizeCharacter(char: Character): Character {
  const rawPersonality = (char.personality && typeof char.personality === 'object' ? char.personality : {}) as Partial<
    Character['personality']
  >;
  const rawAppearance = (char.appearance && typeof char.appearance === 'object' ? char.appearance : {}) as Partial<
    Character['appearance']
  >;

  return {
    ...char,
    tags: Array.isArray(char.tags) ? char.tags : [],
    relationships: Array.isArray(char.relationships) ? char.relationships : [],
    appearance: { ...rawAppearance },
    personality: {
      strengths: Array.isArray(rawPersonality.strengths) ? rawPersonality.strengths : [],
      weaknesses: Array.isArray(rawPersonality.weaknesses) ? rawPersonality.weaknesses : [],
      fears: Array.isArray(rawPersonality.fears) ? rawPersonality.fears : [],
      desires: Array.isArray(rawPersonality.desires) ? rawPersonality.desires : [],
      goals: Array.isArray(rawPersonality.goals) ? rawPersonality.goals : [],
      motivation: typeof rawPersonality.motivation === 'string' ? rawPersonality.motivation : '',
      internalConflict: typeof rawPersonality.internalConflict === 'string' ? rawPersonality.internalConflict : '',
    },
  };
}

/** Те саме, але пропускає `undefined` — зручно там, де персонажа могло не бути взагалі (порожній список). */
export function normalizeCharacterOrUndefined(char: Character | undefined): Character | undefined {
  return char ? normalizeCharacter(char) : char;
}

/**
 * Чиста логіка «/Ім'я героя» + Enter (задача #50/#51): виокремлена з
 * EditorView.tsx, щоб її можна було юніт-тестити (scripts/test-slashTrigger.mts)
 * без монтування TipTap-редактора. Просте розпізнавання ЛІТЕРАЛЬНОГО
 * тексту (не жива підказка під час набору) — письменник сам пише
 * «/Ім'я[Прізвище]» чи «/Псевдонім» повністю, регістронезалежно.
 */

export interface SlashCharacterLike {
  id: string;
  name: string;
  surname?: string;
  alias?: string;
}

/** Верхня межа довжини кандидата — щоб випадковий «/» деінде в реченні (дріб, дата) не тримав Enter захопленим до кінця абзацу. */
export const MAX_SLASH_CANDIDATE_LENGTH = 60;

/**
 * Шукає ОСТАННІЙ «/» у тексті перед курсором і повертає текст після
 * нього (обрізаний), якщо він виглядає як придатний кандидат на ім'я —
 * непорожній і не задовгий. `null`, якщо «/» немає взагалі або кандидат
 * не проходить базову перевірку довжини.
 */
export function findSlashCandidate(textBeforeCursor: string): { candidate: string; slashIndex: number } | null {
  const slashIdx = textBeforeCursor.lastIndexOf('/');
  if (slashIdx === -1) return null;
  const candidate = textBeforeCursor.slice(slashIdx + 1).trim();
  if (!candidate || candidate.length > MAX_SLASH_CANDIDATE_LENGTH) return null;
  return { candidate, slashIndex: slashIdx };
}

/**
 * Зіставляє кандидата з іменем/«ім'я прізвище»/псевдонімом ОДНОГО з
 * персонажів книги — точний збіг (без урахування регістру), не
 * фузі-пошук: письменник має набрати форму імені так, як вона задана в
 * картці персонажа.
 */
export function matchCharacterBySlashCandidate<T extends SlashCharacterLike>(
  characters: T[],
  candidate: string
): T | undefined {
  const candidateLower = candidate.trim().toLowerCase();
  if (!candidateLower) return undefined;
  return characters.find((c) => {
    const forms = [c.name, c.surname ? `${c.name} ${c.surname}` : '', c.alias || ''];
    return forms.some((f) => f.trim().toLowerCase() === candidateLower);
  });
}

/**
 * Поведінкові фрази персонажа, придатні для вставки через слеш-тригер —
 * плоский behaviorPatterns + розгорнута (по всіх тригерах)
 * behaviorPatternLibrary, без дублікатів того самого тексту.
 */
export function collectInsertablePatterns(char: {
  behaviorPatterns?: string[];
  behaviorPatternLibrary?: { trigger: string; patterns: string[] }[];
}): string[] {
  const flat = char.behaviorPatterns || [];
  const library = (char.behaviorPatternLibrary || []).flatMap((g) => g.patterns);
  return Array.from(new Set([...flat, ...library]));
}

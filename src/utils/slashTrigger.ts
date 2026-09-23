/**
 * Чиста логіка «/Ім'я героя» + Enter (задача #50/#51): виокремлена з
 * EditorView.tsx, щоб її можна було юніт-тестити (scripts/test-slashTrigger.mts)
 * без монтування TipTap-редактора. Просте розпізнавання ЛІТЕРАЛЬНОГО
 * тексту (не жива підказка під час набору) — письменник сам пише
 * «/Ім'я[Прізвище]» чи «/Псевдонім» повністю, регістронезалежно.
 *
 * ⚠️ САМ ЖЕСТ «/Ім'я» + ENTER ПРИБРАНО (рішення власника 23.09.2026): його
 * замінив тег сутності `/character:Ім'я:діалог`, який дає той самий список,
 * але ще й мітить репліку в тексті. `findSlashCandidate` і
 * `matchCharacterBySlashCandidate` лишилися — ними користується новий режим.
 */

import { buildEntityTag } from './coreEntities';

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

// ---------------------------------------------------------------------------
// «/character:Ім'я героя:діалог» — список передналаштованих діалогів героя
// ---------------------------------------------------------------------------

/**
 * Ключі-режими третього сегмента слеш-запису. Український і англійський —
 * за тим самим правилом, що й самі теги (постановка 23.09.2026, п. 3:
 * «всі теги мають вводитись і англійською, і українською»).
 */
export const DIALOGUE_MODE_KEYWORDS = ['діалог', 'dialog', 'dialogue'] as const;

/** Слаг сутності, з якою працює режим діалогів. */
export const DIALOGUE_CHARACTER_SLUG = 'character';

/**
 * Чи третій сегмент — це ключ-режим «діалог» (з урахуванням того, що автор
 * набирає його по літерах: `д`, `ді`, `діа`…).
 *
 * Порожній сегмент НЕ вважається режимом. Це важливо: `/character:Сергій:`
 * — це не «відкрий діалоги», а звичайний другий крок підбору з порожнім
 * значенням, і якщо трактувати його як режим, у автора посеред набору
 * характеристики вистрибував би чужий список.
 */
export function isDialogueModeKeyword(query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  return DIALOGUE_MODE_KEYWORDS.some((word) => word.startsWith(q));
}

export interface DialogueSlashSyntax {
  /** Ключ, який набрав автор: `character`, `персонаж`, `герой`. */
  key: string;
  /** Ім'я героя після першої двокрапки (може містити пробіл і прізвище). */
  heroName: string;
  /** Те, що набрано після другої двокрапки — префікс ключа-режиму. */
  modeQuery: string;
  /**
   * Позиція слеша у переданому рядку. Потрібна меню, щоб замінити РІВНО
   * набраний фрагмент: довжина фрагмента — це `before.length - slashIndex`,
   * і жодного другого обчислення довжини трисегментного запису не потрібно.
   */
  slashIndex: number;
}

/**
 * Розпізнає повний трисегментний слеш-запис `/ключ:ім'я:режим` у тексті перед
 * курсором. Повертає `null`, якщо запис неповний: два сегменти — це звичайний
 * підбір сутності, і чіпати його не можна.
 *
 * Межа перед слешем — та сама, що в меню сутностей («не літера й не цифра»):
 * інакше `стор./2:3` у звичайному тексті почало б вважатися тригером.
 */
export function parseDialogueSlashSyntax(textBeforeCursor: string): DialogueSlashSyntax | null {
  const before = String(textBeforeCursor || '');
  const match = before.match(/(?:^|[^\p{L}\p{N}_])(\/[a-z0-9\u0400-\u04FF-]+):([^:\n]*):([^\s:\n]*)$/u);
  if (!match || match.index === undefined) return null;
  const heroName = match[2].trim();
  if (!heroName) return null;
  const slashIndex = match.index + (match[0].startsWith('/') ? 0 : 1);
  return { key: match[1].slice(1), heroName, modeQuery: match[3], slashIndex };
}

/**
 * Діалоги героя, готові до вставки.
 *
 * ЧОМУ ТУТ ФОЛБЕК, А НЕ ЛИШЕ НОВЕ ПОЛЕ. Власник обрав варіант «нове поле плюс
 * фолбек на старі»: у книгах, написаних доти, діалоги героя — це насправді
 * його поведінкові шаблони (`behaviorPatterns` / `behaviorPatternLibrary`),
 * і порожній список був би гіршим за корисний. Щойно автор налаштує
 * власне діалоги — вони мають пріоритет і фолбек не використовується.
 */
export function collectDialogueTemplates(char: {
  dialogueTemplates?: string[];
  behaviorPatterns?: string[];
  behaviorPatternLibrary?: { trigger: string; patterns: string[] }[];
}): string[] {
  const own = (char.dialogueTemplates || []).map((d) => String(d || '').trim()).filter(Boolean);
  if (own.length > 0) return Array.from(new Set(own));
  return collectInsertablePatterns(char);
}

/**
 * Значення тега діалогу — перші три слова репліки (рішення власника
 * 23.09.2026). Провідне тире репліки («— Ти й досі…») у значення не входить:
 * це не слово, а оформлення прямої мови.
 */
export function dialogueTagValue(dialogue: string, words = 3): string {
  const cleaned = String(dialogue || '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s—–-]+/, '')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .slice(0, Math.max(1, words))
    .join(' ')
    .replace(/[«»"'.,;:!?—–-]+$/, '')
    .trim();
}

/**
 * Те, що лягає в текст замість набраного `/character:Ім'я:діалог`.
 *
 * ДВА ТЕГИ, І ОБИДВА ПОТРІБНІ. `[/character:Ім'я]` каже, ХТО виконує репліку
 * (рішення власника: «завжди мітити з іменем героя, який виконує репліку»),
 * `[/dialogue:перші три слова]` — що це саме діалог і про що він. Обидва
 * знімаються на експорті, тож у надрукованій книзі їх немає.
 */
export function buildDialogueInsertText(speakerName: string, dialogue: string): string {
  const who = String(speakerName || '').trim();
  const body = String(dialogue || '').trim();
  const tags = [buildEntityTag(DIALOGUE_CHARACTER_SLUG, who), buildEntityTag('dialogue', dialogueTagValue(body))];
  return `${tags.join(' ')} ${body}`.trim();
}

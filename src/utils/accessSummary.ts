/**
 * Короткий опис фактичного доступу людини (Т6.2) для «Мого простору» й панелі
 * «Доступ» — один текст в обох місцях (Т6.4 В3).
 */
export interface AccessSummaryInput {
  full: boolean;
  restricted: boolean;
  book: string;
  chapters: Record<string, string>;
  scenes: Record<string, string>;
  characters: Record<string, string>;
  locations: Record<string, string>;
  media: string;
}

export const ACCESS_LEVEL_NAMES: Record<string, { uk: string; en: string }> = {
  none: { uk: 'Немає', en: 'None' },
  view: { uk: 'Перегляд', en: 'View' },
  comment: { uk: 'Коментування', en: 'Comment' },
  review: { uk: 'Рецензування', en: 'Review' },
  edit: { uk: 'Редагування', en: 'Edit' },
  create: { uk: 'Створення', en: 'Create' },
  approve: { uk: 'Затвердження', en: 'Approve' },
  manage: { uk: 'Керування', en: 'Manage' },
  work: { uk: 'Робота з файлами', en: 'Work with files' },
};

export function summarizeAccess(eff: AccessSummaryInput, lang: 'uk' | 'en'): string {
  const L = (uk: string, en: string) => (lang === 'en' ? en : uk);
  const name = (lv: string) => (ACCESS_LEVEL_NAMES[lv]?.[lang] ?? lv).toLowerCase();
  if (eff.full) return L('Повний доступ (власник книги чи адміністратор).', 'Full access (book owner or administrator).');
  if (!eff.restricted) return L(`Уся книга: ${name(eff.book)}.`, `Whole book: ${name(eff.book)}.`);
  const parts: string[] = [];
  const n = (m: Record<string, string>) => Object.keys(m ?? {}).length;
  if (n(eff.chapters)) parts.push(L(`розділів: ${n(eff.chapters)}`, `chapters: ${n(eff.chapters)}`));
  if (n(eff.scenes)) parts.push(L(`сцен: ${n(eff.scenes)}`, `scenes: ${n(eff.scenes)}`));
  if (n(eff.characters)) parts.push(L(`персонажів: ${n(eff.characters)}`, `characters: ${n(eff.characters)}`));
  if (n(eff.locations)) parts.push(L(`локацій: ${n(eff.locations)}`, `locations: ${n(eff.locations)}`));
  if (eff.media !== 'none') parts.push(L(`медіатека (${name(eff.media)})`, `media library (${name(eff.media)})`));
  return parts.length
    ? L(`Обмежений доступ — ${parts.join(', ')}. Решта книги вам не показується.`, `Limited access — ${parts.join(', ')}. The rest of the book is hidden from you.`)
    : L('Доступу до змісту книги немає.', 'No access to the book content.');
}

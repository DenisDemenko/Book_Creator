import type { Chapter } from '../types';
import { calculateWordCount } from './helpers';

export interface AppendTextResult {
  /** Оновлений масив розділів книги — лише цільова секція змінена. */
  chapters: Chapter[];
  /** Секція, куди дописано текст (остання за `order` в розділі). */
  sectionId: string;
  /** Позиція в новому content, де починається вставлений текст. */
  start: number;
  /** Позиція, де вставлений текст закінчується (start + text.length). */
  end: number;
}

/**
 * Дописує `text` у кінець секції розділу `chapterId`.
 *
 * `sectionId` не передано — беремо ОСТАННЮ секцію за `order`. Це давня
 * поведінка «Передати текст у книгу», і вона лишається за замовчуванням
 * навмисно: виклики без вибору секції мають працювати як раніше.
 *
 * `sectionId` передано — дописуємо саме туди. Вибір розділу з'явився
 * разом із мостом «чат → книга»: тека з десяти розділів робить «кінець
 * розділу» майже випадковим місцем, і автор, який обговорив у чаті сцену
 * з середини книги, отримував її дописаною в фінал.
 *
 * Невідомий `sectionId` — це помилка виклику, а не привід тихо дописати
 * кудись інде: повертаємо null, щоб текст не осів у чужому місці.
 *
 * Винесено в чисту функцію, щоб тестувати без React (scripts/test-bookText.mts).
 */
export function appendTextToChapterEnd(
  chapters: Chapter[],
  chapterId: string,
  text: string,
  sectionId?: string
): AppendTextResult | null {
  if (!text.trim()) return null;
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter || chapter.sections.length === 0) return null;

  const sortedSections = [...chapter.sections].sort((a, b) => a.order - b.order);
  const target = sectionId
    ? chapter.sections.find((s) => s.id === sectionId)
    : sortedSections[sortedSections.length - 1];
  if (!target) return null;

  const separator = target.content ? '\n\n' : '';
  const start = target.content.length + separator.length;
  const newContent = `${target.content}${separator}${text}`;

  const updatedChapters = chapters.map((chap) => {
    if (chap.id !== chapterId) return chap;
    return {
      ...chap,
      sections: chap.sections.map((sec) =>
        sec.id !== target.id
          ? sec
          : { ...sec, content: newContent, wordCount: calculateWordCount(newContent), lastModified: new Date().toISOString() }
      ),
    };
  });

  return { chapters: updatedChapters, sectionId: target.id, start, end: start + text.length };
}

/**
 * Оформлення фрагмента книги як цитати для чату.
 *
 * Навіщо окрема функція. Модель отримує два різні тексти в одному
 * повідомленні: шматок рукопису й питання автора. Без явної межі вона
 * регулярно приймає уривок за вказівку («перепиши це») і починає
 * переписувати замість обговорювати — а автор просив саме обговорити.
 * Тому фрагмент іде в лапках-ялинках із підписом, звідки він.
 *
 * Обрізаємо на межі слова: чат — не місце для повного розділу, а модель
 * усе одно отримує книжковий контекст окремо (bookContext у запиті).
 */
/**
 * Замінює ТОЧНИЙ фрагмент `originalText` на `replacementText` всередині
 * вмісту секції `sectionId` розділу `chapterId`.
 *
 * Навіщо саме так, а не просто перезаписати секцію. AI-коуч у трекажерах
 * «18 навичок» (SkillDetailModal.tsx) вміє повернути виправлену версію
 * уривка книги, який автор обрав для тренування — і питає, чи підставити
 * її замість оригіналу в самому розділі (запис #190). Між тим, як автор
 * надіслав уривок на аналіз, і тим, як натиснув «Прийняти зміни», секція
 * могла змінитися (дописав щось в іншій вкладці) — тому шукаємо ТОЧНИЙ
 * збіг `originalText` в актуальному content, а не сліпо переписуємо все.
 *
 * Немає точного збігу — це не привід тихо замінити чужий текст (той
 * самий принцип, що й у appendTextToChapterEnd вище): повертаємо null,
 * виклик сам вирішує, чи пропонувати автору повну заміну розділу
 * (replaceSectionContent нижче) як явний фолбек.
 */
export function replaceTextInSection(
  chapters: Chapter[],
  chapterId: string,
  sectionId: string,
  originalText: string,
  replacementText: string
): AppendTextResult | null {
  if (!originalText || !replacementText.trim()) return null;
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;
  const section = chapter.sections.find((s) => s.id === sectionId);
  if (!section || !section.content.includes(originalText)) return null;

  const start = section.content.indexOf(originalText);
  const newContent = section.content.replace(originalText, replacementText);

  const updatedChapters = chapters.map((chap) => {
    if (chap.id !== chapterId) return chap;
    return {
      ...chap,
      sections: chap.sections.map((sec) =>
        sec.id !== sectionId
          ? sec
          : { ...sec, content: newContent, wordCount: calculateWordCount(newContent), lastModified: new Date().toISOString() }
      ),
    };
  });

  return { chapters: updatedChapters, sectionId, start, end: start + replacementText.length };
}

/**
 * Повна заміна вмісту секції — фолбек для replaceTextInSection, коли
 * точного збігу фрагмента вже нема (наприклад, режим «цілий розділ», і
 * секція змінилась), але автор все одно свідомо хоче прийняти виправлення.
 * SkillDetailModal.tsx пропонує це явним другим кроком, а не робить сама.
 */
export function replaceSectionContent(
  chapters: Chapter[],
  chapterId: string,
  sectionId: string,
  newText: string
): AppendTextResult | null {
  if (!newText.trim()) return null;
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter) return null;
  const section = chapter.sections.find((s) => s.id === sectionId);
  if (!section) return null;

  const updatedChapters = chapters.map((chap) => {
    if (chap.id !== chapterId) return chap;
    return {
      ...chap,
      sections: chap.sections.map((sec) =>
        sec.id !== sectionId
          ? sec
          : { ...sec, content: newText, wordCount: calculateWordCount(newText), lastModified: new Date().toISOString() }
      ),
    };
  });

  return { chapters: updatedChapters, sectionId, start: 0, end: newText.length };
}

export const CHAT_FRAGMENT_LIMIT = 3000;

export function formatFragmentForChat(text: string, where?: string, limit = CHAT_FRAGMENT_LIMIT): string {
  const clean = String(text ?? '').replace(/\r/g, '').trim();
  if (!clean) return '';
  let body = clean;
  if (body.length > limit) {
    const cut = body.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');
    body = (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
  }
  const source = where?.trim() ? ` (${where.trim()})` : '';
  return `Фрагмент книги${source}:\n«${body}»`;
}

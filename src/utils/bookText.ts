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

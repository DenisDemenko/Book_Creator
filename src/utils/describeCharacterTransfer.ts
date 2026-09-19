/**
 * Куди подіти текст, який ШІ написав про персонажа на фото (задача #220).
 *
 * Кнопка «Описати ШІ» в медіатеці дає текст, і він завжди лишається
 * чернеткою: у проєкті жоден AI-текст не вставляється в книгу сам. Далі
 * автор тисне одну з двох кнопок передачі — «до книги, інструкції або
 * курсу», — і саме тут вирішується, як текст ляже в кожну з трьох цілей.
 *
 * ЧОМУ ПОМІЧНИКИ, А НЕ КОД У КОМПОНЕНТІ. Три цілі — три різні структури
 * (`Book.chapters[].sections[]`, `Instruction.knowledgeBase[]`, тіло
 * POST /api/courses), і кожна має свої обовʼязкові поля. Усе, що можна
 * перевірити без React і без DOM, живе тут і перевіряється
 * `scripts/test-describeCharacter.mts` — так само, як `instructionDraft.ts`.
 */

import type { Book, Chapter, Instruction, InstructionKnowledgeItem, Section } from '../types';
import { instructionUid } from './instructionDraft';

/** Три цілі, у які автор може передати опис. */
export type DescriptionTarget = 'book' | 'instruction' | 'course';

export interface DescriptionPayload {
  /** Заголовок, під яким текст ляже в ціль. */
  title: string;
  /** Сам опис — те, що ШІ написав і автор відредагував. */
  text: string;
  /** Фото, з якого зроблено опис; `null` — передаємо лише текст. */
  photo?: { url: string; title: string } | null;
}

/** Слова рахуються так само, як у решті книги (`Section.wordCount`). */
export function descriptionWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Екранування тексту перед вставкою в HTML розділу. */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Тіло розділу: фото (лише у варіанті «разом з фото») + абзаци тексту.
 *
 * Абзаци розділяються порожнім рядком у textarea, а не одним переносом:
 * редагований текст ШІ приходить суцільним потоком, і різати його на
 * `<p>` по кожному переносу означало б породжувати рвані абзаци.
 *
 * Фото вставляється тегом `<img>` з адресою з медіатеки — так само, як
 * це робить редактор розділу; окремого запису в `book.illustrations` не
 * створюємо: там потрібне співвідношення сторін, якого ми про це фото не
 * знаємо, і вигадувати його було б гірше, ніж не мати.
 */
export function descriptionSectionContent(payload: DescriptionPayload): string {
  const parts: string[] = [];
  if (payload.photo?.url) {
    parts.push(
      `<img src="${escapeHtml(payload.photo.url)}" alt="${escapeHtml(payload.photo.title || payload.title)}" />`
    );
  }
  const paragraphs = payload.text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br />')}</p>`);
  if (paragraphs.length) parts.push(paragraphs.join('\n'));
  return parts.join('\n');
}

/** Заголовок, який дістає порожній ввід (автор нічого не написав — теж робочий випадок). */
function resolveTitle(payload: DescriptionPayload): string {
  const t = payload.title.trim();
  return t || 'Опис персонажа (ШІ)';
}

/**
 * Новий розділ у книзі з описом.
 *
 * Кладеться в ОСТАННЮ главу — це найближче місце до того, над чим автор
 * працює зараз, і воно не вимагає від нього вибору глави посеред вікна
 * опису. Якщо глав немає зовсім (нова книга), створюється одна — «Опис
 * персонажів»: інакше розділ не мав би куди лягти взагалі.
 */
export function appendDescriptionToBook(
  book: Book,
  payload: DescriptionPayload,
  now: string = new Date().toISOString()
): Book {
  const chapters = [...(book.chapters || [])];
  if (!chapters.length) {
    chapters.push({
      id: instructionUid('chap'),
      bookId: book.id,
      title: 'Опис персонажів',
      order: 1,
      sections: [],
    } as Chapter);
  }
  const target = chapters[chapters.length - 1];
  const section: Section = {
    id: instructionUid('sec'),
    chapterId: target.id,
    title: resolveTitle(payload),
    order: (target.sections?.length || 0) + 1,
    content: descriptionSectionContent(payload),
    wordCount: descriptionWordCount(payload.text),
    lastModified: now,
  };
  const updated: Chapter = { ...target, sections: [...(target.sections || []), section] };
  return { ...book, chapters: [...chapters.slice(0, -1), updated] };
}

/**
 * Опис у чернетку інструкції.
 *
 * Інструкція — документ із кроками, і опис персонажа кроком не є: він
 * лягає в «Базу знань» — довідковий розділ інструкції, який саме для
 * такого (матеріали, пояснення, виписки) і існує. Посилання на фото
 * кладеться в `link`, текст — в `excerpt`; усе інше автор бачить і
 * редагує у конструкторі.
 */
export function appendDescriptionToInstruction(
  doc: Instruction,
  payload: DescriptionPayload,
  now: string = new Date().toISOString()
): Instruction {
  const item: InstructionKnowledgeItem = {
    id: instructionUid('kb'),
    title: resolveTitle(payload),
    link: payload.photo?.url || '',
    excerpt: payload.text.trim(),
  };
  return { ...doc, knowledgeBase: [...(doc.knowledgeBase || []), item], updatedAt: now };
}

/** Тіло запиту на створення курсу — один модуль з одним уроком. */
export interface CourseFromDescription {
  title: string;
  summary: string;
  modules: {
    title: string;
    lessons: { title: string; description: string; photoUrls: string[] }[];
  }[];
}

/**
 * Курс із опису: модуль і урок називаються так само, як опис, — так автор
 * одразу бачить у «Студії курсів», що саме приїхало з медіатеки, і
 * перейменує, якщо захоче. Фото (у варіанті «разом з фото») стає
 * `photoUrls` уроку.
 */
export function buildCourseFromDescription(payload: DescriptionPayload): CourseFromDescription {
  const title = resolveTitle(payload);
  const text = payload.text.trim();
  return {
    title,
    summary: text.slice(0, 400),
    modules: [
      {
        title,
        lessons: [
          {
            title,
            description: text,
            photoUrls: payload.photo?.url ? [payload.photo.url] : [],
          },
        ],
      },
    ],
  };
}

/**
 * «Ядро письменника», яке їде разом із запитом до моделі: назва, жанр,
 * аудиторія, синопсис і склад персонажів. Саме воно робить опис описом
 * САМЕ ЦІЄЇ книги, а не абстрактним переказом побаченого.
 */
export interface WriterCorePayload {
  bookTitle: string;
  genre: string;
  audience?: string;
  synopsis: string;
  characters: { name: string; role?: string; description?: string }[];
}

export function writerCoreFromBook(book: Book): WriterCorePayload {
  return {
    bookTitle: book.title || '',
    genre: book.genre || '',
    audience: book.targetAudience || '',
    synopsis: book.synopsis || '',
    characters: (book.characters || []).map((c) => ({
      name: [c.name, c.surname].filter(Boolean).join(' ').trim(),
      role: [
        ROLE_UK[c.role] || '',
        c.profession || '',
        c.age ? `${c.age} років` : '',
      ]
        .filter(Boolean)
        .join(', '),
    })),
  };
}

/**
 * Роль персонажа — українською, бо цим текстом користується промпт.
 * Значення `Character.role` — англійське перелічення (`protagonist`,
 * `ally`…), і годувати моделлю англійське слово там, де потрібна
 * українська лексика книги, означало б плутати мову опису.
 */
const ROLE_UK: Record<string, string> = {
  protagonist: 'головний герой',
  antagonist: 'антагоніст',
  deuteragonist: 'другий головний',
  mentor: 'наставник',
  ally: 'союзник',
  rival: 'суперник',
  minor: 'другорядний',
};

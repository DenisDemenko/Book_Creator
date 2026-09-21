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

import type { Book, BookIllustration, Chapter, Instruction, InstructionKnowledgeItem, Section } from '../types';
import { instructionUid } from './instructionDraft';
import { appendTextToChapterEnd } from './bookText';

/** Три цілі, у які автор може передати опис. */
export type DescriptionTarget = 'book' | 'instruction' | 'course';

export interface DescriptionPayload {
  /** Заголовок, під яким текст ляже в ціль. */
  title: string;
  /** Сам опис — те, що ШІ написав і автор відредагував. */
  text: string;
  /** Фото, з якого зроблено опис; `null` — передаємо лише текст. */
  photo?: { url: string; title: string } | null;
  /**
   * Глава книги, яку автор вибрав у вікні опису (задача #224). Має сенс
   * лише для цілі `book`; порожнє — остання глава книги.
   */
  chapterId?: string;
}

/** Слова рахуються так само, як у решті книги (`Section.wordCount`). */
export function descriptionWordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Маркер-обгортка «AI-чернетка» — той самий, який читає редактор книги
 * (`utils/manuscriptDoc.ts` → вузол `aiDraft` → `AiDraftBlockNode.tsx`).
 * Літерали навмисно продубльовані, а не імпортовані: `manuscriptDoc.ts`
 * тримає їх приватними, а тягнути в цей помічник увесь парсер рукопису
 * означало б прив'язати передачу з медіатеки до редактора ProseMirror.
 * Збіг літералів перевіряється тестом (`test-describe-character`).
 */
export const AI_DRAFT_OPEN = '[AI-DRAFT]';
export const AI_DRAFT_CLOSE = '[/AI-DRAFT]';

/**
 * Текст опису у ФОРМАТІ КНИГИ — абзаци через порожній рядок.
 *
 * ЧОМУ НЕ HTML (як було в #220). Розділ книги зберігається не як HTML, а як
 * рядок із маркерами, який редактор розбирає сам (`markerStringToTiptapDoc`).
 * Зібраний тут `<p>…</p>` редактор показував авторові ЛІТЕРАЛЬНО — тегами в
 * тексті книги: саме це видно власникові як «передав, а куди — незрозуміло».
 * Порожній рядок — це межа абзацу; усередині абзацу перенос лишається м'яким.
 */
export function descriptionParagraphs(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Опис як блок «AI-чернетка» — те, чого автор і просив: текст приходить
 * поміченим (бурштинова рамка + мітка «✨ AI-чернетка»), із видимими діями
 * «прийняти» (позначка знімається, текст лишається звичайним чорним) та
 * «відхилити» (блок зникає разом із текстом, Ctrl+Z повертає).
 */
export function buildDescriptionDraft(text: string): string {
  return [AI_DRAFT_OPEN, descriptionParagraphs(text), AI_DRAFT_CLOSE].join('\n\n');
}

/** Заголовок, який дістає порожній ввід (автор нічого не написав — теж робочий випадок). */
function resolveTitle(payload: DescriptionPayload): string {
  const t = payload.title.trim();
  return t || 'Опис персонажа (ШІ)';
}

/**
 * Вставка опису в КІНЕЦЬ вибраної глави (задача #224).
 *
 * Чому саме кінець глави. Власник попросив «вибір глави → передати → відкрити
 * кінець глави з вставленим текстом»: кінець — єдине місце, яке не рве вже
 * написане, і єдине, яке автор однаково знайде після переходу.
 *
 * Куди саме всередині глави: в ОСТАННЮ секцію за `order` (у книзі секції —
 * це підрозділи всередині глави). Якщо в главі секцій немає зовсім, створюємо
 * одну з заголовком опису — інакше тексту не було б куди лягти.
 *
 * Фото («разом з фото») стає ЗАПИСОМ КНИГИ (`book.illustrations`) і маркером
 * `[IMG: id]` перед чернеткою — так редактор і верстальник PDF бачать його як
 * звичайну ілюстрацію глави. Одне й те саме фото, уже додане в книгу, не
 * дублюється: беремо наявний запис за адресою.
 *
 * `start`/`end` — зміщення вставленого тексту в `content` секції: за ними
 * редактор підсвічує й прокручує до місця передачі (той самий `pendingHighlight`,
 * яким користується міст «чат → книга»).
 *
 * `null` — відмова без здогадок: порожній текст передавати нема сенсу, і
 * краще, щоб автор побачив причину, ніж порожній блок у книзі.
 */
export interface DescriptionBookInsert {
  /** Оновлена книга: і глави, і (у варіанті «разом з фото») перелік ілюстрацій. */
  book: Book;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  /** Зміщення вставленого блоку в `Section.content` (включно з маркерами). */
  start: number;
  end: number;
}

export interface DescriptionInsertOptions {
  /** Глава, яку автор вибрав у вікні опису. Порожньо — остання глава книги. */
  chapterId?: string | null;
  /** Додати фото в книгу (кнопка «разом з фото»). */
  withPhoto?: boolean;
  /**
   * id нової ілюстрації приходить ззовні: у тестах він фіксований, а в
   * застосунку — з мітки часу. Так функція лишається чистою й передбачуваною.
   */
  illustrationId?: string;
  now?: string;
}

/** Запит книги на фото з медіатеки: той самий набір полів, що й у завантаженні файлу. */
function illustrationFromPhoto(
  payload: DescriptionPayload,
  chapterId: string,
  id: string,
  now: string
): BookIllustration {
  return {
    id,
    chapterId,
    url: payload.photo!.url,
    caption: payload.photo!.title || resolveTitle(payload),
    // Співвідношення сторін файлу з медіатеки тут невідоме — ставимо те саме,
    // що й завантаження файлу в медіатеку (`MediaLibraryView`), і не вдаємо,
    // ніби знаємо точне. Редактор і PDF беруть геометрію з самої картинки.
    aspectRatio: '16:9',
    style: 'Медіатека',
    createdAt: now,
  };
}

export function insertDescriptionIntoBook(
  book: Book,
  payload: DescriptionPayload,
  options: DescriptionInsertOptions = {}
): DescriptionBookInsert | null {
  const text = payload.text.trim();
  if (!text) return null;

  const now = options.now || new Date().toISOString();
  const chapters = [...(book.chapters || [])];

  // Вибір глави: названа автором → остання в книзі → нова «Опис персонажів».
  // Невідомий id не привід мовчки кинути текст в інше місце, але й не привід
  // відмовляти: на момент передачі главу могли перейменувати/видалити в іншій
  // вкладці. Остання глава — те саме місце, куди текст лягав до #224.
  const wanted = (options.chapterId || '').trim();
  let targetIndex = wanted ? chapters.findIndex((c) => c.id === wanted) : -1;
  if (targetIndex === -1) {
    if (!chapters.length) {
      chapters.push({
        id: instructionUid('chap'),
        bookId: book.id,
        title: 'Опис персонажів',
        order: 1,
        sections: [],
      } as Chapter);
    }
    targetIndex = chapters.length - 1;
  }
  const target = chapters[targetIndex];

  // Фото — запис книги, і лише один на адресу (повторна передача того самого
  // фото не має плодити ілюстрації-двійники).
  const illustrations = [...(book.illustrations || [])];
  let photoMarker = '';
  if (options.withPhoto && payload.photo?.url) {
    const existing = illustrations.find((i) => i.url === payload.photo!.url);
    const illustration = existing || illustrationFromPhoto(payload, target.id, options.illustrationId || `ill-desc-${Date.parse(now) || Date.now()}`, now);
    if (!existing) illustrations.push(illustration);
    photoMarker = `[IMG: ${illustration.id} "${illustration.caption.replace(/"/g, '')}" wrap=none]`;
  }

  const insertText = [photoMarker, buildDescriptionDraft(text)].filter(Boolean).join('\n\n');

  // Порожня глава: секції немає — створюємо її разом із текстом.
  const sortedSections = [...(target.sections || [])].sort((a, b) => a.order - b.order);
  if (!sortedSections.length) {
    const section: Section = {
      id: instructionUid('sec'),
      chapterId: target.id,
      title: resolveTitle(payload),
      order: 1,
      content: insertText,
      wordCount: descriptionWordCount(text),
      lastModified: now,
    };
    const updated: Chapter = { ...target, sections: [section] };
    return {
      book: { ...book, chapters: [...chapters.slice(0, targetIndex), updated, ...chapters.slice(targetIndex + 1)], illustrations },
      chapterId: target.id,
      chapterTitle: target.title,
      sectionId: section.id,
      start: 0,
      end: insertText.length,
    };
  }

  const appended = appendTextToChapterEnd(chapters, target.id, insertText);
  if (!appended) return null;
  return {
    book: { ...book, chapters: appended.chapters, illustrations },
    chapterId: target.id,
    chapterTitle: target.title,
    sectionId: appended.sectionId,
    start: appended.start,
    end: appended.end,
  };
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

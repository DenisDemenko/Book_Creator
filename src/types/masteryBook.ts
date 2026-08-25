/**
 * Контекст поточної книги для модуля «Майстерність & Навички».
 *
 * На відміну від окремого прототипу (де контекст був вигаданим прикладом),
 * тут WriterBookProvider отримує реальну книгу зі студії (Book зі сховища)
 * та автоматично підтягує її дані: назву, жанр, синопсис, останній абзац
 * глави та головного героя. Крім того, з глав/розділів книги будується
 * список `bookExcerpts` — тексти, які письменник може обирати для тренувань.
 */

/** Один доступний для тренування текст з поточної книги (глава → розділ). */
export interface BookExcerpt {
  id: string;
  chapterId: string;
  chapterTitle: string;
  sectionId: string;
  sectionTitle: string;
  /** Текст розділу, очищений від розмітки та обрізаний до розумної довжини. */
  text: string;
  wordCount: number;
}

export interface WriterBookContextType {
  bookTitle: string;
  genre: string;
  bookIdea: string;
  lastParagraph: string;
  protagonist: string;
  currentGoal: string;
  updatedAt: string;
}

export interface WriterBookContextState {
  bookContext: WriterBookContextType;
  updateBookContext: (updates: Partial<WriterBookContextType>) => void;
  resetToDefaultBookContext: () => void;
  isEditorOpen: boolean;
  setIsEditorOpen: (open: boolean) => void;

  // --- Інтеграція з реальною книгою письменника ---
  /** Чи підключено реальну книгу зі студії (а не демо-приклад). */
  isLinkedToRealBook: boolean;
  /** Всі тексти книги, доступні для тренувань (глава → розділ). */
  bookExcerpts: BookExcerpt[];
  /** Обраний письменником текст для тренування. */
  activeExcerptId: string | null;
  setActiveExcerpt: (id: string | null) => void;
  /** Примусово пересинхронізувати контекст з реальною книгою. */
  syncFromBook: (book: any) => void;
  /** Список глав книги (для селекторів). */
  chapters: { id: string; title: string; order: number }[];
  /** Список розділів обраної глави (для селекторів). */
  getSectionsForChapter: (chapterId: string) => { id: string; title: string; wordCount: number }[];
}

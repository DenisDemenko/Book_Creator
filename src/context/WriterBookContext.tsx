import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { WriterBookContextType, WriterBookContextState, BookExcerpt } from "../types/masteryBook";

const LOCAL_STORAGE_KEY = "mastery_writer_book_context_v1";

export const DEFAULT_BOOK_CONTEXT: WriterBookContextType = {
  bookTitle: "Хроніки Світанку: Код Аура",
  genre: "Фантастичний роман / Психологічний трилер",
  bookIdea:
    "Історія про дослідника Данила, який після аварії в лабораторії виявляє здатність бачити аури та керувати психічною енергією. Коли таємничий орден починає полювання на носіїв цієї сили, він змушений знайти межу між людяністю та абсолютною могутністю.",
  lastParagraph:
    "Він стояв біля розбитого вікна на сороковому поверсі, вдихаючи холодне нічне повітря. Світіння навколо його пальців не просто викривало правду — воно змушувало простір навколо вібрувати низьким електричним гулом. Коли психічна енергія сягнула межі, аура спалахнула смарагдовим сяйвом. Унизу, серед мерехтливих вогнів мегаполіса, наближалися чорні глайдери без розпізнавальних знаків. Часу на сумніви більше не залишалося.",
  protagonist: "Данило — 28-річний аналітик даних із пробудженим даром сприйняття біополів",
  currentGoal: "Зробити кінцівку першого розділу напруженою та емоційно насиченою",
  updatedAt: new Date().toISOString(),
};

/** Очищення тексту розділу: прибираємо HTML-розмітку та зайві пробіли. */
function stripMarkup(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Побудова списку доступних для тренування текстів з реальної книги.
 * Формат книги гнучкий (будь-який об'єкт з chapters[] → sections[]),
 * тому ми працюємо з «any» на вході, але на виході даємо строгий тип.
 */
function buildExcerpts(book: any): BookExcerpt[] {
  if (!book || !Array.isArray(book.chapters)) return [];

  const excerpts: BookExcerpt[] = [];
  (book.chapters as any[]).forEach((chapter: any) => {
    if (!chapter || !Array.isArray(chapter.sections)) return;
    const chapterTitle = chapter.title || `Глава ${chapter.order ?? ""}`.trim() || "Без назви";
    (chapter.sections as any[]).forEach((section: any) => {
      if (!section) return;
      const raw = section.content || section.text || "";
      const text = stripMarkup(raw).slice(0, 6000);
      if (!text || text.length < 30) return;
      const sectionTitle = section.title || `Розділ ${section.order ?? ""}`.trim() || "Без назви";
      const wordCount = (text.match(/\S+/g) || []).length;
      excerpts.push({
        id: `${chapter.id || "ch"}-${section.id || "sec"}`,
        chapterId: chapter.id || "",
        chapterTitle,
        sectionId: section.id || "",
        sectionTitle,
        text,
        wordCount,
      });
    });
  });

  return excerpts;
}

/** Останній абзац книги: беремо кінець останнього розділу з контентом. */
function pickLastParagraph(book: any): string {
  if (!book || !Array.isArray(book.chapters)) return "";
  const chapters = book.chapters as any[];
  for (let i = chapters.length - 1; i >= 0; i--) {
    const chapter = chapters[i];
    if (!chapter || !Array.isArray(chapter.sections)) continue;
    const sections = chapter.sections as any[];
    for (let j = sections.length - 1; j >= 0; j--) {
      const text = stripMarkup(sections[j]?.content || sections[j]?.text || "");
      if (text.length > 30) {
        const sentences = text.split(/(?<=[.!?…])\s+/);
        const tail = sentences.slice(-3).join(" ");
        return tail.slice(0, 900) || text.slice(0, 900);
      }
    }
  }
  return "";
}

/** Головний герой книги для контексту тренувань. */
function pickProtagonist(book: any): string {
  if (!book || !Array.isArray(book.characters)) return "";
  const protagonist =
    (book.characters as any[]).find((c: any) => c.role === "protagonist") ||
    (book.characters as any[])[0];
  if (!protagonist) return "";
  const name = protagonist.name || "";
  const profession = protagonist.profession || protagonist.personality?.motivation || "";
  return profession ? `${name} — ${profession}` : name;
}

/** Розумний опис поточної мети письменника на основі книги. */
function pickCurrentGoal(book: any): string {
  if (!book) return "";
  const parts: string[] = [];
  if (book.status) parts.push(`статус «${book.status}»`);
  const totalWords = (book.chapters || []).reduce(
    (acc: number, ch: any) => acc + (ch.sections || []).reduce((a: number, s: any) => a + (s.wordCount || 0), 0),
    0
  );
  if (totalWords > 0) parts.push(`написано ${totalWords.toLocaleString("uk-UA")} слів`);
  return parts.length ? `Продовжити роботу над книгою (${parts.join(", ")})` : "";
}

const WriterBookReactContext = createContext<WriterBookContextState | undefined>(undefined);

interface WriterBookProviderProps {
  children: React.ReactNode;
  /** Реальна книга зі студії (Book). Якщо передана — контекст синхронізується з нею. */
  book?: any;
}

export const WriterBookProvider: React.FC<WriterBookProviderProps> = ({ children, book }) => {
  const [bookContext, setBookContext] = useState<WriterBookContextType>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved) {
        return { ...DEFAULT_BOOK_CONTEXT, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn("Failed to load writer book context from localStorage", e);
    }
    return DEFAULT_BOOK_CONTEXT;
  });

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [bookExcerpts, setBookExcerpts] = useState<BookExcerpt[]>([]);
  const [activeExcerptId, setActiveExcerptId] = useState<string | null>(null);
  const [isLinkedToRealBook, setIsLinkedToRealBook] = useState(false);
  const lastBookIdRef = useRef<string | null>(null);

  /**
   * Синхронізація контексту з реальною книгою письменника.
   * Викликається автоматично при зміні книги та вручну через syncFromBook.
   */
  const syncFromBook = useCallback((bk: any) => {
    if (!bk || !bk.title) return;

    const excerpts = buildExcerpts(bk);
    setBookExcerpts(excerpts);
    setIsLinkedToRealBook(true);

    setBookContext((prev) => {
      const lastParagraph = pickLastParagraph(bk) || prev.lastParagraph;
      const protagonist = pickProtagonist(bk) || prev.protagonist;
      return {
        ...prev,
        bookTitle: bk.title || prev.bookTitle,
        genre: bk.genre || prev.genre,
        bookIdea: bk.synopsis || bk.logline || prev.bookIdea,
        lastParagraph,
        protagonist,
        currentGoal: pickCurrentGoal(bk) || prev.currentGoal,
        updatedAt: new Date().toISOString(),
      };
    });

    setActiveExcerptId((prev) => {
      if (prev && excerpts.some((e) => e.id === prev)) return prev;
      return excerpts.length > 0 ? excerpts[0].id : null;
    });
  }, []);

  // Автоматична синхронізація, коли змінюється реальна книга (по id).
  useEffect(() => {
    if (book && book.title && book.id !== lastBookIdRef.current) {
      lastBookIdRef.current = book.id;
      syncFromBook(book);
    }
  }, [book, syncFromBook]);

  const updateBookContext = (updates: Partial<WriterBookContextType>) => {
    setBookContext((prev) => ({
      ...prev,
      ...updates,
      updatedAt: new Date().toISOString(),
    }));
  };

  const resetToDefaultBookContext = () => {
    setIsLinkedToRealBook(false);
    setBookContext({
      ...DEFAULT_BOOK_CONTEXT,
      updatedAt: new Date().toISOString(),
    });
  };

  const chapters = (book?.chapters || []).map((ch: any) => ({
    id: ch.id,
    title: ch.title || `Глава ${ch.order ?? ""}`.trim(),
    order: ch.order ?? 0,
  }));

  const getSectionsForChapter = (chapterId: string) => {
    const chapter = (book?.chapters || []).find((ch: any) => ch.id === chapterId);
    if (!chapter || !Array.isArray(chapter.sections)) return [];
    return (chapter.sections as any[]).map((s: any) => ({
      id: s.id,
      title: s.title || `Розділ ${s.order ?? ""}`.trim(),
      wordCount: s.wordCount || (stripMarkup(s.content || "").match(/\S+/g) || []).length,
    }));
  };

  return (
    <WriterBookReactContext.Provider
      value={{
        bookContext,
        updateBookContext,
        resetToDefaultBookContext,
        isEditorOpen,
        setIsEditorOpen,
        isLinkedToRealBook,
        bookExcerpts,
        activeExcerptId,
        setActiveExcerpt: (id) => setActiveExcerptId(id),
        syncFromBook,
        chapters,
        getSectionsForChapter,
      }}
    >
      {children}
    </WriterBookReactContext.Provider>
  );
};

export const useWriterBook = (): WriterBookContextState => {
  const context = useContext(WriterBookReactContext);
  if (!context) {
    throw new Error("useWriterBook must be used within a WriterBookProvider");
  }
  return context;
};

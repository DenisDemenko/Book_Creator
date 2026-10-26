import type { CustomBookDesignTheme } from '../data/customBookDesignTheme';

/** Той самий ключ, що й у Designer Mode («Book Design Studio») — власні теми однієї книги в одному списку. */
export function customThemesKey(bookId: string): string {
  return `book-design-studio:custom-themes:${bookId || 'draft'}`;
}

export function loadCustomThemes(bookId: string): CustomBookDesignTheme[] {
  try {
    const raw = window.localStorage.getItem(customThemesKey(bookId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CustomBookDesignTheme[]) : [];
  } catch {
    return [];
  }
}

/** Додає (або замінює за id) власну тему в список книги. Сховище може бути недоступним — тоді тихо пропускаємо. */
export function saveCustomTheme(bookId: string, theme: CustomBookDesignTheme): void {
  try {
    const rest = loadCustomThemes(bookId).filter((t) => t.id !== theme.id);
    window.localStorage.setItem(customThemesKey(bookId), JSON.stringify([...rest, theme]));
  } catch {
    /* список — лише зручність: сама тема зберігається в книзі */
  }
}

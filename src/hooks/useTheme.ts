import { useCallback, useEffect, useState } from 'react';

/**
 * Перемикач теми (темна / світла).
 *
 * Тему застосовано до `<html data-theme="...">` ще до першого малювання
 * (інлайн-скрипт у index.html), щоб уникнути спалаху не тієї теми. Цей хук
 * лише синхронізує React-стан із тим самим атрибутом і зберігає вибір.
 */

export type ThemeMode = 'dark' | 'light';

const THEME_KEY = 'nova_theme';

function readInitialTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage недоступний (приватний режим тощо) — використовуємо типове значення */
  }
  if (typeof document !== 'undefined') {
    const attr = document.documentElement.getAttribute('data-theme');
    if (attr === 'light' || attr === 'dark') return attr;
  }
  return 'dark';
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(readInitialTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* не критично */
    }
  }, [theme]);

  const setTheme = useCallback((next: ThemeMode) => setThemeState(next), []);
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return { theme, setTheme, toggleTheme, isLight: theme === 'light' };
}

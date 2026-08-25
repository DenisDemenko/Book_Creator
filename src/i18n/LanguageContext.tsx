/**
 * Двомовність (українська / англійська) для користувацької частини сайту.
 *
 * Адмін-панель НЕ перекладається — нею користується лише власник сайту.
 *
 * Архітектура: словники розкладені по файлах у `src/i18n/dictionaries/*`
 * (по одному на екран/компонент, щоб редагувати переклад одного екрана не
 * зачіпало інші файли), і об'єднуються в `dictionaries/index.ts` у два
 * дерева — uk/en з однаковою структурою ключів. `t('namespace.key')` бере
 * значення з дерева поточної мови; якщо ключа нема — падає назад на
 * українську, а якщо нема і там — повертає сам ключ (видно в розробці, що
 * забули перекласти).
 *
 * Мову зберігаємо в localStorage (як і тему — див. hooks/useTheme.ts) і
 * додатково виставляємо <html lang="..."> для доступності/SEO.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { dictionaries } from './dictionaries';

export type Lang = 'uk' | 'en';

const LANG_KEY = 'nova_language';

function readInitialLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if (stored === 'uk' || stored === 'en') return stored;
  } catch {
    /* localStorage недоступний — використовуємо типове значення */
  }
  return 'uk';
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

export interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  /** Переклад за ключем "namespace.key"; {varName} у рядку підставляється зі vars. */
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readInitialLang);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* не критично */
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggleLang = useCallback(() => {
    setLangState((prev) => (prev === 'uk' ? 'en' : 'uk'));
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      let raw = getByPath(dictionaries[lang], key);
      if (typeof raw !== 'string' && lang !== 'uk') {
        raw = getByPath(dictionaries.uk, key);
      }
      if (typeof raw !== 'string') {
        if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
          console.warn(`[i18n] Немає перекладу для ключа "${key}"`);
        }
        return key;
      }
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ''));
    },
    [lang]
  );

  const value = useMemo<LanguageContextValue>(() => ({ lang, setLang, toggleLang, t }), [lang, setLang, toggleLang, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage() використано поза <LanguageProvider>');
  }
  return ctx;
}

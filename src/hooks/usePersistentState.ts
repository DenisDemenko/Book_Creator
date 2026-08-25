import { useEffect, useState } from 'react';

/**
 * Стан, який автоматично зберігається у localStorage і відновлюється при
 * повторному вході. Використовується для «вільних» блоків редактора
 * (позиції/розміри панелей, розкриті вкладки, режими тощо), щоб після
 * переходу між розділами або перезавантаження сторінки нічого не
 * «стрибало» назад до типових значень.
 *
 * @param key      ключ localStorage (рекомендовано префікс "nova_editor_").
 * @param initial  значення за замовчуванням (використовується, якщо в сховищі нічого нема).
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {
      /* приватний режим / пошкоджені дані — падаємо на типове значення */
    }
    return initial;
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* сховище недоступне — стан лишиться лише в пам'яті */
    }
  }, [key, value]);

  return [value, setValue] as const;
}

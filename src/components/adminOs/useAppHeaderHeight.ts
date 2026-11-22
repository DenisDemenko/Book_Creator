import { useEffect, useState } from 'react';

/**
 * Справжня висота липкої шапки Студії (`HeaderNav`, атрибут `data-app-header`).
 *
 * `--app-header-h` для цього не годиться: це МІНІМАЛЬНА висота (86 px), а на
 * вужчих екранах шапка переноситься у два рядки й стає вищою (~126 px). Липкі
 * елементи адмінки (інспектор вузла, шапка калькулятора цін), поставлені за
 * змінною, ховалися б під нею. Немає шапки (сторінку вбудовано без неї) — 0.
 */
export function useAppHeaderHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const header = document.querySelector<HTMLElement>('[data-app-header]');
    if (!header) return;
    const measure = () => setHeight(header.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return height;
}

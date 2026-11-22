import { useEffect, useState } from 'react';

/**
 * Телефонна ширина студії (< 768 px, той самий поріг, що й `md:` у Tailwind).
 *
 * На телефоні студія перебудовується: шапка в один рядок, бічне меню —
 * висувна шухляда, блок «Інструменти» — нижня панель, аркуш вміщається в
 * ширину екрана без лінійок. Один хук, щоб усі ці місця перемикались на
 * одному й тому самому порозі й не розходились між собою.
 */
export const MOBILE_QUERY = '(max-width: 767px)';

export function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

export function useIsMobile(): boolean {
  const [mobile, setMobile] = useState<boolean>(isMobileViewport);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MOBILE_QUERY);
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return mobile;
}

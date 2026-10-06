import React, { useEffect, useState } from 'react';
import { useSunLighting } from '../context/SunLightingContext';
import { SUN_BACKGROUNDS, sunBackgroundFor } from '../data/sunBackgrounds';

/**
 * Фото-фон студії — 12 зображень власника, по одному на кожен колір
 * сонечка (src/data/sunBackgrounds.ts).
 *
 * Як саме змінюється фон. Обраний колір сонечка — це і є «перемикач»
 * фотографії: `selectedColor.id` → `SUN_BACKGROUNDS[id]`. Коли колір
 * змінюється, старий фон не зникає миттєво: він плавно гасне, а новий
 * так само плавно загорається — 7 секунд, обидва рівночасно (це і є
 * «гасіння та загорання за 7 секунд» з вимоги), тож посередині видно
 * напівпрозорий перехід, а не порожній екран.
 *
 * Механіка: два шари-«слоти», у кожному — своє зображення. Показ завжди
 * на тому слоті, куди ми перемкнулись; CSS-перехід робить решту (див.
 * `.studio-backdrop__layer` в index.css). Два слоти, а не один, саме тому,
 * що з одним довелося б гаснути до нуля й чекати — а це видно як блимання.
 *
 * Чому нова фотографія починає загоратися лише після `img.onload`:
 * перехід триває 7 секунд, і якщо почати його на ще не завантаженому
 * файлі, половину переходу буде видно порожнечу. Тому спершу завантажуємо
 * (браузер кладе у кеш), а вже потім перемикаємо слоти — затримка на
 * локальній швидкості непомітна, а на повільній мережі фон не «стрибає».
 *
 * Прозорість блоків над фоном — окрема історія (BlocksOpacityContext):
 * тут малюється тільки сам шар фону, і він від неї не залежить.
 */

/** Тривалість гасіння старого й загорання нового фону. Вимога власника — 7 с. */
export const BACKGROUND_FADE_MS = 7000;

/** Шарів рівно два: той, що гасне, і той, що загорається. */
type Slots = [string, string];

/** Чи просить система «зменшити рух» (тоді перемикаємо без анімації). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

export const StudioBackdrop: React.FC = () => {
  const { selectedColor } = useSunLighting();
  const target = sunBackgroundFor(selectedColor?.id);

  const [slots, setSlots] = useState<Slots>(() => [target, target]);
  const [activeSlot, setActiveSlot] = useState<0 | 1>(0);
  const shownUrl = slots[activeSlot];
  const reducedMotion = usePrefersReducedMotion();

  // Перемикання фону: спершу дочекатись завантаження, потім міняти слоти.
  useEffect(() => {
    if (target === shownUrl) return;

    let cancelled = false;
    const nextSlot: 0 | 1 = activeSlot === 0 ? 1 : 0;

    const swap = () => {
      if (cancelled) return;
      setSlots((prev) => {
        const next: Slots = [prev[0], prev[1]];
        next[nextSlot] = target;
        return next;
      });
      setActiveSlot(nextSlot);
    };

    const img = new Image();
    img.decoding = 'async';

    // `onload` сам по собі не доводить, що прийшла картинка. Доти, доки сервер
    // віддавав index.html із кодом 200 на неіснуючий ассет, браузер бачив
    // «успішну» відповідь, а <img> не декодувався — і фон тихо лишався старим
    // (саме так «зникало» перемикання кольорів). Тому перевіряємо
    // `naturalWidth`: у справжнього зображення він більший за нуль.
    let retried = false;

    // Повтор із параметром-«сіллю»: він обходить уже отруєний кеш — якщо за
    // адресою картинки колись осів HTML, той самий URL віддасть його й далі,
    // а з параметром браузер питає мережу наново.
    const retryOnce = () => {
      if (cancelled) return;
      if (retried) {
        console.warn('[studio-backdrop] фон не завантажився:', target);
        return;
      }
      retried = true;
      img.src = `${target}${target.includes('?') ? '&' : '?'}backdrop-retry=1`;
    };

    img.onload = () => {
      if (img.naturalWidth > 0) return swap();
      retryOnce();
    };
    // Помилка завантаження — одна повторна спроба, далі лишаємо попередній
    // фон: порожній екран гірший за «не той» колір, а причина (мережа, 404)
    // однаково видна в консолі.
    img.onerror = retryOnce;
    img.src = target;

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [target, shownUrl, activeSlot]);

  // Решта фонів — у кеш заздалегідь, по одному й після того, як сторінка
  // стала інтерактивною. Інакше кожне перемикання кольору чекало б на
  // мережу перед тим, як почати 7-секундне загорання. Вантажимо послідовно:
  // 12 файлів одночасно забили б канал на старті (сумарно ~3 МБ).
  useEffect(() => {
    let cancelled = false;
    let idleId: number | undefined;
    const timeouts: number[] = [];

    const prefetchAll = () => {
      const urls = Object.values(SUN_BACKGROUNDS);
      let index = 0;
      const next = () => {
        if (cancelled || index >= urls.length) return;
        const url = urls[index++];
        if (url !== target) {
          const img = new Image();
          img.decoding = 'async';
          img.onload = null;
          img.onerror = null;
          img.src = url;
        }
        // Пауза між файлами, щоб фонове завантаження не конкурувало з тим,
        // що автор робить у студії просто зараз.
        timeouts.push(window.setTimeout(next, 1200));
      };
      next();
    };

    const requestIdle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (typeof requestIdle === 'function') {
      idleId = requestIdle(prefetchAll);
    } else {
      timeouts.push(window.setTimeout(prefetchAll, 4000));
    }

    return () => {
      cancelled = true;
      if (idleId !== undefined) {
        (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
      }
      timeouts.forEach((id) => window.clearTimeout(id));
    };
    // Список фонів і сам target не змінюються під час сесії — ефект одноразовий.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="studio-backdrop" aria-hidden="true" data-testid="studio-backdrop">
      {slots.map((url, index) => (
        <div
          key={index}
          className="studio-backdrop__layer"
          data-active={index === activeSlot ? 'true' : 'false'}
          style={{
            backgroundImage: `url("${url}")`,
            opacity: index === activeSlot ? 1 : 0,
            transitionDuration: reducedMotion ? '0ms' : `${BACKGROUND_FADE_MS}ms`,
          }}
        />
      ))}
      {/* Легка затемнююча/висвітлююча підкладка: без неї текст на світлих
          ділянках фото зливається з фоном (див. .studio-backdrop__scrim). */}
      <div className="studio-backdrop__scrim" />
    </div>
  );
};

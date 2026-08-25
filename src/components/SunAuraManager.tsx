import React, { useEffect, useRef } from 'react';
import { useSunLighting } from '../context/SunLightingContext';

/**
 * Глобальний менеджер різнокольорової аури — як на картках вкладки
 * «Тарифи та аналітика ШІ»: кожній «поверхні» контенту сайту призначається
 * власний колір сяйва, а його сила залежить від відстані до сонечка —
 * яскравіше працює в районі знаходження сонця, слабше на віддалі.
 *
 * Механізм — per-element CSS-змінні, які споживає --aurora-glow-layers
 * (src/index.css):
 *   --aura-accent      «r, g, b» — колір сяйва елемента;
 *   --aura-intensity   0..1 — близькість до сонця.
 * Обидві змінні мають фолбеки (аврора-палітра та 1), тож без цього
 * компонента сайт працює як раніше.
 *
 * Навігацію (шапку/сайдбар) не чіпаємо — вона лишається в стандартній
 * аврорі, щоб колірні картки не «сперечалися» з меню.
 */
const AURA_PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [66, 133, 244],   // синій
  [16, 163, 127],   // зелений
  [167, 139, 250],  // фіолетовий
  [245, 158, 11],   // бурштин
  [34, 211, 238],   // бірюза
  [236, 72, 153],   // рожевий
  [249, 115, 22],   // оранжевий
  [132, 204, 22],   // лайм
];

const SURFACE_SELECTOR = [
  ':is([class~="rounded-lg"],[class~="rounded-xl"],[class~="rounded-2xl"],[class~="rounded-3xl"])[class~="border"][class*="bg-"]',
  '.glass-panel',
  '.glass-panel-elevated',
  '.badge-glass',
].join(',');

/** Радіус, у якому сонце максимально «розжарює» сяйво поверхні (px). */
const SUN_AURA_RADIUS = 1100;
/** Мінімальна сила сяйва, коли сонце далеко (біля сонця — яскравіше). */
const AURA_FLOOR = 0.45;

/**
 * Шаблони сяйва поверхні. Посилаються на пер-елементні змінні
 * (--aura-accent / --aura-intensity) та на глобальні (--glow-intensity —
 * повзунок «Сайво:», --sun-glow-opacity — сонце). Менеджер ставить ці рядки
 * ПРЯМО на елемент (inline), тож вкладені var() резолвляться в контексті
 * ЕЛЕМЕНТА — кожна поверхня світиться власним кольором, яскравіше біля сонця.
 */
const AURA_LAYERS = [
  '0 0 calc(18px * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)) calc(2px * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)) rgba(var(--aura-accent, var(--glow-c1)), calc(0.4 * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)))',
  '0 0 calc(36px * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)) calc(5px * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)) rgba(var(--aura-accent, var(--glow-c2)), calc(0.26 * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)))',
  '0 0 calc(56px * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)) calc(9px * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)) rgba(var(--aura-accent, var(--glow-c3)), calc(0.17 * var(--glow-intensity) * var(--sun-glow-opacity) * var(--aura-intensity, 1)))',
].join(',\n    ');
/** Той самий шар сяйва плюс глибина — для карток, що використовують --aurora-shadow. */
const AURA_SHADOW = `0 12px 40px -26px rgba(0, 0, 0, 0.72),\n    ${AURA_LAYERS}`;

/** Змінні, які менеджер ставить на поверхню (щоб змивати їх у світлій темі). */
const AURA_VARS = ['--aura-accent', '--aura-intensity', '--aurora-glow-layers', '--aurora-shadow'];

export const SunAuraManager: React.FC = () => {
  const { sunPosition, intensityFactor, isSunEnabled } = useSunLighting();

  // Свіжі значення для rAF-циклу, щоб не перезапускати ефект щокадрово.
  const sunRef = useRef(sunPosition);
  sunRef.current = sunPosition;
  const intensityRef = useRef(intensityFactor);
  intensityRef.current = intensityFactor;
  const enabledRef = useRef(isSunEnabled);
  enabledRef.current = isSunEnabled;

  useEffect(() => {
    const cache = new Map<HTMLElement, { color: string; last: number; rect: DOMRect }>();
    const colorIndex = new WeakMap<HTMLElement, number>();
    let colorCounter = 0;
    let rectsDirty = true;
    let lastSun = { x: Number.NaN, y: Number.NaN };
    let lastSession = -1;
    let lastEnabled = -1;
    let lastTheme = 'dark';
    let raf = 0;
    let collectTimer = 0;
    let scrollTimer = 0;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const refreshRects = () => {
      for (const [el, entry] of cache) {
        if (!el.isConnected) {
          cache.delete(el);
          continue;
        }
        entry.rect = el.getBoundingClientRect();
      }
    };

    const collect = () => {
      document.querySelectorAll<HTMLElement>(SURFACE_SELECTOR).forEach((el) => {
        // Оминаємо навігацію (шапка/сайдбар) — вона лишається в стандартній аврорі.
        if (el.closest('header, aside')) return;
        if (cache.has(el)) return;
        let idx = colorIndex.get(el);
        if (idx === undefined) {
          idx = colorCounter++ % AURA_PALETTE.length;
          colorIndex.set(el, idx);
        }
        const [r, g, b] = AURA_PALETTE[idx];
        cache.set(el, { color: `${r}, ${g}, ${b}`, last: -1, rect: el.getBoundingClientRect() });
        // Ставимо на елемент власний колір і шаблони сяйва (inline-змінні,
        // щоб вкладені var() резолвились саме в контексті цього елемента).
        el.style.setProperty('--aura-accent', `${r}, ${g}, ${b}`);
        el.style.setProperty('--aurora-glow-layers', AURA_LAYERS);
        el.style.setProperty('--aurora-shadow', AURA_SHADOW);
      });
      rectsDirty = true;
    };

    const apply = () => {
      const sun = sunRef.current;
      const session = intensityRef.current;
      const enabled = enabledRef.current;

      const theme = document.documentElement.getAttribute('data-theme') || 'dark';
      const sunMoved = Math.abs(sun.x - lastSun.x) > 1 || Math.abs(sun.y - lastSun.y) > 1;
      const stateChanged = lastSession !== session || lastEnabled !== (enabled ? 1 : 0) || lastTheme !== theme;
      if (!sunMoved && !stateChanged && !rectsDirty) return;

      lastSun = { x: sun.x, y: sun.y };
      lastSession = session;
      lastEnabled = enabled ? 1 : 0;
      lastTheme = theme;

      if (rectsDirty) {
        refreshRects();
        rectsDirty = false;
      }

      // У світлій темі кольорова аврора вимкнена (сірі тіні сонця) — тут
      // сяйво не чіпаємо й змиваємо раніше поставлені змінні, щоб не
      // перебити світлі неоморфні тіні.
      if (theme === 'light') {
        for (const [el, entry] of cache) {
          if (!el.isConnected) {
            cache.delete(el);
            continue;
          }
          let removed = false;
          for (const v of AURA_VARS) {
            if (el.style.getPropertyValue(v)) {
              el.style.removeProperty(v);
              removed = true;
            }
          }
          if (removed) entry.last = -1;
        }
        return;
      }

      for (const [el, entry] of cache) {
        if (!el.isConnected) {
          cache.delete(el);
          continue;
        }
        const r = entry.rect;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dist = Math.hypot(sun.x - cx, sun.y - cy);
        const p = Math.max(0, 1 - dist / SUN_AURA_RADIUS);
        // Чиста близькість до сонця (0.45..1). Сесію/вкл-вимк сонця вже
        // враховує --sun-glow-opacity, а повзунок — --glow-intensity (у шаблоні).
        const intensity = AURA_FLOOR + p * p * (1 - AURA_FLOOR);
        if (Math.abs(intensity - entry.last) < 0.02) continue;
        entry.last = intensity;
        el.style.setProperty('--aura-intensity', intensity.toFixed(3));
      }
    };

    const tick = () => {
      apply();
      raf = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (raf) return; // вже крутиться
      raf = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    // Той самий принцип, що й у GlowIntensityControl: цикл не має сенсу
    // крутитися на схованій вкладці чи коли система просить «зменшити рух».
    const evaluateLoop = () => {
      if (reducedMotionQuery.matches || document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    };

    collect();
    evaluateLoop();
    document.addEventListener('visibilitychange', evaluateLoop);
    reducedMotionQuery.addEventListener('change', evaluateLoop);

    // Скрол/ресайз лише позначають кеш "брудним" — сам дорогий перерахунок
    // (getBoundingClientRect на кожній поверхні, refreshRects) відбувається
    // в apply() НЕ на кожен кадр скролу, а через ~120мс тиші після нього.
    // Раніше rectsDirty=true виставлявся на кожен scroll-івент, і той самий
    // rAF-цикл, що вже крутиться щокадру, одразу ж форсував layout для всіх
    // поверхонь — тобто під час активного скролу браузер рахував layout
    // на кожному кадрі одночасно зі скролом/компонуванням. Радіус сяйва
    // (1100px) достатньо великий, щоб ~120мс застарілості позицій під час
    // самого скролу були непомітні на око.
    const onScrollOrResize = () => {
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        rectsDirty = true;
      }, 120);
    };
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize);

    // Нові поверхні з'являються під час перемикання вкладок/модалок.
    const mo = new MutationObserver(() => {
      window.clearTimeout(collectTimer);
      collectTimer = window.setTimeout(collect, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      stopLoop();
      window.clearTimeout(collectTimer);
      window.clearTimeout(scrollTimer);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
      document.removeEventListener('visibilitychange', evaluateLoop);
      reducedMotionQuery.removeEventListener('change', evaluateLoop);
      mo.disconnect();
    };
  }, []);

  return null;
};

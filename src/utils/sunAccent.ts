import type { CSSProperties } from 'react';
import { useSunLighting } from '../context/SunLightingContext';

/**
 * Акцент «Сонечка»: CSS-змінні, які змушують кольоровий текст панелей і
 * тулбарів слідувати за вибраним кольором сонця (12 кольорів у DraggableSun).
 *
 * Той самий набір змінних, що й у HeaderNav.tsx (там він виведений вручну):
 *   --sun-acc   — основний акцент (іконки, жирні числа);
 *   --sun-soft  — м'який тон (заголовки, вторинний текст);
 *   --sun-acc-NN — напівпрозорі заливки/рамки акценту (10..80%).
 *
 * У світлій темі світлі відтінки палітри погано читаються на білому, тому
 * там уживаються ТЕМНІ тони: primary та ще темніший для м'яких надписів.
 * У темній темі — навпаки, яскраві secondary/highlight.
 */

/** Затемнює hex-колір: factor 0..1 (0 = без змін, 1 = чорний). */
export function darkenHex(hex: string, factor: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const scale = (v: number) => Math.max(0, Math.round(v * (1 - factor)));
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return `#${[r, g, b].map((v) => scale(v).toString(16).padStart(2, '0')).join('')}`;
}

/** Хук: повертає об'єкт стилів із CSS-змінними акценту сонця. */
export function useSunAccentVars(): CSSProperties {
  const { selectedColor, theme } = useSunLighting();
  const isLightTheme = theme === 'light';
  const sunBase = isLightTheme ? selectedColor.primary : selectedColor.secondary;
  const sunSoft = isLightTheme ? darkenHex(selectedColor.primary, 0.35) : selectedColor.highlight;

  return {
    '--sun-acc': sunBase,
    '--sun-soft': sunSoft,
    '--sun-acc-10': `${sunBase}1A`,
    '--sun-acc-15': `${sunBase}26`,
    '--sun-acc-20': `${sunBase}33`,
    '--sun-acc-25': `${sunBase}40`,
    '--sun-acc-30': `${sunBase}4D`,
    '--sun-acc-40': `${sunBase}66`,
    '--sun-acc-70': `${sunBase}B3`,
    '--sun-acc-80': `${sunBase}CC`,
    '--sun-acc-90': `${sunBase}E6`,
  } as CSSProperties;
}

import type { CSSProperties } from 'react';
import { useSunLighting } from '../context/SunLightingContext';
import { darkenHex, sunAccentVars } from './sunAccentVars';

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
 *
 * АРИФМЕТИКА ТУТ БІЛЬШЕ НЕ ЖИВЕ: вона переїхала в `sunAccentVars.ts`, бо нею
 * користується ще й `SunLightingContext` — він ставить ці самі змінні на
 * `document.documentElement`, тож акцент «Сонечка» діє в кожному розділі
 * студії, а не лише там, де цей хук викликали.
 */

/** Хук: повертає об'єкт стилів із CSS-змінними акценту сонця. */
export function useSunAccentVars(): CSSProperties {
  const { selectedColor, theme } = useSunLighting();
  return sunAccentVars(selectedColor, theme === 'light' ? 'light' : 'dark') as CSSProperties;
}

export { darkenHex };


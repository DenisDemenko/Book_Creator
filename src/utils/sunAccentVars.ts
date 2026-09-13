import type { SunColorTheme } from '../context/SunLightingContext';

/**
 * Акцент «Сонечка» як ЧИСТА функція: ті самі CSS-змінні, що раніше давав лише
 * `useSunAccentVars()` у `utils/sunAccent.ts`.
 *
 * НАВІЩО ВИНЕСЕНО ОКРЕМО. `SunLightingContext` тепер ставить ці змінні на
 * `document.documentElement` — тому вони діють у КОЖНОМУ розділі студії, і
 * кнопка, забарвлена `[color:var(--sun-acc)]`, слідує за вибраним кольором
 * сонця без жодної обгортки навколо розділу. Але контекст не може імпортувати
 * `utils/sunAccent.ts`: той імпортує з контексту хука, і вийшов би цикл.
 * Тому арифметика живе тут — без імпортів із контексту (лише тип), а хук і
 * контекст користуються нею обидва.
 */

/** Затемнює hex-колір: factor 0..1 (0 = без змін, 1 = чорний). */
export function darkenHex(hex: string, factor: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  const scale = (v: number) => Math.max(0, Math.round(v * (1 - factor)));
  const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return `#${[r, g, b].map((v) => scale(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Той самий набір змінних, що й у HeaderNav.tsx (там він виведений вручну):
 *   --sun-acc    — основний акцент (іконки, жирні числа, текст кнопок);
 *   --sun-soft   — м'який тон (заголовки, вторинний текст);
 *   --sun-acc-NN — напівпрозорі заливки/рамки акценту (10..90%).
 *
 * У світлій темі світлі відтінки палітри погано читаються на білому, тому
 * там уживаються ТЕМНІ тони: primary та ще темніший для м'яких надписів.
 * У темній темі — навпаки, яскраві secondary/highlight.
 */
export function sunAccentVars(
  selectedColor: SunColorTheme,
  theme: 'light' | 'dark'
): Record<string, string> {
  const sunBase = theme === 'light' ? selectedColor.primary : selectedColor.secondary;
  const sunSoft = theme === 'light' ? darkenHex(selectedColor.primary, 0.35) : selectedColor.highlight;

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
  };
}

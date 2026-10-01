/**
 * Фони студії: 12 фотографій, по одній на кожен колір сонечка
 * (`SUN_12_COLORS`, src/context/SunLightingContext.tsx).
 *
 * Звідки взяті файли та чому така нумерація.
 * Власник дав 12 PNG у теці `D:\Rama\furnivision-architecture\Рисунки\Фони`,
 * і назви файлів там — це назви кольорів сонечка:
 *
 *   Смарагт майстра   → emerald   («Смарагд Майстра» у коді)
 *   Золоте сяйво      → amber     («Золоте Сяйво»)
 *   Рубіновий драйв   → ruby      («Рубіновий Драйв»)
 *   Магічний аметист  → amethyst  («Магічний Аметист»)
 *   Глибокий сапфир   → sapphire  («Глибокий Сапфір»)
 *   Океанічна Бірюза  → turquoise («Океанічна Бірюза»)
 *   Кораловий захід   → coral     («Кораловий Захід»)
 *   Рожевий кварц     → rose      («Рожевий Кварц»)
 *   Нічне Індіго      → indigo    («Нічне Індиго»)
 *   Весняний лайм     → lime      («Весняний Лайм»)
 *   Місячна платина   → platinum  («Місячна Платина»)
 *   Антична бронза    → bronze    («Антична Бронза»)
 *
 * Зіставляти за ІМЕНЕМ не можна (саме через такі пари, як «Смарагт» проти
 * «Смарагд» чи «Сапфир» проти «Сапфір»), тому ключ тут — `id` кольору, а
 * імена файлів лишаються в цьому коментарі як довідка.
 *
 * Формат: WebP, якість 0.82, розмір як в оригіналі (~1800×872), сумарно
 * 3.2 МБ замість 29.7 МБ PNG. Перекодовано скриптом
 * `tmp/convert-backgrounds.mts` (одноразовий, у репозиторії не живе).
 *
 * Файли лежать у `src/assets/backgrounds/`, а не в `public/`: Vite тоді сам
 * додає префікс шляху (`/studio/…` у проді) і хеш до імені, тож заміна
 * фотографії власником не впирається в кеш браузера. Тому тут — імпорти, а
 * не рядки URL: рядок `/backgrounds/x.webp` під префіксом `/studio` дав би
 * 404 (перевірка на живому проді, див. src/utils/basePath.ts про те саме
 * для `/api/media/…`).
 */
import emerald from '../assets/backgrounds/emerald.webp';
import amber from '../assets/backgrounds/amber.webp';
import ruby from '../assets/backgrounds/ruby.webp';
import amethyst from '../assets/backgrounds/amethyst.webp';
import sapphire from '../assets/backgrounds/sapphire.webp';
import turquoise from '../assets/backgrounds/turquoise.webp';
import coral from '../assets/backgrounds/coral.webp';
import rose from '../assets/backgrounds/rose.webp';
import indigo from '../assets/backgrounds/indigo.webp';
import lime from '../assets/backgrounds/lime.webp';
import platinum from '../assets/backgrounds/platinum.webp';
import bronze from '../assets/backgrounds/bronze.webp';

/** id кольору сонечка → адреса фотографії-фону. */
export const SUN_BACKGROUNDS: Readonly<Record<string, string>> = {
  emerald,
  amber,
  ruby,
  amethyst,
  sapphire,
  turquoise,
  coral,
  rose,
  indigo,
  lime,
  platinum,
  bronze,
};

/** Колір, фон якого показуємо, коли id невідомий (нова тема без фото). */
export const DEFAULT_SUN_BACKGROUND = sapphire;

/** Фон для кольору сонечка. Невідомий id — типовий фон, не порожнеча. */
export function sunBackgroundFor(colorId: string | undefined): string {
  if (!colorId) return DEFAULT_SUN_BACKGROUND;
  return SUN_BACKGROUNDS[colorId] ?? DEFAULT_SUN_BACKGROUND;
}

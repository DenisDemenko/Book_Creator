/**
 * Підсистема 3: пакувальник курсових компонентів (ТЗ 5).
 *
 * Збирає з елементів бібліотеки автора (робочий зошит, слайди, чекліст,
 * аудіо-урок, сертифікат) один товарний набір: `.zip` + файл-опис вмісту для
 * покупця + оцінка, чи вміщається набір у ліміт майданчика.
 *
 * Два рішення, які варто пояснити:
 *
 * 1. **Перевірка ліміту робиться до пакування, а не після.** Спакувати 300 МБ
 *    відео, щоб потім сказати «не влізло в 20 МБ», — це змарнований час
 *    автора і пам'ять сервера. Тому `analyzeComponents()` — окрема чиста
 *    функція, і роут підготовки викликає її раніше за `packageCourse()`.
 *
 * 2. **README.pdf — з деградацією.** ТЗ просить PDF, але стандартні шрифти
 *    PDF не вміють кирилиці, а шрифт із кирилицею репозиторій не возить.
 *    Тому: якщо доступні `pdf-lib` + Unicode-шрифт (з ETSY_README_FONT_PATH,
 *    з DATA_DIR/fonts або завантажений один раз у кеш) — кладемо README.pdf;
 *    якщо ні — кладемо README.txt і чесно повідомляємо про це попередженням.
 *    Набір не має ставати непублікованим через відсутній шрифт.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../db';
import { createZip, type ZipEntry } from './zipWriter';
import {
  MAX_DIGITAL_FILES,
  MAX_FILE_BYTES,
  formatBytes,
  recommendDeliveryScenario,
  type ScenarioRecommendation,
} from './etsyListingRules';

export interface BundleComponent {
  name: string;
  bytes: number;
  kind?: string;
  data?: Uint8Array;
}

export interface BundleAnalysis {
  totalBytes: number;
  fileCount: number;
  fitsEtsy: boolean;
  recommendation: ScenarioRecommendation;
  warningsUk: string[];
}

/** Оцінка набору без пакування — саме її показує UI до натискання кнопки. */
export function analyzeComponents(
  components: BundleComponent[],
  options: { limitBytes?: number } = {}
): BundleAnalysis {
  const limit = options.limitBytes ?? MAX_FILE_BYTES;
  const list = components || [];
  const totalBytes = list.reduce((sum, c) => sum + (Number(c.bytes) || 0), 0);
  const recommendation = recommendDeliveryScenario(list, { limitBytes: limit });
  const warningsUk: string[] = [];

  if (!list.length) warningsUk.push('До набору не додано жодного компонента.');
  if (list.length > MAX_DIGITAL_FILES) {
    warningsUk.push(
      `Компонентів ${list.length}. Після пакування це буде один .zip — у ліміт ${MAX_DIGITAL_FILES} файлів Etsy набір вкладеться, але перевірте сумарний розмір.`
    );
  }
  const oversized = list.filter((c) => (Number(c.bytes) || 0) > limit);
  for (const item of oversized) {
    warningsUk.push(`Компонент «${item.name}» сам по собі важить ${formatBytes(item.bytes)} — більше за ліміт майданчика.`);
  }
  const names = new Set<string>();
  for (const item of list) {
    const key = item.name.toLowerCase();
    if (names.has(key)) warningsUk.push(`Назва «${item.name}» повторюється — у наборі файли перезапишуть одне одного.`);
    names.add(key);
  }

  return {
    totalBytes,
    fileCount: list.length,
    fitsEtsy: totalBytes <= limit,
    recommendation,
    warningsUk,
  };
}

/** Людські назви типів компонентів для файлу-опису. */
const KIND_LABELS: Record<string, string> = {
  workbook: 'Робочий зошит',
  slides: 'Слайди / конспект уроку',
  checklist: 'Чекліст або шаблон вправи',
  audio: 'Аудіо-урок',
  certificate: 'Сертифікат виконання',
  manuscript: 'Рукопис',
  cover: 'Обкладинка',
  guide: 'Путівник',
  other: 'Матеріал',
};

export function buildReadmeText(params: {
  title: string;
  description?: string;
  authorName?: string;
  components: BundleComponent[];
  scenario?: ScenarioRecommendation;
  accessLink?: string;
}): string {
  const lines: string[] = [];
  lines.push(params.title);
  lines.push('='.repeat(Math.min(60, Math.max(10, params.title.length))));
  lines.push('');
  if (params.authorName) lines.push(`Автор: ${params.authorName}`);
  lines.push(`Дата збірки: ${new Date().toLocaleDateString('uk-UA')}`);
  lines.push('');
  if (params.description) {
    lines.push('Про набір');
    lines.push('---------');
    lines.push(params.description.trim());
    lines.push('');
  }
  lines.push('Що всередині');
  lines.push('------------');
  params.components.forEach((component, index) => {
    const label = KIND_LABELS[component.kind || 'other'] || KIND_LABELS.other;
    lines.push(`${index + 1}. ${component.name} — ${label} (${formatBytes(component.bytes)})`);
  });
  lines.push('');
  if (params.accessLink) {
    lines.push('Доступ до повного курсу');
    lines.push('-----------------------');
    lines.push(params.accessLink);
    lines.push('');
  }
  lines.push('Як користуватись');
  lines.push('----------------');
  lines.push('Розпакуйте архів у будь-яку теку. PDF-файли відкриваються будь-якою');
  lines.push('програмою для перегляду документів, аудіо — стандартним плеєром.');
  lines.push('');
  lines.push('Це цифровий товар: повернення коштів після завантаження не передбачене');
  lines.push('правилами майданчика. Якщо якийсь файл не відкривається — напишіть');
  lines.push('автору повідомленням, і він надішле заміну.');
  return lines.join('\n');
}

/**
 * Пробує знайти Unicode-шрифт для README.pdf. Порядок пошуку — від найбільш
 * явного до найменш: змінна середовища → тека кешу → одноразове завантаження.
 * Мовчазно повертає null, якщо нічого не вийшло: PDF — приємний бонус, а не
 * умова існування набору.
 */
async function resolveUnicodeFont(): Promise<Uint8Array | null> {
  const explicit = process.env.ETSY_README_FONT_PATH;
  if (explicit) {
    try {
      return new Uint8Array(await fsp.readFile(explicit));
    } catch {
      console.warn('[packager] ETSY_README_FONT_PATH вказує на файл, який не читається.');
    }
  }

  const cacheDir = path.join(DATA_DIR, 'fonts');
  const cachePath = path.join(cacheDir, 'readme-unicode.ttf');
  try {
    return new Uint8Array(await fsp.readFile(cachePath));
  } catch {
    /* кешу ще немає — спробуємо завантажити */
  }

  const url = process.env.ETSY_README_FONT_URL;
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    await fsp.mkdir(cacheDir, { recursive: true });
    await fsp.writeFile(cachePath, bytes);
    return bytes;
  } catch (err) {
    console.warn('[packager] Не вдалося завантажити шрифт для README.pdf:', (err as Error)?.message);
    return null;
  }
}

/** Рендерить README у PDF. null — якщо pdf-lib або шрифт недоступні. */
export async function renderReadmePdf(text: string): Promise<Uint8Array | null> {
  let pdfLib: any;
  let fontkit: any;
  try {
    pdfLib = await import('pdf-lib');
    fontkit = (await import('@pdf-lib/fontkit')).default;
  } catch {
    return null;
  }
  const fontBytes = await resolveUnicodeFont();
  if (!fontBytes) return null;

  try {
    const doc = await pdfLib.PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: true });

    const pageWidth = 595.28; // A4
    const pageHeight = 841.89;
    const margin = 56;
    const fontSize = 11;
    const lineHeight = fontSize * 1.5;
    const maxWidth = pageWidth - margin * 2;

    // Перенос по словах: pdf-lib сам не переносить, а обрізаний рядок у
    // файлі-описі виглядав би як брак.
    const wrapped: string[] = [];
    for (const rawLine of text.split('\n')) {
      if (!rawLine.trim()) {
        wrapped.push('');
        continue;
      }
      let current = '';
      for (const word of rawLine.split(' ')) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
          wrapped.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      wrapped.push(current);
    }

    let page = doc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;
    for (const line of wrapped) {
      if (y < margin) {
        page = doc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      if (line) page.drawText(line, { x: margin, y, size: fontSize, font });
      y -= lineHeight;
    }

    return await doc.save();
  } catch (err) {
    console.warn('[packager] README.pdf не сформовано:', (err as Error)?.message);
    return null;
  }
}

export interface PackagedBundle {
  zip: Uint8Array;
  fileName: string;
  totalBytes: number;
  entries: { path: string; bytes: number }[];
  analysis: BundleAnalysis;
  readmeFormat: 'pdf' | 'txt';
  warningsUk: string[];
}

/**
 * Транслітерація для імен файлів. Кирилиця в імені сама по собі валідна, але
 * дорогою до покупця файл проходить через HTTP-заголовки, файлові системи
 * різних ОС і кабінет Etsy — і кожна ланка має власне уявлення про
 * кодування. ASCII-ім'я знімає весь цей клас проблем.
 */
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z',
  и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p',
  р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'e', ъ: '',
};

export function transliterate(text: string): string {
  return String(text)
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('');
}

/** Ім'я файлу без символів, які ламають завантаження на майданчиках. */
export function safeFileName(title: string, extension: string): string {
  const base = transliterate(String(title || 'nabir'))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'nabir'}${extension}`;
}

export async function packageCourse(params: {
  title: string;
  description?: string;
  authorName?: string;
  components: BundleComponent[];
  accessLink?: string;
  limitBytes?: number;
}): Promise<PackagedBundle> {
  const analysis = analyzeComponents(params.components, { limitBytes: params.limitBytes });
  const readmeText = buildReadmeText({
    title: params.title,
    description: params.description,
    authorName: params.authorName,
    components: params.components,
    scenario: analysis.recommendation,
    accessLink: params.accessLink,
  });

  const warningsUk = [...analysis.warningsUk];
  const pdf = await renderReadmePdf(readmeText);
  const readmeFormat: 'pdf' | 'txt' = pdf ? 'pdf' : 'txt';
  if (!pdf) {
    warningsUk.push(
      'README вкладено як .txt: для PDF потрібен Unicode-шрифт (ETSY_README_FONT_PATH або ETSY_README_FONT_URL) — стандартні шрифти PDF не підтримують кирилиці.'
    );
  }

  const entries: ZipEntry[] = [
    pdf
      ? { path: 'README.pdf', data: pdf, store: true }
      : { path: 'README.txt', data: new TextEncoder().encode(readmeText) },
  ];
  for (const component of params.components) {
    if (!component.data) continue;
    entries.push({ path: component.name, data: component.data });
  }

  const zip = createZip(entries);
  return {
    zip,
    fileName: safeFileName(params.title, '.zip'),
    totalBytes: zip.length,
    entries: entries.map((e) => ({ path: e.path, bytes: e.data.length })),
    analysis,
    readmeFormat,
    warningsUk,
  };
}

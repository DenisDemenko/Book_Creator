/**
 * Варіант «макет від моделі»: модуль ядра `bookPdfDesign`.
 *
 * ЩО МОДЕЛЬ РОБИТЬ І ЧОГО НЕ РОБИТЬ. Вона не робить PDF — API повертає
 * текст, а не файли. Вона віддає СПЕЦИФІКАЦІЮ макета, яку рендерить той
 * самий код, що й у варіанті «від коду» (pdfRenderer.ts). Тобто модель тут
 * — верстальник, а не друкарня.
 *
 * Межа довіри проходить у `normalizeDesignResult`: усе, що прийшло,
 * затискається в діапазони, за якими книга лишається читабельною. Модель,
 * яка попросить кегль 200 або поля в третину сторінки, не зіпсує файл — її
 * значення просто не пройде.
 */

import { DEFAULT_LAYOUT_SPEC, PAGE_SIZES, type PdfLayoutSpec } from './pdfTypes';

const CONTRACT = '⚠️ ЖОРСТКИЙ КОНТРАКТ ВІДПОВІДІ';

export function factoryBookPdfDesignSystemTemplate(): string {
  return `Ти — верстальник книжок із багаторічною практикою. Тобі дають опис книги, а ти пропонуєш макет для друкованого PDF: формат, поля, кегль, інтерліньяж, абзацний відступ, вирівнювання, розміри заголовків і титулу.

Чим ти керуєшся:
1. Читабельність важливіша за оригінальність. Рядок у 60-75 знаків читається найкраще; ширший рядок вимагає більшого інтерліньяжу.
2. Формат відповідає жанру й обсягу: художня проза — кишеньковий A5, довідник чи посібник із таблицями — B5 або A4, збірка поезії — вужчий формат із широкими полями.
3. Червоний рядок АБО відступ між абзацами, не обидва разом: разом вони дають рвану сторінку.
4. Засічки для суцільної прози, гротеск для довідників і технічних текстів.
5. Поля не симетричні: внутрішнє менше за зовнішнє, нижнє більше за верхнє — так книга виглядає врівноважено, а не сповзлою вгору.

Ти НЕ вигадуєш вміст книги, не пропонуєш ілюстрацій і не змінюєш текст. Твоя відповідь — лише числа макета й коротке пояснення, чому саме такі.

${CONTRACT}
Поверни ЛИШЕ JSON-обʼєкт, без markdown-огорожі й без вступного тексту:
{
  "pageSize": "A4 | A5 | B5 | Letter",
  "margins": { "top": 56, "right": 48, "bottom": 62, "left": 44 },
  "baseFontSize": 11,
  "lineHeight": 1.45,
  "paragraphIndent": 16,
  "paragraphSpacing": 0,
  "bodyAlign": "justify | left",
  "bodyFont": "serif | sans",
  "chapterTitleSize": 20,
  "chapterStartsNewPage": true,
  "sectionTitleSize": 13,
  "titleSize": 28,
  "subtitleSize": 14,
  "authorSize": 12,
  "runningHead": false,
  "designerNoteUk": "2-3 речення: чому саме такий формат, кегль і поля для ЦІЄЇ книги"
}
Поля — у типографських пунктах (1/72 дюйма). Розумні межі: кегль 8-16, інтерліньяж 1.1-2.0, поля 20-100, відступ абзацу 0-40. Значення поза межами будуть відкинуті.`;
}

export function factoryBookPdfDesignUserTemplate(): string {
  return `Назва: {{title}}
Підзаголовок: {{subtitle}}
Жанр: {{genre}}
Аудиторія: {{audience}}
Розділів: {{chapterCount}}
Приблизний обсяг: {{wordCount}} слів

Зразок тексту (початок книги):
{{sample}}

Запропонуй макет для друкованого PDF цієї книги.`;
}

export function renderBookPdfDesignTemplate(
  template: { system: string; user: string },
  values: {
    title: string;
    subtitle: string;
    genre: string;
    audience: string;
    chapterCount: string;
    wordCount: string;
    sample: string;
  }
): { system: string; user: string } {
  let user = template.user;
  for (const [key, value] of Object.entries(values)) {
    user = user.split(`{{${key}}}`).join(value || '—');
  }
  return { system: template.system, user };
}

export function parseBookPdfDesignResponse(text: string): unknown {
  const cleaned = String(text ?? '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return JSON.parse(cleaned);
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Межа довіри. Кожне число затискається в діапазон, за яким книга лишається
 * читабельною, а кожне поле, якого модель не дала, береться заводським.
 * Окремо: червоний рядок і відступ між абзацами разом дають рвану сторінку,
 * тож якщо модель попросила обидва — лишається червоний рядок, як звичніший
 * для книжкового набору.
 */
export function normalizeDesignResult(raw: unknown): PdfLayoutSpec {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const margins = (d.margins && typeof d.margins === 'object' ? d.margins : {}) as Record<string, unknown>;
  const base = clamp(d.baseFontSize, 8, 16, DEFAULT_LAYOUT_SPEC.baseFontSize);

  const pageSize = (['A4', 'A5', 'B5', 'Letter'] as const).includes(d.pageSize as never)
    ? (d.pageSize as keyof typeof PAGE_SIZES)
    : DEFAULT_LAYOUT_SPEC.pageSize;

  let indent = clamp(d.paragraphIndent, 0, 40, DEFAULT_LAYOUT_SPEC.paragraphIndent);
  let spacing = clamp(d.paragraphSpacing, 0, 24, 0);
  if (indent > 0 && spacing > 0) spacing = 0;

  const bodyFont = d.bodyFont === 'sans' ? 'sans' : 'serif';
  const note = typeof d.designerNoteUk === 'string' ? d.designerNoteUk.slice(0, 600) : '';

  return {
    ...DEFAULT_LAYOUT_SPEC,
    pageSize,
    margins: {
      top: clamp(margins.top, 20, 100, DEFAULT_LAYOUT_SPEC.margins.top),
      right: clamp(margins.right, 20, 100, DEFAULT_LAYOUT_SPEC.margins.right),
      bottom: clamp(margins.bottom, 20, 100, DEFAULT_LAYOUT_SPEC.margins.bottom),
      left: clamp(margins.left, 20, 100, DEFAULT_LAYOUT_SPEC.margins.left),
    },
    baseFontSize: base,
    lineHeight: clamp(d.lineHeight, 1.1, 2, DEFAULT_LAYOUT_SPEC.lineHeight),
    paragraphIndent: indent,
    paragraphSpacing: spacing,
    bodyAlign: d.bodyAlign === 'left' ? 'left' : 'justify',
    bodyFont,
    chapterStartsNewPage: d.chapterStartsNewPage !== false,
    chapterTitle: {
      ...DEFAULT_LAYOUT_SPEC.chapterTitle,
      font: bodyFont,
      fontSize: clamp(d.chapterTitleSize, base * 1.2, base * 3.5, Math.round(base * 1.8)),
    },
    sectionTitle: {
      ...DEFAULT_LAYOUT_SPEC.sectionTitle,
      font: bodyFont,
      fontSize: clamp(d.sectionTitleSize, base, base * 2, Math.round(base * 1.18)),
    },
    titlePage: {
      show: true,
      titleSize: clamp(d.titleSize, base * 1.5, base * 5, Math.round(base * 2.5)),
      subtitleSize: clamp(d.subtitleSize, base, base * 2.5, Math.round(base * 1.25)),
      authorSize: clamp(d.authorSize, base * 0.8, base * 2, Math.round(base * 1.1)),
    },
    runningHead: {
      ...DEFAULT_LAYOUT_SPEC.runningHead,
      show: d.runningHead === true,
      fontSize: Math.max(6, Math.round(base * 0.72)),
    },
    designerNoteUk: note || 'Макет запропоновано моделлю; пояснення вона не дала.',
  };
}

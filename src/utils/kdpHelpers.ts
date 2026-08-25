import { Book, BookLayoutConfig, CoverConfig } from '../types';
import { estimatePageCount } from './helpers';

export interface KdpTrimSize {
  id: string;
  name: string;
  nameUk: string;
  widthInches: number;
  heightInches: number;
  widthMm: number;
  heightMm: number;
  popularFor: string;
  isStandard: boolean;
}

export const KDP_TRIM_SIZES: KdpTrimSize[] = [
  {
    id: 'kdp-6x9',
    name: '6" x 9" (15.24 x 22.86 cm)',
    nameUk: '6 × 9" (152.4 × 228.6 мм)',
    widthInches: 6.0,
    heightInches: 9.0,
    widthMm: 152.4,
    heightMm: 228.6,
    popularFor: 'Найпопулярніший формат для романів, фентезі, нон-фікшн та бестселерів Amazon',
    isStandard: true,
  },
  {
    id: 'kdp-5.5x8.5',
    name: '5.5" x 8.5" (13.97 x 21.59 cm)',
    nameUk: '5.5 × 8.5" (139.7 × 215.9 мм)',
    widthInches: 5.5,
    heightInches: 8.5,
    widthMm: 139.7,
    heightMm: 215.9,
    popularFor: 'Компактний американський романний формат (Digest)',
    isStandard: true,
  },
  {
    id: 'kdp-5x8',
    name: '5" x 8" (12.7 x 20.32 cm)',
    nameUk: '5 × 8" (127 × 203.2 мм)',
    widthInches: 5.0,
    heightInches: 8.0,
    widthMm: 127.0,
    heightMm: 203.2,
    popularFor: 'Кишенькові видання (Pocket Book / Малий формат)',
    isStandard: true,
  },
  {
    id: 'kdp-5.25x8',
    name: '5.25" x 8" (13.34 x 20.32 cm)',
    nameUk: '5.25 × 8" (133.4 × 203.2 мм)',
    widthInches: 5.25,
    heightInches: 8.0,
    widthMm: 133.35,
    heightMm: 203.2,
    popularFor: 'Художня література середнього формату',
    isStandard: true,
  },
  {
    id: 'kdp-6.14x9.21',
    name: '6.14" x 9.21" (15.6 x 23.39 cm)',
    nameUk: '6.14 × 9.21" (156 × 233.9 мм)',
    widthInches: 6.14,
    heightInches: 9.21,
    widthMm: 155.96,
    heightMm: 233.93,
    popularFor: 'Британський королівський формат (Royal Octavo)',
    isStandard: true,
  },
  {
    id: 'kdp-7x10',
    name: '7" x 10" (17.78 x 25.4 cm)',
    nameUk: '7 × 10" (177.8 × 254.0 мм)',
    widthInches: 7.0,
    heightInches: 10.0,
    widthMm: 177.8,
    heightMm: 254.0,
    popularFor: 'Ілюстровані видання, артбуки, посібники, підручники',
    isStandard: true,
  },
  {
    id: 'kdp-8.5x11',
    name: '8.5" x 11" (21.59 x 27.94 cm)',
    nameUk: '8.5 × 11" (215.9 × 279.4 мм)',
    widthInches: 8.5,
    heightInches: 11.0,
    widthMm: 215.9,
    heightMm: 279.4,
    popularFor: 'Великі робочі зошити, комікси, дитячі ілюстровані книги',
    isStandard: true,
  },
];

/**
 * Amazon KDP Official Gutter (Inside Margin) Requirement based on Page Count
 */
export function getKdpMinimumGutterMm(pageCount: number): { minInches: number; minMm: number; label: string } {
  if (pageCount <= 150) {
    return { minInches: 0.375, minMm: 9.6, label: '24–150 сторінок: мін. 0.375" (9.6 мм)' };
  } else if (pageCount <= 300) {
    return { minInches: 0.500, minMm: 12.7, label: '151–300 сторінок: мін. 0.500" (12.7 мм)' };
  } else if (pageCount <= 500) {
    return { minInches: 0.625, minMm: 15.9, label: '301–500 сторінок: мін. 0.625" (15.9 мм)' };
  } else if (pageCount <= 700) {
    return { minInches: 0.750, minMm: 19.1, label: '501–700 сторінок: мін. 0.750" (19.1 мм)' };
  } else {
    return { minInches: 0.875, minMm: 22.3, label: '701–828 сторінок: мін. 0.875" (22.3 мм)' };
  }
}

/**
 * Amazon KDP Official Minimum Outside / Top / Bottom Margins
 */
export function getKdpMinimumOutsideMarginsMm(hasBleed: boolean): { minInches: number; minMm: number; label: string } {
  if (hasBleed) {
    return { minInches: 0.375, minMm: 9.6, label: 'З вильотом під обріз (Bleed): мін. 0.375" (9.6 мм)' };
  }
  return { minInches: 0.250, minMm: 6.4, label: 'Без вильоту під обріз (No Bleed): мін. 0.250" (6.4 мм)' };
}

/**
 * Amazon KDP Spine Thickness calculation
 * White paper: Page count * 0.002252" (0.0572 mm)
 * Cream paper: Page count * 0.0025" (0.0635 mm)
 */
export function calculateKdpSpineThicknessMm(pageCount: number, paperType: 'white' | 'cream' = 'cream'): number {
  const multiplier = paperType === 'white' ? 0.0572 : 0.0635;
  return Number((pageCount * multiplier).toFixed(2));
}

export interface KdpComplianceIssue {
  id: string;
  category: 'trim' | 'margins' | 'bleed' | 'cover' | 'ebook' | 'front_matter' | 'typography';
  severity: 'error' | 'warning' | 'pass';
  title: string;
  message: string;
  currentValue?: string;
  requiredValue?: string;
  recommendation: string;
  autoFixable: boolean;
}

export interface KdpValidationReport {
  overallScore: number; // 0 - 100
  isReadyForPaperback: boolean;
  isReadyForKindleEbook: boolean;
  estimatedPages: number;
  requiredGutterMm: number;
  calculatedSpineMm: number;
  canHaveSpineText: boolean;
  issues: KdpComplianceIssue[];
}

/**
 * Comprehensive Amazon KDP Compliance Inspector
 */
export function validateKdpCompliance(book: Book, totalWords: number): KdpValidationReport {
  const layout = book.layoutConfig;
  const cover = book.coverConfig;
  const typography = layout.typography;
  const margins = layout.margins;

  const estimatedPages = estimatePageCount(
    totalWords,
    layout.formatPreset,
    typography.fontSizePt,
    typography.lineHeight
  );

  const gutterSpec = getKdpMinimumGutterMm(estimatedPages);
  const hasBleed = (margins.bleedMm || 0) > 0;
  const outsideSpec = getKdpMinimumOutsideMarginsMm(hasBleed);
  const calculatedSpineMm = calculateKdpSpineThicknessMm(estimatedPages, 'cream');
  const canHaveSpineText = estimatedPages >= 79;

  const issues: KdpComplianceIssue[] = [];

  // 1. Trim Size Check
  const matchingTrim = KDP_TRIM_SIZES.find(
    (t) => Math.abs(t.widthMm - layout.pageWidthMm) < 2 && Math.abs(t.heightMm - layout.pageHeightMm) < 2
  );

  if (matchingTrim) {
    issues.push({
      id: 'trim-size-pass',
      category: 'trim',
      severity: 'pass',
      title: 'Обрізний формат сторінки (Trim Size)',
      message: `Вибрано офіційний формат Amazon KDP: ${matchingTrim.nameUk}`,
      currentValue: `${layout.pageWidthMm} × ${layout.pageHeightMm} мм`,
      requiredValue: `${matchingTrim.widthMm} × ${matchingTrim.heightMm} мм`,
      recommendation: 'Формат повністю сумісний з друкарнями Amazon KDP.',
      autoFixable: false,
    });
  } else {
    issues.push({
      id: 'trim-size-warn',
      category: 'trim',
      severity: 'warning',
      title: 'Нестандартний розмір сторінки для KDP',
      message: `Поточний розмір ${layout.pageWidthMm} × ${layout.pageHeightMm} мм не є базовим стандартом KDP.`,
      currentValue: `${layout.pageWidthMm} × ${layout.pageHeightMm} мм`,
      requiredValue: '6" × 9" (152.4 × 228.6 мм) або 5.5" × 8.5"',
      recommendation: 'Рекомендуємо обрати 6" × 9" (найпопулярніший для художніх книг на Amazon).',
      autoFixable: true,
    });
  }

  // 2. Gutter / Inside Margin Check (Корінцеве поле)
  if (margins.insideMm >= gutterSpec.minMm) {
    issues.push({
      id: 'gutter-pass',
      category: 'margins',
      severity: 'pass',
      title: 'Внутрішнє поле під корінець (Gutter Margin)',
      message: `Поле ${margins.insideMm} мм відповідає нормі KDP для обсягу в ~${estimatedPages} сторінок.`,
      currentValue: `${margins.insideMm} мм`,
      requiredValue: `≥ ${gutterSpec.minMm} мм (${gutterSpec.minInches}")`,
      recommendation: 'Текст не заходитиме у згин книги під час склеювання корінця.',
      autoFixable: false,
    });
  } else {
    issues.push({
      id: 'gutter-error',
      category: 'margins',
      severity: 'error',
      title: 'Замале внутрішнє поле (Gutter) під корінець',
      message: `Для книги на ~${estimatedPages} стор. Amazon KDP вимагає корінцеве поле не менше ${gutterSpec.minMm} мм. Поточне: ${margins.insideMm} мм.`,
      currentValue: `${margins.insideMm} мм`,
      requiredValue: `≥ ${gutterSpec.minMm} мм (${gutterSpec.minInches}")`,
      recommendation: `Збільшіть внутрішнє поле до ${gutterSpec.minMm} мм або застосуйте авто-виправлення KDP.`,
      autoFixable: true,
    });
  }

  // 3. Outside, Top, Bottom Margins
  const minOutside = outsideSpec.minMm;
  const outsideOk = margins.outsideMm >= minOutside && margins.topMm >= minOutside && margins.bottomMm >= minOutside;

  if (outsideOk) {
    issues.push({
      id: 'margins-pass',
      category: 'margins',
      severity: 'pass',
      title: 'Зовнішні, верхні та нижні поля (Top/Bottom/Outside)',
      message: `Поля (Верх: ${margins.topMm}мм, Низ: ${margins.bottomMm}мм, Зовнішнє: ${margins.outsideMm}мм) відповідають нормам безпечної зони KDP.`,
      currentValue: `T:${margins.topMm} / B:${margins.bottomMm} / O:${margins.outsideMm} мм`,
      requiredValue: `≥ ${minOutside} мм (${outsideSpec.minInches}")`,
      recommendation: 'Текст захищено від випадкового обрізання ножами типографії.',
      autoFixable: false,
    });
  } else {
    issues.push({
      id: 'margins-error',
      category: 'margins',
      severity: 'error',
      title: 'Поля виходять за безпечну зону обрізу Amazon KDP',
      message: `Amazon KDP вимагає мінімум ${minOutside} мм (${outsideSpec.minInches}") для верхнього, нижнього та зовнішнього полів.`,
      currentValue: `T:${margins.topMm} / B:${margins.bottomMm} / O:${margins.outsideMm} мм`,
      requiredValue: `≥ ${minOutside} мм`,
      recommendation: `Встановіть усі зовнішні поля мінімум ${minOutside} мм.`,
      autoFixable: true,
    });
  }

  // 4. Bleed Requirement Check
  if (hasBleed) {
    if (margins.bleedMm >= 3.2) {
      issues.push({
        id: 'bleed-pass',
        category: 'bleed',
        severity: 'pass',
        title: 'Виліт під обріз (Bleed 0.125" / 3.2 мм)',
        message: `Виліт під обріз налаштовано коректно (${margins.bleedMm} мм).`,
        currentValue: `${margins.bleedMm} мм`,
        requiredValue: '3.2 мм (0.125")',
        recommendation: 'Ілюстрації без білих смуг по краях.',
        autoFixable: false,
      });
    } else {
      issues.push({
        id: 'bleed-warn',
        category: 'bleed',
        severity: 'warning',
        title: 'Нестандартний виліт під обріз (Bleed)',
        message: `Amazon KDP вимагає рівно 0.125" (3.2 мм) вильоту під обріз. Поточне значення: ${margins.bleedMm} мм.`,
        currentValue: `${margins.bleedMm} мм`,
        requiredValue: '3.2 мм (0.125")',
        recommendation: 'Встановіть виліт 3.2 мм для друку графіки на всю сторінку.',
        autoFixable: true,
      });
    }
  } else {
    issues.push({
      id: 'bleed-no-bleed',
      category: 'bleed',
      severity: 'pass',
      title: 'Режим без вильоту (No Bleed Interior)',
      message: 'Для звичайного текстового блоку виліт під обріз не потрібен.',
      recommendation: 'Підходить для стандартних романів без суцільних фонових ілюстрацій.',
      autoFixable: false,
    });
  }

  // 5. Kindle eBook Formatting (First line indent, Typography)
  if (typography.firstLineIndentMm >= 4 && typography.firstLineIndentMm <= 12) {
    issues.push({
      id: 'ebook-indent-pass',
      category: 'ebook',
      severity: 'pass',
      title: 'Абзацний відступ для Kindle (First-Line Indent)',
      message: `Абзацний відступ ${typography.firstLineIndentMm} мм забезпечує чітке розділення думок на екранах Kindle e-reader.`,
      currentValue: `${typography.firstLineIndentMm} мм`,
      requiredValue: '4–10 мм (без подвійних порожніх рядків)',
      recommendation: 'Ідеально відповідає стандарту рефлоу-тексту (Reflowable text).',
      autoFixable: false,
    });
  } else {
    issues.push({
      id: 'ebook-indent-warn',
      category: 'ebook',
      severity: 'warning',
      title: 'Невідповідний абзацний відступ для Kindle',
      message: `Amazon забороняє використання клавіші Tab або порожніх рядків для абзаців. Поточний відступ: ${typography.firstLineIndentMm} мм.`,
      currentValue: `${typography.firstLineIndentMm} мм`,
      requiredValue: '5–8 мм',
      recommendation: 'Встановіть абзацний відступ 6 мм для правильного відображення у додатках Kindle.',
      autoFixable: true,
    });
  }

  // 6. Cover & Spine Specifications
  if (estimatedPages < 79 && cover.coverType === 'paperback') {
    issues.push({
      id: 'spine-text-warn',
      category: 'cover',
      severity: 'warning',
      title: 'Обмеження на текст корінця (< 79 сторінок)',
      message: `У вашій книзі ~${estimatedPages} сторінок. Amazon KDP забороняє розміщувати текст на корінці для видань менше ніж 79 сторінок.`,
      currentValue: `${estimatedPages} стор. (Корінець ${calculatedSpineMm} мм)`,
      requiredValue: '≥ 79 сторінок для тексту на корінці',
      recommendation: 'Залиште корінець однотонним без напису назви або збільшіть обсяг рукопису.',
      autoFixable: false,
    });
  } else {
    issues.push({
      id: 'spine-text-pass',
      category: 'cover',
      severity: 'pass',
      title: 'Товщина корінця для друку (Spine Width)',
      message: `Розрахункова ширина корінця: ${calculatedSpineMm} мм (~${estimatedPages} сторінок). Текст на корінці дозволено.`,
      currentValue: `${calculatedSpineMm} мм`,
      requiredValue: 'Розраховано за формулою KDP',
      recommendation: 'Враховуйте безпечну зону 1.6 мм від країв корінця.',
      autoFixable: false,
    });
  }

  // 7. Front Matter & Table of Contents (TOC)
  const frontMatter = layout.frontMatter;
  if (frontMatter.showTitlePage && frontMatter.showCopyright && frontMatter.showTableOfContents) {
    issues.push({
      id: 'frontmatter-pass',
      category: 'front_matter',
      severity: 'pass',
      title: 'Обовʼязкові службові сторінки (Front Matter & TOC)',
      message: 'Титульна сторінка, авторське право (Copyright) та інтерактивний зміст увімкнені.',
      recommendation: 'Amazon KDP вимагає обовʼязкову наявність Змісту для навігації в Kindle.',
      autoFixable: false,
    });
  } else {
    issues.push({
      id: 'frontmatter-warn',
      category: 'front_matter',
      severity: 'warning',
      title: 'Відсутні обовʼязкові сторінки (Title / Copyright / TOC)',
      message: 'Для публікації на Amazon KDP необхідно включити титульну сторінку, копірайт та зміст (Table of Contents).',
      recommendation: 'Увімкніть автоматичні службові сторінки в налаштуваннях книги.',
      autoFixable: true,
    });
  }

  // Score Calculation
  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warnCount = issues.filter((i) => i.severity === 'warning').length;
  let score = 100 - errorCount * 30 - warnCount * 10;
  if (score < 0) score = 0;

  return {
    overallScore: score,
    isReadyForPaperback: errorCount === 0,
    isReadyForKindleEbook: errorCount === 0 && warnCount <= 1,
    estimatedPages,
    requiredGutterMm: gutterSpec.minMm,
    calculatedSpineMm,
    canHaveSpineText,
    issues,
  };
}

/**
 * 1-Click Amazon KDP Auto-Optimizer
 * Automatically tunes all layout, margins, bleed, typography and front-matter
 * to 100% fulfill Amazon Kindle Direct Publishing standards!
 */
export function applyKdpOptimization(
  book: Book,
  presetId: 'kdp-6x9' | 'kdp-5.5x8.5' | 'kdp-5x8' | 'kdp-7x10' | 'kdp-ebook',
  totalWords: number
): Book {
  const chosenTrim = KDP_TRIM_SIZES.find((t) => t.id === presetId) || KDP_TRIM_SIZES[0];

  const estimatedPages = estimatePageCount(
    totalWords,
    chosenTrim.id === 'kdp-6x9' ? '6x9' : chosenTrim.id === 'kdp-5.5x8.5' ? '5.5x8.5' : '6x9',
    10.5,
    1.45
  );

  const gutterSpec = getKdpMinimumGutterMm(estimatedPages);
  // Add a 1.5mm safety buffer for beautiful reading comfort
  const optimalGutterMm = Math.max(gutterSpec.minMm + 1.5, 14.0);
  const optimalOutsideMm = 12.7; // 0.5 in (comfortably exceeds 0.25 in min)
  const optimalTopMm = 19.0; // 0.75 in
  const optimalBottomMm = 19.0; // 0.75 in

  const updatedLayout: BookLayoutConfig = {
    ...book.layoutConfig,
    formatPreset: (presetId === 'kdp-6x9'
      ? '6x9'
      : presetId === 'kdp-5.5x8.5'
      ? '5.5x8.5'
      : presetId === 'kdp-5x8'
      ? '5x8'
      : presetId === 'kdp-7x10'
      ? '7x10'
      : '6x9') as any,
    pageWidthMm: chosenTrim.widthMm,
    pageHeightMm: chosenTrim.heightMm,
    margins: {
      topMm: optimalTopMm,
      bottomMm: optimalBottomMm,
      insideMm: optimalGutterMm,
      outsideMm: optimalOutsideMm,
      bleedMm: 0, // Text interior standard
      mirrored: true, // Crucial for book spreads!
    },
    typography: {
      ...book.layoutConfig.typography,
      bodyFont: 'Literata',
      headingsFont: 'Outfit',
      fontSizePt: 10.5,
      lineHeight: 1.45,
      firstLineIndentMm: 6.0,
      paragraphSpacingMm: 0,
      textAlign: 'justify',
      pageNumberPosition: 'bottom-right',
      showHeaders: true,
    },
    frontMatter: {
      ...book.layoutConfig.frontMatter,
      showTitlePage: true,
      showCopyright: true,
      showTableOfContents: true,
      copyrightText:
        book.layoutConfig.frontMatter.copyrightText ||
        `© ${new Date().getFullYear()} ${book.author}. Всі права захищено.\nОпубліковано через Amazon Kindle Direct Publishing (KDP).\nЖодна частина цієї книги не може бути відтворена без письмового дозволу автора.`,
    },
  };

  const calculatedSpineMm = calculateKdpSpineThicknessMm(estimatedPages, 'cream');

  const updatedCover: CoverConfig = {
    ...book.coverConfig,
    format: 'paperback',
    coverType: 'paperback',
    spineWidthMm: calculatedSpineMm,
    barcode: book.coverConfig.barcode || '978-617-0000-00-0',
  };

  return {
    ...book,
    status: 'layout',
    layoutConfig: updatedLayout,
    coverConfig: updatedCover,
  };
}

/**
 * Generate technical Amazon KDP metadata specification text
 */
export function generateKdpMetadataReport(book: Book, totalWords: number): string {
  const report = validateKdpCompliance(book, totalWords);
  const layout = book.layoutConfig;
  const cover = book.coverConfig;

  return `===============================================================
AMAZON KINDLE DIRECT PUBLISHING (KDP) - TECHNICAL SPECIFICATION
===============================================================
Book Title: ${book.title} ${book.titleEn ? `(${book.titleEn})` : ''}
Author: ${book.author} ${book.authorEn ? `(${book.authorEn})` : ''}
Genre: ${book.genre || 'Fiction / Novel'}
Generated on: ${new Date().toLocaleDateString('uk-UA')}
Compliance Score: ${report.overallScore}%

1. PRINT (PAPERBACK) SPECIFICATIONS:
---------------------------------------------------------------
- Trim Size (Обрізний розмір): ${layout.pageWidthMm} x ${layout.pageHeightMm} mm (${layout.formatPreset})
- Estimated Page Count (Обсяг): ~${report.estimatedPages} pages (Word count: ${totalWords})
- Gutter / Inside Margin (Корінцеве поле): ${layout.margins.insideMm} mm [Min required: ${report.requiredGutterMm} mm]
- Outside Margin (Зовнішнє поле): ${layout.margins.outsideMm} mm [Min required: 6.4 mm]
- Top Margin (Верхнє поле): ${layout.margins.topMm} mm
- Bottom Margin (Нижнє поле): ${layout.margins.bottomMm} mm
- Bleed (Виліт під обріз): ${layout.margins.bleedMm ? `${layout.margins.bleedMm} mm (0.125")` : '0 mm (No Bleed Interior)'}
- Mirrored Margins: ${layout.margins.mirrored !== false ? 'YES (Enabled)' : 'NO (Disabled)'}

2. COVER & SPINE SPECIFICATIONS:
---------------------------------------------------------------
- Paper Type: White/Cream 50lb - 55lb
- Calculated Spine Width: ${report.calculatedSpineMm} mm (${(report.calculatedSpineMm / 25.4).toFixed(3)} inches)
- Spine Text Allowed: ${report.canHaveSpineText ? 'YES (>= 79 pages)' : 'NO (< 79 pages)'}
- Cover Safety Margin: 3.2 mm (0.125") from all trim edges
- ISBN / Barcode: ${cover.barcode || 'Assigned by Amazon / Custom'}

3. KINDLE EBOOK SPECIFICATIONS:
---------------------------------------------------------------
- Format: Reflowable EPUB / KPF
- Typography Body Font: ${layout.typography.bodyFont} (${layout.typography.fontSizePt}pt)
- First-Line Indent: ${layout.typography.firstLineIndentMm} mm (No manual tab characters)
- Paragraph Line Spacing: ${layout.typography.lineHeight}
- Front Matter:
  * Title Page: ${layout.frontMatter.showTitlePage ? 'YES' : 'NO'}
  * Copyright Page: ${layout.frontMatter.showCopyright ? 'YES' : 'NO'}
  * Table of Contents: ${layout.frontMatter.showTableOfContents ? 'YES' : 'NO'}
  * Dedication: ${layout.frontMatter.showDedication ? 'YES' : 'NO'}

4. VALIDATION AUDIT RESULTS:
---------------------------------------------------------------
${report.issues
  .map(
    (issue, i) =>
      `[${i + 1}] [${issue.severity.toUpperCase()}] ${issue.title}\n    ${issue.message}\n    Recommendation: ${issue.recommendation}`
  )
  .join('\n\n')}

===============================================================
`;
}

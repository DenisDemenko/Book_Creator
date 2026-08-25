/**
 * Друк-до-PDF для окремого інструмента «Форматування готового файлу під
 * Amazon KDP» (src/components/ManuscriptFormatterView.tsx).
 *
 * Навмисно НЕ використовує серверні PDF-бібліотеки — той самий підхід,
 * що й генерація PDF для книг NOVA STUDIO (utils/helpers.ts →
 * generateBookExportHtml): HTML зі сторінковою розміткою `@page` за
 * офіційними полями/обрізним форматом Amazon KDP, а сам PDF-файл створює
 * діалог друку браузера («Зберегти як PDF»). Це узгоджено з рештою
 * експортів застосунку й не потребує жодних додаткових залежностей.
 */
import { KDP_TRIM_SIZES, getKdpMinimumGutterMm, getKdpMinimumOutsideMarginsMm } from './kdpHelpers';
import { calculateWordCount } from './helpers';

export interface FormattedChapter {
  title: string;
  text: string;
}

export interface ManuscriptExportMeta {
  title: string;
  author: string;
  genre?: string;
  copyrightText?: string;
}

/** Наближена кількість слів на сторінку — та сама евристика, що й estimatePageCount у helpers.ts. */
function wordsPerPageForTrim(trimId: string): number {
  if (trimId === 'kdp-5x8' || trimId === 'kdp-5.25x8') return 230;
  if (trimId === 'kdp-7x10' || trimId === 'kdp-8.5x11') return 380;
  return 280; // 6x9, 5.5x8.5, 6.14x9.21 — стандартний художній роман
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Абзаци розділені порожнім рядком → окремі <p>, зайві пробіли по краях прибрано. */
function paragraphsHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

export function generateFormattedManuscriptExportHtml(
  chapters: FormattedChapter[],
  trimId: string,
  meta: ManuscriptExportMeta
): string {
  const trim = KDP_TRIM_SIZES.find((t) => t.id === trimId) || KDP_TRIM_SIZES[0];
  const wordsPerPage = wordsPerPageForTrim(trim.id);

  const chapterWordCounts = chapters.map((c) => calculateWordCount(c.text));
  const totalWords = chapterWordCounts.reduce((a, b) => a + b, 0);
  const estimatedPages = Math.max(1, Math.ceil(totalWords / wordsPerPage));

  const gutterSpec = getKdpMinimumGutterMm(estimatedPages);
  const outsideSpec = getKdpMinimumOutsideMarginsMm(false);
  const insideMm = Math.max(gutterSpec.minMm + 1.5, 14.0);
  const outsideMm = Math.max(outsideSpec.minMm, 12.7);
  const topMm = 19.0;
  const bottomMm = 19.0;

  // Орієнтовна сторінка початку глави — лише для навігації по змісту,
  // не точна верстка (реальна пагінація визначається під час друку).
  let runningPage = 3; // титул + копірайт
  const tocEntries = chapters.map((c, i) => {
    const entry = { title: c.title || `Глава ${i + 1}`, page: runningPage };
    runningPage += Math.max(1, Math.ceil(chapterWordCounts[i] / wordsPerPage));
    return entry;
  });

  const tocHtml = `
    <div class="toc-page" style="page-break-before: always; page-break-after: always; padding: 40px 20px;">
      <h2 style="font-family: 'Outfit', sans-serif; font-size: 20pt; text-align: center; margin-bottom: 24px; border-bottom: 2px solid #0f172a; padding-bottom: 8px;">
        ЗМІСТ
      </h2>
      <div style="font-family: 'Literata', Georgia, serif; font-size: 11pt; line-height: 1.8;">
        ${tocEntries
          .map(
            (e) => `
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px;">
            <span style="font-weight: bold;">${escapeHtml(e.title)}</span>
            <span style="flex: 1; border-bottom: 1px dotted #94a3b8; margin: 0 8px; height: 1em;"></span>
            <span style="font-family: monospace; font-size: 10pt; font-weight: bold; color: #334155;">~${e.page}</span>
          </div>`
          )
          .join('')}
      </div>
      <p style="margin-top: 24px; font-size: 9pt; color: #94a3b8; text-align: center;">
        Номери сторінок орієнтовні — точна пагінація залежить від друку.
      </p>
    </div>
  `;

  const chaptersHtml = chapters
    .map(
      (c, i) => `
      <div class="ms-chapter" style="page-break-before: always; margin-top: 40px;">
        <h2 style="font-family: 'Outfit', sans-serif; font-size: 22pt; color: #0f172a; text-align: center; margin-bottom: 28px; border-bottom: 1px solid #cbd5e1; padding-bottom: 12px;">
          ${escapeHtml(c.title || `Глава ${i + 1}`)}
        </h2>
        <div class="ms-body">
          ${paragraphsHtml(c.text)}
        </div>
      </div>
    `
    )
    .join('');

  return `
<!DOCTYPE html>
<html lang="uk">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(meta.title)} — ${escapeHtml(meta.author)}</title>
  <style>
    @page {
      size: ${trim.widthInches}in ${trim.heightInches}in;
      margin-top: ${topMm}mm;
      margin-bottom: ${bottomMm}mm;
      margin-left: ${insideMm}mm;
      margin-right: ${outsideMm}mm;
    }
    body {
      font-family: 'Literata', Georgia, serif;
      color: #0f172a;
      line-height: 1.45;
      background: white;
      margin: 0;
      padding: 0;
    }
    .title-page {
      page-break-after: always;
      text-align: center;
      padding-top: 100px;
    }
    .copyright-page {
      page-break-after: always;
      font-size: 9pt;
      color: #64748b;
      padding-top: 200px;
      text-align: center;
    }
    .ms-body p {
      text-indent: 6mm;
      text-align: justify;
      margin: 0;
      margin-bottom: 4px;
      font-size: 10.5pt;
    }
  </style>
</head>
<body>
  <div class="title-page">
    <h1 style="font-size: 32pt; margin-bottom: 8px;">${escapeHtml(meta.title)}</h1>
    <h3 style="font-size: 18pt; font-weight: 600; margin-top: 40px;">${escapeHtml(meta.author)}</h3>
    <p style="margin-top: 120px; color: #64748b; font-size: 11pt;">Відформатовано за допомогою ШІ (Claude) — Цифрова Майстерня Письменника NOVA STUDIO</p>
  </div>

  <div class="copyright-page">
    <p>${escapeHtml(meta.copyrightText || `© ${new Date().getFullYear()} ${meta.author}. Всі права захищено.`)}</p>
    ${meta.genre ? `<p style="margin-top: 12px;">Жанр: ${escapeHtml(meta.genre)}</p>` : ''}
    <p style="margin-top: 12px;">Формат: ${trim.nameUk} · ${estimatedPages} стор. (орієнтовно)</p>
  </div>

  ${tocHtml}

  ${chaptersHtml}
</body>
</html>
  `;
}

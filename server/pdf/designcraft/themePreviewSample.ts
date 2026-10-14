export const THEME_PREVIEW_CHAR_BUDGET = 16_000;
export const THEME_PREVIEW_MAX_CHAPTERS = 2;

interface PreviewSection extends Record<string, unknown> {
  id?: string;
  content?: string;
}

interface PreviewChapter extends Record<string, unknown> {
  id?: string;
  sections?: PreviewSection[];
}

interface PreviewIllustration extends Record<string, unknown> {
  chapterId?: string;
  sectionId?: string;
}

export interface DesigncraftThemePreviewSample {
  book: Record<string, unknown>;
  sourceChars: number;
  chapterCount: number;
  sectionCount: number;
  chapterIds: string[];
  sectionIds: string[];
}

function meaningfulChars(section: PreviewSection): number {
  return String(section?.content || '').trim().length;
}

/**
 * Deterministic manuscript slice for the theme gallery.
 *
 * We deliberately keep complete sections: cutting a section in the middle
 * would make different theme previews compare different prose boundaries and
 * can also break image/semantic markers. The budget is therefore a target,
 * not a hard substring limit; the section that crosses it is retained whole.
 */
export function buildDesigncraftThemePreviewSample(
  source: Record<string, unknown>,
  options: { charBudget?: number; maxChapters?: number } = {}
): DesigncraftThemePreviewSample {
  const charBudget = Math.max(1_000, Number(options.charBudget) || THEME_PREVIEW_CHAR_BUDGET);
  const maxChapters = Math.max(1, Math.min(4, Math.round(Number(options.maxChapters) || THEME_PREVIEW_MAX_CHAPTERS)));
  const chapters = Array.isArray(source.chapters) ? (source.chapters as PreviewChapter[]) : [];

  const selectedChapters: PreviewChapter[] = [];
  const chapterIds = new Set<string>();
  const sectionIds = new Set<string>();
  let sourceChars = 0;
  let sectionCount = 0;

  for (const chapter of chapters) {
    if (selectedChapters.length >= maxChapters) break;
    const sections = Array.isArray(chapter?.sections) ? chapter.sections : [];
    const selectedSections: PreviewSection[] = [];

    for (const section of sections) {
      const chars = meaningfulChars(section);
      if (chars <= 0) continue;
      if (sourceChars >= charBudget && sectionCount > 0) break;

      selectedSections.push({ ...section });
      sourceChars += chars;
      sectionCount += 1;
      if (section.id) sectionIds.add(String(section.id));
    }

    if (selectedSections.length > 0) {
      selectedChapters.push({ ...chapter, sections: selectedSections });
      if (chapter.id) chapterIds.add(String(chapter.id));
    }

    if (sourceChars >= charBudget && sectionCount > 0) break;
  }

  const illustrations = Array.isArray(source.illustrations)
    ? (source.illustrations as PreviewIllustration[]).filter((illustration) => {
        const chapterId = illustration?.chapterId ? String(illustration.chapterId) : '';
        const sectionId = illustration?.sectionId ? String(illustration.sectionId) : '';
        if (!chapterId && !sectionId) return true;
        if (sectionId) return sectionIds.has(sectionId);
        return chapterIds.has(chapterId);
      })
    : undefined;

  return {
    book: {
      ...source,
      chapters: selectedChapters,
      ...(illustrations ? { illustrations } : {}),
    },
    sourceChars,
    chapterCount: selectedChapters.length,
    sectionCount,
    chapterIds: [...chapterIds],
    sectionIds: [...sectionIds],
  };
}

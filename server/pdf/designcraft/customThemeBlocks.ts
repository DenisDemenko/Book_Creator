import type { Book } from '../../../src/types';
import type { CustomBookDesignTheme } from '../../../src/data/customBookDesignTheme';
import { resolveRenderableBookDesignBlocks, type RenderableDesignerBlock } from '../../../src/data/bookDesignRenderableBlocks';
import type { PdfBookInput } from '../pdfTypes';
import type { SemanticParagraphStyle } from './themes';

const PAGE_BREAK = '\uE004';
const MAX_BLOCK_CHARS = 4_000;
const MAX_BLOCKS = 120;

function clean(value: unknown): string {
  return String(value ?? '')
    .replace(/\uE004/g, '')
    .replace(/\[\/?STYLE[^\]]*\]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function semanticStyle(block: RenderableDesignerBlock): SemanticParagraphStyle {
  if (block.source === 'conflict') return 'Evidence';
  if (block.source === 'scene') return 'LocationTime';
  return 'KeyIdea';
}

function marker(style: SemanticParagraphStyle, text: string): string {
  return `[STYLE:${style}]${clean(text)}[/STYLE]`;
}

function blockText(block: RenderableDesignerBlock): string {
  const style = semanticStyle(block);
  const lines = [
    marker(style, `${block.blockName}: ${block.sourceLabel}`),
    ...Object.entries(block.fields)
      .filter(([, value]) => clean(value))
      .map(([key, value]) => marker(style, `${key}: ${clean(value)}`)),
  ];
  return lines.join('\n\n').slice(0, MAX_BLOCK_CHARS);
}

function applyRepeat(blocks: readonly RenderableDesignerBlock[]): RenderableDesignerBlock[] {
  const once = new Set<string>();
  const out: RenderableDesignerBlock[] = [];
  for (const block of blocks) {
    if (out.length >= MAX_BLOCKS) break;
    if (block.repeat === 'once') {
      if (once.has(block.blockId)) continue;
      once.add(block.blockId);
    }
    out.push(block);
  }
  return out;
}

function append(content: string, text: string): string {
  return [content, text].filter(Boolean).join('\n\n');
}

function prepend(content: string, text: string): string {
  return [text, content].filter(Boolean).join('\n\n');
}

/**
 * Materialize custom Character / Scene / Conflict blocks into the renderer
 * copy of the manuscript. The Book object itself is never mutated.
 *
 * DesignCraft currently has one threaded story, so `full-width` is already
 * the full text column. `full-page` additionally inserts real DesignCraft page
 * break characters around the block. Unsupported/locality-missing placements
 * fall back to the appendix instead of silently dropping author data.
 */
export function applyCustomThemeBlocksToPdfInput(
  input: PdfBookInput,
  sourceBook: Book,
  theme: CustomBookDesignTheme
): { input: PdfBookInput; applied: number; appendix: number } {
  const blocks = applyRepeat(resolveRenderableBookDesignBlocks(sourceBook, theme));
  if (!blocks.length) return { input, applied: 0, appendix: 0 };

  const chapters = input.chapters.map((chapter) => ({
    ...chapter,
    sections: chapter.sections.map((section) => ({ ...section })),
  }));

  const sectionTargets = new Map<string, { chapterIndex: number; sectionIndex: number }>();
  const chapterTargets = new Map<string, number>();
  chapters.forEach((chapter, chapterIndex) => {
    if (chapter.id) chapterTargets.set(chapter.id, chapterIndex);
    chapter.sections.forEach((section, sectionIndex) => {
      if (section.id) sectionTargets.set(section.id, { chapterIndex, sectionIndex });
    });
  });

  const appendixBlocks: RenderableDesignerBlock[] = [];
  let applied = 0;

  for (const block of blocks) {
    const text = blockText(block);
    if (!text) continue;

    if (block.placement === 'appendix') {
      appendixBlocks.push(block);
      continue;
    }

    if (block.placement === 'chapter-opening' && block.chapterId) {
      const chapterIndex = chapterTargets.get(block.chapterId);
      const section = chapterIndex === undefined ? undefined : chapters[chapterIndex]?.sections?.[0];
      if (section) {
        section.content = prepend(section.content || '', text);
        applied += 1;
        continue;
      }
    }

    if (block.sectionId) {
      const target = sectionTargets.get(block.sectionId);
      const section = target ? chapters[target.chapterIndex]?.sections?.[target.sectionIndex] : undefined;
      if (section) {
        if (block.placement === 'scene-opening') {
          section.content = prepend(section.content || '', text);
        } else if (block.placement === 'full-page') {
          section.content = prepend(section.content || '', `${PAGE_BREAK}\n\n${text}\n\n${PAGE_BREAK}`);
        } else {
          // `inline` currently means after the section manuscript; exact cursor
          // anchors will be added when the editor stores block anchor ids.
          // `full-width` is equivalent in today's single-column DesignCraft story.
          section.content = append(section.content || '', text);
        }
        applied += 1;
        continue;
      }
    }

    // A character card, for example, has no section unless a future anchor is
    // stored. Keep it visible and deterministic by moving it to the appendix.
    appendixBlocks.push(block);
  }

  if (appendixBlocks.length) {
    chapters.push({
      id: 'book-design-appendix',
      title: 'Додаток',
      sections: appendixBlocks.map((block, index) => ({
        id: `book-design-block-${index + 1}`,
        title: block.blockName,
        content: blockText(block),
      })),
    });
  }

  return {
    input: { ...input, chapters },
    applied: applied + appendixBlocks.length,
    appendix: appendixBlocks.length,
  };
}

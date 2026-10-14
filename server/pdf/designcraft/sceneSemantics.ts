import type { Book, Scene } from '../../../src/types';
import type { PdfBookInput } from '../pdfTypes';
import { getBookDesignTheme, type BookDesignThemeId, type SemanticParagraphStyle } from './themes';

type PdfSection = PdfBookInput['chapters'][number]['sections'][number];

function clean(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function styleMarker(style: SemanticParagraphStyle, text: string): string {
  return `[STYLE:${style}]${text}[/STYLE]`;
}

function scenePrefix(scene: Scene, themeId: BookDesignThemeId): string[] {
  const theme = getBookDesignTheme(themeId);
  if (!theme) return [];

  const out: string[] = [];
  const locationTime: string[] = [];

  if (theme.chapterOpening.showLocation && clean(scene.location)) {
    locationTime.push(clean(scene.location));
  }
  if (theme.chapterOpening.showTime && clean(scene.timeOfDay)) {
    locationTime.push(clean(scene.timeOfDay));
  }

  // Location/time is emitted only when the theme explicitly owns this
  // semantic style. Themes that do not opt in remain byte-for-byte neutral.
  if (locationTime.length && theme.semanticStyles.LocationTime?.enabled) {
    out.push(styleMarker('LocationTime', locationTime.join(' · ')));
  }

  // Thriller/noir themes already expose Evidence as a boxed service block.
  // Reuse that proven DesignCraft style for scene conflict until the dedicated
  // ConflictCard object style lands in the next slice. No theme opt-in means
  // no extra paragraph is inserted.
  if (clean(scene.conflict) && theme.semanticStyles.Evidence?.enabled) {
    out.push(styleMarker('Evidence', `Конфлікт: ${clean(scene.conflict)}`));
  }

  return out;
}

/**
 * Add renderer-only semantic paragraphs from the real scene model.
 *
 * The manuscript in Book stays untouched. We decorate a clone of PdfBookInput
 * only for DesignCraft preview, using chapter/section position as the stable
 * bridge because PdfBookInput intentionally does not expose the full Scene.
 */
export function injectDesigncraftSceneSemantics(
  input: PdfBookInput,
  sourceBook: Book,
  themeId: BookDesignThemeId
): PdfBookInput {
  const sceneBySectionId = new Map<string, Scene>();
  const sceneByPosition = new Map<string, Scene>();

  (sourceBook.chapters || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((chapter, chapterIndex) => {
      (chapter.sections || [])
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .forEach((section, sectionIndex) => {
          if (!section.scene) return;
          if (section.id) sceneBySectionId.set(section.id, section.scene);
          sceneByPosition.set(`${chapterIndex}:${sectionIndex}`, section.scene);
        });
    });

  return {
    ...input,
    chapters: input.chapters.map((chapter, chapterIndex) => ({
      ...chapter,
      sections: chapter.sections.map((section: PdfSection & { id?: string }, sectionIndex) => {
        const scene = (section.id && sceneBySectionId.get(section.id)) || sceneByPosition.get(`${chapterIndex}:${sectionIndex}`);
        if (!scene) return { ...section };

        const prefix = scenePrefix(scene, themeId);
        if (!prefix.length) return { ...section };

        return {
          ...section,
          content: [...prefix, section.content || ''].filter(Boolean).join('\n\n'),
        };
      }),
    })),
  };
}

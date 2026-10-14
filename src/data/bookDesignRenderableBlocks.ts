import type { Book } from '../types';
import type { CustomBookDesignTheme, DesignerCustomBlock } from './customBookDesignTheme';
import { resolveBookDesignEntityBlocks, type ResolvedDesignerBlock } from './bookDesignEntityAdapter';
import {
  placementOf,
  type DesignerBlockPlacement,
  type DesignerBlockRepeat,
} from './bookDesignPlacement';

export interface RenderableDesignerBlock extends ResolvedDesignerBlock {
  placement: DesignerBlockPlacement;
  repeat: DesignerBlockRepeat;
}

type PlacementBlock = DesignerCustomBlock & {
  placement?: DesignerBlockPlacement;
  repeat?: DesignerBlockRepeat;
};

function definitionById(theme: CustomBookDesignTheme): Map<string, PlacementBlock> {
  return new Map((theme.customBlocks || []).map((block) => [block.id, block as PlacementBlock]));
}

/**
 * Renderer-facing semantic block list.
 *
 * The older entity adapter intentionally stays renderer-neutral. This layer
 * adds deterministic placement/repetition and removes the one ambiguity that
 * would otherwise be visible in a PDF: a scene-level conflict must not be
 * repeated once for every participant when none of them has an individual
 * conflict. Participant conflicts remain separate because they are genuinely
 * distinct semantic facts.
 */
export function resolveRenderableBookDesignBlocks(
  book: Book,
  theme: CustomBookDesignTheme
): RenderableDesignerBlock[] {
  const definitions = definitionById(theme);
  const raw = resolveBookDesignEntityBlocks(book, theme);
  const seenSceneConflicts = new Set<string>();
  const out: RenderableDesignerBlock[] = [];

  for (const block of raw) {
    if (block.source === 'conflict') {
      const conflictText = block.fields.conflict || '';
      const hasCharacter = Boolean(block.fields.character);
      if (!hasCharacter && block.sectionId) {
        const key = `${block.blockId}:${block.sectionId}:${conflictText}`;
        if (seenSceneConflicts.has(key)) continue;
        seenSceneConflicts.add(key);
      }
    }

    const definition = definitions.get(block.blockId);
    const placement = placementOf(definition, block.source);
    out.push({ ...block, ...placement });
  }

  return out;
}

export function groupRenderableBlocksByPlacement(
  blocks: readonly RenderableDesignerBlock[]
): Record<DesignerBlockPlacement, RenderableDesignerBlock[]> {
  const grouped: Record<DesignerBlockPlacement, RenderableDesignerBlock[]> = {
    inline: [],
    'scene-opening': [],
    'chapter-opening': [],
    'full-width': [],
    'full-page': [],
    appendix: [],
  };
  for (const block of blocks) grouped[block.placement].push(block);
  return grouped;
}

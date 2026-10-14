import type { Book, Scene } from '../types';
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

function scenesById(book: Book): Map<string, Scene> {
  const result = new Map<string, Scene>();
  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) {
      if (section.scene) result.set(section.scene.id, section.scene);
    }
  }
  return result;
}

function sceneConflictFallback(block: ResolvedDesignerBlock, scene: Scene): ResolvedDesignerBlock {
  const fields = { ...block.fields };
  delete fields.character;
  delete fields.goal;
  const sceneConflict = String(scene.conflict || fields.conflict || '').trim();
  fields.conflict = sceneConflict;
  const label = `${String(scene.title || 'Сцена').trim() || 'Сцена'} — конфлікт`;
  return {
    ...block,
    id: `${block.blockId}:${scene.id}:scene`,
    sourceId: `${scene.id}:scene`,
    sourceLabel: label,
    characterId: undefined,
    sceneId: scene.id,
    conflictKey: `${scene.id}:scene:${sceneConflict}`,
    fields,
    fallbackText: [label, ...Object.entries(fields).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`)].join('\n'),
  };
}

/**
 * Renderer-facing semantic block list.
 *
 * The older entity adapter intentionally stays renderer-neutral. This layer
 * adds deterministic placement/repetition and resolves conflict scope. A
 * scene-level conflict is emitted once when participants have no individual
 * conflict; participant conflicts remain separate because they are distinct
 * semantic facts.
 */
export function resolveRenderableBookDesignBlocks(
  book: Book,
  theme: CustomBookDesignTheme
): RenderableDesignerBlock[] {
  const definitions = definitionById(theme);
  const scenes = scenesById(book);
  const raw = resolveBookDesignEntityBlocks(book, theme);
  const emittedSceneConflict = new Set<string>();
  const out: RenderableDesignerBlock[] = [];

  for (const original of raw) {
    let block = original;

    if (block.source === 'conflict') {
      const scene = block.sceneId ? scenes.get(block.sceneId) : undefined;
      const participation = scene?.characters?.find((item) => item.characterId === block.characterId);
      const participantConflict = String(participation?.conflict || '').trim();
      const sceneConflict = String(scene?.conflict || '').trim();

      if (scene && !participantConflict && sceneConflict) {
        const key = `${block.blockId}:${scene.id}:${sceneConflict}`;
        if (emittedSceneConflict.has(key)) continue;
        emittedSceneConflict.add(key);
        block = sceneConflictFallback(block, scene);
      }
    }

    const definition = definitions.get(block.blockId);
    const placement = placementOf(definition, block.source);
    out.push({ ...block, ...placement });
  }

  return out;
}

function repeatScopeKey(block: RenderableDesignerBlock): string | null {
  switch (block.repeat) {
    case 'once':
      return `${block.blockId}:once`;
    case 'per-character':
      return block.characterId ? `${block.blockId}:character:${block.characterId}` : `${block.blockId}:fallback:${block.id}`;
    case 'per-scene':
      return block.sceneId ? `${block.blockId}:scene:${block.sceneId}` : `${block.blockId}:fallback:${block.id}`;
    case 'per-conflict':
      return block.conflictKey ? `${block.blockId}:conflict:${block.conflictKey}` : `${block.blockId}:fallback:${block.id}`;
    case 'matched':
    default:
      return null;
  }
}

/**
 * Enforce the repeat contract independently from physical placement.
 * `matched` preserves every resolved match. Scoped repeat modes collapse only
 * when the corresponding stable semantic id is known, avoiding accidental
 * data loss for future source types.
 */
export function applyDesignerBlockRepeatPolicy(
  blocks: readonly RenderableDesignerBlock[]
): RenderableDesignerBlock[] {
  const seen = new Set<string>();
  const out: RenderableDesignerBlock[] = [];

  for (const block of blocks) {
    const key = repeatScopeKey(block);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    out.push(block);
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

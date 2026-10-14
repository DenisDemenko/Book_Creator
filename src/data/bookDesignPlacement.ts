import type {
  DesignerBlockPlacement,
  DesignerBlockRepeat,
  DesignerCustomBlock,
  DesignerSemanticSource,
} from './customBookDesignTheme';

export type { DesignerBlockPlacement, DesignerBlockRepeat } from './customBookDesignTheme';

export interface DesignerPlacementOptions {
  placement: DesignerBlockPlacement;
  repeat: DesignerBlockRepeat;
}

const PLACEMENTS: readonly DesignerBlockPlacement[] = [
  'inline',
  'scene-opening',
  'chapter-opening',
  'full-width',
  'full-page',
  'appendix',
];

const REPEATS: readonly DesignerBlockRepeat[] = [
  'once',
  'per-character',
  'per-scene',
  'per-conflict',
  'matched',
];

function isPlacement(value: unknown): value is DesignerBlockPlacement {
  return typeof value === 'string' && (PLACEMENTS as readonly string[]).includes(value);
}

function isRepeat(value: unknown): value is DesignerBlockRepeat {
  return typeof value === 'string' && (REPEATS as readonly string[]).includes(value);
}

export function defaultPlacementFor(source: DesignerSemanticSource): DesignerBlockPlacement {
  if (source === 'scene' || source === 'conflict') return 'scene-opening';
  if (source === 'character') return 'appendix';
  return 'inline';
}

export function defaultRepeatFor(source: DesignerSemanticSource): DesignerBlockRepeat {
  if (source === 'character') return 'per-character';
  if (source === 'scene') return 'per-scene';
  if (source === 'conflict') return 'per-conflict';
  return 'matched';
}

/**
 * Backward-compatible reader for v2 themes created before placement fields
 * existed. Unknown values never reach a renderer; they fall back to a safe,
 * deterministic placement derived from the semantic source.
 */
export function placementOf(block: DesignerCustomBlock | undefined, source: DesignerSemanticSource): DesignerPlacementOptions {
  return {
    placement: isPlacement(block?.placement) ? block.placement : defaultPlacementFor(source),
    repeat: isRepeat(block?.repeat) ? block.repeat : defaultRepeatFor(source),
  };
}

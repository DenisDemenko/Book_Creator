import type { HeroArcState } from '../types';

export interface HeroArcAnalysisPoint {
  beatIndex: number;
  jevValue: number;
  authorOverride?: number;
  confidence?: number;
  dominantEmotion?: string;
  explanation?: string;
}

export interface HeroArcAnalysis {
  source: 'jev';
  status: 'pending' | 'fresh' | 'stale' | 'error';
  analyzedAt?: string;
  snapshotRevision?: number;
  heroId?: string;
  model?: string;
  points: HeroArcAnalysisPoint[];
}

export type HeroArcStateWithAnalysis = HeroArcState & {
  /** Stable CharacterID selected by the author. Never inferred from cast order. */
  selectedHeroId?: string;
  analysis?: HeroArcAnalysis;
};

export function displayHeroArcIntensities(state: HeroArcStateWithAnalysis): number[] {
  const byBeat = new Map(state.analysis?.points.map((point) => [point.beatIndex, point] as const) ?? []);
  return state.intensities.map((fallback, beatIndex) => {
    const point = byBeat.get(beatIndex);
    if (!point) return fallback;
    if (typeof point.authorOverride === 'number') return point.authorOverride;
    return typeof point.jevValue === 'number' ? point.jevValue : fallback;
  });
}

export function applyHeroArcOverride(
  state: HeroArcStateWithAnalysis,
  beatIndex: number,
  value: number,
): HeroArcStateWithAnalysis {
  const clamped = Math.max(-10, Math.min(10, Math.round(value)));
  const intensities = state.intensities.slice();
  intensities[beatIndex] = clamped;

  if (!state.analysis) return { ...state, intensities };

  const exists = state.analysis.points.some((point) => point.beatIndex === beatIndex);
  const points = exists
    ? state.analysis.points.map((point) =>
        point.beatIndex === beatIndex ? { ...point, authorOverride: clamped } : { ...point }
      )
    : [...state.analysis.points.map((point) => ({ ...point })), { beatIndex, jevValue: clamped, authorOverride: clamped }];

  return {
    ...state,
    intensities,
    analysis: { ...state.analysis, points },
  };
}

export function clearHeroArcOverride(
  state: HeroArcStateWithAnalysis,
  beatIndex: number,
): HeroArcStateWithAnalysis {
  if (!state.analysis) return state;
  const points = state.analysis.points.map((point) => {
    if (point.beatIndex !== beatIndex) return { ...point };
    const { authorOverride: _discarded, ...rest } = point;
    return rest;
  });
  const jevPoint = points.find((point) => point.beatIndex === beatIndex);
  const intensities = state.intensities.slice();
  if (jevPoint) intensities[beatIndex] = jevPoint.jevValue;
  return { ...state, intensities, analysis: { ...state.analysis, points } };
}

export function markHeroArcAnalysisStale(
  state: HeroArcStateWithAnalysis | undefined,
): HeroArcStateWithAnalysis | undefined {
  if (!state?.analysis || state.analysis.status === 'stale') return state;
  return { ...state, analysis: { ...state.analysis, status: 'stale' } };
}

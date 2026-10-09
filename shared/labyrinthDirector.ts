import type { LabyrinthDirectorConfig } from "./labyrinth";
export const DIRECTOR_DEFAULTS: LabyrinthDirectorConfig = {
  enabled: false,
  targetTension: 55,
  criticalHealthRatio: 0.25,
  confidenceThreshold: 0.75,
  minModelConfidence: 0.6,
  noulThreshold: 0.7,
  cooldown: 2,
  maxModelCalls: 0,
  timeoutMs: 3000,
  maxCandidates: 8,
};

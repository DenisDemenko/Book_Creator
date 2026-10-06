import type {BookToolHandler} from '../types';
export const getSceneContext:BookToolHandler=async s=>({scene_id:s.scope.sceneId,simulation_id:s.scope.simulationId,as_of_chapter:s.simulation.asOfChapter,situation:s.deps.situation,observed:await s.observed()});

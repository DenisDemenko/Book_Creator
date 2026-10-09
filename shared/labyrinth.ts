/** T9.1: declarative world data, immutable versions and isolated playthroughs.
 * References reuse Core scene/entity ids. No permissions, AI execution or canon writes. */
export type LabyrinthLevel = "lower" | "upper";
export interface LabyrinthNode {
  id: string;
  title: string;
  level: LabyrinthLevel;
  x: number;
  y: number;
  sceneId: string | null;
  description: string;
  cover: boolean;
}
export interface ObjectCondition {
  objectId: string;
  state: string;
}
export interface ObjectEffect extends ObjectCondition {}
export interface LabyrinthEdge {
  id: string;
  from: string;
  to: string;
  kind: "corridor" | "bridge" | "stairs" | "ladder" | "lift";
  bidirectional: boolean;
  duration: number;
  costs: Record<string, number>;
  conditions: ObjectCondition[];
  overNodeIds: string[];
}
export interface LabyrinthObject {
  id: string;
  nodeId: string;
  entityId: string | null;
  kind:
    | "door"
    | "gate"
    | "switch"
    | "generator"
    | "barrier"
    | "cache"
    | "bridge_mechanism";
  states: string[];
  initialState: string;
  transitions: Array<{
    from: string;
    to: string;
    conditions: ObjectCondition[];
    effects: ObjectEffect[];
  }>;
}
export interface LabyrinthHero {
  id: string;
  entityId: string | null;
  name: string;
  startNodeId: string;
  resources: Record<string, number>;
  inventory: string[];
  goals: string[];
  fears: string[];
  knowledge: string[];
}
export interface LabyrinthEventTemplate {
  id: string;
  nodeIds: string[];
  conditions: ObjectCondition[];
  warning: string;
  preparation: number;
  duration: number;
  cooldown: number;
  effects: ObjectEffect[];
  avoidance: string;
}
export interface LabyrinthDefinition {
  schemaVersion: 1;
  title: string;
  startNodeId: string;
  exitNodeIds: string[];
  nodes: LabyrinthNode[];
  edges: LabyrinthEdge[];
  objects: LabyrinthObject[];
  heroes: LabyrinthHero[];
  events: LabyrinthEventTemplate[];
}
export interface LabyrinthVersion {
  mapId: string;
  projectId: string;
  revision: number;
  bookRevision: number;
  definition: LabyrinthDefinition;
  hash: string;
  createdBy: string;
  createdAt: string;
}
export interface LabyrinthRunState {
  turn: number;
  storyTime: number;
  heroes: Record<
    string,
    {
      nodeId: string;
      resources: Record<string, number>;
      inventory: string[];
      knowledge: string[];
    }
  >;
  objects: Record<string, string>;
}
export interface LabyrinthRun {
  id: string;
  projectId: string;
  mapId: string;
  mapRevision: number;
  seed: string;
  difficulty: "author_preview";
  participants: Array<{ userId: string; heroIds: string[] }>;
  revision: number;
  state: LabyrinthRunState;
  createdBy: string;
  createdAt: string;
}
export type StructuralAction =
  | { kind: "move"; heroId: string; edgeId: string }
  | { kind: "interact"; heroId: string; objectId: string; to: string };
export interface LabyrinthRunEvent {
  revision: number;
  actor: string;
  action: StructuralAction;
  reason: string;
  mapRevision: number;
  beforeHash: string;
  afterHash: string;
  state: LabyrinthRunState;
  createdAt: string;
}

import type { Heading, RouteChoice } from "./labyrinthNarration";
import type { LabyrinthLevel } from "./labyrinth";

/** Deliberate allowlist: never serialize a definition, run state or director trace. */
export type ReaderAction =
  | { kind: "move"; edgeId: string }
  | { kind: "interact"; objectId: string; to: string }
  | { kind: "wait" };
export interface ReaderScene {
  title: string;
  paragraphs: Array<{ kind: "paragraph" | "heading" | "blockquote"; text: string }>;
}
export interface ReaderEdition {
  mapId: string;
  publicationRevision: number;
  mapRevision: number;
  bookRevision: number;
  title: string;
  heroes: Array<{ id: string; name: string }>;
}
export interface ReaderSessionSummary {
  id: string;
  mapId: string;
  title: string;
  heroName: string;
  mapRevision: number;
  revision: number;
  turn: number;
  storyTime: number;
  createdAt: string;
}
export interface ReaderView {
  id: string;
  revision: number;
  mapRevision: number;
  bookRevision: number;
  title: string;
  turn: number;
  storyTime: number;
  completed: boolean;
  hero: { name: string; resources: Record<string, number>; inventory: string[]; knowledge: string[] };
  scene: ReaderScene;
  description: string;
  heading: Heading;
  choices: RouteChoice[];
  interactions: Array<{ objectId: string; to: string; label: string; available: boolean }>;
  warnings: Array<{ phase: "warning" | "active"; text: string; avoidance: string }>;
  map: {
    nodes: Array<{ id: string; title: string; level: LabyrinthLevel; x: number; y: number; visited: boolean; current: boolean }>;
    edges: Array<{ id: string; from: string; to: string; kind: string }>;
    currentNodeId: string;
  };
  checkpoints: Array<{ revision: number; turn: number; storyTime: number; label: string }>;
}
export interface ReaderPublication {
  revision: number;
  active: boolean;
  mapRevision: number | null;
  heroIds: string[];
  bookRevision: number | null;
}

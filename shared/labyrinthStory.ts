/** T9.8: author-only, sourced draft. Publication and final authorship belong to T9.9. */
export interface StorySource {
  id: string;
  runId: string;
  revision: number;
  mapRevision: number;
  bookRevision: number;
  storyTime: number;
  nodeId: string | null;
  heroId: string | null;
  sceneId: string | null;
  contributionId: string | null;
  hash: string;
}
export interface StoryBlock {
  id: string;
  kind: "fact" | "scene" | "contribution" | "ending";
  title: string;
  text: string;
  source: StorySource;
  aiAssisted: boolean;
  proposal: string | null;
  proposalOrigin: "ai" | "author" | null;
}
export interface StoryDraft {
  id: string;
  revision: number;
  status: "draft" | "accepted" | "rejected";
  title: string;
  runId: string;
  mapId: string;
  mapRevision: number;
  bookRevision: number;
  sourceRevision: number;
  sourceHash: string;
  blocks: StoryBlock[];
  newBookId: string | null;
  ai: null | { modelId: string; generatedAt: string; inputTokens: number; outputTokens: number; costUsd: number };
  createdAt: string;
  generationPending: boolean;
  legalAuthorship: false;
  publicationReady: false;
}
export interface StoryRunSummary {
  id: string;
  revision: number;
  kind: "solo" | "group";
  createdAt: string;
}
export interface StoryDraftSummary {
  id: string;
  title: string;
  revision: number;
  status: StoryDraft["status"];
  runId: string;
  newBookId: string | null;
}

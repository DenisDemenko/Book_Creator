import type { StyleRules } from "./creativeBible";
export const CREATIVE_AI_ACTIONS = [
  "creative:image:generate",
  "creative:image:edit",
  "creative:video:generate",
  "creative:video:edit",
] as const;
export type CreativeAiAction = (typeof CREATIVE_AI_ACTIONS)[number];
export interface CreativeAiJob {
  id: string;
  projectId: string;
  userId: string;
  operation: CreativeAiAction;
  status: "RUNNING" | "COMPLETED" | "FAILED";
  createdAt: string;
  finishedAt: string | null;
  assetId: string | null;
  error: string | null;
}
export interface CreativeAiContext {
  schema: 1;
  style: {
    id: string;
    version: number;
    rules: StyleRules;
    override: StyleRules | null;
  } | null;
  entities: { id: string; type: string; name: string }[];
  references: {
    entryId: string;
    entityId: string | null;
    rules: unknown;
    assetId: string;
    assetVersion: number;
  }[];
}
export interface CreativeAiModel {
  id: string;
  label: string;
  kind: "image" | "video";
  provider: string;
  available: boolean;
  maxReferences: number;
  edit: boolean;
  aspectRatios: string[];
  sizes: string[];
  durations: number[];
}

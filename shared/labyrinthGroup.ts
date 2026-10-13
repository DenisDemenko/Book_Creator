import type { ReaderAction, ReaderView } from "./labyrinthReader";
export const GROUP_TERMS = "labyrinth-contribution-v1";
export interface GroupBinding { heroId: string; userId: string | null; alias: string }
export interface JointAction {
  id: string; label: string; objectId: string; to: string;
  supports: Array<{ heroId: string; nodeId: string }>;
}
export interface GroupRules {
  order: string[];
  decision: "unanimous" | "majority";
  timeoutSeconds: number;
  absence: "pause" | "skip";
  jointActions: JointAction[];
}
export interface GroupDecision {
  id: string; kind: "action" | "restore"; actorHeroId: string;
  action?: ReaderAction; sourceRevision?: number;
  voters: string[]; votes: Record<string, boolean>; stateHash: string;
}
export type GroupCommand =
  | { kind: "join"; alias: string; candidate: boolean; terms: string }
  | { kind: "launch" }
  | { kind: "action"; action: ReaderAction }
  | { kind: "pass" }
  | { kind: "advance_absent" }
  | { kind: "advance_flc" }
  | { kind: "leave" }
  | { kind: "propose_action"; jointId: string }
  | { kind: "propose_restore"; sourceRevision: number }
  | { kind: "vote"; decisionId: string; approve: boolean }
  | { kind: "message"; channel: "player_chat" | "hero_dialogue"; text: string }
  | { kind: "contribute"; text: string; include: boolean; aiAssisted: boolean; terms: string }
  | { kind: "withdraw_contribution"; contributionId: string };
export interface GroupSummary {
  id: string; title: string; alias: string; status: "lobby" | "playing" | "finished";
  revision: number; invited: boolean; createdAt: string;
}
export interface GroupView extends ReaderView {
  group: {
    status: GroupSummary["status"]; joined: boolean; canLaunch: boolean; myTurn: boolean;
    candidate: boolean; terms: string; deadline: string | null;
    members: Array<{ heroId: string; heroName: string; alias: string; status: "invited" | "active" | "left"; flc: boolean; currentTurn: boolean }>;
    rules: Pick<GroupRules, "decision" | "timeoutSeconds" | "absence">;
    jointActions: Array<{ id: string; label: string }>;
    decision: null | { id: string; kind: GroupDecision["kind"]; label: string; myVote: boolean | null; approvals: number; required: number; canVote: boolean };
  };
  messages: Array<{ id: string; channel: "player_chat" | "hero_dialogue"; alias: string; text: string; timestamp: string }>;
  contributions: Array<{ id: string; alias: string; text: string; timestamp: string; mapRevision: number; sourceRevision: number; nodeId: string; aiAssisted: boolean; mine: boolean }>;
  legalAuthorship: false;
}

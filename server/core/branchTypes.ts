export interface BranchFragment {
  id: string; paragraphId: string|null; sectionId: string; text: string;
  original: string; originalHash: string; status: 'draft'|'applying'|'accepted'|'rejected';
  sourceProposalId?: string; acceptedRevision?: number;
}
export interface BranchSnapshot {
  version: number; name: string; status: 'active'|'archived'; fragments: BranchFragment[];
  actor: string; createdAt: string;
}
export interface ScenarioBranch {
  id: string; name: string; pointEntityId: string|null; source: 'author'|'interview'|'magic_scene';
  sourceId: string|null; baseBookRevision: number; baseBookHash: string; baseCanonHash: string;
  baseParagraphs: import('./types').ParagraphRow[];
  status: 'active'|'archived'; fragments: BranchFragment[]; history: BranchSnapshot[];
  createdAt: string;
}
export interface BranchWorkspace { revision: number; branches: ScenarioBranch[] }

/** T9.9: explicit agreements for one immutable manuscript and publication version. */
export const EDITION_ROLES = ['author', 'coauthor', 'editor', 'illustrator', 'publisher', 'acknowledgement'] as const;
export type EditionRole = typeof EDITION_ROLES[number];
export const EDITION_ROLE_LABELS: Record<EditionRole, string> = {
  author: 'Письменник', coauthor: 'Співавтор', editor: 'Редактор', illustrator: 'Ілюстратор',
  publisher: 'Видавець', acknowledgement: 'Подяка',
};
export interface EditionCreditInput {
  userId: string;
  name: string;
  role: EditionRole;
  /** Agreed allocation of net receipts in basis points, not an automatic payment. */
  shareBps: number;
}
export interface EditionTerms {
  license: 'all-rights-reserved' | 'CC-BY-4.0' | 'custom';
  licenseText: string;
  commercial: boolean;
  credits: EditionCreditInput[];
  excludeContributionIds: string[];
  foreword: string;
  acknowledgements: string;
  cover: string | null;
}
export interface EditionPage {
  id: string; title: string; text: string; nodeId: string | null;
  aiAssisted: boolean;
}
export interface EditionManuscript {
  id: string; version: number; title: string; subtitle: string; language: string;
  pages: EditionPage[];
  map: { nodes: Array<{id:string;label:string;x:number;y:number;level:string}>;
    edges: Array<{from:string;to:string}> };
  foreword: string; acknowledgements: string; cover: string | null;
  authors: Array<{name:string;role:EditionRole}>;
  license: string; licenseText: string; aiAssisted: boolean;
}
export interface EditionAgreement {
  id: string; name: string; role: EditionRole; shareBps: number;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  revision: number; mine: boolean; note: string;
}
export interface EditionView {
  id: string; bookId: string; version: number; revision: number;
  bookRevision: number; snapshotHash: string;
  status: 'review' | 'published' | 'withdrawn';
  fresh: boolean; ready: boolean; canManage: boolean; canPublish: boolean; canEditBook: boolean;
  commercial: boolean; manuscript: EditionManuscript; agreements: EditionAgreement[];
  ownContributions: Array<{sectionId:string;text:string;originalText:string;aiAssisted:boolean}>;
  comments: Array<{id:string;name:string;text:string;createdAt:string}>;
  createdAt: string; publishedAt: string | null;
}
export interface EditionContext {
  bookRevision: number; ownerId: string;
  candidates: Array<{userId:string;alias:string;required:boolean;reason:string}>;
  contributions: Array<{id:string;sectionId:string;userId:string;alias:string;text:string;active:boolean}>;
  editions: Array<{id:string;version:number;status:EditionView['status'];title:string}>;
}

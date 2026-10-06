export interface GlossaryEntry {
  id: string; language: string; source: string; target: string; entityId: string | null;
  previousTargets?: string[];
}
export interface TranslationVersion {
  version: number; text: string; sourceHash: string; glossaryHash: string;
  status: 'draft' | 'approved'; actor: string; createdAt: string;
}
export interface TranslationRecord {
  paragraphId: string; sourceLanguage: string; language: string; versions: TranslationVersion[];
}
export interface TranslationWorkspace {
  revision: number; glossary: GlossaryEntry[]; records: TranslationRecord[];
}

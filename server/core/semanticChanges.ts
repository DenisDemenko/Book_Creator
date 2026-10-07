import { canonicalJson } from "../../src/utils/ontology";
/** T5.7 В2: exact source deltas, never a whole-book AI request. */
import type {
  CoreRepository,
  DocumentRow,
  MentionRow,
  ParagraphRow,
} from "./types";
export interface SemanticSource {
  text: string;
  version: number;
  sectionId: string;
  order: number;
  kind: string;
  position: string;
  entityIds: string[];
}
export interface SemanticParagraphChange {
  paragraphId: string;
  before: SemanticSource | null;
  after: SemanticSource | null;
}
export interface SemanticChanges {
  baseline: boolean;
  paragraphs: SemanticParagraphChange[];
}
const sourceBuilder = (documents: DocumentRow[], mentions: MentionRow[]) => {
  const docs = new Map(documents.map((d) => [d.id, d]));
  const byParagraph = new Map<string, Set<string>>();
  for (const m of mentions) {
    const ids = byParagraph.get(m.paragraphId) ?? new Set<string>();
    ids.add(m.entityId);
    if (m.subjectEntityId) ids.add(m.subjectEntityId);
    byParagraph.set(m.paragraphId, ids);
  }
  return (p: ParagraphRow): SemanticSource => {
    const scene = docs.get(p.documentId);
    const chapter = scene?.parentId ? docs.get(scene.parentId) : undefined;
    return {
      text: p.text,
      version: p.version,
      sectionId: p.documentId,
      order: p.order,
      kind: p.kind,
      position: JSON.stringify([
        scene?.parentId ?? null,
        chapter?.order ?? null,
        scene?.order ?? null,
      ]),
      entityIds: [...(byParagraph.get(p.id) ?? [])].sort(),
    };
  };
};
export async function collectSemanticChanges(
  repo: CoreRepository,
  projectId: string,
  before: {
    paragraphs: ParagraphRow[];
    documents: DocumentRow[];
    mentions: MentionRow[];
  },
): Promise<SemanticChanges> {
  if (!before.paragraphs.length) return { baseline: true, paragraphs: [] };
  const after = await repo.listAllParagraphs(projectId);
  const docs = await repo.listDocuments(projectId);
  const mentions = await repo.listMentionsByParagraphs(
    projectId,
    after.filter((p) => !p.deletedAt).map((p) => p.id),
  );
  const oldSource = sourceBuilder(before.documents, before.mentions);
  const newSource = sourceBuilder(docs, mentions);
  const old = new Map(before.paragraphs.map((p) => [p.id, p]));
  const paragraphs: SemanticParagraphChange[] = [];
  for (const p of after) {
    const prev = old.get(p.id);
    const a = p.deletedAt ? null : newSource(p);
    const b = prev && !prev.deletedAt ? oldSource(prev) : null;
    if (canonicalJson(a) !== canonicalJson(b))
      paragraphs.push({ paragraphId: p.id, before: b, after: a });
  }
  return { baseline: false, paragraphs };
}
export async function sourceIsCurrent(
  repo: CoreRepository,
  projectId: string,
  change: SemanticParagraphChange,
): Promise<boolean> {
  const p = await repo.getParagraph(projectId, change.paragraphId);
  if (!change.after) return !!p?.deletedAt;
  if (!p || p.deletedAt) return false;
  const current = sourceBuilder(
    await repo.listDocuments(projectId),
    await repo.listMentionsByParagraphs(projectId, [p.id]),
  )(p);
  return canonicalJson(current) === canonicalJson(change.after);
}
export const semanticText = (s: string) =>
  s.normalize("NFC").replace(/\s+/gu, " ").trim();
export function noSemanticChange(change: SemanticParagraphChange): boolean {
  const { before: a, after: b } = change;
  return (
    !!a &&
    !!b &&
    a.sectionId === b.sectionId &&
    a.order === b.order &&
    a.kind === b.kind &&
    a.position === b.position &&
    canonicalJson(a.entityIds) === canonicalJson(b.entityIds) &&
    semanticText(a.text) === semanticText(b.text)
  );
}

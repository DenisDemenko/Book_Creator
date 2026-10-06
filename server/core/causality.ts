/** Т2.9: deterministic, evidence-based warnings. Never writes manuscript or canon. */
import { createHash } from 'node:crypto';
import type { CoreRepository, ContinuityEvidence, EntityRow, MentionRow } from './types';
import { EVENT_TYPES } from './characterProfile';
import { knowledgeCandidates, scanScenes, sceneIsBefore, type SceneScan } from './timeline';
import { paragraphExcerpt } from './search/text';
import { CoreRuleError } from './rules';
import { blockHash } from '../../src/utils/paragraphIds';

export const CAUSAL_RELATIONS = new Set(['caused_by', 'triggers', 'leads_to', 'consequence', 'prevents']);
export const CAUSAL_EXCEPTIONS = ['coincidence', 'false_belief', 'mystery'] as const;
export interface CausalityPolicy {
  exception?: typeof CAUSAL_EXCEPTIONS[number];
  requiresKnowledge: string[];
  claims: { entityId: string; label: string; value: string }[];
}
export interface CausalityWarning {
  key: string;
  code: 'missing_cause' | 'cause_after_effect' | 'cycle' | 'prevented_event' | 'knowledge' | 'canon_conflict';
  entityId: string;
  summary: string;
  evidenceA: ContinuityEvidence;
  evidenceB: ContinuityEvidence | null;
  insufficientData: boolean;
}
export function parseCausalityPolicy(value: unknown): CausalityPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CoreRuleError('bad_input', 'Правила причинності мають бути об’єктом.');
  const p = value as Record<string, unknown>;
  if (p.exception != null && !CAUSAL_EXCEPTIONS.includes(p.exception as any)) throw new CoreRuleError('bad_input', 'Невідомий виняток причинності.');
  const ids = p.requiresKnowledge ?? [];
  const claims = p.claims ?? [];
  if (!Array.isArray(ids) || ids.length > 100 || ids.some(x => typeof x !== 'string' || !x.trim())) throw new CoreRuleError('bad_input', 'Потрібні знання — до 100 ID фактів.');
  if (!Array.isArray(claims) || claims.length > 100 || claims.some(c => !c || typeof c !== 'object' || typeof c.entityId !== 'string' || !c.entityId || typeof c.label !== 'string' || !c.label.trim() || c.label.length > 80 || typeof c.value !== 'string' || !c.value.trim() || c.value.length > 400)) throw new CoreRuleError('bad_input', 'Твердження потребує сутності, назви риси й значення.');
  return { ...(p.exception ? { exception: p.exception as CausalityPolicy['exception'] } : {}), requiresKnowledge: [...new Set(ids as string[])], claims: claims.map(c => ({ entityId: c.entityId, label: c.label.trim(), value: c.value.trim() })) };
}
const policyOf = (e: EntityRow): CausalityPolicy => {
  // Imported legacy canonical data is untrusted; malformed policy does not exempt an event.
  try { return parseCausalityPolicy(e.canonical.causality ?? {}); } catch { return { requiresKnowledge: [], claims: [] }; }
};
function evidence(scan: SceneScan, m: MentionRow): ContinuityEvidence {
  const p = scan.ix.paragraphs.get(m.paragraphId)!;
  return { sectionId: p.documentId, paragraphId: p.id, entityId: m.entityId, quote: paragraphExcerpt(p.text, 200).trim() || '(порожній абзац)' };
}
function before(scan: SceneScan, a: MentionRow, b: MentionRow): boolean {
  const pa = scan.ix.paragraphs.get(a.paragraphId)!;
  const pb = scan.ix.paragraphs.get(b.paragraphId)!;
  if (pa.documentId === pb.documentId) return pa.order < pb.order || (pa.id === pb.id && a.spanStart < b.spanStart);
  return sceneIsBefore(scan.bySection.get(pa.documentId)!, scan.bySection.get(pb.documentId)!);
}

export async function analyzeCausality(repo: CoreRepository, projectId: string, options: { entityIds?: string[] } = {}) {
  const [scan, relations, traits, knowledge] = await Promise.all([
    repo.listTimePoints(projectId).then(p => scanScenes(repo, projectId, p)),
    repo.listRelations(projectId), repo.listEntityTraits(projectId), knowledgeCandidates(repo, projectId),
  ]);
  const entities = new Map([...scan.entities].filter(([, e]) => e.status === 'confirmed'));
  const mentions = scan.mentions.filter(m => m.status === 'confirmed' && entities.has(m.entityId) && scan.ix.paragraphs.get(m.paragraphId)?.kind !== 'draft');
  const first = new Map<string, MentionRow>();
  for (const m of mentions) if (!first.has(m.entityId) || before(scan, m, first.get(m.entityId)!)) first.set(m.entityId, m);
  const edges = relations.filter(r => r.status === 'confirmed' && CAUSAL_RELATIONS.has(r.type) && entities.has(r.fromId) && entities.has(r.toId)).map(r => ({ id: r.id, type: r.type, cause: r.type === 'caused_by' ? r.toId : r.fromId, effect: r.type === 'caused_by' ? r.fromId : r.toId }));
  const adjacency = new Map<string, Set<string>>();
  for (const e of edges) adjacency.set(e.cause, new Set([...(adjacency.get(e.cause) ?? []), e.effect]));
  const dependentIds = (seeds: string[]) => {
    const seen = new Set(seeds.filter(id => entities.has(id)));
    const queue = [...seen];
    for (let i = 0; i < queue.length; i++) for (const id of adjacency.get(queue[i]) ?? []) if (!seen.has(id)) { seen.add(id); queue.push(id); }
    return [...seen];
  };
  if (options.entityIds?.some(id => !entities.has(id))) throw new CoreRuleError('not_found', 'Сутність не належить підтвердженому канону цієї книги.');
  const selected = options.entityIds ? new Set(dependentIds(options.entityIds)) : null;
  const warnings: CausalityWarning[] = [];
  const add = (code: CausalityWarning['code'], id: string, a: MentionRow, b: MentionRow | null, summary: string, discriminator = '') => {
    const key = createHash('sha256').update(`${code}|${id}|${a.id}|${b?.id ?? ''}|${discriminator}`).digest('hex').slice(0, 24);
    if (warnings.some(w => w.key === key)) return;
    warnings.push({ key, code, entityId: id, summary: summary.slice(0, 450), evidenceA: evidence(scan, a), evidenceB: b ? evidence(scan, b) : null, insufficientData: !b });
  };
  const events = [...entities.values()].filter(e => EVENT_TYPES.has(e.type) && first.has(e.id) && (!selected || selected.has(e.id)));
  for (const event of events) {
    const action = first.get(event.id)!;
    const policy = policyOf(event);
    const incoming = edges.filter(e => e.effect === event.id && e.type !== 'prevents');
    if (!policy.exception && !incoming.length && ['decision', 'consequence', 'turning-point'].includes(event.type)) {
      const previous = [...first.values()].filter(m => EVENT_TYPES.has(entities.get(m.entityId)!.type) && before(scan, m, action)).sort((a, b) => before(scan, a, b) ? 1 : -1)[0];
      add('missing_cause', event.id, action, previous ?? null, `Для «${event.name}» не вказано причинного переходу. Попереднє місце — контекст, а не доказ причини; перевірте зв’язок або позначте випадковість, хибне переконання чи загадку.`);
    }
    for (const edge of edges.filter(e => e.effect === event.id)) {
      const cause = first.get(edge.cause);
      if (!cause) continue;
      if (edge.type === 'prevents' && before(scan, cause, action) && !policy.exception) add('prevented_event', event.id, action, cause, `«${entities.get(edge.cause)!.name}» перешкоджає «${event.name}», але подія відбулася. Перевірте, як подолано перешкоду.`);
      if (edge.type !== 'prevents' && before(scan, action, cause)) add('cause_after_effect', event.id, action, cause, `Причина «${entities.get(edge.cause)!.name}» відбувається після «${event.name}» у часі історії. Перевірте причинний перехід.`);
    }
    if (policy.exception !== 'false_belief' && policy.exception !== 'coincidence') {
      const required = new Set([...policy.requiresKnowledge, ...incoming.filter(e => entities.get(e.cause)?.type === 'revelation').map(e => e.cause)]);
      for (const m of mentions.filter(m => m.entityId === event.id && m.subjectEntityId && entities.get(m.subjectEntityId)?.type === 'character')) {
        for (const factId of required) {
          const fact = entities.get(factId);
          if (!fact) continue;
          const learned = knowledge.filter(k => k.characterId === m.subjectEntityId && k.entityId === factId && (k.entityKind !== 'revelation' || k.via === 'subject'));
          const knows = learned.some(k => mentions.some(mm => mm.entityId === factId && mm.paragraphId === k.paragraphId && before(scan, mm, m)));
          if (!knows) add('knowledge', event.id, m, first.get(factId) ?? null, `«${entities.get(m.subjectEntityId!)!.name}» діє у «${event.name}» на основі «${fact.name}», але до цього моменту немає доказу, що герой знає цей факт. Перевірте джерело знання.`, factId);
        }
      }
    }
    const superseded = new Set(traits.filter(t => t.status === 'confirmed' && t.supersedes).map(t => t.supersedes));
    for (const claim of policy.exception === 'false_belief' ? [] : policy.claims) for (const trait of traits.filter(t => t.status === 'confirmed' && !superseded.has(t.id) && t.entityId === claim.entityId && t.label === claim.label && t.value !== claim.value)) {
      const anchor = trait.sectionId ? mentions.find(m => m.entityId === trait.entityId && scan.sectionOfParagraph.get(m.paragraphId) === trait.sectionId) : first.get(trait.entityId);
      if (anchor && before(scan, action, anchor)) continue;
      add('canon_conflict', event.id, action, anchor ?? null, `«${event.name}»: ${claim.label} = «${claim.value}», але затверджена риса «${entities.get(claim.entityId)?.name ?? claim.entityId}» — «${trait.value}». Перевірте зміну канону.`, trait.id);
    }
  }
  for (const edge of edges.filter(e => e.type !== 'prevents' && (!selected || selected.has(e.effect)))) {
    const a = first.get(edge.effect), b = first.get(edge.cause);
    // Only causal edges, not prevents, establish a causal cycle.
    const seen = new Set([edge.effect]), queue = [edge.effect];
    for (let i = 0; i < queue.length; i++) for (const next of edges.filter(e => e.type !== 'prevents' && e.cause === queue[i]).map(e => e.effect)) if (!seen.has(next)) { seen.add(next); queue.push(next); }
    if (a && b && seen.has(edge.cause)) add('cycle', edge.effect, a, b, `Причинне коло між «${entities.get(edge.effect)!.name}» і «${entities.get(edge.cause)!.name}». Перевірте, чи це навмисна загадка.`);
  }
  return { checked: events.length, warnings, edges, dependencies: options.entityIds ? dependentIds(options.entityIds) : [], rule: 'Попередження за підтвердженими зв’язками й доказами. Відсутність причинного зв’язку не доводить помилку; канон і рукопис не змінюються.' };
}

/** Shared entry point for continuity, future branches and simulations. */
export async function refreshCausalityContinuity(repo: CoreRepository, projectId: string) {
  const report = await analyzeCausality(repo, projectId);
  const existing = await repo.listContinuityIssues(projectId, { kind: 'causality' });
  const texts = new Map((await repo.listAllParagraphs(projectId)).filter(p => !p.deletedAt).map(p => [p.id, p.text]));
  const active = new Set<string>();
  let created = 0, updated = 0, skipped = 0;
  const issues = [];
  for (const w of report.warnings) {
    const actor = `system:causality:${w.key}`;
    const prev = existing.find(i => i.entityId === w.entityId && i.summary === w.summary && i.evidenceA.paragraphId === w.evidenceA.paragraphId && i.evidenceB?.paragraphId === w.evidenceB?.paragraphId);
    if (prev) active.add(prev.id);
    if (prev && ['dismissed', 'resolved'].includes(prev.status)) { skipped++; continue; }
    const digest = createHash('sha256');
    const ids = [w.evidenceA.paragraphId, w.evidenceB?.paragraphId].filter((id): id is string => !!id);
    for (const id of ids) digest.update(`${id}\u0000${blockHash(texts.get(id) ?? '')}\u0001`);
    const hash = ids.length ? digest.digest('hex').slice(0, 24) : null;
    if (prev?.checkedHash === hash) { skipped++; issues.push(prev); continue; }
    issues.push(await repo.upsertContinuityIssue({ id: prev?.id, projectId, kind: 'causality', entityId: w.entityId, summary: w.summary, evidenceA: w.evidenceA, evidenceB: w.evidenceB, insufficientData: w.insufficientData, status: 'suggested', source: 'rule', checkedHash: hash, createdBy: actor }));
    prev ? updated++ : created++;
  }
  // Do not auto-resolve: the author decides; show stale findings as needing review.
  for (const issue of existing) if (!active.has(issue.id) && !['dismissed', 'resolved', 'needs_review'].includes(issue.status)) {
    await repo.setContinuityIssueStatus(projectId, issue.id, 'needs_review', 'system:causality'); updated++;
  }
  return { checked: report.checked, created, updated, skipped, issues };
}

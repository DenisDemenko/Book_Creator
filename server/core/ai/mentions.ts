/**
 * AI-1: пропоновані згадки й первинні зв'язки (Т1.1).
 *
 * Роль AI-1 читає абзаци розділу й пропонує: «тут згадано /emotion:страх
 * (чиє — Олени)», «тут з'являється /location:Міст», «Олена /follows Марко».
 * Нічого не записує ні в рукопис, ні в затверджене ядро — лише висновки
 * `suggested`:
 *
 *   - `mention_suggestion` — сутність у конкретному абзаці (один висновок —
 *     один абзац), з готовим тегом, який редактор поставить у цей абзац, якщо
 *     автор натисне «Підтвердити» (П3);
 *   - `relation_suggestion` — зв'язок між двома ВЖЕ відомими сутностями;
 *     підтвердження створює зв'язок у ядрі (тексту не чіпає).
 *
 * Зіставлення: назва з відповіді → наявна сутність через псевдоніми (один
 * UUID на всі імена героя). Відсів: згадка, що вже стоїть тегом у цьому
 * абзаці, відхилена автором раніше (у цьому абзаці) або вже запропонована й
 * ще не розглянута, — не пропонується. Тип сутності чи зв'язку поза реєстром
 * — теж ні.
 */

import { CORE_ENTITIES, CORE_ENTITY_RELATIONS, buildEntityTag, entityBySlug } from '../../../src/utils/coreEntities';
import { normalizeAlias } from '../rules';
import type { CoreRepository, FindingRow } from '../types';
import type { ModelFinding, PreparedFinding } from './roles';

export const MENTION_SUGGESTION = 'mention_suggestion';
export const RELATION_SUGGESTION = 'relation_suggestion';

const RELATION_KEYS = new Set(CORE_ENTITY_RELATIONS.map((r) => r.key));

/** Ключ «цей абзац — ця сутність» для відсіву повторів. */
export function suggestionKey(paragraphId: string, entityType: string, name: string): string {
  return `${paragraphId}\u0000${entityType}\u0000${normalizeAlias(name)}`;
}

/** Інструкція для AI-1: що шукати, у якому вигляді, що вже відомо. */
export function mentionTask(known: { type: string; name: string }[]): string {
  const types = CORE_ENTITIES.map((e) => e.slug).join(', ');
  const relations = CORE_ENTITY_RELATIONS.map((r) => r.key).join(', ');
  const knownList = known.length
    ? known.slice(0, 200).map((e) => `${e.type}: ${e.name}`).join('; ')
    : '(поки немає)';
  return [
    'Знайди в абзацах згадки сутностей, яких автор ще НЕ позначив тегом у цьому абзаці (теги мають вигляд [/тип:значення]).',
    'Для кожної згадки — окремий висновок: kind "mention", entity_type — тип із реєстру, entity_name — назва так, як її варто',
    'записати в тег (для героя — ім\'я; для емоції, цілі, події — коротко, 1–4 слова), paragraph_ids — рівно ОДИН id абзацу,',
    'quote — дослівна цитата з цього абзацу. Для емоцій, цілей, рішень, переконань — subject_name: чиї вони (ім\'я героя).',
    'Якщо в тексті очевидний зв\'язок між двома вже ВІДОМИМИ сутностями — kind "relation": entity_type/entity_name — звідки,',
    'target_entity_type/target_entity_name — куди, relation_type — ключ зв\'язку з переліку, paragraph_ids — докази.',
    'Не вигадуй: лише те, що прямо є в тексті. Краще менше, ніж хибно.',
    '',
    `Типи сутностей реєстру: ${types}.`,
    `Ключі зв'язків: ${relations}.`,
    `Уже відомі сутності книги (використовуй ці назви, якщо в тексті — вони): ${knownList}.`,
  ].join('\n');
}

export interface MentionPrepareContext {
  repo: CoreRepository;
  projectId: string;
  /** Тексти вхідних абзаців — щоб знати, які теги вже стоять. */
  paragraphTexts: Map<string, string>;
}

/**
 * Обробка висновків AI-1 перед збереженням (передається в `runAiRole.prepare`).
 * Стан (наявні згадки, відхилене, уже запропоноване) читається один раз на прогін.
 */
export async function createMentionPreparer(ctx: MentionPrepareContext) {
  const { repo, projectId } = ctx;
  const all = await repo.listFindings(projectId);
  const blocked = new Set<string>();
  for (const f of all) {
    if (f.kind !== MENTION_SUGGESTION || f.status === 'confirmed') continue;
    const p = f.payload as { entityType?: string; entityName?: string };
    const paragraphId = f.sourceParagraphIds[0];
    // Відхилене — назавжди для цього абзацу; нерозглянуте — поки чекає.
    if (paragraphId && p.entityType && p.entityName) blocked.add(suggestionKey(paragraphId, p.entityType, p.entityName));
  }
  const pendingRelations = new Set(
    all
      .filter((f) => f.kind === RELATION_SUGGESTION && f.status !== 'confirmed')
      .map((f) => {
        const p = f.payload as { relationType?: string; targetEntityId?: string };
        return `${f.entityId}\u0000${p.relationType}\u0000${p.targetEntityId}`;
      }),
  );
  // Згадки з тегів, що вже є в ядрі, — лише для вхідних абзаців.
  const mentionedHere = new Map<string, Set<string>>();
  for (const m of await repo.listMentionsByParagraphs(projectId, [...ctx.paragraphTexts.keys()])) {
    const set = mentionedHere.get(m.paragraphId) ?? new Set<string>();
    set.add(m.entityId);
    mentionedHere.set(m.paragraphId, set);
  }
  const mentionsOf = async (paragraphId: string) => mentionedHere.get(paragraphId) ?? new Set<string>();
  const entities = await repo.listEntities(projectId);
  const resolve = async (type: string, name: string) => (name ? await repo.resolveAlias(projectId, type, name) : null);
  const entityName = new Map(entities.map((e) => [e.id, e.name]));

  return async (f: ModelFinding, evidence: { paragraphIds: string[] }): Promise<PreparedFinding[]> => {
    const type = String(f.entity_type ?? '').replace(/^\//, '').trim();
    const name = String(f.entity_name ?? '').trim();
    if (!entityBySlug(type) || !name) return [];
    const entityId = await resolve(type, name);

    if (f.kind === 'relation') {
      const relationType = String(f.relation_type ?? '').trim();
      const targetType = String(f.target_entity_type ?? '').replace(/^\//, '').trim();
      const targetName = String(f.target_entity_name ?? '').trim();
      const targetId = entityBySlug(targetType) ? await resolve(targetType, targetName) : null;
      // Зв'язок пропонується лише між уже відомими сутностями й лише реєстровий.
      if (!RELATION_KEYS.has(relationType) || !entityId || !targetId || entityId === targetId) return [];
      const key = `${entityId}\u0000${relationType}\u0000${targetId}`;
      if (pendingRelations.has(key)) return [];
      const existing = await repo.listRelations(projectId, entityId);
      if (existing.some((r) => r.type === relationType && r.fromId === entityId && r.toId === targetId)) return [];
      pendingRelations.add(key);
      return [{
        kind: RELATION_SUGGESTION,
        entityId,
        paragraphIds: evidence.paragraphIds,
        payload: { relationType, targetEntityId: targetId, targetEntityName: entityName.get(targetId) ?? targetName, entityName: entityName.get(entityId) ?? name, entityType: type },
      }];
    }

    // Згадка: один висновок — один абзац (тег ставиться в конкретний абзац).
    const out: PreparedFinding[] = [];
    const tagName = (entityId && entityName.get(entityId)) || name;
    const subject = type !== 'character' && f.subject_name ? String(f.subject_name).trim() : '';
    for (const paragraphId of evidence.paragraphIds) {
      if (entityId && (await mentionsOf(paragraphId)).has(entityId)) continue;
      const key = suggestionKey(paragraphId, type, name);
      if (blocked.has(key)) continue;
      // Такий самий тег уже стоїть у тексті (сутність ще не в ядрі — синхронізація попереду).
      const tag = buildEntityTag(type, subject ? `${tagName} @${subject}` : tagName);
      if ((ctx.paragraphTexts.get(paragraphId) ?? '').includes(buildEntityTag(type, tagName).slice(0, -1))) continue;
      blocked.add(key);
      out.push({
        kind: MENTION_SUGGESTION,
        entityId,
        paragraphIds: [paragraphId],
        payload: { entityType: type, entityName: name, tagName, subjectName: subject || undefined, tag },
      });
    }
    return out;
  };
}

/** Висновок-пропозиція для відповіді API: без службового, з абзацом. */
export function publicSuggestion(f: FindingRow, paragraph?: { documentId: string; editorPid: string | null; text: string }) {
  const p = f.payload as Record<string, unknown>;
  return {
    id: f.id,
    kind: f.kind,
    status: f.status,
    entityId: f.entityId,
    entityType: p.entityType,
    entityName: p.entityName,
    tag: p.tag,
    subjectName: p.subjectName,
    relationType: p.relationType,
    targetEntityName: p.targetEntityName,
    quote: p.quote,
    summary: p.summary,
    confidence: p.confidence,
    paragraphId: f.sourceParagraphIds[0] ?? null,
    sectionId: paragraph?.documentId ?? null,
    editorPid: paragraph ? paragraph.editorPid ?? f.sourceParagraphIds[0] : null,
    paragraphExcerpt: paragraph ? paragraph.text.slice(0, 220) : null,
    createdAt: f.createdAt,
  };
}

// ── Фонова задача ──────────────────────────────────────────────────────────

export const AI_MENTIONS_JOB_KIND = 'ai_mentions';

export interface AiMentionsJobDeps {
  repo: () => CoreRepository | null;
  generate: import('./roles').AiRoleDeps['generate'];
  resolveModel: import('./roles').AiRoleDeps['resolveModel'];
  loadTemplate?: import('./roles').AiRoleDeps['loadTemplate'];
}

/** Вид задачі `ai_mentions`: AI-1 над абзацами (payload.paragraphIds) → пропозиції. */
export function aiMentionsJobKind(deps: AiMentionsJobDeps) {
  return {
    maxAttempts: 2,
    rateLimit: { max: 20, windowMs: 60_000 },
    handler: async (ctx: {
      job: { projectId: string; payload: Record<string, unknown>; createdBy: string };
      signal: AbortSignal;
      checkpoint(): Promise<void>;
      setProgress(p: Record<string, unknown>): Promise<void>;
      recordUsage(u: { tokens?: number; requests?: number }): Promise<void>;
    }) => {
      const { runAiRole } = await import('./roles');
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const projectId = ctx.job.projectId;
      const ids = Array.isArray(ctx.job.payload.paragraphIds) ? (ctx.job.payload.paragraphIds as string[]) : [];
      const paragraphs: { id: string; text: string }[] = [];
      for (const id of ids) {
        const row = await repo.getParagraph(projectId, id);
        // Порожні абзаци, розділювачі й картинки моделі нічого не дадуть.
        if (row && !row.deletedAt && row.text.trim() && (row.kind === 'paragraph' || row.kind === 'heading' || row.kind === 'blockquote')) {
          paragraphs.push({ id: row.id, text: row.text });
        }
      }
      if (!paragraphs.length) return { status: 'nothing', suggestions: 0 };
      const known = (await repo.listEntities(projectId))
        .filter((e) => e.status !== 'rejected')
        .map((e) => ({ type: e.type, name: e.name }));
      const prepare = await createMentionPreparer({ repo, projectId, paragraphTexts: new Map(paragraphs.map((p) => [p.id, p.text])) });
      const project = await repo.getProject(projectId);
      await ctx.setProgress({ step: 'model', paragraphs: paragraphs.length });
      await ctx.checkpoint();
      const res = await runAiRole(
        { repo, generate: deps.generate, resolveModel: deps.resolveModel, loadTemplate: deps.loadTemplate, recordUsage: (u) => ctx.recordUsage(u) },
        {
          projectId,
          role: 'AI-1',
          task: mentionTask(known),
          paragraphs,
          sourceRevision: project?.revision ?? null,
          createdBy: ctx.job.createdBy,
          signal: ctx.signal,
          prepare,
        },
      );
      if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');
      return {
        status: res.status,
        runId: res.run.id,
        suggestions: res.findings.filter((f) => f.kind === MENTION_SUGGESTION).length,
        relations: res.findings.filter((f) => f.kind === RELATION_SUGGESTION).length,
        filtered: res.rejected.length,
        errors: res.errors,
      };
    },
  };
}

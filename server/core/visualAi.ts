/**
 * AI-3 у бібліотеці ілюстрацій (Т2.3 В4, PLAN_VISUAL_LIBRARY.md): лише за
 * командою автора, фоновою задачею `ai_visual` з бюджетом проєкту.
 *
 *   • «Розпізнати» (mode `recognize`) — AI-3 отримує зображення, сутності
 *     книги й затверджені описи зовнішності героїв і повертає:
 *       visual_link     — «тут, схоже, Олена / Київ / меч» → зв'язок-пропозиція
 *                         (`suggested`, джерело `ai`), затверджує автор;
 *       visual_trait    — ознака зовнішності, видна на зображенні;
 *       visual_mismatch — розбіжність з описом («темне волосся, а в описі руде»).
 *   • «Звірити з описом» (mode `compare`) — прив'язаний портрет (повний зріст,
 *     референс) героя проти опису його версії зовнішності чи картки:
 *       visual_match / visual_mismatch / visual_unknown («недостатньо даних»).
 *     Підсумок: збіг — позначку «перевірити» (В5) знято, відбиток — опис, з
 *     яким звіряли; розбіжність — позначка ставиться; даних замало — нічого.
 *
 * Кожен висновок — з доказом-зображенням (`source_asset_ids`), як вимагає
 * ядро. Відхилений автором зв'язок AI-3 більше не пропонує.
 */

import type { AiRoleDeps } from './ai/roles';
import type { AssetLinkRow, AssetRole, CoreRepository, EntityRow, FindingRow } from './types';
import { studioAppearanceText, type StudioCharacterLike } from './characterProfile';
import { VERSIONED_ROLES } from './rules';
import { cardAppearanceHash, ROLE_ENTITY_TYPES } from './visual';

export const AI_VISUAL_JOB_KIND = 'ai_visual';
export const VISUAL_LINK = 'visual_link';
export const VISUAL_TRAIT = 'visual_trait';
export const VISUAL_MISMATCH = 'visual_mismatch';
export const VISUAL_MATCH = 'visual_match';
export const VISUAL_UNKNOWN = 'visual_unknown';
export const VISUAL_KINDS = [VISUAL_LINK, VISUAL_TRAIT, VISUAL_MISMATCH, VISUAL_MATCH, VISUAL_UNKNOWN];

/** Кого й що AI-3 може впізнати на зображенні: те, що має вигляд (не події, емоції, теми). */
export const VISUAL_ENTITY_TYPES = ['character', 'group', 'location', 'world', 'object', 'item', 'artifact', 'weapon', 'vehicle', 'symbol', 'tool'];

/** Скільки сутностей показати AI-3 у переліку (решта не влізе в запит розумно). */
export const VISUAL_MAX_ENTITIES = 150;

/** Роль зв'язку, яку AI-3 може запропонувати для сутності: портрет — рішення автора, не моделі. */
export function suggestedRoleFor(type: string): AssetRole {
  if ((ROLE_ENTITY_TYPES.location ?? []).includes(type)) return 'location';
  if ((ROLE_ENTITY_TYPES.object ?? []).includes(type)) return 'object';
  return 'depicts';
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface HeroDescription {
  entityId: string;
  name: string;
  card: string;
  versions: { label: string; chapters: string; description: string }[];
}

/** Завдання «Розпізнати»: перелік сутностей книги й затверджені описи героїв. */
export function recognizeTask(imageId: string, entities: Pick<EntityRow, 'type' | 'name'>[], heroes: HeroDescription[]): string {
  const list = entities.map((e) => `- ${e.type}: ${e.name}`).join('\n');
  const looks = heroes
    .filter((h) => h.card || h.versions.length)
    .map((h) =>
      [
        `- ${h.name}: ${h.card || '(у картці опису немає)'}`,
        ...h.versions.map((v) => `  · версія «${v.label}» (${v.chapters}): ${v.description || '(без опису)'}`),
      ].join('\n'),
    )
    .join('\n');
  return [
    `Розглянь зображення [${imageId}] — ілюстрацію до книги. Повертай висновки лише про те, що справді видно.`,
    `1) kind "visual_link" — хто з героїв або які локації, предмети книги, схоже, на зображенні: entity_type і entity_name ТОЧНО як у переліку нижче; confidence — наскільки впевнений.`,
    `2) kind "visual_trait" — помітна ознака зовнішності героя (волосся, очі, одяг, прикмети): entity_name, field (hair, eyes, build, face, clothing, marks, other), summary.`,
    `3) kind "visual_mismatch" — розбіжність із затвердженим описом героя нижче: entity_name, field, summary «на зображенні … , в описі …».`,
    `У кожного висновку image_ids: ["${imageId}"]. Не вгадуй імена поза переліком; якщо не впевнений, хто це, — не пиши visual_link.`,
    `Сутності книги:\n${list || '(немає)'}`,
    looks ? `Затверджені описи зовнішності героїв:\n${looks}` : 'Затверджених описів зовнішності немає.',
  ].join('\n');
}

/** Завдання «Звірити з описом» для одного прив'язаного зображення героя. */
export function compareTask(imageId: string, heroName: string, versionLabel: string | null, description: string): string {
  return [
    `Звір зображення [${imageId}] з затвердженим описом зовнішності героя «${heroName}»${versionLabel ? ` (версія «${versionLabel}»)` : ''}.`,
    `Опис:\n${description}`,
    `Для КОЖНОЇ ознаки з опису — один висновок: kind "visual_match" (на зображенні так само), "visual_mismatch" (інакше: summary «на зображенні …, в описі …») або "visual_unknown" (ознаку не видно — insufficient_data: true).`,
    `field — hair, eyes, build, face, clothing, marks, height або other. У кожного висновку image_ids: ["${imageId}"]. Не оцінюй художню якість — лише відповідність опису.`,
  ].join('\n');
}

export type CompareVerdict = 'match' | 'mismatch' | 'insufficient';

export function compareVerdict(findings: Pick<FindingRow, 'kind'>[]): CompareVerdict {
  if (findings.some((f) => f.kind === VISUAL_MISMATCH)) return 'mismatch';
  if (findings.some((f) => f.kind === VISUAL_MATCH)) return 'match';
  return 'insufficient';
}

const FIELDS = new Set(['hair', 'eyes', 'build', 'face', 'clothing', 'marks', 'height', 'other']);
const fieldOf = (v: unknown) => (typeof v === 'string' && FIELDS.has(v) ? v : 'other');

export interface AiVisualJobDeps {
  repo: () => CoreRepository | null;
  generate: AiRoleDeps['generate'];
  resolveModel: AiRoleDeps['resolveModel'];
  loadTemplate?: AiRoleDeps['loadTemplate'];
  /** Байти зображення Медіатеки для цієї книги й цього автора; null — немає або чуже. */
  loadImage: (projectId: string, assetUrl: string, actor: string) => Promise<{ mimeType: string; data: string } | null>;
  /** Картка героя в Студії — затверджений опис зовнішності. */
  loadStudio?: (projectId: string, entity: EntityRow) => Promise<{ character: StudioCharacterLike | null; all: StudioCharacterLike[] }>;
}

/** Опис зовнішності з картки героя (канон автора). */
async function cardText(deps: AiVisualJobDeps, projectId: string, entity: EntityRow): Promise<string> {
  const st = deps.loadStudio ? await deps.loadStudio(projectId, entity).catch(() => undefined) : undefined;
  return studioAppearanceText(st?.character ?? null);
}

const chaptersText = (from: number | null, to: number | null) =>
  from && to ? `гл. ${from}–${to}` : from ? `з гл. ${from}` : to ? `до гл. ${to}` : 'уся книга';

export function aiVisualJobKind(deps: AiVisualJobDeps) {
  return {
    maxAttempts: 2,
    rateLimit: { max: 10, windowMs: 60_000 },
    handler: async (ctx: {
      job: { projectId: string; payload: Record<string, unknown>; createdBy: string };
      signal: AbortSignal;
      checkpoint(): Promise<void>;
      setProgress(p: Record<string, unknown>): Promise<void>;
      recordUsage(u: { tokens?: number; requests?: number }): Promise<void>;
    }) => {
      const { runAiRole } = await import('./ai/roles');
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const projectId = ctx.job.projectId;
      const mode = ctx.job.payload.mode === 'compare' ? 'compare' : 'recognize';
      const project = await repo.getProject(projectId);
      const roleDeps = { repo, generate: deps.generate, resolveModel: deps.resolveModel, loadTemplate: deps.loadTemplate, recordUsage: (u: { tokens: number; requests: number }) => ctx.recordUsage(u) };

      if (mode === 'compare') {
        const link = await repo.getAssetLink(projectId, String(ctx.job.payload.linkId ?? ''));
        if (!link || !link.entityId || link.status !== 'confirmed' || !VERSIONED_ROLES.includes(link.role)) return { mode, status: 'no_link' };
        const entity = await repo.getEntity(projectId, link.entityId);
        if (!entity) return { mode, status: 'no_link' };
        const version = link.appearanceVersionId ? await repo.getAppearanceVersion(projectId, link.appearanceVersionId) : null;
        const description = version ? version.description : await cardText(deps, projectId, entity);
        const hash = version ? version.descriptionHash : cardAppearanceHash(description);
        if (!description.trim()) return { mode, status: 'no_description', linkId: link.id };
        const image = await deps.loadImage(projectId, link.assetUrl, ctx.job.createdBy);
        if (!image) return { mode, status: 'no_image', linkId: link.id };
        await ctx.setProgress({ step: 'model', mode });
        await ctx.checkpoint();
        const res = await runAiRole(roleDeps, {
          projectId,
          role: 'AI-3',
          task: compareTask(link.assetUrl, entity.name, version?.label ?? null, description),
          paragraphs: [],
          images: [{ id: link.assetUrl, description: `зображення героя «${entity.name}» (${link.role})`, mimeType: image.mimeType, data: image.data }],
          entityId: entity.id,
          sourceRevision: project?.revision ?? null,
          createdBy: ctx.job.createdBy,
          signal: ctx.signal,
          prepare: async (f, ev) =>
            [VISUAL_MATCH, VISUAL_MISMATCH, VISUAL_UNKNOWN].includes(f.kind)
              ? [{ kind: f.kind, entityId: entity.id, payload: { linkId: link.id, field: fieldOf(f.field), descriptionHash: hash, mode }, paragraphIds: [], imageIds: ev.imageIds }]
              : [],
        });
        if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');
        const verdict = compareVerdict(res.findings);
        // «Перевірити» (В5): AI-3 звірив з тим самим описом, що й зараз, — застосувати підсумок.
        const now = link.appearanceVersionId ? (await repo.getAppearanceVersion(projectId, link.appearanceVersionId))?.descriptionHash : cardAppearanceHash(await cardText(deps, projectId, entity));
        let review: 'cleared' | 'flagged' | 'unchanged' = 'unchanged';
        if (res.status === 'done' && now === hash) {
          if (verdict === 'match' && (link.needsReview || link.checkedHash !== hash)) {
            await repo.setAssetLinkReview(projectId, link.id, { needsReview: false, checkedHash: hash });
            review = 'cleared';
          } else if (verdict === 'mismatch' && !link.needsReview) {
            await repo.setAssetLinkReview(projectId, link.id, { needsReview: true });
            review = 'flagged';
          }
        }
        return {
          mode,
          status: res.status,
          runId: res.run.id,
          linkId: link.id,
          verdict,
          review,
          matches: res.findings.filter((f) => f.kind === VISUAL_MATCH).length,
          mismatches: res.findings.filter((f) => f.kind === VISUAL_MISMATCH).length,
          unknown: res.findings.filter((f) => f.kind === VISUAL_UNKNOWN).length,
          errors: res.errors,
        };
      }

      // ── Розпізнати ──
      const assetUrl = String(ctx.job.payload.assetUrl ?? '');
      const image = await deps.loadImage(projectId, assetUrl, ctx.job.createdBy);
      if (!image) return { mode, status: 'no_image' };
      const entities = (await repo.listEntities(projectId))
        .filter((e) => e.status !== 'rejected' && VISUAL_ENTITY_TYPES.includes(e.type))
        .sort((a, b) => Number(b.type === 'character') - Number(a.type === 'character') || a.name.localeCompare(b.name, 'uk'))
        .slice(0, VISUAL_MAX_ENTITIES);
      const versions = await repo.listAppearanceVersions(projectId);
      const heroes: HeroDescription[] = [];
      for (const e of entities.filter((x) => x.type === 'character')) {
        heroes.push({
          entityId: e.id,
          name: e.name,
          card: clip(await cardText(deps, projectId, e), 800),
          versions: versions
            .filter((v) => v.entityId === e.id && v.approved)
            .map((v) => ({ label: v.label, chapters: chaptersText(v.fromChapter, v.toChapter), description: clip(v.description, 600) })),
        });
      }
      const byName = new Map<string, EntityRow>();
      for (const e of entities) byName.set(`${e.type}\u0000${e.name.toLocaleLowerCase('uk')}`, e);
      const findEntity = async (type: unknown, name: unknown): Promise<EntityRow | null> => {
        const n = String(name ?? '').trim();
        if (!n) return null;
        const t = String(type ?? '').trim();
        if (t) {
          const direct = byName.get(`${t}\u0000${n.toLocaleLowerCase('uk')}`);
          if (direct) return direct;
          const id = await repo.resolveAlias(projectId, t, n);
          return id ? entities.find((e) => e.id === id) ?? null : null;
        }
        return entities.find((e) => e.name.toLocaleLowerCase('uk') === n.toLocaleLowerCase('uk')) ?? null;
      };
      const existing = await repo.listAssetLinks(projectId, { assetUrl });
      const has = (entityId: string, role: AssetRole) => existing.some((l) => l.entityId === entityId && l.role === role);
      const proposed = new Set<string>();
      await ctx.setProgress({ step: 'model', mode, entities: entities.length });
      await ctx.checkpoint();
      const res = await runAiRole(roleDeps, {
        projectId,
        role: 'AI-3',
        task: recognizeTask(assetUrl, entities, heroes),
        paragraphs: [],
        images: [{ id: assetUrl, description: 'ілюстрація з Медіатеки', mimeType: image.mimeType, data: image.data }],
        sourceRevision: project?.revision ?? null,
        createdBy: ctx.job.createdBy,
        signal: ctx.signal,
        prepare: async (f, ev) => {
          if (!ev.imageIds.length) return [];
          if (f.kind === VISUAL_LINK) {
            const e = await findEntity(f.entity_type, f.entity_name);
            if (!e) return [];
            const role = suggestedRoleFor(e.type);
            // Уже є (прив'язав автор, запропоновано раніше чи відхилено назавжди) — не пропонувати.
            if (has(e.id, role) || proposed.has(`${e.id}\u0000${role}`)) return [];
            proposed.add(`${e.id}\u0000${role}`);
            return [{ kind: VISUAL_LINK, entityId: e.id, payload: { role, entityName: e.name, entityType: e.type, mode }, paragraphIds: [], imageIds: ev.imageIds }];
          }
          if (f.kind === VISUAL_TRAIT || f.kind === VISUAL_MISMATCH) {
            const e = await findEntity(f.entity_type || 'character', f.entity_name);
            return [{ kind: f.kind, entityId: e?.id ?? null, payload: { field: fieldOf(f.field), entityName: e?.name ?? String(f.entity_name ?? ''), mode }, paragraphIds: [], imageIds: ev.imageIds }];
          }
          return [];
        },
      });
      if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');
      const links: AssetLinkRow[] = [];
      for (const f of res.findings.filter((x) => x.kind === VISUAL_LINK && x.entityId)) {
        links.push(
          await repo.upsertAssetLink({
            projectId,
            assetUrl,
            role: String((f.payload as any).role) as AssetRole,
            entityId: f.entityId,
            status: 'suggested',
            source: 'ai',
            evidence: [f.id],
            note: clip(String((f.payload as any).summary ?? ''), 500),
            createdBy: 'ai:AI-3',
          }),
        );
      }
      return {
        mode,
        status: res.status,
        runId: res.run.id,
        suggestedLinks: links.length,
        traits: res.findings.filter((f) => f.kind === VISUAL_TRAIT).length,
        mismatches: res.findings.filter((f) => f.kind === VISUAL_MISMATCH).length,
        rejected: res.rejected.length,
        errors: res.errors,
      };
    },
  };
}

/** Висновки AI-3 про зображення для Медіатеки: останнє розпізнавання й остання звірка кожного зв'язку. */
export function visualAnalysisView(findings: FindingRow[], assetUrl: string) {
  const mine = findings
    .filter((f) => VISUAL_KINDS.includes(f.kind) && f.sourceAssetIds.includes(assetUrl) && f.status !== 'rejected')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const view = (f: FindingRow) => ({
    id: f.id,
    kind: f.kind,
    entityId: f.entityId,
    entityName: String((f.payload as any).entityName ?? ''),
    field: String((f.payload as any).field ?? ''),
    summary: String((f.payload as any).summary ?? ''),
    confidence: Number((f.payload as any).confidence ?? 0),
    status: f.status,
    insufficientData: f.insufficientData,
    at: f.createdAt,
  });
  const recognizeRun = mine.find((f) => (f.payload as any).mode !== 'compare' && f.kind !== VISUAL_MATCH && f.kind !== VISUAL_UNKNOWN)?.runId ?? null;
  const recognize = recognizeRun ? mine.filter((f) => f.runId === recognizeRun && (f.payload as any).mode !== 'compare').map(view) : [];
  const compare: Record<string, { verdict: CompareVerdict; at: string; items: ReturnType<typeof view>[] }> = {};
  for (const f of mine.filter((x) => (x.payload as any).mode === 'compare')) {
    const linkId = String((f.payload as any).linkId ?? '');
    if (!linkId || compare[linkId]) continue;
    const run = mine.filter((x) => x.runId === f.runId && (x.payload as any).linkId === linkId);
    compare[linkId] = { verdict: compareVerdict(run), at: f.createdAt, items: run.map(view) };
  }
  return { recognize, compare };
}

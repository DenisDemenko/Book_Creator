/**
 * AI-2 «стан світу» по розділах (Т2.4 В6, `PLAN_CONTINUITY.md` §2, §3 В6):
 * лише за командою автора, фоновою задачею `ai_continuity` з бюджетом
 * проєкту — один прохід на один розділ.
 *
 * Що бачить модель. Текст розділу (усі його абзаци) і «стан світу станом на
 * цей розділ» — без спойлерів із майбутнього (той самий прийом, що й
 * `ProfileOptions.upto` у Profile Builder): абзаци РАНІШИХ за порядком
 * розкриття розділів, де згадано ті самі сутності, що й у цьому (найсвіжіші
 * першими, до `CONTINUITY_CONTEXT_MAX`), риси цих сутностей і вже відомі
 * проблеми цього розділу (щоб не повторювати). Доказ — лише абзаци, які
 * модель справді отримала (`runAiRole` відкидає решту).
 *
 * Що повертає. Два види висновків (усе — лише пропозиції, `suggested`):
 *   continuity_issue — суперечність, яку п'ять правил не ловлять текстовим
 *                      збігом (опис локації іншими словами, непряме
 *                      розкриття факту…): вид (object/knowledge/place/age/
 *                      time), дві сторони — ранній абзац і абзац цього
 *                      розділу → `continuity_issues` (source: ai);
 *   continuity_trait — стійка риса сутності, прямо названа в цьому розділі
 *                      («очі сірі», «міст кам'яний») → `entity_traits`
 *                      (source: ai, suggested — автор підтверджує, як факти
 *                      Profile Builder); підтверджена риса далі живить
 *                      правило `trait_contradiction` (В3/В5).
 *
 * Висновок моделі лишається в `analysis_findings` (аудит: прогін, модель,
 * доказ), а проблема й риса — окремі рядки, з якими працює сторінка 8.
 *
 * Повторна перевірка змінених місць (другий бік В6) — `continuity.ts:
 * refreshContinuityReview` (відбиток абзаців-доказів, викликає синхронізація)
 * і прогін AI-2 лише по розділах, де такі проблеми є (`changed` у маршруті):
 * проблема «на перегляд», яку AI-2 знайшов знову, повертається в
 * `suggested` з новим відбитком, а не дублюється.
 */

import type { AiRoleDeps, ModelFinding, PreparedFinding } from './ai/roles';
import type { ContinuityEvidence, ContinuityIssueKind, ContinuityIssueRow, CoreRepository, EntityRow, EntityTraitRow } from './types';
import { CONTINUITY_ISSUE_KINDS } from './types';
import { scanScenes, type TimelineScene } from './timeline';
import { paragraphExcerpt } from './search/text';
import { continuityEvidenceHash } from './continuity';

export const AI_CONTINUITY_JOB_KIND = 'ai_continuity';
export const CONTINUITY_ISSUE_FINDING = 'continuity_issue';
export const CONTINUITY_TRAIT_FINDING = 'continuity_trait';
/** Від чийого імені пише AI-2 — той самий актор, що й висновки ролі (`runAiRole`). */
export const CONTINUITY_AI_ACTOR = 'ai:AI-2';

/** Скільки абзаців розділу йде в прогін (довший розділ — лише початок; решта — наступним розділом не стане, тому скажемо про це). */
export const CONTINUITY_SECTION_MAX = 80;
/** Скільки абзаців із раніших розділів — «стан світу» (найсвіжіші першими). */
export const CONTINUITY_CONTEXT_MAX = 40;
/** Скільки рис показати моделі. */
export const CONTINUITY_TRAITS_MAX = 120;
/** Скільки розділів можна поставити однією командою. */
export const CONTINUITY_SECTIONS_PER_REQUEST = 10;

const norm = (s: string) => s.toLocaleLowerCase('uk').replace(/[\s.,;:!?«»"'()—–-]+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface ContinuityWorldState {
  scene: TimelineScene;
  /** Абзаци цього розділу (у порядку тексту). */
  current: { id: string; text: string }[];
  /** Розділ довший за `CONTINUITY_SECTION_MAX` — модель бачила лише початок. */
  truncated: boolean;
  /** Абзаци раніших розділів про ті самі сутності (у порядку книги). */
  earlier: { id: string; text: string; sectionId: string }[];
  /** Раніші розділи, з яких узято абзаци: назва, глава, час світу. */
  earlierScenes: TimelineScene[];
  /** Сутності, згадані в цьому розділі. */
  entities: EntityRow[];
  /** Риси цих сутностей, встановлені раніше чи в цьому розділі (без відхилених). */
  traits: (EntityTraitRow & { entityName: string })[];
  /** Проблеми, що вже стосуються цього розділу (будь-який статус) — модель їх не повторює. */
  known: ContinuityIssueRow[];
}

/**
 * «Стан світу станом на розділ» — усе, що бачить AI-2 в одному прогоні.
 * `null` — розділу немає (видалено, не синхронізовано).
 */
export async function continuityWorldState(repo: CoreRepository, projectId: string, sectionId: string): Promise<ContinuityWorldState | null> {
  const [points, traitsAll, issues] = await Promise.all([
    repo.listTimePoints(projectId),
    repo.listEntityTraits(projectId),
    repo.listContinuityIssues(projectId),
  ]);
  const scan = await scanScenes(repo, projectId, points);
  const scene = scan.bySection.get(sectionId);
  if (!scene) return null;
  const position = (id: string) => scan.ix.paragraphs.get(id)?.order ?? 0;

  const own = [...scan.ix.paragraphs.values()]
    .filter((p) => !p.deletedAt && p.documentId === sectionId && p.text.trim())
    .sort((a, b) => a.order - b.order);
  const current = own.slice(0, CONTINUITY_SECTION_MAX).map((p) => ({ id: p.id, text: p.text }));

  // Сутності розділу: згадки тегами й суб'єкти згадок.
  const entityIds = new Set<string>();
  for (const m of scan.mentions) {
    if (scan.sectionOfParagraph.get(m.paragraphId) !== sectionId) continue;
    entityIds.add(m.entityId);
    if (m.subjectEntityId) entityIds.add(m.subjectEntityId);
  }
  const entities = [...entityIds].map((id) => scan.entities.get(id)).filter((e): e is EntityRow => !!e);

  // Раніші розділи — за порядком розкриття (те, що читач уже знає).
  const earlierSections = new Set(scan.scenes.filter((s) => s.narrativeIndex < scene.narrativeIndex).map((s) => s.sectionId));
  const candidate = new Set<string>();
  for (const m of scan.mentions) {
    const sid = scan.sectionOfParagraph.get(m.paragraphId);
    if (!sid || !earlierSections.has(sid)) continue;
    if (entityIds.has(m.entityId) || (m.subjectEntityId && entityIds.has(m.subjectEntityId))) candidate.add(m.paragraphId);
  }
  const earlierRows = [...candidate]
    .map((id) => scan.ix.paragraphs.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p && !p.deletedAt && !!p.text.trim())
    .sort((a, b) => scan.bySection.get(b.documentId)!.narrativeIndex - scan.bySection.get(a.documentId)!.narrativeIndex || position(b.id) - position(a.id))
    .slice(0, CONTINUITY_CONTEXT_MAX)
    .sort((a, b) => scan.bySection.get(a.documentId)!.narrativeIndex - scan.bySection.get(b.documentId)!.narrativeIndex || position(a.id) - position(b.id));
  const earlier = earlierRows.map((p) => ({ id: p.id, text: p.text, sectionId: p.documentId }));
  const earlierScenes = scan.scenes.filter((s) => earlier.some((p) => p.sectionId === s.sectionId));

  const nameOf = new Map(entities.map((e) => [e.id, e.name]));
  const traits = traitsAll
    .filter((t) => nameOf.has(t.entityId) && t.status !== 'rejected' && (!t.sectionId || t.sectionId === sectionId || earlierSections.has(t.sectionId)))
    .slice(0, CONTINUITY_TRAITS_MAX)
    .map((t) => ({ ...t, entityName: nameOf.get(t.entityId)! }));

  const known = issues.filter((i) => i.evidenceA.sectionId === sectionId || i.evidenceB?.sectionId === sectionId);
  return { scene, current, truncated: own.length > current.length, earlier, earlierScenes, entities, traits, known };
}

/** Завдання AI-2 для одного розділу. */
export function continuityTask(w: ContinuityWorldState): string {
  const when = (s: TimelineScene) => (s.time ? `, час світу: ${s.time.label || s.time.start}` : '');
  const head = `розділ «${w.scene.title}» (гл. ${w.scene.chapterNumber ?? '?'}${when(w.scene)})`;
  const earlierList = w.earlierScenes
    .map((s) => `- «${s.title}» (гл. ${s.chapterNumber ?? '?'}${when(s)}): ${w.earlier.filter((p) => p.sectionId === s.sectionId).map((p) => p.id).join(', ')}`)
    .join('\n');
  const traits = w.traits.map((t) => `- ${t.entityName}: «${t.label}» = «${t.value}» (${t.status}${t.source === 'ai' ? ', від AI' : ''})`).join('\n');
  const known = w.known.filter((i) => i.status !== 'needs_review').map((i) => `- [${i.kind}] ${clip(i.summary, 200)} (${i.status})`).join('\n');
  const recheck = w.known
    .filter((i) => i.status === 'needs_review')
    .map((i) => `- [${i.kind}] ${clip(i.summary, 200)}; абзаци: ${[i.evidenceA.paragraphId, i.evidenceB?.paragraphId].filter(Boolean).join(', ')}`)
    .join('\n');
  return [
    `Перевір безперервність: ${head} проти того, що книга вже встановила раніше.`,
    `Абзаци ЦЬОГО розділу: ${w.current.map((p) => p.id).join(', ') || '(немає)'}${w.truncated ? ' (розділ довший — дано лише початок)' : ''}.`,
    earlierList ? `Абзаци РАНІШИХ розділів про тих самих героїв, місця й предмети (стан світу; майбутнього тобі не дано):\n${earlierList}` : 'Раніших абзаців про ці сутності немає — суперечностей з минулим тут не буде; шукай лише всередині розділу.',
    `1) kind "continuity_issue" — суперечність: цей розділ не сходиться з раніше встановленим (чи сам із собою). Поле "issue_kind" — одне з: ${CONTINUITY_ISSUE_KINDS.join(', ')} (object — предмет: власник, стан, де лежить; knowledge — герой знає те, чого ще не міг знати; place — хто де, опис місця; age — вік; time — час, тривалість, порядок подій).`,
    `   entity_type і entity_name — головна сутність суперечності; paragraph_ids — РІВНО дві сторони: спершу абзац, де встановлено раніше, потім абзац ЦЬОГО розділу, що йому суперечить; quote — дослівно з абзацу цього розділу; summary — «раніше …, тут …». Якщо другої сторони в даних немає — insufficient_data: true і лише абзац цього розділу.`,
    `   Не пиши про різне формулювання того самого, про зміну, яку текст пояснює (виріс, переїхав, переклеїв шпалери), чи про думки й брехню героїв — лише про справжню суперечність фактів.`,
    `2) kind "continuity_trait" — стійка риса сутності, прямо названа в ЦЬОМУ розділі (зовнішність, вік, матеріал, колір, розмір, власник): entity_type, entity_name, "label" — коротка мітка («колір очей», «вік», «матеріал»), "value" — значення; summary — те саме реченням («у Олени карі очі»); paragraph_ids — абзац цього розділу; quote. Не емоції й не стани на хвилину. Уже відомих рис (нижче) з тим самим значенням не повторюй.`,
    `Не вигадуй: лише те, що є в абзацах.`,
    traits ? `Відомі риси цих сутностей:\n${traits}` : 'Відомих рис цих сутностей немає.',
    known ? `Уже відомі проблеми цього розділу (не повторювати):\n${known}` : '',
    recheck ? `Текст цих місць змінився після перевірки — перевір знову: якщо суперечність лишилась, поверни її з ТИМИ САМИМИ абзацами; якщо зникла — не повертай:\n${recheck}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface ContinuityPrepared {
  issueKind?: ContinuityIssueKind;
  label?: string;
  value?: string;
  entityName?: string;
  /** Проблема «на перегляд» з тими самими двома абзацами — оновити її, а не створювати нову. */
  refreshIssueId?: string;
}

/**
 * Обробка висновків AI-2: лише два види, доказ — абзац цього розділу
 * обов'язково; без повторів (ті самі два абзаци й той самий вид — уже є;
 * та сама риса з тим самим значенням — уже є, хоч і відхилена автором).
 */
export function createContinuityPreparer(repo: CoreRepository, projectId: string, w: ContinuityWorldState, existingTraits: EntityTraitRow[]) {
  const currentIds = new Set(w.current.map((p) => p.id));
  const byName = new Map<string, EntityRow>();
  for (const e of w.entities) byName.set(`${e.type}\u0000${e.name.toLocaleLowerCase('uk')}`, e);
  const findEntity = async (type: unknown, name: unknown): Promise<EntityRow | null> => {
    const n = String(name ?? '').trim();
    if (!n) return null;
    const t = String(type ?? '').trim();
    if (t) {
      const direct = byName.get(`${t}\u0000${n.toLocaleLowerCase('uk')}`);
      if (direct) return direct;
      const id = await repo.resolveAlias(projectId, t, n);
      if (id) return (await repo.getEntity(projectId, id)) ?? null;
    }
    return w.entities.find((e) => e.name.toLocaleLowerCase('uk') === n.toLocaleLowerCase('uk')) ?? null;
  };
  const pairKey = (kind: string, ids: (string | null | undefined)[]) => `${kind}|${ids.filter(Boolean).sort().join('|')}`;
  const knownPairs = new Map<string, ContinuityIssueRow>();
  for (const i of w.known) knownPairs.set(pairKey(i.kind, [i.evidenceA.paragraphId, i.evidenceB?.paragraphId]), i);
  const knownSummaries = new Set(w.known.map((i) => norm(i.summary)));
  const traitKey = (entityId: string, label: string, value: string) => `${entityId}|${norm(label)}|${norm(value)}`;
  const traitsSeen = new Set(existingTraits.map((t) => traitKey(t.entityId, t.label, t.value)));
  const refreshed = new Set<string>();

  return async (f: ModelFinding, evidence: { paragraphIds: string[] }): Promise<PreparedFinding[]> => {
    const own = evidence.paragraphIds.filter((id) => currentIds.has(id));
    if (!own.length) return [];
    if (f.kind === CONTINUITY_ISSUE_FINDING) {
      const issueKind = String(f.issue_kind ?? '') as ContinuityIssueKind;
      if (!CONTINUITY_ISSUE_KINDS.includes(issueKind)) return [];
      const summary = String(f.summary ?? '').trim();
      if (!summary) return [];
      const ids = evidence.paragraphIds.slice(0, 2);
      const prev = knownPairs.get(pairKey(issueKind, ids));
      let refreshIssueId: string | undefined;
      if (prev) {
        // Уже є. Лише «на перегляд» (текст змінився) — AI-2 підтвердив знову: оновити ту саму.
        if (prev.status !== 'needs_review' || refreshed.has(prev.id)) return [];
        refreshIssueId = prev.id;
        refreshed.add(prev.id);
      } else if (knownSummaries.has(norm(summary))) {
        return [];
      }
      knownSummaries.add(norm(summary));
      const e = await findEntity(f.entity_type, f.entity_name);
      const payload: ContinuityPrepared = { issueKind, entityName: e?.name ?? String(f.entity_name ?? ''), ...(refreshIssueId ? { refreshIssueId } : {}) };
      return [{ kind: CONTINUITY_ISSUE_FINDING, entityId: e?.id ?? null, payload: payload as Record<string, unknown>, paragraphIds: ids }];
    }
    if (f.kind === CONTINUITY_TRAIT_FINDING) {
      const e = await findEntity(f.entity_type, f.entity_name);
      const label = String(f.label ?? '').trim();
      const value = String(f.value ?? '').trim();
      if (!e || !label || !value || label.length > 80 || value.length > 400) return [];
      const key = traitKey(e.id, label, value);
      if (traitsSeen.has(key)) return [];
      traitsSeen.add(key);
      const payload: ContinuityPrepared = { label, value, entityName: e.name };
      return [{ kind: CONTINUITY_TRAIT_FINDING, entityId: e.id, payload: payload as Record<string, unknown>, paragraphIds: [own[0]] }];
    }
    return [];
  };
}

export interface AiContinuityJobDeps {
  repo: () => CoreRepository | null;
  generate: AiRoleDeps['generate'];
  resolveModel: AiRoleDeps['resolveModel'];
  loadTemplate?: AiRoleDeps['loadTemplate'];
}

export function aiContinuityJobKind(deps: AiContinuityJobDeps) {
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
      const { runAiRole } = await import('./ai/roles');
      const repo = deps.repo();
      if (!repo) throw new Error('Ядро недоступне');
      const projectId = ctx.job.projectId;
      const sectionId = String(ctx.job.payload.sectionId ?? '');
      const w = await continuityWorldState(repo, projectId, sectionId);
      if (!w) return { status: 'no_section', sectionId };
      if (!w.current.length) return { status: 'nothing', sectionId };
      const existingTraits = await repo.listEntityTraits(projectId);
      const project = await repo.getProject(projectId);
      await ctx.setProgress({ step: 'model', sectionId, paragraphs: w.current.length, context: w.earlier.length });
      await ctx.checkpoint();
      const res = await runAiRole(
        { repo, generate: deps.generate, resolveModel: deps.resolveModel, loadTemplate: deps.loadTemplate, recordUsage: (u) => ctx.recordUsage(u) },
        {
          projectId,
          role: 'AI-2',
          task: continuityTask(w),
          paragraphs: [...w.earlier.map((p) => ({ id: p.id, text: p.text })), ...w.current],
          sourceRevision: project?.revision ?? null,
          createdBy: ctx.job.createdBy,
          signal: ctx.signal,
          prepare: createContinuityPreparer(repo, projectId, w, existingTraits),
        },
      );
      if (res.status === 'failed') throw new Error(res.errors[0] ?? 'Виклик моделі не вдався');

      // Висновки → рядки сторінки 8.
      const ix = new Map([...w.earlier, ...w.current].map((p) => [p.id, p]));
      const sectionOf = new Map<string, string>([...w.earlier.map((p) => [p.id, p.sectionId] as [string, string]), ...w.current.map((p) => [p.id, sectionId] as [string, string])]);
      const side = (paragraphId: string, entityId: string | null, quote?: string): ContinuityEvidence => {
        const text = ix.get(paragraphId)?.text ?? '';
        const q = quote && text.includes(quote) ? quote : paragraphExcerpt(text, 200).trim();
        return { sectionId: sectionOf.get(paragraphId)!, paragraphId, quote: clip(q || '(немає власного тексту в цьому місці)', 1000), entityId };
      };
      const currentIds = new Set(w.current.map((p) => p.id));
      const textOf = new Map([...ix.entries()].map(([id, x]) => [id, x.text]));
      let issues = 0;
      let refreshed = 0;
      let traits = 0;
      for (const f of res.findings) {
        const p = f.payload as ContinuityPrepared & { summary?: string; quote?: string };
        if (f.kind === CONTINUITY_ISSUE_FINDING && p.issueKind) {
          // Сторона Б — абзац цього розділу; сторона А — інший (раніший) абзац.
          const b = [...f.sourceParagraphIds].reverse().find((id) => currentIds.has(id))!;
          const a = f.sourceParagraphIds.find((id) => id !== b) ?? null;
          const evB = side(b, f.entityId, p.quote);
          const evA = a ? side(a, f.entityId) : evB;
          const insufficientData = !a;
          const summary = clip(String(p.summary ?? '').trim(), 500);
          await repo.upsertContinuityIssue({
            id: p.refreshIssueId,
            projectId,
            kind: p.issueKind,
            entityId: f.entityId,
            summary,
            evidenceA: evA,
            evidenceB: insufficientData ? null : evB,
            insufficientData,
            status: 'suggested',
            checkedHash: continuityEvidenceHash(textOf, evA, insufficientData ? null : evB),
            createdBy: CONTINUITY_AI_ACTOR,
          });
          p.refreshIssueId ? refreshed++ : issues++;
        } else if (f.kind === CONTINUITY_TRAIT_FINDING && f.entityId && p.label && p.value) {
          await repo.upsertEntityTrait({ projectId, entityId: f.entityId, label: p.label, value: p.value, sectionId, createdBy: CONTINUITY_AI_ACTOR });
          traits++;
        }
      }
      return {
        status: res.status,
        runId: res.run.id,
        sectionId,
        issues,
        refreshed,
        traits,
        rejected: res.rejected.length,
        paragraphs: w.current.length,
        context: w.earlier.length,
        truncated: w.truncated,
        errors: res.errors,
      };
    },
  };
}

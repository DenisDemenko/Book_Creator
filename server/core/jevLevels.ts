/**
 * Три рівні Jev Character Decision Engine (Т2.5 В3; FLC 2.0 §3;
 * `PLAN_JEV_LEVELS.md` §2).
 *
 *   • стратегічний — довгі цілі, конфлікт мотивів, траєкторія; рахується
 *     наново лише після ЗНАЧУЩОЇ події (рішення власника §6 п.3): нові чи
 *     змінені сюжетні теги з героєм (поріг, поворот, рішення, розкриття,
 *     наслідок, подія, конфлікт — `EVENT_TYPES`, де герой суб'єкт чи
 *     присутній), підтверджені факти профілю, канон автора (картка героя),
 *     цілі й потреби героя. Емоції, звичайні абзаци й правки без таких тегів
 *     стратегічного рішення не зачіпають;
 *   • сценічний — мотив у сцені, страх, довіра, ризик; до зміни умов сцени
 *     (ситуація, учасники, мета сцени, дозволене / заборонене) чи «повороту»
 *     від режисера (`turnMark`) — і до нового стратегічного рішення;
 *   • тактичний — наступна дія з дозволеного списку, відповідність стилю,
 *     перевірки Noul; щоразу (повторно — лише той самий знімок у тому самому
 *     ході прогону).
 *
 * Питання кожного рівня — атомарні (ТЗ-H §6.2) і задані ДАНИМИ
 * (`DEFAULT_LEVEL_CONFIG`), а не кодом: згодом конфігурація на жанр чи сцену.
 * Кожне рішення — у журналі `character_decisions` (В2): відбиток знімка,
 * модель, джерело, підстави-посилання, ключ кешу, ланцюжок `parent_id`
 * (тактичне → сценічне → стратегічне). Той самий ключ — те саме рішення з
 * таблиці, без виклику Jev.
 *
 * В4 — серверний валідатор і рішення автора (`server/ai/validator.ts`;
 * рішення власника §6 п.4): кожна відповідь проходить жорсткі обмеження
 * рівня; ланцюжок — Jev → запасний LLM → **рішення автора** (запис
 * `awaiting_author`, без автовибору), причини кожного переходу — у журналі.
 * Низька впевненість Jev (нижче порогу конфігурації) — одразу автору: LLM
 * замість нього не вгадує. Поки рівень чекає автора, нижчі рівні не
 * рахуються (`blockedAt`), а повторний запит повертає те саме очікування
 * без нового виклику Jev; вибір автора (`resolveByAuthor`) — лише з
 * допустимих варіантів, і далі це рішення — кеш рівня, як будь-яке інше.
 */

import { createHash } from 'node:crypto';
import type { CharacterDecisionLevel, CharacterDecisionRow, CoreActor, CoreRepository, EntityRow } from './types';
import { buildCharacterProfile, EVENT_TYPES, PROFILE_FACT, type StudioCharacterLike } from './characterProfile';
import { scanScenes } from './timeline';
import { snapshotFromProfile } from './flc/cycle';
import { canonicalJson, snapshotHash, validateSnapshot, type CharacterSnapshot, type DecisionResult, type JevQuestion } from '../ai/contracts';
import type { JevAdapter } from '../ai/adapters/jev';
import { validateHard, type HardConstraints, type ValidationOutcome } from '../ai/validator';
import { CoreRuleError } from './rules';

// ── Конфігурація рівнів (дані, не код) ─────────────────────────────────────

export interface LevelQuestionConfig {
  /** Головний вибір рівня (його відповідь — `selected_action`). */
  primary: { id: string; instructions: string; options: Record<string, string> };
  scores: { id: string; instructions: string; levels: string[] }[];
}

export interface LevelConfig {
  /** Змінилась конфігурація — змінились ключі кешу (стара відповідь на інші питання вже не та). */
  version: string;
  strategic: LevelQuestionConfig & { goalInstructions: string };
  scene: LevelQuestionConfig;
  tactical: { instructions: string; describe: Record<string, string>; styleFit: { id: string; instructions: string; levels: string[] } };
  /** Нижче цього `confidence` — на розгляд автору (В4, рішення власника §6 п.4). */
  confidenceThreshold: number;
}

const FIVE = (a: string, b: string, c: string, d: string, e: string) => [a, b, c, d, e];

export const DEFAULT_LEVEL_CONFIG: LevelConfig = {
  version: 'levels-v1',
  strategic: {
    primary: {
      id: 'trajectory',
      instructions: 'Яка траєкторія розвитку героя зараз, зважаючи лише на наданий стан і пережите?',
      options: { hold_course: 'тримає курс на свою мету', waver: 'вагається, сумнівається в меті', change_goal: 'змінює мету', break_down: 'ламається, втрачає опору' },
    },
    goalInstructions: 'Яка з цілей героя зараз провідна в довгій перспективі?',
    scores: [{ id: 'motive_conflict', instructions: 'Наскільки сильний конфлікт мотивів героя?', levels: FIVE('конфлікту немає', 'слабкий', 'помітний', 'сильний', 'роздирає героя') }],
  },
  scene: {
    primary: {
      id: 'scene_motive',
      instructions: 'Який мотив веде героя в цій сцені?',
      options: {
        protect_self: 'захистити себе',
        protect_other: 'захистити когось іншого',
        seek_truth: 'дізнатися правду',
        gain_advantage: 'здобути перевагу',
        avoid_conflict: 'уникнути сутички',
        hide_secret: 'приховати таємницю',
      },
    },
    scores: [
      { id: 'fear', instructions: 'Наскільки сильний страх героя в цій сцені?', levels: FIVE('спокій', 'легке занепокоєння', 'помітний страх', 'сильний страх', 'паніка') },
      { id: 'trust', instructions: 'Наскільки герой довіряє іншим учасникам сцени?', levels: FIVE('зовсім не довіряє', 'насторожений', 'нейтрально', 'довіряє', 'повністю довіряє') },
      { id: 'risk', instructions: 'Наскільки герой готовий ризикувати в цій сцені?', levels: FIVE('уникає будь-якого ризику', 'обережний', 'зважує', 'готовий ризикнути', 'іде ва-банк') },
    ],
  },
  tactical: {
    instructions: 'Яку дію з дозволеного списку обере герой у цей хід, зважаючи лише на наданий стан?',
    describe: { answer: 'відповісти чесно', lie: 'збрехати', silence: 'промовчати', deflect: 'ухилитися, змінити тему', attack: 'перейти в наступ', confess: 'зізнатися', leave: 'піти', ask: 'запитати' },
    styleFit: { id: 'style_fit', instructions: 'Наскільки реакція героя в цій ситуації відповідає його встановленому стилю поведінки?', levels: FIVE('зовсім не схоже на героя', 'нетипово', 'можливо', 'типово', 'цілком у його стилі') },
  },
  confidenceThreshold: 0.35,
};

export const DEFAULT_TACTICAL_ACTIONS = ['answer', 'lie', 'silence', 'deflect'];

// ── Запит і відповідь ──────────────────────────────────────────────────────

export interface DecideRequest {
  projectId: string;
  characterId: string;
  level: CharacterDecisionLevel;
  actor: CoreActor;
  /** Межа знань героя: глави 1…N; без — уся книга. */
  asOfChapter?: number | null;
  /** Сцена (розділ книги чи сцена симуляції). */
  sceneId?: string | null;
  /** Ситуація сцени (сценічний рівень) чи ходу (тактичний). */
  situation?: string;
  /** Умови сцени — ключ сценічного кешу. */
  participants?: string[];
  sceneGoal?: string;
  /** «Поворот» від режисера: нове значення — сценічний рівень рахується наново. */
  turnMark?: string;
  allowedActions?: string[];
  forbiddenActions?: string[];
  /** Перевірки Noul тактичного рівня («чи узгоджується X зі знімком»). */
  checks?: string[];
  simulationId?: string | null;
  turnIndex?: number | null;
}

export interface DecideResult {
  decision: CharacterDecisionRow;
  /** Узято з журналу без виклику Jev (ключ кешу той самий). */
  reused: boolean;
  /** Батьківські рівні, що знадобились (і чи вони теж з кешу). */
  chain: { level: CharacterDecisionLevel; id: string; reused: boolean }[];
  /** Рішення чекає автора (В4): `decision` — цей запис очікування. */
  awaitingAuthor: boolean;
  /** Рівень, на якому ланцюжок зупинився через очікування автора (нижчі не рахувались). */
  blockedAt: CharacterDecisionLevel | null;
}

export interface JevLevelsDeps {
  repo: CoreRepository;
  /** Справжній Jev (null — ключа немає) і запасний шлях (LLM зі структурованою відповіддю). */
  jev: JevAdapter | null;
  fallback: JevAdapter;
  /** Картка героя в Студії — канон автора. */
  studio?: (projectId: string, entity: EntityRow) => Promise<{ character: StudioCharacterLike | null; all: StudioCharacterLike[] } | undefined>;
  config?: LevelConfig;
}

const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 32);
const actionId = (s: string) => /^[a-z_]{2,40}$/.test(s);

// ── Значущі події (ключ стратегічного рівня) ─────────────────────────────────

export interface SignificantState {
  key: string;
  events: { entityId: string; name: string; type: string; sectionId: string; via: 'subject' | 'present'; value: string }[];
  goals: { entityId: string; name: string; type: string; value: string }[];
  facts: { id: string; statement: string }[];
  canon: { label: string; value: string }[];
  paragraphIds: string[];
}

/**
 * Усе, від чого залежить стратегічне рішення героя станом на главу N, — і
 * відбиток цього (рішення власника §6 п.3). Змінилось лише те, чого тут
 * немає (емоція, звичайний абзац, правка без сюжетних тегів) — відбиток той
 * самий, стратегічне рішення не перераховується.
 */
export async function significantState(
  repo: CoreRepository,
  projectId: string,
  characterId: string,
  opts: { asOfChapter?: number | null; canon: { label: string; value: string }[]; version: string },
): Promise<SignificantState> {
  const scan = await scanScenes(repo, projectId, await repo.listTimePoints(projectId));
  const upto = opts.asOfChapter ?? null;
  const inRange = (sectionId: string) => {
    const s = scan.bySection.get(sectionId);
    return !!s && (upto == null || (s.chapterNumber ?? 0) <= upto);
  };
  const heroScenes = new Set(scan.scenes.filter((s) => s.characters.some((c) => c.id === characterId)).map((s) => s.sectionId));
  const events: SignificantState['events'] = [];
  const goals: SignificantState['goals'] = [];
  const paragraphIds = new Set<string>();
  for (const m of scan.mentions) {
    const e = scan.entities.get(m.entityId);
    const sectionId = scan.sectionOfParagraph.get(m.paragraphId);
    if (!e || !sectionId || !inRange(sectionId)) continue;
    const value = String((m.fields as { value?: unknown })?.value ?? '');
    if (EVENT_TYPES.has(e.type)) {
      const via = m.subjectEntityId === characterId ? 'subject' : heroScenes.has(sectionId) ? 'present' : null;
      if (!via) continue;
      events.push({ entityId: e.id, name: e.name, type: e.type, sectionId, via, value });
      paragraphIds.add(m.paragraphId);
    } else if ((e.type === 'goal' || e.type === 'need') && m.subjectEntityId === characterId) {
      goals.push({ entityId: e.id, name: e.name, type: e.type, value });
      paragraphIds.add(m.paragraphId);
    }
  }
  const facts = (await repo.listFindings(projectId, { entityId: characterId, status: 'confirmed' }))
    .filter((f) => f.kind === PROFILE_FACT && f.visibility !== 'hidden')
    .filter((f) => f.sourceParagraphIds.some((p) => {
      const sid = scan.sectionOfParagraph.get(p);
      return !!sid && inRange(sid);
    }))
    .map((f) => ({ id: f.id, statement: String((f.payload as { statement?: unknown }).statement ?? '') }));
  const sort = <T>(xs: T[]) => [...xs].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
  const key = hash({ v: opts.version, upto, events: sort(events), goals: sort(goals), facts: sort(facts), canon: sort(opts.canon) });
  return { key, events, goals, facts, canon: opts.canon, paragraphIds: [...paragraphIds] };
}

// ── Рушій рівнів ───────────────────────────────────────────────────────────

export class JevDecisionAdapter {
  private readonly config: LevelConfig;
  constructor(private readonly deps: JevLevelsDeps) {
    this.config = deps.config ?? DEFAULT_LEVEL_CONFIG;
  }

  /** Рішення рівня — з кешу, якщо ключ той самий, інакше через Jev (із запасним шляхом). Батьківські рівні — спершу. */
  async decide(req: DecideRequest): Promise<DecideResult> {
    const chain: DecideResult['chain'] = [];
    const done = (r: { decision: CharacterDecisionRow; reused: boolean }, level: CharacterDecisionLevel): DecideResult => {
      const waiting = r.decision.status === 'awaiting_author';
      return { ...r, chain, awaitingAuthor: waiting, blockedAt: waiting ? level : null };
    };
    const strategic = await this.strategic(req);
    if (req.level === 'strategic' || strategic.decision.status === 'awaiting_author') return done(strategic, 'strategic');
    chain.push({ level: 'strategic', id: strategic.decision.id, reused: strategic.reused });
    const scene = await this.scene(req, strategic.decision);
    if (req.level === 'scene' || scene.decision.status === 'awaiting_author') return done(scene, 'scene');
    chain.push({ level: 'scene', id: scene.decision.id, reused: scene.reused });
    const tactical = await this.tactical(req, scene.decision);
    return done(tactical, 'tactical');
  }

  /**
   * Рішення автора для запису «чекає автора» (В4): дія — лише з допустимих
   * варіантів цього рішення (дозволені й не заборонені), джерело `author`;
   * далі воно чинне й кешується, як будь-яке інше.
   */
  async resolveByAuthor(projectId: string, decisionId: string, action: string, actor: CoreActor): Promise<CharacterDecisionRow> {
    const d = await this.deps.repo.getCharacterDecision(projectId, decisionId);
    if (!d) throw new CoreRuleError('not_found', `Рішення «${decisionId}»`);
    if (d.status !== 'awaiting_author') throw new CoreRuleError('conflict', 'Рішення вже прийнято — вибір автора потрібен лише для «чекає автора»');
    const primary = (d.options.primary ?? {}) as { id?: string; allowed?: string[]; forbidden?: string[] };
    const allowed = (primary.allowed ?? []).filter((a) => !(primary.forbidden ?? []).includes(a));
    if (!allowed.includes(action)) throw new CoreRuleError('bad_input', `Дія «${action}» — не з допустимих: ${allowed.join(', ')}`);
    const partial = (d.result ?? {}) as Partial<DecisionResult>;
    const result: DecisionResult = {
      selected_action: action,
      scores: partial.scores ?? {},
      raw_distributions: partial.raw_distributions ?? {},
      confidence: null,
      model_version: d.modelVersion,
      snapshot_hash: d.snapshotHash,
      decision_trace_id: partial.decision_trace_id ?? d.id,
      source: 'author',
      corrected: false,
      usage: partial.usage ?? { input_tokens: 0, output_tokens: 0 },
      latency_ms: 0,
      level: d.level,
      ...(partial.choices ? { choices: partial.choices } : {}),
      ...(partial.checks ? { checks: partial.checks } : {}),
    };
    const row = await this.deps.repo.resolveCharacterDecision(projectId, d.id, { selectedAction: action, result: result as unknown as Record<string, unknown>, actor });
    if (d.level !== 'tactical') {
      await this.deps.repo.supersedeCharacterDecisions(projectId, { characterId: d.characterId, level: d.level, exceptId: d.id, ...(d.level === 'scene' ? { sceneId: d.sceneId } : {}) });
    }
    return row;
  }

  private async profile(req: DecideRequest) {
    const { repo } = this.deps;
    const entity = await repo.getEntity(req.projectId, req.characterId);
    if (!entity || entity.status === 'rejected' || entity.type !== 'character') throw Object.assign(new Error('Героя не знайдено в ядрі книги'), { code: 'not_found' });
    const studio = this.deps.studio ? await this.deps.studio(req.projectId, entity).catch(() => undefined) : undefined;
    const profile = await buildCharacterProfile(repo, req.projectId, req.characterId, { upto: req.asOfChapter ?? null, studio });
    if (!profile) throw Object.assign(new Error('Героя не знайдено в ядрі книги'), { code: 'not_found' });
    return profile;
  }

  /**
   * Кеш: рішення з тим самим ключем — чинне, навіть якщо пізніше його
   * «замінило» рішення з іншим ключем (інша межа знань, інший стан, до якого
   * книга потім повернулась): ключ уже містить усе, від чого рішення
   * залежить.
   */
  private async reuse(req: DecideRequest, level: CharacterDecisionLevel, cacheKey: string, sceneId?: string | null) {
    const found = await this.deps.repo.listCharacterDecisions(req.projectId, { characterId: req.characterId, level, cacheKey, ...(sceneId !== undefined ? { sceneId } : {}), limit: 5 });
    // Готове рішення; немає — очікування автора з тим самим ключем (повторний запит не кличе Jev знову).
    return found.find((d) => d.status !== 'awaiting_author' && d.selectedAction) ?? found.find((d) => d.status === 'awaiting_author') ?? null;
  }

  /**
   * Спільне для трьох рівнів (В4): Jev → валідатор → (запасний LLM →
   * валідатор) → інакше «чекає автора». Записати в журнал з причинами й
   * порушеннями; чинне нове — замінює попередні чинні свого рівня.
   */
  private async evaluateAndStore(
    req: DecideRequest,
    level: CharacterDecisionLevel,
    snapshot: CharacterSnapshot,
    questions: JevQuestion[],
    cacheKey: string,
    constraints: HardConstraints,
    extra: { parentId?: string | null; sceneId?: string | null; basis: { paragraphIds?: string[]; entityIds?: string[]; note?: string }; options: Record<string, unknown> },
  ): Promise<CharacterDecisionRow> {
    const check = validateSnapshot(snapshot);
    if (!check.ok) throw new Error(`Знімок героя (${level}) не відповідає контракту: ${check.errors.join('; ')}`);
    const reasons: string[] = [];
    const attempt = async (a: JevAdapter, label: string) => {
      try {
        return await a.evaluate(snapshot, questions);
      } catch (err) {
        reasons.push(`${label}: ${(err as Error).message}`);
        return null;
      }
    };
    let final: ValidationOutcome | null = null;
    let partial: DecisionResult | null = null;
    if (this.deps.jev) {
      const d = await attempt(this.deps.jev, 'Jev');
      if (d) {
        const v = validateHard(d, constraints);
        partial = v.decision;
        if (!v.needsAuthor || v.authorReason === 'low_confidence') final = v;
        else reasons.push('Jev: допустимої альтернативи немає');
      }
    } else reasons.push('Jev не налаштовано (немає ключа TypeSafe)');
    if (!final) {
      const d = await attempt(this.deps.fallback, 'LLM');
      if (d) {
        const v = validateHard(d, constraints);
        partial = partial ?? v.decision;
        final = v;
        if (v.needsAuthor) reasons.push('LLM: допустимої альтернативи немає');
      }
    }
    const waiting = !final || final.needsAuthor;
    const got = final?.decision ?? partial;
    const result = got ? ({ ...got, level } as DecisionResult) : null;
    const row = await this.deps.repo.addCharacterDecision({
      projectId: req.projectId,
      characterId: req.characterId,
      level,
      sceneId: extra.sceneId ?? null,
      simulationId: req.simulationId ?? null,
      turnIndex: level === 'tactical' ? req.turnIndex ?? null : null,
      cacheKey,
      parentId: extra.parentId ?? null,
      questions,
      options: { ...extra.options, primary: constraints.primary, ...(constraints.choices ? { choices: constraints.choices } : {}), confidenceThreshold: constraints.confidenceThreshold ?? null },
      result: result as unknown as Record<string, unknown> | null,
      selectedAction: waiting ? null : got!.selected_action,
      validation: {
        corrected: final?.corrected ?? false,
        violations: final?.violations ?? [],
        awaitingAuthor: waiting,
        authorReason: final?.authorReason ?? (waiting ? 'unavailable' : null),
      },
      snapshotHash: got?.snapshot_hash ?? snapshotHash(snapshot),
      modelVersion: got?.model_version ?? 'unavailable',
      source: got && got.source !== 'author' ? got.source : 'llm_fallback',
      fallbackReason: reasons.length ? reasons.join('; ').slice(0, 1000) : null,
      basis: extra.basis,
      status: waiting ? 'awaiting_author' : 'active',
      usage: got?.usage ?? {},
      latencyMs: got?.latency_ms ?? 0,
      createdBy: req.actor,
    });
    if (!waiting && level !== 'tactical') {
      await this.deps.repo.supersedeCharacterDecisions(req.projectId, { characterId: req.characterId, level, exceptId: row.id, ...(level === 'scene' ? { sceneId: extra.sceneId ?? null } : {}) });
    }
    return row;
  }

  // Стратегічний: ключ — значущі події (і межа знань, і версія конфігурації).
  private async strategic(req: DecideRequest): Promise<{ decision: CharacterDecisionRow; reused: boolean }> {
    const profile = await this.profile(req);
    const canon = profile.canon.fields.map((f) => ({ label: f.label, value: f.value }));
    const sig = await significantState(this.deps.repo, req.projectId, req.characterId, { asOfChapter: req.asOfChapter ?? null, canon, version: this.config.version });
    const cached = await this.reuse(req, 'strategic', sig.key);
    if (cached) return { decision: cached, reused: true };

    const cfg = this.config.strategic;
    const goalOptions: Record<string, string> = {};
    [...new Map(sig.goals.map((g) => [g.entityId, g])).values()].slice(0, 12).forEach((g, i) => (goalOptions[`goal_${i + 1}`] = `${g.name}${g.value && g.value !== g.name ? ` — ${g.value}` : ''}`));
    const questions: JevQuestion[] = [
      { id: cfg.primary.id, kind: 'choice', instructions: cfg.primary.instructions, options: cfg.primary.options },
      ...(Object.keys(goalOptions).length >= 2 ? [{ id: 'long_goal', kind: 'choice' as const, instructions: cfg.goalInstructions, options: goalOptions }] : []),
      ...cfg.scores.map((s) => ({ id: s.id, kind: 'score' as const, instructions: s.instructions, levels: s.levels })),
    ];
    const situation = [
      'Довга перспектива героя: провідні цілі, конфлікт мотивів, траєкторія розвитку.',
      sig.goals.length ? `Цілі й потреби: ${sig.goals.map((g) => g.name).join('; ')}.` : '',
      sig.events.length ? `Пережите: ${sig.events.map((e) => `${e.name} (${e.type})`).join('; ')}.` : '',
    ].filter(Boolean).join(' ').slice(0, 2000);
    const snapshot = snapshotFromProfile(profile, [], situation, Object.keys(cfg.primary.options));
    const constraints: HardConstraints = {
      primary: { id: cfg.primary.id, allowed: Object.keys(cfg.primary.options) },
      ...(Object.keys(goalOptions).length >= 2 ? { choices: { long_goal: Object.keys(goalOptions) } } : {}),
      confidenceThreshold: this.config.confidenceThreshold,
    };
    const decision = await this.evaluateAndStore(req, 'strategic', snapshot, questions, sig.key, constraints, {
      basis: { paragraphIds: [...new Set([...sig.paragraphIds, ...snapshot.confirmed_facts.flatMap((f) => f.evidence.map((e) => e.paragraph_id))])], entityIds: sig.events.map((e) => e.entityId), note: `значущі події: ${sig.events.length}, цілі: ${sig.goals.length}, факти: ${sig.facts.length}` },
      options: { version: this.config.version, trajectories: Object.keys(cfg.primary.options), goals: goalOptions },
    });
    return { decision, reused: false };
  }

  private strategicSummary(d: CharacterDecisionRow): string {
    const r = (d.result ?? {}) as Partial<DecisionResult>;
    const goals = (d.options.goals ?? {}) as Record<string, string>;
    const goal = r.choices?.long_goal ? goals[r.choices.long_goal] : '';
    return [`Траєкторія героя: ${d.selectedAction}.`, goal ? `Провідна мета: ${goal}.` : '', r.scores?.motive_conflict != null ? `Конфлікт мотивів: ${r.scores.motive_conflict}/10.` : ''].filter(Boolean).join(' ');
  }

  // Сценічний: ключ — стратегічне рішення + умови сцени + «поворот».
  private async scene(req: DecideRequest, parent: CharacterDecisionRow): Promise<{ decision: CharacterDecisionRow; reused: boolean }> {
    const sceneId = req.sceneId ?? null;
    const conditions = {
      v: this.config.version,
      parent: parent.id,
      sceneId,
      situation: (req.level === 'scene' ? req.situation : '') ?? '',
      participants: [...(req.participants ?? [])].sort(),
      goal: req.sceneGoal ?? '',
      turn: req.turnMark ?? '',
      forbidden: [...(req.forbiddenActions ?? [])].sort(),
    };
    // Для тактичного запиту умови сцени — ті, що були при її оцінці: беремо чинне сценічне рішення сцени, якщо воно від того самого стратегічного.
    if (req.level === 'tactical') {
      const current = (await this.deps.repo.listCharacterDecisions(req.projectId, { characterId: req.characterId, level: 'scene', sceneId, status: 'active', limit: 1 }))[0];
      if (current && current.parentId === parent.id) return { decision: current, reused: true };
    }
    const key = hash(conditions);
    const cached = await this.reuse(req, 'scene', key, sceneId);
    if (cached) return { decision: cached, reused: true };

    const profile = await this.profile(req);
    const cfg = this.config.scene;
    const questions: JevQuestion[] = [
      { id: cfg.primary.id, kind: 'choice', instructions: cfg.primary.instructions, options: cfg.primary.options },
      ...cfg.scores.map((s) => ({ id: s.id, kind: 'score' as const, instructions: s.instructions, levels: s.levels })),
    ];
    const situation = [
      this.strategicSummary(parent),
      conditions.situation ? `Сцена: ${conditions.situation}` : 'Сцена: умови не описано.',
      conditions.participants.length ? `Учасники: ${conditions.participants.join(', ')}.` : '',
      conditions.goal ? `Мета сцени: ${conditions.goal}.` : '',
      conditions.turn ? `Поворот: ${conditions.turn}.` : '',
    ].filter(Boolean).join(' ').slice(0, 2000);
    const snapshot = snapshotFromProfile(profile, [], situation, Object.keys(cfg.primary.options));
    const decision = await this.evaluateAndStore(req, 'scene', snapshot, questions, key, { primary: { id: cfg.primary.id, allowed: Object.keys(cfg.primary.options) }, confidenceThreshold: this.config.confidenceThreshold }, {
      parentId: parent.id,
      sceneId,
      basis: { paragraphIds: snapshot.recent_appearances.map((a) => a.paragraph_id), note: `сцена: ${sceneId ?? 'без розділу'}; учасників: ${conditions.participants.length}` },
      options: { version: this.config.version, motives: Object.keys(cfg.primary.options), forbidden: conditions.forbidden },
    });
    return { decision, reused: false };
  }

  // Тактичний: щоразу; повторно — лише той самий знімок у тому самому ході прогону.
  private async tactical(req: DecideRequest, parent: CharacterDecisionRow): Promise<{ decision: CharacterDecisionRow; reused: boolean }> {
    const forbidden = new Set(req.forbiddenActions ?? []);
    const allowed = [...new Set((req.allowedActions?.length ? req.allowedActions : DEFAULT_TACTICAL_ACTIONS).filter((a) => actionId(a) && !forbidden.has(a)))];
    if (allowed.length < 2) throw Object.assign(new Error('Для ходу потрібно щонайменше дві дозволені дії (без заборонених).'), { code: 'bad_input' });
    const profile = await this.profile(req);
    const r = (parent.result ?? {}) as Partial<DecisionResult>;
    const sceneLine = `Мотив у сцені: ${parent.selectedAction}${r.scores ? `; ${Object.entries(r.scores).map(([k, v]) => `${k} ${v}/10`).join(', ')}` : ''}.`;
    const situation = [sceneLine, (req.situation ?? '').trim() || 'Хід героя.'].join(' ').slice(0, 2000);
    const snapshot: CharacterSnapshot = snapshotFromProfile(profile, [], situation, allowed);
    const cfg = this.config.tactical;
    const questions: JevQuestion[] = [
      { id: 'next_action', kind: 'choice', instructions: cfg.instructions, options: Object.fromEntries(allowed.map((a) => [a, cfg.describe[a] ?? null])) },
      { id: cfg.styleFit.id, kind: 'score', instructions: cfg.styleFit.instructions, levels: cfg.styleFit.levels },
      ...(req.checks ?? []).slice(0, 4).map((c, i) => ({ id: `check_${i + 1}`, kind: 'noul' as const, instructions: `Чи узгоджується з наданим станом: «${String(c).slice(0, 400)}»?` })),
    ];
    const key = hash({ v: this.config.version, snapshot, questions, sim: req.simulationId ?? null, turn: req.turnIndex ?? null });
    if (req.simulationId) {
      const cached = await this.reuse(req, 'tactical', key);
      if (cached) return { decision: cached, reused: true };
    }
    const decision = await this.evaluateAndStore(req, 'tactical', snapshot, questions, key, { primary: { id: 'next_action', allowed, forbidden: [...forbidden] }, confidenceThreshold: this.config.confidenceThreshold }, {
      parentId: parent.id,
      sceneId: req.sceneId ?? null,
      basis: { paragraphIds: snapshot.recent_appearances.map((a) => a.paragraph_id), note: `хід ${req.turnIndex ?? '—'}` },
      options: { version: this.config.version, allowed, forbidden: [...forbidden], checks: (req.checks ?? []).slice(0, 4) },
    });
    return { decision, reused: false };
  }
}

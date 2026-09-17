/**
 * Сховище «Поріг» (ARCHITECTURE_EMOTION_THRESHOLD_MODULES.md, розділ 6.3):
 * AI лише ПРОПОНУЄ кандидата (server/thresholdPrompt.ts::
 * normalizeThresholdCandidate) — сюди пишеться тільки те, що автор
 * підтвердив чи відредагував і явно зберіг. Жодного авто-запису з AI-роуту.
 *
 * `score`/`is_real_threshold`/`feedback` рахує ЗАВЖДИ server/
 * thresholdScoring.ts, і завжди при кожному save — не з тіла запиту, щоб
 * підроблений score із клієнта ніколи не потрапив у базу.
 */

import { randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';
import {
  type RiskProfile,
  type ThresholdCandidate,
  type ThresholdType,
  validateRiskProfile,
  validateThresholdNumbers,
  thresholdScore,
} from './thresholdScoring';

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`Модуль «Поріг» потребує SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

export interface ThresholdInput {
  userId: string;
  bookId?: string | null;
  characterId?: string | null;
  title: string;
  description: string;
  types: ThresholdType[];
  beforeState: string;
  choice: string;
  crossingAction: string;
  afterState: string;
  risks: Partial<RiskProfile>;
  cost: number;
  irreversibility: number;
  transformation: number;
  awareness: number;
  agency: number;
  status?: string;
  consequences?: string[];
  confidence?: number | null;
}

export interface ThresholdRecord {
  id: string;
  userId: string;
  bookId: string | null;
  characterId: string | null;
  title: string;
  description: string;
  types: ThresholdType[];
  beforeState: string;
  choice: string;
  crossingAction: string;
  afterState: string;
  risks: RiskProfile;
  cost: number;
  irreversibility: number;
  transformation: number;
  awareness: number;
  agency: number;
  score: number;
  status: string;
  consequences: string[];
  confidence: number | null;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  user_id: string;
  book_id: string | null;
  character_id: string | null;
  title: string;
  description: string;
  types: string;
  before_state: string;
  choice: string;
  crossing_action: string;
  after_state: string;
  risk_physical: number;
  risk_emotional: number;
  risk_social: number;
  risk_material: number;
  risk_existential: number;
  cost: number;
  irreversibility: number;
  transformation: number;
  awareness: number;
  agency: number;
  score: number;
  status: string;
  consequences: string;
  confidence: number | null;
  created_at: string;
  updated_at: string;
}

function toCandidate(input: ThresholdInput): ThresholdCandidate {
  const numeric = validateThresholdNumbers({
    cost: input.cost,
    irreversibility: input.irreversibility,
    transformation: input.transformation,
    awareness: input.awareness,
    agency: input.agency,
  });
  return {
    title: input.title,
    description: input.description,
    types: input.types,
    beforeState: input.beforeState,
    choice: input.choice,
    crossingAction: input.crossingAction,
    afterState: input.afterState,
    risks: validateRiskProfile(input.risks),
    cost: numeric.cost!,
    irreversibility: numeric.irreversibility!,
    transformation: numeric.transformation!,
    awareness: numeric.awareness!,
    agency: numeric.agency!,
  };
}

function toRecord(row: Row): ThresholdRecord {
  let types: ThresholdType[] = [];
  let consequences: string[] = [];
  try {
    types = JSON.parse(row.types);
  } catch {
    types = [];
  }
  try {
    consequences = JSON.parse(row.consequences);
  } catch {
    consequences = [];
  }
  return {
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    characterId: row.character_id,
    title: row.title,
    description: row.description,
    types,
    beforeState: row.before_state,
    choice: row.choice,
    crossingAction: row.crossing_action,
    afterState: row.after_state,
    risks: {
      physical: row.risk_physical,
      emotional: row.risk_emotional,
      social: row.risk_social,
      material: row.risk_material,
      existential: row.risk_existential,
    },
    cost: row.cost,
    irreversibility: row.irreversibility,
    transformation: row.transformation,
    awareness: row.awareness,
    agency: row.agency,
    score: row.score,
    status: row.status,
    consequences,
    confidence: row.confidence,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Створює поріг. `score` рахується тут, ЗАВЖДИ сервером, ніколи з тіла запиту. */
export function createThreshold(input: ThresholdInput): ThresholdRecord {
  const db = requireDb();
  const candidate = toCandidate(input);
  const score = thresholdScore(candidate);
  const id = `thr_${randomUUID()}`;
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO thresholds
       (id, user_id, book_id, character_id, title, description, types, before_state, choice, crossing_action,
        after_state, risk_physical, risk_emotional, risk_social, risk_material, risk_existential, cost,
        irreversibility, transformation, awareness, agency, score, status, consequences, confidence,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    input.bookId ?? null,
    input.characterId ?? null,
    candidate.title,
    candidate.description,
    JSON.stringify(candidate.types),
    candidate.beforeState,
    candidate.choice,
    candidate.crossingAction,
    candidate.afterState,
    candidate.risks.physical,
    candidate.risks.emotional,
    candidate.risks.social,
    candidate.risks.material,
    candidate.risks.existential,
    candidate.cost,
    candidate.irreversibility,
    candidate.transformation,
    candidate.awareness,
    candidate.agency,
    score,
    input.status || 'planned',
    JSON.stringify(input.consequences || []),
    input.confidence ?? null,
    now,
    now
  );

  return getThreshold(id, input.userId)!;
}

export function updateThreshold(id: string, userId: string, patch: Partial<ThresholdInput>): ThresholdRecord | null {
  const db = requireDb();
  const existing = getThreshold(id, userId);
  if (!existing) return null;

  const merged: ThresholdInput = {
    userId,
    bookId: patch.bookId !== undefined ? patch.bookId : existing.bookId,
    characterId: patch.characterId !== undefined ? patch.characterId : existing.characterId,
    title: patch.title ?? existing.title,
    description: patch.description ?? existing.description,
    types: patch.types ?? existing.types,
    beforeState: patch.beforeState ?? existing.beforeState,
    choice: patch.choice ?? existing.choice,
    crossingAction: patch.crossingAction ?? existing.crossingAction,
    afterState: patch.afterState ?? existing.afterState,
    risks: patch.risks ?? existing.risks,
    cost: patch.cost ?? existing.cost,
    irreversibility: patch.irreversibility ?? existing.irreversibility,
    transformation: patch.transformation ?? existing.transformation,
    awareness: patch.awareness ?? existing.awareness,
    agency: patch.agency ?? existing.agency,
    status: patch.status ?? existing.status,
    consequences: patch.consequences ?? existing.consequences,
    confidence: patch.confidence !== undefined ? patch.confidence : existing.confidence,
  };
  const candidate = toCandidate(merged);
  const score = thresholdScore(candidate);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE thresholds SET
       book_id = ?, character_id = ?, title = ?, description = ?, types = ?, before_state = ?, choice = ?,
       crossing_action = ?, after_state = ?, risk_physical = ?, risk_emotional = ?, risk_social = ?,
       risk_material = ?, risk_existential = ?, cost = ?, irreversibility = ?, transformation = ?,
       awareness = ?, agency = ?, score = ?, status = ?, consequences = ?, confidence = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    merged.bookId ?? null,
    merged.characterId ?? null,
    candidate.title,
    candidate.description,
    JSON.stringify(candidate.types),
    candidate.beforeState,
    candidate.choice,
    candidate.crossingAction,
    candidate.afterState,
    candidate.risks.physical,
    candidate.risks.emotional,
    candidate.risks.social,
    candidate.risks.material,
    candidate.risks.existential,
    candidate.cost,
    candidate.irreversibility,
    candidate.transformation,
    candidate.awareness,
    candidate.agency,
    score,
    merged.status || 'planned',
    JSON.stringify(merged.consequences || []),
    merged.confidence ?? null,
    now,
    id,
    userId
  );

  return getThreshold(id, userId);
}

export function getThreshold(id: string, userId: string): ThresholdRecord | null {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM thresholds WHERE id = ? AND user_id = ?').get(id, userId) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function listThresholds(userId: string, bookId?: string | null, limit = 200): ThresholdRecord[] {
  const db = requireDb();
  const rows = (
    bookId
      ? db
          .prepare('SELECT * FROM thresholds WHERE user_id = ? AND book_id = ? ORDER BY updated_at DESC LIMIT ?')
          .all(userId, bookId, Math.max(1, Math.min(1000, limit)))
      : db
          .prepare('SELECT * FROM thresholds WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
          .all(userId, Math.max(1, Math.min(1000, limit)))
  ) as Row[];
  return rows.map(toRecord);
}

export function deleteThreshold(id: string, userId: string): boolean {
  const db = requireDb();
  const result = db.prepare('DELETE FROM thresholds WHERE id = ? AND user_id = ?').run(id, userId) as unknown as { changes?: number };
  return (result.changes ?? 0) > 0;
}

export interface ThresholdSceneLink {
  id: string;
  thresholdId: string;
  sceneId: string;
  role: 'preparation' | 'crossing' | 'consequence';
  orderIndex: number;
}

/**
 * Спершу перевіряє, що поріг належить автору (той самий власник, що й
 * scene_id — м'яке посилання, як і в chat_sessions, тож FK тут немає й
 * перевірка власності лежить на нас, а не на базі).
 */
export function linkThresholdScene(
  userId: string,
  thresholdId: string,
  sceneId: string,
  role: 'preparation' | 'crossing' | 'consequence',
  orderIndex: number
): ThresholdSceneLink {
  const db = requireDb();
  if (!getThreshold(thresholdId, userId)) {
    throw new Error('Поріг не знайдено або належить іншому автору.');
  }
  const id = `thsl_${randomUUID()}`;
  db.prepare(
    `INSERT INTO threshold_scene_links (id, threshold_id, scene_id, role, order_index) VALUES (?, ?, ?, ?, ?)`
  ).run(id, thresholdId, sceneId, role, orderIndex);
  return { id, thresholdId, sceneId, role, orderIndex };
}

export function listThresholdSceneLinks(thresholdId: string): ThresholdSceneLink[] {
  const db = requireDb();
  const rows = db
    .prepare('SELECT id, threshold_id, scene_id, role, order_index FROM threshold_scene_links WHERE threshold_id = ? ORDER BY order_index ASC')
    .all(thresholdId) as { id: string; threshold_id: string; scene_id: string; role: string; order_index: number }[];
  return rows.map((r) => ({
    id: r.id,
    thresholdId: r.threshold_id,
    sceneId: r.scene_id,
    role: r.role as ThresholdSceneLink['role'],
    orderIndex: r.order_index,
  }));
}

export function unlinkThresholdScene(id: string, threshold_id: string): boolean {
  const db = requireDb();
  const result = db.prepare('DELETE FROM threshold_scene_links WHERE id = ? AND threshold_id = ?').run(id, threshold_id) as unknown as { changes?: number };
  return (result.changes ?? 0) > 0;
}

/* ───────────────────────  Уникнені пороги (п. 2.2 ТЗ)  ─────────────────────── */

export interface AvoidedThresholdInput {
  userId: string;
  bookId?: string | null;
  characterId?: string | null;
  developmentArea: string;
  thresholdDescription: string;
  fear: string;
  avoidanceBehavior: string;
  shortTermReward: string;
  longTermCost: string;
  repetitions?: number;
  severity?: number;
  nextOpportunity?: string | null;
}

export interface AvoidedThresholdRecord extends AvoidedThresholdInput {
  id: string;
  repetitions: number;
  severity: number;
  nextOpportunity: string | null;
  createdAt: string;
  updatedAt: string;
}

interface AvoidedRow {
  id: string;
  user_id: string;
  book_id: string | null;
  character_id: string | null;
  development_area: string;
  threshold_description: string;
  fear: string;
  avoidance_behavior: string;
  short_term_reward: string;
  long_term_cost: string;
  repetitions: number;
  severity: number;
  next_opportunity: string | null;
  created_at: string;
  updated_at: string;
}

function toAvoidedRecord(row: AvoidedRow): AvoidedThresholdRecord {
  return {
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    characterId: row.character_id,
    developmentArea: row.development_area,
    thresholdDescription: row.threshold_description,
    fear: row.fear,
    avoidanceBehavior: row.avoidance_behavior,
    shortTermReward: row.short_term_reward,
    longTermCost: row.long_term_cost,
    repetitions: row.repetitions,
    severity: row.severity,
    nextOpportunity: row.next_opportunity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

export function createAvoidedThreshold(input: AvoidedThresholdInput): AvoidedThresholdRecord {
  const db = requireDb();
  const id = `avth_${randomUUID()}`;
  const now = new Date().toISOString();
  const repetitions = Math.max(1, Math.round(input.repetitions ?? 1));
  const severity = clamp(input.severity ?? 5, 1, 10);

  db.prepare(
    `INSERT INTO avoided_thresholds
       (id, user_id, book_id, character_id, development_area, threshold_description, fear, avoidance_behavior,
        short_term_reward, long_term_cost, repetitions, severity, next_opportunity, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.userId,
    input.bookId ?? null,
    input.characterId ?? null,
    input.developmentArea,
    input.thresholdDescription,
    input.fear,
    input.avoidanceBehavior,
    input.shortTermReward,
    input.longTermCost,
    repetitions,
    severity,
    input.nextOpportunity ?? null,
    now,
    now
  );

  return getAvoidedThreshold(id, input.userId)!;
}

export function getAvoidedThreshold(id: string, userId: string): AvoidedThresholdRecord | null {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM avoided_thresholds WHERE id = ? AND user_id = ?').get(id, userId) as AvoidedRow | undefined;
  return row ? toAvoidedRecord(row) : null;
}

export function listAvoidedThresholds(userId: string, bookId?: string | null, limit = 200): AvoidedThresholdRecord[] {
  const db = requireDb();
  const rows = (
    bookId
      ? db
          .prepare('SELECT * FROM avoided_thresholds WHERE user_id = ? AND book_id = ? ORDER BY updated_at DESC LIMIT ?')
          .all(userId, bookId, Math.max(1, Math.min(1000, limit)))
      : db
          .prepare('SELECT * FROM avoided_thresholds WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
          .all(userId, Math.max(1, Math.min(1000, limit)))
  ) as AvoidedRow[];
  return rows.map(toAvoidedRecord);
}

export function updateAvoidedThreshold(
  id: string,
  userId: string,
  patch: Partial<AvoidedThresholdInput>
): AvoidedThresholdRecord | null {
  const db = requireDb();
  const existing = getAvoidedThreshold(id, userId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const repetitions = Math.max(1, Math.round(patch.repetitions ?? existing.repetitions));
  const severity = clamp(patch.severity ?? existing.severity, 1, 10);

  db.prepare(
    `UPDATE avoided_thresholds SET
       book_id = ?, character_id = ?, development_area = ?, threshold_description = ?, fear = ?,
       avoidance_behavior = ?, short_term_reward = ?, long_term_cost = ?, repetitions = ?, severity = ?,
       next_opportunity = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    patch.bookId !== undefined ? patch.bookId : existing.bookId,
    patch.characterId !== undefined ? patch.characterId : existing.characterId,
    patch.developmentArea ?? existing.developmentArea,
    patch.thresholdDescription ?? existing.thresholdDescription,
    patch.fear ?? existing.fear,
    patch.avoidanceBehavior ?? existing.avoidanceBehavior,
    patch.shortTermReward ?? existing.shortTermReward,
    patch.longTermCost ?? existing.longTermCost,
    repetitions,
    severity,
    patch.nextOpportunity !== undefined ? patch.nextOpportunity : existing.nextOpportunity,
    now,
    id,
    userId
  );

  return getAvoidedThreshold(id, userId);
}

export function deleteAvoidedThreshold(id: string, userId: string): boolean {
  const db = requireDb();
  const result = db.prepare('DELETE FROM avoided_thresholds WHERE id = ? AND user_id = ?').run(id, userId) as unknown as { changes?: number };
  return (result.changes ?? 0) > 0;
}

/** Лише для тестів: прибрати пороги одного автора. */
export function __clearThresholdsForTests(userId: string): void {
  const db = requireDb();
  db.prepare('DELETE FROM thresholds WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM avoided_thresholds WHERE user_id = ?').run(userId);
}

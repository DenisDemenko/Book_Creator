/**
 * Контракти Fusion Living Characters (ТЗ Harness + Jev §6.3, §7.2
 * `contracts/`; Т2.5 В1). Схеми — справжні файли `*.schema.json` поруч (їх
 * читають і люди, і сервер); тут — TS-типи, перевірка тим самим
 * `validateAgainstSchema`, що й відповіді ролей AI (Т0.9), і стабільний
 * відбиток знімка. Це НАШІ контракти: адаптери Jev, LLM і рантайму агентів
 * перекладають у них будь-який формат провайдера, тож оновлення Jev чи
 * Harness не зачіпає ні UI, ні ядро (критерій ТЗ-H №10).
 *
 * Перенесено з `server/core/flc/contracts.ts` (прототип Т1.6) — той файл
 * лишається й реекспортує звідси.
 */

import { createHash } from 'node:crypto';
import { validateAgainstSchema } from '../../core/ai/schema';
import characterSnapshotSchema from './character-snapshot.schema.json';
import decisionResultSchema from './decision-result.schema.json';
import decisionRequestSchema from './decision-request.schema.json';

export const CHARACTER_SNAPSHOT_SCHEMA = characterSnapshotSchema as Record<string, unknown>;
export const DECISION_RESULT_SCHEMA = decisionResultSchema as Record<string, unknown>;
export const DECISION_REQUEST_SCHEMA = decisionRequestSchema as Record<string, unknown>;

/** Доказове посилання: абзац книги. */
export interface SnapshotEvidence {
  paragraph_id: string;
  chapter: number | null;
  excerpt: string;
}

export interface CharacterSnapshot {
  character_id: string;
  name: string;
  /** Межа знань: герой «знає» лише глави 1…as_of_chapter (ТЗ-H №5). */
  as_of_chapter: number | null;
  canon: { label: string; value: string }[];
  confirmed_facts: { statement: string; evidence: SnapshotEvidence[] }[];
  current_states: { type: string; name: string; chapter: number | null }[];
  relations: { label: string; other: string; direction: 'out' | 'in' }[];
  recent_appearances: SnapshotEvidence[];
  /** Ситуація, у якій герой має діяти (питання автора на допиті, умови сцени…). */
  situation: string;
  allowed_actions: string[];
}

/** Рівень рішення (FLC 2.0 §3). */
export type DecisionLevel = 'strategic' | 'scene' | 'tactical';
export const DECISION_LEVELS: readonly DecisionLevel[] = ['strategic', 'scene', 'tactical'];

/** Атомарне питання до Jev у НАШОМУ форматі (ТЗ-H §6.2): вибір, оцінка чи перевірка «так / ні». */
export type JevQuestion =
  | { id: string; kind: 'choice'; instructions: string; options: Record<string, string | null> }
  | { id: string; kind: 'score'; instructions: string; levels: string[] }
  | { id: string; kind: 'noul'; instructions: string };

export interface DecisionRequest {
  level: DecisionLevel;
  character_id: string;
  scene_id?: string | null;
  simulation_id?: string | null;
  situation: string;
  allowed_actions?: string[];
  forbidden_actions?: string[];
  questions: JevQuestion[];
}

/** Нормалізований результат рішення (ТЗ-H §6.3). */
export interface DecisionResult {
  /** Відповідь на головне питання вибору (`next_action` чи перше choice рівня). */
  selected_action: string;
  /** Score → шкала 0–10 (рубрика ТЗ-H). */
  scores: Record<string, number>;
  /** Розподіли choice і score, як їх дала модель. */
  raw_distributions: Record<string, Record<string, number>>;
  confidence: number | null;
  model_version: string;
  snapshot_hash: string;
  decision_trace_id: string;
  /** Звідки рішення: справжній Jev, підставний, запасний LLM чи автор (коли обидва не змогли, В4). */
  source: 'jev' | 'mock' | 'llm_fallback' | 'author';
  /** Серверний валідатор замінив недопустиму відповідь (ТЗ-H §6.3). */
  corrected: boolean;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
  /** Noul: імовірність «так» 0–1 для кожного питання-перевірки. Лише допоміжно — не підтвердження канону (ТЗ-H §6.2). */
  checks?: Record<string, number>;
  /** Відповіді на решту питань вибору, крім головного (напр. «траєкторія» стратегічного рівня). */
  choices?: Record<string, string>;
  level?: DecisionLevel;
}

export function validateSnapshot(s: unknown) {
  return validateAgainstSchema<CharacterSnapshot>(CHARACTER_SNAPSHOT_SCHEMA, s);
}
export function validateDecision(d: unknown) {
  return validateAgainstSchema<DecisionResult>(DECISION_RESULT_SCHEMA, d);
}
export function validateDecisionRequest(r: unknown) {
  return validateAgainstSchema<DecisionRequest>(DECISION_REQUEST_SCHEMA, r);
}

/** Канонічний JSON: однаковий стан — однаковий рядок (порядок ключів не важить). */
export function canonicalJson(v: unknown): string {
  const canonical = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(canonical) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canonical((x as any)[k])])) : x;
  return JSON.stringify(canonical(v));
}

/** Стабільний відбиток знімка: однаковий стан — однаковий hash. */
export function snapshotHash(s: CharacterSnapshot): string {
  return createHash('sha256').update(canonicalJson(s)).digest('hex').slice(0, 32);
}

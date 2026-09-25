/**
 * Контракти прототипу FLC етапу 0 (Т1.6, ТЗ Harness + Jev §6.3, §7.2
 * `contracts/`): знімок персонажа для оцінювання і нормалізований результат
 * рішення. Це НАШІ схеми — адаптери Jev і рантайму агентів перекладають у них
 * будь-який формат провайдера, тож оновлення Jev чи Harness не зачіпає ні
 * UI, ні ядро (критерій ТЗ-H №10).
 */

import { createHash } from 'node:crypto';
import { validateAgainstSchema } from '../ai/schema';

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
  /** Ситуація, у якій герой має діяти (питання автора на допиті тощо). */
  situation: string;
  allowed_actions: string[];
}

export const CHARACTER_SNAPSHOT_SCHEMA = {
  type: 'object',
  required: ['character_id', 'name', 'as_of_chapter', 'canon', 'confirmed_facts', 'current_states', 'relations', 'recent_appearances', 'situation', 'allowed_actions'],
  additionalProperties: false,
  properties: {
    character_id: { type: 'string', minLength: 1 },
    name: { type: 'string', minLength: 1 },
    as_of_chapter: { type: ['integer', 'null'], minimum: 1 },
    canon: { type: 'array', maxItems: 40, items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string' }, value: { type: 'string', maxLength: 2000 } } } },
    confirmed_facts: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        required: ['statement', 'evidence'],
        properties: {
          statement: { type: 'string', minLength: 1 },
          evidence: { type: 'array', minItems: 1, items: { $ref: '#/$defs/evidence' } },
        },
      },
    },
    current_states: { type: 'array', maxItems: 30, items: { type: 'object', required: ['type', 'name'], properties: { type: { type: 'string' }, name: { type: 'string' }, chapter: { type: ['integer', 'null'] } } } },
    relations: { type: 'array', maxItems: 40, items: { type: 'object', required: ['label', 'other', 'direction'], properties: { label: { type: 'string' }, other: { type: 'string' }, direction: { enum: ['out', 'in'] } } } },
    recent_appearances: { type: 'array', maxItems: 12, items: { $ref: '#/$defs/evidence' } },
    situation: { type: 'string', minLength: 1, maxLength: 2000 },
    allowed_actions: { type: 'array', minItems: 2, maxItems: 12, uniqueItems: true, items: { type: 'string', pattern: '^[a-z_]{2,40}$' } },
  },
  $defs: {
    evidence: {
      type: 'object',
      required: ['paragraph_id', 'chapter', 'excerpt'],
      properties: { paragraph_id: { type: 'string', minLength: 1 }, chapter: { type: ['integer', 'null'] }, excerpt: { type: 'string' } },
    },
  },
} as const;

/** Нормалізований результат рішення (ТЗ-H §6.3: selected_action, scores, raw_distributions, confidence, model_version, snapshot_hash, decision_trace_id). */
export interface DecisionResult {
  selected_action: string;
  scores: Record<string, number>;
  raw_distributions: Record<string, Record<string, number>>;
  confidence: number | null;
  model_version: string;
  snapshot_hash: string;
  decision_trace_id: string;
  /** Звідки рішення: справжній Jev, підставний (тести/розробка) чи запасна відповідь LLM. */
  source: 'jev' | 'mock' | 'llm_fallback';
  /** Серверний валідатор замінив недопустиму дію (ТЗ-H §6.3). */
  corrected: boolean;
  usage: { input_tokens: number; output_tokens: number };
  latency_ms: number;
}

export const DECISION_RESULT_SCHEMA = {
  type: 'object',
  required: ['selected_action', 'scores', 'raw_distributions', 'confidence', 'model_version', 'snapshot_hash', 'decision_trace_id', 'source', 'corrected'],
  additionalProperties: true,
  properties: {
    selected_action: { type: 'string', minLength: 1 },
    scores: { type: 'object', additionalProperties: { type: 'number' } },
    raw_distributions: { type: 'object', additionalProperties: { type: 'object', additionalProperties: { type: 'number' } } },
    confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
    model_version: { type: 'string', minLength: 1 },
    snapshot_hash: { type: 'string', pattern: '^[0-9a-f]{16,64}$' },
    decision_trace_id: { type: 'string', minLength: 1 },
    source: { enum: ['jev', 'mock', 'llm_fallback'] },
    corrected: { type: 'boolean' },
  },
} as const;

export function validateSnapshot(s: unknown) {
  return validateAgainstSchema<CharacterSnapshot>(CHARACTER_SNAPSHOT_SCHEMA, s);
}
export function validateDecision(d: unknown) {
  return validateAgainstSchema<DecisionResult>(DECISION_RESULT_SCHEMA, d);
}

/** Стабільний відбиток знімка: однаковий стан — однаковий hash (порядок ключів не важить). */
export function snapshotHash(s: CharacterSnapshot): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as any)[k])])) : v;
  return createHash('sha256').update(JSON.stringify(canonical(s))).digest('hex').slice(0, 32);
}

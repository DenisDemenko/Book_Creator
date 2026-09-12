/**
 * Сховище доказів розвитку письменника (WDI).
 *
 * Один обов'язок: дописувати журнал доказів і віддавати його цілком, щоб
 * `server/wdi.ts` згорнув із нього бали. Самих балів тут не зберігається
 * НІДЕ — це рішення описане в `wdi.ts`: журнал є джерелом правди, бал —
 * його проєкція, і тоді будь-яке число можна показати разом із подіями.
 *
 * Ідемпотентність тримає база — `UNIQUE(user_id, source_id)`, а не
 * перевірка в коді. Різниця практична: повторний аналіз того самого
 * тексту не накрутить бал навіть при двох одночасних запитах, а в макеті
 * від цього беріг масив у localStorage, який губився разом із браузером.
 */

import { randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';
import {
  WDI_SKILL_IDS,
  type EvidenceEvent,
  type EvidenceType,
  type WdiSkillId,
} from './wdi';

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`WDI потребує SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

interface Row {
  id: string;
  user_id: string;
  book_id: string | null;
  skill: string;
  type: string;
  outcome: number;
  confidence: number;
  independence: number;
  summary: string;
  source_id: string;
  created_at: string;
}

function toEvent(r: Row): EvidenceEvent {
  return {
    id: r.id,
    userId: r.user_id,
    bookId: r.book_id,
    skill: r.skill as WdiSkillId,
    type: r.type as EvidenceType,
    outcome: r.outcome,
    confidence: r.confidence,
    independence: r.independence,
    summary: r.summary,
    sourceId: r.source_id,
    createdAt: r.created_at,
  };
}

export interface RecordEvidenceInput {
  userId: string;
  bookId?: string | null;
  skill: WdiSkillId;
  type: EvidenceType;
  outcome: number;
  confidence: number;
  independence: number;
  summary?: string;
  /** Ключ ідемпотентності: та сама подія з тим самим ключем не подвоїться. */
  sourceId: string;
}

/**
 * Дописує доказ. Повертає `false`, якщо такий `sourceId` в автора вже є —
 * це НЕ помилка, а нормальний хід подій: автор просто повторно відкрив
 * той самий фрагмент.
 */
export function recordEvidence(input: RecordEvidenceInput): boolean {
  if (!WDI_SKILL_IDS.includes(input.skill)) {
    throw new Error(`Невідома компетенція WDI: ${input.skill}`);
  }
  if (!input.sourceId || !input.sourceId.trim()) {
    // Без ключа ідемпотентності запис небезпечний: він накручував би бал
    // при кожному повторному аналізі. Краще впасти тут, ніж тихо брехати.
    throw new Error('Доказ без sourceId не приймається — він накручував би бал.');
  }
  const db = requireDb();
  const existing = db
    .prepare('SELECT id FROM writer_evidence WHERE user_id = ? AND source_id = ?')
    .get(input.userId, input.sourceId) as { id: string } | undefined;
  if (existing) return false;

  db.prepare(
    `INSERT INTO writer_evidence
       (id, user_id, book_id, skill, type, outcome, confidence, independence, summary, source_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `ev_${randomUUID()}`,
    input.userId,
    input.bookId ?? null,
    input.skill,
    input.type,
    clamp(input.outcome, -1, 1),
    clamp(input.confidence, 0, 1),
    Math.round(clamp(input.independence, 0, 100)),
    (input.summary || '').slice(0, 500),
    input.sourceId,
    new Date().toISOString()
  );
  return true;
}

/** Дописує кілька доказів; повертає, скільки справді додано. */
export function recordMany(inputs: RecordEvidenceInput[]): number {
  let added = 0;
  for (const i of inputs) {
    try {
      if (recordEvidence(i)) added += 1;
    } catch (err) {
      // Один поганий доказ не має валити решту: решта — справжні
      // спостереження, і втрачати їх через сусіда безглуздо.
      console.warn('[wdi] доказ не записано:', (err as Error)?.message);
    }
  }
  return added;
}

/** Усі докази автора — вхід для проєкції балів. */
export function listEvidence(userId: string, limit = 5000): EvidenceEvent[] {
  const db = requireDb();
  const rows = db
    .prepare(
      `SELECT * FROM writer_evidence WHERE user_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, Math.max(1, Math.min(20000, limit))) as Row[];
  return rows.map(toEvent);
}

/** Останні докази однієї компетенції — щоб показати підставу під балом. */
export function listEvidenceForSkill(userId: string, skill: WdiSkillId, limit = 20): EvidenceEvent[] {
  const db = requireDb();
  const rows = db
    .prepare(
      `SELECT * FROM writer_evidence WHERE user_id = ? AND skill = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(userId, skill, Math.max(1, Math.min(200, limit))) as Row[];
  return rows.map(toEvent);
}

export function countEvidence(userId: string): number {
  const db = requireDb();
  const r = db
    .prepare('SELECT COUNT(*) AS n FROM writer_evidence WHERE user_id = ?')
    .get(userId) as { n: number } | undefined;
  return r?.n ?? 0;
}

/** Лише для тестів: прибрати докази одного автора. */
export function __clearEvidenceForTests(userId: string): void {
  requireDb().prepare('DELETE FROM writer_evidence WHERE user_id = ?').run(userId);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

/**
 * Сховище «Емоційна майстерність письменника»
 * (ARCHITECTURE_EMOTION_THRESHOLD_MODULES.md, розділи 3-5).
 *
 * Той самий принцип ідемпотентності, що й у server/diagnStore.ts: хеш
 * виділеного тексту — ключ, повторний аналіз НЕЗМІНЕНОГО фрагмента не
 * плодить нові рядки й не накручує WDI-докази (server/wdiStore.ts
 * покладається на ту саму гарантію через UNIQUE(user_id, source_id) — тут
 * джерело для sourceId саме ця ж пара user_id+hash).
 *
 * mastery_score НІКОЛИ не приходить з AI — рахує його лише
 * server/emotionMasteryScoring.ts::computeMasteryScore із уже затиснутих
 * (server/emotionMasteryPrompt.ts::normalizeEmotionAnalysis) сирих балів.
 *
 * «Профіль емоцій автора» (п. 18 ТЗ) свідомо не зберігається окремою
 * таблицею — рахується тут на льоту з emotion_analysis/
 * emotion_mastery_scores (комент у server/db.ts біля CREATE TABLE
 * emotion_analysis пояснює чому).
 */

import { createHash, randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';
import {
  MASTERY_CRITERIA,
  type MasteryCriterion,
  type MasteryScores,
  computeMasteryScore,
} from './emotionMasteryScoring';
import type { NormalizedEmotionAnalysis } from './emotionMasteryPrompt';

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`Модуль «Емоційна майстерність» потребує SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

/** Ключ ідемпотентності — та сама функція, що дає sourceId для WDI (recordEvidence). */
export function emotionTextHash(text: string): string {
  return createHash('sha256').update(String(text ?? '')).digest('hex');
}

/** Джерело доказу WDI для цього модуля — стабільне для того самого (автор, текст). */
export function emotionEvidenceSourceId(userId: string, selectedText: string): string {
  return `emotion:${userId}:${emotionTextHash(selectedText)}`;
}

export interface PersistEmotionAnalysisInput {
  userId: string;
  bookId?: string | null;
  sceneId?: string | null;
  characterId?: string | null;
  selectedText: string;
  analysis: NormalizedEmotionAnalysis;
  modelVersion: string;
  promptVersion: string;
  rubricVersion: string;
  taxonomyVersion: string;
}

export interface EmotionAnalysisRecord {
  id: string;
  alreadyExisted: boolean;
  masteryScore: number;
}

interface AnalysisRow {
  id: string;
  user_id: string;
  book_id: string | null;
  scene_id: string | null;
  character_id: string | null;
  character_name: string;
  selected_text: string;
  selected_text_hash: string;
  primary_emotion_id: string;
  primary_probability: number;
  primary_intensity: number;
  mastery_score: number;
  threshold_impact: number;
  confidence: number;
  model_version: string;
  prompt_version: string;
  rubric_version: string;
  taxonomy_version: string;
  created_at: string;
}

/**
 * Створює запис емоції в словнику «на льоту», якщо AI повернула код, якого
 * ще нема серед насіяних 48 (EMOTION_DICTIONARY_SEED у server/db.ts) —
 * не блокує аналіз: словник розширюваний за задумом (п. 3 ТЗ), а
 * не впасти краще, ніж загубити аналіз через невідоме слово.
 */
function ensureEmotionDictionaryEntry(id: string): void {
  if (!id || id === 'undefined') return;
  try {
    const db = requireDb();
    const existing = db.prepare('SELECT id FROM emotion_dictionary WHERE id = ?').get(id) as { id: string } | undefined;
    if (existing) return;
    db.prepare(
      `INSERT INTO emotion_dictionary (id, category, label_uk, is_custom, created_at) VALUES (?, 'custom', ?, 1, ?)`
    ).run(id, id, new Date().toISOString());
  } catch (err) {
    console.warn('[emotionMasteryStore] не вдалося додати емоцію до словника:', (err as Error)?.message);
  }
}

/**
 * Записує один аналіз транзакційно (усі п'ять таблиць або жодної).
 * Повертає `alreadyExisted: true`, якщо той самий текст автор уже
 * аналізував раніше — не помилка, той самий підхід, що й у wdiStore.
 */
export function persistEmotionAnalysis(input: PersistEmotionAnalysisInput): EmotionAnalysisRecord {
  const db = requireDb();
  const hash = emotionTextHash(input.selectedText);

  const existing = db
    .prepare('SELECT id, mastery_score FROM emotion_analysis WHERE user_id = ? AND selected_text_hash = ?')
    .get(input.userId, hash) as { id: string; mastery_score: number } | undefined;
  if (existing) {
    return { id: existing.id, alreadyExisted: true, masteryScore: existing.mastery_score };
  }

  const a = input.analysis;
  const mastery = a.mastery as MasteryScores;
  const masteryScore = computeMasteryScore(mastery);
  const id = `emoan_${randomUUID()}`;
  const now = new Date().toISOString();

  ensureEmotionDictionaryEntry(a.primaryEmotion.name);
  for (const c of a.secondaryEmotions) ensureEmotionDictionaryEntry(c.name);
  for (const c of a.hiddenEmotions) ensureEmotionDictionaryEntry(c.name);
  for (const t of a.timeline) ensureEmotionDictionaryEntry(t.emotion);

  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO emotion_analysis
         (id, user_id, book_id, scene_id, character_id, character_name, selected_text, selected_text_hash,
          primary_emotion_id, primary_probability, primary_intensity, mastery_score, threshold_impact,
          confidence, model_version, prompt_version, rubric_version, taxonomy_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      input.userId,
      input.bookId ?? null,
      input.sceneId ?? null,
      input.characterId ?? null,
      a.character,
      input.selectedText,
      hash,
      a.primaryEmotion.name,
      a.primaryEmotion.probability,
      a.primaryEmotion.intensity,
      masteryScore,
      a.thresholdImpact,
      a.confidence,
      input.modelVersion,
      input.promptVersion,
      input.rubricVersion,
      input.taxonomyVersion,
      now
    );

    const insCandidate = db.prepare(
      `INSERT INTO emotion_candidates (id, analysis_id, kind, emotion_id, probability, intensity) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const c of a.secondaryEmotions) {
      insCandidate.run(`emoc_${randomUUID()}`, id, 'secondary', c.name, c.probability, c.intensity);
    }
    for (const c of a.hiddenEmotions) {
      insCandidate.run(`emoc_${randomUUID()}`, id, 'hidden', c.name, c.probability, c.intensity);
    }

    const insScore = db.prepare(
      `INSERT INTO emotion_mastery_scores (id, analysis_id, criterion, score) VALUES (?, ?, ?, ?)`
    );
    for (const key of MASTERY_CRITERIA) {
      insScore.run(`emoms_${randomUUID()}`, id, key, mastery[key]);
    }

    const insEvidence = db.prepare(
      `INSERT INTO emotion_evidence (id, analysis_id, criterion, quote, explanation) VALUES (?, ?, ?, ?, ?)`
    );
    for (const e of a.evidence) {
      insEvidence.run(`emoev_${randomUUID()}`, id, e.criterion, e.quote, e.explanation);
    }

    const insTimeline = db.prepare(
      `INSERT INTO emotion_timeline (id, analysis_id, order_index, emotion_id, intensity) VALUES (?, ?, ?, ?, ?)`
    );
    a.timeline.forEach((t, idx) => {
      insTimeline.run(`emotl_${randomUUID()}`, id, idx, t.emotion, t.intensity);
    });

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { id, alreadyExisted: false, masteryScore };
}

export interface EmotionAnalysisDetail {
  id: string;
  userId: string;
  bookId: string | null;
  sceneId: string | null;
  characterId: string | null;
  characterName: string;
  selectedText: string;
  primaryEmotion: { id: string; probability: number; intensity: number };
  masteryScore: number;
  masteryScores: Record<MasteryCriterion, number>;
  thresholdImpact: number;
  confidence: number;
  createdAt: string;
  secondaryEmotions: { emotionId: string; probability: number; intensity: number }[];
  hiddenEmotions: { emotionId: string; probability: number; intensity: number }[];
  evidence: { criterion: string; quote: string; explanation: string }[];
  timeline: { orderIndex: number; emotionId: string; intensity: number }[];
}

function toDetail(row: AnalysisRow, db: ReturnType<typeof requireDb>): EmotionAnalysisDetail {
  const scoreRows = db
    .prepare('SELECT criterion, score FROM emotion_mastery_scores WHERE analysis_id = ?')
    .all(row.id) as { criterion: string; score: number }[];
  const masteryScores = {} as Record<MasteryCriterion, number>;
  for (const key of MASTERY_CRITERIA) masteryScores[key] = 0;
  for (const r of scoreRows) masteryScores[r.criterion as MasteryCriterion] = r.score;

  const candidateRows = db
    .prepare('SELECT kind, emotion_id, probability, intensity FROM emotion_candidates WHERE analysis_id = ?')
    .all(row.id) as { kind: string; emotion_id: string; probability: number; intensity: number }[];

  const evidenceRows = db
    .prepare('SELECT criterion, quote, explanation FROM emotion_evidence WHERE analysis_id = ?')
    .all(row.id) as { criterion: string; quote: string; explanation: string }[];

  const timelineRows = db
    .prepare('SELECT order_index, emotion_id, intensity FROM emotion_timeline WHERE analysis_id = ? ORDER BY order_index ASC')
    .all(row.id) as { order_index: number; emotion_id: string; intensity: number }[];

  return {
    id: row.id,
    userId: row.user_id,
    bookId: row.book_id,
    sceneId: row.scene_id,
    characterId: row.character_id,
    characterName: row.character_name,
    selectedText: row.selected_text,
    primaryEmotion: { id: row.primary_emotion_id, probability: row.primary_probability, intensity: row.primary_intensity },
    masteryScore: row.mastery_score,
    masteryScores,
    thresholdImpact: row.threshold_impact,
    confidence: row.confidence,
    createdAt: row.created_at,
    secondaryEmotions: candidateRows
      .filter((c) => c.kind === 'secondary')
      .map((c) => ({ emotionId: c.emotion_id, probability: c.probability, intensity: c.intensity })),
    hiddenEmotions: candidateRows
      .filter((c) => c.kind === 'hidden')
      .map((c) => ({ emotionId: c.emotion_id, probability: c.probability, intensity: c.intensity })),
    evidence: evidenceRows,
    timeline: timelineRows.map((t) => ({ orderIndex: t.order_index, emotionId: t.emotion_id, intensity: t.intensity })),
  };
}

export function getEmotionAnalysis(id: string, userId: string): EmotionAnalysisDetail | null {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM emotion_analysis WHERE id = ? AND user_id = ?').get(id, userId) as AnalysisRow | undefined;
  return row ? toDetail(row, db) : null;
}

export function listEmotionAnalyses(userId: string, bookId?: string | null, limit = 50): EmotionAnalysisDetail[] {
  const db = requireDb();
  const rows = (
    bookId
      ? db
          .prepare('SELECT * FROM emotion_analysis WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(userId, bookId, Math.max(1, Math.min(500, limit)))
      : db
          .prepare('SELECT * FROM emotion_analysis WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
          .all(userId, Math.max(1, Math.min(500, limit)))
  ) as AnalysisRow[];
  return rows.map((r) => toDetail(r, db));
}

export interface AuthorEmotionProfile {
  totalAnalyses: number;
  averageMasteryScore: number;
  averageConfidence: number;
  averageMasteryByCriterion: Record<MasteryCriterion, number>;
  emotionFrequency: { emotionId: string; count: number }[];
}

function emptyProfile(): AuthorEmotionProfile {
  const byCriterion = {} as Record<MasteryCriterion, number>;
  for (const key of MASTERY_CRITERIA) byCriterion[key] = 0;
  return { totalAnalyses: 0, averageMasteryScore: 0, averageConfidence: 0, averageMasteryByCriterion: byCriterion, emotionFrequency: [] };
}

/**
 * Профіль автора — завжди похідний, ніколи не зберігається (п. 18 ТЗ,
 * коментар у server/db.ts). Той самий принцип, що й server/wdi.ts::
 * projectSkill: журнал (тут — emotion_analysis) є джерелом правди.
 */
export function projectAuthorEmotionProfile(userId: string): AuthorEmotionProfile {
  const db = requireDb();
  const analyses = db
    .prepare('SELECT mastery_score, confidence FROM emotion_analysis WHERE user_id = ?')
    .all(userId) as { mastery_score: number; confidence: number }[];
  if (!analyses.length) return emptyProfile();

  const totalAnalyses = analyses.length;
  const averageMasteryScore =
    Math.round((analyses.reduce((a, r) => a + r.mastery_score, 0) / totalAnalyses) * 10) / 10;
  const averageConfidence =
    Math.round((analyses.reduce((a, r) => a + r.confidence, 0) / totalAnalyses) * 100) / 100;

  const criterionRows = db
    .prepare(
      `SELECT ems.criterion AS criterion, AVG(ems.score) AS avg_score
       FROM emotion_mastery_scores ems
       JOIN emotion_analysis ea ON ea.id = ems.analysis_id
       WHERE ea.user_id = ?
       GROUP BY ems.criterion`
    )
    .all(userId) as { criterion: string; avg_score: number }[];
  const averageMasteryByCriterion = {} as Record<MasteryCriterion, number>;
  for (const key of MASTERY_CRITERIA) averageMasteryByCriterion[key] = 0;
  for (const r of criterionRows) {
    averageMasteryByCriterion[r.criterion as MasteryCriterion] = Math.round(r.avg_score * 10) / 10;
  }

  const freqRows = db
    .prepare(
      `SELECT primary_emotion_id AS emotion_id, COUNT(*) AS n
       FROM emotion_analysis WHERE user_id = ? GROUP BY primary_emotion_id ORDER BY n DESC LIMIT 20`
    )
    .all(userId) as { emotion_id: string; n: number }[];

  return {
    totalAnalyses,
    averageMasteryScore,
    averageConfidence,
    averageMasteryByCriterion,
    emotionFrequency: freqRows.map((r) => ({ emotionId: r.emotion_id, count: r.n })),
  };
}

export interface EmotionDictionaryEntry {
  id: string;
  category: string;
  labelUk: string;
  isCustom: boolean;
}

export function listEmotionDictionary(): EmotionDictionaryEntry[] {
  const db = requireDb();
  const rows = db.prepare('SELECT id, category, label_uk, is_custom FROM emotion_dictionary ORDER BY category, label_uk').all() as {
    id: string;
    category: string;
    label_uk: string;
    is_custom: number;
  }[];
  return rows.map((r) => ({ id: r.id, category: r.category, labelUk: r.label_uk, isCustom: Boolean(r.is_custom) }));
}

/** Лише для тестів: прибрати аналізи одного автора. */
export function __clearEmotionAnalysesForTests(userId: string): void {
  requireDb().prepare('DELETE FROM emotion_analysis WHERE user_id = ?').run(userId);
}

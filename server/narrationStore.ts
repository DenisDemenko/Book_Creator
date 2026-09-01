/**
 * Кеш озвучених фрагментів (розділів, виділень) — server/narration.ts
 * лише синтезує звук, а сюди він кладеться, щоб той самий текст (той
 * самий розділ книги, той самий виділений абзац) не оплачувався й не
 * генерувався вдруге.
 *
 * На відміну від diagnStore.ts (TTL 24 години) кеш тут БЕЗСТРОКОВИЙ:
 * текст розділу не «застаріває» сам собою — він застаріває лише тоді,
 * коли автор його редагує, а редагування змінює хеш (cache_key залежить
 * від самого тексту), тож і так призводить до нового запису. Друга
 * таблиця для «історії» тут не потрібна, як і в diagnStore.ts.
 */

import { createHash, randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';
import type { NarrationLang } from './narration';

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`Озвучення потребує SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

export interface NarrationRecord {
  id: string;
  cacheKey: string;
  bookId: string | null;
  chapterId: string | null;
  sectionId: string | null;
  scope: 'selection' | 'section';
  lang: NarrationLang;
  voiceId: string;
  audioDataUrl: string;
  charCount: number;
  createdAt: string;
}

interface Row {
  id: string;
  cache_key: string;
  book_id: string | null;
  chapter_id: string | null;
  section_id: string | null;
  scope: string;
  lang: string;
  voice_id: string;
  audio_data_url: string;
  char_count: number;
  created_at: string;
}

/** Ключ кешу — хеш тексту разом із мовою та голосом: інший голос чи мова мають озвучитись заново. */
export function narrationCacheKey(text: string, lang: NarrationLang, voiceId: string): string {
  const h = createHash('sha256');
  h.update(String(text ?? '').trim());
  h.update(' ');
  h.update(lang);
  h.update(' ');
  h.update(voiceId);
  return h.digest('hex');
}

function toRecord(row: Row): NarrationRecord {
  return {
    id: row.id,
    cacheKey: row.cache_key,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    sectionId: row.section_id,
    scope: row.scope as 'selection' | 'section',
    lang: row.lang as NarrationLang,
    voiceId: row.voice_id,
    audioDataUrl: row.audio_data_url,
    charCount: row.char_count,
    createdAt: row.created_at,
  };
}

export function findCachedNarration(cacheKey: string): NarrationRecord | null {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM narrations WHERE cache_key = ?').get(cacheKey) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function saveNarration(input: {
  cacheKey: string;
  bookId: string | null;
  chapterId: string | null;
  sectionId: string | null;
  scope: 'selection' | 'section';
  lang: NarrationLang;
  voiceId: string;
  audioDataUrl: string;
  charCount: number;
}): NarrationRecord {
  const db = requireDb();
  const rec: NarrationRecord = { id: randomUUID(), createdAt: new Date().toISOString(), ...input };
  db.prepare(
    `INSERT INTO narrations
       (id, cache_key, book_id, chapter_id, section_id, scope, lang, voice_id, audio_data_url, char_count, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rec.id,
    rec.cacheKey,
    rec.bookId,
    rec.chapterId,
    rec.sectionId,
    rec.scope,
    rec.lang,
    rec.voiceId,
    rec.audioDataUrl,
    rec.charCount,
    rec.createdAt
  );
  return rec;
}

/** Чи вже є озвучення конкретного розділу цією мовою (для індикатора «готово» в плеєрі книги). */
export function findSectionNarration(sectionId: string, lang: NarrationLang): NarrationRecord | null {
  const db = requireDb();
  const row = db
    .prepare(
      `SELECT * FROM narrations WHERE section_id = ? AND lang = ? AND scope = 'section'
       ORDER BY created_at DESC LIMIT 1`
    )
    .get(sectionId, lang) as Row | undefined;
  return row ? toRecord(row) : null;
}

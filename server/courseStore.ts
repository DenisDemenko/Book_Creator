/**
 * Сховище самостійних навчальних курсів
 * (docs/tech-spec-course-wizard-2026.md, Рішення 1: курс — окрема сутність).
 *
 * Курс НЕ живе всередині книги: ремісничий курс (напр. «Fusion для
 * мебелярів») рукопису не має. Наявний Book.courseConfig («курс із книги»)
 * лишається недоторканим — це інший, паралельний сценарій.
 *
 * Повна структура (модулі, уроки, завдання, навички) лежить одним JSON у
 * колонці payload — як у books/express_drafts. Окремі таблиці на кожен
 * рівень зараз не потрібні: курс редагується лише автором, атомарно.
 */

import { randomUUID } from 'node:crypto';
import { getDb, unavailableMessage } from './db';

function requireDb() {
  const db = getDb();
  if (!db) {
    throw new Error(`Курси потребують SQLite, а сховище недоступне: ${unavailableMessage()}`);
  }
  return db;
}

export type CourseStatus = 'draft' | 'ready' | 'published';

export interface CourseSkill {
  id: string;
  name: string;
  level: 'base' | 'confident' | 'pro';
  whyItMatters: string;
  howToDevelop: string[];
  practiceIdeas: string[];
}

export interface Assignment {
  id: string;
  title: string;
  brief: string;
  steps: string[];
  deliverable: string;
  acceptanceCriteria: string[];
  estimateMin?: number;
}

export interface CourseLessonV2 {
  id: string;
  title: string;
  goal?: string;
  description?: string;
  topics: string[];
  videoUrl?: string;
  photoUrls: string[];
  assignment?: Assignment;
  durationMin?: number;
}

export interface CourseModuleV2 {
  id: string;
  title: string;
  summary?: string;
  coverPhotoUrl?: string;
  introVideoUrl?: string;
  lessons: CourseLessonV2[];
  finalAssignment?: Assignment;
  skillIds: string[];
}

export interface Course {
  id: string;
  ownerId: string;
  status: CourseStatus;
  title: string;
  subtitle?: string;
  summary?: string;
  description?: string;
  audience: string[];
  outcomes: string[];
  highlights: string[];
  coverUrl?: string;
  category?: string;
  priceMinor?: number;
  currency?: string;
  skills: CourseSkill[];
  modules: CourseModuleV2[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

interface Row {
  id: string;
  owner_id: string;
  status: string;
  title: string;
  payload: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

const STATUSES: CourseStatus[] = ['draft', 'ready', 'published'];

function toCourse(row: Row): Course {
  let data: Partial<Course> = {};
  try {
    data = JSON.parse(row.payload) as Partial<Course>;
  } catch {
    data = {};
  }
  return {
    id: row.id,
    ownerId: row.owner_id,
    status: (STATUSES.includes(row.status as CourseStatus) ? row.status : 'draft') as CourseStatus,
    title: row.title,
    subtitle: data.subtitle,
    summary: data.summary,
    description: data.description,
    audience: data.audience ?? [],
    outcomes: data.outcomes ?? [],
    highlights: data.highlights ?? [],
    coverUrl: data.coverUrl,
    category: data.category,
    priceMinor: data.priceMinor,
    currency: data.currency,
    skills: data.skills ?? [],
    modules: data.modules ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at ?? undefined,
  };
}

export function createCourse(
  ownerId: string,
  input: Partial<Course> = {}
): Course {
  const db = requireDb();
  const now = new Date().toISOString();
  const course: Course = {
    id: randomUUID(),
    ownerId,
    status: 'draft',
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : 'Новий курс',
    subtitle: input.subtitle,
    summary: input.summary,
    description: input.description,
    audience: input.audience ?? [],
    outcomes: input.outcomes ?? [],
    highlights: input.highlights ?? [],
    coverUrl: input.coverUrl,
    category: input.category,
    priceMinor: input.priceMinor,
    currency: input.currency,
    skills: input.skills ?? [],
    modules: input.modules ?? [],
    createdAt: now,
    updatedAt: now,
    publishedAt: input.publishedAt,
  };

  db.prepare(
    `INSERT INTO courses (id, owner_id, status, title, payload, created_at, updated_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    course.id,
    course.ownerId,
    course.status,
    course.title,
    JSON.stringify(coursePayload(course)),
    course.createdAt,
    course.updatedAt,
    course.publishedAt ?? null
  );

  return course;
}

function coursePayload(course: Course): Omit<Course, 'id' | 'ownerId' | 'status' | 'title' | 'createdAt' | 'updatedAt' | 'publishedAt'> {
  const { id: _id, ownerId: _o, status: _s, title: _t, createdAt: _c, updatedAt: _u, publishedAt: _p, ...rest } = course;
  return rest;
}

export function getCourse(id: string): Course | undefined {
  const db = requireDb();
  const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(id) as Row | undefined;
  return row ? toCourse(row) : undefined;
}

export function listCoursesForOwner(ownerId: string): Course[] {
  const db = requireDb();
  const rows = db
    .prepare('SELECT * FROM courses WHERE owner_id = ? ORDER BY updated_at DESC')
    .all(ownerId) as Row[];
  return rows.map(toCourse);
}

export function listAllCourses(): Course[] {
  const db = requireDb();
  const rows = db.prepare('SELECT * FROM courses ORDER BY updated_at DESC').all() as Row[];
  return rows.map(toCourse);
}

/**
 * Повне перезаписування вмісту курсу зі збереженням службових полів.
 * Автор редагує курс на екрані «Створити курс» і надсилає весь стан.
 */
export function updateCourse(id: string, patch: Partial<Course>): Course | undefined {
  const current = getCourse(id);
  if (!current) return undefined;

  const db = requireDb();
  const now = new Date().toISOString();

  const next: Course = {
    ...current,
    ...patch,
    id: current.id,
    ownerId: current.ownerId,
    createdAt: current.createdAt,
    updatedAt: now,
    publishedAt: patch.status === 'published' ? (current.publishedAt ?? now) : current.publishedAt,
  };
  if (patch.title !== undefined) {
    next.title = typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : current.title;
  }
  if (patch.status !== undefined) {
    next.status = STATUSES.includes(patch.status) ? patch.status : current.status;
  }

  db.prepare(
    `UPDATE courses SET status = ?, title = ?, payload = ?, updated_at = ?, published_at = ? WHERE id = ?`
  ).run(
    next.status,
    next.title,
    JSON.stringify(coursePayload(next)),
    next.updatedAt,
    next.publishedAt ?? null,
    id
  );

  return next;
}

export function deleteCourse(id: string): boolean {
  const db = requireDb();
  const info = db.prepare('DELETE FROM courses WHERE id = ?').run(id) as { changes?: number };
  return (info.changes ?? 0) > 0;
}

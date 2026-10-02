/**
 * Маршрути самостійних навчальних курсів
 * (docs/tech-spec-course-wizard-2026.md, Фаза 1).
 *
 * Курс — окрема сутність із власним сховищем (courseStore.ts). Створюють
 * курси ролі з правом canAuthorCourses (експерт, викладач, адміністратор).
 * Т6.3: курс — ще й проєкт ядра (`course-<id>`) з учасниками й наданим
 * доступом: співавтор курсу бачить і править чужий курс за наданим доступом
 * (без глобального права авторства курсів); публікує й видаляє — власник чи
 * адмін. Чужий курс без доступу віддається як 404, а не 403: існування
 * чужого курсу — зайва інформація для того, кому він недоступний.
 */

import type { Express } from 'express';
import { can, requireAuth, requirePermission } from './auth';
import { submitForModeration } from './moderationStore';
import {
  createCourse,
  deleteCourse,
  getCourse,
  listAllCourses,
  listCoursesForOwner,
  updateCourse,
  type Course,
} from './courseStore';

const OWNER_ERROR = 'Курс не знайдено.';

function canManage(principal: { id: string | null; role: string }, course: Course): boolean {
  return principal.role === 'admin' || course.ownerId === principal.id;
}

/** Т6.3: доступ учасника до чужого курсу (наданий доступ ядра) і реєстрація курсу в ядрі. */
export interface CourseRoutesDeps {
  /** 'view' | 'edit' за наданим доступом; 'none' — немає. Власник і адмін сюди не потрапляють. */
  courseAccess?: (principal: { id: string | null; role: string; isGuest?: boolean }, course: Course) => Promise<'none' | 'view' | 'edit'>;
  /** Курси, де людина — учасник із доступом (не власник). */
  sharedCourseIds?: (userId: string) => Promise<string[]>;
  /** Курс створено чи змінено — оновити проєкт ядра. */
  onCourseChanged?: (course: Course) => void;
}

async function accessTo(deps: CourseRoutesDeps, principal: { id: string | null; role: string }, course: Course): Promise<'none' | 'view' | 'edit' | 'manage'> {
  if (canManage(principal, course)) return 'manage';
  if (!deps.courseAccess) return 'none';
  return deps.courseAccess(principal, course).catch(() => 'none' as const);
}

// Server-side gate before a course reaches the storefront. A subset of the
// editor's readiness checklist: the essentials a catalog card needs, without
// the per-lesson polish checks the UI still guides the author on.
function publishProblems(course: Course): string[] {
  const problems: string[] = [];
  if (!course.title.trim() || course.title === 'Новий курс') problems.push('Курс без назви.');
  if (!course.subtitle?.trim()) problems.push('Немає підзаголовка.');
  if (course.audience.filter(Boolean).length === 0) problems.push('Не описана аудиторія.');
  if (course.outcomes.filter(Boolean).length === 0) problems.push('Немає результатів навчання.');
  if (course.highlights.filter(Boolean).length < 3) problems.push('Менше трьох вигод на картку.');
  if (course.skills.length === 0) problems.push('Немає навичок курсу.');
  if (course.modules.length === 0) problems.push('Немає жодного модуля.');
  course.modules.forEach((m, i) => {
    const n = i + 1;
    if (!m.title.trim()) problems.push(`Модуль ${n}: без назви.`);
    if (m.lessons.length === 0) problems.push(`Модуль ${n}: жодного уроку.`);
  });
  return problems;
}

export function registerCourseRoutes(app: Express, deps: CourseRoutesDeps = {}): void {
  /** Список курсів: автор бачить свої, адміністратор — усі; учасник — ще й спільні (`shared`). */
  app.get('/api/courses', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const author = await can(principal.role, 'canAuthorCourses');
      const mine = !author ? [] : principal.role === 'admin' ? listAllCourses() : listCoursesForOwner(principal.id as string);
      const sharedIds = deps.sharedCourseIds && principal.id ? await deps.sharedCourseIds(principal.id).catch(() => []) : [];
      const shared = sharedIds.filter((id) => !mine.some((c) => c.id === id)).map((id) => getCourse(id)).filter((c): c is Course => !!c);
      if (!author && !shared.length) {
        return res.status(403).json({ error: 'Курси створюють експерти й викладачі; спільних курсів у вас ще немає.', permission: 'canAuthorCourses' });
      }
      res.json({ courses: mine, shared, canAuthor: author });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  /** Створення чернетки курсу. */
  app.post('/api/courses', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const principal = req.principal!;
      const course = createCourse(principal.id as string, req.body || {});
      deps.onCourseChanged?.(course);
      res.status(201).json({ course });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  app.get('/api/courses/:id', requireAuth, async (req, res) => {
    try {
      const course = getCourse(req.params.id);
      const level = course ? await accessTo(deps, req.principal!, course) : 'none';
      if (!course || level === 'none') {
        return res.status(404).json({ error: OWNER_ERROR });
      }
      res.json({ course, access: level });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  /** Повне збереження курсу (автор надсилає весь стан). */
  app.put('/api/courses/:id', requireAuth, async (req, res) => {
    try {
      const existing = getCourse(req.params.id);
      const level = existing ? await accessTo(deps, req.principal!, existing) : 'none';
      if (!existing || level === 'none') {
        return res.status(404).json({ error: OWNER_ERROR });
      }
      if (level === 'view') {
        return res.status(403).json({ error: 'У вас доступ лише на перегляд цього курсу.', kind: 'forbidden' });
      }
      const course = updateCourse(req.params.id, req.body || {});
      if (!course) return res.status(404).json({ error: OWNER_ERROR });
      deps.onCourseChanged?.(course);
      res.json({ course, access: level });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  /**
   * Подання курсу на модерацію. Курс у вітрину НЕ публікується одразу —
   * він потрапляє в чергу, і адміністратор погоджує або відхиляє його
   * в розділі «Міст до вітрини → Модерація».
   */
  app.post('/api/courses/:id/publish', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const course = getCourse(req.params.id);
      if (!course || !canManage(req.principal!, course)) {
        return res.status(404).json({ error: OWNER_ERROR });
      }

      const problems = publishProblems(course);
      if (problems.length > 0) {
        return res.status(400).json({ error: 'Курс не готовий до публікації', problems });
      }

      const moderation = submitForModeration({
        itemType: 'course',
        itemId: course.id,
        title: course.title,
        authorId: course.ownerId,
      });

      res.json({ submitted: true, moderation });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  app.delete('/api/courses/:id', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const existing = getCourse(req.params.id);
      if (!existing || !canManage(req.principal!, existing)) {
        return res.status(404).json({ error: OWNER_ERROR });
      }
      deleteCourse(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });
}

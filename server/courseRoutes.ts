/**
 * Маршрути самостійних навчальних курсів
 * (docs/tech-spec-course-wizard-2026.md, Фаза 1).
 *
 * Курс — окрема сутність із власним сховищем (courseStore.ts). Доступ
 * лише ролям із правом canAuthorCourses (експерт, викладач, адміністратор).
 * Чужий курс віддається як 404, а не 403: існування чужого курсу —
 * зайва інформація для того, кому він недоступний.
 */

import type { Express } from 'express';
import { requireAuth, requirePermission } from './auth';
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

export function registerCourseRoutes(app: Express): void {
  /** Список курсів: автор бачить свої, адміністратор — усі. */
  app.get('/api/courses', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const principal = req.principal!;
      const courses = principal.role === 'admin' ? listAllCourses() : listCoursesForOwner(principal.id as string);
      res.json({ courses });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  /** Створення чернетки курсу. */
  app.post('/api/courses', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const principal = req.principal!;
      const course = createCourse(principal.id as string, req.body || {});
      res.status(201).json({ course });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  app.get('/api/courses/:id', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const course = getCourse(req.params.id);
      if (!course || !canManage(req.principal!, course)) {
        return res.status(404).json({ error: OWNER_ERROR });
      }
      res.json({ course });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  /** Повне збереження курсу (автор надсилає весь стан). */
  app.put('/api/courses/:id', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const existing = getCourse(req.params.id);
      if (!existing || !canManage(req.principal!, existing)) {
        return res.status(404).json({ error: OWNER_ERROR });
      }
      const course = updateCourse(req.params.id, req.body || {});
      if (!course) return res.status(404).json({ error: OWNER_ERROR });
      res.json({ course });
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

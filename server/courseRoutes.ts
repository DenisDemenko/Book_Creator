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

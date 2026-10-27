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
import { latestModerationFor, submitForModeration } from './moderationStore';
import { listBridgeCategories } from './marketplaceBridge';
import { courseSubmitProblems } from '../src/utils/coursePublishRules';
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
  /** Категорії вітрини для вибору в редакторі (типово — через міст). */
  listCategories?: () => Promise<Array<{ slug: string; name: string }>>;
}

/**
 * Службові поля, яких автор не задає: статус курсу виводиться з модерації
 * (раніше автор міг сам поставити «Опубліковано» в обхід черги), валюта —
 * завжди гривня.
 */
function authorPatch(body: unknown): Partial<Course> {
  const { status: _s, publishedAt: _p, ownerId: _o, id: _i, createdAt: _c, updatedAt: _u, currency: _cur, ...rest } =
    (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  return rest as Partial<Course>;
}

async function accessTo(deps: CourseRoutesDeps, principal: { id: string | null; role: string }, course: Course): Promise<'none' | 'view' | 'edit' | 'manage'> {
  if (canManage(principal, course)) return 'manage';
  if (!deps.courseAccess) return 'none';
  return deps.courseAccess(principal, course).catch(() => 'none' as const);
}

// Server-side gate before a course reaches the storefront: the shared rules
// (src/utils/coursePublishRules.ts) — the editor shows the same list plus its
// own polish checks, so the two can no longer drift apart.
function publishProblems(course: Course, categories: Array<{ slug: string }>): string[] {
  // Категорія обов'язкова, коли вітрина віддала непорожній перелік; невідомий
  // slug (розділ прибрали на вітрині) вона відхилила б при публікації — краще
  // сказати це вже при поданні.
  const problems = courseSubmitProblems(course, { categoryRequired: categories.length > 0 });
  const slug = String(course.categorySlug ?? '').trim();
  if (categories.length > 0 && slug && !categories.some((c) => c.slug === slug)) {
    problems.push('Обрана категорія більше не існує на вітрині — оберіть іншу.');
  }
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

  /**
   * Категорії вітрини для редактора курсу. Не адмінський маршрут моста:
   * курси пишуть експерти й викладачі, а не лише адміністратор. Порожній
   * перелік (міст не налаштовано чи старий маркетплейс) — не помилка.
   */
  app.get('/api/courses/storefront-categories', requireAuth, requirePermission('canAuthorCourses'), async (_req, res) => {
    try {
      const list = await (deps.listCategories ?? listBridgeCategories)();
      res.json({ categories: list.map((c) => ({ slug: c.slug, name: c.name })) });
    } catch (err) {
      res.json({ categories: [], warning: String((err as Error).message) });
    }
  });

  /** Створення чернетки курсу. */
  app.post('/api/courses', requireAuth, requirePermission('canAuthorCourses'), async (req, res) => {
    try {
      const principal = req.principal!;
      const course = createCourse(principal.id as string, authorPatch(req.body));
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
      let moderation = null;
      try {
        moderation = latestModerationFor('course', course.id) ?? null;
      } catch {
        // без SQLite модерації нема — курс однаково віддаємо
      }
      res.json({ course, access: level, moderation });
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
      const course = updateCourse(req.params.id, authorPatch(req.body));
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

      // Збій моста не блокує подання: без переліку категорія просто не вимагається.
      const categories = await (deps.listCategories ?? listBridgeCategories)().catch(() => []);
      const problems = publishProblems(course, categories);
      if (problems.length > 0) {
        return res.status(400).json({ error: 'Курс не готовий до публікації', problems });
      }

      const moderation = submitForModeration({
        itemType: 'course',
        itemId: course.id,
        title: course.title,
        authorId: course.ownerId,
        // Знімок на момент подання: адмін погоджує саме його.
        snapshot: JSON.stringify(course),
      });
      // «Готовий» тепер означає «на модерації»; опублікованим курс робить
      // лише погодження адміністратора. Повторне подання опублікованого курсу
      // (оновлення у вітрині) статус не знижує.
      const updated = course.status === 'published' ? course : updateCourse(course.id, { status: 'ready' }) ?? course;

      res.json({ submitted: true, moderation, course: updated });
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

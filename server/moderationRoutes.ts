/**
 * REST-шар черги модерації публікацій у вітрину.
 *
 * Автор подає твір через наявні маршрути (курс — POST /api/courses/:id/publish,
 * який кладе запис у чергу). Тут — адміністраторська половина: перегляд
 * черги, погодження (і для курсу — власне публікація у вітрину) та відхилення.
 */

import type { Express } from 'express';
import { requireAdmin } from './auth';
import { publishCourseToMarketplace, MarketplaceBridgeError } from './marketplaceBridge';
import { getCourse, updateCourse } from './courseStore';
import {
  decideModeration,
  getModeration,
  listModeration,
  type ModerationStatus,
} from './moderationStore';

const STATUSES: ModerationStatus[] = ['pending', 'approved', 'rejected'];

export function registerModerationRoutes(app: Express): void {
  app.get('/api/admin/moderation', requireAdmin, async (req, res) => {
    const status = String(req.query.status ?? '');
    const entries = STATUSES.includes(status as ModerationStatus)
      ? listModeration(status as ModerationStatus)
      : listModeration();
    res.json({ moderation: entries });
  });

  app.post('/api/admin/moderation/:id/approve', requireAdmin, async (req, res) => {
    try {
      const entry = getModeration(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Запис модерації не знайдено.' });
      if (entry.status !== 'pending') {
        return res.status(409).json({ error: `Запис уже вирішено (статус: ${entry.status}).` });
      }

      let published: unknown;
      if (entry.itemType === 'course') {
        const course = getCourse(entry.itemId);
        if (!course) {
          return res.status(404).json({ error: 'Курс не знайдено — можливо, його видалили.' });
        }
        const sellerSlug = process.env.BRIDGE_SELLER_SLUG || 'fusion-lab';
        const result = await publishCourseToMarketplace({
          bookId: course.id,
          title: course.title,
          subtitle: course.subtitle,
          summary: course.summary,
          description: course.description,
          priceMinor: course.priceMinor ?? 0,
          coverUrl: course.coverUrl,
          highlights: course.highlights.filter(Boolean),
          sellerSlug,
          moduleCount: course.modules.length,
          lessonCount: course.modules.reduce((n, m) => n + m.lessons.length, 0),
        });
        updateCourse(course.id, { status: 'published' });
        published = result;
      }
      // book | instruction | game: авто-публікація ще не підключена — поки що лише погодження.

      const decided = decideModeration(entry.id, 'approved');
      res.json({ moderation: decided, published });
    } catch (err) {
      if (err instanceof MarketplaceBridgeError) {
        return res.status(err.status).json({ error: err.message, kind: err.kind, details: err.details });
      }
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  app.post('/api/admin/moderation/:id/reject', requireAdmin, async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'Вкажіть причину відхилення.' });

    const entry = getModeration(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Запис модерації не знайдено.' });

    const decided = decideModeration(entry.id, 'rejected', reason);
    res.json({ moderation: decided });
  });
}

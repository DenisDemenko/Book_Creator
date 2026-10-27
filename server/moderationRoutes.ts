/**
 * REST-шар черги модерації публікацій у вітрину.
 *
 * Автор подає твір через наявні маршрути (курс — POST /api/courses/:id/publish,
 * який кладе запис у чергу). Тут — адміністраторська половина: перегляд
 * черги, повна картка запису, погодження (і для курсу — власне публікація у
 * вітрину), повернення автору із зауваженнями та остаточне відхилення.
 *
 * Адмін погоджує ЗНІМОК курсу на момент подання, а не живий стан: правки, які
 * автор вніс після подання, у вітрину не потраплять, доки він не надішле курс
 * ще раз (див. moderationStore.submitForModeration).
 */

import type { Express } from 'express';
import { requireAdmin } from './auth';
import {
  publishCourseToMarketplace,
  assertStorefrontCover,
  assertFreePriceConfirmed,
  MarketplaceBridgeError,
  listBridgeCategories,
  bridgeSupportsCourseContent,
} from './marketplaceBridge';
import { buildCoursePublishInput } from './courseMarketplacePayload';
import { findUserById } from './store';
import { notifyAuthorOfDecision } from './moderationNotify';
import { courseSnapshotChanges } from '../src/utils/courseSnapshotDiff';
import { courseSubmitProblems } from '../src/utils/coursePublishRules';
import { getCourse, updateCourse, type Course } from './courseStore';
import {
  decideModeration,
  getModeration,
  getModerationSnapshot,
  listModeration,
  type ModerationStatus,
} from './moderationStore';

const STATUSES: ModerationStatus[] = ['pending', 'approved', 'rejected', 'changes_requested'];

/** Курс, який розглядає адмін: знімок подання; для старих записів без знімка — живий стан. */
function courseUnderReview(entryId: string, itemId: string): { course: Course; source: 'snapshot' | 'live' } | null {
  const raw = getModerationSnapshot(entryId);
  if (raw) {
    try {
      return { course: JSON.parse(raw) as Course, source: 'snapshot' };
    } catch {
      // зіпсований знімок не повинен блокувати модерацію — береться живий стан
    }
  }
  const live = getCourse(itemId);
  return live ? { course: live, source: 'live' } : null;
}

export function registerModerationRoutes(app: Express): void {
  app.get('/api/admin/moderation', requireAdmin, async (req, res) => {
    const status = String(req.query.status ?? '');
    const entries = STATUSES.includes(status as ModerationStatus)
      ? listModeration(status as ModerationStatus)
      : listModeration();
    res.json({ moderation: entries });
  });

  /**
   * Скільки чого чекає рішення: для лічильника на вкладці «Модерація» й у
   * фільтрах черги. Адмін бачить «є що вирішувати» ще до відкриття розділу.
   */
  app.get('/api/admin/moderation/summary', requireAdmin, (_req, res) => {
    const counts: Record<string, number> = { pending: 0, changes_requested: 0, approved: 0, rejected: 0 };
    const pendingByType: Record<string, number> = {};
    for (const entry of listModeration()) {
      counts[entry.status] = (counts[entry.status] ?? 0) + 1;
      if (entry.status === 'pending') pendingByType[entry.itemType] = (pendingByType[entry.itemType] ?? 0) + 1;
    }
    res.json({ counts, pendingByType, pending: counts.pending });
  });

  /**
   * Повна картка запису. Для курсу — усе, що вирішує питання «публікувати
   * чи ні»: ціна, обкладинка, категорія, аудиторія, навички, програма з
   * відео й тривалістю, а ще — що не так за правилами подання і що автор
   * змінив ПІСЛЯ подання. Раніше в черзі були лише назва та id.
   */
  app.get('/api/admin/moderation/:id', requireAdmin, async (req, res) => {
    try {
      const entry = getModeration(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Запис модерації не знайдено.' });
      if (entry.itemType !== 'course') return res.json({ entry });

      const reviewed = courseUnderReview(entry.id, entry.itemId);
      if (!reviewed) return res.json({ entry, courseDeleted: true });

      const live = getCourse(entry.itemId);
      const changes = reviewed.source === 'snapshot' && live ? courseSnapshotChanges(reviewed.course, live) : [];

      let category: { slug: string; name: string } | null = null;
      if (reviewed.course.categorySlug) {
        const list = await listBridgeCategories().catch(() => []);
        category = list.find((c) => c.slug === reviewed.course.categorySlug) ?? { slug: reviewed.course.categorySlug, name: reviewed.course.categorySlug };
      }

      res.json({
        entry,
        course: reviewed.course,
        source: reviewed.source,
        category,
        problems: courseSubmitProblems(reviewed.course),
        changes,
        courseDeleted: !live,
      });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
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
        const live = getCourse(entry.itemId);
        const reviewed = live ? courseUnderReview(entry.id, entry.itemId) : null;
        if (!live || !reviewed) {
          return res.status(404).json({ error: 'Курс не знайдено — можливо, його видалили.' });
        }
        // Публікується те, що розглядав адмін (знімок), а не живий стан.
        const course = reviewed.course;
        const sellerSlug = process.env.BRIDGE_SELLER_SLUG || 'fusion-lab';
        /*
          Перевірка ще раз У МОМЕНТ ПОГОДЖЕННЯ, тими самими правилами, що й
          при поданні: курс міг змінитись після подання, а старі записи черги
          подавались ще без перевірки ціни й обкладинки. Головне — ціна: досі
          тут стояло `priceMinor ?? 0`, і курс без ціни ставав безкоштовним.
        */
        const problems = courseSubmitProblems(course);
        if (problems.length > 0) {
          return res.status(400).json({
            error: `Курс не можна погодити: ${problems.join(' ')}`,
            problems,
            kind: 'not_ready',
          });
        }
        // Курс без обкладинки дав би в каталозі порожню картку — відмовляємо
        // з причиною замість того, щоб публікувати непоказний товар.
        assertStorefrontCover(course.coverUrl, `Курс «${course.title}»`);
        const priceMinor = course.free === true ? 0 : Math.round(Number(course.priceMinor));
        assertFreePriceConfirmed(priceMinor, course.free === true, `Курс «${course.title}»`);
        // Повний платний зміст — лише приймачу, що сам заявив білий список
        // публічних полів; інакше безпечний обсяг (див. bridgeSupportsCourseContent).
        const richContent = await bridgeSupportsCourseContent();
        const result = await publishCourseToMarketplace(
          buildCoursePublishInput(course, sellerSlug, {
            richContent,
            instructorName: (await findUserById(course.ownerId))?.name,
          })
        );
        updateCourse(course.id, { status: 'published' });
        published = { ...result, contentMode: richContent ? 'full' : 'programme' };
      }
      // book | instruction | game: авто-публікація ще не підключена — поки що лише погодження.

      const decided = decideModeration(entry.id, 'approved');
      const notification = await notifyAuthorOfDecision(entry, 'approved');
      res.json({ moderation: decided, published, notification });
    } catch (err) {
      if (err instanceof MarketplaceBridgeError) {
        return res.status(err.status).json({ error: err.message, kind: err.kind, details: err.details });
      }
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  /**
   * Повернути автору із зауваженнями. На відміну від «Відхилити остаточно»
   * це не вирок: курс повертається в чернетку, автор бачить зауваження в
   * редакторі, виправляє й надсилає ще раз — новим записом черги.
   */
  app.post('/api/admin/moderation/:id/request-changes', requireAdmin, async (req, res) => {
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    if (!note) {
      return res.status(400).json({ error: 'Напишіть зауваження: без них автор не знатиме, що виправляти.' });
    }
    try {
      const entry = getModeration(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Запис модерації не знайдено.' });
      if (entry.status !== 'pending') {
        return res.status(409).json({ error: `Запис уже вирішено (статус: ${entry.status}).` });
      }
      const decided = decideModeration(entry.id, 'changes_requested', note);
      if (entry.itemType === 'course') {
        const course = getCourse(entry.itemId);
        if (course && course.status === 'ready') updateCourse(course.id, { status: 'draft' });
      }
      const notification = await notifyAuthorOfDecision(entry, 'changes_requested', note);
      res.json({ moderation: decided, notification });
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message) });
    }
  });

  app.post('/api/admin/moderation/:id/reject', requireAdmin, async (req, res) => {
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
    if (!reason) return res.status(400).json({ error: 'Вкажіть причину відхилення.' });

    const entry = getModeration(req.params.id);
    if (!entry) return res.status(404).json({ error: 'Запис модерації не знайдено.' });
    // Як і погодження: вирішене вдруге не вирішується. Інакше вже
    // опублікований курс дістав би статус «відхилено» при живому лістингу.
    if (entry.status !== 'pending') {
      return res.status(409).json({ error: `Запис уже вирішено (статус: ${entry.status}).` });
    }

    const decided = decideModeration(entry.id, 'rejected', reason);
    if (entry.itemType === 'course') {
      const course = getCourse(entry.itemId);
      // Відхилений курс повертається в чернетку (якщо він ще не у вітрині).
      if (course && course.status === 'ready') updateCourse(course.id, { status: 'draft' });
    }
    const notification = await notifyAuthorOfDecision(entry, 'rejected', reason);
    res.json({ moderation: decided, notification });
  });
}

/**
 * HTTP-шар інтеграції з Gamma.
 *
 * ҐЕЙТ. Той самий порядок, що в King Market Intelligence: requireAuth (хто
 * ти) → requirePlanAtLeast (чи оплачено). Причина сильніша за звичайну:
 * кожна генерація списує кредити з рахунку ВЛАСНИКА студії, а не автора.
 * Відкрити її всім означало б віддати свій баланс у чужі руки.
 *
 * ЩО РОБИТЬ КОЖЕН МАРШРУТ:
 *   POST /api/gamma/generate      — поставити задачу (повертає id, не результат);
 *   GET  /api/gamma/jobs/:id      — статус задачі, з дотягуванням із Gamma;
 *   GET  /api/gamma/jobs          — свої задачі;
 *   GET  /api/gamma/usage         — скільки кредитів витрачено;
 *   GET  /api/gamma/settings      — чи налаштовано, які теми доступні.
 *
 * ЧОМУ ЗАДАЧА, А НЕ ОЧІКУВАННЯ ВІДПОВІДІ. Генерація триває 1–3 хвилини —
 * довше за будь-який розумний HTTP-запит. Тримати зʼєднання відкритим
 * означало б, що обрив мережі губить оплачену роботу.
 */

import type { Express, Request, Response } from 'express';
import { requireAuth } from './auth';
import { requirePlanAtLeast } from './subscriptions';
import { GammaApiError, createGeneration, getGeneration, listThemes, type GammaClient } from './gamma/gammaClient';
import { readGammaConfig } from './gamma/gammaConfig';
import {
  createJob,
  creditsSpent,
  getJob,
  listJobs,
  updateJob,
  type GammaJobKind,
} from './gamma/gammaStore';

export interface GammaRoutesDeps {
  /** null — ключа немає; маршрути відповідають 503 із поясненням. */
  getClient: () => GammaClient | null;
  now?: () => Date;
}

/** Скільки символів має сенс віддавати Gamma. Її стеля — 400 000. */
const MAX_INPUT_CHARS = 100_000;

const KINDS: Record<GammaJobKind, { format: string; label: string }> = {
  course_deck: { format: 'presentation', label: 'Курс-презентація' },
  landing: { format: 'webpage', label: 'Лендінг' },
  social: { format: 'social', label: 'Пост у соцмережі' },
  document: { format: 'document', label: 'Документ' },
};

function fail(res: Response, err: unknown, fallback: string): void {
  if (err instanceof GammaApiError) {
    // 402 і 403 — стани рахунку й тарифу, а не збої коду. Віддаємо їх як є,
    // щоб автор прочитав причину, а не «щось пішло не так».
    const status = err.status === 402 || err.status === 403 || err.status === 401 ? err.status : 502;
    res.status(status).json({ error: err.message, kind: err.kind });
    return;
  }
  const message = (err as Error)?.message || fallback;
  console.error('[gamma]', message);
  res.status(500).json({ error: message });
}

export function registerGammaRoutes(app: Express, deps: GammaRoutesDeps): void {
  const now = deps.now || (() => new Date());
  const gate = [requireAuth, requirePlanAtLeast(['pro', 'ultra'])] as const;

  function clientOr503(res: Response): GammaClient | null {
    const client = deps.getClient();
    if (!client) {
      res.status(503).json({ error: readGammaConfig().reasonUk, kind: 'no_key' });
      return null;
    }
    return client;
  }

  app.get('/api/gamma/settings', ...gate, async (_req: Request, res: Response) => {
    try {
      const cfg = readGammaConfig();
      let themes: unknown = null;
      const client = deps.getClient();
      if (client) {
        try {
          themes = await listThemes(client);
        } catch {
          // Теми — прикраса вибору; їхня відсутність не має ламати екран.
          themes = null;
        }
      }
      res.json({
        configured: cfg.configured,
        reasonUk: cfg.reasonUk,
        kinds: Object.entries(KINDS).map(([id, v]) => ({ id, ...v })),
        themes,
      });
    } catch (err) {
      fail(res, err, 'Не вдалося прочитати налаштування Gamma.');
    }
  });

  app.post('/api/gamma/generate', ...gate, async (req: Request, res: Response) => {
    try {
      const client = clientOr503(res);
      if (!client) return;

      const kind = String(req.body?.kind || '') as GammaJobKind;
      if (!(kind in KINDS)) {
        return res.status(400).json({
          error: `Невідомий тип «${kind}». Доступні: ${Object.keys(KINDS).join(', ')}.`,
          kind: 'bad_input',
        });
      }

      const inputText = String(req.body?.inputText || '').trim();
      if (!inputText) {
        return res.status(400).json({ error: 'Порожній текст для генерації.', kind: 'bad_input' });
      }
      if (inputText.length > MAX_INPUT_CHARS) {
        return res.status(400).json({
          error: `Текст задовгий (${inputText.length} символів, максимум ${MAX_INPUT_CHARS}).`,
          kind: 'bad_input',
        });
      }

      const created = await createGeneration(client, {
        inputText,
        format: KINDS[kind].format as never,
        numCards: Number.isFinite(Number(req.body?.numCards)) ? Number(req.body.numCards) : undefined,
        themeId: req.body?.themeId ? String(req.body.themeId) : undefined,
        title: req.body?.title ? String(req.body.title) : undefined,
        exportAs: ['pdf', 'pptx', 'png'].includes(req.body?.exportAs) ? req.body.exportAs : undefined,
        // Мова за замовчуванням українська: Студія україномовна, і англійський
        // дек за замовчуванням був би сюрпризом, а не зручністю.
        textOptions: { language: 'uk', ...(req.body?.textOptions || {}) },
        imageOptions: req.body?.imageOptions || undefined,
      });

      const job = await createJob({
        id: String(created.generationId),
        userId: (req.principal?.id as string) ?? null,
        bookId: req.body?.bookId ? String(req.body.bookId) : null,
        kind,
        format: KINDS[kind].format,
        status: 'pending',
        title: req.body?.title ? String(req.body.title) : '',
        gammaUrl: null,
        exportUrl: null,
        exportAs: req.body?.exportAs ? String(req.body.exportAs) : null,
        creditsUsed: null,
        creditsLeft: null,
        errorUk: null,
        now,
      });

      res.json({ job, warnings: created.warnings ?? null });
    } catch (err) {
      fail(res, err, 'Не вдалося поставити задачу генерації.');
    }
  });

  /**
   * Статус задачі. Поки вона в роботі — дотягуємо з Gamma й зберігаємо
   * результат: саме тут списані кредити потрапляють у нашу базу, і саме
   * тому опитувати статус має сенс навіть тоді, коли автор уже закрив
   * вкладку.
   */
  app.get('/api/gamma/jobs/:id', ...gate, async (req: Request, res: Response) => {
    try {
      const job = await getJob(req.params.id);
      if (!job || (job.userId && job.userId !== req.principal?.id && req.principal?.role !== 'admin')) {
        return res.status(404).json({ error: 'Задачу не знайдено.' });
      }
      if (job.status !== 'pending') return res.json(job);

      const client = clientOr503(res);
      if (!client) return;

      const remote = await getGeneration(client, job.id);
      if (remote.status === 'pending') return res.json(job);

      const updated = await updateJob(
        job.id,
        remote.status === 'completed'
          ? {
              status: 'completed',
              gammaUrl: remote.gammaUrl ?? null,
              exportUrl: remote.exportUrl ?? null,
              creditsUsed: remote.credits?.deducted ?? null,
              creditsLeft: remote.credits?.remaining ?? null,
            }
          : {
              status: 'failed',
              errorUk: `Gamma не змогла згенерувати: ${JSON.stringify(remote.error ?? 'причина не вказана').slice(0, 300)}`,
            },
        now
      );
      res.json(updated);
    } catch (err) {
      fail(res, err, 'Не вдалося прочитати статус задачі.');
    }
  });

  app.get('/api/gamma/jobs', ...gate, async (req: Request, res: Response) => {
    try {
      res.json({ jobs: await listJobs(req.principal?.id ?? null) });
    } catch (err) {
      fail(res, err, 'Не вдалося прочитати перелік задач.');
    }
  });

  /** «Куди поділись кредити» — питання, заради якого ведеться облік. */
  app.get('/api/gamma/usage', ...gate, async (req: Request, res: Response) => {
    try {
      const since = req.query.since ? String(req.query.since) : undefined;
      const mine = await creditsSpent({ userId: req.principal?.id ?? null, sinceIso: since });
      // Адмін бачить ще й загальну витрату: баланс спільний, і власник має
      // знати, скільки з'їдає вся студія, а не лише він сам.
      const total = req.principal?.role === 'admin' ? await creditsSpent({ sinceIso: since }) : null;
      res.json({ mine, total });
    } catch (err) {
      fail(res, err, 'Не вдалося порахувати витрати.');
    }
  });
}

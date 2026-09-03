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
import {
  GammaApiError,
  createGeneration,
  createImage,
  getGeneration,
  getImage,
  listThemes,
  type GammaClient,
} from './gamma/gammaClient';
import {
  LIMITS,
  estimateGeneration,
  estimateImage,
  tierOfModel,
  type ImageTier,
} from './gamma/gammaCost';
import { GAMMA_KEY_ENGINE, readGammaConfig } from './gamma/gammaConfig';
import { deleteUserApiKey, upsertUserApiKey } from './store';
import { apiKeyFingerprint, encryptApiKey, isApiKeyCryptoConfigured } from './userApiKeyCrypto';
import { resolveGammaKey } from './gamma/gammaAccount';
import {
  createJob,
  creditsSpent,
  getJob,
  listJobs,
  updateJob,
  type GammaJobKind,
} from './gamma/gammaStore';

export interface GammaRoutesDeps {
  /**
   * Клієнт для КОНКРЕТНОГО автора: ключ береться з його власної підписки
   * Gamma. Приймає ключ, а не будує його сам, бо криптографія й доступ до
   * сховища живуть у server.ts разом з рештою.
   */
  makeClient: (apiKey: string) => GammaClient;
  now?: () => Date;
}

/**
 * Наша стеля тексту — нижча за документовані Gamma 400 000.
 *
 * Причина грошова, а не технічна: 400 000 символів — це книга цілком, і
 * Gamma розкладе її на десятки карток по 1–3 кредити кожна плюс картинки.
 * Сто тисяч — це вже великий документ, і далі майже завжди означає, що в
 * запит випадково потрапив увесь рукопис.
 */
const MAX_INPUT_CHARS = 100_000;

const KINDS: Record<GammaJobKind, { format: string; label: string }> = {
  course_deck: { format: 'presentation', label: 'Курс-презентація' },
  landing: { format: 'webpage', label: 'Лендінг' },
  social: { format: 'social', label: 'Пост у соцмережі' },
  document: { format: 'document', label: 'Документ' },
  cover_art: { format: 'image', label: 'Арт обкладинки' },
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

  /**
   * Клієнт автора або чесна відмова.
   *
   * Ключ студії НЕ підміняє відсутній ключ автора: це списало б чужі гроші
   * без відома обох сторін. Тому 503 із поясненням, ЩО саме зробити, а не
   * тиха генерація коштом власника.
   */
  async function clientOr503(req: Request, res: Response): Promise<GammaClient | null> {
    const resolved = await resolveGammaKey({
      userId: (req.principal?.id as string) ?? null,
      role: (req.principal?.role as string) ?? null,
    });
    if (!resolved.apiKey) {
      res.status(503).json({ error: resolved.reasonUk, kind: 'no_key', owner: resolved.owner });
      return null;
    }
    return deps.makeClient(resolved.apiKey);
  }

  app.get('/api/gamma/settings', ...gate, async (req: Request, res: Response) => {
    try {
      const cfg = readGammaConfig();
      const resolved = await resolveGammaKey({
        userId: (req.principal?.id as string) ?? null,
        role: (req.principal?.role as string) ?? null,
      });
      let themes: unknown = null;
      const client = resolved.apiKey ? deps.makeClient(resolved.apiKey) : null;
      if (client) {
        try {
          themes = await listThemes(client);
        } catch {
          // Теми — прикраса вибору; їхня відсутність не має ламати екран.
          themes = null;
        }
      }
      res.json({
        // «Налаштовано» тепер означає «є ЧИМ генерувати саме цьому автору»,
        // а не «у власника є ключ у .env». Перше — правда про кнопку, друге
        // до автора стосунку не має.
        configured: Boolean(resolved.apiKey),
        keyOwner: resolved.owner,
        reasonUk: resolved.reasonUk ?? cfg.reasonUk,
        kinds: Object.entries(KINDS).map(([id, v]) => ({ id, ...v })),
        themes,
        limits: LIMITS,
        // Залишок денної квоти з заголовків останньої відповіді Gamma.
        // Єдине джерело правди про те, скільки ще можна зробити сьогодні.
        rate: client ? client.lastRate() : null,
      });
    } catch (err) {
      fail(res, err, 'Не вдалося прочитати налаштування Gamma.');
    }
  });

  /**
   * Скільки це коштуватиме.
   *
   * Окремий маршрут, а не число в інтерфейсі: ставки Gamma міняються, і
   * зашита в клієнт константа застаріє мовчки. Рахує сервер, показує
   * клієнт — одне джерело правди.
   */
  app.get('/api/gamma/estimate', ...gate, async (req: Request, res: Response) => {
    try {
      const kind = String(req.query.kind || 'course_deck') as GammaJobKind;
      const tier = (String(req.query.imageTier || 'standard') as ImageTier);
      if (kind === 'cover_art') return res.json(estimateImage(tier));
      const numCards = Number(req.query.numCards) || 9;
      res.json(estimateGeneration({ numCards, imageTier: tier }));
    } catch (err) {
      fail(res, err, 'Не вдалося порахувати вартість.');
    }
  });

  /**
   * Арт обкладинки — окремий шлях, бо це `POST /images`, а не генерація
   * документа. Розмір книжкової обкладинки (≈1:1.5) серед пресетів Gamma
   * відсутній: найближчий `social-portrait` дає 4:5, тож готовий файл
   * потребує обрізки перед вставкою в книгу. Кажемо про це в відповіді,
   * а не мовчимо — інакше автор вставить його як є й отримає спотворення.
   */
  app.post('/api/gamma/image', ...gate, async (req: Request, res: Response) => {
    try {
      const client = await clientOr503(req, res);
      if (!client) return;

      const prompt = String(req.body?.prompt || '').trim();
      if (!prompt) return res.status(400).json({ error: 'Порожній опис зображення.', kind: 'bad_input' });
      if (prompt.length > LIMITS.imagePromptMax) {
        return res.status(400).json({
          error: `Опис задовгий (${prompt.length}, максимум ${LIMITS.imagePromptMax}).`,
          kind: 'bad_input',
        });
      }
      const refs = Array.isArray(req.body?.referenceImages) ? req.body.referenceImages : [];
      if (refs.length > LIMITS.referenceImagesMax) {
        return res.status(400).json({
          error: `Референсів забагато (${refs.length}, максимум ${LIMITS.referenceImagesMax}).`,
          kind: 'bad_input',
        });
      }

      const created = await createImage(client, {
        prompt,
        type: req.body?.type,
        sizePreset: req.body?.sizePreset || 'social-portrait',
        themeId: req.body?.themeId || undefined,
        model: req.body?.model || undefined,
        referenceImages: refs.length ? refs : undefined,
      });

      const job = await createJob({
        id: String(created.imageGenerationId),
        userId: (req.principal?.id as string) ?? null,
        bookId: req.body?.bookId ? String(req.body.bookId) : null,
        kind: 'cover_art',
        format: 'image',
        status: 'pending',
        title: req.body?.title ? String(req.body.title) : 'Арт обкладинки',
        gammaUrl: null, exportUrl: null, exportAs: null,
        creditsUsed: null, creditsLeft: null, errorUk: null,
        now,
      });

      res.json({
        job,
        noteUk:
          'Розмір книжкової обкладинки (1:1.5) серед пресетів Gamma відсутній — ' +
          'найближчий дає 4:5. Перед вставкою в книгу файл треба обрізати по ширині.',
      });
    } catch (err) {
      fail(res, err, 'Не вдалося поставити задачу на зображення.');
    }
  });

  /**
   * Підключити власну підписку Gamma.
   *
   * Ключ одразу перевіряється справжнім викликом (`GET /themes`) — інакше
   * автор дізнався б, що вставив не те, лише на першій генерації, уже
   * склавши запит. Зберігається зашифрованим у тій самій таблиці, що й
   * ключі моделей.
   *
   * САМ КЛЮЧ НАЗАД НЕ ВІДДАЄТЬСЯ НІКОЛИ — тільки відбиток. Це правило
   * проєкту, а не обережність заради обережності: ключ, який можна
   * прочитати з API, рано чи пізно опиниться в журналі браузера.
   */
  app.put('/api/gamma/key', ...gate, async (req: Request, res: Response) => {
    try {
      const userId = (req.principal?.id as string) ?? '';
      if (!userId) return res.status(401).json({ error: 'Потрібен вхід.', kind: 'no_auth' });
      if (!isApiKeyCryptoConfigured()) {
        return res.status(503).json({
          error: 'Сервер не налаштований для зберігання ключів (немає USER_API_KEY_SECRET).',
          kind: 'no_crypto',
        });
      }
      const key = String(req.body?.apiKey || '').trim();
      if (!key) return res.status(400).json({ error: 'Порожній ключ.', kind: 'bad_input' });

      // Перевірка перед збереженням: зберегти неробочий ключ означає
      // відкласти помилку на потім і зробити її незрозумілою.
      try {
        await listThemes(deps.makeClient(key));
      } catch (checkErr) {
        const message =
          checkErr instanceof GammaApiError
            ? checkErr.message
            : 'Не вдалося перевірити ключ — Gamma не відповіла.';
        return res.status(400).json({ error: message, kind: 'bad_key' });
      }

      const at = now().toISOString();
      const saved = await upsertUserApiKey({
        userId,
        engine: GAMMA_KEY_ENGINE,
        encryptedKey: encryptApiKey(key),
        fingerprint: apiKeyFingerprint(key),
        createdAt: at,
        updatedAt: at,
      });
      res.json({ connected: true, fingerprint: saved.fingerprint, updatedAt: saved.updatedAt });
    } catch (err) {
      fail(res, err, 'Не вдалося зберегти ключ Gamma.');
    }
  });

  /** Відключити власну підписку. Ключ видаляється, задачі лишаються. */
  app.delete('/api/gamma/key', ...gate, async (req: Request, res: Response) => {
    try {
      const userId = (req.principal?.id as string) ?? '';
      if (!userId) return res.status(401).json({ error: 'Потрібен вхід.', kind: 'no_auth' });
      const removed = await deleteUserApiKey(userId, GAMMA_KEY_ENGINE);
      res.json({ connected: false, removed });
    } catch (err) {
      fail(res, err, 'Не вдалося відключити підписку Gamma.');
    }
  });

  app.post('/api/gamma/generate', ...gate, async (req: Request, res: Response) => {
    try {
      const client = await clientOr503(req, res);
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

      const requestedCards = Number(req.body?.numCards);
      if (
        req.body?.numCards !== undefined &&
        (!Number.isFinite(requestedCards) ||
          requestedCards < LIMITS.numCardsMin ||
          requestedCards > LIMITS.numCardsMax)
      ) {
        // Ловимо тут, а не чекаємо 400 від Gamma: їхня відмова прийде
        // англійською й без згадки про наші межі.
        return res.status(400).json({
          error: `Кількість карток має бути від ${LIMITS.numCardsMin} до ${LIMITS.numCardsMax}.`,
          kind: 'bad_input',
        });
      }

      const created = await createGeneration(client, {
        inputText,
        format: KINDS[kind].format as never,
        numCards: Number.isFinite(requestedCards) ? requestedCards : undefined,
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

      const client = await clientOr503(req, res);
      if (!client) return;

      // Зображення живуть за іншим ендпоінтом — і статус у них теж свій.
      const remote =
        job.kind === 'cover_art'
          ? await getImage(client, job.id).then((r) => ({
              status: r.status,
              gammaUrl: r.image?.url ?? null,
              exportUrl: null,
              credits: r.credits,
              error: r.error,
            }))
          : await getGeneration(client, job.id);
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

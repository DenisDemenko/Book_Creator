/**
 * REST-шар модуля публікації та експорту (Amazon KDP + Etsy).
 *
 * Структура шляхів повторює структуру ТЗ, і це не косметика:
 *
 *   /api/publishing/kdp/*        — підсистема 1: файли й метадані під KDP
 *   /api/publishing/products/*   — товар, його файли та пакувальник (підсистема 3)
 *   /api/etsy/oauth/*            — підключення крамниці (підсистема 2)
 *   /api/etsy/research           — дослідження попиту (підсистема 4)
 *
 * Файли товару — **вкладений ресурс** (`/products/:id/files`), а не пласкі
 * `/files` з productId у тілі: так приналежність перевіряється одним і тим
 * самим кодом для всіх операцій і неможливо створити «сирітський» файл.
 *
 * Зовнішні залежності (fetch, бакети, час) впроваджуються через `deps` — усі
 * роути тестуються з підставним Etsy, без мережі й без ключів.
 */

import type { Express, Request, Response } from 'express';
import express from 'express';
import { requireAuth, requirePermission } from './auth';
import {
  deleteProduct,
  getProduct,
  getPublication,
  getPublicationForProduct,
  getJob,
  getEtsyAccount,
  listProducts,
  listPublicationsForUser,
  saveOAuthState,
  saveProduct,
  savePublication,
  takeOAuthState,
  purgeOldOAuthStates,
  type StoredProduct,
  type StoredPublication,
} from './publishingStore';
import {
  KDP_TRIM_SIZES,
  MAX_PAGE_COUNT,
  MIN_PAGE_COUNT,
  MAX_DESCRIPTION_CHARS,
  KEYWORD_SLOTS,
  MIN_COVER_DPI,
  buildKdpMetadataSheet,
  calculateFullCover,
  validateManuscriptForKdp,
} from './kdpSpec';
import { readEtsyConfig, ETSY_SCOPES, ETSY_RATE_LIMIT_PER_SECOND } from './etsy/etsyConfig';
import { buildAuthorizeUrl, createPkcePair, exchangeCodeForToken, type FetchLike } from './etsy/etsyOAuth';
import { createTokenBucket, type TokenBucket } from './etsy/rateLimiter';
import { createEtsyClient, EtsyApiError, type EtsyClient } from './etsy/etsyClient';
import {
  clientForUser as buildClientForUser,
  disconnect as disconnectEtsy,
  resolveShop,
  saveConnection,
  toPublicAccount,
} from './etsy/etsyAccount';
import { isCryptoConfigured } from './etsy/tokenCrypto';
import {
  MAX_DIGITAL_FILES,
  MAX_FILE_BYTES,
  MAX_LISTING_IMAGES,
  MAX_TAGS,
  ALLOWED_FILE_EXTENSIONS,
  normalizeTags,
  validateListingDraft,
} from './etsy/etsyListingRules';
import {
  deleteProductFile,
  deleteProductFiles,
  listProductFiles,
  readProductFile,
  saveProductFile,
} from './etsy/productFiles';
import { analyzeComponents, packageCourse } from './etsy/coursePackager';
import { enqueuePublishJob, startPublishWorker } from './etsy/publishQueue';
import { researchTopic, startResearchScheduler, topicTrend } from './etsy/researchService';

export interface PublishingRoutesDeps {
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** Куди повертати автора після OAuth-колбека. */
  appUrl?: string;
  /** Вимкнути фонові процеси (тести). */
  disableWorkers?: boolean;
}

/** Найбільший файл, який приймаємо в товар: ліміт Etsy + запас на службові дані. */
const MAX_UPLOAD_BYTES = MAX_FILE_BYTES + 1024 * 1024;

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function isAdmin(req: Request): boolean {
  return req.principal?.role === 'admin';
}

export function registerPublishingRoutes(app: Express, deps: PublishingRoutesDeps = {}): { stop: () => void } {
  const fetchImpl: FetchLike = deps.fetchImpl || ((globalThis as any).fetch as FetchLike);
  const now = deps.now || (() => new Date());

  /**
   * Два бакети, а не один — вимога ТЗ 6.4: фонове дослідження не має
   * з'їдати ліміт швидкості в автора, який саме зараз тисне «Опублікувати».
   */
  const publishBucket: TokenBucket = createTokenBucket({ ratePerSecond: ETSY_RATE_LIMIT_PER_SECOND });
  const researchBucket: TokenBucket = createTokenBucket({
    ratePerSecond: Math.max(1, Math.floor(ETSY_RATE_LIMIT_PER_SECOND / 2)),
  });

  const config = () => readEtsyConfig(deps.appUrl);

  const accountDeps = () => ({
    apiKey: config().apiKey,
    fetchImpl,
    bucket: publishBucket,
    now: () => now().getTime(),
  });

  async function clientForUser(userId: string): Promise<EtsyClient | null> {
    if (!config().configured) return null;
    return buildClientForUser(userId, accountDeps());
  }

  /** Дослідницький клієнт працює на самому api-key — OAuth для нього не потрібен. */
  function researchClient(): EtsyClient | null {
    const cfg = config();
    if (!cfg.apiKey) return null;
    return createEtsyClient({
      apiKey: cfg.apiKey,
      fetchImpl,
      bucket: researchBucket,
      getAccessToken: async () => '',
    });
  }

  // -------------------------------------------------------------------------
  // Спільні помічники
  // -------------------------------------------------------------------------

  async function loadOwnProduct(req: Request, res: Response): Promise<StoredProduct | null> {
    const product = await getProduct(req.params.id);
    // Чужий товар віддаємо як 404, а не 403: 403 підтвердив би сам факт
    // існування такого id. Той самий принцип, що вже діє в чат-сесіях.
    if (!product || (product.authorId !== req.principal?.id && !isAdmin(req))) {
      res.status(404).json({ error: 'Товар не знайдено.' });
      return null;
    }
    return product;
  }

  function handleError(res: Response, err: unknown, fallback: string): void {
    if (err instanceof EtsyApiError) {
      console.error('[publishing] Etsy:', err.status, err.message, err.rawBody);
      res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
      return;
    }
    console.error(`[publishing] ${fallback}:`, err);
    res.status(500).json({ error: fallback });
  }

  // =========================================================================
  // Підсистема 1 — Amazon KDP
  // =========================================================================

  /**
   * Уся специфікація KDP одним запитом. Клієнт не тримає копію цих чисел:
   * коли Amazon змінить вимоги до полів, правити треба буде один файл на
   * сервері, а не кожен екран.
   */
  app.get('/api/publishing/kdp/spec', (req, res) => {
    res.json({
      trimSizes: KDP_TRIM_SIZES,
      minPageCount: MIN_PAGE_COUNT,
      maxPageCount: MAX_PAGE_COUNT,
      maxDescriptionChars: MAX_DESCRIPTION_CHARS,
      keywordSlots: KEYWORD_SLOTS,
      minCoverDpi: MIN_COVER_DPI,
      noteUk:
        'Amazon KDP не має публічного API для публікації книги. Модуль готує файли й лист метаданих; завантаження в кабінет KDP автор виконує вручну.',
    });
  });

  app.post('/api/publishing/kdp/cover-spec', (req, res) => {
    try {
      const pageCount = Number(req.body?.pageCount);
      if (!Number.isFinite(pageCount) || pageCount <= 0) {
        return res.status(400).json({ error: 'Вкажіть кількість сторінок.' });
      }
      res.json(
        calculateFullCover({
          trimId: String(req.body?.trimId || '6x9'),
          pageCount,
          paper: req.body?.paper,
          dpi: Number(req.body?.dpi) || undefined,
        })
      );
    } catch (err) {
      handleError(res, err, 'Не вдалося розрахувати макет обкладинки.');
    }
  });

  app.post('/api/publishing/kdp/validate', (req, res) => {
    try {
      const result = validateManuscriptForKdp({
        pageCount: Number(req.body?.pageCount) || 0,
        wordCount: Number(req.body?.wordCount) || 0,
        hasTableOfContents: Boolean(req.body?.hasTableOfContents),
        headingLevels: Array.isArray(req.body?.headingLevels)
          ? req.body.headingLevels.map((n: unknown) => Number(n) || 1)
          : [],
        emptyChapters: Array.isArray(req.body?.emptyChapters) ? req.body.emptyChapters.map(String) : [],
        trimId: req.body?.trimId ? String(req.body.trimId) : undefined,
      });
      res.json(result);
    } catch (err) {
      handleError(res, err, 'Не вдалося перевірити рукопис.');
    }
  });

  app.post('/api/publishing/kdp/metadata', (req, res) => {
    try {
      const sheet = buildKdpMetadataSheet({
        title: String(req.body?.title || ''),
        subtitle: req.body?.subtitle ? String(req.body.subtitle) : undefined,
        authorName: req.body?.authorName ? String(req.body.authorName) : undefined,
        description: String(req.body?.description || ''),
        keywords: Array.isArray(req.body?.keywords) ? req.body.keywords.map(String) : [],
        bisacCategories: Array.isArray(req.body?.bisacCategories)
          ? req.body.bisacCategories.map(String)
          : [],
        language: req.body?.language ? String(req.body.language) : undefined,
        trimId: req.body?.trimId ? String(req.body.trimId) : undefined,
        pageCount: Number(req.body?.pageCount) || undefined,
        paper: req.body?.paper,
        isbn: req.body?.isbn ? String(req.body.isbn) : undefined,
      });
      res.json(sheet);
    } catch (err) {
      handleError(res, err, 'Не вдалося сформувати лист метаданих.');
    }
  });

  // =========================================================================
  // Товари
  // =========================================================================

  app.get('/api/publishing/products', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const products = await listProducts(req.principal!.id as string);
      const publications = await listPublicationsForUser(req.principal!.id as string);
      res.json({ products, publications });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити список товарів.');
    }
  });

  app.post('/api/publishing/products', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const title = String(req.body?.title || '').trim();
      if (!title) return res.status(400).json({ error: 'Вкажіть назву товару.' });

      const nowIso = now().toISOString();
      const product: StoredProduct = {
        id: newId('prod'),
        authorId: req.principal!.id as string,
        bookId: req.body?.bookId ? String(req.body.bookId) : undefined,
        type: ['book', 'course', 'methodology', 'bundle'].includes(req.body?.type)
          ? req.body.type
          : 'book',
        title,
        description: String(req.body?.description || ''),
        priceUsd: Number(req.body?.priceUsd) || 0,
        tags: normalizeTags(Array.isArray(req.body?.tags) ? req.body.tags.map(String) : []),
        components: Array.isArray(req.body?.components) ? req.body.components : [],
        exportFiles: req.body?.exportFiles || {},
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      await saveProduct(product);
      res.status(201).json({ product });
    } catch (err) {
      handleError(res, err, 'Не вдалося створити товар.');
    }
  });

  app.get('/api/publishing/products/:id', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      const files = await listProductFiles(product.id);
      const publications = (await listPublicationsForUser(product.authorId)).filter(
        (p) => p.productId === product.id
      );
      res.json({ product, files, publications });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити товар.');
    }
  });

  app.put('/api/publishing/products/:id', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      const updated: StoredProduct = {
        ...product,
        title: req.body?.title !== undefined ? String(req.body.title).trim() || product.title : product.title,
        description: req.body?.description !== undefined ? String(req.body.description) : product.description,
        priceUsd: req.body?.priceUsd !== undefined ? Number(req.body.priceUsd) || 0 : product.priceUsd,
        tags: req.body?.tags !== undefined ? normalizeTags(req.body.tags.map(String)) : product.tags,
        components: req.body?.components !== undefined ? req.body.components : product.components,
        exportFiles: req.body?.exportFiles !== undefined ? req.body.exportFiles : product.exportFiles,
        type: req.body?.type && ['book', 'course', 'methodology', 'bundle'].includes(req.body.type)
          ? req.body.type
          : product.type,
        updatedAt: now().toISOString(),
      };
      await saveProduct(updated);
      res.json({ product: updated });
    } catch (err) {
      handleError(res, err, 'Не вдалося оновити товар.');
    }
  });

  app.delete('/api/publishing/products/:id', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      await deleteProductFiles(product.id);
      await deleteProduct(product.id);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err, 'Не вдалося видалити товар.');
    }
  });

  // -------------------------------------------------------------------------
  // Файли товару
  // -------------------------------------------------------------------------

  app.get('/api/publishing/products/:id/files', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      res.json({ files: await listProductFiles(product.id) });
    } catch (err) {
      handleError(res, err, 'Не вдалося прочитати файли товару.');
    }
  });

  /**
   * Завантаження файлу сирими байтами, а не base64 у JSON: 20 МБ у base64
   * перетворюються на 27 МБ тексту, які треба ще й розпарсити. Ім'я файлу
   * приходить заголовком `x-file-name`.
   */
  app.post(
    '/api/publishing/products/:id/files',
    requireAuth, requirePermission('canPublish'),
    express.raw({ type: '*/*', limit: MAX_UPLOAD_BYTES }),
    async (req, res) => {
      try {
        const product = await loadOwnProduct(req, res);
        if (!product) return;

        const rawName = String(req.header('x-file-name') || '');
        if (!rawName) return res.status(400).json({ error: 'Не вказано ім’я файлу (заголовок x-file-name).' });
        const body = req.body as Buffer;
        if (!body || !body.length) return res.status(400).json({ error: 'Порожнє тіло запиту.' });
        if (body.length > MAX_UPLOAD_BYTES) {
          return res.status(413).json({ error: 'Файл перевищує допустимий розмір.' });
        }

        const saved = await saveProductFile(product.id, decodeURIComponent(rawName), new Uint8Array(body));
        res.status(201).json({ file: saved });
      } catch (err) {
        handleError(res, err, 'Не вдалося зберегти файл товару.');
      }
    }
  );

  app.delete('/api/publishing/products/:id/files/:name', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      const removed = await deleteProductFile(product.id, decodeURIComponent(req.params.name));
      if (!removed) return res.status(404).json({ error: 'Файл не знайдено.' });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err, 'Не вдалося видалити файл.');
    }
  });

  // -------------------------------------------------------------------------
  // Підсистема 3 — пакувальник набору
  // -------------------------------------------------------------------------

  /** Оцінка набору ДО пакування: розмір, ліміти й рекомендація сценарію А/Б. */
  app.post('/api/publishing/products/:id/bundle/analyze', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      const files = await listProductFiles(product.id);
      const selected: string[] = Array.isArray(req.body?.fileNames)
        ? req.body.fileNames.map(String)
        : files.map((f) => f.name);
      const components = files
        .filter((f) => selected.includes(f.name))
        .map((f) => ({ name: f.name, bytes: f.bytes }));
      res.json(analyzeComponents(components));
    } catch (err) {
      handleError(res, err, 'Не вдалося оцінити набір.');
    }
  });

  app.post('/api/publishing/products/:id/bundle/package', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      const files = await listProductFiles(product.id);
      const selected: string[] = Array.isArray(req.body?.fileNames)
        ? req.body.fileNames.map(String)
        : files.map((f) => f.name);

      const components = [];
      for (const file of files) {
        if (!selected.includes(file.name)) continue;
        components.push({
          name: file.name,
          bytes: file.bytes,
          data: await readProductFile(product.id, file.name),
        });
      }
      if (!components.length) {
        return res.status(400).json({ error: 'Не обрано жодного компонента для набору.' });
      }

      const bundle = await packageCourse({
        title: product.title,
        description: product.description,
        authorName: (req.principal as any)?.name,
        components,
        accessLink: req.body?.accessLink ? String(req.body.accessLink) : undefined,
      });

      const saved = await saveProductFile(product.id, bundle.fileName, bundle.zip);
      const updated: StoredProduct = {
        ...product,
        exportFiles: { ...product.exportFiles, bundleZip: saved.name },
        updatedAt: now().toISOString(),
      };
      await saveProduct(updated);

      res.status(201).json({
        file: saved,
        entries: bundle.entries,
        analysis: bundle.analysis,
        readmeFormat: bundle.readmeFormat,
        warningsUk: bundle.warningsUk,
        product: updated,
      });
    } catch (err) {
      handleError(res, err, 'Не вдалося зібрати набір.');
    }
  });

  // =========================================================================
  // Підсистема 2 — Etsy
  // =========================================================================

  app.get('/api/etsy/status', async (req, res) => {
    try {
      const cfg = config();
      const base = {
        configured: cfg.configured,
        cryptoConfigured: isCryptoConfigured(),
        reasonUk: cfg.reasonUk,
        scopes: ETSY_SCOPES,
        limits: {
          maxFiles: MAX_DIGITAL_FILES,
          maxFileBytes: MAX_FILE_BYTES,
          maxImages: MAX_LISTING_IMAGES,
          maxTags: MAX_TAGS,
          allowedExtensions: ALLOWED_FILE_EXTENSIONS,
        },
      };
      const userId = req.principal && !req.principal.isGuest ? (req.principal.id as string) : null;
      if (!userId) return res.json({ ...base, connected: false });

      const account = await getEtsyAccount(userId);
      res.json({ ...base, ...(account ? toPublicAccount(account) : { connected: false }) });
    } catch (err) {
      handleError(res, err, 'Не вдалося перевірити стан підключення Etsy.');
    }
  });

  /**
   * Старт OAuth. Повертаємо URL, а не редіректимо: фронтенд відкриває його у
   * новій вкладці й лишає застосунок у поточному стані — автор не втрачає
   * незбережену роботу через перехід на сайт Etsy.
   */
  app.post('/api/etsy/oauth/start', requireAuth, requirePermission('canPublishExternal'), async (req, res) => {
    try {
      const cfg = config();
      if (!cfg.configured) return res.status(503).json({ error: cfg.reasonUk });
      if (!isCryptoConfigured()) {
        return res.status(503).json({
          error:
            'Не налаштовано ETSY_TOKEN_SECRET. Без нього токен Etsy нема чим зашифрувати, а зберігати його відкритим модуль відмовляється.',
        });
      }

      const pkce = createPkcePair();
      await saveOAuthState({
        state: pkce.state,
        userId: req.principal!.id as string,
        codeVerifier: pkce.codeVerifier,
        redirectUri: cfg.redirectUri,
        createdAt: now().toISOString(),
      });
      // Прибираємо стани, старші за годину: незавершені спроби не мають
      // накопичуватись у таблиці роками.
      await purgeOldOAuthStates(new Date(now().getTime() - 3600_000).toISOString()).catch(() => 0);

      res.json({
        url: buildAuthorizeUrl({
          apiKey: cfg.apiKey,
          redirectUri: cfg.redirectUri,
          state: pkce.state,
          codeChallenge: pkce.codeChallenge,
        }),
        state: pkce.state,
      });
    } catch (err) {
      handleError(res, err, 'Не вдалося почати підключення Etsy.');
    }
  });

  app.get('/api/etsy/oauth/callback', async (req, res) => {
    const redirectBack = (status: 'ok' | 'error', message?: string) => {
      const base = (process.env.APP_URL || deps.appUrl || '').replace(/\/+$/, '');
      const url = `${base}/?etsy=${status}${message ? `&message=${encodeURIComponent(message)}` : ''}`;
      res.redirect(base ? url : `/?etsy=${status}`);
    };

    try {
      const code = String(req.query.code || '');
      const state = String(req.query.state || '');
      if (!code || !state) return redirectBack('error', 'Etsy повернув відповідь без коду авторизації.');

      const saved = await takeOAuthState(state);
      if (!saved) {
        // Або підроблений state, або повторне відкриття старого посилання.
        return redirectBack('error', 'Термін дії посилання авторизації минув. Спробуйте підключити крамницю ще раз.');
      }

      const cfg = config();
      const tokens = await exchangeCodeForToken(fetchImpl, {
        apiKey: cfg.apiKey,
        redirectUri: saved.redirectUri,
        code,
        codeVerifier: saved.codeVerifier,
        nowMs: now().getTime(),
      });

      await saveConnection({ userId: saved.userId, tokens, scopes: ETSY_SCOPES, now: now() });

      // Крамницю визначаємо одразу: без shop_id публікація неможлива.
      if (tokens.etsyUserId) {
        const client = await clientForUser(saved.userId);
        if (client) {
          const shop = await resolveShop(client, tokens.etsyUserId);
          if (shop.shopId) {
            await saveConnection({
              userId: saved.userId,
              tokens,
              scopes: ETSY_SCOPES,
              shopId: shop.shopId,
              shopName: shop.shopName,
              now: now(),
            });
          }
        }
      }

      redirectBack('ok');
    } catch (err) {
      console.error('[etsy] callback:', err);
      redirectBack('error', (err as Error)?.message || 'Не вдалося завершити підключення Etsy.');
    }
  });

  app.delete('/api/etsy/connection', requireAuth, requirePermission('canPublishExternal'), async (req, res) => {
    try {
      await disconnectEtsy(req.principal!.id as string);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err, 'Не вдалося відключити крамницю.');
    }
  });

  // -------------------------------------------------------------------------
  // Публікація на Etsy
  // -------------------------------------------------------------------------

  /**
   * Передпольотна перевірка. Окремим ендпоінтом навмисно: інтерфейс показує
   * проблеми ще до натискання «Опублікувати», і жоден із цих випадків не
   * доходить до Etsy (критерій приймання 4.6).
   */
  app.post('/api/publishing/products/:id/publish/etsy/validate', requireAuth, requirePermission('canPublishExternal'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;
      const files = await listProductFiles(product.id);
      const fileNames: string[] = Array.isArray(req.body?.fileNames) ? req.body.fileNames.map(String) : [];
      const imageNames: string[] = Array.isArray(req.body?.imageNames) ? req.body.imageNames.map(String) : [];

      const chosen = files.filter((f) => fileNames.includes(f.name));
      const missing = fileNames.filter((name) => !files.some((f) => f.name === name));

      const validation = validateListingDraft({
        title: String(req.body?.title ?? product.title),
        description: String(req.body?.description ?? product.description),
        priceUsd: Number(req.body?.priceUsd ?? product.priceUsd),
        tags: Array.isArray(req.body?.tags) ? req.body.tags.map(String) : product.tags,
        files: chosen.map((f) => ({ name: f.name, bytes: f.bytes })),
        imageCount: imageNames.length,
      });

      for (const name of missing) {
        validation.issues.push({
          severity: 'blocker',
          field: `file:${name}`,
          messageUk: `Файл «${name}» не завантажено на сервер — його нема чим публікувати.`,
        });
      }
      res.json({ ...validation, ok: validation.ok && !missing.length });
    } catch (err) {
      handleError(res, err, 'Не вдалося перевірити лістинг.');
    }
  });

  app.post('/api/publishing/products/:id/publish/etsy', requireAuth, requirePermission('canPublishExternal'), async (req, res) => {
    try {
      const product = await loadOwnProduct(req, res);
      if (!product) return;

      const cfg = config();
      if (!cfg.configured) return res.status(503).json({ error: cfg.reasonUk });

      const userId = req.principal!.id as string;
      const account = await getEtsyAccount(userId);
      if (!account) {
        return res.status(409).json({
          error: 'Крамницю Etsy не підключено. Натисніть «Підключити Etsy» на вкладці публікації.',
          kind: 'etsy_not_connected',
        });
      }
      if (!account.shopId) {
        return res.status(409).json({
          error: 'Не вдалося визначити вашу крамницю Etsy. Переконайтесь, що обліковий запис має відкриту крамницю, і підключіть її ще раз.',
          kind: 'etsy_no_shop',
        });
      }

      const files = await listProductFiles(product.id);
      const fileNames: string[] = Array.isArray(req.body?.fileNames)
        ? req.body.fileNames.map(String)
        : product.exportFiles.bundleZip
          ? [product.exportFiles.bundleZip]
          : [];
      const imageNames: string[] = Array.isArray(req.body?.imageNames) ? req.body.imageNames.map(String) : [];

      const chosen = files.filter((f) => fileNames.includes(f.name));
      const title = String(req.body?.title ?? product.title);
      const description = String(req.body?.description ?? product.description);
      const priceUsd = Number(req.body?.priceUsd ?? product.priceUsd);
      const tags = normalizeTags(Array.isArray(req.body?.tags) ? req.body.tags.map(String) : product.tags);

      const validation = validateListingDraft({
        title,
        description,
        priceUsd,
        tags,
        files: chosen.map((f) => ({ name: f.name, bytes: f.bytes })),
        imageCount: imageNames.length,
      });
      if (!validation.ok || chosen.length !== fileNames.length) {
        return res.status(400).json({
          error: 'Лістинг не відповідає вимогам Etsy — виправте помилки й спробуйте ще раз.',
          issues: validation.issues,
        });
      }

      // Ідемпотентність (ТЗ 4.5): якщо публікація для цього товару вже є,
      // працюємо з нею, а не створюємо другу.
      const nowIso = now().toISOString();
      const existing = await getPublicationForProduct(product.id, 'etsy');
      if (existing?.status === 'published' && !req.body?.forceUpdate) {
        return res.status(409).json({
          error: 'Цей товар уже опубліковано на Etsy.',
          kind: 'already_published',
          publication: existing,
        });
      }

      const publication: StoredPublication = existing || {
        id: newId('pub'),
        productId: product.id,
        userId,
        platform: 'etsy',
        status: 'files_ready',
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      const savedPublication = await savePublication({
        ...publication,
        status: publication.externalId ? publication.status : 'files_ready',
        errorLog: undefined,
        updatedAt: nowIso,
      });

      const job = await enqueuePublishJob({
        publicationId: savedPublication.id,
        userId,
        payload: {
          productId: product.id,
          shopId: account.shopId,
          title,
          description,
          priceUsd,
          tags,
          taxonomyId: Number(req.body?.taxonomyId) || undefined,
          shopSectionId: Number(req.body?.shopSectionId) || undefined,
          imageNames,
          fileNames,
          activate: req.body?.activate !== false,
        },
        now: now(),
      });

      res.status(202).json({ publication: savedPublication, job });
    } catch (err) {
      handleError(res, err, 'Не вдалося поставити публікацію в чергу.');
    }
  });

  app.get('/api/publishing/jobs/:id', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      const job = await getJob(req.params.id);
      if (!job || (job.userId !== req.principal?.id && !isAdmin(req))) {
        return res.status(404).json({ error: 'Задачу не знайдено.' });
      }
      const publication = await getPublication(job.publicationId);
      res.json({ job, publication });
    } catch (err) {
      handleError(res, err, 'Не вдалося прочитати стан задачі.');
    }
  });

  app.get('/api/publishing/publications', requireAuth, requirePermission('canPublish'), async (req, res) => {
    try {
      res.json({ publications: await listPublicationsForUser(req.principal!.id as string) });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити публікації.');
    }
  });

  // =========================================================================
  // Підсистема 4 — дослідження попиту
  // =========================================================================

  app.post('/api/etsy/research', requireAuth, requirePermission('canPublishExternal'), async (req, res) => {
    try {
      const topic = String(req.body?.topic || '').trim();
      if (!topic) return res.status(400).json({ error: 'Вкажіть тему або нішу для дослідження.' });
      if (topic.length > 120) return res.status(400).json({ error: 'Тема задовга (максимум 120 символів).' });

      const result = await researchTopic(
        {
          topic,
          taxonomyId: Number(req.body?.taxonomyId) || undefined,
          userId: req.principal!.id as string,
          // Примусове оновлення дозволяємо лише адміну: інакше кнопка
          // «оновити» в руках десятка авторів зводить нанівець кеш і
          // ліміт швидкості.
          force: Boolean(req.body?.force) && isAdmin(req),
        },
        { client: researchClient(), now }
      );
      res.json(result);
    } catch (err) {
      if ((err as Error)?.message?.includes('ETSY_API_KEY')) {
        return res.status(503).json({ error: (err as Error).message });
      }
      handleError(res, err, 'Не вдалося дослідити тему.');
    }
  });

  app.get('/api/etsy/research/trend', requireAuth, requirePermission('canPublishExternal'), async (req, res) => {
    try {
      const topic = String(req.query.topic || '').trim();
      if (!topic) return res.status(400).json({ error: 'Вкажіть тему.' });
      const points = await topicTrend(topic, Number(req.query.taxonomyId) || undefined);
      res.json({ topic, points });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити динаміку теми.');
    }
  });

  // =========================================================================
  // Фонові процеси
  // =========================================================================

  if (deps.disableWorkers) {
    return { stop: () => {} };
  }

  const worker = startPublishWorker({
    clientForUser,
    now,
  });
  const scheduler = startResearchScheduler({
    client: researchClient(),
    now,
    intervalMinutes: Number(process.env.ETSY_RESEARCH_REFRESH_MINUTES || 0),
  });

  return {
    stop() {
      worker.stop();
      scheduler.stop();
    },
  };
}

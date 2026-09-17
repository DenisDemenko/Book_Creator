/**
 * Фізичні вироби (меблі / дерево) — адміністраторська половина.
 *
 * Картку виробу заводять у редакторі «Управління карткою вітрини»
 * (src/components/adminOs/FurnitureProductEditor.tsx). Чорнетки живуть тут,
 * у `meta` Студії під одним ключем — це свідомо найпростіше сховище: виробів
 * небагато, і окрема таблиця для кількох рядків була б надмірністю.
 *
 * Публікація йде через міст (`publishProductToMarketplace` → `/bridge/products`
 * на боці Fusion Lab). Приймач — частина Б плану #173; поки його немає, міст
 * чесно віддає помилку, і чорнетка лишається чорнеткою.
 */

import type { Express } from 'express';
import { requireAdmin } from './auth';
import {
  MarketplaceBridgeError,
  attachProductMediaToMarketplace,
  clearProductMedia,
  publishProductToMarketplace,
  type BridgeSettings,
  type PublishProductAttributes,
} from './marketplaceBridge';
import { getAppSetting, setAppSetting } from './store';
// Константи меж — той самий модуль, що й клієнт: одне джерело правди, щоб
// перевірка на сервері й у редакторі не розійшлися. Модуль чистий (без React і
// побічних ефектів), тож esbuild спокійно вкладає його в серверний бандл.
import {
  TITLE_MAX,
  TEASER_MAX,
  DESCRIPTION_MAX,
  MAX_GALLERY_PHOTOS,
  MAX_GALLERY_VIDEOS,
  isVideoMedia,
  type FurnitureMediaItem,
  type FurnitureProduct,
} from '../src/components/adminOs/furnitureProduct';

const DRAFTS_KEY = 'furniture_product_drafts';

/**
 * Прогрес публікації — в памʼяті процесу, за id чорнетки.
 *
 * ЧОМУ В ПАМʼЯТІ, НЕ В `meta`. Це не дані виробу — це стан ОДНОГО POST
 * `/publish`, що саме зараз виконується; переживати рестарт сервера йому
 * не треба, а писати на диск на кожен крок (кожне фото/відео) — зайве
 * навантаження заради інформації, яка й так зникне за секунди.
 *
 * ЧОМУ ЦЕ ПОТРІБНО. З відео в галереї `/publish` вантажить кожен файл на
 * міст послідовно й довго; без індикації прогресу адмін не відрізнить
 * «ще працює» від «зависло» (власник, 17.09.2026). Клієнт опитує
 * `/publish-status` окремими GET, поки триває POST `/publish`.
 */
interface PublishProgress {
  status: 'running' | 'done' | 'error';
  done: number;
  total: number;
  label: string;
  updatedAt: number;
  error?: string;
}

const publishProgressById = new Map<string, PublishProgress>();

/** Записи старші за це чистяться при кожному новому старті публікації — щоб мапа не росла вічно. */
const PUBLISH_PROGRESS_TTL_MS = 10 * 60 * 1000;

function setPublishProgress(id: string, patch: Partial<Omit<PublishProgress, 'updatedAt'>>): void {
  const prev = publishProgressById.get(id);
  publishProgressById.set(id, {
    status: 'running',
    done: 0,
    total: 1,
    label: '',
    ...prev,
    ...patch,
    updatedAt: Date.now(),
  });
  // Прибирання старих записів — під час запису нового, без окремого таймера.
  const cutoff = Date.now() - PUBLISH_PROGRESS_TTL_MS;
  for (const [key, value] of publishProgressById) {
    if (value.status !== 'running' && value.updatedAt < cutoff) publishProgressById.delete(key);
  }
}

/**
 * Data-URL превʼю → байти.
 *
 * Чорнетка зберігає і зображення, і відео саме як data URL (щоб пережити
 * перезавантаження сторінки), тож публікація декодує його назад і віддає
 * файлом — у маркетплейсу немає звідки взяти ці байти інакше. Назва
 * лишилась «Image» з часів, коли відео не було — перейменовувати рефакторили
 * б заради самого рефакторингу; поведінка вже загальна (будь-який data URL).
 */
function decodeImageDataUrl(src: unknown): { mimeType: string; bytes: Uint8Array } | null {
  const m = /^data:([^;,]+);base64,([\s\S]+)$/.exec(String(src ?? ''));
  if (!m) return null;
  return { mimeType: m[1], bytes: new Uint8Array(Buffer.from(m[2], 'base64')) };
}

/** Імʼя файла в сховищі: детерміноване, без кирилиці, з порядковим номером. */
function imageFilename(sku: string, index: number, mimeType: string): string {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = (sku || 'product').replace(/[^\w.-]+/g, '_').slice(0, 40);
  return `${base}-${String(index + 1).padStart(2, '0')}.${ext}`;
}

/** Імʼя відеофайла в сховищі — той самий принцип, розширення з mime-типу. */
function videoFilename(sku: string, index: number, mimeType: string): string {
  const ext = mimeType === 'video/webm' ? 'webm' : mimeType === 'video/quicktime' ? 'mov' : 'mp4';
  const base = (sku || 'product').replace(/[^\w.-]+/g, '_').slice(0, 40);
  return `${base}-video-${String(index + 1).padStart(2, '0')}.${ext}`;
}

async function readDrafts(): Promise<FurnitureProduct[]> {
  const raw = (await getAppSetting(DRAFTS_KEY)) || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FurnitureProduct[]) : [];
  } catch {
    return [];
  }
}

async function writeDrafts(list: FurnitureProduct[]): Promise<void> {
  await setAppSetting(DRAFTS_KEY, JSON.stringify(list));
}

/**
 * Мінімум для публікації — дзеркало `furniturePublishIssues` з клієнта.
 *
 * Межі довжини тут не косметичні: приймач мосту перевіряє їх сам і відкидає
 * публікацію з HTTP 400 (16.09.2026 так упав тизер на 300+ символів).
 * Відмовити локально з причиною українською — краще, ніж віддати автору
 * англійський рядок валідації. */
function serverPublishIssues(p: FurnitureProduct): string[] {
  const issues: string[] = [];
  const media = Array.isArray(p.media) ? p.media : [];
  const photoCount = media.filter((m) => !isVideoMedia(m)).length;
  const videoCount = media.filter((m) => isVideoMedia(m)).length;
  if (!p.name?.trim()) issues.push('Немає назви виробу.');
  if (!p.sku?.trim()) issues.push('Немає артикула / SKU.');
  if (!(p.priceUah > 0)) issues.push('Ціна має бути більшою за нуль.');
  if (photoCount === 0) issues.push('Немає жодного фото — додайте головний банер.');
  if (photoCount > MAX_GALLERY_PHOTOS) {
    issues.push(`Забагато фото: ${photoCount} із дозволених ${MAX_GALLERY_PHOTOS}.`);
  }
  if (videoCount > MAX_GALLERY_VIDEOS) {
    issues.push(`Забагато відео: ${videoCount} із дозволених ${MAX_GALLERY_VIDEOS}.`);
  }
  if (p.electronicsEnabled && (!Array.isArray(p.electronicsFunctions) || p.electronicsFunctions.length === 0)) {
    issues.push('Електроніка увімкнена, але жодної функції не обрано.');
  }
  if ((p.name?.trim().length ?? 0) > TITLE_MAX) {
    issues.push(`Назва задовга: ${p.name.trim().length} із ${TITLE_MAX} символів.`);
  }
  if ((p.teaser?.trim().length ?? 0) > TEASER_MAX) {
    issues.push(
      `Тизер задовгий: ${p.teaser.trim().length} із ${TEASER_MAX} символів — це підзаголовок картки. ` +
        'Довший текст перенесіть у «Повний деталізований опис».'
    );
  }
  if ((p.description?.trim().length ?? 0) > DESCRIPTION_MAX) {
    issues.push(`Опис задовгий: ${p.description.trim().length} із ${DESCRIPTION_MAX} символів.`);
  }
  return issues;
}

/** Картка виробу → контракт мосту. Обкладинку (фото) передає частина Г. */
function toBridgeAttributes(p: FurnitureProduct): PublishProductAttributes {
  return {
    category: p.category,
    subcategory: p.subcategory,
    material: p.material,
    finish: p.finish,
    dimensions: p.dimensions,
    warranty: p.warranty,
    leadTime: p.leadTime,
    physical: p.physical,
    ledStrip: p.ledStrip,
    ledPower: p.ledPower,
    ledControl: p.ledControl,
    electronicsEnabled: p.electronicsEnabled,
    electronicsController: p.electronicsController,
    electronicsUserProgrammable: p.electronicsUserProgrammable,
    electronicsFunctions: p.electronicsFunctions,
    functionalZones: p.functionalZones,
    woodTones: p.woodTones.map((w) => ({ label: w.label, color: w.color })),
    colors: p.availableColors.map((c) => ({ label: c.label, enabled: c.enabled })),
    engraving: p.engraving,
    engravingPriceMinor: Math.round(p.engravingPriceUah * 100),
    resinColor: p.resinColor,
    phoneFit: p.phoneFit,
  };
}

/**
 * Надіслати фото й відео виробу у сховище вітрини.
 *
 * Перше ФОТО (не відео) — головний банер (`cover`), решта фото — галерея
 * (`gallery`), усі відео — окремий вид (`video`). Порядок у межах кожної
 * групи послідовний і навмисний: галерея на сторінці товару показується в
 * тому порядку, у якому лягла в сховище. Перед завантаженням набір
 * чиститься — приймач ДОДАЄ медіа, а не замінює їх.
 *
 * Межі (`MAX_GALLERY_PHOTOS`/`MAX_GALLERY_VIDEOS`) уже перевірені в
 * редакторі й у `serverPublishIssues` перед публікацією; тут — оборонне
 * обрізання про всяк випадок (чорнетка могла бути записана старішою
 * версією клієнта), а не основний механізм захисту.
 *
 * Виділено з маршруту, щоб цю ланку можна було перевірити без HTTP і без
 * справжнього моста: саме її бракувало 16.09.2026, коли публікація поїхала
 * текстом без фотографій.
 */
export async function uploadProductMedia(
  product: { sku: string; media?: Array<Pick<FurnitureMediaItem, 'src' | 'kind'>> | null },
  externalId: string,
  deps: {
    fetch?: typeof fetch;
    settings?: BridgeSettings;
    /** Викликається після КОЖНОГО фото/відео (успіху чи невдачі) — прогрес-бар публікації в редакторі. */
    onProgress?: (done: number, total: number, label: string) => void;
  } = {}
): Promise<{ uploaded: number; failed: string[] }> {
  const allMedia = Array.isArray(product.media) ? product.media : [];
  const photos = allMedia.filter((m) => !isVideoMedia(m)).slice(0, MAX_GALLERY_PHOTOS);
  const videos = allMedia.filter((m) => isVideoMedia(m)).slice(0, MAX_GALLERY_VIDEOS);
  const failed: string[] = [];
  let uploaded = 0;
  const total = photos.length + videos.length;
  let done = 0;
  const report = (label: string) => deps.onProgress?.(done, total, label);
  if (photos.length === 0 && videos.length === 0) return { uploaded, failed };

  await clearProductMedia(externalId, deps);

  for (let i = 0; i < photos.length; i++) {
    const decoded = decodeImageDataUrl(photos[i]?.src);
    if (!decoded) {
      failed.push(`${i + 1}-е фото: у чорнетці немає зображення`);
      done++;
      report(`Фото ${i + 1}/${photos.length}`);
      continue;
    }
    try {
      await attachProductMediaToMarketplace(
        {
          sku: product.sku,
          kind: i === 0 ? 'cover' : 'gallery',
          filename: imageFilename(product.sku, i, decoded.mimeType),
          mimeType: decoded.mimeType,
          bytes: decoded.bytes,
        },
        deps
      );
      uploaded++;
    } catch (err: any) {
      failed.push(`${i + 1}-е фото: ${err?.message || 'помилка завантаження'}`);
    }
    done++;
    report(`Фото ${i + 1}/${photos.length}`);
  }

  for (let i = 0; i < videos.length; i++) {
    const decoded = decodeImageDataUrl(videos[i]?.src);
    if (!decoded) {
      failed.push(`${i + 1}-е відео: у чорнетці немає файлу`);
      done++;
      report(`Відео ${i + 1}/${videos.length}`);
      continue;
    }
    try {
      await attachProductMediaToMarketplace(
        {
          sku: product.sku,
          kind: 'video',
          filename: videoFilename(product.sku, i, decoded.mimeType),
          mimeType: decoded.mimeType,
          bytes: decoded.bytes,
        },
        deps
      );
      uploaded++;
    } catch (err: any) {
      failed.push(`${i + 1}-е відео: ${err?.message || 'помилка завантаження'}`);
    }
    done++;
    report(`Відео ${i + 1}/${videos.length}`);
  }

  return { uploaded, failed };
}

export function registerFurnitureProductRoutes(app: Express): void {
  app.get('/api/admin/furniture-products', requireAdmin, async (_req, res) => {
    const drafts = await readDrafts();
    res.json({ products: drafts });
  });

  app.post('/api/admin/furniture-products', requireAdmin, async (req, res) => {
    const product = req.body?.product as FurnitureProduct | undefined;
    if (!product || typeof product !== 'object' || !product.id) {
      return res.status(400).json({ error: 'Некоректна картка виробу.' });
    }
    const drafts = await readDrafts();
    const idx = drafts.findIndex((d) => d.id === product.id);
    const clean: FurnitureProduct = { ...product, updatedAt: new Date().toISOString() };
    if (idx >= 0) drafts[idx] = clean;
    else drafts.unshift(clean);
    await writeDrafts(drafts);
    res.json({ product: clean });
  });

  app.delete('/api/admin/furniture-products/:id', requireAdmin, async (req, res) => {
    const drafts = await readDrafts();
    const next = drafts.filter((d) => d.id !== req.params.id);
    if (next.length === drafts.length) {
      return res.status(404).json({ error: 'Чорнетку виробу не знайдено.' });
    }
    await writeDrafts(next);
    res.json({ ok: true });
  });

  app.post('/api/admin/furniture-products/:id/publish', requireAdmin, async (req, res) => {
    const id = req.params.id;
    try {
      const drafts = await readDrafts();
      const product = drafts.find((d) => d.id === id);
      if (!product) return res.status(404).json({ error: 'Чорнетку виробу не знайдено.' });

      const issues = serverPublishIssues(product);
      if (issues.length) return res.status(400).json({ error: `Не можна публікувати: ${issues.join(' ')}` });

      const allMedia = Array.isArray(product.media) ? product.media : [];
      const photosCount = allMedia.filter((m) => !isVideoMedia(m)).slice(0, MAX_GALLERY_PHOTOS).length;
      const videosCount = allMedia.filter((m) => isVideoMedia(m)).slice(0, MAX_GALLERY_VIDEOS).length;
      // 1 крок — публікація самої картки (текст/ціна/атрибути), решта — по
      // одному кроку на кожне фото й відео нижче (`uploadProductMedia`).
      const total = 1 + photosCount + videosCount;
      setPublishProgress(id, { status: 'running', done: 0, total, label: 'Публікація картки товару…' });

      const sellerSlug = process.env.BRIDGE_SELLER_SLUG || 'fusion-lab';
      const result = await publishProductToMarketplace({
        sku: product.sku,
        title: product.name,
        subtitle: product.teaser,
        summary: product.teaser,
        description: product.description,
        priceMinor: Math.round(product.priceUah * 100),
        basePriceMinor: product.basePriceUah > 0 ? Math.round(product.basePriceUah * 100) : undefined,
        // `null` — «не обліковується» (виріб на замовлення): тоді поле взагалі
        // не їде, і вітрина не показує «немає в наявності» замість покупки.
        // Приймач перевіряє `stock` як ціле (`@IsInt()`), тож дробове з поля
        // дало б HTTP 400 так само, як задовгий тизер.
        stock: product.stock === null || product.stock === undefined
          ? undefined
          : Math.max(0, Math.round(product.stock)),
        highlights: product.functionalZones,
        attributes: toBridgeAttributes(product),
        sellerSlug,
      });
      setPublishProgress(id, {
        done: 1,
        label: photosCount + videosCount > 0 ? 'Завантаження медіа…' : 'Медіа немає',
      });

      // ФОТО. Без них картка в каталозі показується порожнім прямокутником —
      // саме так і сталося 16.09.2026: публікація несла лише текст, бо цю ланку
      // не було підʼєднано.
      const mediaResult = await uploadProductMedia(product, result.externalId, {
        onProgress: (done, _total, label) => setPublishProgress(id, { done: 1 + done, label }),
      });
      const mediaCount = Array.isArray(product.media) ? product.media.length : 0;

      product.status = 'published';
      product.publishedAt = new Date().toISOString();
      // Слаг зберігаємо тут-таки, не лише у відповіді: без цього кнопка
      // «Переглянути товар на вітрині» в редакторі не пережила б перезавантаження
      // сторінки (слаг був би відомий лише секунду, у пам'яті клієнта).
      if (result.slug) product.slug = result.slug;
      product.updatedAt = new Date().toISOString();
      await writeDrafts(drafts);

      // Картка вже є — про часткову невдачу кажемо прямо, а не мовчимо:
      // інакше автор побачив би «готово» й порожню картку в каталозі.
      if (mediaResult.failed.length > 0) {
        setPublishProgress(id, { status: 'error', done: total, error: mediaResult.failed.join('; ') });
        return res.status(502).json({
          error:
            `Картку опубліковано, але фото доїхали не всі (${mediaResult.uploaded} із ${mediaCount}): ` +
            mediaResult.failed.join('; '),
          product,
          slug: result.slug,
          externalId: result.externalId,
        });
      }

      setPublishProgress(id, { status: 'done', done: total, label: 'Готово' });
      res.json({
        product,
        slug: result.slug,
        externalId: result.externalId,
        mediaUploaded: mediaResult.uploaded,
      });
    } catch (err: any) {
      setPublishProgress(id, { status: 'error', error: err?.message || 'Не вдалося опублікувати виріб.' });
      if (err instanceof MarketplaceBridgeError) {
        return res.status(err.status).json({ error: err.message, kind: err.kind });
      }
      res.status(500).json({ error: err?.message || 'Не вдалося опублікувати виріб.' });
    }
  });

  // Опитування прогресу публікації, що йде в іншому запиті (див.
  // `publishProgressById` вище) — окремий GET, бо POST `/publish` сам
  // повертає відповідь лише по завершенню, а на завантаження відео може
  // піти хвилина й більше.
  app.get('/api/admin/furniture-products/:id/publish-status', requireAdmin, (req, res) => {
    const progress = publishProgressById.get(req.params.id);
    if (!progress) return res.json({ status: 'idle' });
    res.json(progress);
  });
}

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
  type FurnitureProduct,
} from '../src/components/adminOs/furnitureProduct';

const DRAFTS_KEY = 'furniture_product_drafts';

/**
 * Data-URL превʼю → байти.
 *
 * Чорнетка зберігає зображення саме як data URL (щоб пережити перезавантаження
 * сторінки), тож публікація декодує його назад і віддає файлом — у маркетплейсу
 * немає звідки взяти ці байти інакше.
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
  if (!p.name?.trim()) issues.push('Немає назви виробу.');
  if (!p.sku?.trim()) issues.push('Немає артикула / SKU.');
  if (!(p.priceUah > 0)) issues.push('Ціна має бути більшою за нуль.');
  if (!p.media?.length) issues.push('Немає жодного фото — додайте головний банер.');
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
 * Надіслати зображення виробу у сховище вітрини.
 *
 * Перший файл — головний банер (`cover`), решта — галерея (`gallery`).
 * Порядок послідовний і навмисний: галерея на сторінці товару показується в
 * тому порядку, у якому лягла в сховище. Перед завантаженням набір чиститься —
 * приймач ДОДАЄ фото галереї, а не замінює їх.
 *
 * Виділено з маршруту, щоб цю ланку можна було перевірити без HTTP і без
 * справжнього моста: саме її бракувало 16.09.2026, коли публікація поїхала
 * текстом без фотографій.
 */
export async function uploadProductMedia(
  product: { sku: string; media?: Array<{ src?: string }> | null },
  externalId: string,
  deps: { fetch?: typeof fetch; settings?: BridgeSettings } = {}
): Promise<{ uploaded: number; failed: string[] }> {
  const media = Array.isArray(product.media) ? product.media : [];
  const failed: string[] = [];
  let uploaded = 0;
  if (media.length === 0) return { uploaded, failed };

  await clearProductMedia(externalId, deps);

  for (let i = 0; i < media.length; i++) {
    const decoded = decodeImageDataUrl(media[i]?.src);
    if (!decoded) {
      failed.push(`${i + 1}-е фото: у чорнетці немає зображення`);
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
    try {
      const drafts = await readDrafts();
      const product = drafts.find((d) => d.id === req.params.id);
      if (!product) return res.status(404).json({ error: 'Чорнетку виробу не знайдено.' });

      const issues = serverPublishIssues(product);
      if (issues.length) return res.status(400).json({ error: `Не можна публікувати: ${issues.join(' ')}` });

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

      // ФОТО. Без них картка в каталозі показується порожнім прямокутником —
      // саме так і сталося 16.09.2026: публікація несла лише текст, бо цю ланку
      // не було підʼєднано.
      const mediaResult = await uploadProductMedia(product, result.externalId);
      const mediaCount = Array.isArray(product.media) ? product.media.length : 0;

      product.status = 'published';
      product.publishedAt = new Date().toISOString();
      product.updatedAt = new Date().toISOString();
      await writeDrafts(drafts);

      // Картка вже є — про часткову невдачу кажемо прямо, а не мовчимо:
      // інакше автор побачив би «готово» й порожню картку в каталозі.
      if (mediaResult.failed.length > 0) {
        return res.status(502).json({
          error:
            `Картку опубліковано, але фото доїхали не всі (${mediaResult.uploaded} із ${mediaCount}): ` +
            mediaResult.failed.join('; '),
          product,
          slug: result.slug,
          externalId: result.externalId,
        });
      }

      res.json({
        product,
        slug: result.slug,
        externalId: result.externalId,
        mediaUploaded: mediaResult.uploaded,
      });
    } catch (err: any) {
      if (err instanceof MarketplaceBridgeError) {
        return res.status(err.status).json({ error: err.message, kind: err.kind });
      }
      res.status(500).json({ error: err?.message || 'Не вдалося опублікувати виріб.' });
    }
  });
}

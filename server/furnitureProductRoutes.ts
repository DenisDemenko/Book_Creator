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
  publishProductToMarketplace,
  type PublishProductAttributes,
} from './marketplaceBridge';
import { getAppSetting, setAppSetting } from './store';
import type { FurnitureProduct } from '../src/components/adminOs/furnitureProduct';

const DRAFTS_KEY = 'furniture_product_drafts';

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

/** Мінімум для публікації — дзеркало `furniturePublishIssues` з клієнта. */
function serverPublishIssues(p: FurnitureProduct): string[] {
  const issues: string[] = [];
  if (!p.name?.trim()) issues.push('Немає назви виробу.');
  if (!p.sku?.trim()) issues.push('Немає артикула / SKU.');
  if (!(p.priceUah > 0)) issues.push('Ціна має бути більшою за нуль.');
  if (!p.media?.length) issues.push('Немає жодного фото — додайте головний банер.');
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
        stock: product.stock,
        highlights: product.functionalZones,
        attributes: toBridgeAttributes(product),
        sellerSlug,
      });

      product.status = 'published';
      product.publishedAt = new Date().toISOString();
      product.updatedAt = new Date().toISOString();
      await writeDrafts(drafts);
      res.json({ product, slug: result.slug, externalId: result.externalId });
    } catch (err: any) {
      if (err instanceof MarketplaceBridgeError) {
        return res.status(err.status).json({ error: err.message, kind: err.kind });
      }
      res.status(500).json({ error: err?.message || 'Не вдалося опублікувати виріб.' });
    }
  });
}

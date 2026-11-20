import { generateTableImage, TableImageError } from './tableAiGeneration';
import { timingSafeEqual } from 'node:crypto';
import type { Express } from 'express';
import { readBridgeSettings } from './marketplaceBridge';
import { findUserByFirebaseUid } from './store';
import { resolveSubscription, PLANS } from './subscriptions';
import { getDb, isAvailable } from './db';
import { syncCredits, creditsEnabled } from './creditGate';
import { CreditWallet, WalletError } from './creditWallet';
import { creditsForCostUsd } from './creditPricing';
import { IMAGE_PRICING, priceForImage } from './pricing';
import { constructorImageQuotes, generateConstructorImage } from './constructorImageEngines';
import { ImageGenerationError } from './imageGeneration';

export async function hasPaidConstructorPlan(userId?: string) {
  const sub = userId ? await resolveSubscription(userId) : null;
  return !!sub && sub.plan !== 'free' && !!PLANS[sub.plan as keyof typeof PLANS] && sub.status === 'active' && Date.parse(sub.currentPeriodEnd) > Date.now();
}

// Only the trusted marketplace server can reserve, settle or release funds.
// Browser tokens cannot authorize these routes; identity is a verified Firebase UID.
export function registerTableAiBillingRoutes(app: Express) {
  app.post('/api/table-ai/billing/:action', async (req, res) => {
    try {
      const settings = await readBridgeSettings();
      const key = Buffer.from(req.get('x-bridge-key') || '');
      const expected = Buffer.from(settings.key);
      if (!key.length || key.length !== expected.length || !timingSafeEqual(key, expected))
        return res.status(403).json({ error: 'Недійсний ключ мосту.' });
      const { firebaseUid, jobKey } = req.body || {};
      const action = req.params.action;
      if (action === 'engines') {
        const { editions } = await constructorImageQuotes('1K');
        return res.json({ engines: editions });
      }
      if (!['access', 'reserve', 'settle', 'release', 'generate'].includes(String(action)) || typeof firebaseUid !== 'string' || !firebaseUid.length || firebaseUid.length > 128)
        return res.status(400).json({ error: 'Некоректний запит білінгу.' });
      if (action !== 'access' && (typeof jobKey !== 'string' || !/^table:[a-f0-9-]{36}$/.test(jobKey)))
        return res.status(400).json({ error: 'Некоректний ключ генерації.' });
      // Missing SQLite is an outage, never evidence that the account is free.
      if (!isAvailable()) return res.status(503).json({ error: 'Білінг Студії недоступний.' });
      const user = await findUserByFirebaseUid(firebaseUid);
      const db = getDb()!;
      const wallet = new CreditWallet(db as any);
      if (action === 'settle' || action === 'release') {
        const reservation = db.prepare('SELECT user_id, amount, status FROM credit_reservations WHERE job_key = ?').get(jobKey) as { user_id: string; amount: number; status: string } | undefined;
        // Releasing an unknown job is safe: the reserve request may have failed before arrival.
        if (!reservation && action === 'release') return res.json({ ok: true });
        if (!reservation || reservation.user_id !== user?.id) return res.status(409).json({ error: 'Резерв не знайдено для цього користувача.' });
        const balance = action === 'settle' ? wallet.settle(jobKey, reservation.amount) : wallet.release(jobKey, 'Збій генерації столу');
        return res.json({ ok: true, balance });
      }
      if (user?.disabled) return res.status(403).json({ error: 'Обліковий запис вимкнено.' });
      // The authenticated Marketplace server sets this only from its persisted
      // admin role on the dome route. The bridge key was verified above.
      const unlimited = req.body.marketplaceDomeAdmin === true;
      const paid = !unlimited && await hasPaidConstructorPlan(user?.id);
      // The same direct GPT Image entry shown in Admin → AI credits determines
      // BOTH the actual model and the price. Do not copy a price into marketplace.
      const access = typeof req.body.engine === 'string'
        ? await constructorImageQuotes(req.body.imageSize || '1K', req.body.aspectRatio || '1:1')
        : undefined;
      const edition = access?.editions.find((e) => e.id === req.body.engine && e.available);
      if (access && !edition)
        return res.status(409).json({ error: 'Вибраний рушій недоступний. Оновіть список рушіїв.' });
      if (edition && req.body.quoteHash !== undefined && req.body.quoteHash !== edition.quoteHash)
        return res.status(409).json({ error: 'Тариф рушія змінився. Підтвердьте нову вартість.' });
      const model = edition?.modelId ?? IMAGE_PRICING['gpt-image']?.modelId;
      if (!model) return res.status(503).json({ error: 'Модель GPT Image не налаштована у Студії.' });
      const credits = edition?.credits ?? creditsForCostUsd(priceForImage('gpt-image', '1K', model));
      const selection = edition ? { engine: edition.id, model, quoteHash: edition.quoteHash } : { model };
      if (action === 'generate') {
        if (req.body.model !== model) return res.status(409).json({ error: 'Модель Студії змінилася. Повторіть генерацію.' });
        if (paid && user) {
          const reservation = db.prepare('SELECT user_id, amount, status FROM credit_reservations WHERE job_key = ?').get(jobKey) as { user_id: string; amount: number; status: string } | undefined;
          if (!reservation || reservation.user_id !== user.id || reservation.status !== 'reserved' || (edition && reservation.amount !== credits))
            return res.status(402).json({ error: 'Спочатку зарезервуйте AI-бали.' });
        }
        // The provider key stays inside Studio; the marketplace receives only the image.
        if (edition && access && edition.id !== 'gpt-image') {
          const { prompt, referenceImage, interiorImages = [], refinementImage } = req.body;
          if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000 ||
              typeof referenceImage !== 'string' || referenceImage.length > 500000 || !Array.isArray(interiorImages) || interiorImages.length > 10 ||
              interiorImages.some((reference) => typeof reference !== 'string' || reference.length > 250000) ||
              (refinementImage !== undefined && typeof refinementImage !== 'string'))
            return res.status(400).json({ error: 'Некоректні параметри візуалізації.' });
          const result = await generateConstructorImage(edition, access, {
            prompt, aspectRatio: '1:1', references: [referenceImage, ...interiorImages, ...(refinementImage ? [refinementImage] : [])],
          });
          return res.json({ image: `data:${result.mimeType};base64,${result.buffer.toString('base64')}`, ...selection });
        }
        return res.json(await generateTableImage({ prompt: req.body.prompt, referenceImage: req.body.referenceImage, model, interiorImages: req.body.interiorImages, refinementImage: req.body.refinementImage }));
      }
      if (unlimited) return res.json({ mode: 'unlimited', model });
      if (!paid || !user) return res.json({ mode: 'free', ...selection });
      if (!creditsEnabled()) return res.status(503).json({ error: 'Списання AI-балів у Студії вимкнено.' });
      const balance = await syncCredits(user.id);
      if (action === 'access') return res.json({ mode: 'credits', ...selection, credits, available: balance.available });
      // Idempotent reserve; settle always uses this stored amount even if the
      // admin changes pricing while OpenAI is generating the picture.
      const existing = db.prepare('SELECT user_id, amount, status FROM credit_reservations WHERE job_key = ?').get(jobKey) as { user_id: string; amount: number; status: string } | undefined;
      if (existing && (existing.user_id !== user.id || existing.status !== 'reserved'))
        return res.status(409).json({ error: 'Генерацію з цим ключем уже завершено.' });
      const reserved = existing?.amount ?? credits;
      const next = wallet.reserve(user.id, jobKey, reserved);
      return res.json({ mode: 'credits', ...selection, credits: reserved, available: next.available });
    } catch (error) {
      if (error instanceof TableImageError) return res.status(error.status).json({ error: error.message });
      if (error instanceof ImageGenerationError) {
        const message = error.kind === 'no_key'
          ? 'Вибраний рушій втратив доступ до провайдера. Оновіть список рушіїв.'
          : error.kind === 'quota' ? 'Ліміт провайдера вичерпано. Оберіть інший рушій або спробуйте пізніше.'
            : 'Вибраний рушій не завершив генерацію.';
        return res.status(503).json({ error: message });
      }
      if (error instanceof WalletError && error.code === 'IMAGE_CREDITS_LOW')
        return res.status(402).json({ error: 'Недостатньо AI-балів. Поповніть баланс у Студії книг.' });
      // Fail closed; no plaintext bridge secrets or raw database errors.
      return res.status(503).json({ error: 'Не вдалося перевірити або списати AI-бали Студії.' });
    }
  });
}

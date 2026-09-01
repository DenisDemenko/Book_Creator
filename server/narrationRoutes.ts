/**
 * Озвучення книги/курсу — POST /api/narration/synthesize.
 *
 * Гейт — requirePlanAtLeast(['pro', 'ultra']) (server/subscriptions.ts):
 * та сама функція, що вже захищає «Форматування під KDP», адмін завжди
 * проходить без тарифної перевірки. Ключ провайдера — платформний
 * (server/platformKeys.ts): лише адміністратор вставляє його в «Ключі
 * API», решта користуються спільно — жодних власних ключів автора тут
 * немає, на відміну від чатових/зображень провайдерів.
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import { requirePlanAtLeast } from './subscriptions';
import { platformKeyFor } from './platformKeys';
import { recordUsage } from './store';
import { priceForNarration, ELEVENLABS_VOICE_ID } from './pricing';
import {
  synthesizeNarration,
  NarrationError,
  NARRATION_LANGS,
  NARRATION_MAX_CHARS,
  type NarrationLang,
} from './narration';
import { narrationCacheKey, findCachedNarration, saveNarration, findSectionNarration } from './narrationStore';

function isNarrationLang(v: unknown): v is NarrationLang {
  return v === 'uk' || v === 'en';
}

export function registerNarrationRoutes(app: Express): void {
  /** Чи налаштований ключ ElevenLabs — клієнт показує це до спроби синтезу. */
  app.get('/api/narration/status', requireAuth, async (_req, res) => {
    const key = await platformKeyFor('elevenlabs');
    res.json({ configured: !!key, langs: NARRATION_LANGS, maxChars: NARRATION_MAX_CHARS });
  });

  app.post(
    '/api/narration/synthesize',
    requireAuth,
    requirePlanAtLeast(['pro', 'ultra']),
    async (req, res) => {
      try {
        const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        const lang = req.body?.lang;
        const scope = req.body?.scope === 'section' ? 'section' : 'selection';
        const bookId = typeof req.body?.bookId === 'string' ? req.body.bookId : null;
        const chapterId = typeof req.body?.chapterId === 'string' ? req.body.chapterId : null;
        const sectionId = typeof req.body?.sectionId === 'string' ? req.body.sectionId : null;

        if (!text) {
          return res.status(400).json({ error: 'Немає тексту для озвучення.' });
        }
        if (!isNarrationLang(lang)) {
          return res.status(400).json({ error: 'Мова озвучення має бути "uk" або "en".' });
        }
        if (text.length > NARRATION_MAX_CHARS) {
          return res.status(413).json({
            error: `Фрагмент задовгий (${text.length} символів, ліміт ${NARRATION_MAX_CHARS}).`,
          });
        }

        const voiceId = ELEVENLABS_VOICE_ID;
        const cacheKey = narrationCacheKey(text, lang, voiceId);

        const cached = findCachedNarration(cacheKey);
        if (cached) {
          return res.json({
            audioUrl: cached.audioDataUrl,
            cached: true,
            charCount: cached.charCount,
          });
        }

        const apiKey = await platformKeyFor('elevenlabs');
        if (!apiKey) {
          return res.status(503).json({
            error: 'Озвучення ще не налаштоване: адміністратор має вставити ключ ElevenLabs у «Ключі API».',
            kind: 'no_key',
          });
        }

        let result;
        try {
          result = await synthesizeNarration(text, lang, apiKey, voiceId);
        } catch (err) {
          const cost = 0;
          await recordUsage({
            id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            timestamp: new Date().toISOString(),
            userId: req.principal?.isGuest ? null : req.principal?.id || null,
            userEmail: req.principal?.email || 'guest@local',
            role: req.principal?.role || 'guest',
            kind: 'audio',
            engineId: 'elevenlabs',
            modelId: voiceId,
            costUsd: cost,
            context: `Озвучення (${scope === 'section' ? 'розділ' : 'виділення'})`,
            bookId: bookId || undefined,
            success: false,
          });
          if (err instanceof NarrationError) {
            const status = err.kind === 'no_key' ? 503 : err.kind === 'too_long' ? 413 : 502;
            return res.status(status).json({ error: err.message, kind: err.kind });
          }
          throw err;
        }

        const audioUrl = `data:${result.mimeType};base64,${result.audioBase64}`;
        saveNarration({
          cacheKey,
          bookId,
          chapterId,
          sectionId,
          scope,
          lang,
          voiceId,
          audioDataUrl: audioUrl,
          charCount: result.charCount,
        });

        await recordUsage({
          id: `use-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          userId: req.principal?.isGuest ? null : req.principal?.id || null,
          userEmail: req.principal?.email || 'guest@local',
          role: req.principal?.role || 'guest',
          kind: 'audio',
          engineId: 'elevenlabs',
          modelId: voiceId,
          costUsd: priceForNarration(result.charCount),
          context: `Озвучення (${scope === 'section' ? 'розділ' : 'виділення'})`,
          bookId: bookId || undefined,
          success: true,
        });

        res.json({ audioUrl, cached: false, charCount: result.charCount });
      } catch (err) {
        console.error('[narration] synthesize:', err);
        res.status(500).json({ error: 'Не вдалося озвучити текст.' });
      }
    }
  );

  /** Уже готове озвучення розділу (для індикатора «готово» у плеєрі книги, без витрат на перевірку). */
  app.get('/api/narration/section/:sectionId', requireAuth, requirePlanAtLeast(['pro', 'ultra']), (req, res) => {
    const lang = req.query.lang;
    if (!isNarrationLang(lang)) {
      return res.status(400).json({ error: 'Мова озвучення має бути "uk" або "en".' });
    }
    const found = findSectionNarration(req.params.sectionId, lang);
    res.json({ audioUrl: found?.audioDataUrl || null });
  });
}

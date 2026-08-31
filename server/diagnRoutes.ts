/**
 * Маршрути модуля /diagn (diagn-module-tech-spec-v1.0.md §3, §4, §7).
 *
 * Оркестратор із ТЗ тут — це `Promise.allSettled` по обраних підмодулях.
 * Саме `allSettled`, а не `all`: три підмодулі незалежні, і якщо аналіз
 * структури впав на таймауті, стиль і компетенції вже пораховані й
 * оплачені. Викидати їх заради єдиної помилки означало б списати гроші
 * автора й не дати нічого; тому впалий підмодуль приходить у відповідь
 * своєю помилкою поруч із результатами решти.
 *
 * Порядок перевірок навмисний: спершу дешеві (склад модулів, обсяг
 * тексту), потім кеш, і лише потім ліміт частоти й виклики моделі. Кеш
 * перед лімітом — бо повторний показ уже порахованого звіту не витрачає
 * квоту й не має впиратись у неї.
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import { generateText } from './aiCore';
import {
  resolveCoreTemplate,
  type CoreModuleKey,
  type CorePromptTemplateBundle,
} from './coreAiRegistry';
import { resolveModuleModelId } from './coreModuleModels';
import {
  COMPETENCY_AXES,
  DIAGN_MODULES,
  MAX_INPUT_CHARS,
  MIN_WORDS_FOR_ANALYSIS,
  countWords,
  normalizeDiagnResult,
  parseDiagnResponse,
  renderDiagnTemplate,
  type DiagnModule,
} from './diagnPrompt';
import {
  checkDiagnRateLimit,
  diagnCacheKey,
  findCachedDiagnostic,
  getDiagnostic,
  listDiagnostics,
  saveDiagnostic,
} from './diagnStore';

const MODULE_TO_CORE_KEY: Record<DiagnModule, CoreModuleKey> = {
  style: 'diagnStyle',
  structure: 'diagnStructure',
  competency: 'diagnCompetency',
};

/** Підмодулі, для яких ТЗ §8 вимагає щонайменше 300 слів. */
const NEEDS_VOLUME: DiagnModule[] = ['style', 'structure'];

interface RunOutcome {
  module: DiagnModule;
  ok: boolean;
  result?: unknown;
  error?: string;
  modelId?: string;
}

export function registerDiagnRoutes(app: Express, deps: {
  resolveEngine: (modelId: string) => string;
  defaultModelId: string;
  /**
   * Адмінський шар промтів. Приходить ззовні, бо живе замиканням у
   * server.ts разом із доступом до налаштувань — другий шлях до тих
   * самих даних означав би два різні уявлення про те, що адмін
   * відредагував.
   */
  loadAdminLayer: () => Promise<CorePromptTemplateBundle | undefined>;
}): void {
  async function runModule(
    req: any,
    module: DiagnModule,
    text: string,
    context: { bookTitle?: string; genre?: string; locale?: string; bookId?: string }
  ): Promise<RunOutcome> {
    try {
      const modelId = (await resolveModuleModelId(MODULE_TO_CORE_KEY[module])) || deps.defaultModelId;
      const engine = deps.resolveEngine(modelId);
      const adminLayer = await deps.loadAdminLayer();
      const template = resolveCoreTemplate(MODULE_TO_CORE_KEY[module], adminLayer);

      const user = renderDiagnTemplate(template.user, {
        bookTitle: context.bookTitle,
        genre: context.genre,
        fragment: text,
        competencies: COMPETENCY_AXES.map((a, i) => `${i + 1}. ${a}`).join('\n'),
        locale: context.locale,
      });
      const system = renderDiagnTemplate(template.system, {
        fragment: '',
        locale: context.locale,
        competencies: COMPETENCY_AXES.join(', '),
      });

      const out = await generateText({
        engine: engine as never,
        modelId,
        prompt: user,
        systemInstruction: system,
        json: true,
        req,
        label: `Діагностика /diagn: ${module}`,
        bookId: context.bookId,
      });

      let raw: unknown;
      try {
        raw = parseDiagnResponse(out.text);
      } catch {
        return { module, ok: false, error: 'Модель повернула не JSON.', modelId };
      }
      return { module, ok: true, result: normalizeDiagnResult(module, raw), modelId };
    } catch (err) {
      return { module, ok: false, error: String((err as Error)?.message || err) };
    }
  }

  /** ТЗ §4: POST /api/v1/diagn. */
  app.post('/api/v1/diagn', requireAuth, async (req: any, res) => {
    const userId = req.principal?.id as string;
    const body = req.body || {};

    const requested: string[] = Array.isArray(body.modules) && body.modules.length
      ? body.modules.map((m: unknown) => String(m))
      : [...DIAGN_MODULES];
    const unknown = requested.filter((m) => !(DIAGN_MODULES as readonly string[]).includes(m));
    if (unknown.length) {
      return res.status(422).json({ error: `Невідомий підмодуль: ${unknown.join(', ')}.`, kind: 'unknown_module' });
    }
    const modules = [...new Set(requested)] as DiagnModule[];
    if (!modules.length) {
      return res.status(422).json({ error: 'Не вказано жодного підмодуля.', kind: 'unknown_module' });
    }

    const text = String(body.input?.content ?? body.text ?? '').trim();
    if (!text) {
      return res.status(400).json({ error: 'Порожній вхід: немає тексту для аналізу.', kind: 'empty_input' });
    }
    if (text.length > MAX_INPUT_CHARS) {
      return res.status(413).json({
        error: `Текст задовгий: ${text.length} знаків, межа — ${MAX_INPUT_CHARS}. Візьміть один розділ.`,
        kind: 'too_long',
      });
    }

    const words = countWords(text);
    // Замало слів — не відмова, а попередження поруч зі звітом (ТЗ §8
    // каже саме «попередження про низьку достовірність», не 400).
    const lowConfidence = words < MIN_WORDS_FOR_ANALYSIS && modules.some((m) => NEEDS_VOLUME.includes(m));

    const locale = String(body.locale || 'uk');
    const bookId = body.book_id || body.bookId || null;
    const cacheKey = diagnCacheKey(text, modules, locale);

    try {
      const cached = findCachedDiagnostic(userId, cacheKey);
      if (cached) {
        return res.json({
          diagn_id: cached.id,
          created_at: cached.createdAt,
          modules: cached.result,
          word_count: cached.wordCount,
          low_confidence: lowConfidence,
          from_cache: true,
          artifact_url: null,
        });
      }

      const rate = checkDiagnRateLimit(userId);
      if (!rate.allowed) {
        return res.status(429).json({
          error: `Ліміт діагностик вичерпано: ${rate.used} із ${rate.limit} за годину.`,
          kind: 'rate_limited',
          retry_at: rate.retryAt,
        });
      }

      // Паралельно, як вимагає ТЗ §8 (ціль ≤ 15 с на картку).
      const outcomes = await Promise.all(
        modules.map((m) =>
          runModule(req, m, text, {
            bookTitle: body.book_title || body.bookTitle,
            genre: body.genre,
            locale,
            bookId: bookId || undefined,
          })
        )
      );

      const result: Record<string, unknown> = {};
      const failed: { module: string; error: string }[] = [];
      for (const o of outcomes) {
        if (o.ok) result[o.module] = o.result;
        else failed.push({ module: o.module, error: o.error || 'невідома помилка' });
      }

      if (Object.keys(result).length === 0) {
        return res.status(500).json({
          error: failed[0]?.error || 'Жоден підмодуль не відпрацював.',
          kind: 'ai_failed',
          failed,
        });
      }

      const saved = saveDiagnostic({
        userId,
        bookId: bookId || null,
        modules: outcomes.filter((o) => o.ok).map((o) => o.module),
        result,
        cacheKey,
        wordCount: words,
      });

      res.json({
        diagn_id: saved.id,
        created_at: saved.createdAt,
        modules: result,
        word_count: words,
        low_confidence: lowConfidence,
        failed,
        from_cache: false,
        artifact_url: null,
      });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  /** ТЗ §7: історія для трекінгу прогресу автора. */
  app.get('/api/v1/diagn/history', requireAuth, async (req: any, res) => {
    try {
      const bookId = typeof req.query.document_id === 'string' ? req.query.document_id : null;
      const items = listDiagnostics(req.principal.id, bookId);
      res.json({
        items: items.map((d) => ({
          diagn_id: d.id,
          created_at: d.createdAt,
          book_id: d.bookId,
          modules: d.modules,
          word_count: d.wordCount,
        })),
      });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  /** Один звіт цілком — щоб відкрити збережену діагностику з історії. */
  app.get('/api/v1/diagn/:id', requireAuth, async (req: any, res) => {
    try {
      const d = getDiagnostic(req.params.id);
      // Чужу діагностику не показуємо і не підтверджуємо її існування.
      if (!d || d.userId !== req.principal.id) {
        return res.status(404).json({ error: 'Діагностику не знайдено.' });
      }
      res.json({
        diagn_id: d.id,
        created_at: d.createdAt,
        modules: d.result,
        word_count: d.wordCount,
        artifact_url: null,
      });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });
}

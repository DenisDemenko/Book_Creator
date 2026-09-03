/**
 * HTTP-шар King Market Intelligence.
 *
 * Тут же живе й сам скринінг — виклик моделі. Він не в сервісі саме тому,
 * що потребує `req`: без нього generateText не запише витрату в usage_log,
 * і платні виклики моделі стали б невидимими для обліку. Сервіс же має
 * лишатись тестованим без HTTP, тож він приймає скринінг як `deps.screen`.
 *
 * Залежності приходять ззовні (як у server/diagnRoutes.ts): `resolveEngine`
 * і `loadCoreAdminLayer` живуть замиканнями в server.ts, і другий шлях до
 * тих самих даних рано чи пізно розійшовся б із першим.
 *
 * ҐЕЙТ. Кожен маршрут стоїть за трьома перевірками поспіль, і порядок
 * навмисний: requireAuth (хто ти) → requirePermission('canMarketIntel')
 * (чи належить твоїй ролі ця дія) → requirePlanAtLeast(['pro','ultra'])
 * (чи оплачена вона). Дешевше й зрозуміліше відмовити раніше: гість має
 * побачити «увійдіть», а не «оновіть тариф».
 *
 * ЧЕСНІСТЬ ЧИСЕЛ. Джерело даних тут — мовна модель, а не Etsy Open API
 * (ТЗ 2, 10, 25). Тому кожна відповідь несе provenance і дисклеймер, і
 * жодне поле не «дозаповнюється» середнім чи нулем: чого модель не дала —
 * лишається null і потрапляє до provenance.unavailable.
 */

import type { Express, Request, Response } from 'express';
import { requireAdmin, requireAuth, requirePermission } from './auth';
import { requirePlanAtLeast } from './subscriptions';
import { CHAT_MODELS, engineConfigured, ENGINE_ENV_KEY, type EngineId } from './chatProviders';
import { readEtsyConfig } from './etsy/etsyConfig';
import { normalizeTopicKey } from './etsy/etsyResearch';
import { resolveCoreTemplate, renderCoreTemplate, type CorePromptTemplateBundle } from './coreAiRegistry';
import { resolveModuleModelId } from './coreModuleModels';
import { ETSY_ADVISOR_TASKS, type EtsyAdvisorTask } from './etsyAdvisorPrompt';
import { normalizeMarketScreenResult, parseMarketScreenResponse } from './market/marketScreenPrompt';
import { normalizeWeights } from './market/marketScoring';
import { productTrend, runMarketScreen, type ScreenFn } from './market/marketService';
import {
  getLatestReport,
  getScreenModelId,
  getWeights,
  listTrackedTopics,
  setScreenModelId,
  setWeights,
} from './market/marketStore';
import {
  DEFAULT_SCORE_WEIGHTS,
  MARKET_DISCLAIMER_AI_UK,
  type FieldSource,
  type MarketListing,
  type Provenance,
  type ScoreWeights,
  type ScreenResult,
} from './market/marketTypes';

export interface MarketRoutesDeps {
  resolveEngine: (modelId: string) => string;
  defaultModelId?: string;
  loadAdminLayer: () => Promise<any>;
  generateText: (args: any) => Promise<{ text: string; inputTokens: number; outputTokens: number }>;
  now?: () => Date;
}

/** ТЗ 6: тема — це keyword. Та сама стеля, що й у /api/etsy/research. */
const MAX_TOPIC_CHARS = 120;

/** Стеля питання до консультанта. Достатньо для повного розрахунку з калькулятора. */
const MAX_ADVISOR_CHARS = 6000;

/** Скільки товарів просити в моделі за один прогін. */
const MIN_COUNT = 1;
const MAX_COUNT = 25;
const DEFAULT_COUNT = 10;

/**
 * Помилка, яку маршрут має показати користувачем зрозумілим кодом, а не
 * загорнути у глухі 500. Скринінг кидає її з середини сервісу, тому вона
 * мусить пережити дорогу через runMarketScreen.
 */
class MarketScreenError extends Error {
  constructor(readonly status: number, message: string, readonly kind: string) {
    super(message);
  }
}

/** Поля лістингу, відсутність яких у ВСІХ товарів означає «джерело не дало». */
const OPTIONAL_LISTING_FIELDS: Array<[string, (l: MarketListing) => unknown]> = [
  ['externalId', (l) => l.externalId],
  ['url', (l) => l.url],
  ['priceUsd', (l) => l.priceUsd],
  ['rating', (l) => l.rating],
  ['reviewCount', (l) => l.reviewCount],
  ['favorers', (l) => l.favorers],
  ['availability', (l) => l.availability],
  ['createdAt', (l) => l.createdAt],
];

/**
 * Походження набору. Рахується з самих лістингів, а не проголошується
 * константою: якщо модель не дала жодного рейтингу, «rating» має чесно
 * потрапити в `unavailable`, і інтерфейс покаже прочерк замість числа
 * (ТЗ 2, останній пункт: NULL і позначка, а не вигадане значення).
 */
function provenanceFor(listings: MarketListing[], source: FieldSource): Provenance {
  const confidences = listings.map((l) => l.provenance?.confidence).filter((c): c is number => typeof c === 'number');
  const avg = confidences.length ? confidences.reduce((s, c) => s + c, 0) / confidences.length : 0;
  const unavailable = listings.length
    ? OPTIONAL_LISTING_FIELDS.filter(([, read]) => listings.every((l) => read(l) === null || read(l) === undefined)).map(
        ([name]) => name
      )
    : OPTIONAL_LISTING_FIELDS.map(([name]) => name);

  return {
    source,
    // 'ESTIMATED', а не 'VERIFIED': жодне число тут не звірене з Etsy.
    status: source === 'etsy_api' ? 'VERIFIED' : 'ESTIMATED',
    confidence: Math.round(Math.min(1, Math.max(0, avg)) * 100) / 100,
    unavailable,
  };
}

function handleError(res: Response, err: unknown, fallback: string): void {
  if (err instanceof MarketScreenError) {
    res.status(err.status).json({ error: err.message, kind: err.kind });
    return;
  }
  const message = String((err as Error)?.message || err);
  console.error('[market]', message);
  res.status(500).json({ error: fallback, kind: 'unknown', detail: message });
}

export function registerMarketRoutes(app: Express, deps: MarketRoutesDeps): void {
  const now = deps.now || (() => new Date());

  /** Спільний ґейт усіх маршрутів модуля — один масив, щоб не розійшовся по копіях. */
  const gate = [requireAuth, requirePermission('canMarketIntel'), requirePlanAtLeast(['pro', 'ultra'])] as const;

  /**
   * Скринінг: єдине місце модуля, яке справді витрачає гроші.
   *
   * Пріоритет моделі: явно прислана в запиті → обрана адміном саме для
   * цього модуля (market_screen_model) → прив'язка ядра для
   * 'etsyMarketScreen' → серверний дефолт. Тобто адмін задає поведінку за
   * замовчуванням, але не відбирає в автора право спробувати іншу модель.
   */
  const screen: ScreenFn = async ({ topic, count, modelId: requestedModelId, req }) => {
    const preferred = (requestedModelId || '').trim() || (await getScreenModelId()) || undefined;
    const modelId = (await resolveModuleModelId('etsyMarketScreen', preferred)) || deps.defaultModelId || '';
    if (!modelId) {
      throw new MarketScreenError(
        503,
        'Не обрано модель для скринінгу ринку. Адміністратор має задати її в налаштуваннях модуля.',
        'no_model'
      );
    }

    const engine = deps.resolveEngine(modelId) as EngineId;
    if (!engineConfigured(engine)) {
      // Ключа немає — це стан середовища, а не збій коду. 503 і чесне
      // пояснення, ЯКОЇ саме змінної бракує, замість викинутого стека.
      throw new MarketScreenError(
        503,
        `Скринінг ринку недоступний: для рушія моделі «${modelId}» не налаштований ${ENGINE_ENV_KEY[engine]} у .env сервера. ` +
          'Оберіть модель іншого провайдера в налаштуваннях модуля або додайте ключ.',
        'no_key'
      );
    }

    const template = resolveCoreTemplate('etsyMarketScreen', (await deps.loadAdminLayer()) as CorePromptTemplateBundle | undefined);
    const rendered = renderCoreTemplate('etsyMarketScreen', template, {
      topic,
      count: String(count),
      language: 'uk',
    });

    const out = await deps.generateText({
      engine,
      modelId,
      prompt: rendered.user,
      systemInstruction: rendered.system,
      json: true,
      req,
      label: 'King Market Intelligence: скринінг ринку',
    });

    let raw: unknown;
    try {
      raw = parseMarketScreenResponse(out.text);
    } catch {
      throw new MarketScreenError(
        502,
        'Модель повернула не JSON — спробуйте ще раз або оберіть іншу модель у налаштуваннях модуля.',
        'bad_model_output'
      );
    }

    const listings = normalizeMarketScreenResult(raw, {
      topicKey: normalizeTopicKey(topic),
      collectedAt: now().toISOString(),
      limit: count,
    });

    const result: ScreenResult = {
      listings,
      provenance: provenanceFor(listings, 'ai_screen'),
      modelId,
      engine,
      rawResponse: out.text,
    };
    return result;
  };

  // =========================================================================
  // Скринінг і звіти
  // =========================================================================

  app.post('/api/market/screen', ...gate, async (req: Request, res: Response) => {
    try {
      const topic = String(req.body?.topic || '').trim();
      if (!topic) return res.status(400).json({ error: 'Вкажіть тему або нішу для аналізу.', kind: 'bad_input' });
      if (topic.length > MAX_TOPIC_CHARS) {
        return res
          .status(400)
          .json({ error: `Тема задовга (максимум ${MAX_TOPIC_CHARS} символів).`, kind: 'bad_input' });
      }

      const requested = Number(req.body?.count);
      const count = Number.isFinite(requested)
        ? Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(requested)))
        : DEFAULT_COUNT;

      const result = await runMarketScreen(
        {
          topic,
          count,
          userId: (req.principal?.id as string) ?? null,
          modelId: typeof req.body?.modelId === 'string' ? req.body.modelId : undefined,
          // Примусове оновлення — теж платний виклик, тож дозволяємо його
          // будь-кому, хто вже пройшов ґейт: інакше автор не мав би способу
          // перезібрати явно застарілий звіт. Захист від зловживань — вікно
          // кешу й тарифний план, а не заборона кнопки.
          force: Boolean(req.body?.force),
          req,
        },
        { screen, now }
      );

      res.json(result);
    } catch (err) {
      handleError(res, err, 'Не вдалося виконати скринінг ринку.');
    }
  });

  /** Останній збережений звіт теми. `null` — тему ще не досліджували. */
  app.get('/api/market/report', ...gate, async (req: Request, res: Response) => {
    try {
      const topic = String(req.query.topic || '').trim();
      if (!topic) return res.status(400).json({ error: 'Вкажіть тему.', kind: 'bad_input' });
      const found = await getLatestReport(normalizeTopicKey(topic));
      res.json({ report: found?.report ?? null });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити звіт.');
    }
  });

  app.get('/api/market/topics', ...gate, async (_req: Request, res: Response) => {
    try {
      res.json({ topics: await listTrackedTopics() });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити перелік тем.');
    }
  });

  /** Часовий ряд одного товару — графіки ціни й відгуків (ТЗ 7, 8). */
  app.get('/api/market/product/:productKey/history', ...gate, async (req: Request, res: Response) => {
    try {
      const productKey = String(req.params.productKey || '').trim();
      if (!productKey) return res.status(400).json({ error: 'Не вказано товар.', kind: 'bad_input' });
      res.json({ snapshots: await productTrend(productKey) });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити історію товару.');
    }
  });

  // =========================================================================
  // Консультант (модуль ядра `etsyAdvisor`)
  // =========================================================================

  /**
   * Текстова порада практика: ціна, тренд, лістинг, аудит магазину.
   *
   * Чому тут, а не окремим файлом: це той самий модуль King Market
   * Intelligence, той самий ґейт і той самий `deps.generateText`. Набір,
   * з якого перенесені ці екрани, ходив у Gemini напряму з власним ключем —
   * тобто повз `usage_log`. Тут виклик іде через ядро, тож витрата
   * потрапляє в облік, а модель обирає адмін у налаштуваннях модуля.
   *
   * Відповідь — вільний текст, без JSON-схеми: це порада людині, а не дані
   * для таблиці, і вигадувати їй структуру означало б вигадувати точність.
   */
  app.post('/api/market/advisor', ...gate, async (req: Request, res: Response) => {
    try {
      const rawTask = String(req.body?.task || '').trim();
      if (!(rawTask in ETSY_ADVISOR_TASKS)) {
        return res.status(400).json({
          error: `Невідомий тип задачі «${rawTask}». Доступні: ${Object.keys(ETSY_ADVISOR_TASKS).join(', ')}.`,
          kind: 'bad_input',
        });
      }
      const task = rawTask as EtsyAdvisorTask;

      const question = String(req.body?.question || '').trim();
      if (!question) return res.status(400).json({ error: 'Порожнє питання до консультанта.', kind: 'bad_input' });
      if (question.length > MAX_ADVISOR_CHARS) {
        return res
          .status(400)
          .json({ error: `Питання задовге (максимум ${MAX_ADVISOR_CHARS} символів).`, kind: 'bad_input' });
      }

      const preferred = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
      const modelId = (await resolveModuleModelId('etsyAdvisor', preferred || undefined)) || deps.defaultModelId || '';
      if (!modelId) {
        return res.status(503).json({
          error: 'Не обрано модель для консультанта Etsy. Адміністратор має задати її в налаштуваннях модуля.',
          kind: 'no_model',
        });
      }

      const engine = deps.resolveEngine(modelId) as EngineId;
      if (!engineConfigured(engine)) {
        return res.status(503).json({
          error:
            `Консультант недоступний: для рушія моделі «${modelId}» не налаштований ${ENGINE_ENV_KEY[engine]} ` +
            'у .env сервера. Оберіть модель іншого провайдера або додайте ключ.',
          kind: 'no_key',
        });
      }

      const template = resolveCoreTemplate(
        'etsyAdvisor',
        (await deps.loadAdminLayer()) as CorePromptTemplateBundle | undefined
      );
      const rendered = renderCoreTemplate('etsyAdvisor', template, {
        task: ETSY_ADVISOR_TASKS[task],
        question,
        language: 'українською',
      });

      const out = await deps.generateText({
        engine,
        modelId,
        prompt: rendered.user,
        systemInstruction: rendered.system,
        req,
        label: `King Market Intelligence: консультант (${task})`,
      });

      const answer = (out.text || '').trim();
      if (!answer) {
        return res.status(502).json({ error: 'Модель повернула порожню відповідь.', kind: 'bad_model_output' });
      }

      res.json({ answer, modelId, engine, task });
    } catch (err) {
      handleError(res, err, 'Не вдалося отримати пораду консультанта.');
    }
  });

  // =========================================================================
  // Налаштування модуля
  // =========================================================================

  /**
   * Читати налаштування може кожен, хто пройшов ґейт: ваги формули потрібні
   * інтерфейсу, щоб пояснити, з чого склався Opportunity Score (ТЗ 11 —
   * «формула та всі проміжні значення доступні для аудиту»). Змінювати їх
   * може лише адмін — див. PUT нижче.
   */
  app.get('/api/market/settings', ...gate, async (_req: Request, res: Response) => {
    try {
      const etsy = readEtsyConfig();
      res.json({
        weights: await getWeights(),
        modelId: await getScreenModelId(),
        availableModels: CHAT_MODELS.map((m) => ({
          ...m,
          // Модель у списку є завжди, але без ключа провайдера вона не
          // спрацює — хай інтерфейс покаже це до вибору, а не після 503.
          engineConfigured: engineConfigured(m.engine),
        })),
        // Джерело даних модуля: офіційний API, якщо він налаштований, інакше
        // чесно — скринінг моделлю.
        source: etsy.configured ? ('etsy_api' as FieldSource) : ('ai_screen' as FieldSource),
        defaultWeights: DEFAULT_SCORE_WEIGHTS,
        disclaimerUk: MARKET_DISCLAIMER_AI_UK,
      });
    } catch (err) {
      handleError(res, err, 'Не вдалося завантажити налаштування модуля.');
    }
  });

  /**
   * Правка ваг і моделі — виключно адмін (requireAdmin ПІСЛЯ спільного
   * ґейту). Ваги впливають на кожен звіт усіх користувачів, а модель — на
   * вартість кожного скринінгу; ні те, ні те не є персональним вибором.
   */
  app.put('/api/market/settings', ...gate, requireAdmin, async (req: Request, res: Response) => {
    try {
      const body = req.body || {};

      if (body.weights !== undefined) {
        if (!body.weights || typeof body.weights !== 'object') {
          return res.status(400).json({ error: 'weights має бути об’єктом.', kind: 'bad_input' });
        }
        const incoming = body.weights as Record<string, unknown>;
        for (const key of Object.keys(DEFAULT_SCORE_WEIGHTS)) {
          const value = incoming[key];
          if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
            return res
              .status(400)
              .json({ error: `Вага «${key}» має бути невід’ємним числом.`, kind: 'bad_input' });
          }
        }
        // Суму до 100 не вимагаємо від адміна: він може ввести хоч
        // «demand: 3, growth: 1» і отримати очікувані пропорції. Але
        // ЗБЕРІГАЄМО вже нормалізоване. Інакше Settings показував би 115
        // у сумі, а рахунок ішов би за іншими, нормалізованими числами —
        // і ТЗ 11 («формула та всі проміжні значення доступні для аудиту»)
        // порушувалось би саме там, де адмін звіряє ваги з балом.
        await setWeights(
          normalizeWeights({ ...(await getWeights()), ...(incoming as Partial<ScoreWeights>) })
        );
      }

      if (body.modelId !== undefined) {
        if (body.modelId !== null && typeof body.modelId !== 'string') {
          return res.status(400).json({ error: 'modelId має бути рядком або null.', kind: 'bad_input' });
        }
        await setScreenModelId(typeof body.modelId === 'string' ? body.modelId : null);
      }

      res.json({
        weights: await getWeights(),
        modelId: await getScreenModelId(),
      });
    } catch (err) {
      handleError(res, err, 'Не вдалося зберегти налаштування модуля.');
    }
  });
}

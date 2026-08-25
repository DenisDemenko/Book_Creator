// Завантажуємо .env найпершим, поки жоден модуль ще не прочитав process.env.
import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import {
  ensureGeneratedDir,
  listEngines,
  seedreamConfig,
  GENERATED_DIR,
  GENERATED_URL_PREFIX,
} from './server/imageGeneration';
import {
  geminiClient as ai,
  generateWithGemini,
  generateText as generateAiText,
  generateImage as generateImageAndLog,
  dispatch as dispatchAiText,
  recordTextUsageByModel,
  GEMINI_MODEL,
} from './server/aiCore';
import {
  attachPrincipal,
  registerAuthRoutes,
  requirePermission,
  requireAuth,
  requireAdmin,
  ensureAdminExists,
  googleConfig,
  ADMIN_EMAIL,
} from './server/auth';
import { registerAdminRoutes } from './server/adminRoutes';
import { registerUsageRoutes } from './server/usageRoutes';
import { registerSubscriptionRoutes } from './server/subscriptionRoutes';
import { registerMediaRoutes } from './server/mediaRoutes';
import { registerCollaborationRoutes } from './server/collaborationRoutes';
import { registerChatRoutes, CHAT_USAGE_CONTEXT } from './server/chatRoutes';
import { registerApiKeysRoutes } from './server/apiKeysRoutes';
import { registerPublishingRoutes } from './server/publishingRoutes';
import { requireImageQuota, requirePlanAtLeast, checkChatQuota, resolveSubscription } from './server/subscriptions';
import {
  resolveEngine as resolveChatEngine,
  engineConfigured,
  ENGINE_ENV_KEY,
  ENGINE_LABELS,
  VISION_ENGINES,
  ChatProviderError,
  type ImageAttachment,
  type EngineId,
} from './server/chatProviders';
import { priceForTextEngine } from './server/pricing';
import { buildPromptContext } from './server/chatPrompt';
import { generateTextFromImage, engineAvailability, TextFromImageError, resolveImageBytes } from './server/textFromImage';
import { buildManuscriptImagePrompt, manuscriptImageSystemInstruction } from './server/manuscriptImagePrompt';
import {
  PROMPT_TEMPLATES_META_KEY,
  MAX_TEMPLATE_CHARS,
  PLACEHOLDERS,
  factoryTemplateSet,
  resolveTemplate,
  buildPromptFromTemplate,
  buildFactoryPrompt,
  type PromptTemplateBundle,
} from './server/promptTemplates';
import {
  CORE_PROMPT_TEMPLATES_META_KEY,
  CORE_MAX_TEMPLATE_CHARS,
  CORE_MODULE_KEYS,
  CORE_MODULE_PLACEHOLDERS,
  CORE_MODULE_HAS_JSON_SCHEMA,
  factoryCoreTemplate,
  factoryCoreTemplateBundle,
  resolveCoreTemplate,
  renderCoreTemplate,
  usedCorePlaceholders,
  splitAtSchemaMarker,
  stripSchemaForStorage,
  type CoreModuleKey,
  type CorePromptTemplateBundle,
} from './server/coreAiRegistry';
import { formatManuscriptWithClaude, anthropicConfig, ClaudeManuscriptError, MAX_MANUSCRIPT_CHARS } from './server/claudeManuscript';
import { purgeExpiredSessions, initStore, getUserStyle, upsertUserStyle, deleteUserStyle, getUserApiKey, listUserApiKeys, getUserPromptTemplates, upsertUserPromptTemplates, deleteUserPromptTemplates, getAppSetting, setAppSetting } from './server/store';
import { decryptApiKey } from './server/userApiKeyCrypto';

// Логування витрат (logImageUsage/logTextUsage) переїхало в server/aiCore.ts —
// єдине місце, звідки тепер проходять усі AI-виклики продукту.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CollabUser {
  clientId: string;
  userId: string;
  userName: string;
  role: string;
  currentTab: string;
  activeSectionId?: string;
  activeChapterId?: string;
  color: string;
  avatarUrl?: string;
  lastActive: string;
  isTyping?: boolean;
}

interface RoomClient {
  ws: WebSocket;
  info: CollabUser;
}

interface RoomData {
  bookId: string;
  book: any | null;
  clients: Map<string, RoomClient>;
  messages: Array<{
    id: string;
    clientId: string;
    senderName: string;
    role: string;
    color: string;
    message: string;
    timestamp: string;
    tabContext?: string;
  }>;
  changelog: any[];
}

const collabRooms = new Map<string, RoomData>();

function getOrCreateRoom(bookId: string): RoomData {
  if (!collabRooms.has(bookId)) {
    collabRooms.set(bookId, {
      bookId,
      book: null,
      clients: new Map(),
      messages: [
        {
          id: `msg-sys-welcome-${bookId}`,
          clientId: 'system',
          senderName: 'Система NOVA STUDIO',
          role: 'admin',
          color: '#f59e0b',
          message: 'Вітаємо в спільній кімнаті книги! Усі правки, сцени та коментарі синхронізуються між учасниками в реальному часі.',
          timestamp: new Date().toISOString(),
          tabContext: 'editor'
        }
      ],
      changelog: []
    });
  }
  return collabRooms.get(bookId)!;
}

function broadcastToRoom(bookId: string, event: any, senderId?: string) {
  const room = collabRooms.get(bookId);
  if (!room) return;

  const payloadStr = JSON.stringify({
    ...event,
    senderId,
    timestamp: new Date().toISOString()
  });

  room.clients.forEach((client, clientId) => {
    if (senderId && clientId === senderId) return; // Skip sender if specified
    if (client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(payloadStr);
      } catch (err) {
        console.error(`Failed to send to client ${clientId}:`, err);
      }
    }
  });
}


async function startServer() {
  const app = express();
  // Cloud Run, Railway, Render та Heroku передають порт через оточення.
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '20mb' }));

  // Кожен запит отримує req.principal: користувача сесії або гостя.
  app.use(attachPrincipal);

  const storeInfo = await initStore();
  console.log(
    storeInfo.backend === 'sqlite'
      ? `[db] Сховище: SQLite (${storeInfo.path})`
      : `[db] Сховище: JSON-файли (${storeInfo.path}). Вбудований node:sqlite недоступний — оновіть Node до 22.5+, щоб перейти на базу.`
  );

  await ensureAdminExists();
  const purged = await purgeExpiredSessions();
  if (purged) console.log(`[auth] Прибрано протухлих сесій: ${purged}`);
  console.log(
    `[auth] Адміністратор: ${ADMIN_EMAIL} | вхід через Google: ${googleConfig.enabled ? 'увімкнено' : 'вимкнено'}`
  );

  registerAuthRoutes(app);
  registerAdminRoutes(app);
  registerUsageRoutes(app);
  registerSubscriptionRoutes(app);
  registerMediaRoutes(app);
  registerCollaborationRoutes(app);

  /**
   * Модуль публікації та експорту (Amazon KDP + Etsy). Реєструється тут,
   * поруч з рештою підсистем, і сам піднімає два фонові процеси: воркер
   * черги публікації (переживає рестарт, бо стан задач лежить у базі) і
   * планувальник оновлення досліджених тем.
   *
   * Без ключів Etsy модуль не падає: KDP-гілка (файли, розрахунок корінця,
   * лист метаданих) і пакувальник набору працюють повністю, а Etsy-гілка
   * чесно повідомляє, чого бракує в .env.
   */
  const publishing = registerPublishingRoutes(app, { appUrl: process.env.APP_URL });

  // Клієнт Gemini SDK (`ai`) і generateWithGemini() тепер живуть у
  // server/aiCore.ts — імпортовані на початку файлу. `apiKey` тут більше
  // не потрібен: усюди, де раніше перевіряли `!!apiKey`, тепер перевіряють
  // `!!ai` (той самий факт — чи налаштований GEMINI_API_KEY).

  /**
   * Єдиний генератор відповідей чат-сесій для ВСІХ провайдерів. Модель,
   * яку обрав користувач для сесії, визначає рушій (server/chatProviders.ts
   * → resolveEngine). Якщо автор задав власний ключ (розділ «Ключі API») —
   * він іде в запит замість серверного; демо-відповідь лишається лише коли
   * немає ні власного, ні серверного ключа, щоб офлайн-режим не забруднював
   * статистику витрат (так само, як і раніше з demoReply).
   */
  async function generateChatReply(
    prompt: string,
    systemInstruction: string,
    modelId?: string,
    userId?: string,
    images?: ImageAttachment[]
  ) {
    const resolvedModel = modelId || GEMINI_MODEL;
    const engine = resolveChatEngine(resolvedModel);

    let userKey: string | undefined;
    if (userId) {
      const stored = await getUserApiKey(userId, engine).catch(() => undefined);
      if (stored) {
        try {
          userKey = decryptApiKey(stored.encryptedKey);
        } catch (err) {
          console.warn('[chat] не вдалося розшифрувати ключ користувача, пробуємо серверний:', err);
        }
      }
    }

    if (!userKey && !engineConfigured(engine)) {
      return {
        text: `Демо-відповідь без AI-ключа: для рушія «${ENGINE_LABELS[engine]}» не налаштований ${ENGINE_ENV_KEY[engine]} у .env сервера (і власний ключ у розділі «Ключі API» не заданий). Додайте ключ, щоб отримувати реальні поради цією моделлю.`,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    // Диспетчеризація до провайдера — тепер через ядро (server/aiCore.ts),
    // ту саму точку входу, що й решта AI-інструментів продукту. Логування
    // лишається тут, у chatRoutes.ts (onUsage) — воно вже надійно покрите
    // 71 тестом (npm run test:chat), тож викликати generateText() (яка теж
    // логує) і створювати подвійний запис у usage_log нема сенсу.
    return dispatchAiText(engine, resolvedModel, prompt, systemInstruction, userKey, images);
  }

  registerChatRoutes(app, {
    generate: generateChatReply,
    defaultModelId: GEMINI_MODEL,
    checkChatQuota: (userId, role) => checkChatQuota(userId, role, CHAT_USAGE_CONTEXT),
    onUsage: (req, label, modelId, inputTokens, outputTokens, success) =>
      recordTextUsageByModel(req, label, modelId, inputTokens, outputTokens, success),
    loadStyleGuide: async (userId: string) => {
      const style = await getUserStyle(userId);
      return style?.autoUseStyle && style.contentMd ? style.contentMd : null;
    },
    listUserConfiguredEngines: async (userId: string) => (await listUserApiKeys(userId)).map((k) => k.engine),
  });

  registerApiKeysRoutes(app);

  // --- API Endpoints ---

  // Згенеровані зображення лежать файлами й віддаються статикою,
  // щоб у книзі зберігався короткий URL, а не base64 на кілька мегабайт.
  await ensureGeneratedDir();
  app.use(
    GENERATED_URL_PREFIX,
    express.static(GENERATED_DIR, { immutable: true, maxAge: '30d' })
  );

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', hasGeminiKey: !!ai, hasSeedreamKey: seedreamConfig.enabled });
  });

  /** Перелік доступних двигунів генерації — щоб клієнт не хардкодив назви моделей. */
  app.get('/api/ai/image-engines', (req, res) => {
    res.json({
      engines: listEngines({ google: !!ai, bytedance: seedreamConfig.enabled }),
      hasGeminiKey: !!ai,
      hasSeedreamKey: seedreamConfig.enabled,
    });
  });

  // 1. AI Text Editing with Diff Proposal
  app.post('/api/ai/edit-text', async (req, res) => {
    try {
      const { text, instruction, category, bookContext, sceneContext, styleGuide } = req.body;
      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Потрібен текст для редагування.' });
      }

      const categoryDescriptions: Record<string, string> = {
        improve: 'Покращити загальну якість, плавність та виразність тексту українською мовою.',
        rewrite: 'Повністю переписати текст іншими художніми словами, зберігши суть.',
        shorten: 'Скоротити текст, вилучивши воду та зайві конструкції, лишивши найсильніші образи.',
        expand: 'Розширити текст, додавши глибини, сенсорних деталей, відчуттів та атмосфери.',
        artistic: 'Зробити текст значно художнішим, поетичнішим, із метафорами та яскравими епітетами.',
        simple: 'Спростити мову, зробити її легкою для читання, чіткою та зрозумілою.',
        dialogue: 'Покращити діалоги: зробити репліки живими, природними, надати персонажам індивідуального голосу.',
        tone: 'Змінити тональність на більш драматичну та інтригуючу.',
        grammar: 'Виправити всі граматичні, пунктуаційні та синтаксичні помилки.',
        syntax: 'Оптимізувати структуру складних речень, усунути тавтологію.',
        repetitions: 'Усунути повтори слів та одноманітні початки речень.',
        description: 'Збагатити описи локації, персонажів та звукового/візуального фону.',
        emotional: 'Підсилити емоційну напругу та внутрішні переживання персонажів.',
        cinematic: 'Зробити сцену динамічною, кінематографічною (Show, Donʼt Tell).',
        keep_style: 'Вдосконалити текст, суворо дотримуючись авторського стилю.',
        custom: instruction || 'Вдосконалити текст згідно з побажаннями автора.'
      };

      // 1.3: якщо автор увімкнув «Автоматично використовувати стиль» у модулі
      // стилю (StyleView), фронтенд підвантажує ім'я_автора.md і надсилає
      // його вмістом сюди — додаємо як окрему секцію системного промпту,
      // а не в userPrompt, щоб модель трактувала це як стійке правило, а
      // не як разову вказівку автора.
      const styleGuideSection =
        typeof styleGuide === 'string' && styleGuide.trim()
          ? `\n\nДОТРИМУЙСЯ АВТОРСЬКОГО СТИЛЮ (файл ім'я_автора.md, згенерований AI-аналізом текстів цього автора):\n"""${styleGuide.trim().slice(0, 8000)}"""\nПиши так, ніби це сам автор — з тими самими мовними звичками, ритмом та лексикою.`
          : '';

      const systemPrompt = `Ти — висококласний український літературний редактор та стиліст.
Твоє завдання — редагувати наданий уривок твору за вказаним запитом.
Завжди зберігай український правопис, природний мовний ритм і виразність.${styleGuideSection}
Поверни JSON об'єкт наступного формату:
{
  "proposedText": "Оновлений повний відредагований текст",
  "explanation": "Коротке пояснення внесених змін (1-2 речення)",
  "changesCount": 3,
  "diffSummary": ["замінено канцеляризм", "підсилено динаміку діалогу", "виправлено узгодження слів"]
}`;

      const userPrompt = `
Контекст твору: ${bookContext || 'Художній твір'}
Контекст сцени: ${sceneContext || 'Загальна сцена'}
Тип редагування: ${categoryDescriptions[category] || categoryDescriptions.improve}
Вказівка автора: ${instruction || ''}

ОРИГІНАЛЬНИЙ ТЕКСТ:
"""${text}"""

Поверни JSON з відредагованим текстом.`;

      let resultJson: any;
      if (ai) {
        const rawResponse = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: 'Редагування тексту',
          bookId: req.body?.bookId,
        });
        resultJson = JSON.parse(rawResponse);
      } else {
        // High quality fallback simulation for instant offline experience
        resultJson = {
          proposedText: text.replace(/був/g, 'став').replace(/дуже/g, 'надзвичайно') + '\n\n(AI-редакція: мовні звороти гармонізовано, темпоритм підвищено)',
          explanation: 'Покращено синаптичний темпоритм оповіді, усунено тавтологічні повтори та підкреслено художню атмосферу.',
          changesCount: 4,
          diffSummary: ['Очищено від надлишкових займенників', 'Посилено образність дієслів', 'Гармонізовано ритміку фрази']
        };
      }

      res.json(resultJson);
    } catch (err: any) {
      console.error('Error in /api/ai/edit-text:', err);
      res.status(500).json({ error: err.message || 'Помилка генерації AI пропозиції' });
    }
  });

  // 2. Grammar, Spelling, Style & Repetition Checker
  app.post('/api/ai/check-grammar', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || text.trim().length === 0) {
        return res.json({ issues: [] });
      }

      const systemPrompt = `Ти — експерт з української мови, правопису, синтаксису, стилістики та виявлення кліше у літературних текстах.
Проаналізуй поданий фрагмент і знайди:
1. Орфографічні помилки (spelling)
2. Граматичні та морфологічні помилки (grammar)
3. Синтаксичні неточності (syntax)
4. Повтори слів / тавтології (repetition)
5. Стилістичні вади / русизми / канцеляризми (style)
6. Затерті кліше та штампи (cliche)

Поверни JSON масив issues у такому форматі:
{
  "issues": [
    {
      "id": "iss-1",
      "type": "spelling" | "grammar" | "syntax" | "repetition" | "style" | "cliche",
      "word": "слово чи фраза з проблемою",
      "context": "фрагмент речення з цим словом",
      "message": "Пояснення проблеми українською",
      "suggestions": ["варіант 1", "варіант 2"],
      "severity": "error" | "warning" | "info"
    }
  ],
  "readabilityScore": 88,
  "stats": {
    "wordCount": 120,
    "uniqueWordsCount": 95,
    "readingTimeMinutes": 1
  }
}`;

      const userPrompt = `Проаналізуй текст:\n\n"""${text}"""`;

      let responseData: any;
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: 'Перевірка граматики',
        });
        responseData = JSON.parse(raw);
      } else {
        // Dynamic fallback issue detector
        responseData = {
          issues: [
            {
              id: 'iss-demo-1',
              type: 'style',
              word: 'значні пошкодження',
              context: 'має значні пошкодження в темпоральній зоні',
              message: 'Канцеляризм. У художньому стилі краще замінити на виразніший синонім.',
              suggestions: ['глибокі розриви', 'суттєві дефекти', 'помітні руйнування'],
              severity: 'warning'
            },
            {
              id: 'iss-demo-2',
              type: 'repetition',
              word: 'пам\'яті',
              context: 'фільтри пам\'яті четвертого рівня ... фрагмента його останньої доби',
              message: 'Повтор кореня у близькому контексті.',
              suggestions: ['спогадів', 'архіву свідомості', 'синаптичних слідів'],
              severity: 'info'
            }
          ],
          readabilityScore: 92,
          stats: {
            wordCount: text.split(/\s+/).length,
            uniqueWordsCount: new Set(text.toLowerCase().split(/\s+/)).size,
            readingTimeMinutes: Math.max(1, Math.ceil(text.split(/\s+/).length / 200))
          }
        };
      }

      res.json(responseData);
    } catch (err: any) {
      console.error('Error in /api/ai/check-grammar:', err);
      res.status(500).json({ error: err.message || 'Помилка перевірки тексту' });
    }
  });

  // ---------------------------------------------------------------------
  // Фаза 1, 1.1: Модуль стилю — «ім'я_автора.md»
  //
  // У ТЗ малося на увазі, що бекенд сам «збирає всі тексти автора з книг,
  // нотаток, виконаних вправ». У реальній архітектурі книги живуть лише в
  // IndexedDB браузера (сервер про їхній вміст нічого не знає — див.
  // коментар на початку collaborationRoutes.ts), тож збирає текст клієнт
  // (StyleView.tsx: розділи поточної книги + відповіді з виконаних вправ
  // майстерності) і надсилає одним полем sourceText. Авторизація — та сама
  // cookie-сесія, що і в решті застосунку (requireAuth), а не окремий JWT,
  // якого в проєкті немає.
  // ---------------------------------------------------------------------
  const MAX_STYLE_SOURCE_CHARS = 60_000;

  /**
   * Спільний резолвер «якою моделлю виконати текстовий/JSON крок ядра AI».
   *
   * Раніше кожен із цих кроків (промпт ілюстрації, промпт персонажа,
   * біографія персонажа, «шліфування» промту всередині генерації арту)
   * був жорстко прив'язаний до глобального Gemini-клієнта: без ключа
   * Gemini мовчки повертались вигадані дані. Тепер, як і генерація тексту
   * за фото ([generate-manuscript-paragraphs-from-image]), крок іде через
   * рушій, який автор ОБРАВ У ЧАТІ (modelId у тілі запиту, типово —
   * `book.preferredAiModelId`) — той самий перелік моделей, що й для решти
   * сайту. Немає ключа для цього рушія — чесна 503 `no_key`, БЕЗ жодної
   * підміни відповіді фейковими даними.
   *
   * `null` — маршрут уже сам відповів клієнту (403/503), продовжувати не треба.
   */
  async function resolveTextEngineOrFail(
    req: express.Request,
    res: express.Response,
    modelId: string | undefined,
    label: string
  ): Promise<{ engine: EngineId; resolvedModelId: string; userKey: string | undefined } | null> {
    const resolvedModelId = modelId || GEMINI_MODEL;
    const engine = resolveChatEngine(resolvedModelId);

    const userId = req.principal?.id as string | undefined;
    let userKey: string | undefined;
    if (userId) {
      const stored = await getUserApiKey(userId, engine).catch(() => undefined);
      if (stored) {
        try {
          userKey = decryptApiKey(stored.encryptedKey);
        } catch (err) {
          console.warn(`[${label}] не вдалося розшифрувати ключ користувача, пробуємо серверний:`, err);
        }
      }
    }

    if (!userKey && !engineConfigured(engine)) {
      res.status(503).json({
        error: `Рушій книги «${ENGINE_LABELS[engine]}» не налаштований: додайте ${ENGINE_ENV_KEY[engine]} у .env сервера або власний ключ у розділі «Ключі API».`,
        kind: 'no_key',
      });
      return null;
    }

    return { engine, resolvedModelId, userKey };
  }

  /**
   * Захисний розбір JSON-відповіді моделі — потрібен, бо `json:true` у
   * generateText() (server/aiCore.ts) вмикає структурований режим ЛИШЕ для
   * Gemini SDK; для решти рушіїв (GPT/Claude/DeepSeek/Groq/Mistral) модель
   * лише інструктовано текстом промту повернути JSON, без апаратної
   * гарантії. Той самий підхід, що вже й у server/claudeManuscript.ts —
   * спершу прямий парсинг, тоді пошук `{...}` у відповіді на випадок
   * зайвого тексту навколо.
   */
  function parseModelJson(raw: string): any {
    // Крок 1: як є. Спрацьовує для Gemini (SDK-режим) і для рушіїв, де
    // json-режим нижче (openAiCompatible::response_format, Claude
    // assistant-prefill) уже гарантує чистий синтаксис.
    try {
      return JSON.parse(raw.trim());
    } catch {
      /* пробуємо далі */
    }

    // Крок 2: прибрати markdown-огорожу (```json … ``` чи просто ``` … ```)
    // — модель, яку НЕ попросили в режимі json (чи проігнорувала режим),
    // любить обгортати відповідь для «читабельності».
    const withoutFences = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    try {
      return JSON.parse(withoutFences);
    } catch {
      /* пробуємо далі */
    }

    // Крок 3: перший `{` до ЙОГО парного `}` через підрахунок дужок, а не
    // «перший { до останнього }» — той наївний варіант ламається, якщо
    // після валідного JSON модель дописала ще щось із фігурними дужками
    // (пояснення, приклад), і сам об'єкт лишається незамкненим.
    const start = withoutFences.indexOf('{');
    if (start !== -1) {
      let depth = 0;
      for (let i = start; i < withoutFences.length; i += 1) {
        if (withoutFences[i] === '{') depth += 1;
        else if (withoutFences[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            const candidate = withoutFences.slice(start, i + 1);
            try {
              return JSON.parse(candidate);
            } catch {
              break;
            }
          }
        }
      }
    }

    console.error('[parseModelJson] не вдалося розпізнати JSON, сира відповідь:', raw.slice(0, 2000));
    throw new Error('Модель повернула відповідь у форматі, який не вдалося розпізнати як JSON.');
  }

  function assertOwnStyleOrAdmin(req: express.Request, res: express.Response, userIdParam: string): boolean {
    const principal = req.principal!;
    if (principal.role === 'admin') return true;
    if (principal.id !== userIdParam) {
      res.status(403).json({ error: 'Доступ до файлу стилю має лише сам автор або адміністратор.' });
      return false;
    }
    return true;
  }

  function styleSystemPrompt(): string {
    return `Ти — літературний аналітик, який досліджує авторський стиль письменника за наданими фрагментами його текстів.
Проаналізуй ці тексти. Вияви: улюблену довжину речень, частоту використання дієприкметників/дієприслівників, типові граматичні конструкції, лексичне розмаїття, тон (іронічний/серйозний/науковий/поетичний тощо), характерні образи та мотиви.
Сформуй файл у форматі Markdown з РІВНО такими розділами (кожен — заголовок другого рівня):
## Словник
## Ритм
## Типові_звороти
## Заборонені_слова

У «Заборонені_слова» виведи слова чи канцеляризми, які автор явно надуживає (повторює занадто часто) — якщо таких не помітно, напиши «Не виявлено помітних повторів».
Пиши українською, стисло, по суті, у формі практичних нотаток для самого автора (звертайся на «ви»), без вступів і загальних фраз.
Поверни ЛИШЕ текст Markdown-файлу, без жодних пояснень чи JSON навколо.`;
  }

  function styleFallbackMarkdown(sourceText: string): string {
    const words = sourceText.split(/\s+/).filter(Boolean);
    const sentences = sourceText.split(/(?<=[.!?…])\s+/).filter((s) => s.trim().length > 0);
    const avgSentenceLen = sentences.length ? Math.round(words.length / sentences.length) : 0;
    const uniqueRatio = words.length ? Math.round((new Set(words.map((w) => w.toLowerCase())).size / words.length) * 100) : 0;
    return `## Словник
Проаналізовано ${words.length.toLocaleString('uk-UA')} слів вашого тексту. Словникове розмаїття (частка унікальних слів): ${uniqueRatio}%.

## Ритм
Середня довжина речення — приблизно ${avgSentenceLen} слів.

## Типові_звороти
Демонстраційний файл (AI-ключ на сервері не налаштований — це заглушка, а не реальний аналіз стилю).

## Заборонені_слова
Не виявлено — увімкніть AI-аналіз (GEMINI_API_KEY), щоб отримати справжні рекомендації.`;
  }

  /** Формує вміст файлу стилю (AI, або чесна демо-заглушка, якщо ключа нема). */
  app.post('/api/style/generate', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const sourceText = typeof req.body?.sourceText === 'string' ? req.body.sourceText.trim() : '';
      if (!sourceText) {
        return res.status(400).json({ error: 'Немає текстів для аналізу — напишіть хоча б трохи в книзі або виконайте вправу з майстерності.' });
      }
      const trimmedSource = sourceText.slice(0, MAX_STYLE_SOURCE_CHARS);

      let contentMd: string;
      if (ai) {
        contentMd = await generateWithGemini(
          `Ось фрагменти текстів автора для аналізу стилю:\n\n"""${trimmedSource}"""`,
          styleSystemPrompt(),
          false,
          { req, label: 'Аналіз авторського стилю' }
        );
      } else {
        contentMd = styleFallbackMarkdown(trimmedSource);
      }

      const existing = await getUserStyle(principal.id!);
      const now = new Date().toISOString();
      const saved = await upsertUserStyle({
        userId: principal.id!,
        contentMd: contentMd.trim(),
        autoUseStyle: existing?.autoUseStyle ?? false,
        sourceChars: trimmedSource.length,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });

      res.json({ contentMd: saved.contentMd, autoUseStyle: saved.autoUseStyle, updatedAt: saved.updatedAt, sourceChars: saved.sourceChars });
    } catch (err: any) {
      console.error('Error in /api/style/generate:', err);
      res.status(500).json({ error: err.message || 'Не вдалося сформувати файл стилю.' });
    }
  });

  /** Повертає поточний файл стилю користувача (або 404, якщо ще не сформований). */
  app.get('/api/style/:userId', requireAuth, async (req, res) => {
    try {
      if (!assertOwnStyleOrAdmin(req, res, req.params.userId)) return;
      const style = await getUserStyle(req.params.userId);
      if (!style) return res.status(404).json({ error: 'Файл стилю ще не сформовано.' });
      res.json({ contentMd: style.contentMd, autoUseStyle: style.autoUseStyle, updatedAt: style.updatedAt, sourceChars: style.sourceChars });
    } catch (err: any) {
      console.error('Error in GET /api/style/:userId:', err);
      res.status(500).json({ error: err.message || 'Не вдалося завантажити файл стилю.' });
    }
  });

  /** Ручне редагування вмісту файлу стилю АБО перемикання чекбокса «автоматично використовувати». */
  app.put('/api/style/:userId', requireAuth, async (req, res) => {
    try {
      if (!assertOwnStyleOrAdmin(req, res, req.params.userId)) return;
      const existing = await getUserStyle(req.params.userId);
      if (!existing) return res.status(404).json({ error: 'Файл стилю ще не сформовано — спершу згенеруйте його.' });

      const { contentMd, autoUseStyle } = req.body || {};
      const next = {
        ...existing,
        contentMd: typeof contentMd === 'string' && contentMd.trim() ? contentMd : existing.contentMd,
        autoUseStyle: typeof autoUseStyle === 'boolean' ? autoUseStyle : existing.autoUseStyle,
        updatedAt: new Date().toISOString(),
      };
      const saved = await upsertUserStyle(next);
      res.json({ contentMd: saved.contentMd, autoUseStyle: saved.autoUseStyle, updatedAt: saved.updatedAt, sourceChars: saved.sourceChars });
    } catch (err: any) {
      console.error('Error in PUT /api/style/:userId:', err);
      res.status(500).json({ error: err.message || 'Не вдалося оновити файл стилю.' });
    }
  });

  /** Видаляє файл стилю — незворотно (підтвердження на фронтенді). */
  app.delete('/api/style/:userId', requireAuth, async (req, res) => {
    try {
      if (!assertOwnStyleOrAdmin(req, res, req.params.userId)) return;
      await deleteUserStyle(req.params.userId);
      res.json({ ok: true });
    } catch (err: any) {
      console.error('Error in DELETE /api/style/:userId:', err);
      res.status(500).json({ error: err.message || 'Не вдалося видалити файл стилю.' });
    }
  });

  // 3. Scene & Dramaturgy Analysis
  app.post('/api/ai/analyze-scene', async (req, res) => {
    try {
      const { sceneTitle, sceneContent, characters, location, conflict } = req.body;
      const prompt = `Проаналізуй драматургію сцени роману:
Назва сцени: ${sceneTitle}
Локація: ${location}
Конфлікт: ${conflict}
Персонажі: ${JSON.stringify(characters || [])}
Текст сцени:
"""${sceneContent}"""

Оціни за критеріями:
1. Драматургічна напруга (1-10)
2. Темпоритм (Pacing)
3. Достовірність мотивації та взаємодії персонажів
4. Конфлікт та кульмінаційний момент
5. Конкретні поради для підсилення художнього враження (3-4 пункти)

Поверни JSON:
{
  "intensityScore": 7,
  "pacing": "динамічний / помірний / затягнутий",
  "dramaturgyAnalysis": "Детальний аналіз...",
  "characterDynamics": "Аналіз взаємодії...",
  "keyRecommendations": ["порада 1", "порада 2", "порада 3"]
}`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(prompt, 'Ти — досвідчений голлівудський скрипт-доктор та літературний критик.', true, {
          req,
          label: 'Аналіз сцени',
          bookId: req.body?.bookId,
        });
        result = JSON.parse(raw);
      } else {
        result = {
          intensityScore: 8,
          pacing: 'Динамічний та напружений',
          dramaturgyAnalysis: 'Сцена чудово тримає увагу завдяки високим ставкам та чіткому протиставленню цілей персонажів. Атмосферні деталі гармонійно переплітаються з дією.',
          characterDynamics: 'Відчувається прихована напруга та хімія між персонажами. Їхні невербальні жести підсилюють підтекст розмови.',
          keyRecommendations: [
            'Додайте більше сенсорних відчуттів у моменті кульмінації (звуки, вібрації, запахи).',
            'Зробіть паузу у діалозі перед ключовим зізнанням для збільшення драматичної паузи.',
            'Підкресліть ціну помилки для головного героя.'
          ]
        };
      }

      res.json(result);
    } catch (err: any) {
      console.error('Error in /api/ai/analyze-scene:', err);
      res.status(500).json({ error: err.message || 'Помилка аналізу сцени' });
    }
  });

  // 3b. Literary Translation (Ukrainian -> English for bilingual publication)
  app.post('/api/ai/translate', async (req, res) => {
    try {
      const { text, title, chapterTitle, scene, sourceLang = 'uk', targetLang = 'en', genre, bookTitle } = req.body;
      
      const systemPrompt = `You are an elite literary translator specializing in translating Ukrainian fiction and world-class literature into English for high-end international book publication.
Your translations must:
1. Preserve deep literary voice, atmosphere, nuances, imagery, metaphors, rhythm, and tone.
2. Render dialogue naturally into expressive English with proper formatting (em dashes or quotation marks matching literary standards).
3. Accurately translate proper nouns, titles, and sci-fi/cyberpunk terms (e.g., Neo-Kyiv, Prometiy, Svarog, synaptic gateway, quantum needle).
4. Never produce robotic or literal word-for-word translation; make it read like an award-winning published English novel.

Return a clean JSON object:
{
  "translatedText": "Full translated manuscript text in English",
  "translatedTitle": "Translated section title (if provided)",
  "translatedChapterTitle": "Translated chapter title (if provided)",
  "translatedScene": {
    "title": "Translated scene title",
    "conflict": "Translated scene conflict",
    "resolution": "Translated scene resolution",
    "summary": "Translated scene summary"
  },
  "notes": "Brief translator note on choices made (1 sentence)"
}`;

      const userPrompt = `Please translate the following Ukrainian book manuscript components into English for publication:
Book Context: "${bookTitle || 'Novel'}", Genre: "${genre || 'Fiction'}"

${title ? `Section Title (UA): """${title}"""` : ''}
${chapterTitle ? `Chapter Title (UA): """${chapterTitle}"""` : ''}
${scene ? `Scene Details (UA): ${JSON.stringify(scene)}` : ''}

Manuscript Text (UA):
"""${text || ''}"""

Translate into refined English JSON.`;

      let resultJson: any;
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: 'Переклад',
          bookId: req.body?.bookId,
        });
        resultJson = JSON.parse(raw);
      } else {
        // High quality offline fallback translation
        const fallbackText = text
          ? text
              .replace(/Скляні куполи Верхнього Печерська відбивали перші промені холодного серпневого сонця/g, 'The glass domes of Upper Pechersk reflected the first rays of the cold August sun')
              .replace(/перетворюючи неоновий горизонт Нео-Києва на мерехтливу призму/g, 'turning the neon horizon of Neo-Kyiv into a shimmering prism')
              .replace(/Олена стояла біля панорамного вікна лабораторії на 84-му поверсі/g, 'Olena stood by the panoramic window of the 84th-floor laboratory')
              .replace(/Готовність до синхронізації 98 відсотків, пані архітекторко/g, 'Sync readiness is at 98 percent, architect')
              .replace(/спокійний, позбавлений обертонів голос Сварога пролунав прямо в її слуховому імпланті/g, 'Svarog’s calm, overtone-free voice resonated directly inside her auditory implant')
              .replace(/Підключи фільтри пам'яті четвертого рівня, Свароже/g, 'Connect the fourth-level memory filters, Svarog')
              .replace(/У кав'ярні «Чорний Кварк» на Нижньому Подолі пахло вологою штучною кавою/g, 'The "Black Quark" cafe in Lower Podil smelled of damp synthetic coffee')
              .replace(/Тарас Вальц повільно перегорнув сторінку паперового блокнота/g, 'Taras Valts slowly turned the page of his paper notebook')
              .replace(/Ви запізнилися на сім хвилин, пане Вальц/g, 'You are seven minutes late, Mr. Valts')
              .replace(/У нашому місті пунктуальність — це найпростіший спосіб опинитися в прицілі снайпера/g, 'In this city, punctuality is the easiest way to end up in a sniper’s crosshairs')
          : '';

        resultJson = {
          translatedText: fallbackText || (text ? `[English Edition] ${text}` : ''),
          translatedTitle: title ? title.replace(/Розділ/g, 'Section').replace(/Квантова голка/g, 'The Quantum Needle').replace(/Детектив з Нижнього Подолу/g, 'The Detective of Lower Podil') : undefined,
          translatedChapterTitle: chapterTitle ? chapterTitle.replace(/Глава/g, 'Chapter').replace(/Скляний Світанок над Дніпром/g, 'Glass Dawn Over the Dnipro') : undefined,
          translatedScene: scene ? {
            title: scene.title ? scene.title.replace(/Нейроекстракція/g, 'Neuroextraction in Prometiy Lab').replace(/Зустріч у кавʼярні/g, 'Meeting at Black Quark Cafe') : '',
            conflict: scene.conflict ? 'Risk of synaptic brain overload and sudden security raid.' : '',
            resolution: scene.resolution ? 'Olena breaches the cipher and transfers encrypted data onto an autonomous crystal.' : '',
            summary: scene.summary || ''
          } : undefined,
          notes: 'Literary English translation preserved cyberpunk terminology and dialogue cadences.'
        };
      }

      res.json(resultJson);
    } catch (err: any) {
      console.error('Error in /api/ai/translate:', err);
      res.status(500).json({ error: err.message || 'Помилка літературного перекладу' });
    }
  });

  // 4b. AI Character Art & Prompt Generation (Nano Banana, Leonardo.ai, Midjourney styles)
  app.post('/api/ai/generate-character-art', requirePermission('canGenerateImages'), requireImageQuota(), async (req, res) => {
    try {
      const {
        character,
        prompt: userPrompt,
        engine,
        model,
        stylePreset = 'cyberpunk-photoreal',
        aspectRatio = '3:4',
        genre = 'Кіберпанк / Наукова фантастика',
        visualBible,
        /** Рушій ТЕКСТУ для «шліфування» промту — окремий від `engine`/`model` (те, ЯКИМ рушієм генерується сама КАРТИНКА). */
        textModelId,
      } = req.body;

      // 1. Формуємо промпт з опису персонажа, якщо його не задали вручну.
      let finalPrompt: string = (userPrompt || '').trim();
      const negativePrompt =
        'blurry, low quality, distorted anatomy, extra limbs, bad eyes, disfigured face, watermark, signature, text, out of frame';

      if (!finalPrompt && character) {
        const look = character.appearance || {};
        const personality = character.personality || {};

        finalPrompt = [
          `Masterpiece character portrait of ${character.name || 'a character'}`,
          character.alias ? `known as "${character.alias}"` : '',
          character.profession || '',
          character.age ? `${character.age} years old` : '',
          character.gender || '',
          look.height ? `height ${look.height}` : '',
          look.build ? `build: ${look.build}` : '',
          look.hair ? `hair: ${look.hair}` : '',
          look.eyes ? `eyes: ${look.eyes}` : '',
          look.face ? `face: ${look.face}` : '',
          look.clothing ? `wearing ${look.clothing}` : '',
          look.distinguishingMarks ? `distinguishing features: ${look.distinguishingMarks}` : '',
          personality.motivation ? `determined expression, motivation: ${personality.motivation}` : '',
          `genre: ${genre}`,
          `style preset: ${stylePreset}`,
          visualBible?.artStyle ? `visual aesthetic: ${visualBible.artStyle}` : '',
          visualBible?.lighting ? `lighting: ${visualBible.lighting}` : '',
          'close-up cinematic 85mm portrait, photorealistic skin texture, dramatic studio lighting, high detail'
        ].filter(Boolean).join(', ');
      }

      // 2. Просимо ОБРАНУ В ЧАТІ модель відшліфувати промпт (необов'язковий
      // крок — картинка все одно згенерується нижче, шліфування лише
      // покращує якість промту). Раніше це було жорстко прив'язано до
      // Gemini конкретно; тепер — той самий рушій, що й для решти ядра
      // (Q18 grilling-сесії). Немає ключа для нього — крок мовчки
      // пропускається (лишається грубий, але ЧЕСНИЙ шаблонний промпт),
      // не фейкова заміна — сама картинка нижче все одно реальна.
      if (character && !userPrompt) {
        const textResolvedModelId = textModelId || GEMINI_MODEL;
        const textEngine = resolveChatEngine(textResolvedModelId);
        const textUserId = req.principal?.id as string | undefined;
        let textUserKey: string | undefined;
        if (textUserId) {
          const stored = await getUserApiKey(textUserId, textEngine).catch(() => undefined);
          if (stored) {
            try {
              textUserKey = decryptApiKey(stored.encryptedKey);
            } catch {
              /* пробуємо серверний ключ нижче */
            }
          }
        }
        if (textUserKey || engineConfigured(textEngine)) {
          try {
            const enhanced = await generateAiText({
              engine: textEngine,
              modelId: textResolvedModelId,
              prompt: `Rewrite this into a single vivid English image-generation prompt, max 90 words, no preamble:\n${finalPrompt}`,
              systemInstruction: 'You craft ultra-realistic, cinematic portrait prompts for image models.',
              apiKeyOverride: textUserKey,
              req,
              label: 'Промпт для портрета персонажа',
              bookId: req.body?.bookId,
            });
            if (enhanced.text?.trim()) finalPrompt = enhanced.text.trim();
          } catch {
            // не критично — лишаємо зібраний вручну промпт
          }
        }
      }

      // 3. Справжня генерація — генерація + збереження файлу + логування
      // витрати одним викликом ядра (server/aiCore.ts).
      const generated = await generateImageAndLog({
        prompt: finalPrompt,
        engine: engine || model,
        aspectRatio,
        negativePrompt,
        filenameHint: `char-${character?.name || 'hero'}`,
        req,
        label: `Портрет: ${character?.name || 'персонаж'}`,
        bookId: req.body?.bookId,
      });

      res.json({
        imageUrl: generated.url,
        promptUsed: finalPrompt,
        negativePrompt,
        modelUsed: generated.engineLabel,
        modelKey: generated.engineId,
        stylePreset,
        aspectRatio: generated.aspectRatio,
        fileSize: `${Math.round(generated.bytes / 1024)} КБ`,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      const status = err?.kind === 'no_key' ? 503 : err?.kind === 'quota' ? 429 : 500;
      if (err?.cause) console.error('  причина:', (err.cause as Error)?.message || err.cause);
      console.error('Error in /api/ai/generate-character-art:', err?.message || err);
      res.status(status).json({
        error: err?.message || 'Помилка генерації арту персонажа',
        kind: err?.kind || 'unknown'
      });
    }
  });

  // 4c. Auto-craft Prompt from Character Description Endpoint
  /**
   * Формує текстовий промпт для генерації портрета персонажа. Раніше без
   * ключа Gemini мовчки повертав правдоподібний, але ВИГАДАНИЙ промпт —
   * письменник не міг здогадатись, що це не AI. Тепер, як і решта ядра,
   * іде через рушій, обраний у чаті (Q13/Q18 grilling-сесії): немає ключа
   * для нього — чесна 503, без жодної підміни.
   */
  app.post('/api/ai/craft-character-prompt', async (req, res) => {
    const { character, model = 'nano-banana', stylePreset = 'cyberpunk-photoreal', genre, modelId, bookId } = req.body;
    if (!character) {
      return res.status(400).json({ error: 'Потрібні дані персонажа.' });
    }

    const resolved = await resolveTextEngineOrFail(req, res, modelId, 'промпт персонажа');
    if (!resolved) return;
    const { engine, resolvedModelId, userKey } = resolved;

    const adminLayer = await loadCoreAdminLayer();
    const template = resolveCoreTemplate('characterPromptCraft', adminLayer);
    const rendered = renderCoreTemplate('characterPromptCraft', template, {
      modelLabel: model,
      characterName: character.name,
      characterSurname: character.surname,
      characterRole: character.role,
      characterProfession: character.profession,
      appearanceJson: JSON.stringify(character.appearance || {}),
      personalityJson: JSON.stringify(character.personality || {}),
      genre,
      stylePreset,
    });

    try {
      const result = await generateAiText({
        engine,
        modelId: resolvedModelId,
        prompt: rendered.user,
        systemInstruction: rendered.system,
        json: true,
        apiKeyOverride: userKey,
        req,
        label: 'Промпт персонажа',
        bookId,
      });
      res.json(parseModelJson(result.text));
    } catch (err: any) {
      console.error('Error in /api/ai/craft-character-prompt:', err?.message || err);
      const status = err instanceof ChatProviderError ? err.status : 500;
      res.status(status).json({ error: err?.message || 'Помилка формування промпту' });
    }
  });

  /**
   * Генерує повного персонажа (біографію, зовнішність, психологію) з
   * короткого опису ідеї. Раніше без ключа Gemini мовчки повертав
   * ЗАВЖДИ ОДНОГО Й ТОГО САМОГО вигаданого персонажа («Ярослав Беркут») —
   * письменник міг і не помітити, що це не результат AI. Тепер, як і
   * решта ядра, іде через рушій, обраний у чаті: немає ключа для нього —
   * чесна 503, без жодної підміни (Q13/Q18 grilling-сесії).
   */
  app.post('/api/ai/generate-character', async (req, res) => {
    const { role, promptDescription, genre, modelId, bookId } = req.body;

    const resolved = await resolveTextEngineOrFail(req, res, modelId, 'генерація персонажа');
    if (!resolved) return;
    const { engine, resolvedModelId, userKey } = resolved;

    const adminLayer = await loadCoreAdminLayer();
    const template = resolveCoreTemplate('characterBioPrompt', adminLayer);
    const rendered = renderCoreTemplate('characterBioPrompt', template, {
      role,
      genre,
      promptDescription,
    });

    try {
      const result = await generateAiText({
        engine,
        modelId: resolvedModelId,
        prompt: rendered.user,
        systemInstruction: rendered.system,
        json: true,
        apiKeyOverride: userKey,
        req,
        label: 'Генерація персонажа',
        bookId,
      });
      res.json(parseModelJson(result.text));
    } catch (err: any) {
      console.error('Error in /api/ai/generate-character:', err?.message || err);
      const status = err instanceof ChatProviderError ? err.status : 500;
      res.status(status).json({ error: err?.message || 'Помилка створення персонажа' });
    }
  });

  // 4.1 Behavior Patterns AI Generator
  // Характерні шаблони поведінки персонажа в діалогах («Він дивиться прямо
  // в очі своєму напарнику та говорить прямо»). Письменник викликає цей
  // ендпоінт із розділу «Персонажі», а результати зберігаються у
  // Character.behaviorPatterns і показуються при наведенні на героя в
  // редакторі («Книга і текст»).
  app.post('/api/ai/generate-behavior-patterns', async (req, res) => {
    try {
      const {
        name,
        role = 'protagonist',
        genre = 'Фантастика',
        biography = '',
        personality = {},
        bigFive = null,
        alias = '',
        profession = '',
        count = 8,
      } = req.body;

      // П'ять фіксованих ситуаційних тригерів (узгоджено з письменником):
      // саме за ними будується бібліотека патернів, коли задано bigFive.
      const TRIGGERS: { key: string; label: string }[] = [
        { key: 'question', label: 'на запитання співрозмовника' },
        { key: 'stress_conflict', label: 'у стресі/конфлікті' },
        { key: 'lying_hiding', label: 'коли бреше або приховує' },
        { key: 'interest_sympathy', label: 'коли зацікавлений або симпатизує' },
        { key: 'calm_conversation', label: 'у спокійній розмові' },
      ];

      const systemPrompt = bigFive
        ? `Ти — майстер літературної майстерності та сценічної гри.
Створи бібліотеку характерних поведінкових патернів персонажа для 5 типових сценарних ситуацій
(тригерів) у діалогах. Кожен патерн — короткий, конкретний, образний опис того, ЯК герой тримається,
рухається, реагує чи говорить (не репліка!), одне речення (8–20 слів), теперішній час, третя особа
(наприклад: «Юля відвела очі, почувши запитання» — це патерн саме для тригера «на запитання»,
типовий для інтроверта з низькою extraversion). Патерни МАЮТЬ узгоджуватись із наданим профілем
Big Five персонажа (openness/conscientiousness/extraversion/agreeableness/neuroticism, 0–100):
низька extraversion → уникає прямого погляду, менше жестикулює; висока neuroticism → нервові жести,
тремтіння голосу; низька agreeableness → різкість, перебивання; тощо — обери, що логічно підходить.
Поверни JSON: { "library": { "question": ["...","..."], "stress_conflict": [...], "lying_hiding": [...],
"interest_sympathy": [...], "calm_conversation": [...] } } — по 2–3 патерни на кожен із 5 тригерів,
українською.`
        : `Ти — майстер літературної майстерності та сценічної гри.
Створи характерні шаблони поведінки персонажа в діалогах — короткі, конкретні, образні описи того,
ЯК герой тримається, рухається, реагує та говорить у розмові. Це не репліки, а поведінкові підказки
для письменника, на кшталт: «Він дивиться прямо в очі своєму напарнику та говорить прямо».
Кожен шаблон — одне речення (10–25 слів), без лапок, у теперішньому часі, від третьої особи
(«Вона опускає погляд і відповідає тихо»), унікальний і не схожий на інші.
Поверни JSON: { "patterns": ["...", "...", ...] } — рівно ${count} шаблонів.`;

      const userPrompt = `Персонаж: ${name}${alias ? ` (позивний «${alias}») ` : ''}
Роль у сюжеті: ${role}
Професія: ${profession || 'не вказано'}
Жанр книги: ${genre}
Біографія: ${biography || 'не вказано'}
Психологія: ${JSON.stringify(personality)}${bigFive ? `\nBig Five (0–100): ${JSON.stringify(bigFive)}` : ''}`;

      let patterns: string[] = [];
      let library: Record<string, string[]> | undefined;
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: bigFive ? 'Бібліотека патернів поведінки (Big Five)' : 'Генерація шаблонів поведінки',
        });
        const parsed = JSON.parse(raw);
        if (bigFive) {
          library = {};
          for (const trig of TRIGGERS) {
            const arr = parsed?.library?.[trig.key];
            library[trig.key] = Array.isArray(arr) ? arr.filter((s: unknown) => typeof s === 'string') : [];
          }
        } else {
          patterns = Array.isArray(parsed?.patterns) ? parsed.patterns : [];
        }
      } else if (bigFive) {
        // Офлайн-фолбек: по одному демо-патерну на тригер, орієнтовно за
        // extraversion (найпоказовіший приклад із завдання — "відвела очі").
        const introvert = (bigFive.extraversion ?? 50) < 50;
        library = {
          question: [introvert ? `${name} відводить очі, почувши запитання.` : `${name} дивиться прямо в очі й одразу відповідає.`],
          stress_conflict: [`${name} стискає щелепи й на мить замовкає.`],
          lying_hiding: [`${name} на секунду відводить погляд убік.`],
          interest_sympathy: [`${name} злегка нахиляється вперед, слухаючи уважніше.`],
          calm_conversation: [`${name} говорить рівним, спокійним тоном.`],
        };
      } else {
        // Офлайн-фолбек: демо-шаблони, які письменник може одразу правити.
        patterns = [
          `${name} дивиться прямо в очі співрозмовнику й говорить прямо, без зайвих слів.`,
          `${name} робить коротку паузу, перш ніж відповісти, ніби зважує кожне слово.`,
          `${name} говорить спокійно, але в голосі відчувається прихована напруга.`,
          `${name} супроводжує слова стриманим жестом руки, наче окреслює невидиму лінію.`,
          `${name} не підвищує тон, проте кожна його фраза звучить як вирок.`,
          `${name} опускає погляд і відповідає тихо, немов ділиться таємницею.`,
          `${name} усміхається кутиком губ, коли говорить про те, що йому справді важливо.`,
          `${name} уважно слухає, ледь схиливши голову, і лише потім відповідає.`,
        ].slice(0, count);
      }

      res.json({ patterns, library });
    } catch (err: any) {
      console.error('Error in /api/ai/generate-behavior-patterns:', err);
      res.status(500).json({ error: err.message || 'Помилка генерації шаблонів поведінки' });
    }
  });

  /**
   * П'ять скандх (буддійська модель персонажа) — на відміну від решти
   * 24 текстових інструментів, які йдуть через сумісну обгортку
   * generateWithGemini(), ці два ендпоінти написані одразу проти чистого
   * API ядра (aiCore.generateText) — нового коду нема сенсу тягнути крізь
   * legacy-сумісний шлях.
   */
  app.post('/api/ai/generate-skandhas', async (req, res) => {
    try {
      const {
        name,
        role = 'protagonist',
        genre = 'Фантастика',
        biography = '',
        personality = {},
        bigFive = null,
      } = req.body;

      const systemPrompt = `Ти — літературний психолог і сценарист. Аналізуєш персонажа через буддійську
концепцію п'яти скандх — п'ять способів описати, ЯК людина обробляє досвід (це не «частини душі», а шари
одного процесу): рупа (тіло), ведана (чуттєвий тон: приємно/неприємно/нейтрально), санджня (як інтерпретує
події — що для нього означають любов/зрада/успіх/поразка), санкхара (автоматичний, звичний імпульс реакції —
тікає/атакує/контролює/рятує/маніпулює/шукає визнання тощо), винняна (на що звертає увагу і чого систематично
НЕ помічає в собі — сліпа зона). Дай конкретну, сюжетно корисну відповідь для КОНКРЕТНОГО персонажа (не
загальну теорію), 2-4 речення на кожен пункт, українською.
Поверни JSON: { "rupa": "...", "vedana": "...", "sanjna": "...", "sankhara": "...", "vinnana": "..." }`;

      const userPrompt = `Персонаж: ${name}
Роль у сюжеті: ${role}
Жанр книги: ${genre}
Біографія: ${biography || 'не вказано'}
Психологія: ${JSON.stringify(personality)}${bigFive ? `\nBig Five (0-100): ${JSON.stringify(bigFive)}` : ''}`;

      let skandhas: { rupa: string; vedana: string; sanjna: string; sankhara: string; vinnana: string };
      if (ai) {
        const result = await generateAiText({
          engine: 'gemini',
          modelId: GEMINI_MODEL,
          json: true,
          prompt: userPrompt,
          systemInstruction: systemPrompt,
          req,
          label: 'Аналіз персонажа через 5 скандх',
          bookId: req.body?.bookId,
        });
        const parsed = JSON.parse(result.text);
        skandhas = {
          rupa: parsed?.rupa || '',
          vedana: parsed?.vedana || '',
          sanjna: parsed?.sanjna || '',
          sankhara: parsed?.sankhara || '',
          vinnana: parsed?.vinnana || '',
        };
      } else {
        // Офлайн-фолбек: демо-відповіді, які письменник може одразу правити.
        skandhas = {
          rupa: `${name} тримає спину прямо, але у стресі руки шукають, чим зайнятися — олівець, край рукава, телефон.`,
          vedana: `Найприємніше для ${name} — визнання за добре виконану справу; найнеприємніше — відчуття, що його ігнорують.`,
          sanjna: `${name} схильний тлумачити мовчання співрозмовника як загрозу чи відмову, навіть коли причина інша.`,
          sankhara: `Зіткнувшись із невизначеністю, ${name} автоматично намагається взяти ситуацію під контроль.`,
          vinnana: `${name} добре помічає чужі промахи, але рідко бачить, як власна тривога штовхає його на поспішні дії.`,
        };
      }

      res.json({ skandhas });
    } catch (err: any) {
      console.error('Error in /api/ai/generate-skandhas:', err);
      res.status(500).json({ error: err.message || 'Помилка аналізу персонажа через 5 скандх' });
    }
  });

  app.post('/api/ai/generate-skandha-cycle', async (req, res) => {
    try {
      const { name, skandhas = {}, event } = req.body;
      if (!event || !String(event).trim()) {
        return res.status(400).json({ error: 'Потрібен опис ситуації для побудови циклу реакції.' });
      }

      const systemPrompt = `Ти — літературний психолог і сценарист. Для заданої ситуації побудуй драматургічний
ланцюжок реакції персонажа за буддійською моделлю п'яти скандх: Подія → Тіло (рупа) → Відчуття (ведана) →
Інтерпретація (санджня) → Автоматичний імпульс (санкхара) → Дія → Нова подія. Кожен крок — конкретне, коротке
(1 речення) продовження саме ДЛЯ ЦЬОГО персонажа з урахуванням його скандх нижче, не загальна теорія.
Поверни JSON: { "steps": [ { "label": "Подія", "text": "..." }, { "label": "Тіло", "text": "..." },
{ "label": "Відчуття", "text": "..." }, { "label": "Інтерпретація", "text": "..." },
{ "label": "Імпульс", "text": "..." }, { "label": "Дія", "text": "..." }, { "label": "Нова подія", "text": "..." } ] }`;

      const userPrompt = `Персонаж: ${name || 'Персонаж'}
Скандхи персонажа: ${JSON.stringify(skandhas)}
Ситуація: ${event}`;

      let steps: { label: string; text: string }[];
      if (ai) {
        const result = await generateAiText({
          engine: 'gemini',
          modelId: GEMINI_MODEL,
          json: true,
          prompt: userPrompt,
          systemInstruction: systemPrompt,
          req,
          label: 'Цикл реакції персонажа (5 скандх)',
          bookId: req.body?.bookId,
        });
        const parsed = JSON.parse(result.text);
        steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
      } else {
        // Офлайн-фолбек: статичний приклад на основі введеної ситуації.
        steps = [
          { label: 'Подія', text: event },
          { label: 'Тіло', text: `${name || 'Персонаж'} завмирає на мить, дихання стає поверхневим.` },
          { label: 'Відчуття', text: 'Виникає виразно неприємне відчуття у грудях.' },
          { label: 'Інтерпретація', text: 'Розум одразу читає це як підтвердження давнього побоювання.' },
          { label: 'Імпульс', text: 'Спрацьовує звичний автоматичний сценарій захисту чи контролю.' },
          { label: 'Дія', text: 'Персонаж діє відповідно до цього імпульсу, не помічаючи інших варіантів.' },
          { label: 'Нова подія', text: 'Дія змінює ситуацію — і часто підтверджує початкове побоювання.' },
        ];
      }

      res.json({ steps });
    } catch (err: any) {
      console.error('Error in /api/ai/generate-skandha-cycle:', err);
      res.status(500).json({ error: err.message || 'Помилка побудови циклу реакції персонажа' });
    }
  });

  // 5. Illustration Prompt & Art Generator (Selected Text & Scene)
  /** Людські назви цільових image-моделей — лише текстовий опис усередині промту, не рушій, що ВИКОНУЄ цей запит. */
  const IMAGE_MODEL_ENGINE_LABELS: Record<string, string> = {
    'nano-banana': 'Nano Banana Engine (Gemini / Imagen 3)',
    'leonardo-ai': 'Leonardo.ai (RPG v5 & Photoreal)',
    'midjourney-v6': 'Midjourney v6.1 Photographic',
    'dalle-3': 'DALL-E 3 Precision Studio',
  };

  /**
   * Формує текстовий промпт для генерації ілюстрації з виділеного уривка.
   * Раніше без ключа Gemini мовчки повертав вигаданий промпт, підібраний
   * за наявністю кількох слів у тексті («небо», «вулиця»…) — деталь,
   * непомітна для письменника. Тепер, як і решта ядра, іде через рушій,
   * обраний у чаті: немає ключа для нього — чесна 503, без жодної підміни
   * (Q13/Q18 grilling-сесії).
   */
  app.post('/api/ai/craft-illustration-prompt', async (req, res) => {
    const {
      selectedText,
      model = 'nano-banana',
      stylePreset = 'cyberpunk-photoreal',
      aspectRatio = '16:9',
      genre = 'Кіберпанк / Наукова фантастика',
      bookTitle,
      chapterTitle,
      visualBible,
      modelId,
      bookId,
    } = req.body;

    if (!selectedText || selectedText.trim().length === 0) {
      return res.status(400).json({ error: 'Потрібен фрагмент тексту для аналізу та створення промпту.' });
    }

    const resolved = await resolveTextEngineOrFail(req, res, modelId, 'промпт ілюстрації');
    if (!resolved) return;
    const { engine, resolvedModelId, userKey } = resolved;

    const adminLayer = await loadCoreAdminLayer();
    const template = resolveCoreTemplate('illustrationPromptCraft', adminLayer);
    const rendered = renderCoreTemplate('illustrationPromptCraft', template, {
      selectedText,
      modelLabel: IMAGE_MODEL_ENGINE_LABELS[model] || model,
      stylePreset,
      aspectRatio,
      genre,
      bookTitle,
      chapterTitle,
      visualBibleJson: JSON.stringify(visualBible || { artStyle: stylePreset }),
    });

    try {
      const result = await generateAiText({
        engine,
        modelId: resolvedModelId,
        prompt: rendered.user,
        systemInstruction: rendered.system,
        json: true,
        apiKeyOverride: userKey,
        req,
        label: 'Промпт ілюстрації',
        bookId,
      });
      res.json(parseModelJson(result.text));
    } catch (err: any) {
      console.error('Error in /api/ai/craft-illustration-prompt:', err?.message || err);
      const status = err instanceof ChatProviderError ? err.status : 500;
      res.status(status).json({ error: err?.message || 'Помилка формування промпту для ілюстрації' });
    }
  });

  // 5b. Генерація ілюстрації до фрагмента тексту
  app.post('/api/ai/generate-illustration-art', requirePermission('canGenerateImages'), requireImageQuota(), async (req, res) => {
    try {
      const {
        selectedText,
        prompt: userPrompt,
        engine,
        model,
        stylePreset = 'cyberpunk-photoreal',
        aspectRatio = '16:9',
        genre = 'Кіберпанк / Наукова фантастика',
        bookTitle,
        chapterTitle,
        visualBible,
        /** Рушій ТЕКСТУ для авто-складання промту зі сцени — окремий від `engine`/`model` (рушій самої КАРТИНКИ). */
        textModelId,
      } = req.body;

      let finalPrompt: string = (userPrompt || '').trim();
      const negativePrompt =
        'blurry, low quality, deformed anatomy, watermark, signature, text overlay, cropped, jpeg artifacts';
      let sceneSummaryUa = '';

      // Промпт із фрагмента тексту складає ОБРАНА В ЧАТІ модель (Q18
      // grilling-сесії) — раніше було жорстко прив'язано до Gemini
      // конкретно. Немає ключа для обраного рушія — крок мовчки
      // пропускається (лишається грубий, але ЧЕСНИЙ шаблонний промпт
      // нижче), не фейкова заміна — сама картинка все одно реальна.
      if (!finalPrompt && selectedText) {
        const textResolvedModelId = textModelId || GEMINI_MODEL;
        const textEngine = resolveChatEngine(textResolvedModelId);
        const textUserId = req.principal?.id as string | undefined;
        let textUserKey: string | undefined;
        if (textUserId) {
          const stored = await getUserApiKey(textUserId, textEngine).catch(() => undefined);
          if (stored) {
            try {
              textUserKey = decryptApiKey(stored.encryptedKey);
            } catch {
              /* пробуємо серверний ключ нижче */
            }
          }
        }
        if (textUserKey || engineConfigured(textEngine)) {
          try {
            const crafted = await generateAiText({
              engine: textEngine,
              modelId: textResolvedModelId,
              prompt:
                `Ось фрагмент книги «${bookTitle || ''}»${chapterTitle ? ` (розділ «${chapterTitle}»)` : ''}:\n"""${String(selectedText).slice(0, 1200)}"""\n\n` +
                `Поверни JSON: {"sceneSummaryUa":"1 речення українською про те, що зображено","prompt":"detailed English image prompt, max 90 words"}. ` +
                `Стиль: ${stylePreset}. Жанр: ${genre}.` +
                (visualBible?.artStyle ? ` Visual Bible: ${visualBible.artStyle}.` : '') +
                (visualBible?.lighting ? ` Освітлення: ${visualBible.lighting}.` : ''),
              systemInstruction: 'Ти — концепт-художник і промпт-інженер книжкових ілюстрацій.',
              json: true,
              apiKeyOverride: textUserKey,
              req,
              label: 'Промпт сцени (авто)',
              bookId: req.body?.bookId,
            });
            const parsed = parseModelJson(crafted.text);
            finalPrompt = (parsed.prompt || '').trim();
            sceneSummaryUa = (parsed.sceneSummaryUa || '').trim();
          } catch (e) {
            // нижче спрацює запасний варіант
          }
        }
        if (!finalPrompt) {
          finalPrompt = `Masterpiece cinematic book illustration, ${String(selectedText).slice(0, 120).replace(/[\n\r"]/g, ' ')}, ${stylePreset}, volumetric lighting, high detail`;
        }
      }

      const generated = await generateImageAndLog({
        prompt: finalPrompt,
        engine: engine || model,
        aspectRatio,
        negativePrompt,
        filenameHint: 'scene',
        req,
        label: `Ілюстрація${chapterTitle ? `: ${chapterTitle}` : ''}`,
        bookId: req.body?.bookId,
      });

      res.json({
        imageUrl: generated.url,
        promptUsed: finalPrompt,
        negativePrompt,
        modelUsed: generated.engineLabel,
        modelKey: generated.engineId,
        stylePreset,
        aspectRatio: generated.aspectRatio,
        sceneSummaryUa,
        fileSize: `${Math.round(generated.bytes / 1024)} КБ`,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      const status = err?.kind === 'no_key' ? 503 : err?.kind === 'quota' ? 429 : 500;
      if (err?.cause) console.error('  причина:', (err.cause as Error)?.message || err.cause);
      console.error('Error in /api/ai/generate-illustration-art:', err?.message || err);
      res.status(status).json({
        error: err?.message || 'Помилка генерації ілюстрації',
        kind: err?.kind || 'unknown'
      });
    }
  });

  /** Чи налаштовані двигуни ШІ-тексту за зображенням — щоб клієнт не гадав. */
  app.get('/api/ai/text-engines', (req, res) => {
    res.json(engineAvailability(!!ai));
  });

  // ШІ-текст «за мотивами» зображення: письменницький чернетковий текст,
  // окремо від самої генерації ілюстрацій. Гість сюди не потрапляє —
  // canUseAi для guest/reader вимкнено так само, як для інших AI-функцій.
  app.post('/api/ai/generate-book-text-from-image', requirePermission('canUseAi'), async (req, res) => {
    try {
      const { imageUrl, engine, bookTitle, genre, chapterTitle, captionHint } = req.body || {};
      if (!imageUrl || typeof imageUrl !== 'string') {
        return res.status(400).json({ error: 'Потрібне зображення для аналізу.' });
      }
      const chosenEngine = engine === 'gpt' ? 'gpt' : 'gemini';

      const result = await generateTextFromImage(ai, GEMINI_MODEL, {
        engine: chosenEngine,
        imageUrl,
        bookTitle,
        genre,
        chapterTitle,
        captionHint,
      });

      // Логування (і ціна за фактично витраченими токенами) — через ядро,
      // єдине місце для всіх AI-викликів продукту.
      await recordTextUsageByModel(
        req,
        `Текст за зображенням${chapterTitle ? `: ${chapterTitle}` : ''}`,
        result.model,
        result.usage.inputTokens,
        result.usage.outputTokens,
        true,
        req.body?.bookId
      ).catch((e) => console.warn('[usage] textFromImage:', e));

      res.json({ text: result.text, engine: result.engine, model: result.model, timestamp: new Date().toISOString() });
    } catch (err: any) {
      const kind = err instanceof TextFromImageError ? err.kind : 'unknown';
      const status = kind === 'no_key' ? 503 : kind === 'quota' ? 429 : kind === 'bad_image' ? 400 : 500;
      const failedEngine = err instanceof TextFromImageError ? err.engine : (req.body?.engine === 'gpt' ? 'gpt' : 'gemini');
      await recordTextUsageByModel(
        req,
        `Невдала спроба (${kind})`,
        failedEngine === 'gpt' ? (process.env.OPENAI_MODEL || 'gpt-4o') : GEMINI_MODEL,
        0,
        0,
        false,
        req.body?.bookId
      ).catch((e) => console.warn('[usage] textFromImage (fail):', e));
      console.error('Error in /api/ai/generate-book-text-from-image:', err?.message || err);
      res.status(status).json({ error: err?.message || 'Не вдалося згенерувати текст за зображенням.', kind });
    }
  });

  /**
   * «Проаналізувати фото і згенерувати AI текст книги» — правий клік на
   * зображенні прямо в редакторі розділу (WrappedImageNode.tsx). На відміну
   * від /api/ai/generate-book-text-from-image (вище — окреме вікно на
   * вкладці «Ілюстрації», лише Gemini/GPT, лише українською), тут:
   *   • рушій — той самий `modelId`, що востаннє обраний у чат-асистенті
   *     (book.preferredAiModelId, EditorView.tsx сам передає його як є) —
   *     єдиний "рушій книги" для всього AI-ядра;
   *   • підтримує всі vision-рушії ядра (Gemini/GPT/Claude — VISION_ENGINES
   *     у server/chatProviders.ts), не лише два;
   *   • власний ключ автора (розділ «Ключі API») йде в запит замість
   *     серверного, як і в чаті (generateChatReply вище);
   *   • мова (uk/en) і кількість абзаців (1-3) — параметри, не вшиті;
   *   • промпт спирається на файл стилю автора (user_styles, якщо ввімкнено
   *     «Автоматично використовувати стиль» — та сама умова, що й у чаті,
   *     див. loadStyleGuide нижче) і на абзаци тексту одразу до/після
   *     зображення (contextBefore/contextAfter — EditorView.tsx сам витягує
   *     їх із сусідніх вузлів документа перед відправкою запиту).
   */
  // --- Конструктор промтів (вкладка в AI-асистенті) ---
  //
  // Доступ: адміністратор і автори на Pro/Ultra. Гість і Free бачать
  // заглушку на клієнті, але саму генерацію 1/2/3 абзаци не втрачають —
  // вона просто йде на адмінському дефолті.

  /** Чи має цей запит право РЕДАГУВАТИ шаблони (і чи читати його власний шар при генерації). */
  async function canEditPromptTemplates(req: express.Request): Promise<boolean> {
    const principal = req.principal;
    if (!principal || principal.isGuest || !principal.id) return false;
    if (principal.role === 'admin') return true;
    try {
      const sub = await resolveSubscription(principal.id);
      return sub.plan === 'pro' || sub.plan === 'ultra';
    } catch {
      return false;
    }
  }

  const parseLayer = (raw: string | undefined): PromptTemplateBundle | undefined => {
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as PromptTemplateBundle;
    } catch {
      // Зіпсований JSON у сховищі не має ламати генерацію — просто
      // поводимось так, ніби цього шару немає.
      return undefined;
    }
  };

  const loadUserPromptLayer = async (userId: string) => parseLayer(await getUserPromptTemplates(userId));
  const loadAdminPromptLayer = async () => parseLayer(await getAppSetting(PROMPT_TEMPLATES_META_KEY));

  /**
   * Один шаблон, присланий клієнтом разом із запитом на генерацію.
   * Порожній (обидва поля порожні) — це не шаблон: повертаємо undefined,
   * щоб виклик відкотився на збережені шари, а не пішов у модель з
   * порожнім промптом.
   */
  function sanitizeTemplate(input: unknown): { system: string; user: string } | undefined {
    const tpl = input as { system?: unknown; user?: unknown } | undefined;
    if (!tpl || typeof tpl !== 'object') return undefined;
    const system = String(tpl.system ?? '').slice(0, MAX_TEMPLATE_CHARS).trim();
    const user = String(tpl.user ?? '').slice(0, MAX_TEMPLATE_CHARS).trim();
    if (!system && !user) return undefined;
    return { system, user };
  }

  /** Обрізає всі поля до стелі довжини — промпт оплачується токенами. */
  function sanitizeBundle(input: unknown): PromptTemplateBundle {
    const out: PromptTemplateBundle = {};
    const src = (input as PromptTemplateBundle)?.manuscriptPhoto;
    if (!src || typeof src !== 'object') return out;
    const set: Record<string, { system: string; user: string }> = {};
    for (const key of ['1', '2', '3'] as const) {
      const tpl = (src as Record<string, { system?: unknown; user?: unknown }>)[key];
      if (!tpl || typeof tpl !== 'object') continue;
      set[key] = {
        system: String(tpl.system ?? '').slice(0, MAX_TEMPLATE_CHARS),
        user: String(tpl.user ?? '').slice(0, MAX_TEMPLATE_CHARS),
      };
    }
    if (Object.keys(set).length) out.manuscriptPhoto = set as PromptTemplateBundle['manuscriptPhoto'];
    return out;
  }

  /**
   * Віддає зведені шаблони (автор → адмін → заводський) разом із тим, що
   * потрібно конструктору для чесного інтерфейсу: чи можна редагувати,
   * чи є власний шар, який шар зараз діє, і список плейсхолдерів.
   */
  app.get('/api/ai/prompt-templates', async (req, res) => {
    const principal = req.principal;
    const canEdit = await canEditPromptTemplates(req);
    const isAdmin = principal?.role === 'admin';
    const adminLayer = await loadAdminPromptLayer();
    const userLayer = principal?.id && canEdit ? await loadUserPromptLayer(principal.id) : undefined;

    // Адмін у конструкторі редагує ГЛОБАЛЬНИЙ шар, автор — свій власний.
    const editableLayer = isAdmin ? adminLayer : userLayer;

    res.json({
      canEdit,
      isAdmin,
      hasOwnLayer: !!editableLayer?.manuscriptPhoto,
      placeholders: PLACEHOLDERS,
      maxChars: MAX_TEMPLATE_CHARS,
      factory: factoryTemplateSet(),
      // Те, що реально піде в модель прямо зараз.
      effective: {
        '1': resolveTemplate(1, userLayer, adminLayer),
        '2': resolveTemplate(2, userLayer, adminLayer),
        '3': resolveTemplate(3, userLayer, adminLayer),
      },
    });
  });

  /** Зберігає шаблони: адміну — в глобальний шар, авторові Pro/Ultra — у власний. */
  app.put('/api/ai/prompt-templates', async (req, res) => {
    const principal = req.principal;
    if (!(await canEditPromptTemplates(req)) || !principal?.id) {
      return res.status(403).json({
        error: 'Конструктор промтів доступний адміністратору та авторам на тарифах Pro і Ultra.',
        kind: 'plan_required',
      });
    }

    const bundle = sanitizeBundle(req.body?.templates);
    const payload = JSON.stringify(bundle);

    if (principal.role === 'admin') {
      await setAppSetting(PROMPT_TEMPLATES_META_KEY, payload);
    } else {
      await upsertUserPromptTemplates(principal.id, payload);
    }
    res.json({ ok: true, scope: principal.role === 'admin' ? 'admin' : 'user' });
  });

  /** «Відновити налаштування адміна» — прибирає власний шар автора цілком. */
  app.delete('/api/ai/prompt-templates', async (req, res) => {
    const principal = req.principal;
    if (!(await canEditPromptTemplates(req)) || !principal?.id) {
      return res.status(403).json({ error: 'Немає доступу до конструктора промтів.', kind: 'plan_required' });
    }
    if (principal.role === 'admin') {
      // Для адміна «відновити» означає повернутись до ЗАВОДСЬКОГО шаблону.
      await setAppSetting(PROMPT_TEMPLATES_META_KEY, JSON.stringify({}));
    } else {
      await deleteUserPromptTemplates(principal.id);
    }
    res.json({ ok: true });
  });

  // --- «Ядро AI» — третя вкладка конструктора промтів, ВИКЛЮЧНО для
  // адміна (requireAdmin). На відміну від решти двох вкладок, тут немає
  // шару автора взагалі — 7 модулів ядра тюнить лише адмін, і його правки
  // одразу впливають на реальні виклики решти сайту (Q6 grilling-сесії). ---

  async function loadCoreAdminLayer(): Promise<CorePromptTemplateBundle | undefined> {
    const raw = await getAppSetting(CORE_PROMPT_TEMPLATES_META_KEY);
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as CorePromptTemplateBundle;
    } catch {
      return undefined;
    }
  }

  function isCoreModuleKey(value: unknown): value is CoreModuleKey {
    return typeof value === 'string' && (CORE_MODULE_KEYS as readonly string[]).includes(value);
  }

  /** Список модулів + заводські й чинні (заводський ⊕ адмінський шар) шаблони кожного — для першого рендеру конструктора. */
  app.get('/api/ai/core-prompt-templates', requireAdmin, async (req, res) => {
    const adminLayer = await loadCoreAdminLayer();
    const factory = factoryCoreTemplateBundle();
    const effective: Record<string, { system: string; user: string }> = {};
    // Для JSON-модулів клієнт отримує SYSTEM уже розділеним на редаговану
    // частину й readonly-схему (Q9 grilling-сесії) — щоб не дублювати
    // логіку розділення на фронтенді. schemaSuffix однаковий для factory й
    // effective (схема завжди заводська), тож рахуємо один раз.
    const schemaSuffix: Record<string, string> = {};
    for (const key of CORE_MODULE_KEYS) {
      effective[key] = resolveCoreTemplate(key, adminLayer);
      if (CORE_MODULE_HAS_JSON_SCHEMA[key]) {
        const { editable, schema } = splitAtSchemaMarker(effective[key].system);
        effective[key] = { ...effective[key], system: editable };
        schemaSuffix[key] = schema;
        factory[key] = { ...factory[key], system: splitAtSchemaMarker(factory[key].system).editable };
      }
    }

    res.json({
      modules: CORE_MODULE_KEYS,
      placeholders: CORE_MODULE_PLACEHOLDERS,
      hasJsonSchema: CORE_MODULE_HAS_JSON_SCHEMA,
      maxChars: CORE_MAX_TEMPLATE_CHARS,
      factory,
      effective,
      schemaSuffix,
      hasAdminLayer: !!adminLayer && Object.keys(adminLayer).length > 0,
    });
  });

  /** Зберігає шаблон ОДНОГО модуля — read-merge-write, щоб не вимагати від клієнта пересилати всі 7 модулів щоразу. */
  app.put('/api/ai/core-prompt-templates', requireAdmin, async (req, res) => {
    const { module, template } = req.body || {};
    if (!isCoreModuleKey(module)) {
      return res.status(400).json({ error: `Невідомий модуль ядра: ${module}`, kind: 'bad_input' });
    }
    // stripSchemaForStorage: навіть якщо клієнт (чи прямий запит до API,
    // повз readonly-поле в UI) прислав системний промпт ІЗ переписаною
    // схемою, усе після маркера відкидається тут — схема завжди
    // повертається з заводського тексту (server/coreAiRegistry.ts::resolveCoreTemplate).
    const system = stripSchemaForStorage(module, String(template?.system ?? '').slice(0, CORE_MAX_TEMPLATE_CHARS)).trim();
    const user = String(template?.user ?? '').slice(0, CORE_MAX_TEMPLATE_CHARS).trim();

    const current = (await loadCoreAdminLayer()) || {};
    const updated: CorePromptTemplateBundle = { ...current, [module]: { system, user } };
    await setAppSetting(CORE_PROMPT_TEMPLATES_META_KEY, JSON.stringify(updated));
    res.json({ ok: true, module });
  });

  /** «Відновити заводський шаблон» — для ОДНОГО модуля (query ?module=…) або для всіх одразу, якщо параметр не заданий. */
  app.delete('/api/ai/core-prompt-templates', requireAdmin, async (req, res) => {
    const moduleParam = req.query.module;
    if (moduleParam !== undefined && !isCoreModuleKey(moduleParam)) {
      return res.status(400).json({ error: `Невідомий модуль ядра: ${moduleParam}`, kind: 'bad_input' });
    }
    if (!moduleParam) {
      await setAppSetting(CORE_PROMPT_TEMPLATES_META_KEY, JSON.stringify({}));
      return res.json({ ok: true });
    }
    const moduleKey = moduleParam as CoreModuleKey;
    const current = (await loadCoreAdminLayer()) || {};
    delete current[moduleKey];
    await setAppSetting(CORE_PROMPT_TEMPLATES_META_KEY, JSON.stringify(current));
    res.json({ ok: true, module: moduleKey });
  });

  /**
   * Тестовий виклик — РЕАЛЬНИЙ запит до моделі (Q11/Q14 grilling-сесії), не
   * текстовий прев'ю: адмін підправляє шаблон і одразу бачить, як модель
   * реально відповідає, з тестовими вхідними даними, які він сам вписав
   * (URL фото, тестовий фрагмент рукопису, синопсис тощо). Мітка
   * `Тест ядра AI: …` не змішує ці виклики зі справжньою активністю
   * користувачів у графіках витрат.
   */
  app.post('/api/ai/core-prompt-templates/test-call', requireAdmin, async (req, res) => {
    const { module, template, fields, modelId } = req.body || {};
    if (!isCoreModuleKey(module)) {
      return res.status(400).json({ error: `Невідомий модуль ядра: ${module}`, kind: 'bad_input' });
    }
    // Клієнт шле лише РЕДАГОВАНУ частину system (UI показує схему окремим
    // readonly-блоком, поза текстовим полем) — тут дописуємо заводську
    // схему назад, тим самим механізмом, що й resolveCoreTemplate.
    const draftSystemInput = String(template?.system ?? '').slice(0, CORE_MAX_TEMPLATE_CHARS);
    const draftSystem = CORE_MODULE_HAS_JSON_SCHEMA[module]
      ? (() => {
          const editable = stripSchemaForStorage(module, draftSystemInput).trim();
          const { schema } = splitAtSchemaMarker(factoryCoreTemplate(module).system);
          return editable ? `${editable}\n\n${schema}` : factoryCoreTemplate(module).system;
        })()
      : draftSystemInput;
    const draft = {
      system: draftSystem,
      user: String(template?.user ?? '').slice(0, CORE_MAX_TEMPLATE_CHARS),
    };
    const fieldsObj: Record<string, string | undefined> =
      fields && typeof fields === 'object' ? fields : {};

    const resolved = await resolveTextEngineOrFail(req, res, modelId, `тест ядра AI: ${module}`);
    if (!resolved) return;
    const { engine, resolvedModelId, userKey } = resolved;

    // «Текст за фото» — vision-модуль: без самого зображення тестовий
    // виклик перевіряє лише половину промту. Адмін обирає фото з
    // медіатеки книги на клієнті, сюди приходить готовий URL.
    let testImages: ImageAttachment[] | undefined;
    if (module === 'textFromImage' && fieldsObj.imageUrl) {
      if (!VISION_ENGINES.has(engine)) {
        return res.status(400).json({
          error: `Рушій «${ENGINE_LABELS[engine]}» не аналізує зображення. Оберіть Gemini, GPT-4o або модель Claude.`,
          kind: 'vision_unsupported',
        });
      }
      try {
        const { mimeType, base64 } = await resolveImageBytes(fieldsObj.imageUrl);
        testImages = [{ mimeType, dataBase64: base64 }];
      } catch (err: any) {
        return res.status(400).json({ error: err?.message || 'Не вдалося прочитати зображення для тесту.' });
      }
    }

    const rendered = renderCoreTemplate(module, draft, fieldsObj);

    // Чат: 'user' у CorePromptTemplate — завжди заглушка протоколу
    // (CHAT_USER_FIELD_PLACEHOLDER), її не можна слати в модель як
    // реальний промпт. Для тестового виклику будуємо СПРАВЖНІЙ промпт тим
    // самим buildPromptContext, що й production-чат — з тестовою
    // реплікою автора, яку адмін вписав у полі fields.testMessage.
    const testPrompt =
      module === 'chat'
        ? buildPromptContext(
            fieldsObj.prevAssistantReply
              ? [{ role: 'assistant' as const, content: fieldsObj.prevAssistantReply }]
              : [],
            fieldsObj.testMessage || 'Привіт! Як просувається робота над романом?'
          )
        : rendered.user;

    try {
      const result = await generateAiText({
        engine,
        modelId: resolvedModelId,
        prompt: testPrompt,
        systemInstruction: rendered.system,
        images: testImages,
        apiKeyOverride: userKey,
        req,
        label: `Тест ядра AI: ${module}`,
      });
      const costUsd = priceForTextEngine(engine, result.inputTokens, result.outputTokens, resolvedModelId);
      res.json({
        text: result.text,
        renderedSystem: rendered.system,
        renderedUser: testPrompt,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd,
        engine,
        modelId: resolvedModelId,
      });
    } catch (err: any) {
      console.error(`Error in /api/ai/core-prompt-templates/test-call (${module}):`, err?.message || err);
      const status = err instanceof ChatProviderError ? err.status : 500;
      res.status(status).json({ error: err?.message || 'Тестовий виклик не вдався.' });
    }
  });

  app.post('/api/ai/generate-manuscript-paragraphs-from-image', requirePermission('canUseAi'), async (req, res) => {
    const { imageUrl, modelId, paragraphCount, language, bookTitle, genre, chapterTitle, bookId, contextBefore, contextAfter, imageCaption } =
      req.body || {};
    const engine = resolveChatEngine(modelId || GEMINI_MODEL);
    const resolvedModelId = modelId || GEMINI_MODEL;
    try {
      if (!imageUrl || typeof imageUrl !== 'string') {
        return res.status(400).json({ error: 'Потрібне зображення для аналізу.' });
      }
      const count = [1, 2, 3].includes(paragraphCount) ? paragraphCount : 1;
      const lang = language === 'en' ? 'en' : 'uk';

      if (!VISION_ENGINES.has(engine)) {
        return res.status(400).json({
          error: `Рушій книги «${ENGINE_LABELS[engine]}» не аналізує зображення. Оберіть Gemini, GPT-4o або модель Claude.`,
          kind: 'vision_unsupported',
        });
      }

      const userId = req.principal?.id as string | undefined;
      let userKey: string | undefined;
      if (userId) {
        const stored = await getUserApiKey(userId, engine).catch(() => undefined);
        if (stored) {
          try {
            userKey = decryptApiKey(stored.encryptedKey);
          } catch (err) {
            console.warn('[manuscript-image-text] не вдалося розшифрувати ключ користувача, пробуємо серверний:', err);
          }
        }
      }
      if (!userKey && !engineConfigured(engine)) {
        return res.status(503).json({
          error: `Рушій «${ENGINE_LABELS[engine]}» не налаштований: додайте ${ENGINE_ENV_KEY[engine]} у .env сервера або власний ключ у розділі «Ключі API».`,
          kind: 'no_key',
        });
      }

      // Файл стилю автора — та сама умова, що й у чат-асистенті
      // (loadStyleGuide, реєстрація чат-роутів вище): підмішується в промпт
      // лише якщо письменник сам увімкнув «Автоматично використовувати
      // стиль», інакше файл стилю міг існувати як чернетка, ще не готова
      // бути «голосом» автора за замовчуванням.
      let styleGuide: string | undefined;
      if (userId) {
        const style = await getUserStyle(userId).catch(() => undefined);
        if (style?.autoUseStyle && style.contentMd) styleGuide = style.contentMd;
      }

      // Промпт складається з шаблону «Конструктора промтів»: шар автора →
      // шар адміна → заводський. Автор без підписки Pro/Ultra шаблон
      // редагувати не може, тож і його шар не читаємо: генерація йде на
      // адмінському дефолті (узгоджено — шаблон лишається недоторканим у
      // БД до поновлення підписки). Гість не має user_id взагалі й падає
      // на заводський шлях.
      const placeholderValues = {
        language: lang as 'uk' | 'en',
        paragraphCount: count as 1 | 2 | 3,
        bookTitle,
        genre,
        chapterTitle,
        imageCaption: typeof imageCaption === 'string' ? imageCaption : undefined,
        styleGuide,
        contextBefore: typeof contextBefore === 'string' ? contextBefore : undefined,
        contextAfter: typeof contextAfter === 'string' ? contextAfter : undefined,
      };

      // Шаблон приходить З КЛІЄНТА (він щойно завантажив його з
      // /api/ai/prompt-templates), а сервер підставляє в нього те, чого
      // клієнт не бачить: файл стилю автора з user_styles. Приймаємо
      // присланий шаблон лише від того, хто взагалі має право його
      // редагувати — інакше Free-автор міг би обійти тарифне обмеження,
      // просто підклавши свій текст у запит.
      const mayUseOwnTemplate = await canEditPromptTemplates(req);
      const sentTemplate = mayUseOwnTemplate ? sanitizeTemplate(req.body?.promptTemplate) : undefined;

      const { system: systemPrompt, user: userPrompt } = userId
        ? buildPromptFromTemplate(
            sentTemplate ??
              resolveTemplate(
                count as 1 | 2 | 3,
                mayUseOwnTemplate ? await loadUserPromptLayer(userId) : undefined,
                await loadAdminPromptLayer()
              ),
            placeholderValues
          )
        : buildFactoryPrompt(placeholderValues);

      const { mimeType, base64 } = await resolveImageBytes(imageUrl);
      const result = await generateAiText({
        engine,
        modelId: resolvedModelId,
        prompt: userPrompt,
        systemInstruction: systemPrompt,
        apiKeyOverride: userKey,
        images: [{ mimeType, dataBase64: base64 }],
        req,
        label: `AI-текст за фото (редактор)${chapterTitle ? `: ${chapterTitle}` : ''}`,
        bookId,
      });

      res.json({ text: result.text, engine, modelId: resolvedModelId, timestamp: new Date().toISOString() });
    } catch (err: any) {
      console.error('Error in /api/ai/generate-manuscript-paragraphs-from-image:', err?.message || err);
      if (err instanceof ChatProviderError) {
        return res.status(err.status).json({ error: err.message });
      }
      const kind = err instanceof TextFromImageError ? err.kind : 'unknown';
      const status = kind === 'no_key' ? 503 : kind === 'quota' ? 429 : kind === 'bad_image' ? 400 : 500;
      res.status(status).json({ error: err?.message || 'Не вдалося згенерувати текст за зображенням.', kind });
    }
  });

  // --- Форматування готового файлу під Amazon KDP (Claude API, Pro/Ultra) ---

  /** Чи налаштовано Anthropic-ключ — щоб клієнт показав чесний стан кнопки, а не 503 після завантаження файлу. */
  app.get('/api/ai/claude-engine', (req, res) => {
    res.json({ available: anthropicConfig.enabled, model: anthropicConfig.model, maxChars: MAX_MANUSCRIPT_CHARS });
  });

  // Окремий інструмент від решти книги: приймає текст уже готового рукопису
  // (клієнт сам витягує його з .docx/.txt перед відправкою) і повертає
  // структуровані глави, очищені від артефактів форматування, для подальшого
  // друку в KDP-сумісний PDF на клієнті (той самий механізм print → Save as PDF,
  // що й решта експортів книги). Доступно лише Pro/Ultra — requirePlanAtLeast.
  app.post(
    '/api/ai/format-manuscript',
    requirePermission('canUseAi'),
    requirePlanAtLeast(['pro', 'ultra']),
    async (req, res) => {
      try {
        const { text, bookTitle, author, genre } = req.body || {};
        if (!text || typeof text !== 'string' || !text.trim()) {
          return res.status(400).json({ error: 'Потрібен текст рукопису для форматування.' });
        }

        const result = await formatManuscriptWithClaude({ text, bookTitle, author, genre });

        // recordTextUsageByModel передає result.model у priceForTextEngine,
        // тож Claude Opus/Haiku тарифікуються за своєю реальною ціною, а не
        // за замовчуванням Sonnet (як робив старий прямий виклик тут).
        await recordTextUsageByModel(
          req,
          `Форматування файлу під KDP${bookTitle ? `: ${bookTitle}` : ''}`,
          result.model,
          result.usage.inputTokens,
          result.usage.outputTokens,
          true,
          req.body?.bookId
        ).catch((e) => console.warn('[usage] format-manuscript:', e));

        res.json({
          chapters: result.chapters,
          notes: result.notes,
          model: result.model,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        const kind = err instanceof ClaudeManuscriptError ? err.kind : 'unknown';
        const status =
          kind === 'no_key' ? 503 : kind === 'quota' ? 429 : kind === 'bad_input' || kind === 'too_long' ? 400 : 500;

        await recordTextUsageByModel(
          req,
          `Невдала спроба (${kind})`,
          anthropicConfig.model,
          0,
          0,
          false,
          req.body?.bookId
        ).catch((e) => console.warn('[usage] format-manuscript (fail):', e));

        console.error('Error in /api/ai/format-manuscript:', err?.message || err);
        res.status(status).json({ error: err?.message || 'Не вдалося відформатувати рукопис.', kind });
      }
    }
  );

  // Legacy prompt generator backward compatibility
  app.post('/api/ai/generate-prompt', async (req, res) => {
    try {
      const { text, sceneContext, visualBible, style } = req.body;
      const prompt = `Ти — провідний AI Prompt Engineer для генерації книжкових ілюстрацій найвищої якості.
На основі фрагмента тексту та Visual Bible створи ідеальний детальний English Prompt для Image Generation.

Текст сцени:
"""${text}"""

Стиль Visual Bible: ${JSON.stringify(visualBible || {})}
Бажаний художній стиль: ${style || 'cinematic'}

Поверни JSON:
{
  "prompt": "Masterpiece English prompt with detailed lighting, composition, colors, 8k, photorealistic...",
  "negativePrompt": "blurry, low quality, distorted anatomy, extra limbs, watermark, text",
  "suggestedStyle": "${style || 'cinematic'}",
  "colorPalette": ["#0ea5e9", "#6366f1", "#0f172a"],
  "sceneSummaryUa": "Короткий опис сцени українською"
}`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(prompt, 'Ти — експерт концепт-арту та компʼютерної графіки.', true, {
          req,
          label: 'Промпт (legacy)',
        });
        result = JSON.parse(raw);
      } else {
        result = {
          prompt: `Cinematic digital concept art of futuristic Neo-Kyiv glass towers reflecting ethereal sunrise, glowing iridescent bridges over river, floating cargo drones, ultra-detailed 8k masterpiece, Nova Glass style, volumetric fog, octane render`,
          negativePrompt: 'blurry, low quality, distorted, watermark, signature, oversaturated',
          suggestedStyle: style || 'cinematic',
          colorPalette: ['#0ea5e9', '#6366f1', '#f43f5e', '#0f172a'],
          sceneSummaryUa: 'Панорамний світанок над скляним мегаполісом Нео-Києвом'
        };
      }

      res.json(result);
    } catch (err: any) {
      console.error('Error in /api/ai/generate-prompt:', err);
      res.status(500).json({ error: err.message || 'Помилка створення промпту' });
    }
  });

  // 6. Cover Concept Generator
  app.post('/api/ai/generate-cover', async (req, res) => {
    try {
      const { title, genre, synopsis, author, visualBible } = req.body;
      const prompt = `Створи концепцію поліграфічної обкладинки для книги:
Назва: ${title}
Автор: ${author}
Жанр: ${genre}
Синопсис: ${synopsis}
Visual Bible: ${JSON.stringify(visualBible || {})}

Поверни JSON:
{
  "frontTitle": "${title}",
  "subtitle": "Привабливий комерційний підзаголовок українською",
  "tagline": "Потужний слоган для лицьової сторони",
  "backDescription": "Захоплива анотація для задньої сторони обкладинки (back cover)",
  "authorBio": "Коротка біографія автора для обкладинки",
  "visualPrompt": "Detailed English image prompt for the cover artwork",
  "palette": ["#0369a1", "#1e1b4b", "#06b6d4", "#f1f5f9"],
  "recommendedTypography": "Outfit for display + Literata for body",
  "spineWidthCalculatedMm": 15.2
}`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(prompt, 'Ти — арт-директор та провідний дизайнер книжкових обкладинок видавництва.', true, {
          req,
          label: 'Концепція обкладинки',
        });
        result = JSON.parse(raw);
      } else {
        result = {
          frontTitle: title || 'ТІНІ НЕО-КИЄВА 2084',
          subtitle: 'ХРОНІКИ ЗАБУТОГО КОДУ',
          tagline: 'Коли памʼять стає зброєю, правда залишається єдиним порятунком.',
          backDescription: 'У трирівневому Нео-Києві технології досягли божественного рівня, але людське серце все ще шукає свободи. Заборонений кристал консула приховує таємницю, здатну знищити корпоративну імперію «Прометій-Квант».',
          authorBio: `${author || 'Олександр Радченко'} — український письменник-фантаст, чиї світи поєднують філософську глибину та гостросюжетний драйв.`,
          visualPrompt: 'Breathtaking cyberpunk book cover, holographic neural city map, crystal glass silhouette of female architect, vibrant glowing turquoise and deep violet neon, sleek typography layout, 8k resolution',
          palette: ['#0284c7', '#0f172a', '#38bdf8', '#e0f2fe'],
          recommendedTypography: 'Outfit Bold for Main Title + JetBrains Mono for metadata',
          spineWidthCalculatedMm: 16.4
        };
      }

      res.json(result);
    } catch (err: any) {
      console.error('Error in /api/ai/generate-cover:', err);
      res.status(500).json({ error: err.message || 'Помилка генерації обкладинки' });
    }
  });

  // 6b. Малюнок для лицьової сторони обкладинки за концепцією з /generate-cover
  app.post('/api/ai/generate-cover-art', requirePermission('canGenerateImages'), requireImageQuota(), async (req, res) => {
    try {
      const { visualPrompt, title, genre, engine, model, aspectRatio = '3:4', visualBible } = req.body;

      const prompt = (visualPrompt || '').trim() ||
        [
          `Book cover artwork for "${title || 'a novel'}"`,
          genre ? `genre: ${genre}` : '',
          visualBible?.artStyle ? `visual aesthetic: ${visualBible.artStyle}` : '',
          visualBible?.mood ? `mood: ${visualBible.mood}` : '',
          'striking central composition, dramatic lighting, poster-quality, no text, no lettering'
        ].filter(Boolean).join(', ');

      const generated = await generateImageAndLog({
        prompt,
        engine: engine || model,
        aspectRatio,
        // Текст на обкладинці малює верстка, а не модель.
        negativePrompt: 'text, letters, title, typography, watermark, signature, frame, border',
        filenameHint: 'cover',
        req,
        label: `Обкладинка: ${title || 'книга'}`,
        bookId: req.body?.bookId,
      });

      res.json({
        imageUrl: generated.url,
        promptUsed: prompt,
        modelUsed: generated.engineLabel,
        modelKey: generated.engineId,
        aspectRatio: generated.aspectRatio,
        fileSize: `${Math.round(generated.bytes / 1024)} КБ`,
        timestamp: new Date().toISOString()
      });
    } catch (err: any) {
      const status = err?.kind === 'no_key' ? 503 : err?.kind === 'quota' ? 429 : 500;
      if (err?.cause) console.error('  причина:', (err.cause as Error)?.message || err.cause);
      console.error('Error in /api/ai/generate-cover-art:', err?.message || err);
      res.status(status).json({
        error: err?.message || 'Помилка генерації обкладинки',
        kind: err?.kind || 'unknown'
      });
    }
  });

  // -----------------------------------------------------------------------
  // Аналіз компетентностей у тексті (хвиля 1, завдання 4).
  //
  // Один ендпойнт живить і підсвітку маркерів у редакторі, і показники
  // глави, і зрізи для порівнянь «до/після». Перелік показників приходить
  // з клієнта (каталог src/data/skillMarkers.ts), щоб критерії були в
  // одному місці, а не дублювалися в промпті.
  //
  // Кешування — на клієнті за хешем тексту (utils/competenceAnalysis.ts):
  // без нього кожне відкриття глави означало б новий платний виклик.
  // -----------------------------------------------------------------------
  app.post('/api/ai/analyze-text-competences', async (req, res) => {
    try {
      const { text, bookContext, skills } = req.body;
      if (!text || !text.trim()) {
        return res.json({ markers: [], skillScores: {} });
      }
      if (!Array.isArray(skills) || skills.length === 0) {
        return res.status(400).json({ error: 'Не передано перелік показників для аналізу.' });
      }

      const skillLines = skills
        .map((s: any) => `- ${s.id} (${s.title}): шукати — ${(s.looksFor || []).join('; ')}`)
        .join('\n');

      const systemPrompt = `Ти — редактор-аналітик художньої та документальної прози.
Твоє завдання — показати, як письменницькі компетентності проявляються В САМОМУ ТЕКСТІ.

Роби дві речі.

1) Знайди фрагменти-маркери. Типи:
   thesis — теза; argument — аргумент; example — приклад; conflict — конфлікт;
   emotional_peak — емоційна кульмінація; plot_turn — поворот сюжету; description — опис.
   Для кожного маркера цитуй фрагмент ДОСЛІВНО, без змін, 3–20 слів.

2) Оціни кожен показник від 0 до 100 за наведеними критеріями.
   Оцінюй лише за наявним текстом, не додумуй книгу цілком.
   Будь стриманим: 50 — це нормальний робочий рівень, 80+ лише за явних доказів.

Показники:
${skillLines}

Поверни СУВОРО такий JSON:
{
  "markers": [
    { "id": "m1", "type": "conflict", "quote": "дослівна цитата з тексту",
      "confidence": 0.82, "note": "чому це саме цей маркер, одне речення" }
  ],
  "skillScores": { "<id показника>": 0-100 }
}
Ключі в skillScores — рівно ті id, що подані вище. Нічого не вигадуй понад них.`;

      const ctx = bookContext || {};
      const userPrompt = `Контекст книги: жанр — ${ctx.genre || 'не вказано'}; логлайн — ${ctx.logline || 'не вказано'}; тема — ${ctx.theme || 'не вказано'}.

Текст для аналізу:
"""${text}"""`;

      let responseData: any;
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: 'Аналіз компетентностей тексту',
        });
        responseData = JSON.parse(raw);
      } else {
        // Демо-режим без ключа: показуємо структуру відповіді на реальних
        // фрагментах тексту, щоб інтерфейс можна було перевірити без API.
        const sentences = String(text)
          .split(/(?<=[.!?…])\s+/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 25);

        const pick = (i: number) => sentences[i % Math.max(sentences.length, 1)] || '';
        responseData = {
          markers: sentences.length
            ? [
                { id: 'm-demo-1', type: 'description', quote: pick(0).slice(0, 120), confidence: 0.6, note: 'Демо-режим: перше розгорнуте речення фрагмента.' },
                { id: 'm-demo-2', type: 'conflict', quote: pick(1).slice(0, 120), confidence: 0.45, note: 'Демо-режим: потенційна точка напруги.' },
              ]
            : [],
          skillScores: Object.fromEntries(
            skills.map((s: any, i: number) => [s.id, 45 + ((i * 7) % 25)])
          ),
        };
      }

      // Захист від «творчості» моделі: лишаємо тільки ті показники, які
      // справді просив клієнт, і тільки цитати, що є в тексті.
      const allowed = new Set(skills.map((s: any) => s.id));
      const cleanScores: Record<string, number> = {};
      Object.entries(responseData.skillScores || {}).forEach(([k, v]) => {
        if (!allowed.has(k)) return;
        const n = Number(v);
        if (Number.isFinite(n)) cleanScores[k] = Math.max(0, Math.min(100, Math.round(n)));
      });

      const cleanMarkers = (Array.isArray(responseData.markers) ? responseData.markers : [])
        .filter((m: any) => m && typeof m.quote === 'string' && text.includes(m.quote))
        .map((m: any, i: number) => ({
          id: m.id || `m-${i + 1}`,
          type: m.type,
          quote: m.quote,
          offset: text.indexOf(m.quote),
          length: m.quote.length,
          confidence: Math.max(0, Math.min(1, Number(m.confidence) || 0.5)),
          note: m.note || '',
        }));

      res.json({ markers: cleanMarkers, skillScores: cleanScores });
    } catch (err: any) {
      console.error('Error in /api/ai/analyze-text-competences:', err);
      res.status(500).json({ error: err.message || 'Помилка аналізу компетентностей' });
    }
  });

  // 7. Writer Mastery: Task Evaluation with AI Mentor
  app.post('/api/ai/evaluate-skill-task', async (req, res) => {
    try {
      const { task, userAnswer, bookContext } = req.body;
      if (!userAnswer || !userAnswer.trim()) {
        return res.status(400).json({ error: 'Потрібна відповідь автора для аналізу.' });
      }

      const prompt = `Ти — мудрий, підтримуючий, але прискіпливий AI-наставник письменника («Цифрова майстерня письменника»).
Проаналізуй виконання практичного завдання автором для його книги.

КОНТЕКСТ КНИГИ:
${JSON.stringify(bookContext || {}, null, 2)}

ПРАКТИЧНЕ ЗАВДАННЯ:
- Назва: ${task?.title || 'Практичне завдання'}
- Навичка: ${task?.skillName || 'Письменницька навичка'}
- Категорія: ${task?.category || 'Майстерність'}
- Мета: ${task?.goal || ''}
- Інструкція: ${task?.instruction || ''}

ВІДПОВІДЬ АВТОРА:
"""${userAnswer}"""

Вимоги до аналізу:
1. Визнач 2-3 конкретні сильні сторони виконаної роботи.
2. Визнач 1-2 зони росту (що можна зробити ще глибшим, переконливішим чи драматичнішим).
3. Дай одну практичну рекомендацію, яку автор може одразу впровадити у свій рукопис.
4. Запропонуй логічний наступний крок/вправу.
5. Оціни якість виконання від 60 до 100 балів.
6. Сформулюй структурований фрагмент (extractedContent) для автоматичного оновлення книги (наприклад, у картку персонажа, логлайн, синопсис чи нотатки сцени).

Поверни JSON строго такого формату:
{
  "score": 90,
  "strengths": ["...", "..."],
  "growthAreas": ["..."],
  "recommendation": "...",
  "nextStepSuggestion": "...",
  "xpEarned": ${task?.xpReward || 50},
  "suggestedBookIntegration": {
    "target": "${task?.targetBookEntity || 'general'}",
    "label": "Застосувати до поточної книги",
    "extractedContent": "Очищений та готовий до збереження художній фрагмент на основі відповіді автора"
  }
}`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(prompt, 'Ти — провідний літературний ментор та редактор українських видавництв.', true, {
          req,
          label: 'Оцінка завдання майстерності',
        });
        result = JSON.parse(raw);
      } else {
        result = {
          score: 88,
          strengths: [
            'Чітко виражена драматична напруга та конфлікт інтересів',
            'Оригінальний художній голос та відповідність атмосфері твору',
            'Присутній чіткий причинно-наслідковий звʼязок'
          ],
          growthAreas: [
            'Можна підсилити сенсорну конкретику (додати деталі оточення або фізичну реакцію героя)'
          ],
          recommendation: 'Цей елемент чудово доповнює психологічний профіль героя. Рекомендуємо одразу зафіксувати його у картці персонажа або плані поточної сцени.',
          nextStepSuggestion: 'Перейди до практики написання сцени діалогу з прихованим підтекстом на основі створеного конфлікту.',
          xpEarned: task?.xpReward || 50,
          suggestedBookIntegration: {
            target: task?.targetBookEntity || 'general',
            label: 'Застосувати до поточної книги',
            extractedContent: userAnswer.trim()
          }
        };
      }

      res.json(result);
    } catch (err: any) {
      console.error('Error in /api/ai/evaluate-skill-task:', err);
      res.status(500).json({ error: err.message || 'Помилка аналізу завдання' });
    }
  });

  // -----------------------------------------------------------------------
  // Mastery Framework (нова вкладка «Майстерність & Навички»).
  // Чотири ендпойнти живлять AI-тренера 18 навичок, генератор вправ,
  // генератор Blueprint книги/курсу та аналіз емоційної дуги.
  // -----------------------------------------------------------------------

  // 8a. AI Coach: глибокий розбір відповіді автора для конкретної навички.
  app.post('/api/ai/coach-feedback', async (req, res) => {
    try {
      const { skillId, skillTitle, subSkills, userDraft, exercisePrompt, bookContext } = req.body || {};
      if (!userDraft || !String(userDraft).trim()) {
        return res.status(400).json({ error: 'Немає тексту для аналізу.' });
      }
      if (!skillTitle) {
        return res.status(400).json({ error: 'Не вказано навичку для аналізу.' });
      }

      const criteriaList = Array.isArray(subSkills) && subSkills.length > 0
        ? subSkills.map((s: string, i: number) => `${i + 1}. ${s}`).join('\n')
        : skillTitle;

      const systemPrompt = `Ти — провідний літературний AI-Коуч та редактор українських видавництв.
Проаналізуй виконання практичної вправи автора для конкретної навички майстерності.

НАВИЧКА: ${skillTitle}
СУБ-КРИТЕРІЇ:
${criteriaList}

ВИМОГИ ДО АНАЛІЗУ (українською):
1. Постав загальний бал від 0 до 100.
2. Напиши стислий підсумок (2-4 речення) про якість виконання.
3. Дай 2-3 сильні сторони та 2-3 точки росту (конкретні, не абстрактні).
4. Оціни кожен суб-критерій від 0 до 100 з коротким коментарем.
5. Запропонуй покращений приклад (rewrittenExample) — короткий зразок, як підсилити текст.
6. Дай одну коротку пораду майстра (tip).

Поверни СУВОРО такий JSON:
{
  "score": 84,
  "summary": "текст",
  "strengths": ["...", "..."],
  "improvements": ["...", "..."],
  "criteriaFeedback": [{ "criterion": "назва", "score": 80, "comment": "коментар" }],
  "rewrittenExample": "покращений зразок",
  "tip": "порада"
}`;

      const ctx = bookContext || {};
      const userPrompt = `Контекст книги автора: назва — ${ctx.bookTitle || 'не вказано'}; жанр — ${ctx.genre || 'не вказано'}; головний герой — ${ctx.protagonist || 'не вказано'}.

ВПРАВА: ${exercisePrompt || 'Вільне тренування'}

ТЕКСТ АВТОРА:
"""${String(userDraft).slice(0, 6000)}"""`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: 'AI Coach: розбір навички',
        });
        result = JSON.parse(raw);
      } else {
        const isSciFi = /аур|енерг|фантаст|роман|світ|геро|психіч/i.test(String(userDraft));
        result = {
          score: isSciFi ? 86 : 84,
          summary: `Ваш уривок демонструє добре володіння навичкою «${skillTitle}». Текст динамічний та утримує фокус уваги читача. (Демо-режим без AI-ключа)`,
          strengths: [
            'Чітке та впевнене формулювання авторської думки',
            'Природна динаміка викладу без штучних ускладнень',
          ],
          improvements: [
            'Додайте контраст або внутрішній сумнів героя для підсилення напруги',
            'Посильте сенсорні деталі у кульмінаційній фразі',
          ],
          criteriaFeedback: (Array.isArray(subSkills) ? subSkills : [skillTitle]).map((s: string, idx: number) => ({
            criterion: s,
            score: 82 + (idx % 2) * 4,
            comment: 'Критерій розкрито впевнено, є хороша основа для розвитку сцени.',
          })),
          rewrittenExample: `«${String(userDraft).slice(0, 160)}…» — посилено через дію та сенсорні образи.`,
          tip: 'Порада майстра: читайте текст уголос, щоб відчути природний ритм читацького дихання.',
        };
      }

      const numericScore = Number(result.score);
      res.json({
        score: Number.isFinite(numericScore) ? Math.max(0, Math.min(100, Math.round(numericScore))) : 84,
        summary: result.summary || 'Аналіз виконано успішно.',
        strengths: Array.isArray(result.strengths) ? result.strengths : [],
        improvements: Array.isArray(result.improvements) ? result.improvements : [],
        criteriaFeedback: Array.isArray(result.criteriaFeedback) ? result.criteriaFeedback : [],
        rewrittenExample: result.rewrittenExample || '',
        tip: result.tip || '',
      });
    } catch (err: any) {
      console.error('Error in /api/ai/coach-feedback:', err);
      res.status(500).json({ error: err.message || 'Помилка аналізу навички' });
    }
  });

  // 8b. Генерація персональної вправи для навички під книгу автора.
  app.post('/api/ai/generate-exercise', async (req, res) => {
    try {
      const { skillTitle, subSkills, difficulty, bookContext } = req.body || {};
      if (!skillTitle) {
        return res.status(400).json({ error: 'Не вказано навичку для вправи.' });
      }

      const difficultyLabels: Record<string, string> = {
        easy: 'легкий',
        medium: 'середній',
        hard: 'рівень майстра',
      };
      const level = difficultyLabels[String(difficulty)] || 'середній';

      const systemPrompt = `Ти — методист письменницької майстерності. Створи ОДНУ практичну вправу для навички «${skillTitle}» рівня «${level}».
Критерії навички: ${Array.isArray(subSkills) && subSkills.length ? subSkills.join(', ') : skillTitle}.

Вправа має бути:
- конкретною та виконуваною за 10-20 хвилин;
- з творчим обмеженням (constraint);
- адаптованою під поточну книгу автора (якщо контекст надано).

Поверни СУВОРО такий JSON:
{
  "title": "коротка назва вправи",
  "scenario": "опис завдання, 2-4 речення",
  "instructions": "покрокова інструкція, 2-4 пункти",
  "exampleSnippet": "приклад-підказка початку тексту",
  "constraint": "творче обмеження"
}`;

      const ctx = bookContext || {};
      const userPrompt = `Книга автора: «${ctx.bookTitle || 'не вказано'}» (жанр: ${ctx.genre || 'не вказано'}). Головний герой: ${ctx.protagonist || 'не вказано'}. Ідея: ${String(ctx.bookIdea || '').slice(0, 500)}.`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: 'Генерація вправи майстерності',
        });
        result = JSON.parse(raw);
      } else {
        result = {
          title: `${skillTitle}: практичний виклик для вашої книги`,
          scenario: `Попрацюйте з фрагментом вашої книги «${ctx.bookTitle || 'без назви'}»: перечитайте останній уривок і застосуйте навичку «${skillTitle}», щоб посилити його.`,
          instructions: '1. Вставте уривок з вашої книги в робоче поле. 2. Застосуйте навичку до цього тексту. 3. Поясніть, що саме ви змінили і чому.',
          exampleSnippet: 'Спробуйте переписати перші 2-3 речення уривка...',
          constraint: 'Не змінюйте суть подій — лише форму, деталі та напругу.',
        };
      }

      res.json({
        title: result.title || `${skillTitle}: вправа`,
        scenario: result.scenario || '',
        instructions: result.instructions || '',
        exampleSnippet: result.exampleSnippet || '',
        constraint: result.constraint || '',
      });
    } catch (err: any) {
      console.error('Error in /api/ai/generate-exercise:', err);
      res.status(500).json({ error: err.message || 'Помилка генерації вправи' });
    }
  });

  // 8c. Генератор Blueprint книги/курсу на основі 18 навичок.
  app.post('/api/ai/generate-blueprint', async (req, res) => {
    try {
      const { projectType, topic, targetAudience, format } = req.body || {};
      if (!topic || !String(topic).trim()) {
        return res.status(400).json({ error: 'Вкажіть тему твору або курсу.' });
      }

      const typeLabel = projectType === 'course' ? 'навчальний курс' : 'книга';

      const systemPrompt = `Ти — архітектор освітніх продуктів та видавничий стратег. Склади детальний Blueprint (план) ${typeLabel} «${String(topic).slice(0, 200)}».

Формат/жанр: ${format || 'не вказано'}
Цільова аудиторія: ${targetAudience || 'широка'}

Структура: 6-8 розділів. Для кожного розділу вкажи:
- chapter (номер),
- title (назва),
- skillFocus (яка з 18 навичок письменника тренується),
- summary (зміст, 1-2 речення),
- exercise (практична вправа для читача).

Також додай: projectTitle, synopsis (1-2 речення), targetAudience, pedagogicalArtifacts (4-6 чеклістів/артефактів).

Поверни СУВОРО такий JSON:
{
  "projectTitle": "...",
  "synopsis": "...",
  "targetAudience": "...",
  "structure": [
    { "chapter": "Розділ 1", "title": "...", "skillFocus": "...", "summary": "...", "exercise": "..." }
  ],
  "pedagogicalArtifacts": ["...", "..."]
}`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(
          `Тема: ${String(topic).slice(0, 300)}\nФормат: ${format || ''}\nАудиторія: ${targetAudience || ''}\nТип: ${typeLabel}`,
          systemPrompt,
          true,
          { req, label: 'Генератор Blueprint' }
        );
        result = JSON.parse(raw);
      } else {
        result = {
          projectTitle: `${String(topic).slice(0, 60)} — план`,
          synopsis: `Практичний ${typeLabel}, який веде читача від розуміння проблеми до системного результату. (Демо-режим без AI-ключа)`,
          targetAudience: targetAudience || 'Широка аудиторія',
          structure: [
            { chapter: 'Розділ 1', title: 'Вступ та проблема', skillFocus: 'Ідея та зміст', summary: 'Формулюємо головну тезу та цінність твору.', exercise: 'Сформулюйте контролюючу ідею одним реченням.' },
            { chapter: 'Розділ 2', title: 'Фундамент концепції', skillFocus: 'Структура та композиція', summary: 'Будуємо архітектуру розділів та логіку подачі.', exercise: 'Складіть план з 5 ключових розділів.' },
            { chapter: 'Розділ 3', title: 'Головний герой / Оповідач', skillFocus: 'Персонажі та взаємодія', summary: 'Створюємо живого героя з мотивацією та ранами.', exercise: 'Опишіть героя через вчинок під тиском.' },
            { chapter: 'Розділ 4', title: 'Конфлікт та ставки', skillFocus: 'Конфлікт та напруга', summary: 'Піднімаємо ставки та створюємо перешкоди.', exercise: 'Підвищіть ставки за 3 кроки.' },
            { chapter: 'Розділ 5', title: 'Практичні інструменти', skillFocus: 'Практична цінність та педагогіка', summary: 'Даємо читачеві алгоритми та шаблони.', exercise: 'Поясніть поняття через аналогію.' },
            { chapter: 'Розділ 6', title: 'Впровадження та результати', skillFocus: 'Системна інтеграція та практика', summary: 'План впровадження та вимірювання прогресу.', exercise: 'Складіть чекліст перших 30 днів.' },
          ],
          pedagogicalArtifacts: ['Чекліст перших кроків', 'Шаблон плану розділу', 'Карта прогресу на 30 днів', 'Список типових помилок'],
        };
      }

      res.json({
        projectTitle: result.projectTitle || String(topic).slice(0, 60),
        synopsis: result.synopsis || '',
        targetAudience: result.targetAudience || targetAudience || '',
        structure: Array.isArray(result.structure) ? result.structure : [],
        pedagogicalArtifacts: Array.isArray(result.pedagogicalArtifacts) ? result.pedagogicalArtifacts : [],
      });
    } catch (err: any) {
      console.error('Error in /api/ai/generate-blueprint:', err);
      res.status(500).json({ error: err.message || 'Помилка генерації плану' });
    }
  });

  // 8d. Аналіз емоційної дуги книги з опису сюжету.
  app.post('/api/ai/analyze-emotional-arc', async (req, res) => {
    try {
      const { storyOutline, chaptersCount } = req.body || {};
      if (!storyOutline || !String(storyOutline).trim()) {
        return res.status(400).json({ error: 'Опишіть сюжет для аналізу.' });
      }

      const count = Math.max(4, Math.min(12, Number(chaptersCount) || 8));

      const systemPrompt = `Ти — драматург-аналітик (за методологією Курта Воннегута про форми історій).
Проаналізуй опис сюжету книги та побудуй емоційну дугу на ${count} розділів.

Для кожного розділу дай:
- chapter (номер),
- title (назва етапу дуги),
- score (емоційний заряд від -10 до +10),
- tension (напруга від 0 до 100),
- note (короткий коментар).

Також визнач: arcName (назва архетипу дуги), description (2-3 речення), pacingAssessment (оцінка темпу, 1-2 речення).

Поверни СУВОРО такий JSON:
{
  "arcName": "...",
  "description": "...",
  "pacingAssessment": "...",
  "chapters": [
    { "chapter": 1, "title": "...", "score": 4, "tension": 25, "note": "..." }
  ]
}`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(
          `Опис сюжету:\n"""${String(storyOutline).slice(0, 4000)}"""\n\nКількість розділів: ${count}`,
          systemPrompt,
          true,
          { req, label: 'Аналіз емоційної дуги' }
        );
        result = JSON.parse(raw);
      } else {
        const chapters = Array.from({ length: count }, (_, i) => {
          const mid = Math.floor(count / 2);
          const score = i === 0 ? 4 : i === mid ? -8 : i === count - 1 ? 8 : Math.round(4 - (Math.abs(i - mid) / mid) * 8);
          return {
            chapter: i + 1,
            title: i === 0 ? 'Знайомство та завязка' : i === mid ? 'Темна ніч душі' : i === count - 1 ? 'Катарсис та розвязка' : `Розвиток (крок ${i + 1})`,
            score: Math.max(-10, Math.min(10, score)),
            tension: Math.min(100, Math.round(30 + (Math.abs(i - mid) / mid) * 55)),
            note: i === 0 ? 'Знайомство з героєм, цікавість' : i === mid ? 'Найглибша криза' : i === count - 1 ? 'Тріумф та трансформація' : 'Зростання ставок',
          };
        });
        result = {
          arcName: 'Людина в ямі',
          description: 'Класична U-подібна дуга: герой падає на дно кризи, а потім тріумфально піднімається. (Демо-режим без AI-ключа)',
          pacingAssessment: 'Розумне чергування підйомів і спадів утримує увагу читача.',
          chapters,
        };
      }

      res.json({
        arcName: result.arcName || 'Емоційна дуга',
        description: result.description || '',
        pacingAssessment: result.pacingAssessment || '',
        chapters: Array.isArray(result.chapters) ? result.chapters : [],
      });
    } catch (err: any) {
      console.error('Error in /api/ai/analyze-emotional-arc:', err);
      res.status(500).json({ error: err.message || 'Помилка аналізу дуги' });
    }
  });

  // -----------------------------------------------------------------------
  // Фаза 2, 2.1: База знань — AI-цитата з референсу.
  // 'direct' (пряма цитата) обробляється на клієнті без виклику сервера —
  // сюди приходять лише 'paraphrase' і 'analytical', яким справді потрібен AI.
  // -----------------------------------------------------------------------
  app.post('/api/ai/knowledge-quote', async (req, res) => {
    try {
      const { text, mode, sourceName } = req.body || {};
      if (!text || !String(text).trim()) {
        return res.status(400).json({ error: 'Немає виділеного тексту для обробки.' });
      }
      if (mode !== 'paraphrase' && mode !== 'analytical') {
        return res.status(400).json({ error: 'Підтримувані режими: paraphrase, analytical.' });
      }

      const modePrompts: Record<string, string> = {
        paraphrase: 'Перекажи наданий уривок своїми словами українською, зберігаючи зміст і ключові факти, стисло (1-3 речення), без цитування оригінальних формулювань.',
        analytical: 'Напиши короткий аналітичний коментар (1-3 речення) українською про те, чому цей уривок важливий для автора книги — у стилі нотатки дослідника, починаючи з «Це важливо, бо…».',
      };

      let result: string;
      if (ai) {
        result = await generateWithGemini(
          `Джерело: ${sourceName || 'референс автора'}\n\nУривок:\n"""${String(text).slice(0, 4000)}"""`,
          modePrompts[mode],
          false,
          { req, label: 'AI-цитата з бази знань' }
        );
      } else {
        result =
          mode === 'paraphrase'
            ? `(Демо-переказ без AI-ключа) ${String(text).slice(0, 200)}…`
            : `Це важливо, бо (демо-коментар без AI-ключа) цей фрагмент напряму стосується теми вашої книги.`;
      }

      res.json({ result: result.trim() });
    } catch (err: any) {
      console.error('Error in /api/ai/knowledge-quote:', err);
      res.status(500).json({ error: err.message || 'Не вдалося обробити цитату.' });
    }
  });

  // -----------------------------------------------------------------------
  // Фаза 2, 2.2: Пілотні тренажери (Персонаж / Діалог) — AI-оцінка за
  // фіксованими критеріями кожного тренажера (окремо від generic
  // evaluate-skill-task вище, бо тут потрібні саме ці 3 осі, а не вільна
  // рецензія).
  // -----------------------------------------------------------------------
  const TRAINER_CRITERIA: Record<string, { key: string; labelUk: string }[]> = {
    character: [
      { key: 'uniqueness', labelUk: 'Унікальність' },
      { key: 'motivation', labelUk: 'Мотивація' },
      { key: 'archetype', labelUk: 'Архетип' },
    ],
    dialogue: [
      { key: 'naturalness', labelUk: 'Природність' },
      { key: 'subtext', labelUk: 'Підтекст' },
      { key: 'characterReveal', labelUk: 'Розкриття характеру' },
    ],
  };

  app.post('/api/ai/evaluate-trainer', async (req, res) => {
    try {
      const { trainerType, taskPrompt, userAnswer } = req.body || {};
      const criteria = TRAINER_CRITERIA[trainerType];
      if (!criteria) {
        return res.status(400).json({ error: 'Підтримувані тренажери: character, dialogue.' });
      }
      if (!userAnswer || !String(userAnswer).trim()) {
        return res.status(400).json({ error: 'Потрібна відповідь для оцінки.' });
      }

      const criteriaList = criteria.map((c) => `- ${c.key} (${c.labelUk})`).join('\n');
      const systemPrompt = `Ти — прискіпливий, але доброзичливий AI-тренер письменницької майстерності. Оцінюєш вправу тренажера «${trainerType === 'character' ? 'Персонаж' : 'Діалог'}» СТРОГО за трьома критеріями (кожен від 0 до 100):
${criteriaList}
Також дай 2-3 короткі практичні поради українською та загальний бал (середнє по критеріях, округлене).
Поверни ЛИШЕ JSON:
{
  "criteria": [${criteria.map((c) => `{"key":"${c.key}","label":"${c.labelUk}","score":80}`).join(',')}],
  "overallScore": 80,
  "tips": ["...", "..."]
}`;

      const userPrompt = `Завдання тренажера: ${taskPrompt || ''}\n\nВідповідь автора:\n"""${String(userAnswer).slice(0, 4000)}"""`;

      let parsed: any;
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: `Тренажер: ${trainerType}`,
        });
        parsed = JSON.parse(raw);
      } else {
        parsed = {
          criteria: criteria.map((c) => ({ key: c.key, label: c.labelUk, score: 78 })),
          overallScore: 78,
          tips: [
            'Демо-оцінка без AI-ключа (GEMINI_API_KEY не налаштований на сервері).',
            'Додайте більше сенсорних деталей та конкретики до відповіді.',
          ],
        };
      }

      const overallScore = typeof parsed.overallScore === 'number' ? parsed.overallScore : 70;
      res.json({
        criteria: Array.isArray(parsed.criteria) ? parsed.criteria : [],
        overallScore,
        tips: Array.isArray(parsed.tips) ? parsed.tips : [],
        xpEarned: Math.round(30 + (overallScore / 100) * 40),
      });
    } catch (err: any) {
      console.error('Error in /api/ai/evaluate-trainer:', err);
      res.status(500).json({ error: err.message || 'Не вдалося оцінити вправу.' });
    }
  });

  // -----------------------------------------------------------------------
  // Фаза 3, 3.1: Конструктор структури книги — для блоку, який автор уже
  // заповнив власним текстом, AI пропонує РІВНО 3 варіанти заголовка
  // розділу. Авторський текст блоку сам AI ніколи не змінює — лише читає
  // його як контекст для назви.
  // -----------------------------------------------------------------------
  app.post('/api/ai/structure-suggest-title', async (req, res) => {
    try {
      const { blockLabel, blockText, genre, bookTitle } = req.body || {};
      if (!blockLabel || !String(blockLabel).trim()) {
        return res.status(400).json({ error: 'Не вказано блок структури.' });
      }
      const text = typeof blockText === 'string' ? blockText.trim() : '';
      if (!text) {
        return res.status(400).json({ error: 'Спершу напишіть хоч трохи тексту в цьому блоці.' });
      }

      const systemPrompt = `Ти — досвідчений літературний редактор. Автор пише книгу${bookTitle ? ` «${bookTitle}»` : ''} за шаблоном структури «${genre === 'fiction' ? 'художня' : 'нон-фікшн'}». Він щойно написав текст для блоку «${blockLabel}». НЕ змінюй і не перефразовуй авторський текст — лише прочитай його як контекст. Запропонуй РІВНО 3 короткі варіанти назви розділу (кожен до 8 слів, українською, без нумерації в самому тексті назви). Поверни ЛИШЕ JSON: {"suggestions": ["...", "...", "..."]}`;
      const userPrompt = `Блок: ${blockLabel}\n\nТекст автора:\n"""${text.slice(0, 4000)}"""`;

      let suggestions: string[];
      if (ai) {
        const raw = await generateWithGemini(userPrompt, systemPrompt, true, {
          req,
          label: 'Конструктор структури: заголовки',
        });
        const parsed = JSON.parse(raw);
        suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [];
      } else {
        const snippet = text.slice(0, 40).trim();
        suggestions = [
          `${blockLabel}: ${snippet}${text.length > 40 ? '…' : ''}`,
          `Розділ «${blockLabel}» (демо-заголовок без AI-ключа)`,
          `${blockLabel} — чернетка назви`,
        ];
      }

      res.json({ suggestions });
    } catch (err: any) {
      console.error('Error in /api/ai/structure-suggest-title:', err);
      res.status(500).json({ error: err.message || 'Не вдалося запропонувати заголовок.' });
    }
  });

  // -----------------------------------------------------------------------
  // Фаза 3, 3.2: Авторський AI-асистент із пам'яттю. На відміну від
  // /api/ai/edit-text (який редагує конкретний фрагмент тексту), цей
  // маршрут веде вільну розмову й враховує попередні репліки з поточної
  // історії чату (generateWithGemini приймає лише один prompt-рядок, тож
  // історію згортаємо в текстову стенограму), а також файл стилю автора,
  // якщо чекбокс «Автоматично використовувати стиль» увімкнено
  // (та сама модель, що і в EditorView, Фаза 1, 1.3).
  // -----------------------------------------------------------------------
  app.post('/api/ai/assistant-chat', async (req, res) => {
    try {
      const { messages, bookContext, styleGuide } = req.body || {};
      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ error: 'Порожня історія повідомлень.' });
      }
      const lastUserMessage = [...messages].reverse().find((m: any) => m?.role === 'user');
      if (!lastUserMessage || !String(lastUserMessage.content || '').trim()) {
        return res.status(400).json({ error: 'Немає повідомлення для відповіді.' });
      }

      const transcript = messages
        .slice(-10)
        .map((m: any) => `${m.role === 'user' ? 'Автор' : 'Асистент'}: ${String(m.content || '').slice(0, 1000)}`)
        .join('\n');

      const bookCtxLine = bookContext?.title
        ? `Книга автора: «${bookContext.title}» (жанр: ${bookContext.genre || 'не вказано'}). Синопсис: ${String(bookContext.synopsis || '').slice(0, 500)}`
        : '';
      const styleLine =
        typeof styleGuide === 'string' && styleGuide.trim()
          ? `Ось файл стилю автора (ім'я_автора.md) — враховуй його в порадах і, якщо доречно, пиши приклади в цьому стилі:\n${styleGuide.slice(0, 3000)}`
          : '';

      const systemPrompt = [
        'Ти помічник письменника. Відповідай лаконічно, ділово й натхненно, українською мовою. Без рольових масок — просто один режим «Помічник».',
        styleLine,
        bookCtxLine,
      ]
        .filter(Boolean)
        .join('\n\n');

      let reply: string;
      if (ai) {
        reply = await generateWithGemini(`${transcript}\n\nНова репліка автора: ${lastUserMessage.content}`, systemPrompt, false, {
          req,
          label: 'AI-асистент письменника',
        });
      } else {
        reply = 'Демо-відповідь без AI-ключа (GEMINI_API_KEY не налаштований на сервері). Ваше повідомлення отримано — увімкніть AI-ключ, щоб отримати справжню пораду.';
      }

      res.json({ reply: reply.trim() });
    } catch (err: any) {
      console.error('Error in /api/ai/assistant-chat:', err);
      res.status(500).json({ error: err.message || 'Не вдалося отримати відповідь асистента.' });
    }
  });

  // 8. Writer Mastery: Diagnostic Assessment
  app.post('/api/ai/diagnostic-assessment', async (req, res) => {
    try {
      const { categoryScores, bookContext } = req.body;

      const prompt = `Ти — головний літературний діагност та методолог системи розвитку письменницьких навичок.
На основі відсоткових результатів тестування сформуй профіль автора:

БАЛИ ЗА НАПРЯМКАМИ:
${JSON.stringify(categoryScores || {}, null, 2)}

КОНТЕКСТ КНИГИ:
${JSON.stringify(bookContext || {}, null, 2)}

Сформуй персоналізований звіт у JSON:
{
  "authorArchetype": "Наприклад: Архітектор світів та глибоких характерів",
  "levelTitle": "Рівень 2: Практик-новеліст",
  "strengths": ["...", "...", "..."],
  "weaknesses": ["...", "...", "..."],
  "trajectorySummary": "Детальний аналіз та персональний план розвитку на 3-4 речення з фокусом на проблеми, які безпосередньо впливають на поточну книгу автора.",
  "recommendedTaskIds": ["task-char-internal-conflict", "task-editing-clutter-removal", "task-craft-dialogue-subtext"]
}`;

      let result: any;
      if (ai) {
        const raw = await generateWithGemini(prompt, 'Ти — провідний експерт із літературної майстерності та творчого коучингу.', true, {
          req,
          label: 'Діагностика навичок',
        });
        result = JSON.parse(raw);
      } else {
        result = {
          authorArchetype: 'Архітектор світів та глибоких характерів',
          levelTitle: 'Рівень 2: Практик-новеліст',
          strengths: ['Генерація унікальних концептів', 'Психологічна глибина персонажів', 'Візуальний стиль та атмосфера'],
          weaknesses: ['Редактура та надлишкові описи', 'Діалоги з прихованим підтекстом', 'Саспенс і темпоритм'],
          trajectorySummary: 'Ваш найсильніший бік — багата уява та створення переконливих характерів. Головний пріоритет на найближчі тижні — сфокусуватися на структурній редактурі та очищенні тексту від «води», аби сюжет не провисав у кульмінаційних сценах вашої поточної книги.',
          recommendedTaskIds: ['task-char-internal-conflict', 'task-editing-clutter-removal', 'task-craft-dialogue-subtext', 'task-concept-logline']
        };
      }

      res.json(result);
    } catch (err: any) {
      console.error('Error in /api/ai/diagnostic-assessment:', err);
      res.status(500).json({ error: err.message || 'Помилка генерації діагностики' });
    }
  });

  // --- Real-time Collaboration REST API Endpoints ---

  app.get('/api/rooms/:bookId/info', (req, res) => {
    const { bookId } = req.params;
    const room = collabRooms.get(bookId);
    if (!room) {
      return res.json({
        bookId,
        activeUsersCount: 0,
        presenceList: [],
        messagesCount: 0,
        hasServerBook: false
      });
    }
    const presenceList = Array.from(room.clients.values()).map(c => c.info);
    res.json({
      bookId,
      activeUsersCount: presenceList.length,
      presenceList,
      messagesCount: room.messages.length,
      hasServerBook: !!room.book
    });
  });

  app.get('/api/rooms/:bookId/chat', (req, res) => {
    const { bookId } = req.params;
    const room = collabRooms.get(bookId);
    res.json({
      messages: room ? room.messages : []
    });
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Create HTTP server and attach WebSocket server on same port 3000
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    let currentBookId: string | null = null;
    let currentClientId: string | null = null;

    ws.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        const { type, payload } = message;

        switch (type) {
          case 'client:join': {
            const { bookId, user, initialBook } = payload;
            if (!bookId) return;

            currentBookId = bookId;
            const room = getOrCreateRoom(bookId);
            if (!room.book && initialBook) {
              room.book = initialBook;
            }

            const clientId = user?.clientId || `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            currentClientId = clientId;

            const userInfo: CollabUser = {
              clientId,
              userId: user?.userId || clientId,
              userName: user?.userName || 'Користувач',
              role: user?.role || 'writer',
              currentTab: user?.currentTab || 'editor',
              activeSectionId: user?.activeSectionId,
              activeChapterId: user?.activeChapterId,
              color: user?.color || '#3b82f6',
              avatarUrl: user?.avatarUrl,
              lastActive: new Date().toISOString(),
              isTyping: false
            };

            room.clients.set(clientId, { ws, info: userInfo });

            const presenceList = Array.from(room.clients.values()).map(c => c.info);

            // Send full room sync to the newly connected client
            ws.send(JSON.stringify({
              type: 'room:sync',
              payload: {
                bookId,
                book: room.book,
                presenceList,
                chatHistory: room.messages,
                changelog: room.changelog,
                assignedClientId: clientId
              },
              timestamp: new Date().toISOString()
            }));

            // Notify others
            broadcastToRoom(bookId, {
              type: 'presence:update',
              payload: { presenceList }
            });

            broadcastToRoom(bookId, {
              type: 'user:joined',
              payload: { user: userInfo }
            }, clientId);
            break;
          }

          case 'book:update': {
            const { bookId, updatedBook, logEntry } = payload;
            if (!bookId || !updatedBook) return;

            const room = getOrCreateRoom(bookId);
            room.book = updatedBook;

            if (logEntry) {
              room.changelog.unshift(logEntry);
              if (room.changelog.length > 200) room.changelog.pop();
            }

            // Broadcast to other clients in room
            broadcastToRoom(bookId, {
              type: 'book:remote_update',
              payload: {
                book: updatedBook,
                logEntry
              }
            }, currentClientId || undefined);
            break;
          }

          /**
           * Точкова правка однієї секції. Під час набору тексту клієнт шле
           * саме її замість усієї книги: кілька сотень байтів проти мегабайта.
           */
          case 'section:patch': {
            const { bookId, patch } = payload;
            if (!bookId || !patch?.chapterId || !patch?.sectionId) return;

            const room = getOrCreateRoom(bookId);

            // Якщо серверна копія книги є — оновлюємо її, щоб новий учасник
            // отримав актуальний стан у room:sync.
            if (room.book?.chapters) {
              const chapter = room.book.chapters.find((c: any) => c.id === patch.chapterId);
              const section = chapter?.sections?.find((s: any) => s.id === patch.sectionId);
              if (section) {
                for (const field of ['content', 'contentEn', 'wordCount', 'lastModified']) {
                  if (patch[field] !== undefined) section[field] = patch[field];
                }
                room.book.updatedAt = new Date().toISOString();
              }
            }

            broadcastToRoom(bookId, {
              type: 'section:remote_patch',
              payload: { patch }
            }, currentClientId || undefined);
            break;
          }

          case 'presence:status': {
            const { bookId, status } = payload;
            if (!bookId || !currentClientId) return;

            const room = collabRooms.get(bookId);
            if (room && room.clients.has(currentClientId)) {
              const client = room.clients.get(currentClientId)!;
              client.info = {
                ...client.info,
                ...status,
                lastActive: new Date().toISOString()
              };

              const presenceList = Array.from(room.clients.values()).map(c => c.info);
              broadcastToRoom(bookId, {
                type: 'presence:update',
                payload: { presenceList }
              });
            }
            break;
          }

          case 'chat:send': {
            const { bookId, text, tabContext, senderName, role, color } = payload;
            if (!bookId || !text || !text.trim()) return;

            const room = getOrCreateRoom(bookId);
            const client = currentClientId ? room.clients.get(currentClientId) : null;

            const newMsg = {
              id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
              clientId: currentClientId || 'anon',
              senderName: client?.info?.userName || senderName || 'Колега',
              role: client?.info?.role || role || 'writer',
              color: client?.info?.color || color || '#3b82f6',
              message: text.trim(),
              timestamp: new Date().toISOString(),
              tabContext: tabContext || client?.info?.currentTab || 'editor'
            };

            room.messages.push(newMsg);
            if (room.messages.length > 200) room.messages.shift();

            broadcastToRoom(bookId, {
              type: 'chat:message',
              payload: { message: newMsg }
            });
            break;
          }

          case 'version:snapshot_created': {
            const { bookId, snapshot, updatedBook } = payload;
            if (!bookId) return;

            const room = getOrCreateRoom(bookId);
            if (updatedBook) {
              room.book = updatedBook;
            }

            broadcastToRoom(bookId, {
              type: 'version:snapshot_created',
              payload: { snapshot, book: room.book }
            }, currentClientId || undefined);
            break;
          }

          case 'ping': {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
            break;
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      if (currentBookId && currentClientId) {
        const room = collabRooms.get(currentBookId);
        if (room) {
          const leavingUser = room.clients.get(currentClientId)?.info;
          room.clients.delete(currentClientId);

          const presenceList = Array.from(room.clients.values()).map(c => c.info);
          broadcastToRoom(currentBookId, {
            type: 'presence:update',
            payload: { presenceList }
          });

          if (leavingUser) {
            broadcastToRoom(currentBookId, {
              type: 'user:left',
              payload: { user: leavingUser }
            });
          }
        }
      }
    });

    ws.on('error', (err) => {
      console.warn('WebSocket client error:', err.message);
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} with WebSockets enabled on /ws`);
  });

  // Зупиняємо фонові процеси модуля публікації по сигналу платформи: задачі,
  // що лишились у стані «виконується», при наступному старті повернуться в
  // чергу автоматично — стан кроку зберігається в базі.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      publishing.stop();
      server.close(() => process.exit(0));
    });
  }
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

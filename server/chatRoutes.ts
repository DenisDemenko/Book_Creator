/**
 * Чат-сесії AI-асистента письменника.
 *
 * До цього історія розмови з асистентом жила лише в localStorage браузера
 * (Фаза 3.2): зміна пристрою або чистка даних — і контекст втрачено, а
 * вартість розмови ніде не була видна автору. Тут історія переїжджає в
 * базу (server/db.ts → chat_sessions / chat_messages), а кожна відповідь
 * асистента приносить із собою кількість токенів і розраховану вартість.
 *
 * Архітектурні рішення, важливі для розуміння файлу:
 *
 *  1. Сам виклик моделі СЮДИ НЕ ВШИТИЙ. Клієнт AI живе в замиканні
 *     startServer() у server.ts, тож генератор передається сюди як
 *     залежність (`ChatAiGenerator`). Завдяки цьому роути тестуються з
 *     підставним генератором без мережі й без ключа, а зміна провайдера
 *     (Gemini → OpenAI → Claude) не зачіпає жодного рядка цього файлу.
 *
 *  2. Ціноутворення НЕ рахується тут. Формула живе в server/pricing.ts
 *     (`priceForTextEngine`), єдиному місці, де взагалі є числа тарифів —
 *     так зміна прайсу не вимагає правок у контролері.
 *
 *  3. Вартість пишеться ДВІЧІ й навмисно: у chat_messages.cost_usd (щоб
 *     «накопичена вартість сесії» звірялась як SUM, а не лише як лічильник)
 *     і в загальний usage_log через `onUsage` (щоб адмінські графіки
 *     витрат бачили чат нарівні з рештою AI-викликів).
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import {
  createChatSession,
  getChatSession,
  listChatSessions,
  updateChatSession,
  deleteChatSession,
  addChatMessage,
  listChatMessages,
  type StoredChatSession,
  type StoredChatMessage,
} from './store';
import { priceForTextEngine, priceRateForModel } from './pricing';
import { CHAT_MODELS, engineConfigured, isKnownModel, resolveEngine, VISION_ENGINES, type ImageAttachment } from './chatProviders';
import { CONTEXT_WINDOW_MESSAGES, buildPromptContext, buildSystemPrompt } from './chatPrompt';

/** Один прикріплений файл-текст (txt/md/pdf) — вміст уже витягнутий на клієнті. */
export interface ChatTextAttachment {
  name: string;
  content: string;
}

/** Обмеження на прикріплення до одного повідомлення — захист від роздування запиту/рахунку. */
export const MAX_ATTACHED_IMAGES = 4;
export const MAX_ATTACHED_TEXT_FILES = 4;
export const MAX_TEXT_ATTACHMENT_CHARS = 50_000;

/**
 * Побудова промту чат-асистента винесена в server/chatPrompt.ts — чистий
 * файл без роутів/стану, за тим самим принципом, що й
 * manuscriptImagePrompt.ts. Реекспорт лишає всі наявні виклики (нижче в
 * цьому файлі, і в scripts/test-chatSessions.mts через namespace-імпорт
 * `chat.*`) робочими без правок.
 */
export { CONTEXT_WINDOW_MESSAGES, buildPromptContext, buildSystemPrompt };
/** Запобіжник від надто довгих повідомлень (і від роздування рахунку). */
export const MAX_MESSAGE_CHARS = 8000;
/** Довжина автозаголовка сесії, зліпленого з першої репліки автора. */
const TITLE_MAX_CHARS = 60;

/**
 * Мітка контексту в usage_log для відповідей чат-сесій. На неї спирається
 * $-квота чату (server/subscriptions.ts → checkChatQuota) і адмінська
 * вкладка «Витрати на API» — тож це один рядок у всьому проєкті.
 */
export const CHAT_USAGE_CONTEXT = 'AI-асистент (чат-сесія)';

export interface ChatAiResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Генератор відповіді. Впроваджується ззовні — див. пункт 1 у шапці файлу.
 * Третій аргумент — `modelId` сесії: генератор сам визначає провайдера й
 * викликає потрібну модель. Старі генератори з двома аргументами лишаються
 * сумісними (аргумент необов'язковий). Четвертий — `userId` власника сесії:
 * генератор може підвантажити його власний ключ API (розділ «Ключі API»)
 * замість серверного env-ключа.
 */
export type ChatAiGenerator = (
  prompt: string,
  systemInstruction: string,
  modelId?: string,
  userId?: string,
  images?: ImageAttachment[]
) => Promise<ChatAiResult>;

export interface ChatQuotaCheck {
  allowed: boolean;
  reasonUk?: string;
  quota?: number | null;
  remaining?: number | null;
}

export interface ChatRoutesDeps {
  /**
   * null, якщо AI-ключ не налаштований. Тоді відповідає `demoReply` —
   * так само, як решта AI-роутів проєкту, які в офлайні віддають чесно
   * підписану заглушку, щоб застосунок лишався клікабельним без ключа.
   * Це стан КОНФІГУРАЦІЇ, а не помилка; справжній збій провайдера
   * (виняток із generate) — це вже 502, див. роут повідомлень.
   */
  generate: ChatAiGenerator | null;
  /** Модель за замовчуванням для нових сесій (серверна конфігурація). */
  defaultModelId: string;
  /**
   * Перевірка $-квоти чату перед викликом моделі (Pro/Ultra). Якщо не
   * задана — ліміт не перевіряється (тести/демо). Повертає 403 при вичерпанні.
   */
  checkChatQuota?: (userId: string, role: string) => Promise<ChatQuotaCheck>;
  /** Прокидання витрати в загальний журнал usage_log (адмінські графіки). */
  onUsage?: (
    req: any,
    label: string,
    modelId: string,
    inputTokens: number,
    outputTokens: number,
    success: boolean
  ) => Promise<void>;
  /** Файл стилю автора, якщо він увімкнув «Автоматично використовувати стиль». */
  loadStyleGuide?: (userId: string) => Promise<string | null>;
  /**
   * Рушії, для яких автор задав власний ключ (розділ «Ключі API»). Потрібно
   * для GET /api/chat/models — модель має бути обрана (не задизейблена), якщо
   * є ХОЧ ОДИН з двох ключів, серверний або власний, а не лише серверний.
   */
  listUserConfiguredEngines?: (userId: string) => Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Чисті функції — тестуються без Express, без бази й без мережі
// ---------------------------------------------------------------------------

/** Заголовок сесії з першої репліки автора: «Порадь, з чого почати другий…». */
export function deriveTitle(firstUserMessage: string): string {
  const flat = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (!flat) return 'Нова розмова';
  return flat.length <= TITLE_MAX_CHARS ? flat : `${flat.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

/** Валідація вхідного тексту повідомлення. Повертає помилку або null. */
export function validateMessage(content: unknown): string | null {
  if (typeof content !== 'string' || !content.trim()) return 'Повідомлення не може бути порожнім.';
  if (content.length > MAX_MESSAGE_CHARS) return `Повідомлення задовге (максимум ${MAX_MESSAGE_CHARS} символів).`;
  return null;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Відповідь, коли AI-ключ на сервері не налаштований. Нуль токенів і нуль
 * вартості — щоб демо-режим не забруднював статистику витрат вигаданими
 * цифрами. Текст явно підписаний як демо, щоб його не сплутали зі
 * справжньою порадою моделі.
 */
export const demoReply: ChatAiGenerator = async () => ({
  text: 'Демо-відповідь без AI-ключа: на сервері не налаштований GEMINI_API_KEY, тож справжня модель не викликалась. Історія розмови й далі зберігається в базі — увімкніть ключ, щоб отримувати реальні поради.',
  inputTokens: 0,
  outputTokens: 0,
});

// ---------------------------------------------------------------------------
// Роути
// ---------------------------------------------------------------------------

export function registerChatRoutes(app: Express, deps: ChatRoutesDeps): void {
  /**
   * Спільна перевірка: сесія існує і належить тому, хто питає.
   * Розрізняємо 404 і 403 навмисно — але лише для адміна; звичайному
   * користувачеві чужа сесія віддається як 404, щоб не підтверджувати
   * саме існування чужого id.
   */
  async function loadOwnSession(req: any, res: any, sessionId: string): Promise<StoredChatSession | null> {
    const principal = req.principal!;
    const session = await getChatSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Сесію не знайдено.' });
      return null;
    }
    if (session.userId !== principal.id && principal.role !== 'admin') {
      res.status(404).json({ error: 'Сесію не знайдено.' });
      return null;
    }
    return session;
  }

  /** Список сесій користувача — для бічної панелі вибору розмови. */
  app.get('/api/chat/sessions', requireAuth, async (req, res) => {
    try {
      const sessions = await listChatSessions(req.principal!.id as string);
      res.json({ sessions });
    } catch (err) {
      console.error('[chat] list sessions:', err);
      res.status(500).json({ error: 'Не вдалося завантажити список розмов.' });
    }
  });

  /**
   * Доступні моделі чату — щоб клієнт не хардкодив список і бачив, які
   * провайдери реально налаштовані на сервері (available = env-ключ є).
   */
  app.get('/api/chat/models', requireAuth, async (req, res) => {
    try {
      const userId = req.principal!.id as string;
      const ownEngines = new Set(
        deps.listUserConfiguredEngines ? await deps.listUserConfiguredEngines(userId) : []
      );
      res.json({
        defaultModelId: deps.defaultModelId,
        models: CHAT_MODELS.map((m) => {
          // Ціна за мільйон токенів — щоб автор бачив різницю у вартості
          // моделей ПЕРЕД вибором (напр. Claude Opus дорожчий за Sonnet/Haiku,
          // а Claude/GPT дорожчі за DeepSeek/Groq), а не дізнавався про неї
          // постфактум із $-квоти чату. За КОНКРЕТНОЮ моделлю, не лише
          // рушієм — у Claude кілька моделей з різною ціною.
          const rate = priceRateForModel(m.engine, m.id);
          return {
            ...m,
            available: engineConfigured(m.engine) || ownEngines.has(m.engine),
            inputPerMillionUsd: rate?.inputPerMillionUsd ?? null,
            outputPerMillionUsd: rate?.outputPerMillionUsd ?? null,
          };
        }),
      });
    } catch (err) {
      console.error('[chat] list models:', err);
      res.status(500).json({ error: 'Не вдалося завантажити список моделей.' });
    }
  });

  /** Створює порожню сесію. Заголовок уточниться після першої репліки. */
  app.post('/api/chat/sessions', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const now = new Date().toISOString();
      const requestedModel = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
      const session: StoredChatSession = {
        id: newId('chat'),
        userId: principal.id as string,
        title: typeof req.body?.title === 'string' && req.body.title.trim() ? req.body.title.trim() : 'Нова розмова',
        bookId: typeof req.body?.bookId === 'string' ? req.body.bookId : undefined,
        modelId: isKnownModel(requestedModel) ? requestedModel : deps.defaultModelId,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      await createChatSession(session);
      res.status(201).json({ session });
    } catch (err) {
      console.error('[chat] create session:', err);
      res.status(500).json({ error: 'Не вдалося створити розмову.' });
    }
  });

  /** Історія однієї сесії + її накопичені лічильники. */
  app.get('/api/chat/sessions/:id', requireAuth, async (req, res) => {
    try {
      const session = await loadOwnSession(req, res, req.params.id);
      if (!session) return;
      const messages = await listChatMessages(session.id);
      res.json({ session, messages });
    } catch (err) {
      console.error('[chat] get session:', err);
      res.status(500).json({ error: 'Не вдалося завантажити розмову.' });
    }
  });

  /** Видаляє сесію разом з її репліками (каскадом). */
  app.delete('/api/chat/sessions/:id', requireAuth, async (req, res) => {
    try {
      const session = await loadOwnSession(req, res, req.params.id);
      if (!session) return;
      await deleteChatSession(session.id);
      res.json({ ok: true });
    } catch (err) {
      console.error('[chat] delete session:', err);
      res.status(500).json({ error: 'Не вдалося видалити розмову.' });
    }
  });

  /**
   * Головний роут: додає репліку автора, викликає модель з контекстом
   * попередньої історії, зберігає відповідь і оновлює лічильники сесії.
   */
  app.post('/api/chat/sessions/:id/messages', requireAuth, async (req, res) => {
    try {
      const session = await loadOwnSession(req, res, req.params.id);
      if (!session) return;

      const content = req.body?.content;
      const validationError = validateMessage(content);
      if (validationError) {
        return res.status(400).json({ error: validationError });
      }

      const generate = deps.generate || demoReply;

      // Модель сесії; POST /messages може змінити її на льоту (модель
      // селектора чату) — тоді наступні репліки вже йдуть новою моделлю.
      let modelId = session.modelId || deps.defaultModelId;
      const requestedModel = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
      if (requestedModel && isKnownModel(requestedModel)) {
        modelId = requestedModel;
      }
      const engine = resolveEngine(modelId);

      // Прикріплені файли (кнопка-скріпка в чаті): зображення (jpg/png) йдуть
      // у справжній vision-запит, текст (txt/md/pdf — витягнутий на клієнті)
      // вбудовується прямо в репліку автора. Перевіряємо ще ДО запису
      // репліки й виклику моделі — щоб не рахувати квоту/зберігати чернетку
      // на очевидно неприпустимий запит.
      const rawImages = Array.isArray(req.body?.attachments?.images) ? req.body.attachments.images : [];
      const images = rawImages
        .filter(
          (img: any) =>
            img && typeof img.mimeType === 'string' && img.mimeType.startsWith('image/') &&
            typeof img.dataBase64 === 'string' && img.dataBase64.length > 0 && img.dataBase64.length < 8_000_000
        )
        .slice(0, MAX_ATTACHED_IMAGES)
        .map((img: any) => ({ mimeType: img.mimeType, dataBase64: img.dataBase64 }));
      const imageNames: string[] = rawImages.slice(0, MAX_ATTACHED_IMAGES).map((img: any, i: number) => img?.name || `зображення-${i + 1}`);

      if (images.length > 0 && !VISION_ENGINES.has(engine)) {
        return res.status(400).json({
          error: `Модель «${CHAT_MODELS.find((m) => m.id === modelId)?.label || modelId}» не аналізує зображення. Оберіть Gemini, GPT-4o або модель Claude.`,
          kind: 'vision_unsupported',
        });
      }

      const rawTextFiles = Array.isArray(req.body?.attachments?.textFiles) ? req.body.attachments.textFiles : [];
      const textFiles: ChatTextAttachment[] = rawTextFiles
        .filter((f: any) => f && typeof f.name === 'string' && typeof f.content === 'string' && f.content.trim())
        .slice(0, MAX_ATTACHED_TEXT_FILES)
        .map((f: any) => ({ name: f.name, content: f.content.slice(0, MAX_TEXT_ATTACHMENT_CHARS) }));

      // Жорсткий $-ліміт чату (Pro/Ultra): перевірка ДО запису репліки й до
      // виклику моделі, щоб не витрачати токени на заборонене повідомлення.
      if (deps.checkChatQuota) {
        const quota = await deps.checkChatQuota(session.userId, req.principal?.role || 'writer');
        if (!quota.allowed) {
          return res.status(403).json({
            error: quota.reasonUk || 'Вичерпано місячний ліміт чат-витрат вашого тарифу.',
            kind: 'chat_quota_exceeded',
            quota: quota.quota ?? null,
            remaining: quota.remaining ?? 0,
          });
        }
      }

      // Клієнт може надіслати повний потік розмови (`messages`) — та сама
      // логіка, що в Modul_token: модель бачить саме той контекст, що й
      // користувач у вікні чату. Якщо потік не надіслано — беремо історію
      // з бази, як раніше (надсилати його необов'язково).
      const clientHistory: { role: 'user' | 'assistant'; content: string }[] = Array.isArray(req.body?.messages)
        ? (req.body.messages as any[])
            .filter(
              (m: any) =>
                m &&
                (m.role === 'user' || m.role === 'assistant') &&
                typeof m.content === 'string' &&
                m.content.trim()
            )
            .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
            .slice(-CONTEXT_WINDOW_MESSAGES)
        : [];
      const history =
        clientHistory.length > 0
          ? clientHistory
          : (await listChatMessages(session.id)).map((m) => ({ role: m.role, content: m.content }));

      // Вкладені файли стають частиною репліки автора — так вони бачаться і
      // в промпті моделі, і в подальшій історії розмови (chat_messages не
      // має окремого поля для вкладень).
      const attachmentBlocks = textFiles.map((f) => `\n\n📄 Файл: ${f.name}\n${f.content}`).join('');
      const imageNote = images.length > 0 ? `\n\n🖼️ Прикріплено зображення: ${imageNames.join(', ')}` : '';
      const contentWithAttachments = `${content.trim()}${attachmentBlocks}${imageNote}`;
      const prompt = buildPromptContext(history, contentWithAttachments);

      let styleGuide: string | null = null;
      if (deps.loadStyleGuide) {
        // Стиль — приємний бонус, а не умова відповіді: якщо його не
        // вдалося прочитати, розмова має продовжитись, а не впасти.
        styleGuide = await deps.loadStyleGuide(session.userId).catch(() => null);
      }
      const modelLabel = CHAT_MODELS.find((m) => m.id === modelId)?.label || modelId;
      const systemPrompt = buildSystemPrompt(styleGuide, req.body?.bookContext, modelLabel);

      const now = new Date().toISOString();
      const userMessage: StoredChatMessage = {
        id: newId('msg'),
        sessionId: session.id,
        role: 'user',
        content: contentWithAttachments,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        createdAt: now,
      };
      await addChatMessage(userMessage);

      let aiResult: ChatAiResult;
      try {
        aiResult = await generate(prompt, systemPrompt, modelId, session.userId, images);
      } catch (err: any) {
        // Репліку автора вже збережено — це навмисно: він її написав, і
        // після повтору вона не має зникнути з історії. Повертаємо 502,
        // бо збій стався на боці зовнішнього провайдера, не в нас.
        console.error('[chat] AI error:', err);
        if (deps.onUsage) {
          await deps.onUsage(req, CHAT_USAGE_CONTEXT, modelId, 0, 0, false).catch(() => {});
        }
        return res.status(502).json({
          error: 'Модель не відповіла. Спробуйте ще раз за кілька секунд.',
          userMessage,
        });
      }

      const costUsd = priceForTextEngine(engine, aiResult.inputTokens, aiResult.outputTokens, modelId);
      const assistantMessage: StoredChatMessage = {
        id: newId('msg'),
        sessionId: session.id,
        role: 'assistant',
        content: aiResult.text,
        inputTokens: aiResult.inputTokens,
        outputTokens: aiResult.outputTokens,
        costUsd,
        createdAt: new Date().toISOString(),
      };
      await addChatMessage(assistantMessage);

      const updated: StoredChatSession = {
        ...session,
        modelId,
        title: session.messageCount === 0 ? deriveTitle(content) : session.title,
        totalInputTokens: session.totalInputTokens + aiResult.inputTokens,
        totalOutputTokens: session.totalOutputTokens + aiResult.outputTokens,
        totalCostUsd: session.totalCostUsd + costUsd,
        messageCount: session.messageCount + 2,
        updatedAt: new Date().toISOString(),
      };
      await updateChatSession(updated);

      if (deps.onUsage) {
        await deps
          .onUsage(req, CHAT_USAGE_CONTEXT, modelId, aiResult.inputTokens, aiResult.outputTokens, true)
          .catch(() => {});
      }

      res.json({ session: updated, userMessage, assistantMessage: { ...assistantMessage, model: modelId } });
    } catch (err) {
      console.error('[chat] post message:', err);
      res.status(500).json({ error: 'Не вдалося надіслати повідомлення.' });
    }
  });
}

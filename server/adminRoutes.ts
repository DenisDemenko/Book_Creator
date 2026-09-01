/**
 * API панелі адміністратора: користувачі, матриця прав і облік витрат.
 * Усі маршрути закриті requireAdmin.
 */

import type { Express } from 'express';
import {
  StoredRole,
  listUsers,
  findUserById,
  findUserByEmail,
  saveUser,
  deleteUser,
  deleteSessionsForUser,
  listUsage,
  listUsageSince,
  totalSpendUsd,
  spendByUser,
  clearUsage,
  getRoleOverrides,
  setRoleOverride,
  resetRoleOverrides,
  listPaymentsSince,
  listActiveSubscriptions,
  listAllChatSessions,
  listAllChatMessages,
  createChatSession,
  deleteChatSession,
  UsageRecord,
  StoredPayment,
} from './store';
import { CHAT_USAGE_CONTEXT } from './chatRoutes';
import { CHAT_MODELS, ENGINE_LABELS, engineConfigured } from './chatProviders';
import {
  requireAdmin,
  publicUser,
  ADMIN_EMAIL,
  BASE_SERVER_PERMISSIONS,
  effectivePermissions,
} from './auth';
import { pricingSnapshot } from './pricing';
import { IMAGE_ENGINES, seedreamConfig } from './imageGeneration';
import { SEEDREAM_FAL_MODEL } from './pricing';
import { geminiClient } from './aiCore';
import { PLANS, PLAN_ORDER, priceFor, type PlanId } from './subscriptions';
import { platformKeyFor } from './platformKeys';
import { paypalConfig } from './payments/paypal';
import {
  readBridgeSettingsView,
  saveBridgeSettings,
  readBridgeSettings,
  publishBookToMarketplace,
  MarketplaceBridgeError,
} from './marketplaceBridge';

const ALL_ROLES: StoredRole[] = [
  'admin',
  'writer',
  'designer',
  'translator',
  'publisher',
  'reader',
  'guest',
];

/** Групує записи витрат за довільним ключем і рахує суми. */
function summarize(records: UsageRecord[], keyOf: (r: UsageRecord) => string) {
  const map = new Map<string, { key: string; count: number; failed: number; costUsd: number }>();
  for (const r of records) {
    const key = keyOf(r);
    const row = map.get(key) || { key, count: 0, failed: 0, costUsd: 0 };
    row.count += 1;
    if (!r.success) row.failed += 1;
    row.costUsd += r.success ? r.costUsd : 0;
    map.set(key, row);
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd);
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Дохід платежу в гривні. Джерело — канонічна ціна плану (server/subscriptions.ts),
 * а не поле payments.amount: для LiqPay воно й так у грн, але для PayPal там
 * записана вже конвертована сума в доларах, а нам для порівняння з іншими
 * планами й днями потрібна одна валюта. Якщо план з якоїсь причини невідомий
 * (наприклад, тариф видалили з каталогу після оплати) — беремо amount як є,
 * з конвертацією USD→UAH за тим самим орієнтовним курсом, що й у PayPal.
 */
function revenueUahForPayment(p: StoredPayment): number {
  const def = PLANS[p.plan as PlanId];
  if (def) return priceFor(p.plan as PlanId, p.billingCycle);
  if (p.currency === 'UAH') return p.amount;
  return p.amount / paypalConfig.uahToUsdRate;
}

/** Місячний еквівалент ціни плану — для MRR (річна підписка ділиться на 12). */
function monthlyEquivalentUah(plan: PlanId, cycle: 'monthly' | 'annual'): number {
  const def = PLANS[plan];
  if (!def) return 0;
  return cycle === 'annual' ? def.priceAnnualUah / 12 : def.priceMonthlyUah;
}

export function registerAdminRoutes(app: Express): void {
  // ---------------------------------------------------------------------
  // Користувачі
  // ---------------------------------------------------------------------

  app.get('/api/admin/users', requireAdmin, async (_req, res) => {
    const users = await listUsers();
    // Витрати рахує база агрегатом — не тягнемо весь журнал у памʼять.
    const spend = await spendByUser();

    res.json({
      users: users
        .map((u) => ({
          ...publicUser(u),
          isProtectedAdmin: u.email.toLowerCase() === ADMIN_EMAIL,
          generations: spend.get(u.id)?.count || 0,
          spentUsd: Number((spend.get(u.id)?.costUsd || 0).toFixed(4)),
        }))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      roles: ALL_ROLES,
    });
  });

  app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
      const user = await findUserById(req.params.id);
      if (!user) return res.status(404).json({ error: 'Користувача не знайдено.' });

      const isProtectedAdmin = user.email.toLowerCase() === ADMIN_EMAIL;
      const { role, disabled, name } = req.body || {};
      const patch = { ...user };

      if (typeof role === 'string') {
        if (!ALL_ROLES.includes(role as StoredRole)) {
          return res.status(400).json({ error: `Невідома роль «${role}».` });
        }
        // Головного адміністратора не можна понизити — інакше можна
        // випадково залишити систему без жодного адміна.
        if (isProtectedAdmin && role !== 'admin') {
          return res.status(400).json({
            error: 'Не можна змінити роль головного адміністратора. Спершу задайте іншу пошту в ADMIN_EMAIL.',
          });
        }
        patch.role = role as StoredRole;
      }

      if (typeof disabled === 'boolean') {
        if (isProtectedAdmin && disabled) {
          return res.status(400).json({ error: 'Не можна заблокувати головного адміністратора.' });
        }
        patch.disabled = disabled;
      }

      if (typeof name === 'string' && name.trim()) patch.name = name.trim();

      await saveUser(patch);
      // Зміна ролі чи блокування має діяти негайно, а не після
      // закінчення сесії — тож виганяємо користувача з усіх пристроїв.
      if (patch.role !== user.role || patch.disabled !== user.disabled) {
        await deleteSessionsForUser(user.id);
      }

      res.json({ user: publicUser(patch) });
    } catch (err) {
      console.error('[admin] patch user:', err);
      res.status(500).json({ error: 'Не вдалося оновити користувача.' });
    }
  });

  app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    const user = await findUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Користувача не знайдено.' });
    if (user.email.toLowerCase() === ADMIN_EMAIL) {
      return res.status(400).json({ error: 'Не можна видалити головного адміністратора.' });
    }
    await deleteUser(user.id);
    res.json({ ok: true });
  });

  /** Створення користувача руками адміністратора (без запрошень поштою). */
  app.post('/api/admin/users', requireAdmin, async (req, res) => {
    try {
      const { email, name, role } = req.body || {};
      if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
        return res.status(400).json({ error: 'Вкажіть коректну пошту.' });
      }
      const normalized = email.trim().toLowerCase();
      if (await findUserByEmail(normalized)) {
        return res.status(409).json({ error: 'Такий користувач уже існує.' });
      }
      if (role && !ALL_ROLES.includes(role)) {
        return res.status(400).json({ error: `Невідома роль «${role}».` });
      }

      const user = {
        id: `usr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        email: normalized,
        name: (typeof name === 'string' && name.trim()) || normalized.split('@')[0],
        role: (normalized === ADMIN_EMAIL ? 'admin' : role || 'reader') as StoredRole,
        createdAt: new Date().toISOString(),
      };
      await saveUser(user);
      res.json({
        user: publicUser(user),
        note: 'Користувач створений без пароля — увійти зможе через Google або після скидання пароля.',
      });
    } catch (err) {
      console.error('[admin] create user:', err);
      res.status(500).json({ error: 'Не вдалося створити користувача.' });
    }
  });

  // ---------------------------------------------------------------------
  // Матриця прав
  // ---------------------------------------------------------------------

  app.get('/api/admin/roles', requireAdmin, async (_req, res) => {
    const overrides = await getRoleOverrides();
    const roles = await Promise.all(
      ALL_ROLES.map(async (role) => ({
        role,
        defaults: BASE_SERVER_PERMISSIONS[role],
        overrides: overrides[role] || {},
        effective: await effectivePermissions(role),
      }))
    );
    res.json({ roles, permissionKeys: Object.keys(BASE_SERVER_PERMISSIONS.admin) });
  });

  app.patch('/api/admin/roles/:role', requireAdmin, async (req, res) => {
    const role = req.params.role as StoredRole;
    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ error: `Невідома роль «${role}».` });
    }
    if (role === 'admin') {
      return res.status(400).json({
        error: 'Права адміністратора незмінні — інакше можна забрати доступ у самого себе.',
      });
    }

    const permissions = req.body?.permissions;
    if (!permissions || typeof permissions !== 'object') {
      return res.status(400).json({ error: 'Очікується обʼєкт permissions.' });
    }

    const known = new Set(Object.keys(BASE_SERVER_PERMISSIONS.admin));
    const clean: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(permissions)) {
      if (known.has(key) && typeof value === 'boolean') clean[key] = value;
    }
    if (Object.keys(clean).length === 0) {
      return res.status(400).json({ error: 'Жодного відомого дозволу не передано.' });
    }

    await setRoleOverride(role, clean);
    res.json({ role, effective: await effectivePermissions(role) });
  });

  app.post('/api/admin/roles/:role/reset', requireAdmin, async (req, res) => {
    const role = req.params.role as StoredRole;
    if (!ALL_ROLES.includes(role)) {
      return res.status(400).json({ error: `Невідома роль «${role}».` });
    }
    await resetRoleOverrides(role);
    res.json({ role, effective: await effectivePermissions(role) });
  });

  // ---------------------------------------------------------------------
  // Витрати
  // ---------------------------------------------------------------------

  app.get('/api/admin/usage', requireAdmin, async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();
    const records = await listUsageSince(sinceIso);
    const allTimeUsd = await totalSpendUsd();

    const successful = records.filter((r) => r.success);
    const totalUsd = successful.reduce((a, r) => a + r.costUsd, 0);

    const today = new Date().toISOString().slice(0, 10);
    const todayUsd = successful
      .filter((r) => r.timestamp.slice(0, 10) === today)
      .reduce((a, r) => a + r.costUsd, 0);

    res.json({
      periodDays: days,
      pricing: pricingSnapshot(),
      totals: {
        generations: records.length,
        successful: successful.length,
        failed: records.length - successful.length,
        totalUsd: Number(totalUsd.toFixed(4)),
        todayUsd: Number(todayUsd.toFixed(4)),
        averageUsd: successful.length ? Number((totalUsd / successful.length).toFixed(4)) : 0,
        allTimeUsd: Number(allTimeUsd.toFixed(4)),
      },
      byEngine: summarize(records, (r) => r.engineId),
      byUser: summarize(records, (r) => r.userEmail),
      byRole: summarize(records, (r) => r.role),
      byDay: summarize(records, (r) => dayKey(r.timestamp)).sort((a, b) =>
        a.key.localeCompare(b.key)
      ),
      recent: records.slice(-50).reverse(),
    });
  });

  app.post('/api/admin/usage/clear', requireAdmin, async (_req, res) => {
    await clearUsage();
    res.json({ ok: true });
  });

  /** Прайс окремо — щоб калькулятор міг рахувати прогнози без журналу. */
  app.get('/api/admin/pricing', requireAdmin, (_req, res) => {
    res.json(pricingSnapshot());
  });

  // ---------------------------------------------------------------------
  // Тарифи та аналітика ШІ (вкладка адмінки, інтеграція Modul_token)
  // ---------------------------------------------------------------------

  /**
   * Прайс текстових двигунів у форматі, зручному для вкладки «Тарифи та
   * аналітика ШІ» (та сама форма, що й у Modul_token ModelPricing): ціни
   * за 1k токенів, прапорець is_active = чи налаштований відповідний ключ.
   */
  app.get('/api/admin/ai/pricing', requireAdmin, async (_req, res) => {
    const snapshot = pricingSnapshot();
    const providerByEngine: Record<string, string> = {
      gemini: 'Google',
      gpt: 'OpenAI',
      claude: 'Anthropic',
      deepseek: 'DeepSeek',
      groq: 'Meta',
      mistral: 'Mistral',
    };
    const pricings = Object.entries(snapshot.textEngines).map(([engine, p]) => ({
      id: `pricing-${engine}`,
      provider: providerByEngine[engine] || engine,
      model: p.modelId,
      display_name: `${p.modelId} (${ENGINE_LABELS[engine as keyof typeof ENGINE_LABELS] || engine})`,
      input_price_per_1k: p.inputPerMillionUsd / 1000,
      output_price_per_1k: p.outputPerMillionUsd / 1000,
      is_active: engineConfigured(engine as keyof typeof ENGINE_LABELS),
      updated_at: snapshot.updatedAt,
      note: p.note,
    }));
    // Двигуни ЗОБРАЖЕНЬ у тій самій таблиці тарифів.
    //
    // Досі сюди потрапляли лише текстові. Витрати на картинки чесно
    // писались у usage_log і вже показувались у графіках нижче — але
    // тарифу, за яким їх пораховано, адмін ніде не бачив: міг звірити
    // суму, але не ціну за одиницю.
    //
    // Провайдер і доступність беруться з IMAGE_ENGINES та seedreamConfig —
    // тих самих джерел, що й /api/ai/image-engines, щоб два екрани не
    // розійшлися у відповіді на питання «чи цей двигун працює».
    const imageProviderLabel: Record<string, string> = {
      google: 'Google',
      bytedance: 'ByteDance',
    };
    const imagePricings = snapshot.images.map((img) => {
      const engine = IMAGE_ENGINES[img.engineId as keyof typeof IMAGE_ENGINES];
      // Тарифи fal стоять у прайсі під ключем МОДЕЛІ, а не двигуна:
      // одна й та сама «seedream» коштує по-різному на 4.0 і 4.5, тож
      // у IMAGE_ENGINES такого запису немає й бути не може.
      const falModel = img.engineId.startsWith('fal-ai/');
      const falActive = falModel && img.engineId === SEEDREAM_FAL_MODEL && seedreamConfig.enabled;
      const sizes = Object.entries(img.perImageUsd) as [string, number][];
      const flat = sizes.length === 1;
      return {
        id: `pricing-image-${img.engineId}`,
        provider: falModel ? 'ByteDance' : imageProviderLabel[engine?.provider ?? ''] || 'Зображення',
        model: img.modelId,
        display_name: `${img.modelId} (${img.label})`,
        // Ціна за зображення кладеться у «ціну виходу», бо саме її показує
        // таблиця; вхідної ціни в картинок немає, тож там нуль. Щоб це не
        // читалось як «за 1000 штук», одиницю пояснює note нижче.
        input_price_per_1k: 0,
        output_price_per_1k: Math.max(...sizes.map(([, v]) => v)),
        // Активний рівно той тариф, за яким платформа справді працює:
        // з двох версій fal одночасно діє лише налаштована.
        is_active: falModel
          ? falActive
          : engine?.provider === 'bytedance'
            ? seedreamConfig.enabled
            : !!geminiClient,
        updated_at: snapshot.updatedAt,
        note: flat
          ? `Ціна за ОДНЕ зображення: ${sizes[0][1]} (будь-яка роздільність)`
          : `Ціна за ОДНЕ зображення: ${sizes.map(([k, v]) => `${k} — ${v}`).join(', ')}`,
      };
    });

    // Озвучення (ElevenLabs) — платформний ключ, як і Seedream: перевіряємо
    // async platformKeyFor(), бо на відміну від зображень тут НЕМАЄ
    // серверної змінної оточення як типового шляху — лише ключ адміна.
    const elevenlabsKey = await platformKeyFor('elevenlabs');
    const narrationPricing = {
      id: 'pricing-audio-elevenlabs',
      provider: 'ElevenLabs',
      model: snapshot.narration.modelId,
      display_name: `${snapshot.narration.modelId} (${snapshot.narration.label})`,
      input_price_per_1k: 0,
      output_price_per_1k: snapshot.narration.perThousandCharsUsd,
      is_active: !!elevenlabsKey || !!process.env.ELEVENLABS_API_KEY,
      updated_at: snapshot.updatedAt,
      note: `Ціна за 1000 СИМВОЛІВ тексту (не зображень і не токенів): ${snapshot.narration.perThousandCharsUsd}. Доступно тарифам Pro/Ultra.`,
    };

    res.json({
      updatedAt: snapshot.updatedAt,
      currency: 'USD',
      pricings: [...pricings, ...imagePricings, narrationPricing],
    });
  });

  /**
   * Аналітика для вкладки «Тарифи та аналітика ШІ»: токени й витрати по
   * днях (7 днів), розподіл витрат за моделями, список сесій для
   * CSV-експорту. Джерела — chat_sessions / chat_messages (для точних
   * токенів чату) і usage_log (для ПОВНОЇ картини витрат — редагування
   * тексту, персонажі, ілюстрації, обкладинки, KDP-форматування,
   * тренування тощо, не лише чат).
   *
   * До виправлення (grill-me сесія, 2026-08-23) velocity_7d і
   * cost_distribution рахувались ВИКЛЮЧНО з chat_sessions/chat_messages —
   * будь-яка нечат AI-витрата була тут невидимою, хоча коректно писалась
   * у usage_log і показувалась іншою адмінською вкладкою (/api/admin/usage).
   * Токени для нечат-викликів у usage_log не зберігаються окремим полем
   * (схема usage_log має лише cost_usd, не input/output tokens), тож для
   * таких записів tokens чесно лишається 0, а не вигаданим числом —
   * вартість же враховується завжди.
   */
  app.get('/api/admin/ai/analytics', requireAdmin, async (_req, res) => {
    const [sessions, messages, usage] = await Promise.all([
      listAllChatSessions(),
      listAllChatMessages(),
      listUsageSince(new Date(Date.now() - 30 * 86400_000).toISOString()),
    ]);

    const modelOf = new Map(sessions.map((s) => [s.id, s.modelId]));
    const dayKey = (iso: string) => iso.slice(0, 10);
    const successfulUsage = usage.filter((r) => r.success);
    // Нечат-витрати — усе, що НЕ пішло через чат-сесії (щоб не рахувати
    // чат двічі: він уже точно врахований через chat_messages нижче).
    const nonChatUsage = successfulUsage.filter((r) => r.context !== CHAT_USAGE_CONTEXT);

    // Останні 7 днів — токени й вартість по репліках асистента (чат) +
    // вартість решти AI-викликів продукту з usage_log за той самий день.
    const velocity: { day: string; tokens: number; cost: number; isPeak?: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const key = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      const dayMsgs = messages.filter((m) => m.role === 'assistant' && dayKey(m.createdAt) === key);
      const tokens = dayMsgs.reduce((s, m) => s + m.inputTokens + m.outputTokens, 0);
      const chatCost = dayMsgs.reduce((s, m) => s + (m.costUsd || 0), 0);
      const otherCost = nonChatUsage
        .filter((r) => dayKey(r.timestamp) === key)
        .reduce((s, r) => s + r.costUsd, 0);
      velocity.push({ day: key, tokens, cost: chatCost + otherCost });
    }
    const maxTokens = Math.max(...velocity.map((v) => v.tokens), 1);
    velocity.forEach((v) => {
      v.isPeak = v.tokens > 0 && v.tokens === maxTokens;
    });

    // Розподіл витрат за моделями: спершу чат (модель береться з сесії
    // репліки, токени точні), потім усі решта AI-інструментів продукту з
    // usage_log за реальним model_id (токени невідомі на цьому рівні — 0,
    // а не вигадані; вартість же завжди реальна).
    const byModel = new Map<string, { cost: number; tokens: number }>();
    let totalTokens = 0;
    let totalCost = 0;
    for (const m of messages) {
      if (m.role !== 'assistant') continue;
      const model = modelOf.get(m.sessionId) || 'невідомо';
      const row = byModel.get(model) || { cost: 0, tokens: 0 };
      row.cost += m.costUsd || 0;
      row.tokens += m.inputTokens + m.outputTokens;
      byModel.set(model, row);
      totalTokens += m.inputTokens + m.outputTokens;
      totalCost += m.costUsd || 0;
    }
    for (const r of nonChatUsage) {
      const model = r.modelId || r.engineId || 'невідомо';
      const row = byModel.get(model) || { cost: 0, tokens: 0 };
      row.cost += r.costUsd;
      byModel.set(model, row);
      totalCost += r.costUsd;
    }
    const costDistribution = [...byModel.entries()]
      .map(([model, v]) => ({
        model,
        cost: v.cost,
        tokens: v.tokens,
        percentage: totalCost > 0 ? (v.cost / totalCost) * 100 : 0,
      }))
      .sort((a, b) => b.cost - a.cost);

    // Рівень помилок — частка невдалих звернень чату в журналі за 30 днів.
    const chatUsage = usage.filter((r) => r.kind === 'text' && r.context === CHAT_USAGE_CONTEXT);
    const failed = chatUsage.filter((r) => !r.success).length;
    const errorRate = chatUsage.length > 0 ? (failed / chatUsage.length) * 100 : 0;

    const activeSessions = sessions.length;
    const sessionList = sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.messageCount > 0 ? 'active' : 'idle',
      model: s.modelId,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
      total_input_tokens: s.totalInputTokens,
      total_output_tokens: s.totalOutputTokens,
      total_tokens: s.totalInputTokens + s.totalOutputTokens,
      total_cost: s.totalCostUsd,
    }));

    res.json({
      analytics: {
        total_cost: totalCost,
        total_tokens: totalTokens,
        active_sessions_count: activeSessions,
        avg_cost_per_session: activeSessions ? totalCost / activeSessions : 0,
        cache_hit_rate: 0,
        avg_latency_ms: 0,
        error_rate: errorRate,
        velocity_7d: velocity,
        cost_distribution: costDistribution,
      },
      sessions: sessionList,
      models: CHAT_MODELS,
    });
  });

  /**
   * Створює тестову чат-сесію під обліковим записом самого адміна — щоб
   * перевірити модель/тарифи прямо з вкладки «Тарифи та аналітика ШІ», без
   * переходу у звичайний чат письменника. Той самий конструктор сесії, що в
   * POST /api/chat/sessions (server/chatRoutes.ts).
   */
  app.post('/api/admin/chat/sessions', requireAdmin, async (req, res) => {
    try {
      const principal = req.principal!;
      const now = new Date().toISOString();
      const requestedModel = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
      const modelId = CHAT_MODELS.some((m) => m.id === requestedModel) ? requestedModel : CHAT_MODELS[0].id;
      const session = {
        id: `chat-admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        userId: principal.id as string,
        title: 'Тестова сесія (адмін)',
        modelId,
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
      console.error('[admin] create chat session:', err);
      res.status(500).json({ error: 'Не вдалося створити тестову сесію.' });
    }
  });

  /** Видаляє будь-яку чат-сесію (модерація) — доступно лише адміну. */
  app.delete('/api/admin/chat/sessions/:id', requireAdmin, async (req, res) => {
    try {
      const deleted = await deleteChatSession(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Сесію не знайдено.' });
      res.json({ ok: true });
    } catch (err) {
      console.error('[admin] delete chat session:', err);
      res.status(500).json({ error: 'Не вдалося видалити сесію.' });
    }
  });

  // ---------------------------------------------------------------------
  // Бізнес-аналітика: дохід від підписок проти витрат на ШІ-генерацію
  // ---------------------------------------------------------------------

  /**
   * Порівняння надходжень (LiqPay + PayPal) і собівартості генерацій
   * (зображення + текст, усі двигуни) для бізнес-плану просування сайту.
   *
   * Дохід рахується в гривні (канонічна ціна плану — revenueUahForPayment),
   * витрати — у доларах (server/pricing.ts, як і раніше в /api/admin/usage).
   * Щоб звести їх в один валовий маржинал, дохід додатково конвертується
   * в долари за PAYPAL_UAH_TO_USD_RATE — це те саме орієнтовне наближення,
   * що й для самих платежів PayPal, а не курс НБУ в реальному часі.
   */
  app.get('/api/admin/revenue', requireAdmin, async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const [payments, usageRecords, activeSubs] = await Promise.all([
      listPaymentsSince(sinceIso),
      listUsageSince(sinceIso),
      listActiveSubscriptions(),
    ]);

    const paidPayments = payments.filter((p) => p.status === 'paid');
    const successfulUsage = usageRecords.filter((r) => r.success);
    const imageUsage = successfulUsage.filter((r) => r.kind === 'image');
    const textUsage = successfulUsage.filter((r) => r.kind === 'text');

    const rate = paypalConfig.uahToUsdRate;

    const totalRevenueUah = paidPayments.reduce((sum, p) => sum + revenueUahForPayment(p), 0);
    const totalImageCostUsd = imageUsage.reduce((sum, r) => sum + r.costUsd, 0);
    const totalTextCostUsd = textUsage.reduce((sum, r) => sum + r.costUsd, 0);
    const totalCostUsd = totalImageCostUsd + totalTextCostUsd;
    const totalRevenueUsd = totalRevenueUah * rate;
    const grossMarginUsd = totalRevenueUsd - totalCostUsd;
    const grossMarginPct = totalRevenueUsd > 0 ? Number(((grossMarginUsd / totalRevenueUsd) * 100).toFixed(1)) : null;

    // MRR — на основі активних підписок просто зараз, незалежно від periodDays.
    const mrrUah = activeSubs.reduce(
      (sum, s) => sum + monthlyEquivalentUah(s.plan as PlanId, s.billingCycle),
      0
    );

    // Дохід і витрати за днями — два ряди, зручні для одного лінійного графіка.
    const revenueByDayMap = new Map<string, number>();
    for (const p of paidPayments) {
      const key = dayKey(p.updatedAt || p.createdAt);
      revenueByDayMap.set(key, (revenueByDayMap.get(key) || 0) + revenueUahForPayment(p));
    }
    const costByDayMap = new Map<string, { imageUsd: number; textUsd: number }>();
    for (const r of successfulUsage) {
      const key = dayKey(r.timestamp);
      const row = costByDayMap.get(key) || { imageUsd: 0, textUsd: 0 };
      if (r.kind === 'image') row.imageUsd += r.costUsd;
      else row.textUsd += r.costUsd;
      costByDayMap.set(key, row);
    }
    const allDays = new Set<string>([...revenueByDayMap.keys(), ...costByDayMap.keys()]);
    const byDay = [...allDays]
      .sort()
      .map((key) => {
        const cost = costByDayMap.get(key) || { imageUsd: 0, textUsd: 0 };
        const revenueUah = revenueByDayMap.get(key) || 0;
        return {
          day: key,
          revenueUah: Number(revenueUah.toFixed(2)),
          revenueUsd: Number((revenueUah * rate).toFixed(4)),
          imageCostUsd: Number(cost.imageUsd.toFixed(4)),
          textCostUsd: Number(cost.textUsd.toFixed(4)),
          totalCostUsd: Number((cost.imageUsd + cost.textUsd).toFixed(4)),
        };
      });

    // Дохід за планами — скільки саме приносить кожен тариф.
    const revenueByPlanMap = new Map<string, { plan: string; nameUk: string; revenueUah: number; count: number }>();
    for (const p of paidPayments) {
      const def = PLANS[p.plan as PlanId];
      const row = revenueByPlanMap.get(p.plan) || { plan: p.plan, nameUk: def?.nameUk || p.plan, revenueUah: 0, count: 0 };
      row.revenueUah += revenueUahForPayment(p);
      row.count += 1;
      revenueByPlanMap.set(p.plan, row);
    }
    const revenueByPlan = [...revenueByPlanMap.values()]
      .map((r) => ({ ...r, revenueUah: Number(r.revenueUah.toFixed(2)) }))
      .sort((a, b) => b.revenueUah - a.revenueUah);

    // Активні підписники за планами (включно з тими, хто на free — рахуємо
    // окремо, бо для free записів у subscriptions зазвичай нема).
    const subscribersByPlanMap = new Map<string, number>();
    for (const s of activeSubs) {
      subscribersByPlanMap.set(s.plan, (subscribersByPlanMap.get(s.plan) || 0) + 1);
    }
    const activeSubscribersByPlan = PLAN_ORDER.filter((p) => p !== 'free').map((plan) => ({
      plan,
      nameUk: PLANS[plan].nameUk,
      count: subscribersByPlanMap.get(plan) || 0,
    }));

    // Собівартість ШІ за двигуном (усередині image/text) — щоб бачити, чи
    // GPT дорожчий за Gemini для того самого обсягу тексту.
    const costByEngine = summarize(successfulUsage, (r) => `${r.kind}:${r.engineId}`).map((row) => {
      const [kind, engineId] = row.key.split(':');
      return { kind, engineId, costUsd: Number(row.costUsd.toFixed(4)), count: row.count };
    });

    res.json({
      periodDays: days,
      exchangeRate: { uahToUsd: rate, note: 'Орієнтовний курс PAYPAL_UAH_TO_USD_RATE — не курс НБУ в реальному часі.' },
      totals: {
        revenueUah: Number(totalRevenueUah.toFixed(2)),
        revenueUsd: Number(totalRevenueUsd.toFixed(2)),
        imageCostUsd: Number(totalImageCostUsd.toFixed(4)),
        textCostUsd: Number(totalTextCostUsd.toFixed(4)),
        totalCostUsd: Number(totalCostUsd.toFixed(4)),
        grossMarginUsd: Number(grossMarginUsd.toFixed(2)),
        grossMarginPct,
        paidPaymentsCount: paidPayments.length,
        mrrUah: Number(mrrUah.toFixed(2)),
        activeSubscribersCount: activeSubs.length,
      },
      byDay,
      revenueByPlan,
      activeSubscribersByPlan,
      costByEngine,
    });
  });

  // ---------------------------------------------------------------------
  // Міст до вітрини Fusion Lab
  // ---------------------------------------------------------------------

  /**
   * Адреса API маркетплейсу і спільний ключ мосту. Живуть у БД, а не в
   * змінних оточення, щоб власник міняв їх з адмінпанелі без передеплою.
   * Назовні ключ ніколи не віддається — лише факт наявності й відбиток.
   */
  app.get('/api/admin/marketplace-bridge', requireAdmin, async (_req, res) => {
    res.json(await readBridgeSettingsView());
  });

  app.put('/api/admin/marketplace-bridge', requireAdmin, async (req, res) => {
    const { url, key } = req.body || {};
    try {
      res.json(await saveBridgeSettings({ url, key }));
    } catch (err: any) {
      const status = err instanceof MarketplaceBridgeError ? err.status : 500;
      res.status(status).json({ error: err?.message || 'Не вдалося зберегти налаштування мосту.', kind: err?.kind });
    }
  });

  /**
   * Перевірка зв'язку: свідомо б'ємо в /health маркетплейсу, а не в
   * /bridge/books — тест не повинен створювати справжній лістинг.
   */
  app.post('/api/admin/marketplace-bridge/test', requireAdmin, async (_req, res) => {
    try {
      const settings = await readBridgeSettings();
      const response = await fetch(`${settings.url}/health`, { signal: AbortSignal.timeout(15000) });
      const body = await response.text().catch(() => '');
      res.json({ ok: response.ok, status: response.status, body: body.slice(0, 300) });
    } catch (err: any) {
      const status = err instanceof MarketplaceBridgeError ? err.status : 502;
      res.status(status).json({ error: err?.message || 'Маркетплейс не відповідає.', kind: err?.kind || 'unreachable' });
    }
  });

  /**
   * Публікація книги у вітрину. Два формати — два лістинги: у маркетплейсі
   * одна ціна на лістинг, тож друкована й електронна версії живуть як
   * сусідні товари, повʼязані спільним bookId у externalId.
   */
  app.post('/api/admin/marketplace-bridge/publish', requireAdmin, async (req, res) => {
    const { bookId, title, subtitle, summary, description, coverUrl, highlights, sellerSlug, formats } = req.body || {};
    if (!bookId || !title) {
      return res.status(400).json({ error: 'Потрібні bookId і title.', kind: 'bad_input' });
    }
    const list = Array.isArray(formats) ? formats : [];
    if (list.length === 0) {
      return res.status(400).json({ error: 'Не вказано жодного формату з ціною.', kind: 'bad_input' });
    }

    try {
      const settings = await readBridgeSettings();
      const results = [];
      for (const entry of list) {
        const format = entry?.format === 'print' ? 'print' : 'digital';
        const priceMinor = Number(entry?.priceMinor);
        if (!Number.isFinite(priceMinor) || priceMinor < 0) {
          return res.status(400).json({ error: `Некоректна ціна для формату «${format}».`, kind: 'bad_input' });
        }
        results.push(
          await publishBookToMarketplace(
            { bookId, format, title, subtitle, summary, description, priceMinor, coverUrl, highlights, sellerSlug },
            { settings }
          )
        );
      }
      res.json({ published: results });
    } catch (err: any) {
      const status = err instanceof MarketplaceBridgeError ? err.status : 500;
      res.status(status).json({
        error: err?.message || 'Не вдалося опублікувати книгу у вітрині.',
        kind: err?.kind,
        details: err?.details,
      });
    }
  });
}

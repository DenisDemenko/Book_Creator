/**
 * Борд витрат і розподіл собівартості (задача #211).
 *
 * ЧОМУ ЦЕ ЗʼЯВИЛОСЬ. Вкладка «Витрати на API» вже рахує вартість ШІ-генерацій
 * автоматично з usage_log, але це лише одна стаття витрат. Railway (хостинг
 * і диск /data), та довільні інші накладні витрати ніде не збирались разом,
 * і не було способу розкласти їх на собівартість одиниці товару — а бізнес
 * продає три різні лінійки (матеріальні товари/меблі, книги, тренінги), і
 * загальні витрати мають лягати на кожну пропорційно обсягу продажів.
 *
 * МОДЕЛЬ. Один borde на календарний місяць (`period` = 'YYYY-MM'):
 *   • Витрати ШІ — рахуються АВТОМАТИЧНО з usage_log (та сама функція
 *     listUsageSince(), що й server/usageRoutes.ts), редагувати їх тут не можна.
 *   • Railway та «інші» витрати — рядки, які вносить адмін вручну (сума в $).
 *     Для Railway "автоматичне зчитування" — це ЧЕСНО те, що дозволяє публічне
 *     API Railway: розмір тому (GB), НЕ грошову вартість (Railway не віддає
 *     біллінг через API, лише через дашборд/CLI — перевірено в задачі #211).
 *     Тому сама сума $ завжди вводиться вручну, а розмір тому — опційно
 *     підтягується кнопкою «Оновити з Railway» як довідкове число поруч.
 *   • Мікс продажів — план і факт кількості проданого на кожну з трьох
 *     категорій за місяць. Факт для ПОТОЧНОГО місяця можна вносити лише з
 *     15-го числа (до того реальних продажів за місяць ще не видно) — для
 *     минулих місяців корекція дозволена завжди (закриття звітності).
 *
 * Сховище — той самий патерн, що й server/furnitureCalculatorRoutes.ts:
 * JSON під ключем `meta` (getAppSetting/setAppSetting), а не нова SQL-таблиця
 * — обсяг даних (кілька рядків витрат і 3 категорії на місяць) для цього
 * замалий, щоб виправдати окрему схему й JSON-запасний бекенд під неї.
 *
 * Токен Railway шифрується тим самим модулем, що й власні ключі ШІ автора
 * (server/userApiKeyCrypto.ts, AES-256-GCM) — у відповіді назовні йде лише
 * fingerprint, ніколи сирий токен.
 *
 * Усі маршрути — requireAdmin: це фінансові дані собівартості, той самий
 * рівень доступу, що й у furnitureCalculatorRoutes.ts.
 */

import type { Express } from 'express';
import crypto from 'node:crypto';
import { requireAdmin } from './auth';
import { getAppSetting, setAppSetting, listUsageSince } from './store';
import { encryptApiKey, decryptApiKey, apiKeyFingerprint, isApiKeyCryptoConfigured } from './userApiKeyCrypto';

export type ExpenseKind = 'railway' | 'other';
export type ProductCategory = 'goods' | 'books' | 'trainings';

const CATEGORIES: ProductCategory[] = ['goods', 'books', 'trainings'];
const CATEGORY_LABELS_UK: Record<ProductCategory, string> = {
  goods: 'Матеріальні товари',
  books: 'Книги',
  trainings: 'Тренінги',
};

interface ExpenseLineItem {
  id: string;
  kind: ExpenseKind;
  label: string;
  amountUsd: number;
  note: string;
  createdAt: string;
  updatedAt: string;
}

interface SalesMixEntry {
  plannedUnits: number;
  actualUnits: number | null;
  updatedAt: string;
}

interface ExpenseBoardData {
  expenses: ExpenseLineItem[];
  salesMix: Record<ProductCategory, SalesMixEntry>;
}

interface RailwaySettings {
  encryptedToken?: string;
  tokenFingerprint?: string;
  volumeId?: string;
  lastCurrentMb?: number;
  lastSizeMb?: number;
  lastSyncedAt?: string;
}

const RAILWAY_SETTINGS_KEY = 'expense_board_railway_settings';
const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2';

function boardKey(period: string): string {
  return `expense_board:${period}`;
}

function isValidPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/** Межі календарного місяця в UTC — для фільтрації usage_log за period. */
function monthBounds(period: string): { startIso: string; endIsoExclusive: string } {
  const [y, m] = period.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  return { startIso: start.toISOString(), endIsoExclusive: end.toISOString() };
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function emptyBoard(): ExpenseBoardData {
  const now = new Date().toISOString();
  const blankEntry = (): SalesMixEntry => ({ plannedUnits: 0, actualUnits: null, updatedAt: now });
  return {
    expenses: [],
    salesMix: { goods: blankEntry(), books: blankEntry(), trainings: blankEntry() },
  };
}

async function readBoard(period: string): Promise<ExpenseBoardData> {
  const raw = await getAppSetting(boardKey(period));
  const base = emptyBoard();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<ExpenseBoardData>;
    return {
      expenses: Array.isArray(parsed.expenses) ? (parsed.expenses as ExpenseLineItem[]) : [],
      salesMix: {
        goods: { ...base.salesMix.goods, ...((parsed.salesMix as any)?.goods || {}) },
        books: { ...base.salesMix.books, ...((parsed.salesMix as any)?.books || {}) },
        trainings: { ...base.salesMix.trainings, ...((parsed.salesMix as any)?.trainings || {}) },
      },
    };
  } catch {
    return base;
  }
}

async function writeBoard(period: string, data: ExpenseBoardData): Promise<void> {
  await setAppSetting(boardKey(period), JSON.stringify(data));
}

async function readRailwaySettings(): Promise<RailwaySettings> {
  const raw = await getAppSetting(RAILWAY_SETTINGS_KEY);
  if (!raw) return {};
  try {
    return (JSON.parse(raw) as RailwaySettings) || {};
  } catch {
    return {};
  }
}

async function writeRailwaySettings(settings: RailwaySettings): Promise<void> {
  await setAppSetting(RAILWAY_SETTINGS_KEY, JSON.stringify(settings));
}

/** Сума успішних генерацій ШІ за календарний місяць — з того самого журналу, що й «Витрати на API». */
async function computeAiCostForPeriod(period: string): Promise<number> {
  const { startIso, endIsoExclusive } = monthBounds(period);
  const records = await listUsageSince(startIso);
  const total = records
    .filter((r) => r.success && r.timestamp < endIsoExclusive)
    .reduce((sum, r) => sum + (r.costUsd || 0), 0);
  return round(total, 4);
}

/**
 * Чи можна зараз редагувати «факт» для цього періоду.
 *   • Майбутній місяць — ще зарано, факту продажів немає.
 *   • Минулий місяць — можна завжди (коригування вже закритої звітності).
 *   • Поточний місяць — лише з 15-го числа (до того половина місяця ще
 *     попереду, і «факт» був би не точнішим за план).
 */
function actualEditableCheck(period: string): { editable: boolean; reasonUk?: string } {
  const now = currentPeriod();
  if (period > now) {
    return { editable: false, reasonUk: 'Фактичні числа для майбутнього місяця вносити зарано — спершу настане цей місяць.' };
  }
  if (period < now) {
    return { editable: true };
  }
  const dayOfMonth = new Date().getUTCDate();
  if (dayOfMonth < 15) {
    return {
      editable: false,
      reasonUk: 'Фактичні числа поточного місяця можна вносити з 15-го числа. До того використовується план.',
    };
  }
  return { editable: true };
}

async function computeSummary(period: string, board: ExpenseBoardData) {
  const aiCostUsd = await computeAiCostForPeriod(period);
  const railwayCostUsd = round(
    board.expenses.filter((e) => e.kind === 'railway').reduce((sum, e) => sum + e.amountUsd, 0),
    2
  );
  const otherCostUsd = round(
    board.expenses.filter((e) => e.kind === 'other').reduce((sum, e) => sum + e.amountUsd, 0),
    2
  );
  const totalExpensesUsd = round(aiCostUsd + railwayCostUsd + otherCostUsd, 2);

  const gate = actualEditableCheck(period);

  let totalUnits = 0;
  const effectiveUnits: Record<ProductCategory, number> = { goods: 0, books: 0, trainings: 0 };
  for (const cat of CATEGORIES) {
    const entry = board.salesMix[cat];
    const eff = Math.max(0, entry.actualUnits ?? entry.plannedUnits ?? 0);
    effectiveUnits[cat] = eff;
    totalUnits += eff;
  }

  const overheadPerUnitUsd = totalUnits > 0 ? totalExpensesUsd / totalUnits : 0;

  const breakdown = CATEGORIES.map((cat) => {
    const units = effectiveUnits[cat];
    const sharePercent = totalUnits > 0 ? round((units / totalUnits) * 100, 1) : 0;
    const allocatedCostUsd = round(units * overheadPerUnitUsd, 2);
    return {
      category: cat,
      labelUk: CATEGORY_LABELS_UK[cat],
      units,
      sharePercent,
      allocatedCostUsd,
      costPerUnitUsd: round(overheadPerUnitUsd, 4),
    };
  });

  return {
    period,
    aiCostUsd,
    railwayCostUsd,
    otherCostUsd,
    totalExpensesUsd,
    expenses: board.expenses,
    salesMix: board.salesMix,
    totalUnits,
    overheadPerUnitUsd: round(overheadPerUnitUsd, 4),
    breakdown,
    actualEditable: gate.editable,
    actualEditableReasonUk: gate.reasonUk || null,
    isCurrentPeriod: period === currentPeriod(),
  };
}

/**
 * Розмір тому Railway через офіційне публічне GraphQL API — єдине, що воно
 * віддає про використання (currentSizeMB/sizeMB), без грошової вартості
 * (підтверджено документацією Railway в задачі #211: біллінг — лише
 * дашборд/CLI `railway usage`, поза публічним API).
 */
async function fetchRailwayVolumeSize(token: string, volumeId: string): Promise<{ currentMb: number; sizeMb: number }> {
  const query = 'query VolumeMetrics($id: String!) { volumeInstance(id: $id) { currentSizeMB sizeMB } }';
  let res: Response;
  try {
    res = await fetch(RAILWAY_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query, variables: { id: volumeId } }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(`Railway API недоступний: ${(err as Error).message}`);
  }
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.errors) {
    const msg = json?.errors?.[0]?.message || `HTTP ${res.status}`;
    throw new Error(`Railway API повернув помилку: ${msg}`);
  }
  const inst = json?.data?.volumeInstance;
  if (!inst || typeof inst.currentSizeMB !== 'number' || typeof inst.sizeMB !== 'number') {
    throw new Error('Railway API повернув некоректну відповідь — перевірте id тому.');
  }
  return { currentMb: inst.currentSizeMB, sizeMb: inst.sizeMB };
}

function newExpenseId(): string {
  return `exp-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

export function registerExpenseBoardRoutes(app: Express): void {
  // Статичні маршрути /railway-settings реєструються ДО параметричного
  // GET /:period — інакше Express зіставляє 'railway-settings' як
  // значення :period (перший зареєстрований шаблон, що збігається,
  // перемагає), і запит падає з «Некоректний період» (виявлено живою
  // перевіркою в проді одразу після деплою #211).
  app.get('/api/admin/expense-board/railway-settings', requireAdmin, async (_req, res) => {
    const s = await readRailwaySettings();
    res.json({
      configured: !!s.encryptedToken,
      tokenFingerprint: s.tokenFingerprint || null,
      volumeId: s.volumeId || null,
      lastCurrentMb: s.lastCurrentMb ?? null,
      lastSizeMb: s.lastSizeMb ?? null,
      lastSyncedAt: s.lastSyncedAt || null,
    });
  });

  app.put('/api/admin/expense-board/railway-settings', requireAdmin, async (req, res) => {
    const { token, volumeId } = req.body || {};
    const s = await readRailwaySettings();
    if (typeof token === 'string' && token.trim()) {
      if (!isApiKeyCryptoConfigured()) {
        return res.status(500).json({ error: 'Шифрування ключів не налаштоване на сервері (USER_API_KEY_SECRET).' });
      }
      s.encryptedToken = encryptApiKey(token);
      s.tokenFingerprint = apiKeyFingerprint(token);
    }
    if (typeof volumeId === 'string') {
      s.volumeId = volumeId.trim().slice(0, 200);
    }
    await writeRailwaySettings(s);
    res.json({ ok: true });
  });

  app.post('/api/admin/expense-board/railway-settings/sync', requireAdmin, async (_req, res) => {
    const s = await readRailwaySettings();
    if (!s.encryptedToken || !s.volumeId) {
      return res.status(400).json({ error: 'Спершу вкажіть токен доступу Railway та id тому в налаштуваннях.' });
    }
    let token: string;
    try {
      token = decryptApiKey(s.encryptedToken);
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || 'Не вдалося розшифрувати збережений токен.' });
    }
    try {
      const { currentMb, sizeMb } = await fetchRailwayVolumeSize(token, s.volumeId);
      s.lastCurrentMb = currentMb;
      s.lastSizeMb = sizeMb;
      s.lastSyncedAt = new Date().toISOString();
      await writeRailwaySettings(s);
      res.json({ ok: true, lastCurrentMb: currentMb, lastSizeMb: sizeMb, lastSyncedAt: s.lastSyncedAt });
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Не вдалося отримати дані з Railway API.' });
    }
  });

  app.get('/api/admin/expense-board/:period', requireAdmin, async (req, res) => {
    const period = String(req.params.period || '');
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'Некоректний період — очікується формат YYYY-MM.' });
    }
    const board = await readBoard(period);
    res.json(await computeSummary(period, board));
  });

  app.post('/api/admin/expense-board/:period/expenses', requireAdmin, async (req, res) => {
    const period = String(req.params.period || '');
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'Некоректний період — очікується формат YYYY-MM.' });
    }
    const { kind, label, amountUsd, note } = req.body || {};
    if (kind !== 'railway' && kind !== 'other') {
      return res.status(400).json({ error: 'Тип витрати має бути railway або other.' });
    }
    if (typeof label !== 'string' || !label.trim()) {
      return res.status(400).json({ error: 'Вкажіть назву статті витрат.' });
    }
    if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd < 0) {
      return res.status(400).json({ error: 'Сума має бути невідʼємним числом ($).' });
    }
    const board = await readBoard(period);
    const now = new Date().toISOString();
    const item: ExpenseLineItem = {
      id: newExpenseId(),
      kind,
      label: label.trim().slice(0, 200),
      amountUsd,
      note: typeof note === 'string' ? note.slice(0, 1000) : '',
      createdAt: now,
      updatedAt: now,
    };
    board.expenses.push(item);
    await writeBoard(period, board);
    res.json(await computeSummary(period, board));
  });

  app.put('/api/admin/expense-board/:period/expenses/:id', requireAdmin, async (req, res) => {
    const period = String(req.params.period || '');
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'Некоректний період — очікується формат YYYY-MM.' });
    }
    const id = String(req.params.id || '');
    const { label, amountUsd, note } = req.body || {};
    const board = await readBoard(period);
    const item = board.expenses.find((e) => e.id === id);
    if (!item) {
      return res.status(404).json({ error: 'Статтю витрат не знайдено.' });
    }
    if (label !== undefined) {
      if (typeof label !== 'string' || !label.trim()) {
        return res.status(400).json({ error: 'Назва статті витрат не може бути порожньою.' });
      }
      item.label = label.trim().slice(0, 200);
    }
    if (amountUsd !== undefined) {
      if (typeof amountUsd !== 'number' || !Number.isFinite(amountUsd) || amountUsd < 0) {
        return res.status(400).json({ error: 'Сума має бути невідʼємним числом ($).' });
      }
      item.amountUsd = amountUsd;
    }
    if (note !== undefined) {
      item.note = typeof note === 'string' ? note.slice(0, 1000) : '';
    }
    item.updatedAt = new Date().toISOString();
    await writeBoard(period, board);
    res.json(await computeSummary(period, board));
  });

  app.delete('/api/admin/expense-board/:period/expenses/:id', requireAdmin, async (req, res) => {
    const period = String(req.params.period || '');
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'Некоректний період — очікується формат YYYY-MM.' });
    }
    const id = String(req.params.id || '');
    const board = await readBoard(period);
    const before = board.expenses.length;
    board.expenses = board.expenses.filter((e) => e.id !== id);
    if (board.expenses.length === before) {
      return res.status(404).json({ error: 'Статтю витрат не знайдено.' });
    }
    await writeBoard(period, board);
    res.json(await computeSummary(period, board));
  });

  app.put('/api/admin/expense-board/:period/sales-mix', requireAdmin, async (req, res) => {
    const period = String(req.params.period || '');
    if (!isValidPeriod(period)) {
      return res.status(400).json({ error: 'Некоректний період — очікується формат YYYY-MM.' });
    }
    const { category, plannedUnits, actualUnits } = req.body || {};
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: 'Категорія має бути goods, books або trainings.' });
    }
    const board = await readBoard(period);
    const entry = board.salesMix[category as ProductCategory];

    if (plannedUnits !== undefined) {
      if (typeof plannedUnits !== 'number' || !Number.isFinite(plannedUnits) || plannedUnits < 0) {
        return res.status(400).json({ error: 'Планова кількість має бути невідʼємним числом.' });
      }
      entry.plannedUnits = Math.round(plannedUnits);
    }

    if (actualUnits !== undefined) {
      if (actualUnits !== null && (typeof actualUnits !== 'number' || !Number.isFinite(actualUnits) || actualUnits < 0)) {
        return res.status(400).json({ error: 'Фактична кількість має бути невідʼємним числом або null.' });
      }
      const gate = actualEditableCheck(period);
      if (!gate.editable) {
        return res.status(403).json({ error: gate.reasonUk });
      }
      entry.actualUnits = actualUnits === null ? null : Math.round(actualUnits);
    }

    entry.updatedAt = new Date().toISOString();
    await writeBoard(period, board);
    res.json(await computeSummary(period, board));
  });
}

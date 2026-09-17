/**
 * Калькулятор собівартості меблів (дерево + епоксидна смола) — «Управління
 * цінами» в адмінпанелі (src/components/adminOs/furnitureCalculator/).
 *
 * Портовано з окремого React-застосунку, який до цього тримав курс валют і
 * власні шаблони в localStorage браузера. Тут обидва набори живуть як JSON
 * під двома ключами `meta` Студії (той самий патерн, що й
 * server/furnitureProductRoutes.ts DRAFTS_KEY) — так курс і шаблони спільні
 * для всіх адміністраторів і переживають очищення браузера, а не губляться
 * при вході з іншого пристрою.
 *
 * Курс НБУ (`/nbu-rates`) також переїхав на сервер: bank.gov.ua не віддає
 * CORS-заголовків, тож прямий fetch з браузера падав мовчки. Тут це звичайний
 * серверний fetch з таймаутом — той самий патерн, що й geocodePlace() у
 * server/jyotishChart.ts.
 *
 * Усі маршрути — requireAdmin (не requireSupportAgent): це фінансові дані
 * (курс валют, собівартість, ціни), тож вони поза межами вужчої ролі
 * site_manager, так само як інші фінансові/адмінські маршрути Студії.
 */

import type { Express } from 'express';
import { requireAdmin } from './auth';
import { getAppSetting, setAppSetting } from './store';

const RATES_KEY = 'furniture_calc_rates';
const TEMPLATES_KEY = 'furniture_calc_custom_templates';

/** Мінімальна форма курсу валют — дзеркалить CurrencyRates із клієнтського types.ts. */
interface StoredCurrencyRates {
  USD: number;
  EUR: number;
  lastUpdated?: string;
  source?: string;
  autoSyncImported?: boolean;
}

function isValidRates(v: unknown): v is StoredCurrencyRates {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.USD === 'number' && r.USD > 0 && typeof r.EUR === 'number' && r.EUR > 0;
}

async function readRates(): Promise<StoredCurrencyRates | null> {
  const raw = await getAppSetting(RATES_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isValidRates(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Шаблони зберігаються як довільний JSON-масив — форма (ProductTemplate) належить клієнту. */
async function readTemplates(): Promise<unknown[]> {
  const raw = await getAppSetting(TEMPLATES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface NbuExchangeEntry {
  rate?: number;
  exchangedate?: string;
}

/**
 * Тягне офіційний курс USD та EUR з НБУ. Прямий аналог geocodePlace() у
 * server/jyotishChart.ts: серверний fetch з таймаутом, а не clientside —
 * bank.gov.ua не додає CORS-заголовків для браузерних запитів.
 */
async function fetchNbuRate(valcode: 'USD' | 'EUR'): Promise<NbuExchangeEntry> {
  const url = `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=${valcode}&json`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    throw new Error(`НБУ недоступний (${valcode}): ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`НБУ повернув помилку для ${valcode} (HTTP ${res.status}).`);
  }
  const json = (await res.json().catch(() => null)) as NbuExchangeEntry[] | null;
  const first = json?.[0];
  if (!first || typeof first.rate !== 'number') {
    throw new Error(`НБУ повернув некоректну відповідь для ${valcode}.`);
  }
  return first;
}

export function registerFurnitureCalculatorRoutes(app: Express): void {
  app.get('/api/admin/furniture-calc/rates', requireAdmin, async (_req, res) => {
    const rates = await readRates();
    res.json({ rates });
  });

  app.put('/api/admin/furniture-calc/rates', requireAdmin, async (req, res) => {
    const rates = req.body?.rates;
    if (!isValidRates(rates)) {
      return res.status(400).json({ error: 'Некоректний курс валют: USD і EUR мають бути додатними числами.' });
    }
    await setAppSetting(RATES_KEY, JSON.stringify(rates));
    res.json({ ok: true });
  });

  app.get('/api/admin/furniture-calc/templates', requireAdmin, async (_req, res) => {
    const templates = await readTemplates();
    res.json({ templates });
  });

  app.put('/api/admin/furniture-calc/templates', requireAdmin, async (req, res) => {
    const templates = req.body?.templates;
    if (!Array.isArray(templates)) {
      return res.status(400).json({ error: 'Некоректний список шаблонів.' });
    }
    await setAppSetting(TEMPLATES_KEY, JSON.stringify(templates));
    res.json({ ok: true });
  });

  app.get('/api/admin/furniture-calc/nbu-rates', requireAdmin, async (_req, res) => {
    try {
      const [usdEntry, eurEntry] = await Promise.all([fetchNbuRate('USD'), fetchNbuRate('EUR')]);
      res.json({
        usd: usdEntry.rate,
        eur: eurEntry.rate,
        exchangeDate: usdEntry.exchangedate || eurEntry.exchangedate || null,
      });
    } catch (err: any) {
      res.status(502).json({ error: err?.message || 'Не вдалося отримати курс НБУ.' });
    }
  });
}

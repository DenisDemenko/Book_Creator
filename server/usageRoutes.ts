/**
 * Персональний облік витрат токенів для письменника — на відміну від
 * /api/admin/usage (server/adminRoutes.ts), тут кожен бачить ЛИШЕ свої
 * власні витрати, без доступу до чужих (requireAuth, не requireAdmin).
 *
 * Дані й агрегація — та сама функція listUsageSince() з usage_log, що вже
 * коректно живить адмінську панель (охоплює чат, редагування тексту,
 * персонажів, ілюстрації, обкладинки, KDP-форматування, тренування —
 * усе, що йде через server/aiCore.ts).
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import { listUsageSince, type UsageRecord } from './store';

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

export function registerUsageRoutes(app: Express): void {
  app.get('/api/usage/me', requireAuth, async (req, res) => {
    const principal = req.principal!;
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const all = await listUsageSince(sinceIso);
    const records = all.filter((r) => (principal.id ? r.userId === principal.id : r.userEmail === principal.email));

    const successful = records.filter((r) => r.success);
    const totalUsd = successful.reduce((a, r) => a + r.costUsd, 0);

    const today = new Date().toISOString().slice(0, 10);
    const todayUsd = successful
      .filter((r) => r.timestamp.slice(0, 10) === today)
      .reduce((a, r) => a + r.costUsd, 0);

    res.json({
      periodDays: days,
      totals: {
        generations: records.length,
        successful: successful.length,
        failed: records.length - successful.length,
        totalUsd: Number(totalUsd.toFixed(4)),
        todayUsd: Number(todayUsd.toFixed(4)),
        averageUsd: successful.length ? Number((totalUsd / successful.length).toFixed(4)) : 0,
      },
      byModel: summarize(records, (r) => r.modelId || r.engineId),
      byDay: summarize(records, (r) => dayKey(r.timestamp)).sort((a, b) => a.key.localeCompare(b.key)),
      recent: records.slice(-30).reverse(),
    });
  });
}

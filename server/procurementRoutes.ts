/**
 * Закупівлі матеріалів — CRUD для записів, з яких виводяться реальні знижки.
 *
 * Той самий принцип сховища, що й чорнетки виробів
 * (`server/furnitureProductRoutes.ts`): один ключ `meta` Студії з JSON-
 * масивом. Застосування знижки до товару НЕ проходить окремим маршрутом
 * тут — клієнт (AdminProcurementView / ApplyDiscountModal) оновлює картку
 * виробу через наявний `/api/admin/furniture-products` (POST upsert), а
 * сюди шле лише оновлений запис закупівлі (з доданим `appliedTo`). Так
 * логіка ціноутворення товару лишається в одному місці — редакторі картки
 * та його маршруті, а не дублюється тут.
 */

import type { Express } from 'express';
import { requireAdmin } from './auth';
import { getAppSetting, setAppSetting } from './store';
import { procurementIssues, type ProcurementRecord } from '../src/components/adminOs/procurement';

const PROCUREMENT_KEY = 'furniture_procurement_records';

async function readProcurementRecords(): Promise<ProcurementRecord[]> {
  const raw = (await getAppSetting(PROCUREMENT_KEY)) || '[]';
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProcurementRecord[]) : [];
  } catch {
    return [];
  }
}

async function writeProcurementRecords(list: ProcurementRecord[]): Promise<void> {
  await setAppSetting(PROCUREMENT_KEY, JSON.stringify(list));
}

export function registerProcurementRoutes(app: Express): void {
  app.get('/api/admin/procurement', requireAdmin, async (_req, res) => {
    const records = await readProcurementRecords();
    res.json({ records });
  });

  app.post('/api/admin/procurement', requireAdmin, async (req, res) => {
    const record = req.body?.record as ProcurementRecord | undefined;
    if (!record || typeof record !== 'object' || !record.id) {
      return res.status(400).json({ error: 'Некоректний запис закупівлі.' });
    }
    const issues = procurementIssues(record);
    if (issues.length) {
      return res.status(400).json({ error: `Не можна зберегти: ${issues.join(' ')}` });
    }
    const records = await readProcurementRecords();
    const idx = records.findIndex((r) => r.id === record.id);
    const clean: ProcurementRecord = {
      ...record,
      appliedTo: Array.isArray(record.appliedTo) ? record.appliedTo : [],
      updatedAt: new Date().toISOString(),
    };
    if (idx >= 0) records[idx] = clean;
    else records.unshift(clean);
    await writeProcurementRecords(records);
    res.json({ record: clean });
  });

  app.delete('/api/admin/procurement/:id', requireAdmin, async (req, res) => {
    const records = await readProcurementRecords();
    const next = records.filter((r) => r.id !== req.params.id);
    if (next.length === records.length) {
      return res.status(404).json({ error: 'Запис закупівлі не знайдено.' });
    }
    await writeProcurementRecords(next);
    res.json({ ok: true });
  });
}

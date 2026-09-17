/**
 * CRUD-маршрути модуля «Поріг» (ARCHITECTURE_EMOTION_THRESHOLD_MODULES.md,
 * розділ 6.3): AI (`/api/ai/threshold-analyze` — інлайн у server.ts, бо
 * потребує resolveTextEngineOrFail/loadCoreAdminLayer) лише ПРОПОНУЄ
 * кандидата; збереження, редагування і видалення підтвердженого порогу —
 * звичайні дані без звернення до моделі, тому окремий зареєстрований
 * файл, той самий патерн, що й server/furnitureCalculatorRoutes.ts.
 *
 * WDI-доказ (skill `character_craft`) записується ЛИШЕ при СТВОРЕННІ
 * справжнього порогу (`isRealThreshold`) — не при кожному редагуванні:
 * "сама лише порада ШІ рейтинг не підвищує" (wdi.ts), і так само дрібне
 * редагування вже збереженого порогу не повинно дублювати доказ. sourceId
 * прив'язаний до id порогу — ідемпотентність тримає UNIQUE(user_id,
 * source_id) у writer_evidence.
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import {
  createThreshold,
  updateThreshold,
  getThreshold,
  listThresholds,
  deleteThreshold,
  linkThresholdScene,
  listThresholdSceneLinks,
  unlinkThresholdScene,
  createAvoidedThreshold,
  getAvoidedThreshold,
  listAvoidedThresholds,
  updateAvoidedThreshold,
  deleteAvoidedThreshold,
  type ThresholdInput,
} from './thresholdStore';
import {
  THRESHOLD_TYPES,
  isRealThreshold,
  thresholdEvidenceOutcome,
  thresholdStrength,
  type ThresholdCandidate,
} from './thresholdScoring';
import { recordEvidence } from './wdiStore';

function toCandidateForEvidence(t: ThresholdInput & { risks: any }): ThresholdCandidate {
  return {
    title: t.title,
    description: t.description,
    types: t.types,
    beforeState: t.beforeState,
    choice: t.choice,
    crossingAction: t.crossingAction,
    afterState: t.afterState,
    risks: {
      physical: t.risks.physical ?? 1,
      emotional: t.risks.emotional ?? 1,
      social: t.risks.social ?? 1,
      material: t.risks.material ?? 1,
      existential: t.risks.existential ?? 1,
    },
    cost: t.cost,
    irreversibility: t.irreversibility,
    transformation: t.transformation,
    awareness: t.awareness,
    agency: t.agency,
  };
}

function parseThresholdBody(body: any): { input: ThresholdInput | null; error: string | null } {
  const title = typeof body?.title === 'string' ? body.title.trim() : '';
  const description = typeof body?.description === 'string' ? body.description.trim() : '';
  if (!title || !description) {
    return { input: null, error: 'Потрібні назва й опис порогу.' };
  }
  const types = (Array.isArray(body?.types) ? body.types : []).filter((t: unknown) =>
    (THRESHOLD_TYPES as string[]).includes(String(t))
  );
  return {
    input: {
      userId: '', // підставляється роутом із req.principal
      bookId: body?.bookId ?? null,
      characterId: body?.characterId ?? null,
      title,
      description,
      types,
      beforeState: String(body?.beforeState ?? ''),
      choice: String(body?.choice ?? ''),
      crossingAction: String(body?.crossingAction ?? ''),
      afterState: String(body?.afterState ?? ''),
      risks: {
        physical: Number(body?.risks?.physical),
        emotional: Number(body?.risks?.emotional),
        social: Number(body?.risks?.social),
        material: Number(body?.risks?.material),
        existential: Number(body?.risks?.existential),
      },
      cost: Number(body?.cost),
      irreversibility: Number(body?.irreversibility),
      transformation: Number(body?.transformation),
      awareness: Number(body?.awareness ?? 5),
      agency: Number(body?.agency ?? 5),
      status: typeof body?.status === 'string' ? body.status : undefined,
      consequences: Array.isArray(body?.consequences) ? body.consequences.map(String) : [],
      confidence: body?.confidence !== undefined ? Number(body.confidence) : null,
    },
    error: null,
  };
}

/**
 * Дописує доказ WDI при створенні СПРАВЖНЬОГО порогу — не при кожному save.
 * Помилка запису доказу не має валити відповідь зі збереженим порогом:
 * поріг уже в базі, це головне, а доказ — похідна дія.
 */
function maybeRecordThresholdEvidence(userId: string, bookId: string | null, thresholdId: string, t: ThresholdInput): void {
  try {
    const candidate = toCandidateForEvidence(t as any);
    if (!isRealThreshold(candidate)) return;
    const outcome = thresholdEvidenceOutcome(candidate);
    if (outcome === null) return;
    recordEvidence({
      userId,
      bookId,
      skill: 'character_craft',
      type: 'PRACTICAL_TASK',
      outcome,
      confidence: 0.7,
      independence: 50,
      summary: `Поріг «${t.title}» підтверджено (сила: ${thresholdStrength(candidate)}).`,
      sourceId: `threshold:${thresholdId}`,
    });
  } catch (err) {
    console.warn('[thresholdRoutes] не вдалося записати доказ WDI:', (err as Error)?.message);
  }
}

export function registerThresholdRoutes(app: Express): void {
  app.post('/api/thresholds', requireAuth, (req: any, res) => {
    const userId = req.principal.id as string;
    const { input, error } = parseThresholdBody(req.body);
    if (!input) return res.status(400).json({ error, kind: 'bad_input' });
    input.userId = userId;
    try {
      const record = createThreshold(input);
      maybeRecordThresholdEvidence(userId, record.bookId, record.id, input);
      res.json({ threshold: record });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.put('/api/thresholds/:id', requireAuth, (req: any, res) => {
    const userId = req.principal.id as string;
    const { input, error } = parseThresholdBody(req.body);
    if (!input) return res.status(400).json({ error, kind: 'bad_input' });
    try {
      const record = updateThreshold(req.params.id, userId, input);
      if (!record) return res.status(404).json({ error: 'Поріг не знайдено.' });
      res.json({ threshold: record });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.get('/api/thresholds/:id', requireAuth, (req: any, res) => {
    try {
      const record = getThreshold(req.params.id, req.principal.id);
      if (!record) return res.status(404).json({ error: 'Поріг не знайдено.' });
      res.json({ threshold: record });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.get('/api/thresholds', requireAuth, (req: any, res) => {
    try {
      const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : null;
      const items = listThresholds(req.principal.id, bookId);
      res.json({ items });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.delete('/api/thresholds/:id', requireAuth, (req: any, res) => {
    try {
      const ok = deleteThreshold(req.params.id, req.principal.id);
      if (!ok) return res.status(404).json({ error: 'Поріг не знайдено.' });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.post('/api/thresholds/:id/scenes', requireAuth, (req: any, res) => {
    const { sceneId, role, orderIndex } = req.body || {};
    if (!sceneId || !['preparation', 'crossing', 'consequence'].includes(role)) {
      return res.status(400).json({ error: 'Потрібні sceneId і role (preparation|crossing|consequence).', kind: 'bad_input' });
    }
    try {
      const link = linkThresholdScene(req.principal.id, req.params.id, sceneId, role, Number(orderIndex) || 0);
      res.json({ link });
    } catch (err: any) {
      res.status(err?.message?.includes('не знайдено') ? 404 : 503).json({ error: String(err?.message || err) });
    }
  });

  app.get('/api/thresholds/:id/scenes', requireAuth, (req: any, res) => {
    try {
      if (!getThreshold(req.params.id, req.principal.id)) {
        return res.status(404).json({ error: 'Поріг не знайдено.' });
      }
      res.json({ items: listThresholdSceneLinks(req.params.id) });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.delete('/api/thresholds/:id/scenes/:linkId', requireAuth, (req: any, res) => {
    try {
      if (!getThreshold(req.params.id, req.principal.id)) {
        return res.status(404).json({ error: 'Поріг не знайдено.' });
      }
      const ok = unlinkThresholdScene(req.params.linkId, req.params.id);
      if (!ok) return res.status(404).json({ error: 'Зв\'язок не знайдено.' });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  /* ───────────────────────  Уникнені пороги (п. 2.2 ТЗ)  ─────────────────────── */

  app.post('/api/avoided-thresholds', requireAuth, (req: any, res) => {
    const body = req.body || {};
    const developmentArea = String(body.developmentArea ?? '').trim();
    const thresholdDescription = String(body.thresholdDescription ?? '').trim();
    if (!developmentArea || !thresholdDescription) {
      return res.status(400).json({ error: 'Потрібні область розвитку й опис порогу.', kind: 'bad_input' });
    }
    try {
      const record = createAvoidedThreshold({
        userId: req.principal.id,
        bookId: body.bookId ?? null,
        characterId: body.characterId ?? null,
        developmentArea,
        thresholdDescription,
        fear: String(body.fear ?? ''),
        avoidanceBehavior: String(body.avoidanceBehavior ?? ''),
        shortTermReward: String(body.shortTermReward ?? ''),
        longTermCost: String(body.longTermCost ?? ''),
        repetitions: Number(body.repetitions) || 1,
        severity: Number(body.severity) || 5,
        nextOpportunity: body.nextOpportunity ?? null,
      });
      res.json({ avoidedThreshold: record });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.get('/api/avoided-thresholds', requireAuth, (req: any, res) => {
    try {
      const bookId = typeof req.query.bookId === 'string' ? req.query.bookId : null;
      res.json({ items: listAvoidedThresholds(req.principal.id, bookId) });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.get('/api/avoided-thresholds/:id', requireAuth, (req: any, res) => {
    try {
      const record = getAvoidedThreshold(req.params.id, req.principal.id);
      if (!record) return res.status(404).json({ error: 'Не знайдено.' });
      res.json({ avoidedThreshold: record });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.put('/api/avoided-thresholds/:id', requireAuth, (req: any, res) => {
    try {
      const record = updateAvoidedThreshold(req.params.id, req.principal.id, req.body || {});
      if (!record) return res.status(404).json({ error: 'Не знайдено.' });
      res.json({ avoidedThreshold: record });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });

  app.delete('/api/avoided-thresholds/:id', requireAuth, (req: any, res) => {
    try {
      const ok = deleteAvoidedThreshold(req.params.id, req.principal.id);
      if (!ok) return res.status(404).json({ error: 'Не знайдено.' });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(503).json({ error: String(err?.message || err), kind: 'storage_unavailable' });
    }
  });
}

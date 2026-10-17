import type { Express } from 'express';
import { requireAuth, requirePermission } from './auth';
import { jevKeyFromEnv } from './ai/adapters/jev';
import { resolveEngineKey } from './platformKeys';
import {
  assertDraftRevision,
  DraftConflictError,
  DraftValidationError,
  getDraft,
  updateDraft,
  type ExpressDraft,
  type ExpressPayload,
} from './expressStore';
import { analyzeExpressHeroArcWithJev } from './expressHeroArcJev';

function allowedDraft(id: string, req: any): ExpressDraft | undefined {
  const draft = getDraft(id);
  if (draft?.userId && draft.userId !== req.principal?.id) {
    throw new DraftValidationError('Чернетка недоступна.', 404);
  }
  return draft;
}

function respondFailure(res: any, error: unknown): void {
  if (error instanceof DraftConflictError) {
    res.status(409).json({ error: error.message, kind: 'draft_conflict', draft: error.current });
    return;
  }
  if (error instanceof DraftValidationError) {
    res.status(error.status).json({ error: error.message, kind: 'invalid_draft' });
    return;
  }
  res.status(502).json({ error: (error as Error).message, kind: 'jev_analysis_failed' });
}

/**
 * Окрема реєстрація JEV-кривої: Express Wizard лишається власником draft,
 * а semantic scoring ізольований від загальних LLM stage routes.
 */
export function registerExpressHeroArcRoutes(app: Express): void {
  app.post(
    '/api/express/hero-arc/analyze',
    requireAuth,
    requirePermission('canUseAi'),
    async (req: any, res) => {
      const draftId = String(req.body?.draftId ?? '');
      const heroId = String(req.body?.heroId ?? '').trim();

      try {
        const draft = allowedDraft(draftId, req);
        if (!draft) {
          res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
          return;
        }
        assertDraftRevision(draft, req.body?.expectedRevision);

        const hero = (draft.payload.cast ?? []).find((member) => member.id === heroId);
        if (!hero) throw new DraftValidationError('Оберіть протагоніста з підтвердженого складу героїв.');
        if (!draft.payload.synopsis?.trim()) throw new DraftValidationError('Спершу створіть і підтвердьте синопсис.');
        if (!draft.payload.parts?.length) throw new DraftValidationError('Спершу створіть структуру частин і глав.');

        const snapshotRevision = draft.revision;
        const apiKey =
          (await resolveEngineKey(req.principal?.id ?? null, 'jev', 'express-hero-arc')) ??
          jevKeyFromEnv();
        if (!apiKey) {
          throw new DraftValidationError(
            'JEV не налаштовано. Додайте ключ TypeSafe/JEV у «Ключі API» або JEV_API_KEY/TYPESAFE_API_KEY.',
            503,
          );
        }

        const result = await analyzeExpressHeroArcWithJev(draft.payload, heroId, apiKey);

        // Optimistic concurrency: не даємо старому аналізу накрити новішу
        // редакцію персонажів, синопсису або структури.
        const latest = allowedDraft(draftId, req);
        if (!latest) {
          res.status(404).json({ error: 'Чернетку не знайдено.' });
          return;
        }
        assertDraftRevision(latest, snapshotRevision);

        const previousAnalysis = (latest.payload.heroArc as any)?.analysis;
        const oldOverrides = new Map<number, number>(
          Array.isArray(previousAnalysis?.points)
            ? previousAnalysis.points
                .filter((point: any) => typeof point?.authorOverride === 'number')
                .map((point: any) => [Number(point.beatIndex), Number(point.authorOverride)])
            : [],
        );

        const mergedPoints = result.points.map((point) => ({
          ...point,
          ...(oldOverrides.has(point.beatIndex)
            ? { authorOverride: oldOverrides.get(point.beatIndex) }
            : {}),
        }));
        const intensities = mergedPoints.map((point) =>
          typeof point.authorOverride === 'number' ? point.authorOverride : point.jevValue
        );
        const analysis = {
          source: result.source,
          status: result.status,
          heroId: result.heroId,
          model: result.model,
          analyzedAt: result.analyzedAt,
          snapshotRevision,
          points: mergedPoints,
        };

        const heroArc = {
          ...(latest.payload.heroArc ?? {}),
          intensities,
          analysis,
        };
        const patch = { heroArc } as unknown as ExpressPayload;
        const updated = updateDraft(draftId, patch, latest.revision, latest.step);

        res.json({
          analysis,
          usage: result.usage,
          latencyMs: result.latencyMs,
          draft: updated,
        });
      } catch (error) {
        respondFailure(res, error);
      }
    },
  );
}

/**
 * Маршрут майстра «Навчальний курс» (docs/tech-spec-course-wizard-2026.md, Фаза 4).
 *
 * Один ендпоінт на всі шість кроків: клієнт надсилає stage, поточний стан
 * курсу й контекст кроку; сервер викликає модель (через той самий вибір
 * рушія, що й експрес-майстер — expressEngine.ts) і повертає пропозицію.
 *
 * Ґейти: вхід + canAuthorCourses (курси) + canUseAi (платні виклики моделі).
 */

import type { Express } from 'express';
import { requireAuth, requirePermission } from './auth';
import { generateText } from './aiCore';
import { resolveEngineForWizard, noEngineMessage } from './expressEngine';
import { COURSE_STAGES, courseStagePrompt, type CourseWizardStage } from './courseWizardPrompt';

function parseJson<T>(raw: string): T | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

export function registerCourseWizardRoutes(app: Express): void {
  app.post(
    '/api/courses/wizard/stage',
    requireAuth,
    requirePermission('canAuthorCourses'),
    requirePermission('canUseAi'),
    async (req, res) => {
      try {
        const stage = String(req.body?.stage ?? '') as CourseWizardStage;
        if (!COURSE_STAGES.includes(stage)) {
          return res.status(400).json({ error: `Невідомий крок майстра: ${stage}.` });
        }

        const course = req.body?.course || {};
        const context = req.body?.context || {};
        const { system, prompt } = courseStagePrompt(stage, course, context);

        const choice = await resolveEngineForWizard(req.principal?.id ?? null, req.body?.engine);
        if (!choice) {
          return res.status(503).json({ error: noEngineMessage(), kind: 'no_engine' });
        }

        const result = await generateText({
          engine: choice.engine,
          modelId: choice.modelId,
          prompt,
          systemInstruction: system,
          json: true,
          apiKeyOverride: choice.apiKeyOverride,
          req,
          label: `Майстер курсів: ${stage}`,
        });

        const data = parseJson<Record<string, unknown>>(result.text);
        if (!data) {
          return res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
        }

        res.json({ stage, data });
      } catch (err) {
        res.status(502).json({ error: String((err as Error).message), kind: 'ai_failed' });
      }
    }
  );
}

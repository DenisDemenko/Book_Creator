import { registerWorldPhotoRoutes } from './worldPhoto';
import { scenarioErrors } from '../shared/wizardScenarios';
import { getAsset } from './media/mediaLibraryStore';
import { registerWizardSourceRoutes, type WizardSourceDeps } from './wizardSourceRoutes';
/**
 * Експрес-майстер «Книга за 5 хвилин» (Wisart Book Crealiry.md §3.4).
 *
 * Окремий файл, а не додаток до server.ts: той уже перевалив за 1700 рядків,
 * і саме тому решта модулів давно живе тут поруч.
 *
 * Чернетка, її перегляд і список рушіїв свідомо без `requireAuth`:
 * майстер починають анонімно, і захист чужої чернетки — не сесія, а сам
 * `draftId`: випадковий UUID, який знає лише той, кому його віддали.
 * Кроки, що витрачають виклики моделі (seed / suggest / generate), стоять
 * за requireAuth + requirePermission('canUseAi'): анонім може пройти
 * майстер до цих кроків, а генерація вимагає входу й ролі з правом на ШІ.
 */

import type { Express, Response } from 'express';
import { requireAuth, requirePermission } from './auth';
import { generateText } from './aiCore';
import {
  availableEngines,
  noEngineMessage,
  resolveEngineForWizard,
} from './expressEngine';
import {
  assertDraftRevision,
  DraftConflictError,
  DraftValidationError,
  withStableCastIds,
  claimDraft,
  createDraft,
  getDraft,
  updateDraft,
  type ExpressPayload,
} from './expressStore';
import {
  castPrompt,
  compositionPrompt,
  frameworkPrompt,
  partPrompt,
  seedPrompt,
  synopsisPrompt,
} from './expressPrompt';

/** Скільки частин генерує майстер. Три — щоб укластись у бюджет кроку Е5. */
const TOTAL_PARTS = 3;

/**
 * Напрями розвилки (Завдання 4). Перелік навмисно продубльовано з
 * src/data/expressTracks.ts, а не імпортовано: жоден server/*.ts не читає
 * з src/ — сервер збирається окремо, і такий імпорт затяг би клієнтський
 * граф у бандл сервера заради чотирьох рядків.
 */
const KNOWN_TRACKS = ['book', 'course', 'instruction', 'game', 'technical_instruction'];

const FRAMEWORKS = new Set([
  'hero_journey',
  'psychotypes',
  'vedic_archetypes',
  'buddhist_skandhas',
  'documentary',
]);

/**
 * Модель просять відповідати чистим JSON, але вона все одно час від часу
 * загортає його в markdown-огорожу. Зривати огорожу дешевше, ніж втрачати
 * крок майстра через це.
 */
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

/**
 * Один виклик моделі для будь-якого кроку майстра.
 *
 * Рушій обирається тут, а не в кожному кроці: інакше вибір користувача
 * довелося б протягувати в чотири місця, і рано чи пізно одне з них
 * розійшлося б з рештою.
 */
async function ask(
  req: any,
  label: string,
  system: string,
  prompt: string
): Promise<{ text: string; engine: string; source: 'platform' | 'server' }> {
  const choice = await resolveEngineForWizard(req.principal?.id ?? null, req.body?.engine);
  if (!choice) throw new Error(noEngineMessage());

  const result = await generateText({
    engine: choice.engine,
    modelId: choice.modelId,
    prompt,
    systemInstruction: system,
    json: true,
    privateContent: true,
    apiKeyOverride: choice.apiKeyOverride,
    req,
    label,
  });

  return { text: result.text, engine: choice.engine, source: choice.source };
}

function draftFailure(res: Response, err: unknown, status = 503, kind = 'storage_unavailable'): void {
  if (err instanceof DraftConflictError) {
    res.status(409).json({ error: err.message, kind: 'draft_conflict', draft: err.current });
  } else if (err instanceof DraftValidationError) {
    res.status(err.status).json({ error: err.message, kind: 'invalid_draft' });
  } else {
    res.status(status).json({ error: (err as Error).message, kind });
  }
}

function readAllowedDraft(id: string, req: any) {
  const draft = getDraft(id);
  if (draft?.userId && draft.userId !== req.principal?.id) throw new DraftValidationError('Чернетка недоступна.', 404);
  return draft;
}
async function assertSources(req: any, draft: NonNullable<ReturnType<typeof getDraft>>) {
  const errors = scenarioErrors(draft.payload);
  if (errors.length) throw new DraftValidationError(errors.join(' '));
  for (const source of (draft.payload.sourceMaterials ?? []).filter(s => s.approved && s.assetId)) {
    const asset = await getAsset(source.assetId!);
    if (!asset || asset.ownerId !== String(req.principal?.id)) throw new DraftValidationError('Джерело більше недоступне.', 403);
  }
}

export function registerExpressRoutes(app: Express, deps: { ask?: typeof ask; sources?: Omit<WizardSourceDeps, 'ask'>; world?: Parameters<typeof registerWorldPhotoRoutes>[1] } = {}): void {
  const askModel = deps.ask ?? ask;
  registerWizardSourceRoutes(app, { ...deps.sources, ask: askModel });
  registerWorldPhotoRoutes(app, deps.world);
  /**
   * Які рушії доступні цьому користувачеві — для селектора в майстрі.
   * Значення ключів назовні не віддаються, лише факт наявності й джерело.
   */
  app.get('/api/express/engines', async (req, res) => {
    try {
      const engines = await availableEngines(req.principal?.id ?? null);
      res.json({ engines, hint: engines.length ? null : noEngineMessage() });
    } catch (err) {
      res.status(500).json({ error: String((err as Error).message) });
    }
  });

  /** Створення чернетки. Повертає id, який клієнт кладе в localStorage. */
  app.post('/api/express/draft', async (req, res) => {
    try {
      if (req.body?.payload !== undefined && (!req.body.payload || typeof req.body.payload !== 'object' || Array.isArray(req.body.payload))) {
        throw new DraftValidationError('Некоректні поля чернетки.');
      }
      const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
      const genre = typeof req.body?.genre === 'string' ? req.body.genre.trim() : '';
      // Напрям приймаємо лише зі списку відомих: сюди приходить значення
      // з браузера, і чужий рядок у чернетці згодом виглядав би як
      // підтримувана гілка, якої немає.
      const rawTrack = typeof req.body?.track === 'string' ? req.body.track.trim() : '';
      const track = KNOWN_TRACKS.includes(rawTrack) ? rawTrack : '';
      const draft = createDraft(req.principal?.id ?? null, {
        ...(req.body?.payload ?? {}),
        ...(seed ? { seed } : {}),
        ...(genre ? { genre } : {}),
        ...(track ? { track } : {}),
      });
      res.status(201).json(draft);
    } catch (err) {
      draftFailure(res, err);
    }
  });

  /** Відновлення чернетки за id з localStorage. */
  app.get('/api/express/draft/:id', async (req, res) => {
    try {
      const draft = readAllowedDraft(req.params.id, req);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }
      res.json(draft);
    } catch (err) {
      draftFailure(res, err);
    }
  });

  /** Часткове збереження кроку. */
  app.patch('/api/express/draft/:id', async (req, res) => {
    try {
      readAllowedDraft(req.params.id, req);
      const patch = req.body?.payload as ExpressPayload | undefined;
      const step = typeof req.body?.step === 'number' ? req.body.step : undefined;
      const draft = updateDraft(req.params.id, patch ?? {}, req.body?.expectedRevision, step);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }
      res.json(draft);
    } catch (err) {
      draftFailure(res, err);
    }
  });

  /** Крок Е1 «Кинути кубик» — задум для того, хто прийшов без ідеї. */
  app.post('/api/express/seed', requireAuth, requirePermission('canUseAi'), async (req, res) => {
    try {
      const { system, prompt } = seedPrompt();
      const { text: raw } = await askModel(req, 'Експрес-майстер: випадковий задум', system, prompt);
      const parsed = parseJson<{ seed?: string; genre?: string }>(raw);
      if (!parsed?.seed) {
        res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
        return;
      }
      res.json({ seed: parsed.seed, genre: parsed.genre ?? '' });
    } catch (err) {
      draftFailure(res, err, 502, 'ai_failed');
    }
  });

  /**
   * Кроки Е2-Е4 одним ендпоінтом із параметром `stage`: три різні промпти,
   * але однакові оболонка, розбір відповіді й збереження в чернетку —
   * тримати їх трьома майже однаковими маршрутами означало б правити
   * кожну помилку тричі.
   */
  app.post('/api/express/suggest', requireAuth, requirePermission('canUseAi'), async (req, res) => {
    const stage = String(req.body?.stage ?? '');
    const draftId = String(req.body?.draftId ?? '');

    try {
      const draft = readAllowedDraft(draftId, req);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }

      assertDraftRevision(draft, req.body?.expectedRevision);
      await assertSources(req, draft);

      if (stage === 'framework') {
        const { system, prompt } = frameworkPrompt(draft.payload);
        const { text: raw } = await askModel(req, 'Експрес-майстер: модель розповіді', system, prompt);
        const parsed = parseJson<{
          framework?: string;
          rationale?: string;
          natureConnection?: boolean;
          archetypes36?: boolean;
        }>(raw);

        // Модель іноді вигадує назву моделі розповіді; беремо лише ту, що
        // існує, інакше далі майстер поведеться непередбачувано.
        const framework =
          parsed?.framework && FRAMEWORKS.has(parsed.framework) ? parsed.framework : 'hero_journey';

        const patch: ExpressPayload = {
          reviewConfirmed: false, structureConfirmed: false,
          framework,
          frameworkRationale: parsed?.rationale ?? '',
          natureConnection: draft.payload.natureConnection === true,
          archetypes36: draft.payload.archetypes36 === true,
        };
        await assertSources(req, draft);
        const updated = updateDraft(draftId, patch, draft.revision, 2);
        res.json({ stage, payload: patch, draft: updated });
        return;
      }

      if (stage === 'cast') {
        const { system, prompt } = castPrompt(draft.payload);
        const { text: raw } = await askModel(req, 'Експрес-майстер: каст', system, prompt);
        const parsed = parseJson<{ cast?: ExpressPayload['cast'] }>(raw);
        if (!parsed?.cast?.length) {
          res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
          return;
        }
        if (parsed.cast.some((c) => !c || typeof c.firstName !== 'string' || typeof c.lastName !== 'string')) {
          throw new DraftValidationError('Модель повернула некоректний склад героїв.');
        }
        // AI-пропозиція має власні id і ніколи не запозичує ідентичність чинного cast.
        const cast = withStableCastIds(parsed.cast.map(({ id: _ignored, ...c }) => c));
        const latest = readAllowedDraft(draftId, req);
        if (!latest) { res.status(404).json({ error: 'Чернетку не знайдено.' }); return; }
        assertDraftRevision(latest, draft.revision);
        await assertSources(req, latest);
        if (draft.payload.cast?.length) {
          res.json({ stage, payload: { cast }, needsConfirmation: true, draft: latest });
          return;
        }
        const updated = updateDraft(draftId, { cast, reviewConfirmed: false, structureConfirmed: false }, draft.revision, 3);
        res.json({ stage, payload: { cast: updated!.payload.cast }, draft: updated });
        return;
      }

      if (['plan', 'synopsis'].includes(stage) && draft.payload.entryMode === 'characters_photos' &&
          (!draft.payload.cast?.length || draft.payload.cast.some(c => !c.approved))) {
        throw new DraftValidationError('Перевірте й підтвердьте картки героїв перед створенням синопсису.');
      }
      if (stage === 'plan') {
        const { system, prompt } = compositionPrompt(draft.payload);
        const { text: raw } = await askModel(req, 'Експрес-майстер: загальний план', system, prompt);
        const parsed = parseJson<{ compositionPlan?: string }>(raw);
        if (!parsed?.compositionPlan?.trim()) throw new DraftValidationError('Модель не повернула план.');
        await assertSources(req, draft);
        const updated = updateDraft(draftId, { compositionPlan: parsed.compositionPlan, reviewConfirmed: false, structureConfirmed: false }, draft.revision, 4);
        res.json({ stage, payload: { compositionPlan: parsed.compositionPlan }, draft: updated });
        return;
      }

      if (stage === 'synopsis') {
        const { system, prompt } = synopsisPrompt(draft.payload);
        const { text: raw } = await askModel(req, 'Експрес-майстер: синопсис', system, prompt);
        const parsed = parseJson<{ synopsis?: string }>(raw);
        if (!parsed?.synopsis) {
          res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
          return;
        }
        await assertSources(req, draft);
        const updated = updateDraft(draftId, { synopsis: parsed.synopsis, reviewConfirmed: false, structureConfirmed: false }, draft.revision, 4);
        res.json({ stage, payload: { synopsis: parsed.synopsis }, draft: updated });
        return;
      }

      res.status(400).json({ error: 'Невідомий крок. Очікується framework, cast або synopsis.' });
    } catch (err) {
      draftFailure(res, err, 502, 'ai_failed');
    }
  });

  /**
   * Крок Е5 — одна частина на виклик. Клієнт викликає тричі поспіль і
   * домальовує структуру, що й дає ефект «народжується на очах» без SSE.
   */
  app.post('/api/express/generate', requireAuth, requirePermission('canUseAi'), async (req, res) => {
    const draftId = String(req.body?.draftId ?? '');
    const partNumber = Number(req.body?.partNumber ?? 1);

    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > TOTAL_PARTS) {
      res.status(400).json({ error: `partNumber має бути від 1 до ${TOTAL_PARTS}.` });
      return;
    }

    try {
      const draft = readAllowedDraft(draftId, req);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }

      assertDraftRevision(draft, req.body?.expectedRevision);
      await assertSources(req, draft);
      if (draft.payload.entryMode === 'characters_photos' &&
          (!draft.payload.cast?.length || draft.payload.cast.some(c => !c.approved))) {
        throw new DraftValidationError('Спершу підтвердьте картки героїв.');
      }
      const { system, prompt } = partPrompt(draft.payload, partNumber, TOTAL_PARTS);
      const { text: raw } = await askModel(req, `Експрес-майстер: частина ${partNumber}`, system, prompt);
      const part = parseJson<Record<string, any>>(raw);
      if (!part || !Array.isArray(part.chapters) || !part.chapters.length) {
        res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
        return;
      }

      const knownCharacters = new Set((draft.payload.cast ?? []).map(c => c.id));
      const knownSources = new Set((draft.payload.sourceMaterials ?? []).filter(s => s.approved).map(s => s.id));
      for (const [chapterIndex, chapter] of part.chapters.entries()) {
        if (!chapter || typeof chapter.summary !== 'string' || typeof chapter.chapterTitle !== 'string' ||
            (chapter.involvedCharacterIds !== undefined && (!Array.isArray(chapter.involvedCharacterIds) || chapter.involvedCharacterIds.some((id: string) => !knownCharacters.has(id)))) ||
            (chapter.sourceIds !== undefined && (!Array.isArray(chapter.sourceIds) || chapter.sourceIds.some((id: string) => !knownSources.has(id))))) {
          throw new DraftValidationError('Модель повернула главу з невідомими героями або джерелами.');
        }
        if (Array.isArray(chapter.involvedCharacterIds)) chapter.involvedCharacters = chapter.involvedCharacterIds.map((id: string) => {
          const member = draft.payload.cast!.find(c => c.id === id)!;
          return member.firstName + ' ' + member.lastName;
        });
        chapter.chapterNumber = (draft.payload.parts ?? []).slice(0, partNumber - 1).reduce<number>((sum: number, p: any) => sum + (p?.chapters?.length ?? 0), 0) + chapterIndex + 1;
        chapter.source = 'ai';
      }
      // Частини накопичуються в чернетці, а не тільки летять клієнту: якщо
      // вкладку закриють на третій, перші дві лишаться.
      const parts = [...(draft.payload.parts ?? [])];
      parts[partNumber - 1] = part;
      await assertSources(req, draft);
      const updated = updateDraft(draftId, { parts, structureConfirmed: false }, draft.revision, 5);

      res.json({ partNumber, totalParts: TOTAL_PARTS, part, draft: updated });
    } catch (err) {
      draftFailure(res, err, 502, 'ai_failed');
    }
  });

  /** Привʼязка анонімної чернетки до акаунта після входу (§3.4.5). */
  app.post('/api/express/claim', requireAuth, async (req, res) => {
    try {
      const draftId = String(req.body?.draftId ?? '');
      const draft = claimDraft(draftId, req.principal!.id as string, req.body?.expectedRevision);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено, її термін минув або вона належить іншому.' });
        return;
      }
      res.json(draft);
    } catch (err) {
      draftFailure(res, err);
    }
  });
}

/**
 * Експрес-майстер «Книга за 5 хвилин» (Wisart Book Crealiry.md §3.4).
 *
 * Окремий файл, а не додаток до server.ts: той уже перевалив за 1700 рядків,
 * і саме тому решта модулів давно живе тут поруч.
 *
 * Маршрути свідомо НЕ під `requireAuth`: майстер проходять анонімно, і
 * реєстрацію просять аж на переході в панель створення книг. Захист від
 * чужої чернетки — не сесія, а сам `draftId`: випадковий UUID, який знає
 * лише той, кому його віддали. Виняток — `claim`, де акаунт уже потрібен.
 */

import type { Express } from 'express';
import { requireAuth } from './auth';
import { generateText } from './aiCore';
import {
  availableEngines,
  noEngineMessage,
  resolveEngineForWizard,
} from './expressEngine';
import {
  claimDraft,
  createDraft,
  getDraft,
  updateDraft,
  type ExpressPayload,
} from './expressStore';
import {
  castPrompt,
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
const KNOWN_TRACKS = ['book', 'course', 'instruction', 'game'];

const FRAMEWORKS = new Set([
  'hero_journey',
  'psychotypes',
  'vedic_archetypes',
  'buddhist_skandhas',
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
    apiKeyOverride: choice.apiKeyOverride,
    req,
    label,
  });

  return { text: result.text, engine: choice.engine, source: choice.source };
}

export function registerExpressRoutes(app: Express): void {
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
      const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
      const genre = typeof req.body?.genre === 'string' ? req.body.genre.trim() : '';
      // Напрям приймаємо лише зі списку відомих: сюди приходить значення
      // з браузера, і чужий рядок у чернетці згодом виглядав би як
      // підтримувана гілка, якої немає.
      const rawTrack = typeof req.body?.track === 'string' ? req.body.track.trim() : '';
      const track = KNOWN_TRACKS.includes(rawTrack) ? rawTrack : '';
      const draft = createDraft(req.principal?.id ?? null, {
        ...(seed ? { seed } : {}),
        ...(genre ? { genre } : {}),
        ...(track ? { track } : {}),
      });
      res.status(201).json(draft);
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message), kind: 'storage_unavailable' });
    }
  });

  /** Відновлення чернетки за id з localStorage. */
  app.get('/api/express/draft/:id', async (req, res) => {
    try {
      const draft = getDraft(req.params.id);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }
      res.json(draft);
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message), kind: 'storage_unavailable' });
    }
  });

  /** Часткове збереження кроку. */
  app.patch('/api/express/draft/:id', async (req, res) => {
    try {
      const patch = req.body?.payload as ExpressPayload | undefined;
      const step = typeof req.body?.step === 'number' ? req.body.step : undefined;
      const draft = updateDraft(req.params.id, patch ?? {}, step);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }
      res.json(draft);
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message), kind: 'storage_unavailable' });
    }
  });

  /** Крок Е1 «Кинути кубик» — задум для того, хто прийшов без ідеї. */
  app.post('/api/express/seed', async (req, res) => {
    try {
      const { system, prompt } = seedPrompt();
      const { text: raw } = await ask(req, 'Експрес-майстер: випадковий задум', system, prompt);
      const parsed = parseJson<{ seed?: string; genre?: string }>(raw);
      if (!parsed?.seed) {
        res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
        return;
      }
      res.json({ seed: parsed.seed, genre: parsed.genre ?? '' });
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message), kind: 'ai_failed' });
    }
  });

  /**
   * Кроки Е2-Е4 одним ендпоінтом із параметром `stage`: три різні промпти,
   * але однакові оболонка, розбір відповіді й збереження в чернетку —
   * тримати їх трьома майже однаковими маршрутами означало б правити
   * кожну помилку тричі.
   */
  app.post('/api/express/suggest', async (req, res) => {
    const stage = String(req.body?.stage ?? '');
    const draftId = String(req.body?.draftId ?? '');

    try {
      const draft = getDraft(draftId);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }

      if (stage === 'framework') {
        const { system, prompt } = frameworkPrompt(draft.payload);
        const { text: raw } = await ask(req, 'Експрес-майстер: модель розповіді', system, prompt);
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
          framework,
          frameworkRationale: parsed?.rationale ?? '',
          natureConnection: parsed?.natureConnection !== false,
          archetypes36: parsed?.archetypes36 !== false,
        };
        const updated = updateDraft(draftId, patch, 2);
        res.json({ stage, payload: patch, draft: updated });
        return;
      }

      if (stage === 'cast') {
        const { system, prompt } = castPrompt(draft.payload);
        const { text: raw } = await ask(req, 'Експрес-майстер: каст', system, prompt);
        const parsed = parseJson<{ cast?: ExpressPayload['cast'] }>(raw);
        if (!parsed?.cast?.length) {
          res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
          return;
        }
        const updated = updateDraft(draftId, { cast: parsed.cast }, 3);
        res.json({ stage, payload: { cast: parsed.cast }, draft: updated });
        return;
      }

      if (stage === 'synopsis') {
        const { system, prompt } = synopsisPrompt(draft.payload);
        const { text: raw } = await ask(req, 'Експрес-майстер: синопсис', system, prompt);
        const parsed = parseJson<{ synopsis?: string }>(raw);
        if (!parsed?.synopsis) {
          res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
          return;
        }
        const updated = updateDraft(draftId, { synopsis: parsed.synopsis }, 4);
        res.json({ stage, payload: { synopsis: parsed.synopsis }, draft: updated });
        return;
      }

      res.status(400).json({ error: 'Невідомий крок. Очікується framework, cast або synopsis.' });
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message), kind: 'ai_failed' });
    }
  });

  /**
   * Крок Е5 — одна частина на виклик. Клієнт викликає тричі поспіль і
   * домальовує структуру, що й дає ефект «народжується на очах» без SSE.
   */
  app.post('/api/express/generate', async (req, res) => {
    const draftId = String(req.body?.draftId ?? '');
    const partNumber = Number(req.body?.partNumber ?? 1);

    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > TOTAL_PARTS) {
      res.status(400).json({ error: `partNumber має бути від 1 до ${TOTAL_PARTS}.` });
      return;
    }

    try {
      const draft = getDraft(draftId);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено або її термін минув.' });
        return;
      }

      const { system, prompt } = partPrompt(draft.payload, partNumber, TOTAL_PARTS);
      const { text: raw } = await ask(req, `Експрес-майстер: частина ${partNumber}`, system, prompt);
      const part = parseJson<Record<string, unknown>>(raw);
      if (!part) {
        res.status(502).json({ error: 'Не вдалося розібрати відповідь моделі.', kind: 'ai_bad_json' });
        return;
      }

      // Частини накопичуються в чернетці, а не тільки летять клієнту: якщо
      // вкладку закриють на третій, перші дві лишаться.
      const parts = [...(draft.payload.parts ?? [])];
      parts[partNumber - 1] = part;
      const updated = updateDraft(draftId, { parts }, 5);

      res.json({ partNumber, totalParts: TOTAL_PARTS, part, draft: updated });
    } catch (err) {
      res.status(502).json({ error: String((err as Error).message), kind: 'ai_failed' });
    }
  });

  /** Привʼязка анонімної чернетки до акаунта після входу (§3.4.5). */
  app.post('/api/express/claim', requireAuth, async (req, res) => {
    try {
      const draftId = String(req.body?.draftId ?? '');
      const draft = claimDraft(draftId, req.principal!.id as string);
      if (!draft) {
        res.status(404).json({ error: 'Чернетку не знайдено, її термін минув або вона належить іншому.' });
        return;
      }
      res.json(draft);
    } catch (err) {
      res.status(503).json({ error: String((err as Error).message), kind: 'storage_unavailable' });
    }
  });
}

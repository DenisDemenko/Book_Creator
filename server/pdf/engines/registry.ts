/**
 * Реєстр рушіїв PDF: одне місце, де існує перелік, і одне місце, де рушій
 * обирається на ім'я.
 *
 * ЧОМУ ВІН ПОТРІБЕН ОКРЕМО. Спокуса — розкидати `if (engineId === 'pandoc')`
 * по маршрутах. Тоді додавання пʼятого рушія стає полюванням на ці `if`, а
 * забутий `if` дає не помилку, а тихо інший файл. Тут натомість один
 * словник, і маршрут не знає назв рушіїв узагалі.
 *
 * `listEngines()` — те, що бачить автор. Він повертає ВСІ рушії, включно з
 * недоступними, разом із причиною: «pandoc не встановлено в образі» —
 * корисна відповідь, зникла з переліку кнопка — ні.
 */

import { novaEngine } from './novaEngine';
import { chromiumEngine } from './chromiumEngine';
import { pandocEngine } from './pandocEngine';
import { gammaEngine } from './gammaEngine';
import {
  DEFAULT_PDF_ENGINE,
  PDF_ENGINE_IDS,
  PdfEngineError,
  type PdfEngine,
  type PdfEngineContext,
  type PdfEngineId,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

/**
 * Рушії в порядку показу автору: спершу той, що завжди працює.
 *
 * Решта підключаються в міру готовності — доки рушій не зареєстрований,
 * його просто немає, і жодне місце коду про нього не згадує.
 */
const ENGINES: Partial<Record<PdfEngineId, PdfEngine>> = {
  nova: novaEngine,
  chromium: chromiumEngine,
  pandoc: pandocEngine,
  gamma: gammaEngine,
};

/** Дозволяє під'єднати рушій із його файлу, не редагуючи цей словник вручну. */
export function registerPdfEngine(engine: PdfEngine): void {
  ENGINES[engine.id] = engine;
}

export function getPdfEngine(id: string): PdfEngine | null {
  return ENGINES[id as PdfEngineId] ?? null;
}

export interface PdfEngineDescription {
  id: PdfEngineId;
  label: string;
  strengthUk: string;
  limitUk: string;
  supportsPrint: boolean;
  available: boolean;
  reasonUk?: string;
  fixUk?: string;
  isDefault: boolean;
}

/**
 * Перелік для інтерфейсу. Перевірки доступності виконуються паралельно й
 * НЕ валять перелік: рушій, чий `available()` кинув виняток, показується
 * недоступним із текстом винятку — інакше один зламаний рушій ховав би
 * решту три.
 */
export async function listPdfEngines(
  context: PdfEngineContext = {}
): Promise<PdfEngineDescription[]> {
  const present = PDF_ENGINE_IDS.map((id) => ENGINES[id]).filter((e): e is PdfEngine => !!e);

  const checked = await Promise.all(
    present.map(async (engine) => {
      try {
        const state = await engine.available(context);
        return { engine, state };
      } catch (err) {
        return {
          engine,
          state: { ok: false, reasonUk: `Перевірка не вдалася: ${(err as Error).message}` },
        };
      }
    })
  );

  return checked.map(({ engine, state }) => ({
    id: engine.id,
    label: engine.label,
    strengthUk: engine.strengthUk,
    limitUk: engine.limitUk,
    supportsPrint: engine.supportsPrint,
    available: state.ok,
    reasonUk: state.ok ? undefined : state.reasonUk,
    fixUk: state.ok ? undefined : state.fixUk,
    isDefault: engine.id === DEFAULT_PDF_ENGINE,
  }));
}

/**
 * Зверстати обраним рушієм.
 *
 * ТИХОГО ВІДКОТУ НА ІНШИЙ РУШІЙ ТУТ НЕМАЄ, І ЦЕ НАВМИСНО. Автор обрав
 * вигляд книги; підмінити рушій — значить видати йому інший файл під
 * виглядом того, що він замовив. Те саме правило вже діє для джерел даних
 * Etsy (запис #88): підміна джерела без слова — гірша за помилку.
 */
export async function renderWithEngine(
  engineId: string | undefined,
  request: PdfRenderRequest
): Promise<PdfRenderResult> {
  const id = (engineId || DEFAULT_PDF_ENGINE) as PdfEngineId;
  const engine = getPdfEngine(id);
  if (!engine) {
    throw new PdfEngineError(
      DEFAULT_PDF_ENGINE,
      'bad_input',
      `Невідомий рушій PDF: «${id}». Доступні: ${Object.keys(ENGINES).join(', ')}.`
    );
  }

  if (request.print && !engine.supportsPrint) {
    throw new PdfEngineError(
      engine.id,
      'bad_input',
      `Рушій «${engine.label}» не робить друковану редакцію під KDP: ` +
        'дзеркальні поля й корінець за обсягом уміє лише власна верстка Nova.'
    );
  }

  // Перевірка доступності сама може впасти (немає теки, немає прав). Це
  // теж «рушій не працює», а не збій маршруту: інакше автор побачив би
  // необроблену помилку Node замість причини українською.
  let state;
  try {
    state = await engine.available({ ownerId: request.ownerId, ownerRole: request.ownerRole });
  } catch (err) {
    throw new PdfEngineError(
      engine.id,
      'unavailable',
      `Не вдалося перевірити рушій «${engine.label}»: ${(err as Error).message}`
    );
  }
  if (!state.ok) {
    throw new PdfEngineError(
      engine.id,
      'unavailable',
      [state.reasonUk, state.fixUk].filter(Boolean).join(' ') || 'Рушій недоступний.'
    );
  }

  return engine.render(request);
}

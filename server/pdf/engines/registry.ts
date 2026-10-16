/**
 * Реєстр рушіїв PDF: одне місце, де існує перелік, і одне місце, де рушій
 * обирається на ім'я.
 */

import { novaEngine } from './novaEngine';
import { chromiumEngine } from './chromiumEngine';
import { pandocEngine } from './pandocEngine';
import { designcraftEngineV3 } from './designcraftEngineV3';
import { pageCountOnlyMap, type CanonicalPageMapSource } from '../../../shared/canonicalPageMap';
import {
  DEFAULT_PDF_ENGINE,
  PDF_ENGINE_IDS,
  PdfEngineError,
  type PdfEngine,
  type PdfEngineContext,
  type PdfEngineId,
  type PdfRenderRequest,
  type NormalizedPdfRenderResult,
} from './types';

/** Рушії в порядку показу автору. */
const ENGINES: Partial<Record<PdfEngineId, PdfEngine>> = {
  nova: novaEngine,
  designcraft: designcraftEngineV3,
  chromium: chromiumEngine,
  pandoc: pandocEngine,
  // gamma: свідомо НЕ зареєстрована. Код підсистеми лишається на місці.
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

/** Перелік для інтерфейсу. Перевірки доступності виконуються паралельно. */
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

function fallbackPageMap(engineId: PdfEngineId, pageCount: number) {
  const sourceByEngine: Record<PdfEngineId, CanonicalPageMapSource> = {
    nova: 'nova-pdf',
    designcraft: 'designcraft-toc',
    chromium: 'chromium-pdf',
    pandoc: 'pandoc-toc',
    gamma: 'external-pdf',
  };
  return pageCountOnlyMap(
    engineId,
    sourceByEngine[engineId],
    pageCount,
    'Рушій повернув точну загальну кількість сторінок, але ще не експортував координати глав і секцій у CanonicalPageMap.'
  );
}

/**
 * Зверстати обраним рушієм. Тихого відкоту на інший рушій немає.
 *
 * ВАЖЛИВО: це єдина публічна межа нормалізації пагінації. Кожен renderer
 * може мати свій внутрішній механізм (pdf-lib, DesignCraft, Chromium, TeX),
 * але назовні завжди повертається один CanonicalPageMap. UI не має права
 * повторно рахувати сторінки з рукопису.
 */
export async function renderWithEngine(
  engineId: string | undefined,
  request: PdfRenderRequest
): Promise<NormalizedPdfRenderResult> {
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

  const effectiveRequest: PdfRenderRequest =
    engine.id === 'designcraft' && request.theme
      ? {
          ...request,
          spec: {
            ...(request.spec || {}),
            themeId: request.theme,
          } as PdfRenderRequest['spec'],
        }
      : request;

  const result = await engine.render(effectiveRequest);
  return {
    ...result,
    pageMap: result.pageMap || fallbackPageMap(engine.id, result.pageCount),
  };
}

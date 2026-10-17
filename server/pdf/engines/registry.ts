/**
 * Реєстр рушіїв PDF: одне місце, де існує перелік, і одне місце, де рушій
 * обирається на ім'я.
 */

import { buildPhysicalPaginationResult } from '../../../src/utils/canonicalPageMap';
import { novaEngine } from './novaEngine';
import { chromiumEngine } from './chromiumEngine';
import { pandocEngine } from './pandocEngine';
import { designcraftEngineV3 } from './designcraftEngineV3';
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

/**
 * Зверстати обраним рушієм. Тихого відкоту на інший рушій немає.
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

  /*
   * Book Design Studio theme is a DesignCraft concern, not a generic PDF
   * engine setting. Keep the public request backward-compatible (`theme`) and
   * bridge it into the renderer's layout spec only for DesignCraft. This means
   * Nova/Chromium/Pandoc continue to receive exactly the same request shape and
   * behavior as before.
   *
   * `themeId` is intentionally an extension of PdfLayoutSpec during this
   * migration slice. `buildDesigncraftRtf` reads it without requiring a schema
   * migration for every stored book. Once the writer-facing picker lands, the
   * field can become first-class in PdfLayoutSpec without changing stored ids.
   */
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

  const rendered = await engine.render(effectiveRequest);

  // Physical page parity is available for EVERY engine because pageCount is
  // read from the PDF that was actually produced. Never substitute browser
  // pagination here. Engines that know semantic positions may return a richer
  // map themselves; otherwise we attach an exact, honest physical-only map.
  if (rendered.pagination) return rendered;
  return {
    ...rendered,
    pagination: buildPhysicalPaginationResult(rendered.pageCount, {
      id: rendered.engineId,
      label: engine.label,
      exportAuthoritative: true,
    }),
  };
}

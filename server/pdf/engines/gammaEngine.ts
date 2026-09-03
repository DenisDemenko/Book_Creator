/**
 * Рушій «Gamma» — той самий сервіс, що вже вбудований у Студію (#96–#99),
 * але поставлений у ЗАГАЛЬНИЙ перелік рушіїв PDF.
 *
 * НАЩО. Досі Gamma жила окремою вкладкою публікації, а PDF робив окремий
 * рушій. Для автора це два різні місця з тим самим питанням «як буде
 * виглядати мій файл». Тепер питання одне й вибір один.
 *
 * ЧИМ ВІН ПРИНЦИПОВО ІНШИЙ ЗА РЕШТУ ТРЬОХ, І ЦЕ СКАЗАНО ПРЯМО:
 *
 *   1. **Він коштує грошей АВТОРА.** Не наших: генерація списує кредити з
 *      підписки, яку автор підключив сам (#99). Тому в примітках до
 *      результату завжди стоїть, скільки саме списано й скільки лишилось —
 *      мовчазна витрата чужих кредитів неприпустима.
 *   2. **Він переписує текст.** Решта рушіїв верстають те, що написав
 *      автор. Gamma — генеративна: вона робить із рукопису СВІЙ документ.
 *      Тому `honoredSpec` тут завжди `false`, і в примітці це названо, а не
 *      сховане за словом «оформлення».
 *   3. **Він повільний** — хвилини, не секунди, і залежить від чужого
 *      сервера.
 *
 * Через (1) і (2) він НЕ може бути рушієм за замовчуванням і ніколи не
 * підставляється замість іншого: у реєстрі тихого відкоту немає взагалі.
 */

import { PDFDocument } from 'pdf-lib';
import { bookToMarkdown } from '../bookToMarkdown';
import { resolveGammaKey } from '../../gamma/gammaAccount';
import { createGeneration, getGeneration, type GammaClient } from '../../gamma/gammaClient';
import { GAMMA_MAX_WAIT_MS, GAMMA_POLL_INTERVAL_MS } from '../../gamma/gammaConfig';
import { LIMITS } from '../../gamma/gammaCost';
import {
  PdfEngineError,
  type PdfEngine,
  type PdfEngineAvailability,
  type PdfEngineContext,
  type PdfRenderRequest,
  type PdfRenderResult,
} from './types';

/**
 * Фабрика клієнта приходить із `server.ts` — там живуть `fetch`, обмежувач
 * швидкості й логер. Тягнути їх сюди означало б, що рушій PDF знає про
 * налаштування мережі всього застосунку.
 */
type MakeClient = (apiKey: string) => GammaClient;

let makeClient: MakeClient | null = null;

export function configureGammaEngine(deps: { makeClient: MakeClient }): void {
  makeClient = deps.makeClient;
}

/** Скільки карток просити. Книга — це документ, а не презентація на 10 слайдів. */
const DEFAULT_CARDS = 40;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const gammaEngine: PdfEngine = {
  id: 'gamma',
  label: 'Gamma (генеративний документ)',
  strengthUk:
    'Робить із рукопису оформлений документ з ілюстраціями й макетом — ' +
    'корисно для роздаткових матеріалів курсу, а не для самої книги.',
  limitUk:
    'Переписує текст, а не верстає його; списує кредити ВАШОЇ підписки Gamma; ' +
    'працює хвилини й залежить від чужого сервера.',
  supportsPrint: false,

  async available(context: PdfEngineContext = {}): Promise<PdfEngineAvailability> {
    if (!makeClient) {
      return {
        ok: false,
        reasonUk: 'Клієнт Gamma не налаштований на сервері.',
        fixUk: 'Це наша справа, не ваша — повідомте студію.',
      };
    }
    const key = await resolveGammaKey({ userId: context.ownerId, role: context.ownerRole });
    if (!key.apiKey) {
      return { ok: false, reasonUk: key.reasonUk || 'Підписку Gamma не підключено.' };
    }
    return { ok: true };
  },

  async render(request: PdfRenderRequest): Promise<PdfRenderResult> {
    const state = await this.available({ ownerId: request.ownerId, ownerRole: request.ownerRole });
    if (!state.ok) {
      throw new PdfEngineError('gamma', 'unavailable', state.reasonUk || 'Gamma недоступна.');
    }

    const key = await resolveGammaKey({ userId: request.ownerId, role: request.ownerRole });
    const client = makeClient!(key.apiKey!);
    const notesUk: string[] = [];

    const doc = bookToMarkdown(request.book as never, { frontmatter: false, withImages: false });
    if (doc.images.length === 0) {
      notesUk.push('Ваші ілюстрації не передаються: Gamma малює власні.');
    }

    let inputText = doc.markdown;
    if (inputText.length > LIMITS.inputTextMax) {
      inputText = inputText.slice(0, LIMITS.inputTextMax);
      notesUk.push(
        `Текст обрізано до ${LIMITS.inputTextMax} символів — це межа Gamma, ` +
          'і кінець книги в документ не потрапив.'
      );
    }

    try {
      const started = await createGeneration(client, {
        inputText,
        format: 'document',
        numCards: DEFAULT_CARDS,
        title: doc.meta.title,
        // Просимо PDF одразу при генерації: окремий крок експорту — це ще
        // одне очікування й ще одне місце, де все може зупинитись.
        exportAs: 'pdf',
        textMode: 'preserve',
      });

      const deadline = Date.now() + GAMMA_MAX_WAIT_MS;
      let status = await getGeneration(client, started.generationId);
      while (status.status === 'pending' && Date.now() < deadline) {
        await sleep(GAMMA_POLL_INTERVAL_MS);
        status = await getGeneration(client, started.generationId);
      }

      if (status.status === 'pending') {
        throw new PdfEngineError(
          'gamma',
          'timeout',
          `Gamma не встигла за ${Math.round(GAMMA_MAX_WAIT_MS / 1000)} с. ` +
            'Документ може дозріти пізніше — подивіться в кабінеті Gamma, ' +
            'кредити за нього вже списано.'
        );
      }
      if (status.status === 'failed' || !status.exportUrl) {
        throw new PdfEngineError(
          'gamma',
          'engine',
          `Gamma не зробила документ${status.error ? `: ${String(status.error)}` : '.'}`
        );
      }

      // Кредити — у примітках завжди, і при успіху теж: автор має бачити
      // ціну кожного натискання, а не дізнаватись про неї з рахунку.
      if (typeof status.credits?.deducted === 'number') {
        notesUk.push(
          `Списано кредитів Gamma: ${status.credits.deducted}` +
            (typeof status.credits.remaining === 'number'
              ? `, лишилось ${status.credits.remaining}.`
              : '.')
        );
      }

      const res = await fetch(status.exportUrl);
      if (!res.ok) {
        throw new PdfEngineError(
          'gamma',
          'engine',
          `Файл згенеровано, але не завантажився (HTTP ${res.status}). ` +
            `Він є в кабінеті Gamma: ${status.gammaUrl || 'див. перелік документів'}.`
        );
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const pageCount = (await PDFDocument.load(bytes)).getPageCount();

      notesUk.push(
        'Документ згенеровано Gamma: це переказ вашого тексту її словами й ' +
          'у її макеті, а не верстка рукопису.'
      );

      return { bytes, pageCount, engineId: 'gamma', honoredSpec: false, notesUk };
    } catch (err) {
      if (err instanceof PdfEngineError) throw err;
      throw new PdfEngineError('gamma', 'engine', (err as Error).message);
    }
  },
};

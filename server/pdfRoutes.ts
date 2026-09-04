/**
 * Маршрути PDF: попередній перегляд і публікація книги у вітрину з файлом.
 *
 * ЧОМУ КНИГА ПРИХОДИТЬ У ТІЛІ ЗАПИТУ. У Nova немає серверної таблиці книг —
 * у базі лежать користувачі, підписки, сесії чату, публікації, але не текст
 * книги (server/db.ts). Книга живе в клієнті, тож сервер не може отримати її
 * «за id»: її треба надіслати. Звідси і ліміт тіла, і те, що маршрути
 * приймають повний обʼєкт книги.
 *
 * Ланцюг публікації тут замикається повністю: макет → PDF → лістинг у
 * каталозі → файл у лістингу. До цього кожна ланка існувала окремо, і саме
 * тому в них знайшлось чотири вади поспіль (записи #69, #70, #73, #74).
 */

import type { Express, Request, Response } from 'express';
import { requireAdmin } from './auth';
import {
  MarketplaceBridgeError,
  attachBookFileToMarketplace,
  publishBookToMarketplace,
  readBridgeSettings,
  unpublishBookFromMarketplace,
} from './marketplaceBridge';
import { resolveCoreTemplate, renderCoreTemplate, type CorePromptTemplateBundle } from './coreAiRegistry';
import { resolveModuleModelId } from './coreModuleModels';
import { renderBookPdf } from './pdf/pdfRenderer';
import { bookToPdfInput, specFromBook } from './pdf/pdfFromBook';
import { normalizeDesignResult, parseBookPdfDesignResponse } from './pdf/pdfDesignPrompt';
import { renderKdpInterior, type KdpRenderResult } from './pdf/pdfKdp';
import { clampSamplePages, extractSamplePages } from './pdf/pdfSample';
import {
  getBook as getStoredBook,
  readArtifact,
  saveArtifact,
} from './bookStore';
import type { PdfLayoutSpec } from './pdf/pdfTypes';
import { listPdfEngines, renderWithEngine } from './pdf/engines/registry';
import { DEFAULT_PDF_ENGINE, PdfEngineError } from './pdf/engines/types';
import { requireAuth } from './auth';

export type LayoutVariant = 'code' | 'design';

export interface PdfRoutesDeps {
  resolveEngine: (modelId: string) => string;
  defaultModelId?: string;
  loadAdminLayer: () => Promise<CorePromptTemplateBundle>;
  generateText: (args: Record<string, unknown>) => Promise<{ text: string }>;
}

/** Скільки тексту книги показати моделі. Більше не потрібно: макет — це не переказ. */
const SAMPLE_CHARS = 2500;

function countWords(book: { chapters?: Array<{ sections?: Array<{ content?: string }> }> }): number {
  let words = 0;
  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) {
      words += String(section.content || '').split(/\s+/).filter(Boolean).length;
    }
  }
  return words;
}

function sampleOf(book: { chapters?: Array<{ sections?: Array<{ content?: string }> }> }): string {
  const parts: string[] = [];
  for (const chapter of book.chapters || []) {
    for (const section of chapter.sections || []) {
      parts.push(String(section.content || ''));
      if (parts.join(' ').length > SAMPLE_CHARS) break;
    }
    if (parts.join(' ').length > SAMPLE_CHARS) break;
  }
  return parts.join('\n\n').slice(0, SAMPLE_CHARS);
}

/**
 * Нижня межа розміру обкладинки. Порожній canvas дає крихітний PNG —
 * суцільна заливка стискається майже в нуль, — тож без цієї межі білий
 * аркуш доїхав би у вітрину як валідна картинка. Клієнт має свою, таку саму
 * за змістом: тут ловимо тих, хто прийшов повз інтерфейс.
 */
const MIN_COVER_BYTES = 3000;

/** Що `registerPdfRoutes` віддає назовні для роботи з серверною копією книги. */
export interface StoredBookOps {
  buildArtifacts: (params: {
    bookId: string;
    variant: 'code' | 'design';
    formats: Array<'digital' | 'print'>;
    trimId?: string;
    samplePages?: number;
    withSample: boolean;
    req: Request;
  }) => Promise<unknown>;
  publishStored: (params: {
    bookId: string;
    editions: Array<Record<string, unknown>>;
    sellerSlug?: string;
    req: Request;
  }) => Promise<unknown>;
}

export function registerPdfRoutes(app: Express, deps: PdfRoutesDeps): StoredBookOps {
  /**
   * Специфікація макета: або переклад налаштувань книги, або пропозиція
   * моделі. Помилка моделі НЕ валить публікацію мовчки — вона піднімається
   * викликачу, щоб автор бачив, що дизайн не вдався, і міг узяти «код».
   */
  async function buildSpec(
    book: Record<string, unknown>,
    variant: LayoutVariant,
    requestedModelId: string | undefined,
    req: Request
  ): Promise<{ spec: PdfLayoutSpec; modelId?: string }> {
    if (variant !== 'design') {
      return { spec: specFromBook(book as never) };
    }

    const modelId = (await resolveModuleModelId('bookPdfDesign', requestedModelId)) || deps.defaultModelId;
    if (!modelId) {
      throw new MarketplaceBridgeError(
        'Для дизайну макета не обрано модель — задайте її в «Ядрі AI» або оберіть варіант «макет із книги».',
        'rejected',
        503
      );
    }

    const template = resolveCoreTemplate('bookPdfDesign', await deps.loadAdminLayer());
    const rendered = renderCoreTemplate('bookPdfDesign', template, {
      title: String(book.title || ''),
      subtitle: String(book.subtitle || ''),
      genre: String(book.genre || ''),
      audience: String(book.targetAudience || ''),
      chapterCount: String(((book.chapters as unknown[]) || []).length),
      wordCount: String(countWords(book as never)),
      sample: sampleOf(book as never),
    });

    const out = await deps.generateText({
      engine: deps.resolveEngine(modelId),
      modelId,
      prompt: rendered.user,
      systemInstruction: rendered.system,
      json: true,
      req,
      label: 'Дизайн макета PDF книги',
      bookId: String(book.id || ''),
    });

    let raw: unknown;
    try {
      raw = parseBookPdfDesignResponse(out.text);
    } catch {
      throw new MarketplaceBridgeError(
        'Модель повернула не JSON — оберіть іншу модель або варіант «макет із книги».',
        'rejected',
        502
      );
    }
    return { spec: normalizeDesignResult(raw), modelId };
  }

  function fail(res: Response, err: unknown) {
    const error = err as { message?: string; kind?: string; status?: number };

    // Відмова рушія — не збій сервера, а стан, у якому автор може щось
    // зробити: обрати інший рушій, спростити книгу, підключити підписку.
    // 500 на це означав би «зламалось у нас», і автор чекав би, поки ми
    // полагодимо те, що працює.
    if (err instanceof PdfEngineError) {
      const status = err.kind === 'timeout' ? 504 : err.kind === 'engine' ? 502 : 400;
      return res.status(status).json({ error: err.message, kind: err.kind, engineId: err.engineId });
    }

    const status = err instanceof MarketplaceBridgeError ? err.status : 500;
    res.status(status).json({ error: error?.message || 'Не вдалося зібрати PDF.', kind: error?.kind });
  }

  /**
   * Перелік рушіїв для інтерфейсу.
   *
   * Під `requireAuth`, а не публічно: доступність Gamma залежить від того,
   * чи підключив підписку САМЕ ЦЕЙ автор, тож без особи відповідь була б
   * або неправдою для всіх, або однаковою для всіх.
   */
  app.get('/api/pdf/engines', requireAuth, async (req, res) => {
    try {
      const principal = req.principal!;
      const engines = await listPdfEngines({
        ownerId: principal.id as string,
        ownerRole: principal.role as string,
      });
      res.json({ engines, defaultEngineId: DEFAULT_PDF_ENGINE });
    } catch (err) {
      fail(res, err);
    }
  });

  /**
   * Перегляд: віддає сам файл. Автор має побачити верстку до того, як вона
   * стане товаром — інакше перша людина, яка подивиться на макет, буде
   * покупцем.
   */
  app.post('/api/admin/pdf/preview', requireAdmin, async (req, res) => {
    try {
      const book = req.body?.book;
      if (!book?.title) {
        return res.status(400).json({ error: 'Потрібен обʼєкт книги з назвою.', kind: 'bad_input' });
      }
      const variant: LayoutVariant = req.body?.variant === 'design' ? 'design' : 'code';
      const { spec } = await buildSpec(book, variant, req.body?.modelId, req);

      // Друкований макет дивляться тим самим переглядом: інакше автор
      // побачив би верстку KDP уперше вже після публікації.
      const isPrint = req.body?.format === 'print';

      // Інший рушій — окрема гілка, а не параметр наявної. Гілка nova нижче
      // робить те, чого не робить жоден інший: три проходи KDP, примітка
      // дизайнера, попередження про поля. Зводити їх до спільного
      // знаменника означало б втратити саме те, заради чого nova лишається
      // рушієм за замовчуванням.
      const engineId = String(req.body?.engineId || DEFAULT_PDF_ENGINE);
      if (engineId !== DEFAULT_PDF_ENGINE) {
        const principal = req.principal;
        const out = await renderWithEngine(engineId, {
          book,
          kind: req.body?.kind === 'course' ? 'course' : 'book',
          spec,
          print: isPrint,
          ownerId: (principal?.id as string) || null,
          ownerRole: (principal?.role as string) || null,
          theme: typeof req.body?.theme === 'string' ? req.body.theme : undefined,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="preview-${engineId}.pdf"`);
        res.setHeader('X-Pdf-Pages', String(out.pageCount));
        res.setHeader('X-Pdf-Engine', out.engineId);
        // Чи виконано макет книги — окремим заголовком, бо це не примітка,
        // а відповідь на питання «чому виглядає не так, як у налаштуваннях».
        res.setHeader('X-Pdf-Honored-Spec', out.honoredSpec ? '1' : '0');
        res.setHeader('X-Pdf-Note', encodeURIComponent(out.notesUk.join(' ')));
        return res.send(Buffer.from(out.bytes));
      }
      const out = isPrint
        ? await renderKdpInterior(bookToPdfInput(book), {
            base: spec,
            trimId: req.body?.trimId,
            hasBleed: Boolean(req.body?.hasBleed),
          })
        : await renderBookPdf(bookToPdfInput(book), spec);
      const noteUk = isPrint ? (out as KdpRenderResult).spec.designerNoteUk : spec.designerNoteUk;
      const warnings = isPrint ? (out as KdpRenderResult).warningsUk : [];

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${isPrint ? 'preview-kdp' : 'preview'}.pdf"`);
      res.setHeader('X-Pdf-Pages', String(out.pageCount));
      // Пояснення макета — заголовком, бо тіло вже зайняте файлом.
      res.setHeader(
        'X-Pdf-Note',
        encodeURIComponent([noteUk || '', ...warnings].filter(Boolean).join(' '))
      );
      res.send(Buffer.from(out.bytes));
    } catch (err) {
      fail(res, err);
    }
  });

  /**
   * Увесь конвеєр однією дією: макет → PDF → лістинг → файл у лістингу.
   *
   * Редакцій може бути кілька. Електронна (`digital`) і друкована (`print`)
   * — це ДВА сусідні лістинги: у маркетплейсі одна ціна на лістинг, а
   * `externalId` містить формат, тож приймач не переплутає їх між собою.
   * Друкована редакція верстається під KDP: інший обріз, дзеркальні поля,
   * корінець за обсягом.
   */
  app.post('/api/admin/pdf/publish', requireAdmin, async (req, res) => {
    try {
      const book = req.body?.book;
      if (!book?.title || !book?.id) {
        return res.status(400).json({ error: 'Потрібен обʼєкт книги з id і назвою.', kind: 'bad_input' });
      }

      // Стара форма запиту (одна ціна) лишається робочою: інакше кнопка,
      // яка вже комусь працює, зламалась би мовчки.
      const editions: Array<Record<string, unknown>> = Array.isArray(req.body?.editions)
        ? req.body.editions
        : [{ format: 'digital', priceMinor: req.body?.priceMinor, variant: req.body?.variant }];

      if (editions.length === 0) {
        return res.status(400).json({ error: 'Не вказано жодної редакції.', kind: 'bad_input' });
      }

      /*
        ОБКЛАДИНКА — УМОВА ПУБЛІКАЦІЇ, А НЕ ПРИКРАСА.
        Картка без зображення — це білий прямокутник у каталозі поруч із
        чужими оформленими товарами; вона не продає, а знецінює. Тому
        перевірка стоїть ДО створення лістинга: без обкладинки у вітрині не
        зʼявляється нічого, замість того щоб зʼявитись і чекати на другу
        кнопку, яку хтось забуде натиснути.

        Малює її браузер (серверу нічим растеризувати PDF), тож приходить
        вона готовим зображенням. Межа розміру — той самий захист від
        «успішного» порожнього полотна, що й на клієнті: суцільна заливка
        стискається майже в нуль, і білий аркуш інакше доїхав би сюди як
        валідна картинка.
      */
      const coverRaw = String(req.body?.coverBase64 || '');
      const coverMatch = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(coverRaw);
      const coverMime = coverMatch ? coverMatch[1] : 'image/png';
      const coverBase64 = coverMatch ? coverMatch[2] : coverRaw;
      if (!coverBase64) {
        return res.status(400).json({
          error:
            'Публікація без обкладинки неможлива: картка книги у вітрині лишилась би порожнім прямокутником. ' +
            'Обкладинка збирається з першої сторінки PDF у браузері — натисніть «Опублікувати» ще раз, коли сторінка домалюється.',
          kind: 'cover_required',
        });
      }
      const coverBytes = Buffer.from(coverBase64, 'base64');
      if (coverBytes.length < MIN_COVER_BYTES) {
        return res.status(400).json({
          error: `Обкладинка підозріло мала (${coverBytes.length} Б) — схоже, сторінка намалювалась порожньою. Публікацію зупинено.`,
          kind: 'cover_blank',
        });
      }

      /*
        Безкоштовний уривок: перші сторінки книги, відкриті всім.
        Вимикається явно (`sample: false`) — за замовчуванням увімкнений,
        бо саме текст, а не опис, вирішує покупку.
      */
      const sampleEnabled = req.body?.sample !== false;
      const samplePages = clampSamplePages(req.body?.samplePages);

      const settings = await readBridgeSettings();
      const safeTitle = String(book.title).replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'book';
      const results = [];

      /*
        Макет вирішується ОДИН раз на всю публікацію, а не в циклі редакцій.
        Раніше `buildSpec` стояв усередині циклу — для варіанта «дизайн» це
        означало два платні виклики моделі на одну книгу і, що гірше, два
        РІЗНІ макети: цифрова й друкована редакції тієї самої книги могли
        вийти з різним кеглем і полями. Друкована й далі накладає норми KDP
        поверх цього макета — але поверх одного й того самого.
      */
      const variant: LayoutVariant = editions.some((e) => e.variant === 'design') ? 'design' : 'code';
      const { spec, modelId } = await buildSpec(
        book,
        variant,
        editions.find((e) => e.modelId)?.modelId as string,
        req
      );

      for (const edition of editions) {
        const format = edition.format === 'print' ? 'print' : 'digital';
        const priceMinor = Number(edition.priceMinor);
        if (!Number.isFinite(priceMinor) || priceMinor < 0) {
          return res.status(400).json({ error: `Некоректна ціна для редакції «${format}».`, kind: 'bad_input' });
        }

        // Друкована редакція йде через KDP-верстку: базову типографіку бере
        // з обраного макета, а формат, поля й корінець — з норм KDP.
        const rendered =
          format === 'print'
            ? await renderKdpInterior(bookToPdfInput(book), {
                base: spec,
                trimId: edition.trimId as string,
                hasBleed: Boolean(edition.hasBleed),
              })
            : await renderBookPdf(bookToPdfInput(book), spec);

        const published = await publishBookToMarketplace(
          {
            bookId: String(book.id),
            format,
            title: format === 'print' ? `${String(book.title)} (друковане видання)` : String(book.title),
            subtitle: book.subtitle ? String(book.subtitle) : undefined,
            summary: book.logline ? String(book.logline) : undefined,
            description: book.synopsis ? String(book.synopsis) : undefined,
            priceMinor: Math.round(priceMinor),
            sellerSlug: req.body?.sellerSlug ? String(req.body.sellerSlug) : undefined,
          },
          { settings }
        );

        // Файл шлемо ПІСЛЯ публікації: приймач прикріплює його до наявного
        // лістинга, і в зворотному порядку отримав би 404.
        const attached = await attachBookFileToMarketplace(
          {
            bookId: String(book.id),
            format,
            filename: format === 'print' ? `${safeTitle}_KDP.pdf` : `${safeTitle}.pdf`,
            mimeType: 'application/pdf',
            bytes: rendered.bytes,
          },
          { settings }
        );

        /*
          ОБКЛАДИНКА, І ВІДКІТ ЯКЩО ВОНА НЕ СІЛА.
          Лістинг уже створений — обкладинку можна прикріпити лише до
          наявного. Але якщо саме вона не пройшла, у вітрині лишилась би
          рівно та порожня картка, заради відсутності якої ця перевірка й
          робилась. Тому лістинг знімається назад в архів, і автор бачить
          причину, а не «опубліковано» з білим прямокутником.
        */
        let coverAttached;
        try {
          coverAttached = await attachBookFileToMarketplace(
            {
              bookId: String(book.id),
              format,
              filename: `${safeTitle}_cover.${coverMime.includes('jpeg') ? 'jpg' : 'png'}`,
              mimeType: coverMime,
              bytes: new Uint8Array(coverBytes),
              kind: 'cover',
            },
            { settings }
          );
        } catch (coverErr) {
          await unpublishBookFromMarketplace({ bookId: String(book.id), format }, { settings }).catch(
            () => {
              // Відкіт теж міг не вдатися — але справжня причина в
              // coverErr, і підміняти її помилкою прибирання не можна.
            }
          );
          throw new MarketplaceBridgeError(
            `Обкладинку не вдалося прикріпити (${(coverErr as Error)?.message || 'невідома причина'}). ` +
              `Редакцію «${format}» знято з вітрини, щоб там не лишилась картка без зображення.`,
            'rejected',
            502
          );
        }

        /*
          Уривок — окремий публічний файл лістинга. Ріжеться з ТОГО САМОГО
          PDF, який щойно пішов покупцеві: «перші десять сторінок» — наслідок
          верстки, а не властивість тексту, тож зверстаний окремо уривок
          обірвався б не там, де обривається десята сторінка книги.

          Його збій, на відміну від обкладинки, публікацію НЕ скасовує:
          книга без уривка продається, книга без обкладинки — ні.
        */
        let sample: { pages: number; totalPages: number; attached: boolean; errorUk?: string } | null = null;
        if (sampleEnabled) {
          try {
            const cut = await extractSamplePages(rendered.bytes, samplePages);
            if (!cut) {
              sample = {
                pages: 0,
                totalPages: rendered.pageCount,
                attached: false,
                errorUk: `У книзі ${rendered.pageCount} сторінок — це не більше за розмір уривка (${samplePages}). Уривок не додано, щоб не віддати книгу цілком безкоштовно.`,
              };
            } else {
              await attachBookFileToMarketplace(
                {
                  bookId: String(book.id),
                  format,
                  filename: `${safeTitle}_uryvok.pdf`,
                  mimeType: 'application/pdf',
                  bytes: cut.bytes,
                  kind: 'sample',
                },
                { settings }
              );
              sample = { pages: cut.pageCount, totalPages: cut.totalPages, attached: true };
            }
          } catch (sampleErr) {
            sample = {
              pages: 0,
              totalPages: rendered.pageCount,
              attached: false,
              errorUk: `Уривок не додано: ${(sampleErr as Error)?.message || 'невідома причина'}. Сама книга опублікована.`,
            };
          }
        }

        // Звужуємо тип явно: renderKdpInterior повертає більше полів, ніж
        // звичайний рендер, і саме вони цікаві авторові друкованої редакції.
        const kdp: KdpRenderResult | null = format === 'print' ? (rendered as KdpRenderResult) : null;
        results.push({
          format,
          published,
          attached,
          cover: coverAttached,
          sample,
          pdf: { pageCount: rendered.pageCount, sizeBytes: rendered.bytes.length },
          layout: {
            variant,
            modelId,
            noteUk: kdp ? kdp.spec.designerNoteUk : spec.designerNoteUk,
            trimId: kdp?.trimId,
            gutterMm: kdp?.gutterMm,
            passes: kdp?.passes,
          },
          warningsUk: kdp?.warningsUk || [],
        });
      }

      res.json({ editions: results });
    } catch (err) {
      fail(res, err);
    }
  });

  // =========================================================================
  // Робота з СЕРВЕРНОЮ копією книги
  // =========================================================================
  //
  // Та сама послідовність, що й у маршрутах вище (макет → PDF → уривок), але
  // книга береться зі сховища, а не з тіла запиту. Саме тому ці кроки можуть
  // виконуватись без відкритої вкладки: серверу більше нічого не потрібно від
  // браузера, крім обкладинки — її він намалювати не вміє, тож вона теж
  // лежить у сховищі як артефакт.

  /** Зібрати й зберегти файли книги. Нічого не публікує. */
  async function buildArtifacts(params: {
    bookId: string;
    variant: 'code' | 'design';
    formats: Array<'digital' | 'print'>;
    trimId?: string;
    samplePages?: number;
    withSample: boolean;
    req: Request;
  }): Promise<unknown> {
    const stored = await getStoredBook(params.bookId);
    if (!stored) {
      throw new MarketplaceBridgeError(
        'Книги немає на сервері. Спершу збережіть її — Студія надсилає копію при кожному збереженні.',
        'rejected',
        404
      );
    }

    const book = stored.book as Record<string, unknown>;
    const safeTitle = String(book.title || 'book').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'book';

    // Макет один на всі формати — з тієї самої причини, що й у публікації з
    // браузера: інакше «дизайн» дав би різну типографіку цифровій і друкованій.
    const { spec, modelId } = await buildSpec(book, params.variant, undefined, params.req);

    const built = [];
    for (const format of params.formats) {
      const rendered =
        format === 'print'
          ? await renderKdpInterior(bookToPdfInput(book as never), {
              base: spec,
              trimId: params.trimId,
            })
          : await renderBookPdf(bookToPdfInput(book as never), spec);

      const pdfRecord = await saveArtifact({
        bookId: stored.id,
        kind: 'pdf',
        format,
        filename: format === 'print' ? `${safeTitle}_KDP.pdf` : `${safeTitle}.pdf`,
        mimeType: 'application/pdf',
        bytes: rendered.bytes,
        pageCount: rendered.pageCount,
        variant: params.variant,
        bookRevision: stored.revision,
      });

      let sampleRecord = null;
      let sampleNoteUk: string | undefined;
      if (params.withSample) {
        const cut = await extractSamplePages(rendered.bytes, clampSamplePages(params.samplePages));
        if (!cut) {
          sampleNoteUk = `У книзі ${rendered.pageCount} сторінок — це не більше за розмір уривка. Уривок не зібрано, щоб не віддати книгу цілком безкоштовно.`;
        } else {
          sampleRecord = await saveArtifact({
            bookId: stored.id,
            kind: 'sample',
            format,
            filename: `${safeTitle}_uryvok.pdf`,
            mimeType: 'application/pdf',
            bytes: cut.bytes,
            pageCount: cut.pageCount,
            variant: params.variant,
            bookRevision: stored.revision,
          });
        }
      }

      const kdp: KdpRenderResult | null = format === 'print' ? (rendered as KdpRenderResult) : null;
      built.push({
        format,
        pdf: pdfRecord,
        sample: sampleRecord,
        sampleNoteUk,
        layout: {
          variant: params.variant,
          modelId,
          noteUk: kdp ? kdp.spec.designerNoteUk : spec.designerNoteUk,
          trimId: kdp?.trimId,
          gutterMm: kdp?.gutterMm,
        },
        warningsUk: kdp?.warningsUk || [],
      });
    }

    return { bookId: stored.id, revision: stored.revision, built };
  }

  /** Опублікувати у вітрину те, що вже зібрано на сервері. */
  async function publishStored(params: {
    bookId: string;
    editions: Array<Record<string, unknown>>;
    sellerSlug?: string;
    req: Request;
  }): Promise<unknown> {
    const stored = await getStoredBook(params.bookId);
    if (!stored) {
      throw new MarketplaceBridgeError('Книги немає на сервері.', 'rejected', 404);
    }
    const book = stored.book as Record<string, unknown>;
    const settings = await readBridgeSettings();
    const results = [];

    for (const edition of params.editions) {
      const format = edition.format === 'print' ? 'print' : 'digital';
      const priceMinor = Number(edition.priceMinor);
      if (!Number.isFinite(priceMinor) || priceMinor < 0) {
        throw new MarketplaceBridgeError(`Некоректна ціна для редакції «${format}».`, 'rejected', 400);
      }

      const pdf = await readArtifact(stored.id, 'pdf', format);
      if (!pdf) {
        throw new MarketplaceBridgeError(
          `Для редакції «${format}» немає зібраного PDF. Спершу складіть файли.`,
          'rejected',
          409
        );
      }

      // Обкладинка так само обовʼязкова, як і при публікації з браузера — але
      // тепер вона береться зі сховища, а не з тіла запиту.
      const cover = (await readArtifact(stored.id, 'cover', format)) || (await readArtifact(stored.id, 'cover', 'digital'));
      if (!cover) {
        throw new MarketplaceBridgeError(
          'Публікація без обкладинки неможлива: у сховищі книги її немає. ' +
            'Відкрийте книгу в Студії й надішліть обкладинку — вона малюється з першої сторінки PDF у браузері.',
          'rejected',
          409
        );
      }

      // Застарілий файл — не привід відмовити, але про це треба сказати:
      // автор міг правити книгу після складання.
      const staleUk =
        pdf.record.bookRevision !== stored.revision
          ? `Увага: PDF зібраний з ревізії ${pdf.record.bookRevision}, а книга вже ${stored.revision}. Складіть файли заново, якщо правки мають потрапити покупцеві.`
          : undefined;

      /*
        ОБКЛАДИНКА ЇДЕ ПОСИЛАННЯМ У САМОМУ СТВОРЕННІ КАРТКИ, а не тільки
        окремим файлом після нього.

        Причина знайдена живим прогоном: у задеплоєного приймача просто
        НЕМАЄ маршруту `/bridge/books/:id/file` — він зʼявився в мості
        пізніше, ніж востаннє деплоївся маркетплейс. Тобто поки той не
        оновлять, жоден файл туди не потрапить у принципі. А `coverUrl`
        приймач розуміє з самого початку й кладе просто в картку — отже
        зображення можна дати вітрині вже зараз, не чекаючи ні на що.

        `?v=` — не забаганка: маркетплейс зберігає САМЕ РЯДОК посилання, і
        без мітки версії нова обкладинка тієї самої книги приїхала б за
        тією ж адресою, а браузер покупця показував би стару з кешу.
      */
      const publicBase = (process.env.APP_URL?.replace(/\/$/, '') ||
        `${params.req.protocol}://${params.req.get('host')}`);
      const coverStamp = Date.parse(cover.record.builtAt || '') || 0;
      const coverUrl =
        `${publicBase}/api/public/books/${encodeURIComponent(stored.id)}/cover` +
        `?format=${cover.record.format}&v=${coverStamp}`;

      const published = await publishBookToMarketplace(
        {
          bookId: stored.id,
          format,
          title: format === 'print' ? `${String(book.title)} (друковане видання)` : String(book.title),
          subtitle: book.subtitle ? String(book.subtitle) : undefined,
          summary: book.logline ? String(book.logline) : undefined,
          description: book.synopsis ? String(book.synopsis) : undefined,
          priceMinor: Math.round(priceMinor),
          coverUrl,
          sellerSlug: params.sellerSlug,
        },
        { settings }
      );

      /*
        ФАЙЛ КНИГИ БІЛЬШЕ НЕ ЗРИВАЄ ПУБЛІКАЦІЮ.

        Було: виняток на цьому кроці валив усю публікацію, і автор бачив
        помилку там, де насправді картка вже стояла у вітрині — а заразом
        не виконувались наступні кроки, зокрема обкладинка. Тепер невдача
        файла лишається невдачею файла: картка з обкладинкою й ціною
        живе, а причина сказана окремим полем.

        Це НЕ тихий відкіт: ми нічого не підміняємо іншим і не вдаємо
        успіх — `attached: false` і текст причини йдуть у відповідь, і
        панель має їх показати.
      */
      let attached: Awaited<ReturnType<typeof attachBookFileToMarketplace>> | null = null;
      let fileErrorUk: string | undefined;
      try {
        attached = await attachBookFileToMarketplace(
          {
            bookId: stored.id,
            format,
            filename: pdf.record.filename,
            mimeType: pdf.record.mimeType,
            bytes: pdf.bytes,
          },
          { settings }
        );
      } catch (fileErr) {
        fileErrorUk =
          `Картка опублікована, але сам файл книги до неї не прикріплено: ` +
          `${(fileErr as Error)?.message || 'невідома причина'}`;
      }

      /*
        Обкладинку окремим файлом однаково пробуємо: коли приймач оновлять,
        зображення в його власному сховищі краще за посилання на нас —
        воно переживе і зміну домену Студії, і її недоступність. Але тепер
        це не привід знімати картку з вітрини: `coverUrl` вище вже дав їй
        зображення.
      */
      let coverAttached: Awaited<ReturnType<typeof attachBookFileToMarketplace>> | null = null;
      let coverErrorUk: string | undefined;
      try {
        coverAttached = await attachBookFileToMarketplace(
          {
            bookId: stored.id,
            format,
            filename: cover.record.filename,
            mimeType: cover.record.mimeType,
            bytes: cover.bytes,
            kind: 'cover',
          },
          { settings }
        );
      } catch (coverErr) {
        coverErrorUk =
          `Обкладинку не вдалося покласти у сховище маркетплейсу ` +
          `(${(coverErr as Error)?.message || 'невідома причина'}). ` +
          `У картці вона показується посиланням на Студію.`;
      }

      const sample = await readArtifact(stored.id, 'sample', format);
      let sampleAttached = false;
      let sampleErrorUk: string | undefined;
      if (sample) {
        try {
          await attachBookFileToMarketplace(
            {
              bookId: stored.id,
              format,
              filename: sample.record.filename,
              mimeType: sample.record.mimeType,
              bytes: sample.bytes,
              kind: 'sample',
            },
            { settings }
          );
          sampleAttached = true;
        } catch (sampleErr) {
          sampleErrorUk = `Уривок не додано: ${(sampleErr as Error)?.message || 'невідома причина'}. Сама книга опублікована.`;
        }
      }

      results.push({
        format,
        published,
        attached,
        fileErrorUk,
        coverUrl,
        coverErrorUk,
        cover: coverAttached,
        sample: sample
          ? { pages: sample.record.pageCount, attached: sampleAttached, errorUk: sampleErrorUk }
          : null,
        pdf: { pageCount: pdf.record.pageCount, sizeBytes: pdf.record.sizeBytes },
        staleUk,
      });
    }

    return { editions: results };
  }

  return { buildArtifacts, publishStored };
}

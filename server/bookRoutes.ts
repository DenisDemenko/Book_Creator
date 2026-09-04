/**
 * HTTP-шар серверної копії книги.
 *
 * ЩО ЗМІНЮЄТЬСЯ ЦИМ ФАЙЛОМ. Досі книга існувала лише в браузері, а публікація
 * надсилала весь її обʼєкт у тілі запиту. Тепер сервер має власну копію
 * джерела, вміє зібрати з неї файли й опублікувати їх, не питаючи браузер.
 *
 * ТРИ РІВНІ ДОСТУПУ, І ВОНИ РІЗНІ НАВМИСНО:
 *   • джерело книги (`/api/books/*`) — автор, лише свої книги;
 *   • рендер і публікація (`/api/books/:id/render`, `/publish`) — адмін, бо
 *     публікація створює товар у чужому магазині й витрачає гроші;
 *   • віддача зверстаного файла (`/artifact`) — автор або адмін.
 *
 * ЧОМУ ПУБЛІКАЦІЯ ТУТ, А НЕ В pdfRoutes.ts. Той маршрут бере книгу з тіла
 * запиту — це шлях «з браузера», і він лишається робочим. Цей бере книгу зі
 * СХОВИЩА: та сама послідовність (макет → PDF → уривок → лістинг → файли),
 * але джерело інше, і саме тому вона може виконуватись без відкритої вкладки.
 */

import type { Express, Request, Response } from 'express';
import { requireAdmin, requireAuth } from './auth';
import {
  BookRevisionConflict,
  getBook,
  listArtifacts,
  listBooks,
  readArtifact,
  saveArtifact,
  saveBook,
  type ArtifactFormat,
} from './bookStore';

/**
 * Нижня межа розміру обкладинки — той самий захист від «успішного» порожнього
 * полотна, що й у pdfRoutes: суцільна заливка стискається майже в нуль.
 */
const MIN_COVER_BYTES = 3000;

export interface BookRoutesDeps {
  /** Збирає й зберігає зверстані файли книги. Повертає опис зробленого. */
  buildArtifacts: (params: {
    bookId: string;
    variant: 'code' | 'design';
    formats: ArtifactFormat[];
    trimId?: string;
    samplePages?: number;
    withSample: boolean;
    req: Request;
  }) => Promise<unknown>;
  /** Публікує вже зібрані файли у вітрину. */
  publishStored: (params: {
    bookId: string;
    editions: Array<Record<string, unknown>>;
    sellerSlug?: string;
    req: Request;
  }) => Promise<unknown>;
}

function fail(res: Response, err: unknown, fallback: string): void {
  if (err instanceof BookRevisionConflict) {
    // 409, а не 400: клієнт зробив усе правильно, просто світ змінився.
    // Разом із помилкою віддаємо ПОТОЧНУ ревізію, щоб інтерфейс міг
    // запропонувати перезавантажити, а не лишав автора вгадувати.
    res.status(409).json({ error: err.message, kind: 'revision_conflict', current: err.current });
    return;
  }
  const message = (err as Error)?.message || fallback;
  console.error('[books]', message);
  res.status(500).json({ error: message });
}

export function registerBookRoutes(app: Express, deps: BookRoutesDeps): void {
  /** Перелік своїх книг — без вмісту: у списку він не потрібен, а важить багато. */
  app.get('/api/books', requireAuth, async (req: Request, res: Response) => {
    try {
      res.json({ books: await listBooks(req.principal?.id ?? null) });
    } catch (err) {
      fail(res, err, 'Не вдалося прочитати перелік книг.');
    }
  });

  /**
   * Книга цілком. Чужу не віддаємо як 404, а не 403: 403 підтвердив би сам
   * факт існування книги з таким id — той самий принцип, що вже діє для
   * товарів у publishingRoutes.
   */
  app.get('/api/books/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const stored = await getBook(req.params.id);
      if (!stored || (stored.ownerId && stored.ownerId !== req.principal?.id && req.principal?.role !== 'admin')) {
        return res.status(404).json({ error: 'Книгу не знайдено.' });
      }
      res.json(stored);
    } catch (err) {
      fail(res, err, 'Не вдалося прочитати книгу.');
    }
  });

  /**
   * Зберегти книгу (джерело, без рендера).
   *
   * `expectedRevision` обовʼязковий для книги, яка вже є на сервері: без
   * нього друга вкладка мовчки затерла б роботу першої.
   */
  app.put('/api/books/:id', requireAuth, async (req: Request, res: Response) => {
    try {
      const book = req.body?.book;
      if (!book || typeof book !== 'object') {
        return res.status(400).json({ error: 'Потрібен обʼєкт книги.', kind: 'bad_input' });
      }
      if (String(book.id || '') !== req.params.id) {
        return res.status(400).json({ error: 'id у тілі не збігається з адресою.', kind: 'bad_input' });
      }

      const existing = await getBook(req.params.id);
      if (existing?.ownerId && existing.ownerId !== req.principal?.id && req.principal?.role !== 'admin') {
        return res.status(404).json({ error: 'Книгу не знайдено.' });
      }

      const saved = await saveBook({
        book,
        ownerId: req.principal?.id ?? null,
        expectedRevision:
          req.body?.expectedRevision === undefined ? undefined : Number(req.body.expectedRevision),
      });
      // Вміст назад не віддаємо: клієнт щойно його надіслав, і ще одна
      // копія книги в відповіді — це подвоєний трафік на кожне збереження.
      const { book: _sent, ...meta } = saved;
      res.json(meta);
    } catch (err) {
      fail(res, err, 'Не вдалося зберегти книгу.');
    }
  });

  /** Що зараз зібрано з цієї книги. Самих байтів немає — лише опис. */
  app.get('/api/books/:id/artifacts', requireAuth, async (req: Request, res: Response) => {
    try {
      const stored = await getBook(req.params.id);
      if (!stored || (stored.ownerId && stored.ownerId !== req.principal?.id && req.principal?.role !== 'admin')) {
        return res.status(404).json({ error: 'Книгу не знайдено.' });
      }
      const artifacts = await listArtifacts(req.params.id);
      res.json({
        revision: stored.revision,
        artifacts: artifacts.map((a) => ({
          ...a,
          // Головне питання до зверстаного файла — чи він ще актуальний.
          // Рахуємо це тут, щоб інтерфейс не вигадував правило сам.
          stale: a.bookRevision !== stored.revision,
        })),
      });
    } catch (err) {
      fail(res, err, 'Не вдалося прочитати перелік файлів книги.');
    }
  });

  /**
   * ОБКЛАДИНКА ПУБЛІЧНО, БЕЗ ВХОДУ.
   *
   * Єдиний маршрут книги без `requireAuth` — і це свідомо, з однієї
   * причини: картку у вітрині маркетплейсу відкриває СТОРОННІЙ покупець,
   * і зображення тягне його браузер, а не наш сервер. Посилання, яке
   * вимагає сесії Студії, у нього не завантажиться взагалі — саме тому
   * картки стояли порожні.
   *
   * Межа рівно одна й проходить тут: назовні віддається ЛИШЕ `cover`.
   * `pdf` і `sample` лишаються за входом, бо це сам товар; обкладинка ж —
   * вітрина товару, її призначення в тому й полягає, щоб її бачили всі.
   *
   * Прихованого переліку книг це не створює: адресу треба знати, а знає
   * її той, кому ми самі її дали, публікуючи картку. Обкладинки не існує
   * доти, доки автор не поклав її у сховище книги свідомою дією.
   */
  app.get('/api/public/books/:id/cover', async (req: Request, res: Response) => {
    try {
      const format: ArtifactFormat = req.query.format === 'print' ? 'print' : 'digital';
      const found =
        (await readArtifact(req.params.id, 'cover', format)) ||
        (await readArtifact(req.params.id, 'cover', 'digital'));
      if (!found) {
        return res.status(404).json({ error: 'Обкладинки для цієї книги немає.', kind: 'not_built' });
      }
      res.setHeader('Content-Type', found.record.mimeType);
      res.setHeader('Content-Length', String(found.bytes.length));
      // Довгий кеш безпечний, бо адреса, яку отримує маркетплейс, несе
      // мітку версії (`?v=`): нова обкладинка приїжджає новим посиланням.
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(Buffer.from(found.bytes));
    } catch (err) {
      fail(res, err, 'Не вдалося віддати обкладинку.');
    }
  });

  /** Завантажити зверстаний файл із сервера. */
  app.get('/api/books/:id/artifact/:kind', requireAuth, async (req: Request, res: Response) => {
    try {
      const stored = await getBook(req.params.id);
      if (!stored || (stored.ownerId && stored.ownerId !== req.principal?.id && req.principal?.role !== 'admin')) {
        return res.status(404).json({ error: 'Книгу не знайдено.' });
      }
      const kind = req.params.kind as 'pdf' | 'sample' | 'cover';
      const format: ArtifactFormat = req.query.format === 'print' ? 'print' : 'digital';
      const found = await readArtifact(req.params.id, kind, format);
      if (!found) {
        return res.status(404).json({
          error: 'Такого файла ще не зібрано. Запустіть складання й спробуйте ще раз.',
          kind: 'not_built',
        });
      }
      res.setHeader('Content-Type', found.record.mimeType);
      res.setHeader('Content-Length', String(found.bytes.length));
      res.setHeader('X-Book-Revision', String(found.record.bookRevision));
      res.send(Buffer.from(found.bytes));
    } catch (err) {
      fail(res, err, 'Не вдалося віддати файл книги.');
    }
  });

  /**
   * Покласти обкладинку в сховище книги.
   *
   * ЧОМУ ОБКЛАДИНКА ПРИХОДИТЬ ІЗ БРАУЗЕРА, КОЛИ ВСЕ РЕШТА РОБИТЬ СЕРВЕР.
   * Растеризувати PDF на сервері нічим — потрібен був би нативний модуль або
   * wasm-рендерер в образі. Тому єдиний крок, який лишається за браузером, —
   * намалювати першу сторінку. Але результат ЗБЕРІГАЄТЬСЯ, і далі публікація
   * бере його зі сховища: браузер потрібен один раз на версію книги, а не на
   * кожну публікацію.
   */
  app.post('/api/books/:id/artifact/cover', requireAuth, async (req: Request, res: Response) => {
    try {
      const stored = await getBook(req.params.id);
      if (!stored || (stored.ownerId && stored.ownerId !== req.principal?.id && req.principal?.role !== 'admin')) {
        return res.status(404).json({ error: 'Книгу не знайдено.' });
      }
      const raw = String(req.body?.imageBase64 || '');
      const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(raw);
      const mimeType = match ? match[1] : 'image/png';
      const base64 = match ? match[2] : raw;
      if (!base64) {
        return res.status(400).json({ error: 'Порожнє зображення обкладинки.', kind: 'bad_input' });
      }
      const bytes = Buffer.from(base64, 'base64');
      if (bytes.length < MIN_COVER_BYTES) {
        return res.status(400).json({
          error: `Обкладинка підозріло мала (${bytes.length} Б) — схоже, сторінка намалювалась порожньою.`,
          kind: 'cover_blank',
        });
      }
      const record = await saveArtifact({
        bookId: stored.id,
        kind: 'cover',
        format: req.body?.format === 'print' ? 'print' : 'digital',
        filename: `${stored.id}-cover.${mimeType.includes('jpeg') ? 'jpg' : 'png'}`,
        mimeType,
        bytes: new Uint8Array(bytes),
        bookRevision: stored.revision,
      });
      res.json(record);
    } catch (err) {
      fail(res, err, 'Не вдалося зберегти обкладинку.');
    }
  });

  /**
   * Зібрати файли з серверної копії. Нічого не публікує — саме тому це
   * окрема дія: складання можна повторювати, не чіпаючи вітрини.
   */
  app.post('/api/books/:id/render', requireAdmin, async (req: Request, res: Response) => {
    try {
      const formats: ArtifactFormat[] = Array.isArray(req.body?.formats)
        ? req.body.formats.filter((f: unknown) => f === 'digital' || f === 'print')
        : ['digital'];
      const out = await deps.buildArtifacts({
        bookId: req.params.id,
        variant: req.body?.variant === 'design' ? 'design' : 'code',
        formats: formats.length ? formats : ['digital'],
        trimId: req.body?.trimId ? String(req.body.trimId) : undefined,
        samplePages: req.body?.samplePages,
        withSample: req.body?.sample !== false,
        req,
      });
      res.json(out);
    } catch (err) {
      fail(res, err, 'Не вдалося зібрати файли книги.');
    }
  });

  /** Опублікувати у вітрину те, що вже зібрано на сервері. */
  app.post('/api/books/:id/publish', requireAdmin, async (req: Request, res: Response) => {
    try {
      const editions = Array.isArray(req.body?.editions) ? req.body.editions : [];
      if (editions.length === 0) {
        return res.status(400).json({ error: 'Не вказано жодної редакції.', kind: 'bad_input' });
      }
      const out = await deps.publishStored({
        bookId: req.params.id,
        editions,
        sellerSlug: req.body?.sellerSlug ? String(req.body.sellerSlug) : undefined,
        req,
      });
      res.json(out);
    } catch (err) {
      fail(res, err, 'Не вдалося опублікувати книгу з сервера.');
    }
  });
}

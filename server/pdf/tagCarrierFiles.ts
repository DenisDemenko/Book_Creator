/**
 * Читання носія тегів із файла будь-якого з підтримуваних форматів і маршрут
 * «прочитати» для кроку в редакторі (постановка власника 03.11.2026).
 *
 * ЧОМУ ФОРМАТ ВИЗНАЧАЄТЬСЯ ЗА ПІДПИСОМ. Автор перейменовує файли: `kniga.pdf`
 * легко стає `kniga (1).bin`, а `.epub` — `.zip`. Підпис перших байтів не
 * бреше, тож маршрут не питає, чим файл «має бути».
 *
 * ЧОМУ СЕРВЕР ЧИТАЄ, А НЕ БРАУЗЕР. PDF розбирає `pdf-lib`, якого в клієнтській
 * збірці немає, і тягнути його туди заради одного маршруту — зайві сотні
 * кілобайтів кожному відвідувачу. Ціна — файл їде на сервер; ліміт нижче.
 *
 * ЧОГО МАРШРУТ НЕ РОБИТЬ. Він нічого не записує й до книги не звертається:
 * лише віддає носій. Повертає теги в книгу браузер (рукопис змінює лише він,
 * К2), і робить це лише після того, як автор побачив, скільки абзаців
 * знайдено.
 */

import express, { type Express, type Request, type Response } from 'express';
import JSZip from 'jszip';
import { requireAuth } from '../auth';
import { readCarrierFromHtml, readCarrierFromZip, sniffCarrierFile } from '../../src/utils/tagCarrierFormats';
import type { TagCarrier } from '../../src/utils/tagCarrier';
import { readTagCarrier } from './tagCarrierPdf';

/** Найбільший файл, який приймаємо: стільки ж, скільки й для результатів DesignCraft. */
export const MAX_CARRIER_FILE_BYTES = 80 * 1024 * 1024;

export type CarrierReadResult =
  | { found: true; kind: 'pdf' | 'zip' | 'html'; carrier: TagCarrier }
  | { found: false; kind: 'pdf' | 'zip' | 'html' | 'unknown' };

/** Читає носій із PDF, EPUB/DOCX (zip) чи HTML. `found:false` — файл без носія чи чужий. */
export async function readTagCarrierFromFile(bytes: Uint8Array): Promise<CarrierReadResult> {
  const kind = sniffCarrierFile(bytes);
  if (kind === 'pdf') {
    const carrier = await readTagCarrier(bytes);
    return carrier ? { found: true, kind, carrier } : { found: false, kind };
  }
  if (kind === 'zip') {
    try {
      const carrier = await readCarrierFromZip(await JSZip.loadAsync(bytes));
      return carrier ? { found: true, kind, carrier } : { found: false, kind };
    } catch {
      return { found: false, kind };
    }
  }
  if (kind === 'html') {
    const carrier = readCarrierFromHtml(new TextDecoder('utf-8').decode(bytes));
    return carrier ? { found: true, kind, carrier } : { found: false, kind };
  }
  return { found: false, kind: 'unknown' };
}

export function registerTagCarrierRoutes(app: Express): void {
  /**
   * `POST /api/tag-carrier/read` — тіло: сам файл (PDF, EPUB, DOCX чи HTML).
   * Відповідь: `{found, kind, carrier?}`. Файл без носія — це НЕ помилка:
   * більшість файлів у світі його не мають, і автор має почути «тут немає»,
   * а не «щось зламалось».
   */
  app.post(
    '/api/tag-carrier/read',
    requireAuth,
    express.raw({ type: () => true, limit: MAX_CARRIER_FILE_BYTES }),
    async (req: Request, res: Response) => {
      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: 'Файл порожній: надішліть PDF, EPUB, DOCX чи HTML у тілі запиту.', kind: 'bad_request' });
        return;
      }
      try {
        res.json(await readTagCarrierFromFile(body));
      } catch (err) {
        console.error('[tagCarrier]', err);
        res.status(500).json({ error: 'Не вдалося прочитати файл.', kind: 'read_failed' });
      }
    }
  );
}

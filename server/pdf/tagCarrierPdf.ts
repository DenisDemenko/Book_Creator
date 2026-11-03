/**
 * Запис і читання носія тегів у самому PDF (див. `src/utils/tagCarrier.ts`).
 *
 * НОСІЙ — ВКЛАДЕНИЙ ФАЙЛ, а не вміст сторінок. Файл `nova-tags.json` лежить у
 * словнику `Names → EmbeddedFiles`: читалка його не малює, текст сторінок не
 * змінюється, а копіювання тексту його не забирає. Користувач Acrobat бачить
 * його хіба що на панелі вкладень, і саме тому це «невидимо читачеві» без
 * жодної хитрості з кольором.
 *
 * ЧОМУ ЦЕ ОПЦІЯ, А НЕ ЗАВЖДИ. Стандарти архівного й друкарського PDF
 * обмежують вкладені файли: PDF/A-2 пускає лише вкладення, які самі є PDF/A,
 * а PDF/X-4 призначений для друкарні, де зайвий об'єкт у файлі нікому не
 * потрібен. Тому носій не вкладається, коли обрано стандарт (`x4`, `a2b`), —
 * і рушій каже про це в нотатках, а не мовчки віддає файл без обіцяного.
 * Точного формулювання стандартів я не звіряв із текстом ISO; пересторога
 * тримається на тому, що файл для друку не мусить нести чужих даних.
 *
 * ЧОМУ PDF ПЕРЕЗБЕРІГАЄТЬСЯ. Вкласти файл можна лише через `pdf-lib`, який
 * читає документ і пише його заново. Для структурного дерева (`tagged`) це
 * перевірено на справжній книзі (див. тест); а от чи зберігає такий проход
 * кожну особливість кожного рушія — ні, тому вкладення опційне.
 */

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFString,
  decodePDFRawStream,
} from 'pdf-lib';
import { buildTagCarrier, parseTagCarrier, type TagCarrier } from '../../src/utils/tagCarrier';
import type { PdfRenderRequest, PdfRenderResult } from './engines/types';

/** Ім'я вкладеного файла. Фіксоване: за ним носій і впізнається. */
export const TAG_CARRIER_FILENAME = 'nova-tags.json';

/** Вкладає носій у PDF і повертає нові байти. Сторінки й текст не чіпає. */
export async function embedTagCarrier(pdf: Uint8Array, carrier: TagCarrier): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const now = new Date();
  await doc.attach(Buffer.from(JSON.stringify(carrier), 'utf8'), TAG_CARRIER_FILENAME, {
    mimeType: 'application/json',
    description: 'Теги сутностей Nova Studio: не видимі читачеві, читаються під час імпорту в Студію.',
    creationDate: now,
    modificationDate: now,
  });
  return doc.save();
}

function textOf(value: unknown): string {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  return '';
}

/** Обхід дерева імен: плоский масив `Names` і вкладені `Kids` (так пишуть інші виробники). */
function collectNames(node: PDFDict, out: Array<{ name: string; spec: PDFDict }>, depth = 0): void {
  if (depth > 8) return;
  const names = node.lookupMaybe(PDFName.of('Names'), PDFArray);
  if (names) {
    for (let i = 0; i + 1 < names.size(); i += 2) {
      const spec = names.lookupMaybe(i + 1, PDFDict);
      if (spec) out.push({ name: textOf(names.lookup(i)), spec });
    }
  }
  const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
  if (kids) {
    for (let i = 0; i < kids.size(); i++) {
      const kid = kids.lookupMaybe(i, PDFDict);
      if (kid) collectNames(kid, out, depth + 1);
    }
  }
}

/**
 * Читає носій із PDF. `null` — у файлі його немає або він не наш: чужі
 * вкладення, бите JSON і неправильна версія однаково означають «нічого
 * повертати», а не помилку, бо більшість PDF у світі носія не мають.
 */
export async function readTagCarrier(pdf: Uint8Array): Promise<TagCarrier | null> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdf, { updateMetadata: false, throwOnInvalidObject: false });
  } catch {
    return null;
  }
  const names = doc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const files = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  if (!files) return null;
  const found: Array<{ name: string; spec: PDFDict }> = [];
  collectNames(files, found);
  const entry = found.find((f) => f.name === TAG_CARRIER_FILENAME);
  if (!entry) return null;
  const ef = entry.spec.lookupMaybe(PDFName.of('EF'), PDFDict);
  const stream = ef?.lookup(PDFName.of('F'));
  if (!(stream instanceof PDFRawStream)) return null;
  try {
    const bytes = decodePDFRawStream(stream).decode();
    return parseTagCarrier(JSON.parse(Buffer.from(bytes).toString('utf8')));
  } catch {
    return null;
  }
}

/**
 * Вкладає в готовий PDF носій тегів сутностей, якщо автор цього попросив
 * (`spec.pdfExport.embedTags`).
 *
 * Робиться ТУТ, а не в рушії, бо вкладення — над готовим PDF і не залежить
 * від того, чим він зверстаний: Nova, Chromium, Pandoc і DesignCraft
 * отримують його однаково. Збій носія PDF не валить: файл уже готовий і
 * правильний, а втрата вкладення — привід сказати про це словами, не віддати
 * автору помилку замість книги (та сама політика, що й для супутніх форматів).
 */
export async function attachTagCarrier(rendered: PdfRenderResult, request: PdfRenderRequest): Promise<PdfRenderResult> {
  const exp = (request.spec as { pdfExport?: { embedTags?: boolean; standard?: string } } | undefined)?.pdfExport;
  if (!exp?.embedTags) return rendered;

  if (exp.standard && exp.standard !== 'none') {
    return {
      ...rendered,
      notesUk: [
        ...rendered.notesUk,
        `Носій тегів не вкладено: обрано стандарт PDF/${exp.standard === 'x4' ? 'X-4' : 'A-2b'}, а файл для друку чи архіву не повинен нести чужих даних.`,
      ],
    };
  }

  const carrier = buildTagCarrier(request.book);
  if (!carrier.chapters.length) {
    return { ...rendered, notesUk: [...rendered.notesUk, 'Носій тегів не вкладено: у книзі немає розмічених абзаців.'] };
  }
  try {
    const bytes = await embedTagCarrier(rendered.bytes, carrier);
    const paragraphs = carrier.chapters.reduce((a, c) => a + c.sections.reduce((x, s) => x + s.paragraphs.length, 0), 0);
    return {
      ...rendered,
      bytes,
      notesUk: [...rendered.notesUk, `Носій тегів вкладено: ${paragraphs} абзаців із тегами, невидимо читачеві.`],
    };
  } catch (err) {
    return {
      ...rendered,
      notesUk: [...rendered.notesUk, `Носій тегів не вкладено: ${(err as Error).message}`],
    };
  }
}

/**
 * Зверстати обраним рушієм. Тихого відкоту на інший рушій немає.
 */

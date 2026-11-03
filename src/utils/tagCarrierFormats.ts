/**
 * Носій тегів для EPUB, DOCX і HTML (див. `tagCarrier.ts`; для PDF — окремо, в
 * `server/pdf/tagCarrierPdf.ts`, бо PDF не zip).
 *
 * ПРИНЦИП ТОЙ САМИЙ, що й у PDF: теги — дані ПОРУЧ із текстом, а не розмітка в
 * ньому, тож читач їх не бачить за побудовою. Змінюється лише те, де лежить
 * файл:
 *
 *   • EPUB — `nova-tags.json` поруч з OPF, у маніфесті, але ПОЗА `spine`.
 *     Читалка показує лише те, що в `spine`; решта маніфесту — просто
 *     ресурси пакета, які вона не відкриває.
 *   • DOCX — власна частина пакета `nova/tags.json`, на яку веде зв'язок з
 *     кореня `_rels/.rels`. Це звичайний OPC: специфікація зобов'язує
 *     споживача ІГНОРУВАТИ невідомі типи зв'язків, тож Word її не показує.
 *   • HTML — `<script type="application/json" id="nova-tags">` у `<head>`.
 *     Браузер такий блок не малює й не виконує.
 *
 * ЩО ТУТ НЕ ПЕРЕВІРЕНО, і про це треба знати. Перевірки йдуть через JSZip і
 * mammoth (тест `test:tag-carrier-formats`): структура пакета, порядок записів,
 * те, що текст читається як і раніше. Справжній Microsoft Word і валідатор
 * `epubcheck` у цьому середовищі недоступні, тож «Word відкриває без
 * попереджень» і «epubcheck не скаржиться» тримаються на специфікаціях, а не
 * на запуску. Тому вкладення — опція, а не замовчування.
 *
 * ЧОМУ JSZip І ТУТ, І В БРАУЗЕРІ. Автор отримує EPUB і DOCX саме з браузера
 * (`fileExporters.ts`), а читає файл сервер — і обидва мусять мати один код,
 * інакше записане одним не прочитається іншим.
 */

import JSZip from 'jszip';
import { parseTagCarrier, type TagCarrier } from './tagCarrier';

/** Імена носія в кожному форматі. Фіксовані: за ними його й шукають. */
export const EPUB_CARRIER_NAME = 'nova-tags.json';
export const DOCX_CARRIER_PART = 'nova/tags.json';
export const DOCX_CARRIER_REL_TYPE = 'urn:nova-studio:tags';
export const HTML_CARRIER_ID = 'nova-tags';

const xmlEscape = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Каталог файла OPF за `META-INF/container.xml`; типово `OEBPS`. */
async function epubPackageDir(zip: JSZip): Promise<{ dir: string; opfPath: string }> {
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = (container && /full-path="([^"]+)"/.exec(container)?.[1]) || 'OEBPS/content.opf';
  const slash = opfPath.lastIndexOf('/');
  return { dir: slash >= 0 ? opfPath.slice(0, slash) : '', opfPath };
}

/**
 * Вкладає носій в EPUB. Зберігає вимогу формату: `mimetype` — перший запис і
 * без стиснення (без цього частина читалок відмовляє).
 */
export async function addCarrierToEpub(zip: JSZip, carrier: TagCarrier): Promise<void> {
  const { dir, opfPath } = await epubPackageDir(zip);
  const opf = await zip.file(opfPath)?.async('string');
  if (!opf || !opf.includes('</manifest>')) {
    throw new Error('EPUB без маніфесту: нема куди вказати носій.');
  }
  const href = EPUB_CARRIER_NAME;
  zip.file(dir ? `${dir}/${href}` : href, JSON.stringify(carrier));
  if (!opf.includes(`href="${href}"`)) {
    zip.file(opfPath, opf.replace('</manifest>', `  <item id="nova-tags" href="${href}" media-type="application/json"/>\n</manifest>`));
  }
  // Повторне збереження пакета, що вже читали з диска, скидає спосіб стиснення
  // кожного запису до загального; mimetype мусить лишитись нестисненим.
  const mimetype = await zip.file('mimetype')?.async('string');
  if (mimetype !== undefined) zip.file('mimetype', mimetype, { compression: 'STORE' });
}

/** Вкладає носій у DOCX як частину пакета з зв'язком від кореня. */
export async function addCarrierToDocx(zip: JSZip, carrier: TagCarrier): Promise<void> {
  const types = await zip.file('[Content_Types].xml')?.async('string');
  const rels = await zip.file('_rels/.rels')?.async('string');
  if (!types || !rels) throw new Error('DOCX без [Content_Types].xml чи _rels/.rels: це не пакет OPC.');

  zip.file(DOCX_CARRIER_PART, JSON.stringify(carrier));

  if (!/Extension="json"/i.test(types)) {
    zip.file('[Content_Types].xml', types.replace('</Types>', '<Default Extension="json" ContentType="application/json"/></Types>'));
  }
  if (!rels.includes(DOCX_CARRIER_REL_TYPE)) {
    zip.file(
      '_rels/.rels',
      rels.replace(
        '</Relationships>',
        `<Relationship Id="rIdNovaTags" Type="${xmlEscape(DOCX_CARRIER_REL_TYPE)}" Target="${DOCX_CARRIER_PART}"/></Relationships>`
      )
    );
  }
}

/**
 * Вкладає носій у HTML. `<` у JSON екранується як `<`: інакше рядок
 * `</script>` усередині тексту абзацу закрив би блок раніше і зламав сторінку.
 */
export function addCarrierToHtml(html: string, carrier: TagCarrier): string {
  const json = JSON.stringify(carrier).replace(/</g, '\\u003c');
  const block = `<script type="application/json" id="${HTML_CARRIER_ID}">${json}</script>`;
  if (html.includes(`id="${HTML_CARRIER_ID}"`)) return html;
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, `${block}\n</head>`);
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}\n${block}`);
  return `${block}\n${html}`;
}

/** Читає носій із zip (EPUB чи DOCX): шукає запис з відомим іменем. */
export async function readCarrierFromZip(zip: JSZip): Promise<TagCarrier | null> {
  const name = Object.keys(zip.files).find(
    (n) => !zip.files[n].dir && (n === DOCX_CARRIER_PART || n === EPUB_CARRIER_NAME || n.endsWith(`/${EPUB_CARRIER_NAME}`))
  );
  if (!name) return null;
  try {
    return parseTagCarrier(JSON.parse(await zip.files[name].async('string')));
  } catch {
    return null;
  }
}

/** Читає носій із HTML. */
export function readCarrierFromHtml(html: string): TagCarrier | null {
  const m = new RegExp(`<script[^>]*id=["']${HTML_CARRIER_ID}["'][^>]*>([\\s\\S]*?)</script>`, 'i').exec(html);
  if (!m) return null;
  try {
    return parseTagCarrier(JSON.parse(m[1]));
  } catch {
    return null;
  }
}

/** Яким файлом є вміст — за підписом, а не за розширенням, яке автор міг перейменувати. */
export type CarrierFileKind = 'pdf' | 'zip' | 'html' | 'unknown';

export function sniffCarrierFile(bytes: Uint8Array): CarrierFileKind {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return 'zip';
  const head = new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(0, 2048)).toLowerCase();
  if (head.includes('<html') || head.includes('<!doctype html') || head.includes('<head')) return 'html';
  return 'unknown';
}

/**
 * Носій тегів у EPUB, DOCX і HTML, читання з файла будь-якого формату,
 * маршрут «прочитати» і браузерні експортери (постановка власника 03.11.2026).
 *
 * ЩО ЦЕЙ ТЕСТ НЕ ДОВОДИТЬ. Справжній Microsoft Word і валідатор `epubcheck`
 * тут недоступні: перевіряється структура пакета, порядок записів, спосіб
 * стиснення `mimetype` і те, що текст читається як і раніше (mammoth). Це
 * необхідна умова того, що Word відкриє файл без попереджень, але не доказ.
 *
 * ГОЛОВНЕ — «НЕВИДИМІСТЬ» ПЕРЕВІРЯЄТЬСЯ ПРЯМО: текст, який бачить читач
 * (DOCX через mammoth, EPUB і HTML без `<script>` і службових файлів),
 * з носієм і без нього той самий, і назв тегів у ньому немає.
 */

import express from 'express';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { buildTagCarrier, type CarrierBook } from '../src/utils/tagCarrier.ts';
import {
  DOCX_CARRIER_PART,
  DOCX_CARRIER_REL_TYPE,
  EPUB_CARRIER_NAME,
  addCarrierToDocx,
  addCarrierToEpub,
  addCarrierToHtml,
  readCarrierFromHtml,
  readCarrierFromZip,
  sniffCarrierFile,
} from '../src/utils/tagCarrierFormats.ts';
import { embedTagCarrier, attachTagCarrier } from '../server/pdf/tagCarrierPdf.ts';
import { readTagCarrierFromFile, registerTagCarrierRoutes } from '../server/pdf/tagCarrierFiles.ts';
import type { PdfRenderRequest, PdfRenderResult } from '../server/pdf/engines/types.ts';

let pass = 0;
let fail = 0;
const t = (name: string, ok: boolean, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${extra ? ' — ' + extra : ''}`);
};

const tagged: CarrierBook = {
  id: 'b1',
  title: 'Проба',
  chapters: [
    {
      id: 'c1',
      title: 'Глава 1',
      sections: [
        {
          id: 's1',
          title: 'Розділ 1',
          content: ['[/emotion:страх] [/character:Олена] Олена відчула холод у грудях.', 'Звичайний абзац.'].join('\n\n'),
        },
      ],
    },
  ],
};
const carrier = buildTagCarrier(tagged);

// ── Збирачі мінімальних файлів ─────────────────────────────────────────────

const OPF = (spine = 1) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>Проба</dc:title></metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${Array.from({ length: spine }, (_, i) => `<item id="c${i}" href="c${i}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${Array.from({ length: spine }, (_, i) => `<itemref idref="c${i}"/>`).join('\n    ')}
  </spine>
</package>`;

async function makeEpub(opfPath = 'OEBPS/content.opf'): Promise<JSZip> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles></container>`
  );
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  zip.file(opfPath, OPF());
  zip.file(`${dir}nav.xhtml`, '<html xmlns="http://www.w3.org/1999/xhtml"><body><nav>Зміст</nav></body></html>');
  zip.file(`${dir}c0.xhtml`, '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Олена відчула холод у грудях.</p></body></html>');
  return zip;
}

async function makeDocx(): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('Олена відчула холод у грудях.')] }), new Paragraph({ children: [new TextRun('Звичайний абзац.')] })] }],
  });
  return new Uint8Array(await Packer.toBuffer(doc));
}

const entryNames = (zip: JSZip) => Object.keys(zip.files);

/** Спосіб стиснення ПЕРШОГО запису за локальним заголовком zip: 0 — без стиснення. */
function firstEntry(bytes: Uint8Array): { name: string; method: number } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLen = dv.getUint16(26, true);
  return { method: dv.getUint16(8, true), name: new TextDecoder().decode(bytes.subarray(30, 30 + nameLen)) };
}

// ── EPUB ───────────────────────────────────────────────────────────────────

console.log('\nEPUB:');
{
  const zip = await makeEpub();
  const textBefore = await zip.file('OEBPS/c0.xhtml')!.async('string');
  const spineBefore = ((await zip.file('OEBPS/content.opf')!.async('string')).match(/<itemref/g) || []).length;
  await addCarrierToEpub(zip, carrier);

  t('носій лежить поруч з OPF', !!zip.file(`OEBPS/${EPUB_CARRIER_NAME}`));
  const opf = await zip.file('OEBPS/content.opf')!.async('string');
  t('у маніфесті є запис про нього', opf.includes('href="nova-tags.json"') && opf.includes('application/json'));
  const manifestPart = /<manifest>([\s\S]*?)<\/manifest>/.exec(opf)![1];
  const spinePart = /<spine>([\s\S]*?)<\/spine>/.exec(opf)![1];
  t('але його немає в spine — читалка його не відкриє', !spinePart.includes('nova-tags') && manifestPart.includes('nova-tags'));
  t('spine не змінився', ((opf.match(/<itemref/g) || []).length) === spineBefore);
  t('текст розділу не змінився', (await zip.file('OEBPS/c0.xhtml')!.async('string')) === textBefore);

  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
  const first = firstEntry(bytes);
  t('mimetype лишився першим записом', first.name === 'mimetype', first.name);
  t('і без стиснення (метод 0)', first.method === 0, String(first.method));

  const back = await readCarrierFromZip(await JSZip.loadAsync(bytes));
  t('носій читається назад', JSON.stringify(back) === JSON.stringify(carrier));
  t('EPUB без носія — null', (await readCarrierFromZip(await makeEpub())) === null);

  await addCarrierToEpub(zip, carrier);
  const opf2 = await zip.file('OEBPS/content.opf')!.async('string');
  t('повторне вкладення не дублює запис маніфесту', (opf2.match(/nova-tags/g) || []).length === (opf.match(/nova-tags/g) || []).length);
}

console.log('\nEPUB з OPF у корені й в іншому каталозі:');
{
  const root = await makeEpub('content.opf');
  await addCarrierToEpub(root, carrier);
  t('OPF у корені → носій у корені', !!root.file(EPUB_CARRIER_NAME));
  const deep = await makeEpub('book/pkg/content.opf');
  await addCarrierToEpub(deep, carrier);
  t('OPF глибше → носій поруч із ним', !!deep.file(`book/pkg/${EPUB_CARRIER_NAME}`));
  t('і читається', (await readCarrierFromZip(deep)) !== null);

  const noManifest = new JSZip();
  noManifest.file('mimetype', 'application/epub+zip');
  noManifest.file('META-INF/container.xml', '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>');
  noManifest.file('OEBPS/content.opf', '<package></package>');
  let msg = '';
  await addCarrierToEpub(noManifest, carrier).catch((e) => (msg = (e as Error).message));
  t('EPUB без маніфесту — зрозуміла відмова', msg.includes('маніфесту'), msg);
}

// ── DOCX ───────────────────────────────────────────────────────────────────

console.log('\nDOCX:');
{
  const original = await makeDocx();
  const textBefore = (await mammoth.extractRawText({ buffer: Buffer.from(original) })).value;
  const zip = await JSZip.loadAsync(original);
  await addCarrierToDocx(zip, carrier);
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });

  const check = await JSZip.loadAsync(out);
  t('частина пакета на місці', !!check.file(DOCX_CARRIER_PART));
  const types = await check.file('[Content_Types].xml')!.async('string');
  t('тип вмісту для .json оголошено', /Extension="json"/.test(types));
  const rels = await check.file('_rels/.rels')!.async('string');
  t('зв\'язок від кореня пакета є', rels.includes(DOCX_CARRIER_REL_TYPE) && rels.includes(DOCX_CARRIER_PART));
  t('рядки пакета лишились коректним XML', types.trimEnd().endsWith('</Types>') && rels.trimEnd().endsWith('</Relationships>'));

  const textAfter = (await mammoth.extractRawText({ buffer: Buffer.from(out) })).value;
  t('текст, який бачить читач, не змінився', textAfter === textBefore, JSON.stringify(textAfter.slice(0, 50)));
  t('назв тегів у ньому немає', !/\/emotion|\/character|nova-tags/.test(textAfter));
  t('носій читається назад', JSON.stringify(await readCarrierFromZip(check)) === JSON.stringify(carrier));
  t('DOCX без носія — null', (await readCarrierFromZip(await JSZip.loadAsync(original))) === null);

  await addCarrierToDocx(check, carrier);
  const rels2 = await check.file('_rels/.rels')!.async('string');
  t('повторне вкладення не дублює зв\'язок', (rels2.match(new RegExp(DOCX_CARRIER_REL_TYPE, 'g')) || []).length === 1);
  const types2 = await check.file('[Content_Types].xml')!.async('string');
  t('і тип вмісту', (types2.match(/Extension="json"/gi) || []).length === 1);

  let msg = '';
  await addCarrierToDocx(new JSZip(), carrier).catch((e) => (msg = (e as Error).message));
  t('не-пакет відхиляється зрозуміло', msg.includes('OPC'), msg);
}

// ── HTML ───────────────────────────────────────────────────────────────────

console.log('\nHTML:');
{
  const page = '<!doctype html><html><head><meta charset="utf-8"><title>Проба</title></head><body><p>Олена відчула холод.</p></body></html>';
  const out = addCarrierToHtml(page, carrier);
  t('блок у <head>', out.indexOf('nova-tags') < out.indexOf('</head>') && out.includes('type="application/json"'));
  const visible = (h: string) => h.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  t('без <script> сторінка та сама, що була', visible(out).replace(/\n/g, '') === page.replace(/\n/g, ''));
  t('читається назад', JSON.stringify(readCarrierFromHtml(out)) === JSON.stringify(carrier));
  t('сторінка без носія — null', readCarrierFromHtml(page) === null);
  t('повторне вкладення нічого не додає', addCarrierToHtml(out, carrier) === out);

  const noHead = addCarrierToHtml('<body><p>Текст</p></body>', carrier);
  t('без <head> блок іде на початок', noHead.startsWith('<script'));
  const bareHead = addCarrierToHtml('<head></head><body></body>', carrier);
  t('є лише відкрита форма <head> — теж гаразд', readCarrierFromHtml(bareHead) !== null);

  // `</script>` у значенні тега не повинен закрити блок раніше.
  const evil = buildTagCarrier({
    chapters: [{ title: 'Г', sections: [{ title: 'Р', content: '[/emotion:</script><b>x] Абзац із підступним значенням.' }] }],
  });
  const safe = addCarrierToHtml(page, evil);
  t('`</script>` у значенні не ламає сторінку', (safe.match(/<\/script>/gi) || []).length === 1);
  t('і носій усе одно читається', JSON.stringify(readCarrierFromHtml(safe)) === JSON.stringify(evil));
}

// ── Підпис файла й читання з будь-якого формату ────────────────────────────

console.log('\nФормат за підписом:');
{
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([200, 200]);
  const pdf = await pdfDoc.save();
  const docx = await makeDocx();
  t('PDF', sniffCarrierFile(pdf) === 'pdf');
  t('zip (DOCX/EPUB)', sniffCarrierFile(docx) === 'zip');
  t('HTML', sniffCarrierFile(new TextEncoder().encode('<!doctype html><html><head></head>')) === 'html');
  t('невідомо', sniffCarrierFile(new TextEncoder().encode('просто текст')) === 'unknown');
  t('порожнє', sniffCarrierFile(new Uint8Array()) === 'unknown');

  const embedded = await embedTagCarrier(pdf, carrier);
  const r1 = await readTagCarrierFromFile(embedded);
  t('PDF із носієм', r1.found === true && r1.kind === 'pdf');
  t('PDF без носія — found:false, а не помилка', (await readTagCarrierFromFile(pdf)).found === false);

  const zipE = await makeEpub();
  await addCarrierToEpub(zipE, carrier);
  const epubBytes = await zipE.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
  const r2 = await readTagCarrierFromFile(epubBytes);
  t('EPUB із носієм', r2.found === true && r2.kind === 'zip');

  const zipD = await JSZip.loadAsync(docx);
  await addCarrierToDocx(zipD, carrier);
  const r3 = await readTagCarrierFromFile(await zipD.generateAsync({ type: 'uint8array' }));
  t('DOCX із носієм', r3.found === true);

  const r4 = await readTagCarrierFromFile(new TextEncoder().encode(addCarrierToHtml('<html><head></head></html>', carrier)));
  t('HTML із носієм', r4.found === true && r4.kind === 'html');

  t('сміття — found:false, kind unknown', JSON.stringify(await readTagCarrierFromFile(new Uint8Array([1, 2, 3]))) === JSON.stringify({ found: false, kind: 'unknown' }));
  t('битий zip — found:false, а не виняток', (await readTagCarrierFromFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]))).found === false);
}

// ── Супутні EPUB і HTML від рушія ──────────────────────────────────────────

console.log('\nСупутні формати від рушія:');
{
  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([200, 200]);
  const pdf = await pdfDoc.save();
  const epubZip = await makeEpub();
  const epub = await epubZip.generateAsync({ type: 'uint8array', mimeType: 'application/epub+zip' });
  const html = new TextEncoder().encode('<!doctype html><html><head><title>x</title></head><body>Текст</body></html>');
  const rendered: PdfRenderResult = {
    bytes: pdf,
    pageCount: 1,
    engineId: 'designcraft',
    honoredSpec: true,
    notesUk: [],
    companions: [
      { kind: 'epub', bytes: epub, mimeType: 'application/epub+zip', extension: 'epub' },
      { kind: 'html', bytes: html, mimeType: 'text/html', extension: 'html' },
    ],
  };
  const req = (pdfExport: Record<string, unknown>) => ({ book: tagged, spec: { pdfExport }, print: false }) as unknown as PdfRenderRequest;

  const out = await attachTagCarrier(rendered, req({ embedTags: true, standard: 'none' }));
  t('носій у супутньому EPUB', (await readTagCarrierFromFile(out.companions![0].bytes)).found === true);
  t('носій у супутньому HTML', (await readTagCarrierFromFile(out.companions![1].bytes)).found === true);
  t('і в самому PDF', (await readTagCarrierFromFile(out.bytes)).found === true);
  t('супутній EPUB лишився валідним: mimetype перший і без стиснення', firstEntry(out.companions![0].bytes).name === 'mimetype' && firstEntry(out.companions![0].bytes).method === 0);
  t('порядок і тип супутніх не змінились', out.companions!.map((c) => c.kind).join() === 'epub,html');
  t('нотатки називають кожен файл', out.notesUk.some((n) => n.includes('EPUB')) && out.notesUk.some((n) => n.includes('HTML')), out.notesUk.join(' | '));

  const x4 = await attachTagCarrier(rendered, req({ embedTags: true, standard: 'x4' }));
  t('при PDF/X-4 PDF чистий', x4.bytes === pdf);
  t('а супутні файли носій усе одно мають: стандарт стосується лише PDF', (await readTagCarrierFromFile(x4.companions![0].bytes)).found === true);

  const bad = await attachTagCarrier(
    { ...rendered, companions: [{ kind: 'epub', bytes: new Uint8Array([1, 2, 3]), mimeType: 'application/epub+zip', extension: 'epub' }] },
    req({ embedTags: true, standard: 'none' })
  );
  t('збій у супутньому не валить решту', (await readTagCarrierFromFile(bad.bytes)).found === true);
  t('і супутній лишається як був', bad.companions![0].bytes.length === 3);
  t('про збій сказано', bad.notesUk.some((n) => n.includes('EPUB') && n.includes('не вкладено')), bad.notesUk.join(' | '));
}

// ── Маршрут ────────────────────────────────────────────────────────────────

console.log('\nМаршрут POST /api/tag-carrier/read:');
{
  let principal: { id: string; role: string; isGuest: boolean } | null = { id: 'u1', role: 'author', isGuest: false };
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { principal: unknown }).principal = principal;
    next();
  });
  registerTagCarrierRoutes(app);
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: Uint8Array | string) =>
    fetch(`${base}/api/tag-carrier/read`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: body as BodyInit });

  const pdfDoc = await PDFDocument.create();
  pdfDoc.addPage([200, 200]);
  const withCarrier = await embedTagCarrier(await pdfDoc.save(), carrier);

  const ok = await post(withCarrier);
  const okBody = (await ok.json()) as { found: boolean; kind: string; carrier?: { title: string } };
  t('файл із носієм → 200', ok.status === 200);
  t('found:true й kind pdf', okBody.found === true && okBody.kind === 'pdf');
  t('носій у відповіді той самий', JSON.stringify(okBody.carrier) === JSON.stringify(carrier));

  const none = await post(await (await PDFDocument.create()).save());
  const noneBody = (await none.json()) as { found: boolean };
  t('PDF без носія → 200 і found:false (не помилка)', none.status === 200 && noneBody.found === false);

  const junk = await post(new TextEncoder().encode('просто текст'));
  t('не схоже на жоден формат → 200 і unknown', junk.status === 200 && ((await junk.json()) as { kind: string }).kind === 'unknown');

  const empty = await post(new Uint8Array());
  t('порожнє тіло → 400', empty.status === 400, String(empty.status));

  principal = null;
  t('без входу → 401', (await post(withCarrier)).status === 401);
  principal = { id: 'g', role: 'author', isGuest: true };
  t('гість → 401', (await post(withCarrier)).status === 401);

  server.close();
}

// ── Браузерні експортери ───────────────────────────────────────────────────

console.log('\nБраузерні експортери (EPUB і DOCX) з перемикачем:');
{
  // Експортери закінчуються завантаженням через DOM; тут підставлено рівно
  // ті виклики, яких їм бракує в Node, а байти перехоплюються з Blob.
  let captured: Blob | null = null;
  (globalThis as any).URL.createObjectURL = (b: Blob) => ((captured = b), 'blob:x');
  (globalThis as any).URL.revokeObjectURL = () => {};
  (globalThis as any).document = {
    createElement: () => ({ href: '', download: '', click() {} }),
    body: { appendChild() {}, removeChild() {} },
  };
  const { exportBookToDocx, exportBookToEpub } = await import('../src/utils/fileExporters.ts');
  const mkBook = (embedTags?: boolean): any => ({
    id: 'b1',
    title: 'Проба',
    author: 'Автор',
    chapters: [{ id: 'c1', title: 'Глава 1', sections: tagged.chapters![0].sections }],
    layoutConfig: embedTags === undefined ? undefined : { embedTags },
  });
  const grab = async (run: () => Promise<void>): Promise<Uint8Array> => {
    captured = null;
    await run();
    if (!captured) throw new Error('Blob не перехоплено');
    return new Uint8Array(await (captured as Blob).arrayBuffer());
  };

  const epubOn = await grab(() => exportBookToEpub(mkBook(true)));
  const epubOff = await grab(() => exportBookToEpub(mkBook(false)));
  const epubUnset = await grab(() => exportBookToEpub(mkBook()));
  const epubEn = await grab(() => exportBookToEpub(mkBook(true), { isEnglish: true }));
  t('EPUB з перемикачем несе носій', (await readTagCarrierFromFile(epubOn)).found === true);
  t('EPUB без перемикача — ні', (await readTagCarrierFromFile(epubOff)).found === false);
  t('EPUB, де налаштування верстки немає взагалі — ні', (await readTagCarrierFromFile(epubUnset)).found === false);
  t('англійська версія носія не має (абзаци інші)', (await readTagCarrierFromFile(epubEn)).found === false);
  t('mimetype лишився першим і без стиснення', firstEntry(epubOn).name === 'mimetype' && firstEntry(epubOn).method === 0);
  const epubZip = await JSZip.loadAsync(epubOn);
  const opf = await epubZip.file('OEBPS/content.opf')!.async('string');
  t('у spine носія немає', !/<spine>[\s\S]*nova-tags[\s\S]*<\/spine>/.test(opf));
  const chapterText = Object.keys(epubZip.files)
    .filter((n) => /\.xhtml$/.test(n))
    .map((n) => epubZip.files[n].async('string'));
  const allText = (await Promise.all(chapterText)).join(' ');
  t('у тексті розділів тегів немає — їх знято, як і раніше', !/\[\/emotion|\[\/character|\/emotion:|\/character:/.test(allText));
  const carried = (await readTagCarrierFromFile(epubOn)) as { carrier: { chapters: unknown[] } };
  t('носій несе теги, яких у тексті немає', carried.carrier.chapters.length === 1);

  const docxOn = await grab(() => exportBookToDocx(mkBook(true)));
  const docxOff = await grab(() => exportBookToDocx(mkBook(false)));
  t('DOCX з перемикачем несе носій', (await readTagCarrierFromFile(docxOn)).found === true);
  t('DOCX без перемикача — ні', (await readTagCarrierFromFile(docxOff)).found === false);
  const textOn = (await mammoth.extractRawText({ buffer: Buffer.from(docxOn) })).value;
  const textOff = (await mammoth.extractRawText({ buffer: Buffer.from(docxOff) })).value;
  t('текст DOCX для читача з носієм і без — той самий', textOn === textOff);
  t('тегів у тексті DOCX немає', !/\/emotion|\/character/.test(textOn));
}

console.log(`\nПідсумок: ${pass} пройшло, ${fail} впало`);
process.exit(fail ? 1 : 0);

process.env.DATA_DIR ||= '/tmp/nova-designcraft-kdp';

import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

const { designcraftEngineV3: designcraftEngine } = await import('../server/pdf/engines/designcraftEngineV3');
const { listPdfEngines } = await import('../server/pdf/engines/registry');

const book: any = {
  id: 'KDP-DESIGNCRAFT-TEST',
  title: 'DesignCraft KDP Test',
  author: 'Fusion Lab Studio',
  chapters: [
    {
      id: 'c1',
      order: 1,
      title: 'Chapter One',
      sections: [
        {
          id: 's1',
          order: 1,
          title: 'Opening',
          content: Array.from({ length: 60 }, (_, i) => `<p>${i + 1}. DesignCraft KDP print contract paragraph.</p>`).join(''),
        },
      ],
    },
  ],
};

const spec: any = {
  pageSize: 'A5',
  pageWidthPt: 6 * 72,
  pageHeightPt: 9 * 72,
  mirrorMargins: true,
  margins: { top: 54, right: 36, bottom: 54, left: 54 },
  bodyAlign: 'justify',
  runningHead: { show: false, content: 'title', fontSize: 8 },
  pageNumber: { show: true, position: 'bottom-center', fontSize: 9, startAt: 1, skipFrontMatter: true },
  frontMatter: { contentsTitle: 'Contents', contentsSections: true, contentsLeader: true, fontSize: 10, upperShare: 0.28 },
};

const availability = await designcraftEngine.available();
assert.equal(availability.ok, true, availability.reasonUk || 'DesignCraft CLI unavailable');
assert.equal(designcraftEngine.supportsPrint, true);

const digital = await designcraftEngine.render({ book, kind: 'book', spec, print: false });
const print = await designcraftEngine.render({
  book,
  kind: 'book',
  spec,
  print: true,
  trimId: 'kdp-6x9',
  hasBleed: true,
});

assert.equal(print.engineId, 'designcraft');
assert.equal(print.pageCount, digital.pageCount, 'native KDP mode must preserve page count for the same manuscript/spec');
assert.equal(print.printInfo?.trimId, 'kdp-6x9');
assert.equal(print.printInfo?.passes, 1);
assert.ok(print.notesUk.some((note: string) => note.includes('DesignCraft KDP')));
assert.ok(print.notesUk.some((note: string) => note.includes('PDF/X-4')));

const digitalPdf = await PDFDocument.load(digital.bytes);
const printPdf = await PDFDocument.load(print.bytes);
assert.equal(printPdf.getPageCount(), digitalPdf.getPageCount());
assert.ok(print.bytes.length > 1000);

const firstDigital = digitalPdf.getPage(0).getSize();
const firstPrint = printPdf.getPage(0).getSize();
assert.ok(firstPrint.width >= firstDigital.width, 'bleed print page must not be narrower than trim page');
assert.ok(firstPrint.height >= firstDigital.height, 'bleed print page must not be shorter than trim page');

const engines = await listPdfEngines({});
const listed = engines.find((engine) => engine.id === 'designcraft');
assert.equal(listed?.supportsPrint, true);
assert.equal(listed?.available, true);

console.log('DesignCraft KDP engine contract: ok');

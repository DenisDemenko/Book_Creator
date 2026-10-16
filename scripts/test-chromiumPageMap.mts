import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  buildChromiumCanonicalPageMap,
  injectChromiumLandmarkLinks,
  prepareChromiumLandmarks,
} from '../server/pdf/engines/chromiumPageMap';

let pass = 0;
let fail = 0;
const t = (name: string, condition: boolean, detail = '') => {
  condition ? pass++ : fail++;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const book: any = {
  title: 'Книга',
  chapters: [
    {
      id: 'c1',
      title: 'Початок',
      sections: [
        { id: 'untitled', title: '', content: 'Без заголовка' },
        { id: 's1', title: 'Ранок', content: 'Текст' },
      ],
    },
    { id: 'c2', title: 'Фінал', sections: [] },
  ],
};

console.log('Chromium CanonicalPageMap: renderer-only structural markers');
const prepared = prepareChromiumLandmarks(book);
t('source book is not mutated', book.chapters[0].title === 'Початок');
t('chapter stable ids are preserved', prepared.expected[0]?.id === 'c1');
t('untitled sections are skipped', !prepared.expected.some((x) => x.id === 'untitled'));
t('titled section stable id is preserved', prepared.expected.some((x) => x.id === 's1'));

let html = '<h1>BCPDFLM_0__Початок</h1><h2>BCPDFLM_1__Ранок</h2><h1>BCPDFLM_2__Фінал</h1>';
html = injectChromiumLandmarkLinks(html, prepared.expected);
t('visible marker text is removed from HTML', !html.includes('BCPDFLM_'));
t('all expected landmark URIs are injected', prepared.expected.every((x) => html.includes(x.uri)));

console.log('\nChromium CanonicalPageMap: final PDF link annotations → physical pages');
const pdf = await PDFDocument.create();
for (let i = 0; i < 5; i += 1) pdf.addPage([300, 400]);

function addUriAnnotation(pageIndex: number, uri: string) {
  const action = pdf.context.obj({ URI: PDFString.of(uri) });
  const annotation = pdf.context.obj({ A: action });
  const annotationRef = pdf.context.register(annotation);
  const annots = pdf.context.obj([annotationRef]);
  pdf.getPage(pageIndex).node.set(PDFName.of('Annots'), annots);
}

addUriAnnotation(1, prepared.expected[0].uri); // c1
addUriAnnotation(2, prepared.expected[1].uri); // s1
addUriAnnotation(4, prepared.expected[2].uri); // c2

const bytes = new Uint8Array(await pdf.save());
const map = await buildChromiumCanonicalPageMap({
  bytes,
  pageCount: 5,
  expected: prepared.expected,
});

t('exact map is built when every marker survives', map?.precision === 'exact');
t('source identifies final Chromium PDF', map?.source === 'chromium-pdf');
t('body starts at first chapter physical index', map?.bodyStartPageIndex === 1);
t('chapter c1 is on physical index 1', map?.landmarks.find((x) => x.id === 'c1')?.filePageIndex === 1);
t('section s1 is on physical index 2', map?.landmarks.find((x) => x.id === 's1')?.filePageIndex === 2);
t('chapter c2 is on physical index 4', map?.landmarks.find((x) => x.id === 'c2')?.filePageIndex === 4);
t('Chromium visible folio matches current physical footer', map?.landmarks.find((x) => x.id === 'c2')?.displayPageNumber === 5);

const incomplete = await buildChromiumCanonicalPageMap({
  bytes,
  pageCount: 5,
  expected: [...prepared.expected, {
    marker: 'missing',
    uri: 'https://bookcreator.invalid/__pdf_landmark__/section/missing',
    kind: 'section',
    id: 'missing',
    chapterId: 'c2',
    title: 'Missing',
  }],
});
t('missing final-PDF marker rejects exact map instead of guessing', incomplete === null);

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

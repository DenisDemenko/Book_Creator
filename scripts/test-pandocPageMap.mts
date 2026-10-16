import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import {
  buildPandocCanonicalPageMap,
  injectPandocLandmarkLinks,
  preparePandocLandmarks,
} from '../server/pdf/engines/pandocPageMap';

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

console.log('Pandoc CanonicalPageMap: renderer-only structural markers');
const prepared = preparePandocLandmarks(book);
t('source book is not mutated', book.chapters[0].title === 'Початок');
t('chapter stable ids are preserved', prepared.expected[0]?.id === 'c1');
t('untitled sections are skipped', !prepared.expected.some((x) => x.id === 'untitled'));
t('titled section stable id is preserved', prepared.expected.some((x) => x.id === 's1'));

let markdown = '# BCPANDOC_0__Початок\n\n## BCPANDOC_1__Ранок\n\n# BCPANDOC_2__Фінал';
markdown = injectPandocLandmarkLinks(markdown, prepared.expected);
t('technical marker text is removed from Markdown', !markdown.includes('BCPANDOC_'));
t('all landmark URIs are injected', prepared.expected.every((x) => markdown.includes(x.uri)));

console.log('\nPandoc CanonicalPageMap: final PDF link annotations → physical pages');
const pdf = await PDFDocument.create();
for (let i = 0; i < 6; i += 1) pdf.addPage([300, 400]);

function addUriAnnotation(pageIndex: number, uri: string) {
  const action = pdf.context.obj({ URI: PDFString.of(uri) });
  const annotation = pdf.context.obj({ A: action });
  const annotationRef = pdf.context.register(annotation);
  const annots = pdf.context.obj([annotationRef]);
  pdf.getPage(pageIndex).node.set(PDFName.of('Annots'), annots);
}

addUriAnnotation(2, prepared.expected[0].uri); // c1
addUriAnnotation(3, prepared.expected[1].uri); // s1
addUriAnnotation(5, prepared.expected[2].uri); // c2

const bytes = new Uint8Array(await pdf.save());
const map = await buildPandocCanonicalPageMap({
  bytes,
  pageCount: 6,
  expected: prepared.expected,
});

t('exact map is built when every marker survives', map?.precision === 'exact');
t('source identifies final Pandoc PDF', map?.source === 'pandoc-pdf');
t('body starts at first chapter physical index', map?.bodyStartPageIndex === 2);
t('chapter c1 is on physical index 2', map?.landmarks.find((x) => x.id === 'c1')?.filePageIndex === 2);
t('section s1 is on physical index 3', map?.landmarks.find((x) => x.id === 's1')?.filePageIndex === 3);
t('chapter c2 is on physical index 5', map?.landmarks.find((x) => x.id === 'c2')?.filePageIndex === 5);
t('unknown TeX visible folio is not invented', map?.landmarks.every((x) => x.displayPageNumber === null) === true);

const incomplete = await buildPandocCanonicalPageMap({
  bytes,
  pageCount: 6,
  expected: [...prepared.expected, {
    marker: 'missing',
    uri: 'https://bookcreator.invalid/__pandoc_landmark__/section/missing',
    kind: 'section',
    id: 'missing',
    chapterId: 'c2',
    title: 'Missing',
  }],
});
t('missing final-PDF marker rejects exact map instead of guessing', incomplete === null);

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

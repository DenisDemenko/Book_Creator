import { buildCanonicalPdfPageMap } from '../shared/canonicalPageMap';

let pass = 0;
let fail = 0;
const t = (name: string, condition: boolean, detail = '') => {
  condition ? pass++ : fail++;
  console.log(`${condition ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

console.log('CanonicalPageMap: final PDF coordinates after generated TOC insertion');
{
  const map = buildCanonicalPdfPageMap({
    chapters: [
      {
        id: 'ch-1',
        title: 'Початок',
        pageIndex: 2,
        sections: [
          { id: 'sec-1', title: 'Сцена 1', pageIndex: 3 },
        ],
      },
      {
        id: 'ch-2',
        title: 'Повернення',
        pageIndex: 10,
        sections: [],
      },
    ],
    // title + copyright = 2 pages before body, then 2 TOC pages inserted.
    bodyStartPageIndex: 4,
    insertedTocPages: 2,
    pageCount: 18,
    pageNumber: { show: true, startAt: 1, skipFrontMatter: true },
  });

  t('contract version is pinned', map.version === 1);
  t('Nova PDF is authoritative source', map.source === 'nova-pdf');
  t('final page count preserved', map.pageCount === 18);
  t('body start is final-file index', map.bodyStartPageIndex === 4);

  const ch1 = map.landmarks.find((x) => x.id === 'ch-1')!;
  const sec1 = map.landmarks.find((x) => x.id === 'sec-1')!;
  const ch2 = map.landmarks.find((x) => x.id === 'ch-2')!;

  t('chapter shifts by inserted TOC pages', ch1.filePageIndex === 4, String(ch1.filePageIndex));
  t('physical page is one-based', ch1.filePageNumber === 5, String(ch1.filePageNumber));
  t('printed folio starts at 1 on body start', ch1.displayPageNumber === 1, String(ch1.displayPageNumber));
  t('section preserves stable source id', sec1.id === 'sec-1');
  t('section gets same final shift', sec1.filePageIndex === 5, String(sec1.filePageIndex));
  t('later chapter remains aligned', ch2.filePageIndex === 12, String(ch2.filePageIndex));
  t('later printed folio follows final body index', ch2.displayPageNumber === 9, String(ch2.displayPageNumber));
}

console.log('\nCanonicalPageMap: page numbering modes');
{
  const noNumbers = buildCanonicalPdfPageMap({
    chapters: [{ id: 'c', title: 'C', pageIndex: 0, sections: [] }],
    bodyStartPageIndex: 0,
    insertedTocPages: 0,
    pageCount: 1,
    pageNumber: { show: false, startAt: 1, skipFrontMatter: false },
  });
  t('hidden folios are null, not fake page numbers', noNumbers.landmarks[0].displayPageNumber === null);

  const custom = buildCanonicalPdfPageMap({
    chapters: [{ id: 'c', title: 'C', pageIndex: 3, sections: [] }],
    bodyStartPageIndex: 3,
    insertedTocPages: 0,
    pageCount: 8,
    pageNumber: { show: true, startAt: 17, skipFrontMatter: true },
  });
  t('custom visible numbering starts at requested value', custom.landmarks[0].displayPageNumber === 17);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

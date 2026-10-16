import { buildCanonicalPdfPageMap, pageCountOnlyMap } from '../shared/canonicalPageMap';
import { buildDesigncraftCanonicalPageMap } from '../server/pdf/engines/designcraftPageMap';
import { registerPdfEngine, renderWithEngine } from '../server/pdf/engines/registry';

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
        sections: [{ id: 'sec-1', title: 'Сцена 1', pageIndex: 3 }],
      },
      { id: 'ch-2', title: 'Повернення', pageIndex: 10, sections: [] },
    ],
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

console.log('\nCanonicalPageMap: DesignCraft printed page names → physical PDF coordinates');
{
  const book: any = {
    title: 'Книга',
    chapters: [
      {
        id: 'c1',
        title: 'Початок',
        sections: [
          { id: 's0', title: '', content: 'Без заголовка' },
          { id: 's1', title: 'Ранок', content: 'Текст' },
        ],
      },
      { id: 'c2', title: 'Фінал', sections: [{ id: 's2', title: 'Ніч', content: 'Текст' }] },
    ],
  };

  const map = buildDesigncraftCanonicalPageMap({
    book,
    pageCount: 12,
    bodyPage: 3,
    bodyStartNumber: 1,
    chapterToc: [
      { level: 1, text: 'Початок', page: '1' },
      { level: 1, text: 'Фінал', page: '6' },
    ],
    toc: [
      { level: 1, text: 'Початок', page: '1' },
      { level: 2, text: 'Ранок', page: '2' },
      { level: 1, text: 'Фінал', page: '6' },
      { level: 2, text: 'Ніч', page: '7' },
    ],
  });

  t('DesignCraft map built', !!map);
  t('DesignCraft map exact', map?.precision === 'exact');
  t('printed page 1 at body page 3 is physical index 2', map?.landmarks[0]?.filePageIndex === 2, String(map?.landmarks[0]?.filePageIndex));
  t('untitled source section does not steal next heading id', map?.landmarks[1]?.id === 's1', String(map?.landmarks[1]?.id));
  t('printed and physical page numbers stay distinct', map?.landmarks[2]?.displayPageNumber === 6 && map?.landmarks[2]?.filePageNumber === 8);

  const badHeading = buildDesigncraftCanonicalPageMap({
    book,
    pageCount: 12,
    bodyPage: 3,
    bodyStartNumber: 1,
    chapterToc: [
      { level: 1, text: 'Інша глава', page: '1' },
      { level: 1, text: 'Фінал', page: '6' },
    ],
    toc: [],
  });
  t('heading mismatch is rejected instead of guessed', badHeading === null);

  const romanPage = buildDesigncraftCanonicalPageMap({
    book,
    pageCount: 12,
    bodyPage: 3,
    bodyStartNumber: 1,
    chapterToc: [
      { level: 1, text: 'Початок', page: 'iv' },
      { level: 1, text: 'Фінал', page: '6' },
    ],
    toc: [],
  });
  t('non-Arabic page name is rejected for exact mapping', romanPage === null);
}

console.log('\nCanonicalPageMap: honest fallback');
{
  const map = pageCountOnlyMap('chromium', 'chromium-pdf', 27, 'No landmarks');
  t('fallback declares page-count-only precision', map.precision === 'page-count-only');
  t('fallback preserves final page count', map.pageCount === 27);
  t('fallback invents no landmarks', map.landmarks.length === 0 && map.bodyStartPageIndex === null);
}

console.log('\nCanonicalPageMap: registry normalization boundary');
{
  registerPdfEngine({
    id: 'gamma',
    label: 'Test page-count engine',
    strengthUk: 'test',
    limitUk: 'test',
    supportsPrint: false,
    async available() {
      return { ok: true };
    },
    async render() {
      return {
        bytes: new Uint8Array([37, 80, 68, 70]),
        pageCount: 7,
        engineId: 'gamma',
        honoredSpec: true,
        notesUk: [],
      };
    },
  });

  const out = await renderWithEngine('gamma', {
    book: { title: 'Test', chapters: [] },
    kind: 'book',
  });
  t('registry always returns a page map', !!out.pageMap);
  t('missing native landmarks become page-count-only', out.pageMap.precision === 'page-count-only');
  t('registry fallback preserves engine id', out.pageMap.engineId === 'gamma');
  t('registry fallback preserves final page count', out.pageMap.pageCount === 7);
}

console.log(`\nПідсумок: ${pass} пройдено, ${fail} провалено.`);
if (fail > 0) process.exit(1);

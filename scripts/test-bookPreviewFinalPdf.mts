import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../src/components/BookPreviewView.tsx', import.meta.url), 'utf8');

assert.match(source, /import \{ FinalPdfSpread, type FinalPdfSpreadState \} from '\.\/FinalPdfSpread'/);
assert.match(source, /import \{ CanonicalPageNavigator \} from '\.\/CanonicalPageNavigator'/);
assert.match(source, /const usingFinalPdf = Boolean\(finalPdfState && !finalPdfUnavailable\)/);
assert.match(source, /const totalBookPages = finalPdfState\?\.pageCount \?\? pages\.length/);
assert.match(source, /<FinalPdfSpread[\s\S]*bookId=\{book\.id\}[\s\S]*currentPageIndex=\{currentPageIndex\}/);
assert.match(source, /usingFinalPdf && finalPdfState \? \([\s\S]*<CanonicalPageNavigator/);
assert.match(source, /:\s*\([\s\S]*<PreviewChapterNavigator/);
assert.match(source, /pageMap=\{finalPdfState\.manifest\.pageMap\}/);
assert.match(source, /Фінальний PDF ще не зібрано або його manifest недоступний/);

console.log('Book preview final PDF integration contract: OK');

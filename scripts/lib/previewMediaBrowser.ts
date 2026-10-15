import { measureBookPreview, type PreviewMeasurement } from '../../src/utils/previewPagination';
import { initialBook } from '../../src/data/initialBook';
import { renderSectionBlocksHtml, generateBookExportHtml } from '../../src/utils/helpers';
import { resolvePageGeometry } from '../../src/utils/pageGeometry';
import { PX_PER_MM } from '../../src/utils/mmUnits';
import type { Book, Section } from '../../src/types';

export async function previewMediaProbe(): Promise<string[]> {
  const checks: string[] = [];
  const ok = (name: string, condition: unknown) => { if (!condition) throw new Error(name); checks.push(name); };
  const until = async (condition: () => boolean) => {
    const start = Date.now();
    while (!condition()) { if (Date.now() - start > 10000) throw new Error('Timed out waiting for media'); await new Promise(r => setTimeout(r, 40)); }
  };
  const section: Section = { id: 's', chapterId: 'c', title: 'Фото', order: 0, content: '', wordCount: 0, lastModified: new Date(0).toISOString() };
  const book: Book = { ...structuredClone(initialBook), id: 'probe-media',
    illustrations: [
      { id: 'slow', url: '/api/probe-media/slow.svg', caption: 'Повільне фото', sectionId: 's' } as any,
      { id: 'late', url: '/api/probe-media/late.svg', caption: 'Пізнє фото', sectionId: 's' } as any,
      { id: 'broken', url: '/api/probe-media/broken.svg', caption: 'Недоступне фото', sectionId: 's' } as any,
    ], characters: [{ id: 'hero', avatarUrl: '/api/probe-media/portrait.svg' } as any],
    chapters: [{ id: 'c', bookId: 'probe-media', title: 'Глава', order: 0, sections: [section] }],
  };
  Object.assign(book.layoutConfig, { pageWidthMm: 148, pageHeightMm: 160, margins: { topMm: 15, bottomMm: 15, insideMm: 15, outsideMm: 15 } });
  section.content = 'Перед фото.\n\n[IMG: slow "Повільне фото" wrap=none]\n\nПісля першого фото.\n\n[IMG: late "Пізнє фото" wrap=none]\n\nКінець.';
  const html = renderSectionBlocksHtml('Перед [IMG: char-hero "Портрет" wrap=contour] після.', book, [], []);
  const parsed = document.createElement('div'); parsed.innerHTML = html;
  ok('innerHTML photo and contour CSS use /studio/ without native src patch', parsed.querySelector('img')?.getAttribute('src') === '/studio/api/probe-media/portrait.svg'
    && parsed.querySelector('figure')?.style.shapeOutside.includes('/studio/api/probe-media/portrait.svg'));
  ok('browser does not repair p/figure nesting or add empty paragraphs', parsed.children.length === 3 && parsed.children[1].tagName === 'FIGURE'
    && Array.from(parsed.querySelectorAll('p')).every(p => !!p.textContent?.trim()));
  book.qrTags = [{ id: 'qr', title: 'Карта', sectionId: 's', payload: 'https://example.test', svgData: '/api/probe-media/qr.svg' } as any];
  book.coverConfig.frontArtUrl = '/api/probe-media/cover.svg';
  const exported = await generateBookExportHtml(book);
  ok('HTML export resolves QR and manuscript images', exported.includes('/studio/api/probe-media/qr.svg') && exported.includes('/studio/api/probe-media/slow.svg'));

  const host = document.createElement('div'); document.body.append(host);
  host.style.cssText = 'position:fixed;left:-99999px;visibility:hidden';
  const controller = new AbortController();
  const updates: PreviewMeasurement[] = [];
  await measureBookPreview(book, host, { signal: controller.signal, onUpdate: r => updates.push(r), mediaTimeoutMs: 80 });
  ok('stalled images have a bounded initial wait and visible pending status', updates[0].pendingImages >= 2);
  const initial = updates[0].pages.filter(p => p.type === 'body-page').length;
  await until(() => !!updates.length && updates.at(-1)!.pendingImages === 0);
  const final = updates.at(-1)!;
  ok('late load/decode triggers repagination after the initial deadline', updates.length >= 2 && final.pages.filter(p => p.type === 'body-page').length > initial);
  ok('broken image terminates without hanging and is counted', final.failedImages === 1);
  const all = final.pages.filter(p => p.type === 'body-page').map(p => p.content).join('');
  ok('marker and legacy images are included once each in measured pages', ['slow.svg', 'late.svg', 'broken.svg'].every(id => all.split(id).length === 2));
  const budget = resolvePageGeometry(book.layoutConfig).contentHeightMm * PX_PER_MM;
  for (const p of final.pages.filter(p => p.type === 'body-page')) {
    const el = host.querySelector('.nova-manuscript-blocks')!.cloneNode(false) as HTMLElement;
    el.innerHTML = p.content || ''; host.append(el);
    const top = el.getBoundingClientRect().top;
    const bottom = Math.max(top, ...Array.from(el.children).map(c => c.getBoundingClientRect().bottom));
    ok('loaded page content fits the measured page budget', bottom - top <= budget + 2);
    el.remove();
  }
  const lastCount = updates.length;
  controller.abort();
  ok('abort removes measurement DOM and listeners', !host.querySelector('[data-preview-measurement]'));
  const cancelled = new AbortController(); let called = false;
  const cancelledBook = structuredClone(book);
  cancelledBook.chapters[0].sections[0].content = '[IMG: slow "Фото" wrap=none]';
  cancelledBook.illustrations[0].url += '?cancelled=1';
  const pending = measureBookPreview(cancelledBook, host, { signal: cancelled.signal, onUpdate: () => { called = true; }, mediaTimeoutMs: 3000 });
  cancelled.abort(); await pending;
  await new Promise(r => setTimeout(r, 150));
  ok('cancelled snapshot never publishes a stale callback', !called && updates.length === lastCount);
  host.remove();
  return checks;
}

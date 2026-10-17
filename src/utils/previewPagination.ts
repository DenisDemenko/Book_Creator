import type { Book, Chapter, Section } from '../types';
import { buildBookPages, renderSectionBlocksHtml, type BookPage } from './helpers';
import { collectImageMarkerIds } from './imageMarkers';
import { assetUrl, htmlAttribute, normalizeHtmlImageSources } from './assetUrl';
import { computeBreaksFromBounds } from './pageBreaker';
import { PX_PER_MM } from './mmUnits';
import { resolvePageGeometry } from './pageGeometry';
import { bodyFontStack, paragraphCssVars, resolveParagraphGeometry } from './typography';

export interface PreviewMeasurement {
  pages: BookPage[];
  pendingImages: number;
  failedImages: number;
}
export interface PaginationOptions {
  signal: AbortSignal;
  onUpdate: (result: PreviewMeasurement) => void;
  /** A slow image must not block reading forever; late loads trigger a fresh measurement. */
  mediaTimeoutMs?: number;
}

/** Browser pagination only; this does not claim to reproduce a PDF engine. */
export async function measureBookPreview(book: Book, host: HTMLElement, options: PaginationOptions): Promise<void> {
  const { signal, onUpdate, mediaTimeoutMs = 5000 } = options;
  if (signal.aborted) return;
  const root = document.createElement('div');
  root.dataset.previewMeasurement = '';
  host.append(root);
  const geometry = resolvePageGeometry(book.layoutConfig);
  const typography = resolveParagraphGeometry(book.layoutConfig);
  const footnotes = book.footnotes || [];
  const sections = new Map<Section, HTMLElement>();
  // A marker image is rendered once, in its chosen position. Legacy unmarked
  // section illustrations are appended once and measured with the text.
  const marked = new Set(book.chapters.flatMap(c => c.sections.flatMap(s => collectImageMarkerIds(s.content))));
  book.chapters.forEach(chapter => chapter.sections.forEach(section => {
    const el = document.createElement('div');
    el.className = 'nova-manuscript-blocks';
    el.style.cssText = 'display:flow-root;';
    el.style.width = geometry.contentWidthMm + 'mm';
    el.style.fontFamily = bodyFontStack(book.layoutConfig.typography.bodyFont);
    el.style.fontSize = typography.fontSizePx + 'px';
    el.style.lineHeight = String(typography.lineHeight);
    Object.entries(paragraphCssVars(typography)).forEach(([k, v]) => el.style.setProperty(k, v));
    const sectionHtml = normalizeHtmlImageSources(
      renderSectionBlocksHtml(section.content, book, footnotes.filter(f => f.sectionId === section.id), footnotes)
    );
    el.innerHTML = sectionHtml
      + (book.illustrations || []).filter(i => i.sectionId === section.id && !marked.has(i.id)).map(i =>
        '<figure style="margin:1em 0;break-inside:avoid"><img src="' + htmlAttribute(assetUrl(i.url))
        + '" alt="' + htmlAttribute(i.caption || '') + '" style="display:block;max-width:100%;height:auto">'
        + (i.caption ? '<figcaption>' + htmlAttribute(i.caption) + '</figcaption>' : '') + '</figure>'
      ).join('');
    sections.set(section, el);
    root.append(el);
  }));
  const images = Array.from(root.querySelectorAll('img'));
  const decoding = new Map<HTMLImageElement, Promise<void>>();
  const decode = (img: HTMLImageElement) => {
    if (!decoding.has(img)) decoding.set(img, (img.decode?.() ?? Promise.resolve()).catch(() => {}));
    return decoding.get(img)!;
  };
  let active = false;
  let frame = 0;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let finishWait: () => void = () => {};
  const sectionPager = (sec: Section, chap: Chapter, chapterIndex: number): BookPage[] => {
    const container = sections.get(sec)!;
    const children = Array.from(container.children) as HTMLElement[];
    if (!children.length) return [];
    const top = container.getBoundingClientRect().top;
    const bounds = children.map(child => {
      const r = child.getBoundingClientRect();
      return { top: r.top - top, bottom: r.bottom - top };
    });
    const keep = children.map(child => getComputedStyle(child).float !== 'none');
    const breaks = computeBreaksFromBounds(bounds, geometry.contentHeightMm * PX_PER_MM, keep);
    const indices = [0, ...breaks, children.length];
    return indices.slice(0, -1).flatMap((from, i) => {
      const to = indices[i + 1];
      return to > from ? [{
        type: 'body-page' as const, title: sec.title,
        content: children.slice(from, to).map(c => c.outerHTML).join(''),
        chapterIndex, chapterId: chap.id, sectionId: sec.id,
      }] : [];
    });
  };
  let previous = '';
  const measure = () => {
    if (signal.aborted || !active) return;
    const result: PreviewMeasurement = {
      pages: buildBookPages(book, sectionPager),
      pendingImages: images.filter(img => !img.complete).length,
      failedImages: images.filter(img => img.complete && !img.naturalWidth).length,
    };
    const signature = JSON.stringify(result);
    if (signature !== previous) { previous = signature; onUpdate(result); }
  };
  const schedule = () => {
    if (signal.aborted || !active || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; measure(); });
  };
  const loaded = (event: Event) => {
    const img = event.target;
    if (img instanceof HTMLImageElement) void decode(img).then(schedule);
    else schedule();
  };
  root.addEventListener('load', loaded, true);
  root.addEventListener('error', loaded, true);
  const observer = new ResizeObserver(schedule);
  sections.forEach(el => observer.observe(el));
  const abort = () => {
    clearTimeout(deadline);
    cancelAnimationFrame(frame);
    finishWait();
    observer.disconnect();
    root.removeEventListener('load', loaded, true);
    root.removeEventListener('error', loaded, true);
    document.fonts?.removeEventListener('loadingdone', schedule);
    root.remove();
  };
  signal.addEventListener('abort', abort, { once: true });
  // load/error, decode and fonts all complete before the initial measurement.
  // The bounded wait also allows a broken/stalled host; observers keep it live.
  const ready = Promise.all(images.map(async img => {
    if (!img.complete) await new Promise<void>(resolve => {
      const done = () => { img.removeEventListener('load', done); img.removeEventListener('error', done); signal.removeEventListener('abort', done); resolve(); };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      signal.addEventListener('abort', done, { once: true });
      if (img.complete || signal.aborted) done();
    });
    if (!signal.aborted) await decode(img);
  })).then(() => document.fonts?.ready);
  await Promise.race([ready, new Promise<void>(resolve => { finishWait = resolve; deadline = setTimeout(resolve, mediaTimeoutMs); })]);
  clearTimeout(deadline);
  if (signal.aborted) return;
  active = true;
  document.fonts?.addEventListener('loadingdone', schedule);
  measure();
}

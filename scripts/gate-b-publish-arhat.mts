import fs from 'node:fs/promises';
import path from 'node:path';
import { initDb, DATA_DIR } from '../server/db';
import { getBook, listBooks, readArtifact, saveArtifact } from '../server/bookStore';
import { designcraftEngineV3 } from '../server/pdf/engines/designcraftEngineV3';
import { specFromBook } from '../server/pdf/pdfFromBook';
import { clampSamplePages, extractSamplePages } from '../server/pdf/pdfSample';
import {
  attachBookFileToMarketplace,
  publishBookToMarketplace,
  readBridgeSettings,
} from '../server/marketplaceBridge';

const MODE = String(process.env.GATE_B_ARHAT_MODE || 'audit').toLowerCase();
const ENGINE_ID = 'designcraft';
const TITLE_RE = /(архат|путь\s+дому|шлях\s+додому)/iu;
const markerPath = path.join(DATA_DIR, 'gate-b-arhat-designcraft.json');

function xml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeTitle(value: unknown): string {
  return String(value || 'book').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'book';
}

function testCover(title: string, author: string): Uint8Array {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1800" viewBox="0 0 1200 1800">
  <rect width="1200" height="1800" fill="#f4ece1"/>
  <rect x="72" y="72" width="1056" height="1656" rx="28" fill="none" stroke="#59637e" stroke-width="5"/>
  <text x="600" y="210" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="54" font-weight="700" fill="#c97f4f">ТЕСТОВЕ ВИДАННЯ</text>
  <text x="600" y="285" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="34" fill="#59637e">DesignCraft · Gate B · Fusion Lab</text>
  <foreignObject x="140" y="560" width="920" height="520">
    <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Georgia,'DejaVu Serif',serif;font-size:76px;line-height:1.16;text-align:center;color:#252b38;font-weight:700;">${xml(title)}</div>
  </foreignObject>
  <text x="600" y="1435" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="38" fill="#59637e">${xml(author)}</text>
  <text x="600" y="1600" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="31" fill="#8a5d42">Не комерційне видання · перевірка конвеєра</text>
</svg>`;
  return new TextEncoder().encode(svg);
}

function publicOrigin(): string {
  const explicit = String(process.env.PUBLIC_ORIGIN || '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  const domain = String(process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (domain) return `https://${domain}`;
  return 'https://bookcreator-production-7304.up.railway.app';
}

await initDb();
const books = await listBooks();
const matches = books.filter((book) => TITLE_RE.test(book.title));
console.log('[gate-b-arhat] mode=', MODE);
console.log('[gate-b-arhat] books=', books.map((b) => ({ id: b.id, title: b.title, revision: b.revision, updatedAt: b.updatedAt })));
console.log('[gate-b-arhat] candidates=', matches.map((b) => ({ id: b.id, title: b.title, revision: b.revision })));

if (matches.length === 0) {
  console.log('[gate-b-arhat] RESULT=no_candidate');
  process.exit(0);
}

const candidate = matches[0];
const stored = await getBook(candidate.id);
if (!stored) throw new Error(`Книга ${candidate.id} зникла між listBooks і getBook.`);

const book = stored.book as any;
const chapters = Array.isArray(book.chapters) ? book.chapters : [];
const sectionCount = chapters.reduce((n: number, c: any) => n + (Array.isArray(c?.sections) ? c.sections.length : 0), 0);
const contentChars = chapters.reduce(
  (sum: number, c: any) => sum + (c.sections || []).reduce((s: number, x: any) => s + String(x?.content || '').length, 0),
  0
);
const existingCover =
  (await readArtifact(stored.id, 'cover', 'digital')) ||
  (await readArtifact(stored.id, 'cover', 'print'));
const spec = specFromBook(book as never);
console.log('[gate-b-arhat] candidate_detail=', {
  id: stored.id,
  title: stored.title,
  revision: stored.revision,
  ownerId: stored.ownerId ? 'set' : 'none',
  chapters: chapters.length,
  sections: sectionCount,
  contentChars,
  cover: existingCover ? { mimeType: existingCover.record.mimeType, bytes: existingCover.bytes.length } : null,
});
console.log('[gate-b-arhat] layout_spec=', {
  pageSize: spec.pageSize,
  pageWidthPt: spec.pageWidthPt,
  pageHeightPt: spec.pageHeightPt,
  margins: spec.margins,
  baseFontSize: spec.baseFontSize,
  lineHeight: spec.lineHeight,
  paragraphSpacing: spec.paragraphSpacing,
  paragraphIndent: spec.paragraphIndent,
  chapterStartsNewPage: spec.chapterStartsNewPage,
  pageNumber: spec.pageNumber,
  runningHead: spec.runningHead,
});

if (MODE === 'audit') {
  console.log('[gate-b-arhat] RESULT=audit_ok');
  process.exit(0);
}
if (MODE !== 'publish' && MODE !== 'render') {
  throw new Error(`Невідомий GATE_B_ARHAT_MODE=${MODE}; дозволено audit|render|publish.`);
}
if (chapters.length === 0 || contentChars < 200) {
  throw new Error('Кандидат схожий на порожню/службову книгу; автоматичну публікацію зупинено.');
}

const rendered = await designcraftEngineV3.render({
  book,
  kind: 'book',
  spec,
  print: false,
  ownerId: stored.ownerId,
  ownerRole: 'admin',
});
console.log('[gate-b-arhat] render=', {
  pages: rendered.pageCount,
  bytes: rendered.bytes.length,
  honoredSpec: rendered.honoredSpec,
  notesUk: rendered.notesUk,
});

const filename = `${safeTitle(book.title)}_${ENGINE_ID}_TEST.pdf`;
const pdfRecord = await saveArtifact({
  bookId: stored.id,
  kind: 'pdf',
  format: 'digital',
  filename,
  mimeType: 'application/pdf',
  bytes: rendered.bytes,
  pageCount: rendered.pageCount,
  variant: `test:${ENGINE_ID}`,
  bookRevision: stored.revision,
});

const sample = await extractSamplePages(rendered.bytes, clampSamplePages(5));
if (sample) {
  await saveArtifact({
    bookId: stored.id,
    kind: 'sample',
    format: 'digital',
    filename: `${safeTitle(book.title)}_${ENGINE_ID}_TEST_uryvok.pdf`,
    mimeType: 'application/pdf',
    bytes: sample.bytes,
    pageCount: sample.pageCount,
    variant: `test:${ENGINE_ID}`,
    bookRevision: stored.revision,
  });
}

/*
 * Режим `render` зупиняється саме тут: рукопис уже пройшов справжній рушій
 * DesignCraft на цій машині (у production — на published-tarball і через
 * шим), PDF і уривок збережені як артефакти, і НІЧОГО не поїхало на вітрину.
 *
 * Чому це окремий режим. `audit` виходить ДО рендера, тож рушія не торкається
 * взагалі, а `publish` рендерить і одразу публікує тестове видання в каталог.
 * Перевірити конвеєр у production, не чіпаючи вітрину, досі було нічим — а
 * саме це й потрібно після деплою: чи працює рушій на бінарнику з образу (у
 * ньому, на відміну від збірки з джерел, немає `text.selectStory`), чи шим
 * досі обрізає звіт і чи проходить справжня книга без `bad_input` від
 * перевірки можливостей. Запис журналу #446 і PLAN_DESIGNCRAFT_BRIDGE.md.
 */
if (MODE === 'render') {
  console.log('[gate-b-arhat] artifacts=', {
    pdf: { id: pdfRecord.id, filename: pdfRecord.filename, pages: rendered.pageCount },
    sample: sample ? { pages: sample.pageCount } : null,
  });
  console.log('[gate-b-arhat] RESULT=render_ok');
  process.exit(0);
}

let cover = existingCover;
if (!cover) {
  const bytes = testCover(String(book.title || stored.title), String(book.author || 'Fusion Lab Studio'));
  const record = await saveArtifact({
    bookId: stored.id,
    kind: 'cover',
    format: 'digital',
    filename: `${safeTitle(book.title)}_${ENGINE_ID}_TEST_cover.svg`,
    mimeType: 'image/svg+xml',
    bytes,
    bookRevision: stored.revision,
  });
  cover = { record, bytes };
  console.log('[gate-b-arhat] generated test SVG cover');
}

const origin = publicOrigin();
const coverStamp = Date.parse(cover.record.builtAt || '') || Date.now();
const coverUrl = `${origin}/api/public/books/${encodeURIComponent(stored.id)}/cover?format=digital&v=${coverStamp}`;
const settings = await readBridgeSettings();
const testTitle = `${String(book.title || stored.title)} — ТЕСТ DesignCraft`;
const testDescription = [
  'ТЕСТОВЕ ВИДАННЯ FUSION LAB. Перевірка Gate B та конвеєра DesignCraft; не вважати фінальною редакцією.',
  book.synopsis ? String(book.synopsis) : '',
].filter(Boolean).join('\n\n');

const published = await publishBookToMarketplace(
  {
    bookId: stored.id,
    format: 'digital',
    title: testTitle,
    subtitle: book.subtitle ? String(book.subtitle) : undefined,
    summary: book.logline ? String(book.logline) : 'Тестове видання DesignCraft для перевірки Fusion Lab Studio.',
    description: testDescription,
    priceMinor: 0,
    coverUrl,
    engineId: ENGINE_ID,
  },
  { settings }
);

let attached = false;
let fileError: string | undefined;
try {
  await attachBookFileToMarketplace(
    {
      bookId: stored.id,
      format: 'digital',
      filename: pdfRecord.filename,
      mimeType: pdfRecord.mimeType,
      bytes: rendered.bytes,
      engineId: ENGINE_ID,
    },
    { settings }
  );
  attached = true;
} catch (err) {
  fileError = (err as Error).message;
}

let coverAttached = false;
let coverError: string | undefined;
try {
  await attachBookFileToMarketplace(
    {
      bookId: stored.id,
      format: 'digital',
      filename: cover.record.filename,
      mimeType: cover.record.mimeType,
      bytes: cover.bytes,
      kind: 'cover',
      engineId: ENGINE_ID,
    },
    { settings }
  );
  coverAttached = true;
} catch (err) {
  coverError = (err as Error).message;
}

const result = {
  at: new Date().toISOString(),
  bookId: stored.id,
  title: testTitle,
  revision: stored.revision,
  pageCount: rendered.pageCount,
  pdfBytes: rendered.bytes.length,
  externalId: published.externalId,
  slug: published.slug,
  created: published.created,
  coverUrl,
  attached,
  fileError,
  coverAttached,
  coverError,
  notesUk: rendered.notesUk,
};
await fs.writeFile(markerPath, JSON.stringify(result, null, 2), 'utf8');
console.log('[gate-b-arhat] RESULT=published');
console.log('[gate-b-arhat] publication=', result);

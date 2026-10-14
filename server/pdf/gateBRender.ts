import { getBook, saveArtifact } from '../bookStore';
import { designcraftEngineV3 } from './engines/designcraftEngineV3';
import { specFromBook } from './pdfFromBook';

function safeTitle(value: unknown): string {
  return String(value || 'book').replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 60) || 'book';
}

/**
 * Run the real stored Studio book through DesignCraft without publishing it.
 * This is deliberately reusable by an authenticated admin route and by
 * one-shot diagnostics, so production web startup never has to wait for a
 * long PDF render.
 */
export async function verifyStoredBookWithDesignCraft(bookId: string) {
  const stored = await getBook(bookId);
  if (!stored) throw new Error(`Книгу ${bookId} не знайдено.`);

  const book = stored.book as any;
  const chapters = Array.isArray(book.chapters) ? book.chapters : [];
  const contentChars = chapters.reduce(
    (sum: number, chapter: any) =>
      sum + (chapter.sections || []).reduce((n: number, section: any) => n + String(section?.content || '').length, 0),
    0
  );
  if (!chapters.length || contentChars < 200) {
    throw new Error('Книга порожня або службова: DesignCraft-перевірку зупинено.');
  }

  const spec = specFromBook(book as never);
  const rendered = await designcraftEngineV3.render({
    book,
    kind: 'book',
    spec,
    print: false,
    ownerId: stored.ownerId,
    ownerRole: 'admin',
  });

  const record = await saveArtifact({
    bookId: stored.id,
    kind: 'pdf',
    format: 'digital',
    filename: `${safeTitle(book.title || stored.title)}_designcraft_GATE_B.pdf`,
    mimeType: 'application/pdf',
    bytes: rendered.bytes,
    pageCount: rendered.pageCount,
    variant: 'test:designcraft',
    bookRevision: stored.revision,
  });

  return {
    bookId: stored.id,
    title: stored.title,
    revision: stored.revision,
    chapters: chapters.length,
    contentChars,
    pageCount: rendered.pageCount,
    pdfBytes: rendered.bytes.length,
    artifactId: record.id,
    filename: record.filename,
    notesUk: rendered.notesUk,
  };
}

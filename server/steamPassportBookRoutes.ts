import { createHash } from 'node:crypto';
import type { Express } from 'express';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { buildStarterBook } from '../src/utils/starterBook';
import { requireAuth } from './auth';
import { verifyFirebaseIdToken } from './firebaseAdmin';
import { BookRevisionConflict, getBook, readArtifact, saveArtifact, saveBook } from './bookStore';

const requestIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const limits = { pdf: 3_000_000, cover: 450_000, text: 250_000 };
function decodeBase64(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(max / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length <= max ? bytes : null;
}

function editableText(value: string) {
  return value.split(/\r?\n/).map(line => {
    // Keep source text as text, including anything that resembles a Studio control marker.
    const plain = line.replace(/\[(?=\/?(?:LINK|IMG|AI-DRAFT|DIVIDER)(?:[\s:=\]]))/gi, '［');
    return /^https?:\/\/[^\s"<>\[\]]+$/i.test(plain) ? `[LINK="${plain}"]${plain}[/LINK]` : plain;
  }).join('\n\n');
}

async function ownsMarketplaceProject(teamId: string, token: string, uid: string) {
  const principal = await verifyFirebaseIdToken(token).catch(() => null);
  if (!principal || principal.uid !== uid) return false;
  const response = await fetch(`https://api.fusionlab.in.ua/teams/${teamId}/passport`, {
    headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(8000),
  });
  if ([401, 403, 404].includes(response.status)) return false;
  if (!response.ok) throw new Error('Marketplace ownership check failed.');
  const passport = await response.json();
  return passport.teamId === teamId && passport.isOwner === true;
}

export function registerSteamPassportBookRoutes(app: Express, ownsProject = ownsMarketplaceProject) {
  app.post('/api/books/import-steam-passport', requireAuth, async (req, res) => {
    const owner = req.principal;
    if (!owner || owner.isGuest !== false || !owner.id) return res.status(401).json({ error: 'Authentication required.' });
    const { teamId, requestId, title, author, language, sections, pdf, cover } = req.body ?? {};
    const token = req.get('X-Fusion-Firebase-Token');
    if (typeof teamId !== 'string' || !requestIdPattern.test(teamId) ||
      typeof requestId !== 'string' || !requestIdPattern.test(requestId) ||
      typeof title !== 'string' || !title.trim() || title.length > 160 ||
      typeof author !== 'string' || author.length > 160 || !['en', 'uk'].includes(language) ||
      !Array.isArray(sections) || !sections.length || sections.length > 100 ||
      sections.some(section => typeof section?.title !== 'string' || !section.title.trim() ||
        section.title.length > 160 || typeof section.text !== 'string') ||
      sections.reduce((sum, section) => sum + section.text.length, 0) > limits.text) {
      return res.status(400).json({ error: 'Invalid passport content.' });
    }
    try {
      if (!token || !owner.firebaseUid || !(await ownsProject(teamId, token, owner.firebaseUid))) {
        return res.status(403).json({ error: 'Only the project owner can import this passport.' });
      }
    } catch {
      return res.status(503).json({ error: 'Could not verify project ownership.' });
    }
    const bytes = decodeBase64(pdf, limits.pdf);
    const image = cover == null ? null : decodeBase64(cover, limits.cover);
    if (!bytes || bytes.subarray(0, 5).toString() !== '%PDF-' ||
      (cover != null && (!image || image[0] !== 0xff || image[1] !== 0xd8))) {
      return res.status(400).json({ error: 'Invalid passport PDF or cover.' });
    }

    let pages: number;
    try {
      const document = await PDFDocument.load(bytes);
      pages = document.getPageCount();
      const names = document.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
      if (!pages || pages > 300 || names?.has(PDFName.of('EmbeddedFiles')) ||
        names?.has(PDFName.of('JavaScript')) || document.catalog.has(PDFName.of('OpenAction'))) throw Error();
      if (image) await document.embedJpg(image);
    } catch {
      return res.status(400).json({ error: 'Invalid passport PDF or cover.' });
    }

    const id = 'STEAM-' + createHash('sha256').update(JSON.stringify([owner.id, teamId, requestId])).digest('hex').slice(0, 32);
    try {
      let stored = await getBook(id);
      if (!stored) {
        const book = buildStarterBook({ bookId: id, title: title.trim(), author: author.trim(), role: owner.role });
        book.language = language;
        const chapterId = `${id}-passport`;
        const coverUrl = image ? 'data:image/jpeg;base64,' + image.toString('base64') : null;
        const illustrationId = `${id}-cover`;
        if (coverUrl) {
          book.coverConfig.frontArtUrl = coverUrl;
          book.illustrations = [{
            id: illustrationId, chapterId, url: coverUrl, caption: title,
            aspectRatio: '4:3', style: 'STEAM', source: 'upload', createdAt: book.createdAt,
          }];
        }
        book.chapters = [{
          id: chapterId, bookId: id, title: language === 'en' ? 'Project passport' : 'Паспорт проєкту', order: 1,
          sections: sections.map(({title: heading, text}, index: number) => ({
            id: `${chapterId}-${index + 1}`, chapterId, title: heading, order: index + 1,
            content: (index === 0
              ? (coverUrl ? `[IMG: ${illustrationId} wrap=none]\n\n` : '') +
                `[LINK="/studio/api/books/${id}/artifact/steam-passport"]${language === 'en' ? 'Download the original passport PDF' : 'Завантажити оригінал паспорта PDF'}[/LINK]\n\n`
              : '') + editableText(text),
            wordCount: text.split(/\s+/).filter(Boolean).length, lastModified: book.createdAt,
          })),
        }];
        try {
          stored = await saveBook({ book: { ...book }, ownerId: owner.id });
        } catch (err) {
          if (!(err instanceof BookRevisionConflict)) throw err;
          stored = await getBook(id);
        }
      }
      if (!stored || stored.ownerId !== owner.id) return res.status(404).json({ error: 'Book not found.' });
      const artifact = await readArtifact(id, 'steam-passport', 'digital');
      if (!artifact) {
        await saveArtifact({
          bookId: id, kind: 'steam-passport', filename: 'STEAM-passport.pdf', mimeType: 'application/pdf',
          bytes, pageCount: pages, bookRevision: 1,
        });
      }
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json({ id });
    } catch (err) {
      console.error('[steam-passport] import failed', err);
      return res.status(500).json({ error: 'Could not import the passport into Studio.' });
    }
  });
}

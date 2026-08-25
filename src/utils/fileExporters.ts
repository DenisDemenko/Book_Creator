import JSZip from 'jszip';
import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  AlignmentType, 
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  convertInchesToTwip
} from 'docx';
import { Book } from '../types';

/**
 * Escapes XML special characters for valid XHTML/OPF generation
 */
function escapeXml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates and downloads a real, binary Microsoft Word (.docx) document
 */
export async function exportBookToDocx(book: Book, options?: { isEnglish?: boolean }): Promise<void> {
  const isEn = !!options?.isEnglish;
  const title = (isEn && book.titleEn) ? book.titleEn : book.title;
  const subtitle = (isEn && book.subtitleEn) ? book.subtitleEn : (book.subtitle || '');
  const author = (isEn && book.authorEn) ? book.authorEn : book.author;
  const logline = book.logline || '';
  const synopsis = book.synopsis || '';

  const docChildren: Paragraph[] = [];

  // --- Title Page ---
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: convertInchesToTwip(1.5), after: 200 },
      children: [
        new TextRun({
          text: title,
          bold: true,
          size: 48, // 24pt
          font: 'Georgia',
          color: '111827'
        })
      ]
    })
  );

  if (subtitle) {
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [
          new TextRun({
            text: subtitle,
            italics: true,
            size: 28, // 14pt
            font: 'Georgia',
            color: '4B5563'
          })
        ]
      })
    );
  }

  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: convertInchesToTwip(1.5) },
      children: [
        new TextRun({
          text: `${isEn ? 'Author' : 'Автор'}: ${author}`,
          size: 24, // 12pt
          font: 'Georgia',
          bold: true,
          color: '1F2937'
        })
      ]
    })
  );

  // Metadata note
  if (logline || synopsis) {
    docChildren.push(
      new Paragraph({
        children: [new PageBreak()]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 200, after: 150 },
        children: [
          new TextRun({
            text: isEn ? 'Book Description & Synopsis' : 'Опис книги та синопсис',
            bold: true,
            size: 28,
            font: 'Georgia'
          })
        ]
      })
    );

    if (logline) {
      docChildren.push(
        new Paragraph({
          spacing: { after: 150 },
          children: [
            new TextRun({ text: isEn ? 'Logline: ' : 'Логлайн: ', bold: true, font: 'Georgia' }),
            new TextRun({ text: logline, italics: true, font: 'Georgia' })
          ]
        })
      );
    }

    if (synopsis) {
      docChildren.push(
        new Paragraph({
          spacing: { after: 200 },
          children: [
            new TextRun({ text: synopsis, font: 'Georgia' })
          ]
        })
      );
    }
  }

  // --- Chapters ---
  book.chapters.forEach((chapter, cIdx) => {
    const chapTitle = (isEn && chapter.titleEn) ? chapter.titleEn : chapter.title;
    
    // Page break before each chapter
    docChildren.push(
      new Paragraph({
        children: [new PageBreak()]
      }),
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 400, after: 250 },
        children: [
          new TextRun({
            text: `${isEn ? 'Chapter' : 'Глава'} ${cIdx + 1}`,
            bold: true,
            size: 32, // 16pt
            font: 'Georgia',
            color: '0F172A'
          })
        ]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
        children: [
          new TextRun({
            text: chapTitle,
            italics: true,
            size: 28, // 14pt
            font: 'Georgia',
            color: '334155'
          })
        ]
      })
    );

    chapter.sections.forEach((sec) => {
      const secTitle = (isEn && sec.titleEn) ? sec.titleEn : sec.title;
      const secContent = (isEn && sec.contentEn) ? sec.contentEn : sec.content;

      if (secTitle && secTitle !== chapTitle && secTitle !== 'Сцена 1' && secTitle !== 'Scene 1') {
        docChildren.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
            children: [
              new TextRun({
                text: secTitle,
                bold: true,
                size: 24, // 12pt
                font: 'Georgia',
                color: '1E293B'
              })
            ]
          })
        );
      }

      // Split paragraphs by newlines
      const paragraphs = (secContent || '').split(/\n\s*\n|\n/);
      paragraphs.forEach((pText) => {
        const trimmed = pText.trim();
        if (trimmed) {
          docChildren.push(
            new Paragraph({
              alignment: AlignmentType.JUSTIFIED,
              spacing: { after: 120, line: 360 }, // 1.5 line spacing
              indent: { firstLine: convertInchesToTwip(0.3) },
              children: [
                new TextRun({
                  text: trimmed,
                  size: 24, // 12pt
                  font: 'Georgia',
                  color: '000000'
                })
              ]
            })
          );
        }
      });
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1)
            }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${title} • ${author}`,
                    italics: true,
                    size: 18,
                    font: 'Georgia',
                    color: '94A3B8'
                  })
                ]
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 20,
                    font: 'Georgia',
                    color: '64748B'
                  })
                ]
              })
            ]
          })
        },
        children: docChildren
      }
    ]
  });

  const blob = await Packer.toBlob(doc);
  const safeFilename = `${title.replace(/[^\p{L}\p{N}_-]+/gu, '_')}${isEn ? '_English' : ''}.docx`;
  
  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Generates and downloads a real, valid binary EPUB 3 / EPUB 2 archive (.epub)
 */
export async function exportBookToEpub(book: Book, options?: { isEnglish?: boolean }): Promise<void> {
  const isEn = !!options?.isEnglish;
  const title = (isEn && book.titleEn) ? book.titleEn : book.title;
  const subtitle = (isEn && book.subtitleEn) ? book.subtitleEn : (book.subtitle || '');
  const author = (isEn && book.authorEn) ? book.authorEn : book.author;
  const lang = isEn ? 'en' : 'uk';
  const bookUuid = book.id || `urn:uuid:${Date.now()}`;
  const dateStr = new Date().toISOString().split('T')[0];

  const zip = new JSZip();

  // 1. mimetype MUST be first, uncompressed
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  // 2. META-INF/container.xml
  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
  zip.file('META-INF/container.xml', containerXml);

  // 3. CSS Stylesheet (OEBPS/style.css)
  const cssContent = `
body {
  font-family: "Georgia", "Times New Roman", serif;
  line-height: 1.6;
  margin: 5%;
  color: #1a1a1a;
  background-color: #ffffff;
}
h1, h2, h3 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  text-align: center;
  margin-top: 1.5em;
  margin-bottom: 0.8em;
  color: #111827;
}
h1.title {
  font-size: 2.2em;
  margin-top: 3em;
  margin-bottom: 0.2em;
}
h2.subtitle {
  font-size: 1.3em;
  font-weight: normal;
  font-style: italic;
  color: #4b5563;
  margin-bottom: 2em;
}
.author {
  text-align: center;
  font-size: 1.2em;
  font-weight: bold;
  margin-top: 3em;
}
.chapter-num {
  font-size: 1.1em;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #6b7280;
  text-align: center;
  margin-top: 2em;
  margin-bottom: 0.2em;
}
.chapter-title {
  font-size: 1.8em;
  margin-top: 0.2em;
  margin-bottom: 1.5em;
}
p {
  margin-top: 0;
  margin-bottom: 0.8em;
  text-indent: 1.5em;
  text-align: justify;
}
p.first, h1 + p, h2 + p, h3 + p {
  text-indent: 0;
}
.footnote {
  font-size: 0.85em;
  color: #4b5563;
  border-top: 1px solid #e5e7eb;
  padding-top: 0.5em;
  margin-top: 2em;
}
nav#toc ol {
  list-style-type: decimal;
  padding-left: 1.5em;
}
nav#toc li {
  margin-bottom: 0.5em;
}
nav#toc a {
  text-decoration: none;
  color: #1e40af;
}
`;
  zip.file('OEBPS/style.css', cssContent);

  // 4. Title Page (OEBPS/titlepage.xhtml)
  const titlePageXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head>
  <title>${escapeXml(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div style="text-align: center; padding-top: 15%;">
    <h1 class="title">${escapeXml(title)}</h1>
    ${subtitle ? `<h2 class="subtitle">${escapeXml(subtitle)}</h2>` : ''}
    <p class="author">${escapeXml(isEn ? 'Author' : 'Автор')}: ${escapeXml(author)}</p>
    <div style="margin-top: 4em; font-size: 0.9em; color: #6b7280;">
      <p style="text-align: center; text-indent: 0;">NOVA STUDIO Publishing Edition</p>
      <p style="text-align: center; text-indent: 0;">${dateStr}</p>
    </div>
  </div>
</body>
</html>`;
  zip.file('OEBPS/titlepage.xhtml', titlePageXhtml);

  // 5. Chapter XHTML files
  const chapterFiles: { id: string; filename: string; title: string }[] = [];

  book.chapters.forEach((chap, idx) => {
    const chapNum = idx + 1;
    const chapTitle = (isEn && chap.titleEn) ? chap.titleEn : chap.title;
    const filename = `chapter_${chapNum}.xhtml`;
    const id = `chap_${chapNum}`;

    let sectionsHtml = '';
    chap.sections.forEach((sec) => {
      const secTitle = (isEn && sec.titleEn) ? sec.titleEn : sec.title;
      const secContent = (isEn && sec.contentEn) ? sec.contentEn : sec.content;

      if (secTitle && secTitle !== chapTitle && secTitle !== 'Сцена 1' && secTitle !== 'Scene 1') {
        sectionsHtml += `<h3>${escapeXml(secTitle)}</h3>\n`;
      }

      const paragraphs = (secContent || '').split(/\n\s*\n|\n/);
      paragraphs.forEach((pText, pIdx) => {
        const trimmed = pText.trim();
        if (trimmed) {
          const cls = pIdx === 0 ? ' class="first"' : '';
          sectionsHtml += `<p${cls}>${escapeXml(trimmed)}</p>\n`;
        }
      });
    });

    const chapXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head>
  <title>${escapeXml(chapTitle)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <div class="chapter-num">${escapeXml(isEn ? 'Chapter' : 'Глава')} ${chapNum}</div>
  <h1 class="chapter-title">${escapeXml(chapTitle)}</h1>
  ${sectionsHtml}
</body>
</html>`;

    zip.file(`OEBPS/${filename}`, chapXhtml);
    chapterFiles.push({ id, filename, title: chapTitle });
  });

  // 6. Navigation Document (OEBPS/nav.xhtml - EPUB 3 standard)
  const navListHtml = chapterFiles.map(c => `<li><a href="${c.filename}">${escapeXml(c.title)}</a></li>`).join('\n        ');
  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}">
<head>
  <title>${escapeXml(isEn ? 'Table of Contents' : 'Зміст')}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>${escapeXml(isEn ? 'Table of Contents' : 'Зміст')}</h1>
    <ol>
      <li><a href="titlepage.xhtml">${escapeXml(isEn ? 'Title Page' : 'Титульний лист')}</a></li>
      ${navListHtml}
    </ol>
  </nav>
</body>
</html>`;
  zip.file('OEBPS/nav.xhtml', navXhtml);

  // 7. NCX (OEBPS/toc.ncx - EPUB 2 backwards compatibility for Kindle & older readers)
  const navPointsXml = chapterFiles.map((c, i) => `
    <navPoint id="navPoint-${i + 2}" playOrder="${i + 2}">
      <navLabel><text>${escapeXml(c.title)}</text></navLabel>
      <content src="${c.filename}"/>
    </navPoint>`).join('');

  const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeXml(bookUuid)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <docAuthor><text>${escapeXml(author)}</text></docAuthor>
  <navMap>
    <navPoint id="navPoint-1" playOrder="1">
      <navLabel><text>${escapeXml(isEn ? 'Title Page' : 'Титульний лист')}</text></navLabel>
      <content src="titlepage.xhtml"/>
    </navPoint>
    ${navPointsXml}
  </navMap>
</ncx>`;
  zip.file('OEBPS/toc.ncx', tocNcx);

  // 8. Package Document (OEBPS/content.opf)
  const manifestItems = [
    `<item id="style" href="style.css" media-type="text/css"/>`,
    `<item id="toc_ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapterFiles.map(c => `<item id="${c.id}" href="${c.filename}" media-type="application/xhtml+xml"/>`)
  ].join('\n    ');

  const spineItems = [
    `<itemref idref="titlepage"/>`,
    `<itemref idref="nav"/>`,
    ...chapterFiles.map(c => `<itemref idref="${c.id}"/>`)
  ].join('\n    ');

  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookID" version="3.0" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="BookID">${escapeXml(bookUuid)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${lang}</dc:language>
    <dc:creator>${escapeXml(author)}</dc:creator>
    <dc:publisher>NOVA STUDIO</dc:publisher>
    <dc:date>${dateStr}</dc:date>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine toc="toc_ncx">
    ${spineItems}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', contentOpf);

  // Generate EPUB binary archive
  const epubBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/epub+zip',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });

  const safeFilename = `${title.replace(/[^\p{L}\p{N}_-]+/gu, '_')}${isEn ? '_English' : ''}.epub`;

  // Trigger browser download
  const url = URL.createObjectURL(epubBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

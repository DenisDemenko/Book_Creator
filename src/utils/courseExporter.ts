import JSZip from 'jszip';
import { Book, CourseMaterial, CourseTag } from '../types';
import { generateBookExportHtml } from './helpers';

/**
 * Експорт курсу/мінікурсу в один zip-файл: книга (book.html) + усі матеріали
 * курсу (фото, домашні завдання pdf/docx, 3D-моделі) розпаковані у папку
 * materials/, плюс course-info.json (структуровані метадані тегів і
 * матеріалів) та index.html — людяна навігаційна сторінка курсу з
 * прив'язкою кожного матеріалу до тегу й фрагменту тексту книги.
 *
 * Матеріали в книзі зберігаються як data: URL (той самий підхід, що й для
 * ілюстрацій — див. src/utils/storage.ts), тому тут вони розпаковуються назад
 * у бінарні файли всередині архіву, а не лишаються закодованими base64-рядками.
 */

function escapeHtml(unsafe: string): string {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function dataUrlToBase64(dataUrl: string): string {
  const idx = dataUrl.indexOf(',');
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1);
}

function sanitizeFilename(name: string): string {
  return (name || 'file').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'file';
}

function materialExtension(material: CourseMaterial): string {
  if (material.kind === 'homework') return material.homeworkFormat === 'docx' ? '.docx' : '.pdf';
  if (material.kind === 'model_3d') return `.${material.model3DFormat || 'stl'}`;
  if (material.fileName && /\.[a-z0-9]+$/i.test(material.fileName)) {
    return material.fileName.slice(material.fileName.lastIndexOf('.'));
  }
  return '';
}

function materialIcon(kind: CourseMaterial['kind']): string {
  switch (kind) {
    case 'youtube': return '▶️';
    case 'photo': return '🖼️';
    case 'homework': return '📄';
    case 'model_3d': return '🧊';
    default: return '📎';
  }
}

export async function exportCourseToZip(book: Book): Promise<void> {
  const course = book.course;
  const zip = new JSZip();

  // 1. Повний текст книги — той самий HTML, що використовується для друку/PDF.
  zip.file('book.html', generateBookExportHtml(book));

  const tags: CourseTag[] = course?.tags || [];
  const materials: CourseMaterial[] = course?.materials || [];

  // 2. Розпакувати матеріали з data:URL у бінарні файли всередині materials/
  const materialFileNames = new Map<string, string>(); // material.id -> relative path in zip
  materials.forEach((m, idx) => {
    if ((m.kind === 'photo' || m.kind === 'homework' || m.kind === 'model_3d') && m.fileUrl) {
      const base = sanitizeFilename(m.fileName ? m.fileName.replace(/\.[a-z0-9]+$/i, '') : m.title || `material-${idx + 1}`);
      const ext = materialExtension(m);
      const relPath = `materials/${base}-${idx + 1}${ext}`;
      zip.file(relPath, dataUrlToBase64(m.fileUrl), { base64: true });
      materialFileNames.set(m.id, relPath);
    }
  });

  // 3. course-info.json — структуровані метадані (для програмного імпорту на сторонньому майданчику)
  const courseInfo = {
    bookTitle: book.title,
    bookAuthor: book.author,
    courseTitle: course?.title || book.title,
    courseTitleEn: course?.titleEn,
    courseDescription: course?.description || '',
    courseDescriptionEn: course?.descriptionEn,
    exportedAt: new Date().toISOString(),
    tags: tags.map((tag) => ({
      id: tag.id,
      label: tag.label,
      labelEn: tag.labelEn,
      chapterId: tag.chapterId,
      sectionId: tag.sectionId,
      textSnippet: tag.textSnippet,
      materials: materials
        .filter((m) => m.tagId === tag.id)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          title: m.title,
          description: m.description,
          youtubeUrl: m.youtubeUrl,
          file: materialFileNames.get(m.id) || null,
          homeworkFormat: m.homeworkFormat,
          model3DFormat: m.model3DFormat,
        })),
    })),
    generalMaterials: materials
      .filter((m) => !m.tagId)
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        title: m.title,
        description: m.description,
        youtubeUrl: m.youtubeUrl,
        file: materialFileNames.get(m.id) || null,
        homeworkFormat: m.homeworkFormat,
        model3DFormat: m.model3DFormat,
      })),
  };
  zip.file('course-info.json', JSON.stringify(courseInfo, null, 2));

  // 4. index.html — людяна навігаційна сторінка курсу
  const renderMaterialLi = (m: CourseMaterial): string => {
    const path = materialFileNames.get(m.id);
    const label = escapeHtml(m.title || m.fileName || m.kind);
    if (m.kind === 'youtube' && m.youtubeUrl) {
      return `<li>${materialIcon(m.kind)} <strong>${label}</strong> — <a href="${escapeHtml(m.youtubeUrl)}" target="_blank" rel="noopener">${escapeHtml(m.youtubeUrl)}</a></li>`;
    }
    if (path) {
      return `<li>${materialIcon(m.kind)} <strong>${label}</strong> — <a href="${escapeHtml(path)}">${escapeHtml(path)}</a></li>`;
    }
    return `<li>${materialIcon(m.kind)} <strong>${label}</strong></li>`;
  };

  const tagsHtml = tags.map((tag) => {
    const tagMaterials = materials.filter((m) => m.tagId === tag.id);
    return `
      <section class="tag-block">
        <h2>${escapeHtml(tag.label)}</h2>
        <blockquote>${escapeHtml(tag.textSnippet)}</blockquote>
        ${tagMaterials.length ? `<ul>${tagMaterials.map(renderMaterialLi).join('\n')}</ul>` : '<p class="empty">Немає доданих матеріалів.</p>'}
      </section>`;
  }).join('\n');

  const generalMaterials = materials.filter((m) => !m.tagId);
  const generalHtml = generalMaterials.length
    ? `<section class="tag-block"><h2>Загальні матеріали курсу</h2><ul>${generalMaterials.map(renderMaterialLi).join('\n')}</ul></section>`
    : '';

  const indexHtml = `<!DOCTYPE html>
<html lang="uk">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(course?.title || book.title)} — курс</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 820px; margin: 40px auto; padding: 0 20px; color: #1a1a1a; line-height: 1.6; }
  h1 { font-family: 'Helvetica Neue', Arial, sans-serif; }
  h2 { font-family: 'Helvetica Neue', Arial, sans-serif; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
  .tag-block { margin-bottom: 32px; }
  blockquote { color: #555; font-style: italic; border-left: 3px solid #ccc; padding-left: 12px; margin: 10px 0; }
  .empty { color: #888; font-size: 0.9em; }
  a { color: #0f5fbf; }
  .meta { color: #666; font-size: 0.9em; }
</style>
</head>
<body>
  <h1>${escapeHtml(course?.title || book.title)}</h1>
  <p class="meta">На основі книги «${escapeHtml(book.title)}» (${escapeHtml(book.author)})</p>
  ${course?.description ? `<p>${escapeHtml(course.description)}</p>` : ''}
  <p><a href="book.html">📖 Відкрити повний текст книги (book.html)</a></p>
  ${tagsHtml}
  ${generalHtml}
</body>
</html>`;
  zip.file('index.html', indexHtml);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });

  const safeTitle = (course?.title || book.title || 'course').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}_course.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

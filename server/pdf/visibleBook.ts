/**
 * Видимий текст для PDF-рушіїв (запис #534).
 *
 * Маркери ШІ (`[AI-DRAFT]`, `[AI-GENERATED:…]`) — службова розмітка рукопису, як і теги сутностей: читач книги
 * не мусить їх бачити. Власник побачив `[AI-DRAFT]` друкованим текстом у PDF інструкції й сформулював правило:
 * мітка лишається прихованою, її читає скрипт чи інший ШІ, а не людина.
 *
 * Тому рушії отримують ЗНІМОК запиту без маркерів, а носій тегів (`attachTagCarrier`) будується з ОРИГІНАЛУ і
 * зберігає ознаку ШІ в прихованому вкладенні `nova-tags.json` (`CarrierParagraph.ai`). Маркери знімаються в
 * одному місці над усіма рушіями, а не в кожному окремо: Nova, DesignCraft, Chromium і Pandoc не можуть
 * розійтись у тому, що вважати текстом.
 */
import { stripAiTextMarkers } from '../../shared/aiTextOrigin';
import type { PdfRenderRequest } from './engines/types';

/**
 * Запит із розділами без маркерів ШІ. Нічого не змінилось — повертає той самий обʼєкт (без копіювання книги).
 * Оригінал не мутується.
 */
export function withoutAiMarkers(request: PdfRenderRequest): PdfRenderRequest {
  const chapters = request.book?.chapters;
  if (!Array.isArray(chapters)) return request;
  let changed = false;
  const nextChapters = chapters.map((chapter) => {
    let chapterChanged = false;
    const sections = (chapter.sections ?? []).map((section) => {
      const content = String(section.content ?? '');
      const visible = stripAiTextMarkers(content);
      if (visible === content) return section;
      chapterChanged = true;
      return { ...section, content: visible };
    });
    if (!chapterChanged) return chapter;
    changed = true;
    return { ...chapter, sections };
  });
  return changed ? { ...request, book: { ...request.book, chapters: nextChapters } } : request;
}

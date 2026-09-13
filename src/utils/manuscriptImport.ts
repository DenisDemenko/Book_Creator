import { Chapter, Section } from '../types';
import { calculateWordCount } from './helpers';

/**
 * Розбір «сирого» тексту рукопису, принесеного з іншого сервісу (вставлений
 * вручну або завантажений .txt/.md), на глави й розділи — перший крок
 * майстра перенесення матеріалів («Онбординг-візард») на стартовій сторінці.
 *
 * Це навмисно проста евристика, не повноцінний парсер: якщо в тексті
 * знаходяться рядки-заголовки на кшталт «Глава 3», «Розділ IV: Назва»,
 * «Chapter 5» чи markdown `# Заголовок`, текст ріжеться по них на глави
 * (кожна глава — один розділ із повним текстом усередині). Якщо жодного
 * заголовка не знайдено, увесь текст стає однією главою з одним розділом —
 * підзаголовки й далі можна розкласти вручну в редакторі книги.
 */

const HEADING_PATTERN =
  /^\s*(?:#{1,2}\s+.+|(?:глава|розділ|частина|chapter|part)\s+[\divxlc]+\b.*)\s*$/i;

export interface ParsedManuscript {
  chapters: Chapter[];
  totalWords: number;
  headingsDetected: boolean;
}

/**
 * Знімає markdown-наголос із країв рядка.
 *
 * Навіщо: у Word глави й частини майже завжди виділені **жирним**, і після
 * `htmlToManuscript` такий рядок приходить як `**Глава 1. Назва**`. Без цього
 * кроку жоден такий заголовок не впізнавався, і .docx давав ОДНУ главу на всю
 * книгу (перевірено на справжньому рукописі: 42 картинки, 13 глав — але
 * розпізнавалась одна).
 */
function stripEdgeEmphasis(line: string): string {
  return line.trim().replace(/^\*{1,2}\s*/, '').replace(/\s*\*{1,2}$/, '').trim();
}

function cleanTitle(line: string): string {
  return stripEdgeEmphasis(line.replace(/^#{1,2}\s+/, ''));
}

export function parseManuscriptText(rawText: string, bookId: string): ParsedManuscript {
  const now = new Date().toISOString();
  const text = (rawText || '').replace(/\r\n/g, '\n').trim();

  if (!text) {
    return { chapters: [], totalWords: 0, headingsDetected: false };
  }

  const lines = text.split('\n');
  const headingIndices: number[] = [];
  lines.forEach((line, idx) => {
    if (HEADING_PATTERN.test(stripEdgeEmphasis(line))) headingIndices.push(idx);
  });

  const chapters: Chapter[] = [];
  let totalWords = 0;

  if (headingIndices.length === 0) {
    const wordCount = calculateWordCount(text);
    totalWords = wordCount;
    const chapterId = `chap-import-${Date.now()}-1`;
    const section: Section = {
      id: `sec-import-${Date.now()}-1`,
      chapterId,
      title: 'Розділ 1',
      order: 1,
      content: text,
      wordCount,
      lastModified: now,
    };
    chapters.push({
      id: chapterId,
      bookId,
      title: 'Глава 1',
      order: 1,
      sections: [section],
    });
    return { chapters, totalWords, headingsDetected: false };
  }

  /**
   * Текст ПЕРЕД першим заголовком (титул, анотація, назва частини) раніше
   * просто зникав — цикл нижче починає тіло з `startIdx + 1`. На справжньому
   * рукописі це 1063 слова вступу, тобто автор отримував неповну книгу й не
   * мав про це жодного сигналу. Тепер ця частина стає першою главою «Вступ»:
   * краще помітний зайвий розділ, який автор прибере сам, ніж невидима
   * втрата тексту.
   */
  const preamble = lines.slice(0, headingIndices[0]).join('\n').trim();
  if (preamble) {
    const wordCount = calculateWordCount(preamble);
    totalWords += wordCount;
    const chapterId = `chap-import-${Date.now()}-preamble`;
    const section: Section = {
      id: `sec-import-${Date.now()}-preamble-1`,
      chapterId,
      title: 'Розділ 1',
      order: 1,
      content: preamble,
      wordCount,
      lastModified: now,
    };
    chapters.push({ id: chapterId, bookId, title: 'Вступ', order: 1, sections: [section] });
  }

  headingIndices.forEach((startIdx, i) => {
    const endIdx = i + 1 < headingIndices.length ? headingIndices[i + 1] : lines.length;
    const title = cleanTitle(lines[startIdx]) || `Глава ${i + 1}`;
    const body = lines.slice(startIdx + 1, endIdx).join('\n').trim();
    const wordCount = calculateWordCount(body);
    totalWords += wordCount;

    const chapterId = `chap-import-${Date.now()}-${i + 1}`;
    const section: Section = {
      id: `sec-import-${Date.now()}-${i + 1}-1`,
      chapterId,
      title: 'Розділ 1',
      order: 1,
      content: body || '(Порожній розділ — додайте текст у редакторі.)',
      wordCount,
      lastModified: now,
    };
    chapters.push({
      id: chapterId,
      bookId,
      title,
      order: i + 1 + (preamble ? 1 : 0),
      sections: [section],
    });
  });

  return { chapters, totalWords, headingsDetected: true };
}

/**
 * Перетворює главі, повернуті Claude після форматування готового рукопису
 * (server/claudeManuscript.ts, /api/ai/format-manuscript — очищений текст +
 * назва, БЕЗ поділу на розділи), на повноцінні Chapter[] книги: кожна глава
 * Claude стає однією главою книги з одним розділом «Розділ 1» усередині.
 *
 * Використовується у KdpPublishingModal, коли письменик підтверджує
 * застосування форматування Claude до активної книги перед вивантаженням у
 * Amazon KDP. Це навмисно проста заміна структури — на відміну від
 * поділу за заголовками в parseManuscriptText, тут глави вже визначені
 * самим Claude, тож додаткова евристика не потрібна.
 */
export function buildChaptersFromClaudeFormat(
  formatted: { title: string; text: string }[],
  bookId: string
): { chapters: Chapter[]; totalWords: number } {
  const now = new Date().toISOString();
  let totalWords = 0;

  const chapters: Chapter[] = formatted.map((c, i) => {
    const wordCount = calculateWordCount(c.text);
    totalWords += wordCount;
    const chapterId = `chap-claude-${Date.now()}-${i + 1}`;
    const section: Section = {
      id: `sec-claude-${Date.now()}-${i + 1}-1`,
      chapterId,
      title: 'Розділ 1',
      order: 1,
      content: c.text,
      wordCount,
      lastModified: now,
    };
    return {
      id: chapterId,
      bookId,
      title: c.title || `Глава ${i + 1}`,
      order: i + 1,
      sections: [section],
    };
  });

  return { chapters, totalWords };
}

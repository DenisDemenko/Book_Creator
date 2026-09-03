/**
 * Книга й курс → Markdown. Спільне джерело для рушіїв `chromium` і `pandoc`.
 *
 * ЧОМУ САМЕ MARKDOWN, А НЕ ДВА ОКРЕМІ ПЕРЕТВОРЕННЯ. Обидва зовнішні рушії
 * приймають розмітку, а не наш обʼєкт книги. Якби кожен розбирав книгу сам,
 * ми б отримали два різні уявлення про те, де починається розділ і що
 * робити з ілюстрацією, — і два різні PDF з однієї книги, причому
 * розбіжність вилізла б не в тесті, а у вітрині.
 *
 * ЩО ТУТ НЕ РОБИТЬСЯ. Ілюстрації НЕ завантажуються. Посилання в книзі —
 * `/api/media/file/<id>` (медіатека, #100), `/generated/...`, `data:` або
 * зовнішній http. Перетворити їх на файли, які прочитає pandoc чи браузер,
 * може лише рушій: це потребує диска, тимчасової теки й прав власника.
 * Тому converter лишається чистою функцією й повертає ПЕРЕЛІК зображень із
 * плейсхолдерами, а підстановку робить рушій.
 *
 * ЩО РОБИТЬСЯ З РОЗМІТКОЮ АВТОРА. Поле `content` у книзі — «rich text or
 * markdown» (src/types.ts), тобто суміш HTML і Markdown. Власний рушій усе
 * це зрізає до голого тексту — там інакше не можна, `pdf-lib` не має
 * поняття про напівжирний. Тут навпаки: HTML перекладається в Markdown, а
 * Markdown автора лишається як є. Саме в цьому й полягає виграш від
 * зовнішніх рушіїв, і зрізати розмітку «для однаковості» означало б
 * викинути причину, заради якої вони зʼявились.
 */

import type { Book, CourseConfig } from '../../src/types';

export interface MarkdownImage {
  /** Рядок, який рушій замінить на шлях до файлу. Унікальний у межах документа. */
  placeholder: string;
  /** Посилання так, як воно записане в книзі. */
  url: string;
  captionUk: string;
}

export interface MarkdownDocument {
  markdown: string;
  images: MarkdownImage[];
  /** Метадані окремо: pandoc бере їх із YAML, браузер — з нашого шаблону. */
  meta: {
    title: string;
    subtitle?: string;
    author?: string;
    lang: string;
  };
}

// ---------------------------------------------------------------------------
// HTML → Markdown
// ---------------------------------------------------------------------------

const ENTITIES: Array<[RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&mdash;/gi, '—'],
  [/&ndash;/gi, '–'],
  [/&laquo;/gi, '«'],
  [/&raquo;/gi, '»'],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  // Амперсанд — ОСТАННІМ. Інакше `&amp;lt;` перетворився б спершу на
  // `&lt;`, а потім на `<`, і текст автора змінився б без його відома.
  [/&amp;/gi, '&'],
];

/**
 * Переклад HTML у Markdown. Свідомо вузький: підтримуються ті теги, які
 * реально трапляються в редакторі книги. Невідомий тег зрізається, а його
 * ВМІСТ лишається — втратити текст автора гірше, ніж втратити оформлення.
 */
export function htmlToMarkdown(input: string): string {
  let text = String(input ?? '').replace(/\r\n?/g, '\n');

  // Блоки, які самі є абзацами.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div)>/gi, '\n\n');
  text = text.replace(/<(p|div)[^>]*>/gi, '');

  // Заголовки всередині тексту автора.
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    return `\n\n${'#'.repeat(Number(level))} ${inner.trim()}\n\n`;
  });

  // Списки. Порядок важливий: спершу пункти, потім обгортки.
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner: string) => `\n- ${inner.trim()}`);
  text = text.replace(/<\/?(ul|ol)[^>]*>/gi, '\n\n');

  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner: string) =>
    `\n\n${inner.trim().split('\n').map((l) => `> ${l.trim()}`).join('\n')}\n\n`
  );

  // Накреслення.
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Решта тегів — геть, вміст лишається.
  text = text.replace(/<[^>]+>/g, '');

  for (const [re, to] of ENTITIES) text = text.replace(re, to);

  // Порожні рядки не множимо: три й більше поспіль у Markdown нічого не
  // додають, а в LaTeX дають зайвий вертикальний відступ.
  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Заголовок як РЯДОК тексту, а не як розмітка. Назва розділу могла містити
 * `#` чи `*` — у заголовку Markdown вони зламали б рівень або накреслення.
 */
function headingText(raw: string | undefined): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[#*_`\[\]]/g, '')
    .trim();
}

/** YAML-рядок у лапках: у назві книги трапляються і двокрапки, і лапки. */
function yamlString(value: string): string {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// Книга
// ---------------------------------------------------------------------------

export interface BookToMarkdownOptions {
  /** Мова документа для pandoc (переноси, лапки). За замовчуванням українська. */
  lang?: string;
  /** Чи вставляти ілюстрації. Вимикається для чернетки або уривка. */
  withImages?: boolean;
  /** YAML-заголовок потрібен pandoc і зайвий браузеру. */
  frontmatter?: boolean;
}

export function bookToMarkdown(book: Book, options: BookToMarkdownOptions = {}): MarkdownDocument {
  const lang = options.lang || 'uk-UA';
  const withImages = options.withImages !== false;
  const images: MarkdownImage[] = [];
  const out: string[] = [];

  const meta = {
    title: String(book.title || 'Без назви'),
    subtitle: book.subtitle ? String(book.subtitle) : undefined,
    author: book.author ? String(book.author) : undefined,
    lang,
  };

  if (options.frontmatter) {
    const lines = ['---', `title: ${yamlString(meta.title)}`];
    if (meta.subtitle) lines.push(`subtitle: ${yamlString(meta.subtitle)}`);
    if (meta.author) lines.push(`author: ${yamlString(meta.author)}`);
    lines.push(`lang: ${yamlString(lang)}`, 'toc: true', 'book: true', '---', '');
    out.push(lines.join('\n'));
  }

  const chapters = (book.chapters || [])
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const illustrations = withImages ? book.illustrations || [] : [];

  for (const chapter of chapters) {
    out.push(`# ${headingText(chapter.title) || 'Розділ'}`);

    const sections = (chapter.sections || [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    for (const section of sections) {
      const title = headingText(section.title);
      if (title) out.push(`## ${title}`);
      const body = htmlToMarkdown(section.content || '');
      if (body) out.push(body);
    }

    // Ілюстрації розділу — в кінці розділу, а не всередині тексту.
    // Точного місця вставки книга не зберігає (у `BookIllustration` є лише
    // `chapterId`), і вигадувати його означало б розривати абзац навмання.
    for (const ill of illustrations) {
      if (ill.chapterId !== chapter.id) continue;
      const placeholder = `nova-image-${images.length + 1}`;
      images.push({
        placeholder,
        url: String(ill.url || ''),
        captionUk: String(ill.caption || ''),
      });
      const caption = headingText(ill.caption);
      out.push(`![${caption}](${placeholder})`);
    }
  }

  return { markdown: out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', images, meta };
}

// ---------------------------------------------------------------------------
// Курс
// ---------------------------------------------------------------------------

/**
 * Курс → Markdown.
 *
 * Курс у Nova — не окремий текст, а РОЗМІТКА поверх книги: тег указує на
 * фрагмент розділу, урок збирає теги, модуль збирає уроки. Тому друкований
 * курс — це книга, перебрана в порядку модулів, плюс матеріали до кожного
 * уроку.
 *
 * Відео тут стає посиланням, а не зникає: у надрукованому курсі посилання —
 * єдиний спосіб дійти до відео, і мовчки викинути його гірше, ніж надрукувати
 * URL.
 */
export function courseToMarkdown(
  book: Book,
  course: CourseConfig,
  options: BookToMarkdownOptions = {}
): MarkdownDocument {
  const lang = options.lang || 'uk-UA';
  const images: MarkdownImage[] = [];
  const out: string[] = [];

  const meta = {
    title: String(course.title || book.title || 'Курс'),
    subtitle: undefined as string | undefined,
    author: book.author ? String(book.author) : undefined,
    lang,
  };

  if (options.frontmatter) {
    const lines = ['---', `title: ${yamlString(meta.title)}`];
    if (meta.author) lines.push(`author: ${yamlString(meta.author)}`);
    lines.push(`lang: ${yamlString(lang)}`, 'toc: true', 'book: true', '---', '');
    out.push(lines.join('\n'));
  }

  if (course.description) {
    const intro = htmlToMarkdown(course.description);
    if (intro) out.push(intro);
  }

  const tagById = new Map((course.tags || []).map((tag) => [tag.id, tag]));
  const materialsByTag = new Map<string, typeof course.materials>();
  for (const material of course.materials || []) {
    if (!material.tagId) continue;
    const list = materialsByTag.get(material.tagId) || [];
    list.push(material);
    materialsByTag.set(material.tagId, list);
  }

  const modules = course.modules || [];
  if (modules.length === 0) {
    // Старі курси створювались до появи модулів. Друкувати «нема чого» —
    // неправда: теги в них є, просто без структури.
    out.push('# Матеріали курсу');
    for (const tag of course.tags || []) {
      out.push(`## ${headingText(tag.label) || 'Фрагмент'}`);
      const snippet = htmlToMarkdown(tag.textSnippet || '');
      if (snippet) out.push(snippet);
    }
  }

  for (const module of modules) {
    out.push(`# ${headingText(module.title) || 'Модуль'}`);

    for (const lesson of module.lessons || []) {
      out.push(`## ${headingText(lesson.title) || 'Урок'}`);

      for (const tagId of lesson.tagIds || []) {
        const tag = tagById.get(tagId);
        if (!tag) continue;

        const label = headingText(tag.label);
        if (label) out.push(`### ${label}`);
        const snippet = htmlToMarkdown(tag.textSnippet || '');
        if (snippet) out.push(snippet);

        for (const material of materialsByTag.get(tagId) || []) {
          const title = headingText(material.title) || 'Матеріал';
          if (material.kind === 'youtube' && material.youtubeUrl) {
            out.push(`**Відео:** [${title}](${material.youtubeUrl})`);
            continue;
          }
          if (material.kind === 'photo' && material.fileUrl && options.withImages !== false) {
            const placeholder = `nova-image-${images.length + 1}`;
            images.push({ placeholder, url: String(material.fileUrl), captionUk: title });
            out.push(`![${title}](${placeholder})`);
            continue;
          }
          // Домашнє завдання й 3D-моделі — файли, які в PDF не вкладаються.
          // Називаємо їх, щоб читач знав, що вони існують.
          const what = material.kind === 'homework' ? 'Домашнє завдання' : 'Модель 3D';
          out.push(`**${what}:** ${title}${material.fileName ? ` (${material.fileName})` : ''}`);
        }
      }
    }
  }

  return { markdown: out.join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', images, meta };
}

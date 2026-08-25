/**
 * Двосторонній перетворювач між текстом розділу книги (простий рядок з
 * bracket-маркерами: `**жирний**`, `*курсив*`, `[FONT="Назва"]…[/FONT]`,
 * `> цитата`, `[IMG: id "підпис" wrap=режим]`) і документом TipTap.
 *
 * Причина існування: `section.content`/`contentEn` лишаються звичайним
 * рядком (те саме, що вже читають переклад, AI-грамотність, лічильник слів
 * і HTML/PDF-експорт у utils/helpers.ts) — редактор лише малює цей рядок
 * "наживо" через TipTap, а перед збереженням завжди серіалізує назад у
 * той самий формат.
 */
import type { Node as PMNode } from '@tiptap/pm/model';

export interface JSONContent {
  type: string;
  attrs?: Record<string, any>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, any> }[];
  text?: string;
}

type ActiveMarks = { bold: boolean; italic: boolean; fontStack: string[]; sizeStack: string[] };

const INLINE_TOKEN = /(\*\*|\*|\[FONT="[^"]*"\]|\[\/FONT\]|\[SIZE=[\d.]+\]|\[\/SIZE\]|\n)/;

/** Розбирає рядок одного абзацу на інлайн-вузли TipTap (текст + жирність/курсив/шрифт/переніс рядка). */
function parseInline(text: string): JSONContent[] {
  const tokens = text.split(INLINE_TOKEN);
  const nodes: JSONContent[] = [];
  const state: ActiveMarks = { bold: false, italic: false, fontStack: [], sizeStack: [] };
  let buffer = '';

  const flush = () => {
    if (!buffer) return;
    const marks: { type: string; attrs?: Record<string, any> }[] = [];
    if (state.bold) marks.push({ type: 'bold' });
    if (state.italic) marks.push({ type: 'italic' });
    if (state.fontStack.length) {
      marks.push({ type: 'fontSpan', attrs: { family: state.fontStack[state.fontStack.length - 1] } });
    }
    if (state.sizeStack.length) {
      marks.push({ type: 'fontSize', attrs: { size: Number(state.sizeStack[state.sizeStack.length - 1]) } });
    }
    nodes.push(marks.length ? { type: 'text', text: buffer, marks } : { type: 'text', text: buffer });
    buffer = '';
  };

  for (const token of tokens) {
    if (token === '') continue;
    if (token === '**') {
      flush();
      state.bold = !state.bold;
    } else if (token === '*') {
      flush();
      state.italic = !state.italic;
    } else if (token === '\n') {
      flush();
      nodes.push({ type: 'hardBreak' });
    } else {
      const openFont = token.match(/^\[FONT="([^"]*)"\]$/);
      const openSize = token.match(/^\[SIZE=([\d.]+)\]$/);
      if (openFont) {
        flush();
        state.fontStack.push(openFont[1]);
      } else if (token === '[/FONT]') {
        flush();
        state.fontStack.pop();
      } else if (openSize) {
        flush();
        state.sizeStack.push(openSize[1]);
      } else if (token === '[/SIZE]') {
        flush();
        state.sizeStack.pop();
      } else {
        buffer += token;
      }
    }
  }
  flush();
  return nodes.length ? nodes : [];
}

/** Маркер зображення `[IMG: id "підпис" wrap=режим width=Nmm height=Nmm shape="…"]`, якщо абзац складається лише з нього. */
const IMG_MARKER_RE =
  /^\[IMG:\s*([^\s\]"]+)\s*(?:"([^"]*)")?(?:\s+wrap=(\w+))?(?:\s+width=([\d.]+)mm)?(?:\s+height=([\d.]+)mm)?(?:\s+shape="([^"]*)")?\]$/;

const VALID_WRAP = new Set(['left', 'right', 'none', 'contour']);

/**
 * Контейнер «AI-чернетка» — абзаци, згенеровані AI за фото (правий клік на
 * зображенні в редакторі), візуально позначені до того, як письменник явно
 * позначить їх переглянутими (AiDraftBlockNode.tsx). Маркери-обгортки самі
 * по собі завжди стоять окремим "абзацом" (після split на /\n{2,}/), тож
 * парсяться так само, як [IMG]/цитата — не потребують окремого regex.
 */
const AI_DRAFT_OPEN = '[AI-DRAFT]';
const AI_DRAFT_CLOSE = '[/AI-DRAFT]';

/** Будує канонічний рядок-маркер `[IMG: id "підпис" wrap=режим width=Nmm height=Nmm shape="…"]` з атрибутів вузла wrappedImage. */
function imgMarkerString(attrs: Record<string, any>): string {
  const { imageId, caption, wrap, widthMm, heightMm, shape } = attrs;
  // `wrap=` пишемо ЗАВЖДИ, зокрема й для 'none'. Раніше 'none' був
  // дефолтом і його можна було не писати; тепер дефолт — 'left', тож
  // пропущений `wrap=none` перечитався б як «обтікання зліва» і мовчки
  // переверстав би картинки, які автор свідомо поставив по центру.
  const wrapPart = wrap ? ` wrap=${wrap}` : '';
  const widthPart = widthMm != null ? ` width=${widthMm}mm` : '';
  const heightPart = heightMm != null ? ` height=${heightMm}mm` : '';
  const shapePart = shape ? ` shape="${shape}"` : '';
  return `[IMG: ${imageId} "${caption || ''}"${wrapPart}${widthPart}${heightPart}${shapePart}]`;
}

/** Перетворює текст розділу (рядок з маркерами) у документ TipTap (JSON). */
export function markerStringToTiptapDoc(text: string): JSONContent {
  const paragraphs = (text || '').replace(/\r\n/g, '\n').split(/\n{2,}/);
  const content: JSONContent[] = [];
  // Не null, поки читання перебуває всередині [AI-DRAFT]…[/AI-DRAFT] —
  // тоді наступні абзаци збираються сюди замість content напряму.
  let draftBuffer: JSONContent[] | null = null;
  const pushBlock = (node: JSONContent) => (draftBuffer ? draftBuffer.push(node) : content.push(node));

  paragraphs.forEach((raw) => {
    const para = raw; // не тримаємо .trim() тут — trim ламав би навмисні відступи всередині абзацу
    if (!para) return;
    const trimmed = para.trim();

    if (trimmed === AI_DRAFT_OPEN) {
      draftBuffer = [];
      return;
    }
    if (trimmed === AI_DRAFT_CLOSE) {
      if (draftBuffer) {
        content.push({ type: 'aiDraft', content: draftBuffer.length ? draftBuffer : [{ type: 'paragraph', content: [] }] });
      }
      draftBuffer = null;
      return;
    }

    const imgMatch = trimmed.match(IMG_MARKER_RE);
    if (imgMatch) {
      // Маркер без `wrap=` — це книга, написана до появи режимів обтікання.
      // Такі фото відкриваються обтічними ЗЛІВА (узгоджено з автором), той
      // самий дефолт, що й у WrappedImageNode.addAttributes.
      const wrap = VALID_WRAP.has(imgMatch[3] || '') ? imgMatch[3] : 'left';
      pushBlock({
        type: 'wrappedImage',
        attrs: {
          imageId: imgMatch[1],
          caption: imgMatch[2] || '',
          wrap,
          widthMm: imgMatch[4] ? Number(imgMatch[4]) : null,
          heightMm: imgMatch[5] ? Number(imgMatch[5]) : null,
          shape: imgMatch[6] || null,
        },
      });
      return;
    }

    const isCallout = /^>\s?/.test(para);
    if (isCallout) {
      const stripped = para.replace(/^>\s?/gm, '');
      pushBlock({ type: 'blockquote', content: [{ type: 'paragraph', content: parseInline(stripped) }] });
      return;
    }

    pushBlock({ type: 'paragraph', content: parseInline(para) });
  });

  // Незакритий [AI-DRAFT] (пошкоджені/обрізані дані) — не губимо текст,
  // просто не групуємо його в контейнер.
  if (draftBuffer) content.push(...draftBuffer);

  if (content.length === 0) content.push({ type: 'paragraph', content: [] });
  return { type: 'doc', content };
}

/** Серіалізує масив інлайн-вузлів (текст+marks/hardBreak) назад у рядок з маркерами. */
function serializeInline(nodes: JSONContent[]): string {
  let out = '';
  let prev: ActiveMarks = { bold: false, italic: false, fontStack: [], sizeStack: [] };

  const familyOf = (n: JSONContent) => n.marks?.find((m) => m.type === 'fontSpan')?.attrs?.family as string | undefined;
  const sizeOf = (n: JSONContent) => n.marks?.find((m) => m.type === 'fontSize')?.attrs?.size as number | undefined;

  nodes.forEach((n) => {
    if (n.type === 'hardBreak') {
      out += '\n';
      return;
    }
    if (n.type !== 'text') return;

    const bold = !!n.marks?.some((m) => m.type === 'bold');
    const italic = !!n.marks?.some((m) => m.type === 'italic');
    const family = familyOf(n);
    const size = sizeOf(n);
    const sizeStr = size != null ? String(size) : undefined;

    // Закриваємо маркери, яких більше немає (у зворотному до відкриття порядку).
    if (prev.sizeStack.length && prev.sizeStack[prev.sizeStack.length - 1] !== sizeStr) {
      out += '[/SIZE]';
      prev.sizeStack = [];
    }
    if (prev.fontStack.length && prev.fontStack[prev.fontStack.length - 1] !== family) {
      out += '[/FONT]';
      prev.fontStack = [];
    }
    if (prev.italic && !italic) out += '*';
    if (prev.bold && !bold) out += '**';

    // Відкриваємо нові.
    if (bold && !prev.bold) out += '**';
    if (italic && !prev.italic) out += '*';
    if (family && prev.fontStack[prev.fontStack.length - 1] !== family) out += `[FONT="${family}"]`;
    if (sizeStr && prev.sizeStack[prev.sizeStack.length - 1] !== sizeStr) out += `[SIZE=${sizeStr}]`;

    out += n.text || '';
    prev = { bold, italic, fontStack: family ? [family] : [], sizeStack: sizeStr ? [sizeStr] : [] };
  });

  // Закриваємо все, що лишилось відкритим у кінці абзацу.
  if (prev.sizeStack.length) out += '[/SIZE]';
  if (prev.fontStack.length) out += '[/FONT]';
  if (prev.italic) out += '*';
  if (prev.bold) out += '**';

  return out;
}

/** Серіалізує документ TipTap (JSON) назад у текст розділу з маркерами. */
export function tiptapDocToMarkerString(doc: JSONContent): string {
  const blocks = (doc.content || []).map((node) => {
    if (node.type === 'wrappedImage') {
      return imgMarkerString(node.attrs || {});
    }
    if (node.type === 'blockquote') {
      const inner = (node.content || [])
        .map((p) => serializeInline(p.content || []))
        .join('\n');
      return inner
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n');
    }
    if (node.type === 'aiDraft') {
      const inner = (node.content || []).map((p) => serializeInline(p.content || [])).join('\n\n');
      return [AI_DRAFT_OPEN, inner, AI_DRAFT_CLOSE].join('\n\n');
    }
    if (node.type === 'paragraph') {
      return serializeInline(node.content || []);
    }
    return '';
  });
  return blocks.join('\n\n');
}

/**
 * Маленький фрагмент-маркер (напр. `[^5]`, `\n\n[QR: ... "..."]\n\n`,
 * `\n— текст, — Ім'я.\n`) → вузли TipTap для вставки в позицію курсора.
 * Ділиться тим самим інлайн-парсером, що й повний документ, тож будь-який
 * маркер, вставлений через toolbar, читається так само, як і при
 * завантаженні збереженого розділу.
 */
export function markerSnippetToNodes(snippet: string): JSONContent[] {
  const doc = markerStringToTiptapDoc(snippet);
  return doc.content || [];
}

/**
 * Мапить зміщення символу в СТАРОМУ рядку-маркерах (напр. позиція, яку
 * AI-чат передав через pendingHighlight) у позицію ProseMirror у вже
 * побудованому документі редактора. Повторює ту саму логіку переходів
 * маркерів, що й serializeInline, — паралельно рахуючи довжину рядка й
 * позицію в документі. Повертає null, якщо offset виходить за межі.
 */
export function markerOffsetToDocPos(doc: PMNode, targetOffset: number): number | null {
  let acc = 0;
  let found: number | null = null;
  let prev: ActiveMarks = { bold: false, italic: false, fontStack: [], sizeStack: [] };

  /** Проходить інлайн-вміст одного абзаца (текст/hardBreak), рахуючи acc/found у лок-кроці з doc-позицією. */
  const walkInline = (para: PMNode, paraStart: number): boolean => {
    let stop = false;
    para.forEach((node, offsetInPara) => {
      if (stop) return;
      const pos = paraStart + offsetInPara;

      if (node.type.name === 'hardBreak') {
        acc += 1;
        return;
      }
      if (!node.isText) return;

      const text = node.text || '';
      const bold = !!node.marks.some((m) => m.type.name === 'bold');
      const italic = !!node.marks.some((m) => m.type.name === 'italic');
      const fontMark = node.marks.find((m) => m.type.name === 'fontSpan');
      const family = fontMark?.attrs?.family as string | undefined;
      const sizeMark = node.marks.find((m) => m.type.name === 'fontSize');
      const sizeStr = sizeMark?.attrs?.size != null ? String(sizeMark.attrs.size) : undefined;

      let prefix = '';
      if (prev.sizeStack.length && prev.sizeStack[prev.sizeStack.length - 1] !== sizeStr) prefix += '[/SIZE]';
      if (prev.fontStack.length && prev.fontStack[prev.fontStack.length - 1] !== family) prefix += '[/FONT]';
      if (prev.italic && !italic) prefix += '*';
      if (prev.bold && !bold) prefix += '**';
      if (bold && !prev.bold) prefix += '**';
      if (italic && !prev.italic) prefix += '*';
      if (family && prev.fontStack[prev.fontStack.length - 1] !== family) prefix += `[FONT="${family}"]`;
      if (sizeStr && prev.sizeStack[prev.sizeStack.length - 1] !== sizeStr) prefix += `[SIZE=${sizeStr}]`;
      prev = { bold, italic, fontStack: family ? [family] : [], sizeStack: sizeStr ? [sizeStr] : [] };

      acc += prefix.length;
      if (targetOffset <= acc + text.length) {
        const within = Math.max(0, targetOffset - acc);
        found = pos + within;
        stop = true;
        return;
      }
      acc += text.length;
    });
    return stop;
  };

  let isFirstBlock = true;
  doc.forEach((block, blockOffset) => {
    if (found !== null) return;
    if (!isFirstBlock) acc += 2; // "\n\n" між абзацами
    isFirstBlock = false;
    prev = { bold: false, italic: false, fontStack: [], sizeStack: [] };

    if (block.type.name === 'wrappedImage') {
      acc += imgMarkerString(block.attrs || {}).length;
      return;
    }

    if (block.type.name === 'blockquote') {
      const inner = block.child(0);
      acc += 2; // "> "
      walkInline(inner, blockOffset + 2);
      return;
    }

    if (block.type.name === 'aiDraft') {
      acc += AI_DRAFT_OPEN.length + 2; // "[AI-DRAFT]" + "\n\n"
      let isFirstInner = true;
      block.forEach((child, childOffset) => {
        if (found !== null) return;
        if (!isFirstInner) acc += 2; // "\n\n" між абзацами всередині блоку
        isFirstInner = false;
        prev = { bold: false, italic: false, fontStack: [], sizeStack: [] };
        walkInline(child, blockOffset + 2 + childOffset);
      });
      acc += 2 + AI_DRAFT_CLOSE.length; // "\n\n" + "[/AI-DRAFT]"
      return;
    }

    if (block.type.name === 'paragraph') {
      walkInline(block, blockOffset + 1);
    }
  });

  return found;
}

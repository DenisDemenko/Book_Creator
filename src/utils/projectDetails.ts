// КОПІЯ apps/web/src/lib/project-details.ts маркетплейсу (Fusion Lab): модератор у
// Студії має бачити опис проєкту тими самими розділами й списками, що й заявник
// на сторінці команди. Граматика однакова — змінюючи тут, змінюйте і там.
//
// A long project write-up is stored as plain text and rendered through this
// small, fixed grammar — no HTML, no markdown library, nothing a pasted text
// can use to inject markup (the renderer emits React text nodes only).
//
// Recognised, one construct per line:
//   "# Title" / "## Title" / "### Title"   a heading
//   "- item", "* item", "• item"           a bullet list item
//   "1. item", "2) item"                   a numbered list item
//   "1. Title" with no closing punctuation a numbered section heading
//   "Title" (short, no closing punctuation, followed by a bullet) a sub-heading
// Every other non-empty line is its own paragraph (a pasted plan keeps one
// idea per line); blank lines only separate blocks.

export type DetailsBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "subheading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] };

const BULLET = /^\s*[-*•]\s+(.+)$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(.+)$/;
const MARKDOWN_HEADING = /^(#{1,3})\s+(.+)$/;
// A line that ends like a sentence is prose (or a list item), not a title.
const SENTENCE_END = /[.;:!?…,]$/;
const MAX_TITLE_LENGTH = 90;
const MAX_SUBHEADING_LENGTH = 80;

export function parseProjectDetails(source: string): DetailsBlock[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd());
  const blocks: DetailsBlock[] = [];

  const nextNonEmpty = (from: number) => {
    for (let i = from; i < lines.length; i += 1) {
      if (lines[i].trim()) return lines[i];
    }
    return "";
  };

  const pushItem = (ordered: boolean, text: string) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === "list" && last.ordered === ordered) {
      last.items.push(text);
    } else {
      blocks.push({ type: "list", ordered, items: [text] });
    }
  };

  let blankSinceList = false;

  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line) {
      blankSinceList = true;
      return;
    }
    const wasBlank = blankSinceList;
    blankSinceList = false;

    const heading = MARKDOWN_HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length === 1 ? 2 : 3, text: heading[2].trim() });
      return;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      pushItem(false, bullet[1].trim());
      return;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      const text = numbered[2].trim();
      const last = blocks[blocks.length - 1];
      const insideNumberedList = last?.type === "list" && last.ordered && !wasBlank;
      // "3. Інноваційність проєкту" opens a section; "1. Створення комплексу."
      // is a list item. The closing punctuation is what tells them apart, and a
      // list that already started keeps its items together.
      if (!insideNumberedList && text.length <= MAX_TITLE_LENGTH && !SENTENCE_END.test(text)) {
        blocks.push({ type: "heading", level: 2, text: `${numbered[1]}. ${text}` });
      } else {
        pushItem(true, text);
      }
      return;
    }

    if (
      line.length <= MAX_SUBHEADING_LENGTH &&
      !SENTENCE_END.test(line) &&
      BULLET.test(nextNonEmpty(index + 1))
    ) {
      blocks.push({ type: "subheading", text: line });
      return;
    }

    blocks.push({ type: "paragraph", text: line });
  });

  return blocks;
}

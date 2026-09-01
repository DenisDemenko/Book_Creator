import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface ReadabilityHighlightOptions {
  /**
   * Читається заново при КОЖНІЙ транзакції, а не один раз при побудові
   * масиву розширень — той самий підхід, що й `enabled` у
   * FocusParagraphPlugin.ts (масив розширень редактора заморожений на
   * весь час сесії через `useRef([...])` в EditorView.tsx).
   */
  enabled: () => boolean;
  /** CSS-клас для підсвіченого задовгого речення — сама стилістика живе в index.css. */
  longSentenceClass: string;
  /** Поріг у словах, після якого речення вважається "задовгим". */
  longSentenceThreshold: number;
}

export const readabilityKey = new PluginKey('novaReadability');

/** Unicode-обізнаний підрахунок слів (кирилиця не покривається `\w`). */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}]+(?:['\u2019\-][\p{L}\p{N}]+)*/gu);
  return matches ? matches.length : 0;
}

/**
 * Для одного верхньорівневого блока (абзацу) будує паралельний до його
 * текстового вмісту масив АБСОЛЮТНИХ позицій документа — по одній позиції
 * на кожен символ. Це найпростіший спосіб коректно зіставити межі речення
 * (знайдені в звичайному рядку регуляркою) назад із позиціями ProseMirror,
 * не переплутавши інлайнові вузли на кшталт зображень чи розривів рядків
 * усередині абзацу. Абзац книги — не тисячі символів, тож цей масив
 * дешевий, той самий компроміс "простіше й дешевше за ще один цикл
 * вимірювання", що вже описаний у FocusParagraphPlugin.ts.
 */
function collectBlockText(node: PMNode, blockContentStart: number): { text: string; positions: number[] } {
  let text = '';
  const positions: number[] = [];
  node.descendants((child, offset) => {
    if (child.isText && child.text) {
      for (let i = 0; i < child.text.length; i += 1) {
        text += child.text[i];
        positions.push(blockContentStart + offset + i);
      }
    }
    return true;
  });
  return { text, positions };
}

/**
 * Знаходить у тексті абзацу діапазони [start, end) (у символах, межі
 * початкового пробілу після кінця попереднього речення обрізано) для
 * речень, що містять НЕ МЕНШЕ `minWords` слів. Останній "хвіст" абзацу
 * без завершального розділового знаку (курсор автора посеред речення)
 * теж перевіряється — інакше щойно написане надто довге речення
 * підсвітилось би лише після крапки в кінці.
 */
export function findLongSentenceRanges(text: string, minWords: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const terminator = /[.!?…]+["'»)\]]*/gu;
  let sentenceStart = 0;
  let match: RegExpExecArray | null;

  const pushIfLong = (start: number, end: number) => {
    let trimmedStart = start;
    while (trimmedStart < end && /\s/u.test(text[trimmedStart])) trimmedStart += 1;
    if (trimmedStart >= end) return;
    if (countWords(text.slice(trimmedStart, end)) >= minWords) {
      ranges.push([trimmedStart, end]);
    }
  };

  while ((match = terminator.exec(text))) {
    const sentenceEnd = match.index + match[0].length;
    pushIfLong(sentenceStart, sentenceEnd);
    sentenceStart = sentenceEnd;
  }
  if (sentenceStart < text.length) {
    pushIfLong(sentenceStart, text.length);
  }
  return ranges;
}

function buildDecorations(doc: PMNode, options: ReadabilityHighlightOptions): DecorationSet {
  if (!options.enabled()) return DecorationSet.empty;

  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    if (!node.isTextblock || node.textContent.trim().length === 0) return;
    const { text, positions } = collectBlockText(node, offset + 1);
    if (text.length === 0) return;
    for (const [start, end] of findLongSentenceRanges(text, options.longSentenceThreshold)) {
      const from = positions[start];
      const to = positions[end - 1] + 1;
      decorations.push(Decoration.inline(from, to, { class: options.longSentenceClass }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

/**
 * «Підсвітка читабельності» — Hemingway-стиль підказка: м'яко підсвічує
 * речення, довші за поріг слів, щоб автор помітив їх без ручного
 * підрахунку. Суто рекомендаційна декорація, нічого не змінює й не
 * забороняє — вимкнена за замовчуванням (`enabled()` → false), автор
 * вмикає сам, як і «курсор-фокус на абзаці».
 *
 * Перераховує декорації лише коли документ реально змінився
 * (`tr.docChanged`) або коли примусово попрошено через мету плагіна
 * (той самий підхід, що й у CharacterMentionPlugin.ts — перемикання
 * самого тогла не є транзакцією ProseMirror, тож EditorView.tsx
 * диспатчить no-op транзакцію з `setMeta(readabilityKey, true)` при
 * зміні стану тогла).
 */
export const ReadabilityHighlightPlugin = Extension.create<ReadabilityHighlightOptions>({
  name: 'novaReadability',

  addOptions() {
    return {
      enabled: () => false,
      longSentenceClass: 'nova-readability-long-sentence',
      longSentenceThreshold: 30,
    };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key: readabilityKey,
        state: {
          init: (_config, state) => buildDecorations(state.doc, options),
          apply: (tr, old) => {
            if (!tr.docChanged && !tr.getMeta(readabilityKey)) return old;
            return buildDecorations(tr.doc, options);
          },
        },
        props: {
          decorations(state) {
            return readabilityKey.getState(state);
          },
        },
      }),
    ];
  },
});

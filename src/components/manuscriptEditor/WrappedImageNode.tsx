import React, { useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { PX_PER_MM } from '../../utils/mmUnits';

export type ImageWrapMode = 'left' | 'right' | 'none' | 'contour';

const MIN_IMAGE_MM = 20;

export interface WrappedImageOptions {
  /** Розв'язує id зображення (звичайна ілюстрація / `char-<id>` / `cover-front`) в URL — та сама конвенція, що й renderImageMarkers у utils/helpers.ts. */
  resolveImageUrl: (id: string) => string | undefined;
  /** Ширина текстового блоку сторінки (мм) — межа масштабування й основа для дефолтної половини ширини при вставці. */
  getPageContentWidthMm: () => number;
  /**
   * Правий клік прямо по фото → «Проаналізувати фото і згенерувати AI
   * текст книги». `getPos` — жива функція поточної позиції вузла в
   * документі (EditorView.tsx вставляє згенерований текст одразу після
   * неї). Не задано — контекстне меню на фото просто не показується
   * (використовується лише в конфігурації, де ця можливість доречна).
   */
  onRequestAiText?: (imageId: string, x: number, y: number, getPos: () => number) => void;
  /** true, поки саме для цього imageId триває AI-генерація — показує оверлей-спінер на мініатюрі. */
  isGeneratingAiText?: (imageId: string) => boolean;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    wrappedImage: {
      insertWrappedImage: (attrs: { imageId: string; caption: string; wrap?: ImageWrapMode; widthMm?: number }) => ReturnType;
      setImageWrap: (wrap: ImageWrapMode) => ReturnType;
    };
  }
}

/**
 * CSS для ЗОВНІШНЬОГО елемента вузла — того самого `<figure>`, який
 * ProseMirror бачить як DOM цього блоку.
 *
 * Чому саме зовнішній, а не `NodeViewWrapper` всередині: Tiptap завжди
 * створює власний контейнер для React-вузла (`ReactRenderer.element` у
 * @tiptap/react), і саме він стає `dom` вузла в документі. Поки `float`
 * стояв на внутрішньому `<figure>`, він діяв ЛИШЕ в межах цього
 * контейнера — а контейнер лишався звичайним блоком на всю ширину
 * колонки. Через це сусідні абзаци (сусіди КОНТЕЙНЕРА, а не картинки)
 * не мали за що зачепитися й лягали під фото, а сам контейнер мав
 * `offsetHeight: 0`, бо в потоці всередині нього не лишалось нічого.
 * Звідси ж бралися й хибні розриви сторінок: пагінація рахувала
 * картинку як нуль міліметрів.
 *
 * Тому float, розміри й `shape-outside` живуть тут, на зовнішньому
 * елементі, а внутрішній wrapper відповідає лише за вигляд (рамка,
 * ручки, підпис, спінер).
 */
function outerFigureStyle(
  wrap: ImageWrapMode,
  widthMm: number,
  url: string | undefined,
  shape: string | null
): string {
  const size = `width:${widthMm}mm;max-width:100%;`;

  if (wrap === 'left' || wrap === 'right') {
    const margin = wrap === 'left' ? 'margin:0 16px 8px 0;' : 'margin:0 0 8px 16px;';
    return `float:${wrap};${margin}${size}`;
  }

  if (wrap === 'contour') {
    // Полігон, порахований з пікселів фото (utils/imageContour.ts), —
    // єдиний спосіб обтікання по контуру для JPG: у нього немає
    // альфа-каналу, а `shape-outside: url()` вирізає контур ВИКЛЮЧНО з
    // прозорості. Для PNG/SVG з прозорим тлом полігон не потрібен —
    // там альфа вже є, і браузер зробить точніше за будь-який наш скан.
    const shapeCss = shape
      ? `shape-outside:polygon(${shape});`
      : url
        ? `shape-outside:url(${url});shape-image-threshold:0.5;`
        : '';
    return `float:left;margin:0 16px 8px 0;${shapeCss}shape-margin:8px;${size}`;
  }

  // «По центру»: картинка окремим блоком, текст іде зверху й знизу.
  return `display:block;margin:12px auto;clear:both;${size}`;
}

type HandleId = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

/** Кутові кубики масштабують лише ширину (висота йде за природними пропорціями через height:auto). Бокові — незалежна вісь: ліво/право теж ширина, верх/низ — явна висота (з object-fit:cover, щоб не спотворювати). */
const CORNER_HANDLES: HandleId[] = ['nw', 'ne', 'sw', 'se'];
const HEIGHT_HANDLES: HandleId[] = ['n', 's'];

const HANDLE_POS: Record<HandleId, React.CSSProperties> = {
  nw: { top: -5, left: -5, cursor: 'nwse-resize' },
  n: { top: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  ne: { top: -5, right: -5, cursor: 'nesw-resize' },
  w: { top: '50%', left: -5, marginTop: -5, cursor: 'ew-resize' },
  e: { top: '50%', right: -5, marginTop: -5, cursor: 'ew-resize' },
  sw: { bottom: -5, left: -5, cursor: 'nesw-resize' },
  s: { bottom: -5, left: '50%', marginLeft: -5, cursor: 'ns-resize' },
  se: { bottom: -5, right: -5, cursor: 'nwse-resize' },
};

interface DragState {
  handle: HandleId;
  startClientX: number;
  startClientY: number;
  startWidthMm: number;
  startHeightMm: number;
}

const WrappedImageView: React.FC<ReactNodeViewProps> = ({ node, selected, extension, updateAttributes, getPos }) => {
  const { imageId, caption, widthMm, heightMm } = node.attrs as {
    imageId: string;
    caption: string;
    wrap: ImageWrapMode;
    widthMm: number | null;
    heightMm: number | null;
  };
  const resolveImageUrl = extension.options.resolveImageUrl as WrappedImageOptions['resolveImageUrl'];
  const getPageContentWidthMm = extension.options.getPageContentWidthMm as WrappedImageOptions['getPageContentWidthMm'];
  const onRequestAiText = extension.options.onRequestAiText as WrappedImageOptions['onRequestAiText'];
  const isGeneratingAiText = extension.options.isGeneratingAiText as WrappedImageOptions['isGeneratingAiText'];
  const url = resolveImageUrl(imageId);
  const generating = !!isGeneratingAiText?.(imageId);

  const imgRef = useRef<HTMLImageElement>(null);
  const [, setDrag] = useState<DragState | null>(null);

  const beginDrag = (handle: HandleId) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const currentWidthMm = widthMm ?? getPageContentWidthMm() / 2;
    const currentHeightMm = heightMm ?? (imgRef.current ? (imgRef.current.offsetHeight / PX_PER_MM) : currentWidthMm);
    const next: DragState = { handle, startClientX: e.clientX, startClientY: e.clientY, startWidthMm: currentWidthMm, startHeightMm: currentHeightMm };
    setDrag(next);

    const maxWidthMm = getPageContentWidthMm();

    const handleMove = (ev: PointerEvent) => {
      const dxMm = (ev.clientX - next.startClientX) / PX_PER_MM;
      const dyMm = (ev.clientY - next.startClientY) / PX_PER_MM;
      const attrs: Record<string, any> = {};

      if (CORNER_HANDLES.includes(handle) || handle === 'w' || handle === 'e') {
        // Ширина: для лівих ручок тягнення вліво збільшує ширину (дзеркально).
        const sign = handle === 'w' || handle === 'nw' || handle === 'sw' ? -1 : 1;
        attrs.widthMm = Math.min(maxWidthMm, Math.max(MIN_IMAGE_MM, next.startWidthMm + sign * dxMm));
      }
      if (HEIGHT_HANDLES.includes(handle)) {
        const sign = handle === 'n' ? -1 : 1;
        attrs.heightMm = Math.max(MIN_IMAGE_MM, next.startHeightMm + sign * dyMm);
      }
      updateAttributes(attrs);
    };
    const handleUp = () => {
      setDrag(null);
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <NodeViewWrapper
      as="div"
      style={{
        // Ширину й обтікання задає ЗОВНІШНІЙ <figure> (outerFigureStyle);
        // тут лишається тільки вигляд, інакше ширина задавалась би двічі,
        // а «кубики»-ручки міряли б не той елемент, що насправді плаває.
        display: 'block',
        width: '100%',
        position: 'relative',
        border: selected ? '2px solid #f59e0b' : '1px dashed rgba(148,163,184,0.4)',
        borderRadius: '6px',
        padding: '2px',
        boxSizing: 'border-box',
      }}
      onContextMenu={(e: React.MouseEvent) => {
        if (!onRequestAiText) return;
        e.preventDefault();
        e.stopPropagation();
        onRequestAiText(imageId, e.clientX, e.clientY, getPos);
      }}
    >
      {generating && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/60 backdrop-blur-[1px] rounded-[4px]"
          contentEditable={false}
        >
          <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      {url ? (
        <img
          ref={imgRef}
          src={url}
          alt={caption || ''}
          style={{
            width: '100%',
            height: heightMm ? `${heightMm}mm` : 'auto',
            objectFit: heightMm ? 'cover' : undefined,
            display: 'block',
            borderRadius: '4px',
          }}
          draggable={false}
        />
      ) : (
        <div className="p-3 text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/40 rounded">{imageId}</div>
      )}
      {caption && <figcaption className="text-[10px] text-slate-400 text-center mt-1 italic">{caption}</figcaption>}

      {selected &&
        (Object.keys(HANDLE_POS) as HandleId[]).map((h) => (
          <div
            key={h}
            onPointerDown={beginDrag(h)}
            className="absolute w-2.5 h-2.5 bg-amber-400 border border-amber-600 rounded-sm z-10"
            style={HANDLE_POS[h]}
          />
        ))}
    </NodeViewWrapper>
  );
};

/**
 * Блок-вузол вставленого в текст зображення з медіатеки книги (живий
 * аналог маркера `[IMG: id "підпис" wrap=режим width=Nmm height=Nmm]`,
 * який utils/manuscriptDoc.ts↔utils/helpers.ts вже вміють читати/писати).
 * Режим обтікання керується кнопками на панелі форматування; розмір —
 * кубиками-ручками навколо рамки, коли вузол виділено (кутові — пропорційно
 * за шириною, бокові — незалежна вісь).
 */
export const WrappedImageNode = Node.create<WrappedImageOptions>({
  name: 'wrappedImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { resolveImageUrl: () => undefined, getPageContentWidthMm: () => 150 };
  },

  addAttributes() {
    return {
      imageId: { default: null },
      caption: { default: '' },
      // Старі книги писали маркер без `wrap=` взагалі, і такі фото
      // відкривались блоком на всю ширину. Тепер типовий режим —
      // обтікання зліва (узгоджено з автором), тож дефолт вузла й
      // розбір маркера дають 'left'.
      wrap: { default: 'left' },
      widthMm: { default: null },
      heightMm: { default: null },
      /** Полігон обтікання по контуру у відсотках («x% y%, x% y%, …») — рахується з пікселів фото один раз і зберігається в маркері. */
      shape: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'figure[data-wrapped-image]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['figure', mergeAttributes(HTMLAttributes, { 'data-wrapped-image': '' })];
  },

  addNodeView() {
    const options = this.options;
    return ReactNodeViewRenderer(WrappedImageView, {
      // Зовнішній елемент вузла — саме той, що плаває (див. outerFigureStyle).
      as: 'figure',
      attrs: ({ node }) => {
        const wrap = (node.attrs.wrap || 'left') as ImageWrapMode;
        const widthMm = (node.attrs.widthMm as number | null) ?? options.getPageContentWidthMm() / 2;
        const url = options.resolveImageUrl(node.attrs.imageId as string);
        return {
          'data-wrapped-image': '',
          'data-wrap': wrap,
          style: outerFigureStyle(wrap, widthMm, url, node.attrs.shape as string | null),
        };
      },
    });
  },

  addCommands() {
    return {
      insertWrappedImage:
        (attrs) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { wrap: 'left', widthMm: null, heightMm: null, shape: null, ...attrs } })
            .run(),
      setImageWrap:
        (wrap) =>
        ({ state, chain }) => {
          const { selection } = state;
          const node = (selection as any).node;
          if (!node || node.type.name !== this.name) return false;
          return chain().updateAttributes(this.name, { wrap }).run();
        },
    };
  },
});

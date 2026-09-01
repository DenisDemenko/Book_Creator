import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Node, mergeAttributes } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { Ban, CheckCircle2 } from 'lucide-react';

export interface AiDraftBlockOptions {
  /** Текст мітки над блоком (напр. «✨ AI-чернетка»). */
  label: string;
  /** Текст пункту «прийняти» в контекстному меню блоку. */
  reviewLabel: string;
  /** Текст пункту «відхилити» — і підказка значка ⊘ на мітці. */
  rejectLabel: string;
}

const AiDraftBlockView: React.FC<ReactNodeViewProps> = ({ node, getPos, editor, extension }) => {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { label, reviewLabel, rejectLabel } = extension.options as AiDraftBlockOptions;

  // Закриває меню при кліку/Esc поза ним — той самий патерн, що й фоновий
  // контекстне меню EditorView.tsx.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', close);
    };
  }, [menu]);

  /** Знімає позначку «AI-чернетка» — «розгортає» контейнер, лишаючи самі абзаци звичайним текстом. */
  const markReviewed = () => {
    const pos = getPos();
    const fragment = Fragment.fromJSON(editor.schema, node.content.toJSON());
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.replaceWith(pos, pos + node.nodeSize, fragment);
        return true;
      })
      .run();
  };

  /**
   * Відхилення доповнення: прибирає блок РАЗОМ із текстом.
   *
   * Це протилежність `markReviewed`, і різниця принципова. «Прийняти»
   * лишає абзаци в книзі й лише знімає жовту позначку; «відхилити»
   * означає, що автор не погодився — тоді текст ШІ не має лишатись у
   * рукописі взагалі, інакше «відхилив» перетворилося б на «сховав
   * підсвітку», і згенероване непомітно поїхало б у експорт.
   *
   * Видалення проходить звичайною транзакцією редактора, тож Ctrl+Z
   * повертає блок — про це сказано в підказці значка. Модального
   * підтвердження свідомо немає: автор відхиляє чернетки часто, і
   * діалог на кожну зробив би роботу з ШІ важчою за неї саму.
   */
  const rejectDraft = () => {
    const pos = getPos();
    editor
      .chain()
      .focus()
      .command(({ tr, dispatch }) => {
        if (dispatch) tr.delete(pos, pos + node.nodeSize);
        return true;
      })
      .run();
  };

  return (
    <NodeViewWrapper
      as="div"
      data-ai-draft=""
      className="nova-ai-draft"
      onContextMenu={(e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      <div className="nova-ai-draft-label" contentEditable={false} suppressContentEditableWarning>
        <span>✨ {label}</span>
        {/*
          Значок ⊘ на самій мітці, а не пункт меню. Прийняти доповнення
          можна було й з контекстного меню, а відхилити — ніяк: автор
          бачив жовтий блок і не мав видимого способу сказати «ні».
          Значок навмисно малий і без підпису — він не має конкурувати
          з текстом, лише бути на видноті, коли погляд уже на мітці.
        */}
        <button
          type="button"
          className="nova-ai-draft-reject"
          title={`${rejectLabel} · Ctrl+Z поверне`}
          aria-label={rejectLabel}
          onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();
            rejectDraft();
          }}
        >
          <Ban size={13} aria-hidden="true" />
        </button>
      </div>
      <NodeViewContent />
      {menu &&
        createPortal(
          <div
            className="fixed z-[999] bg-slate-900 border border-amber-500/40 rounded-lg shadow-xl py-1 min-w-[240px]"
            style={{ left: menu.x, top: menu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-amber-500/10"
              onClick={() => {
                markReviewed();
                setMenu(null);
              }}
            >
              <CheckCircle2 size={14} className="text-amber-400 shrink-0" />
              {reviewLabel}
            </button>
            <button
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-slate-200 hover:bg-red-500/10"
              onClick={() => {
                rejectDraft();
                setMenu(null);
              }}
            >
              <Ban size={14} className="text-red-400 shrink-0" />
              {rejectLabel}
            </button>
          </div>,
          document.body
        )}
    </NodeViewWrapper>
  );
};

/**
 * Контейнер «AI-чернетка» — обгортає 1-3 абзаци, згенеровані AI за фото
 * (правий клік на зображенні → «Проаналізувати фото і згенерувати AI текст
 * книги»), і візуально позначає їх, доки письменник не позначить переглянутим
 * через власне контекстне меню блоку (правий клік по позначеному тексту).
 * Живий аналог маркера `[AI-DRAFT]…[/AI-DRAFT]` (utils/manuscriptDoc.ts).
 * Ніколи не потрапляє в експорт — utils/helpers.ts::renderSectionBlocksHtml
 * розгортає його в звичайні `<p>` без жодного сліду позначки.
 */
export const AiDraftBlockNode = Node.create<AiDraftBlockOptions>({
  name: 'aiDraft',
  group: 'block',
  content: 'paragraph+',
  defining: true,

  addOptions() {
    return { label: 'AI-чернетка', reviewLabel: '✓ Позначити переглянутим', rejectLabel: 'Відхилити доповнення ШІ' };
  },

  parseHTML() {
    return [{ tag: 'div[data-ai-draft]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ai-draft': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AiDraftBlockView);
  },
});

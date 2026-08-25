import React from 'react';
import { X } from 'lucide-react';

/**
 * Заякорений (docked) блок редактора тексту — той самий заголовок/тіло, що й
 * DraggablePanel.tsx, але БЕЗ position:fixed і без перетягування/зміни
 * розміру мишкою: розмір повністю визначається батьківським flex-потоком
 * (`flex-1 min-h-0`), так само як «Персонажі і сцена» праворуч. Заміна
 * DraggablePanel саме для головного блока введення тексту книги — щоб він
 * завжди займав весь доступний простір між сусідніми блоками (тулбар зверху,
 * низ екрана знизу), а не лишався маленьким довільно зміненим вікном.
 */
interface DockedEditorPanelProps {
  title: React.ReactNode;
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
  bodyClassName?: string;
  headerExtra?: React.ReactNode;
}

export const DockedEditorPanel: React.FC<DockedEditorPanelProps> = ({
  title,
  children,
  onClose,
  className = '',
  bodyClassName = 'overflow-auto',
  headerExtra,
}) => {
  return (
    <div className={`flex-1 min-h-0 flex flex-col bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl shadow-black/50 ${className}`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 shrink-0">
        <span className="flex-1 text-xs font-bold text-slate-200 truncate">{title}</span>
        {headerExtra && <div className="shrink-0 flex items-center gap-1.5">{headerExtra}</div>}
        {onClose && (
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white rounded-md" title="Закрити">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className={`flex-1 min-h-0 ${bodyClassName}`}>{children}</div>
    </div>
  );
};

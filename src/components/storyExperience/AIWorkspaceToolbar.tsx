import React, { useMemo, useState } from 'react';
import { Activity, Bot, MessageCircle, Sparkles, WandSparkles } from 'lucide-react';
import {
  AIProviderSelector,
  type AIProviderSelection,
  type AITaskKind,
} from './AIProviderSelector';

export interface AIWorkspaceAssignments {
  chat: AIProviderSelection;
  generate: AIProviderSelection;
  analyze: AIProviderSelection;
  evaluate: AIProviderSelection;
}

interface AIWorkspaceToolbarProps {
  value?: AIWorkspaceAssignments;
  onChange?: (next: AIWorkspaceAssignments) => void;
  compact?: boolean;
  contextLabel?: string;
  /** Реальний modelId книги з book.preferredAiModelId. */
  preferredModelId?: string;
}

/**
 * Порожній primary означає «Автоматично / модель книги / адмінська прив’язка».
 * Ми більше не зберігаємо вигадані provider-id на кшталт `openai` чи `anthropic`:
 * реальна Studio працює конкретними modelId з `/api/chat/models`.
 */
const emptySelection = (): AIProviderSelection => ({ primary: '', evaluator: null });

const taskMeta: Array<{ id: keyof AIWorkspaceAssignments; task: AITaskKind; label: string; icon: React.ReactNode }> = [
  { id: 'chat', task: 'chat', label: 'Діалог', icon: <MessageCircle className="h-3.5 w-3.5" /> },
  { id: 'generate', task: 'generate', label: 'Генерація', icon: <WandSparkles className="h-3.5 w-3.5" /> },
  { id: 'analyze', task: 'analyze', label: 'Аналіз', icon: <Activity className="h-3.5 w-3.5" /> },
  { id: 'evaluate', task: 'evaluate', label: 'Оцінка', icon: <Sparkles className="h-3.5 w-3.5" /> },
];

export const AIWorkspaceToolbar: React.FC<AIWorkspaceToolbarProps> = ({
  value,
  onChange,
  compact = false,
  contextLabel = 'AI для цього простору',
  preferredModelId,
}) => {
  const initial = useMemo<AIWorkspaceAssignments>(() => ({
    chat: { primary: preferredModelId || '', evaluator: null },
    generate: { primary: preferredModelId || '', evaluator: null },
    analyze: { primary: preferredModelId || '', evaluator: 'jev' },
    evaluate: { primary: preferredModelId || '', evaluator: 'jev' },
  }), [preferredModelId]);

  const [localValue, setLocalValue] = useState<AIWorkspaceAssignments>(value || initial);
  const [activeTask, setActiveTask] = useState<keyof AIWorkspaceAssignments>('chat');

  const assignments = value || localValue;

  const update = (task: keyof AIWorkspaceAssignments, selection: AIProviderSelection) => {
    const next = { ...assignments, [task]: selection };
    if (!value) setLocalValue(next);
    onChange?.(next);
  };

  const activeMeta = taskMeta.find((item) => item.id === activeTask)!;

  return (
    <section className={`border-b border-slate-800 bg-slate-950/95 text-slate-100 ${compact ? 'px-3 py-2' : 'px-4 py-3'}`} data-story-experience="ai-workspace-toolbar">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-cyan-500/20 bg-cyan-500/10 text-cyan-300">
            <Bot className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{contextLabel}</div>
            <div className="mt-0.5 truncate text-xs text-slate-300">Моделі беруться з реального каталогу Studio</div>
          </div>
        </div>

        <div className="flex gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1">
          {taskMeta.map((item) => {
            const modelId = assignments[item.id].primary;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTask(item.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-semibold transition ${
                  activeTask === item.id ? 'bg-slate-100 text-slate-950' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                title={`Поточна модель: ${modelId || 'Автоматично'}`}
              >
                {item.icon}{item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <AIProviderSelector
          task={activeMeta.task}
          value={assignments[activeTask]}
          onChange={(selection) => update(activeTask, selection)}
          compact
          showEvaluator={activeTask === 'analyze' || activeTask === 'evaluate'}
          preferredModelId={preferredModelId}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-600">
        <span>Діалог: <ModelName id={assignments.chat.primary} preferredModelId={preferredModelId} /></span>
        <span>Генерація: <ModelName id={assignments.generate.primary} preferredModelId={preferredModelId} /></span>
        <span>Аналіз: <ModelName id={assignments.analyze.primary} preferredModelId={preferredModelId} /></span>
        <span>Оцінка: <ModelName id={assignments.evaluate.primary} preferredModelId={preferredModelId} /></span>
        {assignments.analyze.evaluator === 'jev' && <span className="text-violet-400">Jev перевіряє аналітичний результат</span>}
      </div>
    </section>
  );
};

const ModelName: React.FC<{ id: string; preferredModelId?: string }> = ({ id, preferredModelId }) => (
  <strong className="font-semibold text-slate-400">
    {id || (preferredModelId ? `Модель книги · ${preferredModelId}` : 'Автоматично')}
  </strong>
);

export const defaultAIWorkspaceAssignments: AIWorkspaceAssignments = {
  chat: emptySelection(),
  generate: emptySelection(),
  analyze: { primary: '', evaluator: 'jev' },
  evaluate: { primary: '', evaluator: 'jev' },
};

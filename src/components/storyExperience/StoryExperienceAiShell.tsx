import React, { useState } from 'react';
import { AIWorkspaceToolbar, type AIWorkspaceAssignments, defaultAIWorkspaceAssignments } from './AIWorkspaceToolbar';

interface StoryExperienceAiShellProps {
  children: React.ReactNode;
  preferredModelId?: string;
  contextLabel?: string;
  compact?: boolean;
  value?: AIWorkspaceAssignments;
  onChange?: (next: AIWorkspaceAssignments) => void;
}

/**
 * Спільна UX-обгортка для Screenplay / Mafia / Constellation / Leela.
 *
 * Вона НЕ створює новий AI-backend і не дублює маршрутизацію. Селектор
 * всередині читає існуючий `/api/chat/models`, а `preferredModelId` приходить
 * із книги/проєкту. Технічний шар може використовувати обраний modelId у вже
 * наявних AI-роутах Studio.
 */
export const StoryExperienceAiShell: React.FC<StoryExperienceAiShellProps> = ({
  children,
  preferredModelId,
  contextLabel,
  compact = false,
  value,
  onChange,
}) => {
  const [localValue, setLocalValue] = useState<AIWorkspaceAssignments>(() => ({
    ...defaultAIWorkspaceAssignments,
    chat: { primary: preferredModelId || '', evaluator: null },
    generate: { primary: preferredModelId || '', evaluator: null },
    analyze: { primary: preferredModelId || '', evaluator: 'jev' },
    evaluate: { primary: preferredModelId || '', evaluator: 'jev' },
  }));

  const assignments = value || localValue;

  const handleChange = (next: AIWorkspaceAssignments) => {
    if (!value) setLocalValue(next);
    onChange?.(next);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-story-experience="ai-shell">
      <AIWorkspaceToolbar
        value={assignments}
        onChange={handleChange}
        preferredModelId={preferredModelId}
        contextLabel={contextLabel}
        compact={compact}
      />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </div>
  );
};

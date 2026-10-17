import React, { useState } from 'react';
import { BrainCircuit, Clapperboard, Drama, Gamepad2, Sparkles } from 'lucide-react';
import type { Book } from '../types';
import { ScenarioLegacyView } from './ScenarioLegacyView';
import {
  IntegratedConstellationView,
  IntegratedLeelaView,
  IntegratedMafiaView,
  IntegratedScreenplayView,
} from './storyExperience';

type StoryWorkspace = 'screenplay' | 'mafia' | 'constellation' | 'leela' | 'analysis';

interface ScenarioViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToSection: (chapterId: string, sectionId: string) => void;
  onSaveBook?: () => void;
}

const workspaces: Array<{
  id: StoryWorkspace;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  { id: 'screenplay', label: 'Screenplay', hint: 'Сцени, картки, сюжетні лінії', icon: <Clapperboard className="h-4 w-4" /> },
  { id: 'mafia', label: 'Mafia', hint: 'GM, події, тригери, голосування', icon: <Gamepad2 className="h-4 w-4" /> },
  { id: 'constellation', label: 'Constellation', hint: 'Поле, фігури, snapshots', icon: <Drama className="h-4 w-4" /> },
  { id: 'leela', label: 'Leela', hint: 'Board Pack, маршрут, журнал', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'analysis', label: 'Аналіз', hint: 'Попередній сценарний модуль', icon: <BrainCircuit className="h-4 w-4" /> },
];

/**
 * Реальний маршрут `scenario` тепер є входом у Story & Experience Engine.
 * Старий сценарний модуль не видалено: він доступний у вкладці «Аналіз».
 * Нові workspaces використовують живий каталог AI моделей Studio та готові
 * приймати результат існуючого Jev decision layer без дублювання backend.
 */
export const ScenarioView: React.FC<ScenarioViewProps> = ({
  book,
  onUpdateBook,
  onNavigateToSection,
  onSaveBook,
}) => {
  const [workspace, setWorkspace] = useState<StoryWorkspace>('screenplay');

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-950 text-slate-100" data-story-experience-hub>
      <header className="shrink-0 border-b border-slate-800 bg-slate-950/95 px-4 py-3 backdrop-blur lg:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-violet-300">Story & Experience Engine</div>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="truncate text-base font-bold text-white">{book.title}</h1>
              <span className="hidden text-[10px] text-slate-600 sm:inline">· один сюжет, різні режими роботи</span>
            </div>
          </div>

          <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1" aria-label="Story & Experience workspace">
            {workspaces.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setWorkspace(item.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition ${
                  workspace === item.id
                    ? 'bg-slate-100 text-slate-950 shadow-sm'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
                title={item.hint}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {workspace === 'screenplay' && (
          <IntegratedScreenplayView
            book={book}
            preferredModelId={book.preferredAiModelId}
            onNavigateToSection={onNavigateToSection}
          />
        )}

        {workspace === 'mafia' && (
          <IntegratedMafiaView
            projectTitle={book.title}
            preferredModelId={book.preferredAiModelId}
          />
        )}

        {workspace === 'constellation' && (
          <IntegratedConstellationView
            title={book.title}
            preferredModelId={book.preferredAiModelId}
          />
        )}

        {workspace === 'leela' && (
          <IntegratedLeelaView
            title={`${book.title} · Leela`}
            preferredModelId={book.preferredAiModelId}
          />
        )}

        {workspace === 'analysis' && (
          <ScenarioLegacyView
            book={book}
            onUpdateBook={onUpdateBook}
            onNavigateToSection={onNavigateToSection}
            onSaveBook={onSaveBook}
          />
        )}
      </div>
    </div>
  );
};

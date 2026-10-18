import React, { useMemo, useRef, useState } from 'react';
import { createSessionJournal, appendNeutralSessionEvent, type JournalSession } from './storyExperience/sessionJournalClient';
import { BrainCircuit, Clapperboard, Drama, Gamepad2, Sparkles } from 'lucide-react';
import type { Book, NavigationTab } from '../types';
import { generateSessionCharacterPortrait, attachSessionPortraits, type SessionPortraitAsset } from './storyExperience/sessionPortraitService';
import type { CharacterDraft } from './storyExperience/CharacterDraftEditor';
import { commitSessionToBook, type ReviewedSessionBookMaterial } from './storyExperience/sessionBookCommit';
import type { SessionBookExportRequest } from './storyExperience/SessionExportToBookView';
import { SessionHistoryView } from './storyExperience/SessionHistoryView';
import { ScenarioLegacyView } from './ScenarioLegacyView';
import {
  IntegratedConstellationView,
  IntegratedLeelaView,
  IntegratedMafiaView,
  IntegratedScreenplayView,
  type ScreenplaySelectedSceneContext,
  type StoryExperienceJevEvaluator,
  type StoryExperienceJevRequest,
} from './storyExperience';

type StoryWorkspace = 'screenplay' | 'mafia' | 'constellation' | 'leela' | 'history' | 'analysis';

interface ScenarioViewProps {
  book: Book;
  onUpdateBook: (updatedBook: Book, logAction?: string, logDetails?: string) => void;
  onNavigateToSection: (chapterId: string, sectionId: string) => void;
  onNavigateToTab?: (tab: NavigationTab) => void;
  onEvaluateWithJev?: StoryExperienceJevEvaluator;
  onSaveBook?: () => void;
  reviewedSessionMaterials?: Partial<Record<'mafia' | 'constellation' | 'leela', ReviewedSessionBookMaterial>>;
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
  { id: 'history', label: 'Історія сесій', hint: 'Завершені сесії → книга', icon: <Drama className="h-4 w-4" /> },
  { id: 'analysis', label: 'Аналіз', hint: 'Попередній сценарний модуль', icon: <BrainCircuit className="h-4 w-4" /> },
];

/**
 * Реальний маршрут `scenario` — вхід у Story & Experience Engine.
 * Старий сценарний модуль не видалено: він доступний у вкладці «Аналіз».
 * Jev підключається через один callback `onEvaluateWithJev`, без знання API URL
 * або дублювання adapter/key/fallback logic у фронтенді.
 */
export const ScenarioView: React.FC<ScenarioViewProps> = ({
  book,
  onUpdateBook,
  onNavigateToSection,
  onNavigateToTab,
  onEvaluateWithJev,
  onSaveBook,
  reviewedSessionMaterials,
}) => {
  const [workspace, setWorkspace] = useState<StoryWorkspace>('screenplay');
  const journals = useRef<Partial<Record<'leela'|'constellation', Promise<JournalSession>>>>({});
  const [journalError, setJournalError] = useState('');
  const [completedJournals, setCompletedJournals] = useState<Partial<Record<'leela' | 'constellation', JournalSession>>>({});
  const recordNeutralEvent = async (kind: 'leela'|'constellation', event: {kind:'snapshot'|'leela-move';label:string;description:string}) => {
    try {
      if (!journals.current[kind]) journals.current[kind] = createSessionJournal(book.id,kind);
      const session = await journals.current[kind]!;
      await appendNeutralSessionEvent(session,{...event,eventId:'event-'+crypto.randomUUID()});
      setJournalError('');
    } catch (error) {
      journals.current[kind] = undefined;
      setJournalError(error instanceof Error ? error.message : 'Подію не записано');
    }
  };
  const prepareJournal = async (kind: 'leela' | 'constellation') => {
    const pending = journals.current[kind];
    if (!pending) return;
    try {
      const journal = await pending;
      setCompletedJournals(previous => ({ ...previous, [kind]: journal }));
    } catch (error) {
      setJournalError(error instanceof Error ? error.message : 'Журнал недоступний');
      throw error;
    }
  };
  const [sessionPortraits, setSessionPortraits] = useState<SessionPortraitAsset[]>([]);
  const [selectedScene, setSelectedScene] = useState<ScreenplaySelectedSceneContext | null>(null);

  const onCommitSessionBook = (request: SessionBookExportRequest, material: ReviewedSessionBookMaterial) => {
    const result = commitSessionToBook(book, request, material);
    const ids = Object.fromEntries(request.mappings.filter(m => m.action === 'new').map((m, i) => [m.participantId, result.createdCharacterIds[i]]));
    result.book = attachSessionPortraits(result.book, ids, sessionPortraits);
    onUpdateBook(result.book, 'Імпорт художнього матеріалу із сесії', 'Додано главу та героїв за погодженим матеріалом сесії');
    onNavigateToSection(result.chapterId, result.sectionId);
  };
  const requestPortrait = async (draft: CharacterDraft) => {
    const asset = await generateSessionCharacterPortrait(book, draft);
    setSessionPortraits(previous => [...previous.filter(p => p.participantId !== asset.participantId), asset]);
    return asset;
  };
  const navigateToTab = (tab: NavigationTab) => {
    if (onNavigateToTab) {
      onNavigateToTab(tab);
      return;
    }

    // App already listens to this event and routes through its real
    // handleSelectTab/navigation guard. This keeps the author inside the SPA,
    // preserving unsaved UI state instead of forcing a full page reload.
    window.dispatchEvent(new CustomEvent('nova:open-tab', { detail: { tab } }));
  };

  const screenplayJevRequest = useMemo<StoryExperienceJevRequest | undefined>(() => {
    if (!selectedScene) return undefined;
    return {
      profile: 'screenplay_story_state',
      projectId: book.id,
      contextId: selectedScene.sceneId,
      state: {
        sceneId: selectedScene.sceneId,
        chapterId: selectedScene.chapterId,
        sectionId: selectedScene.sectionId,
        title: selectedScene.title,
        summary: selectedScene.summary,
        conflict: selectedScene.conflict,
        location: selectedScene.location,
        intensityScore: selectedScene.intensityScore,
        content: selectedScene.content,
      },
    };
  }, [book.id, selectedScene]);

  const mafiaJevRequest = useMemo<StoryExperienceJevRequest>(() => ({
    profile: 'mafia_gm_event',
    projectId: book.id,
    state: {
      projectTitle: book.title,
      mode: 'gm_dashboard',
      note: 'UI shell state only. TECH layer may enrich from authoritative session state.',
    },
  }), [book.id, book.title]);

  const constellationJevRequest = useMemo<StoryExperienceJevRequest>(() => ({
    profile: 'constellation_session_status',
    projectId: book.id,
    state: {
      projectTitle: book.title,
      mode: 'constellation_session',
      allowedScope: 'process_status_only',
    },
  }), [book.id, book.title]);

  const leelaJevRequest = useMemo<StoryExperienceJevRequest>(() => ({
    profile: 'leela_route_status',
    projectId: book.id,
    state: {
      projectTitle: book.title,
      mode: 'leela_session',
      allowedScope: 'route_and_session_status_only',
    },
  }), [book.id, book.title]);

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

          <nav className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 p-1" aria-label="Story & Experience workspace" role="tablist">
            {workspaces.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={workspace === item.id}
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
            jevRequest={screenplayJevRequest}
            onEvaluateWithJev={onEvaluateWithJev}
            onSelectedSceneChange={setSelectedScene}
            onNavigateToSection={onNavigateToSection}
            onOpenCharacters={() => navigateToTab('characters')}
            onOpenRelationships={() => navigateToTab('core-story-graph')}
            onOpenDiagnostics={() => navigateToTab('diagn')}
          />
        )}

        {workspace === 'mafia' && (
          <IntegratedMafiaView
            bookId={book.id}
            onRequestSessionPortrait={requestPortrait}
            portraitAssets={sessionPortraits}
            existingCharacters={book.characters.map((character) => ({ id: character.id, name: character.name }))}
            reviewedMaterial={reviewedSessionMaterials?.mafia}
            onCommitBookExport={onCommitSessionBook}
            projectTitle={book.title}
            preferredModelId={book.preferredAiModelId}
            jevRequest={mafiaJevRequest}
            onEvaluateWithJev={onEvaluateWithJev}
          />
        )}

        {workspace === 'constellation' && (
          <IntegratedConstellationView
            journal={completedJournals.constellation}
            onPrepareJournal={() => prepareJournal('constellation')}
            onConstellationSnapshot={snapshot => { void recordNeutralEvent('constellation',{kind:'snapshot',label:'Snapshot '+snapshot.index,description:'Збережено snapshot поля №'+snapshot.index}); }}
            onRequestSessionPortrait={requestPortrait}
            portraitAssets={sessionPortraits}
            existingCharacters={book.characters.map((character) => ({ id: character.id, name: character.name }))}
            reviewedMaterial={reviewedSessionMaterials?.constellation}
            onCommitBookExport={onCommitSessionBook}
            title={book.title}
            preferredModelId={book.preferredAiModelId}
            jevRequest={constellationJevRequest}
            onEvaluateWithJev={onEvaluateWithJev}
          />
        )}

        {workspace === 'leela' && (
          <IntegratedLeelaView
            journal={completedJournals.leela}
            onPrepareJournal={() => prepareJournal('leela')}
            onLeelaStep={step => { void recordNeutralEvent('leela',{kind:'leela-move',label:'Хід '+step.turn,description:'Перехід з клітини '+step.from+' до '+step.to+', кубик '+step.dice}); }}
            onRequestSessionPortrait={requestPortrait}
            portraitAssets={sessionPortraits}
            existingCharacters={book.characters.map((character) => ({ id: character.id, name: character.name }))}
            reviewedMaterial={reviewedSessionMaterials?.leela}
            onCommitBookExport={onCommitSessionBook}
            title={`${book.title} · Leela`}
            preferredModelId={book.preferredAiModelId}
            jevRequest={leelaJevRequest}
            onEvaluateWithJev={onEvaluateWithJev}
          />
        )}

        {journalError && <p role="alert" className="mx-4 rounded-lg border border-rose-700 p-3 text-xs text-rose-200">Журнал подій: {journalError}</p>}
        {workspace === 'history' && <SessionHistoryView bookId={book.id} existingCharacters={book.characters.map(character => ({ id: character.id, name: character.name }))} onCommitBookExport={onCommitSessionBook} onRequestPortrait={requestPortrait} portraitAssets={sessionPortraits} />}
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

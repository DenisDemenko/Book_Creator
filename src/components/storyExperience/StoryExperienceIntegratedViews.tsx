import React, { useState } from 'react';
import type { Book } from '../../types';
import { ScreenplayWorkspaceView } from './ScreenplayWorkspaceView';
import { MafiaGameMasterView } from './MafiaGameMasterView';
import { ConstellationSessionView } from './ConstellationSessionView';
import { LeelaSessionView } from './LeelaSessionView';
import { StoryExperienceAiShell } from './StoryExperienceAiShell';
import { ParticipantSessionPreview } from './ParticipantSessionPreview';
import type { JevReviewState, JevWorkflowOutcome } from './JevDecisionPanel';
import {
  StoryExperienceJevAction,
  type StoryExperienceJevEvaluator,
  type StoryExperienceJevRequest,
} from './StoryExperienceJevAction';
import type { AIWorkspaceAssignments } from './AIWorkspaceToolbar';

interface SharedIntegratedProps {
  preferredModelId?: string;
  aiAssignments?: AIWorkspaceAssignments;
  onAiAssignmentsChange?: (next: AIWorkspaceAssignments) => void;
  jevRequest?: StoryExperienceJevRequest;
  onEvaluateWithJev?: StoryExperienceJevEvaluator;
  jevOutcome?: JevWorkflowOutcome | null;
  jevFresh?: boolean;
  jevReview?: JevReviewState;
  onJevAcknowledge?: () => void;
  onOpenJevWorkflow?: () => void;
  onRequestJevReview?: () => void;
}

const JevSlot: React.FC<SharedIntegratedProps & { title: string; hint: string }> = ({
  title,
  hint,
  jevRequest,
  onEvaluateWithJev,
  jevOutcome,
  jevFresh,
  jevReview,
  onJevAcknowledge,
  onOpenJevWorkflow,
  onRequestJevReview,
}) => (
  <StoryExperienceJevAction
    title={title}
    hint={hint}
    request={jevRequest}
    onEvaluate={onEvaluateWithJev}
    outcome={jevOutcome}
    fresh={jevFresh}
    review={jevReview}
    onAcknowledge={onJevAcknowledge}
    onOpenWorkflow={onOpenJevWorkflow}
    onRequestReview={onRequestJevReview}
  />
);

const PreviewToggle: React.FC<{ active: boolean; label: string; onClick: () => void }> = ({ active, label, onClick }) => (
  <div className="flex justify-end border-b border-slate-800 bg-slate-950 px-4 py-2 lg:px-6">
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${active ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'}`}
    >
      {active ? 'Повернутися до робочого режиму' : label}
    </button>
  </div>
);

export interface IntegratedScreenplayViewProps extends SharedIntegratedProps {
  book: Book;
  onNavigateToSection?: (chapterId: string, sectionId: string) => void;
  onOpenCharacters?: () => void;
  onOpenRelationships?: () => void;
  onOpenDiagnostics?: () => void;
  onSelectedSceneChange?: (scene: {
    sceneId: string;
    chapterId: string;
    sectionId: string;
    title: string;
    summary: string;
    conflict: string;
    location: string;
    intensityScore: number;
    content: string;
  } | null) => void;
  className?: string;
}

export const IntegratedScreenplayView: React.FC<IntegratedScreenplayViewProps> = ({
  book,
  preferredModelId = book.preferredAiModelId,
  aiAssignments,
  onAiAssignmentsChange,
  jevRequest,
  onEvaluateWithJev,
  jevOutcome,
  jevFresh,
  jevReview,
  onJevAcknowledge,
  onOpenJevWorkflow,
  onRequestJevReview,
  ...workspaceProps
}) => (
  <StoryExperienceAiShell preferredModelId={preferredModelId} value={aiAssignments} onChange={onAiAssignmentsChange} contextLabel="AI · Screenplay Studio">
    <JevSlot title="Jev · оцінка сцени та драматургічного стану" hint="Оцінюється поточна сцена. Jev не змінює текст і не записує результат у канон без дії автора." jevRequest={jevRequest} onEvaluateWithJev={onEvaluateWithJev} jevOutcome={jevOutcome} jevFresh={jevFresh} jevReview={jevReview} onJevAcknowledge={onJevAcknowledge} onOpenJevWorkflow={onOpenJevWorkflow} onRequestJevReview={onRequestJevReview} />
    <ScreenplayWorkspaceView book={book} {...workspaceProps} />
  </StoryExperienceAiShell>
);

export interface IntegratedMafiaViewProps extends SharedIntegratedProps {
  projectTitle?: string;
}

export const IntegratedMafiaView: React.FC<IntegratedMafiaViewProps> = (props) => {
  const [preview, setPreview] = useState(false);
  const title = props.projectTitle || 'Mafia Story Studio';
  return (
    <StoryExperienceAiShell preferredModelId={props.preferredModelId} value={props.aiAssignments} onChange={props.onAiAssignmentsChange} contextLabel="AI · Mafia Story Studio">
      <JevSlot title="Jev · пріоритет події та увага ведучого" hint="Jev оцінює лише статус і пріоритет події для GM. Остаточне рішення залишається за ведучим." {...props} />
      <PreviewToggle active={preview} label="Переглянути як гравець" onClick={() => setPreview((value) => !value)} />
      {preview ? (
        <div className="flex flex-1 items-start justify-center overflow-y-auto bg-slate-950 p-4 lg:p-8">
          <ParticipantSessionPreview kind="mafia" title={title} phase="Investigation" elapsed="18:42" roleLabel="Архівіст" visibility="ROLE_BASED" primaryTitle="Зникло світло у східному крилі" primaryText="Світло згасло. Ви можете перевірити архівну кімнату або залишитися з групою." secondaryText="Доказ E-04 ще не відкритий для вашої ролі." actionLabel="Перевірити доступну дію" />
        </div>
      ) : <MafiaGameMasterView projectTitle={props.projectTitle} />}
    </StoryExperienceAiShell>
  );
};

export interface IntegratedConstellationViewProps extends SharedIntegratedProps { title?: string; }

export const IntegratedConstellationView: React.FC<IntegratedConstellationViewProps> = (props) => {
  const [preview, setPreview] = useState(false);
  return (
    <StoryExperienceAiShell preferredModelId={props.preferredModelId} value={props.aiAssignments} onChange={props.onAiAssignmentsChange} contextLabel="AI · Constellation Studio">
      <JevSlot title="Jev · процесний статус сесії" hint="Лише нейтральні процесні сигнали: етап, пауза, завершення, потреба уваги. Без психологічної чи медичної діагностики." {...props} />
      <PreviewToggle active={preview} label="Переглянути як учасник" onClick={() => setPreview((value) => !value)} />
      {preview ? (
        <div className="flex flex-1 items-start justify-center overflow-y-auto bg-slate-950 p-4 lg:p-8">
          <ParticipantSessionPreview kind="constellation" title={props.title || 'Constellation session'} phase="Розстановка" roleLabel="Представник" visibility="ROLE_BASED" primaryTitle="Залишайтеся у своїй позиції" primaryText="Спостерігайте за напрямком і дистанцією. Якщо потрібно, ви можете поставити сесію на паузу." secondaryText="Нотатки фасилітатора та дані інших учасників не показуються." exitLabel="Вийти з ролі" />
        </div>
      ) : <ConstellationSessionView title={props.title} />}
    </StoryExperienceAiShell>
  );
};

export interface IntegratedLeelaViewProps extends SharedIntegratedProps { title?: string; cellCount?: number; }

export const IntegratedLeelaView: React.FC<IntegratedLeelaViewProps> = (props) => {
  const [preview, setPreview] = useState(false);
  return (
    <StoryExperienceAiShell preferredModelId={props.preferredModelId} value={props.aiAssignments} onChange={props.onAiAssignmentsChange} contextLabel="AI · Leela Studio">
      <JevSlot title="Jev · процесний статус маршруту" hint="Оцінюється лише стан маршруту/сесії. Jev не дає об’єктивних духовних чи психологічних трактувань." {...props} />
      <PreviewToggle active={preview} label="Переглянути як учасник" onClick={() => setPreview((value) => !value)} />
      {preview ? (
        <div className="flex flex-1 items-start justify-center overflow-y-auto bg-slate-950 p-4 lg:p-8">
          <ParticipantSessionPreview kind="leela" title={props.title || 'Leela session'} phase="Хід 7" roleLabel="Учасник" visibility="PRIVATE" primaryTitle="Клітина 21 · Усвідомлення" primaryText="Що я продовжую робити за інерцією, хоча вже знаю інший шлях?" secondaryText="Ваша відповідь приватна. Ведучий бачить її лише якщо це дозволено правилами сесії." actionLabel="Записати рефлексію" />
        </div>
      ) : <LeelaSessionView title={props.title} cellCount={props.cellCount} />}
    </StoryExperienceAiShell>
  );
};

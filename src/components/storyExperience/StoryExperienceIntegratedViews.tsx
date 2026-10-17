import React from 'react';
import type { Book } from '../../types';
import { ScreenplayWorkspaceView } from './ScreenplayWorkspaceView';
import { MafiaGameMasterView } from './MafiaGameMasterView';
import { ConstellationSessionView } from './ConstellationSessionView';
import { LeelaSessionView } from './LeelaSessionView';
import { StoryExperienceAiShell } from './StoryExperienceAiShell';
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

/** Screenplay + реальний каталог моделей Studio + Jev evaluator. */
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
  <StoryExperienceAiShell
    preferredModelId={preferredModelId}
    value={aiAssignments}
    onChange={onAiAssignmentsChange}
    contextLabel="AI · Screenplay Studio"
  >
    <JevSlot
      title="Jev · оцінка сцени та драматургічного стану"
      hint="Оцінюється поточна сцена. Jev не змінює текст і не записує результат у канон без дії автора."
      jevRequest={jevRequest}
      onEvaluateWithJev={onEvaluateWithJev}
      jevOutcome={jevOutcome}
      jevFresh={jevFresh}
      jevReview={jevReview}
      onJevAcknowledge={onJevAcknowledge}
      onOpenJevWorkflow={onOpenJevWorkflow}
      onRequestJevReview={onRequestJevReview}
    />
    <ScreenplayWorkspaceView book={book} {...workspaceProps} />
  </StoryExperienceAiShell>
);

export interface IntegratedMafiaViewProps extends SharedIntegratedProps {
  projectTitle?: string;
}

/** Mafia GM + AI model selection + Jev event/severity/review signal. */
export const IntegratedMafiaView: React.FC<IntegratedMafiaViewProps> = ({
  projectTitle,
  preferredModelId,
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
}) => (
  <StoryExperienceAiShell
    preferredModelId={preferredModelId}
    value={aiAssignments}
    onChange={onAiAssignmentsChange}
    contextLabel="AI · Mafia Story Studio"
  >
    <JevSlot
      title="Jev · пріоритет події та увага ведучого"
      hint="Jev оцінює лише статус і пріоритет події для GM. Остаточне рішення залишається за ведучим."
      jevRequest={jevRequest}
      onEvaluateWithJev={onEvaluateWithJev}
      jevOutcome={jevOutcome}
      jevFresh={jevFresh}
      jevReview={jevReview}
      onJevAcknowledge={onJevAcknowledge}
      onOpenJevWorkflow={onOpenJevWorkflow}
      onRequestJevReview={onRequestJevReview}
    />
    <MafiaGameMasterView projectTitle={projectTitle} />
  </StoryExperienceAiShell>
);

export interface IntegratedConstellationViewProps extends SharedIntegratedProps {
  title?: string;
}

/**
 * Constellation: Jev показує лише процесні/статусні сигнали.
 * Психологічні/медичні висновки не є частиною цього UX-контракту.
 */
export const IntegratedConstellationView: React.FC<IntegratedConstellationViewProps> = ({
  title,
  preferredModelId,
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
}) => (
  <StoryExperienceAiShell
    preferredModelId={preferredModelId}
    value={aiAssignments}
    onChange={onAiAssignmentsChange}
    contextLabel="AI · Constellation Studio"
  >
    <JevSlot
      title="Jev · процесний статус сесії"
      hint="Лише нейтральні процесні сигнали: етап, пауза, завершення, потреба уваги. Без психологічної чи медичної діагностики."
      jevRequest={jevRequest}
      onEvaluateWithJev={onEvaluateWithJev}
      jevOutcome={jevOutcome}
      jevFresh={jevFresh}
      jevReview={jevReview}
      onJevAcknowledge={onJevAcknowledge}
      onOpenJevWorkflow={onOpenJevWorkflow}
      onRequestJevReview={onRequestJevReview}
    />
    <ConstellationSessionView title={title} />
  </StoryExperienceAiShell>
);

export interface IntegratedLeelaViewProps extends SharedIntegratedProps {
  title?: string;
  cellCount?: number;
}

/** Leela: Jev — лише нейтральний процесний evaluator, не психологічна діагностика. */
export const IntegratedLeelaView: React.FC<IntegratedLeelaViewProps> = ({
  title,
  cellCount,
  preferredModelId,
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
}) => (
  <StoryExperienceAiShell
    preferredModelId={preferredModelId}
    value={aiAssignments}
    onChange={onAiAssignmentsChange}
    contextLabel="AI · Leela Studio"
  >
    <JevSlot
      title="Jev · процесний статус маршруту"
      hint="Оцінюється лише стан маршруту/сесії. Jev не дає об’єктивних духовних чи психологічних трактувань."
      jevRequest={jevRequest}
      onEvaluateWithJev={onEvaluateWithJev}
      jevOutcome={jevOutcome}
      jevFresh={jevFresh}
      jevReview={jevReview}
      onJevAcknowledge={onJevAcknowledge}
      onOpenJevWorkflow={onOpenJevWorkflow}
      onRequestJevReview={onRequestJevReview}
    />
    <LeelaSessionView title={title} cellCount={cellCount} />
  </StoryExperienceAiShell>
);

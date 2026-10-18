import React, { useState } from 'react';
import type { JournalSession } from './sessionJournalClient';
import type { SessionEventCandidate } from './eligibleSessionEvents';
import type { CharacterDraft } from './CharacterDraftEditor';
import type { SessionPortraitAsset } from './sessionPortraitService';
import type { SessionBookExportRequest } from './SessionExportToBookView';
import type { ReviewedSessionBookMaterial } from './sessionBookCommit';
import type { Book } from '../../types';
import { ScreenplayWorkspaceView } from './ScreenplayWorkspaceView';
import { MafiaGameMasterView, type MafiaNeutralEvent } from './MafiaGameMasterView';
import { ConstellationSessionView } from './ConstellationSessionView';
import { ConstellationEventPlanner } from './ConstellationEventPlanner';
import { LeelaSessionView } from './LeelaSessionView';
import { StoryExperienceAiShell } from './StoryExperienceAiShell';
import { ParticipantSessionPreview, type ParticipantSessionKind } from './ParticipantSessionPreview';
import { SessionHeader, type SessionConnectionState, type SessionStatus } from './SessionHeader';
import { SessionLobbyView, type LobbyParticipant } from './SessionLobbyView';
import { CompletedSessionArchiveReview } from './CompletedSessionArchiveReview';
import { SessionCompletionView } from './SessionCompletionView';
import { SessionExportToBookView } from './SessionExportToBookView';
import type { VisibilityMode } from './VisibilityControl';
import type { JevReviewState, JevWorkflowOutcome } from './JevDecisionPanel';
import {
  StoryExperienceJevAction,
  type StoryExperienceJevEvaluator,
  type StoryExperienceJevRequest,
} from './StoryExperienceJevAction';
import type { AIWorkspaceAssignments } from './AIWorkspaceToolbar';

interface SharedIntegratedProps {
  onMafiaNeutralEvent?: (event: MafiaNeutralEvent) => void;
  journal?: JournalSession;
  onPrepareJournal?: () => Promise<void>;
  approvedSessionEvents?: SessionEventCandidate[];
  onConstellationSnapshot?: (event: { index: number; timestamp: string }) => void;
  onLeelaStep?: (event: { turn: number; from: number; to: number; dice: number }) => void;
  bookId?: string;
  onRequestSessionPortrait?: (draft: CharacterDraft) => Promise<SessionPortraitAsset>;
  portraitAssets?: SessionPortraitAsset[];
  existingCharacters?: { id: string; name: string }[];
  reviewedMaterial?: ReviewedSessionBookMaterial;
  onCommitBookExport?: (request: SessionBookExportRequest, material: ReviewedSessionBookMaterial) => void;
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

const JevSlot: React.FC<SharedIntegratedProps & { title: string; hint: string }> = ({ title, hint, jevRequest, onEvaluateWithJev, jevOutcome, jevFresh, jevReview, onJevAcknowledge, onOpenJevWorkflow, onRequestJevReview }) => (
  <StoryExperienceJevAction title={title} hint={hint} request={jevRequest} onEvaluate={onEvaluateWithJev} outcome={jevOutcome} fresh={jevFresh} review={jevReview} onAcknowledge={onJevAcknowledge} onOpenWorkflow={onOpenJevWorkflow} onRequestReview={onRequestJevReview} />
);

const PreviewToggle: React.FC<{
  active: boolean;
  label: string;
  connection?: SessionConnectionState;
  onClick: () => void;
  onConnectionChange?: (connection: SessionConnectionState) => void;
}> = ({ active, label, connection = 'online', onClick, onConnectionChange }) => (
  <div className="flex flex-col gap-2 border-b border-slate-800 bg-slate-950 px-4 py-2 sm:flex-row sm:items-center sm:justify-between lg:px-6">
    <div className="text-[10px] text-slate-600">Preview / QA — не авторитетний стан серверної сесії</div>
    <div className="flex flex-wrap items-center justify-end gap-2">
      {active && onConnectionChange && (
        <label className="inline-flex items-center gap-2 text-[10px] text-slate-500">
          <span>З’єднання</span>
          <select value={connection} onChange={(event) => onConnectionChange(event.target.value as SessionConnectionState)} className="rounded-lg border border-slate-800 bg-slate-900 px-2 py-1.5 text-[10px] text-slate-300 outline-none focus:border-cyan-500/50">
            <option value="online">Online</option>
            <option value="unstable">Unstable</option>
            <option value="reconnecting">Reconnecting</option>
            <option value="offline">Offline</option>
            <option value="restored">Restored</option>
          </select>
        </label>
      )}
      <button type="button" onClick={onClick} aria-pressed={active} className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${active ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100' : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'}`}>
        {active ? 'Повернутися до робочого режиму' : label}
      </button>
    </div>
  </div>
);

interface SessionControlProps {
  title: string;
  phase: string;
  status: SessionStatus;
  connection: SessionConnectionState;
  participants: number;
  onStatusChange: (status: SessionStatus) => void;
}

const SessionModeratorBar: React.FC<SessionControlProps> = ({ title, phase, status, connection, participants, onStatusChange }) => (
  <SessionHeader
    title={title}
    phase={phase}
    status={status}
    participants={participants}
    connection={connection}
    elapsed={status === 'lobby' || status === 'draft' ? '00:00' : '18:42'}
    onStart={() => onStatusChange('live')}
    onPause={() => onStatusChange('paused')}
    onResume={() => onStatusChange('live')}
    onEnd={() => onStatusChange('completed')}
  />
);

interface SessionPreviewFlowProps {
  kind: ParticipantSessionKind;
  title: string;
  phase: string;
  roleLabel: string;
  visibility: VisibilityMode;
  primaryTitle: string;
  primaryText: string;
  secondaryText?: string;
  actionLabel?: string;
  exitLabel?: string;
  status: SessionStatus;
  connection: SessionConnectionState;
  onStatusChange: (status: SessionStatus) => void;
  onConnectionChange: (connection: SessionConnectionState) => void;
}

const SessionPreviewFlow: React.FC<SessionPreviewFlowProps> = (props) => (
  <div className="flex flex-1 items-start justify-center overflow-y-auto bg-slate-950 p-4 lg:p-8">
    <ParticipantSessionPreview
      kind={props.kind}
      title={props.title}
      phase={props.phase}
      status={props.status}
      connection={props.connection}
      elapsed={props.status === 'lobby' || props.status === 'draft' ? '00:00' : '18:42'}
      roleLabel={props.roleLabel}
      visibility={props.visibility}
      primaryTitle={props.primaryTitle}
      primaryText={props.primaryText}
      secondaryText={props.secondaryText}
      actionLabel={props.actionLabel}
      exitLabel={props.exitLabel}
      pendingLocalActions={props.connection === 'offline' ? 1 : 0}
      onStart={() => props.onStatusChange('live')}
      onPause={() => props.onStatusChange('paused')}
      onResume={() => props.onStatusChange('live')}
      onExit={() => props.onStatusChange('completed')}
      onRetryConnection={() => props.onConnectionChange('reconnecting')}
      onDismissRestored={() => props.onConnectionChange('online')}
    />
  </div>
);

const mafiaLobbyParticipants: LobbyParticipant[] = [
  { id: 'gm', name: 'Game Master', role: 'Game Master', status: 'ready', required: true },
  { id: 'anna', name: 'Анна', role: 'Архівіст', status: 'ready', required: true },
  { id: 'taras', name: 'Тарас', role: 'Механік', status: 'not-ready', required: true },
  { id: 'iryna', name: 'Ірина', role: 'Свідок', status: 'invited' },
];

const constellationLobbyParticipants: LobbyParticipant[] = [
  { id: 'facilitator', name: 'Фасилітатор', role: 'Facilitator', status: 'ready', required: true },
  { id: 'client', name: 'Клієнт', role: 'Client', status: 'ready', required: true },
  { id: 'rep1', name: 'Представник 1', role: 'Representative', status: 'not-ready', required: true },
  { id: 'observer', name: 'Спостерігач', role: 'Observer', status: 'invited' },
];

const leelaLobbyParticipants: LobbyParticipant[] = [
  { id: 'host', name: 'Ведучий', role: 'Host', status: 'ready', required: true },
  { id: 'participant', name: 'Учасник', role: 'Participant', status: 'not-ready', required: true },
];

export interface IntegratedScreenplayViewProps extends SharedIntegratedProps {
  book: Book;
  onNavigateToSection?: (chapterId: string, sectionId: string) => void;
  onOpenCharacters?: () => void;
  onOpenRelationships?: () => void;
  onOpenDiagnostics?: () => void;
  onSelectedSceneChange?: (scene: { sceneId: string; chapterId: string; sectionId: string; title: string; summary: string; conflict: string; location: string; intensityScore: number; content: string; } | null) => void;
  className?: string;
}

export const IntegratedScreenplayView: React.FC<IntegratedScreenplayViewProps> = ({ book, preferredModelId = book.preferredAiModelId, aiAssignments, onAiAssignmentsChange, jevRequest, onEvaluateWithJev, jevOutcome, jevFresh, jevReview, onJevAcknowledge, onOpenJevWorkflow, onRequestJevReview, ...workspaceProps }) => (
  <StoryExperienceAiShell preferredModelId={preferredModelId} value={aiAssignments} onChange={onAiAssignmentsChange} contextLabel="AI · Screenplay Studio">
    <JevSlot title="Jev · оцінка сцени та драматургічного стану" hint="Оцінюється поточна сцена. Jev не змінює текст і не записує результат у канон без дії автора." jevRequest={jevRequest} onEvaluateWithJev={onEvaluateWithJev} jevOutcome={jevOutcome} jevFresh={jevFresh} jevReview={jevReview} onJevAcknowledge={onJevAcknowledge} onOpenJevWorkflow={onOpenJevWorkflow} onRequestJevReview={onRequestJevReview} />
    <ScreenplayWorkspaceView book={book} {...workspaceProps} />
  </StoryExperienceAiShell>
);

export interface IntegratedMafiaViewProps extends SharedIntegratedProps { projectTitle?: string; }
export const IntegratedMafiaView: React.FC<IntegratedMafiaViewProps> = (props) => {
  const [preview, setPreview] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [archiveReviewOpen, setArchiveReviewOpen] = useState(false);
  const [status, setStatus] = useState<SessionStatus>('lobby');
  const [connection, setConnection] = useState<SessionConnectionState>('online');
  const title = props.projectTitle || 'Mafia Story Studio';
  return (
    <StoryExperienceAiShell preferredModelId={props.preferredModelId} value={props.aiAssignments} onChange={props.onAiAssignmentsChange} contextLabel="AI · Mafia Story Studio">
      <JevSlot title="Jev · пріоритет події та увага ведучого" hint="Jev оцінює лише статус і пріоритет події для GM. Остаточне рішення залишається за ведучим." {...props} />
      <SessionModeratorBar title={title} phase={status === 'lobby' ? 'Lobby' : status === 'completed' ? 'Завершено' : 'Investigation'} status={status} connection={connection} participants={8} onStatusChange={setStatus} />
      <PreviewToggle active={preview} label="Переглянути як гравець" connection={connection} onConnectionChange={setConnection} onClick={() => setPreview((value) => !value)} />
      {archiveReviewOpen && props.bookId ? <CompletedSessionArchiveReview journal={props.journal} sourceEvents={props.approvedSessionEvents} bookId={props.bookId} kind="mafia" title={title} onClose={() => setArchiveReviewOpen(false)} /> : exportOpen ? (
        <SessionExportToBookView kind="mafia" sessionTitle={title} existingCharacters={props.existingCharacters} onRequestPortrait={props.onRequestSessionPortrait} portraitAssets={props.portraitAssets} onSubmit={props.reviewedMaterial && props.onCommitBookExport ? (request) => props.onCommitBookExport!(request, props.reviewedMaterial!) : undefined} participants={mafiaLobbyParticipants.filter((p) => p.role !== 'Game Master' && p.role !== 'Facilitator' && p.role !== 'Host').map((p, i) => ({ id: p.id, label: `Учасник ${i + 1}`, sessionRole: p.role }))} onClose={() => setExportOpen(false)} />
      ) : preview ? (
        <SessionPreviewFlow kind="mafia" title={title} phase={status === 'lobby' ? 'Lobby' : status === 'completed' ? 'Завершено' : 'Investigation'} roleLabel="Архівіст" visibility="ROLE_BASED" primaryTitle="Зникло світло у східному крилі" primaryText="Світло згасло. Ви можете перевірити архівну кімнату або залишитися з групою." secondaryText="Доказ E-04 ще не відкритий для вашої ролі." actionLabel="Перевірити доступну дію" status={status} connection={connection} onStatusChange={setStatus} onConnectionChange={setConnection} />
      ) : status === 'lobby' ? (
        <SessionLobbyView title={title} participants={mafiaLobbyParticipants} minReady={3} visibility="ROLE_BASED" joinCode="MAF-4821" onStart={() => setStatus('live')} />
      ) : status === 'completed' ? (
        <SessionCompletionView onExportToBook={() => setExportOpen(true)} onArchive={props.bookId ? () => { void Promise.resolve(props.onPrepareJournal?.()).then(() => setArchiveReviewOpen(true)).catch(() => setArchiveReviewOpen(false)); } : undefined} title={title} kindLabel="Mafia Story Session" participantCount={8} summaryItems={['Події та голосування завершено', 'Фінальний стан ролей зафіксовано', 'Participant view переведено у read-only completed state']} onReturnToProject={() => setStatus('lobby')} onCreateNextSession={() => { setPreview(false); setConnection('online'); setStatus('lobby'); }} />
      ) : <MafiaGameMasterView projectTitle={props.projectTitle} onNeutralEvent={props.onMafiaNeutralEvent} />}
    </StoryExperienceAiShell>
  );
};

export interface IntegratedConstellationViewProps extends SharedIntegratedProps { title?: string; }
export const IntegratedConstellationView: React.FC<IntegratedConstellationViewProps> = (props) => {
  const [preview, setPreview] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [archiveReviewOpen, setArchiveReviewOpen] = useState(false);
  const [status, setStatus] = useState<SessionStatus>('lobby');
  const [connection, setConnection] = useState<SessionConnectionState>('online');
  const title = props.title || 'Constellation session';
  const [showEventPlanner, setShowEventPlanner] = useState(false);
  return (
    <StoryExperienceAiShell preferredModelId={props.preferredModelId} value={props.aiAssignments} onChange={props.onAiAssignmentsChange} contextLabel="AI · Constellation Studio">
      <div className="px-4 py-3"><button type="button" onClick={() => setShowEventPlanner(value => !value)} className="rounded-xl border border-[#D9CABC] bg-[#FFFCF8] px-4 py-2 text-sm font-semibold text-[#2C1A12]">{showEventPlanner ? 'Приховати організацію події' : 'Організація події та заявки'}</button>{showEventPlanner && <div className="mt-3"><ConstellationEventPlanner bookId={props.bookId} /></div>}</div>
      <JevSlot title="Jev · процесний статус сесії" hint="Лише нейтральні процесні сигнали: етап, пауза, завершення, потреба уваги. Без психологічної чи медичної діагностики." {...props} />
      <SessionModeratorBar title={title} phase={status === 'lobby' ? 'Lobby' : status === 'completed' ? 'Завершено' : 'Розстановка'} status={status} connection={connection} participants={4} onStatusChange={setStatus} />
      <PreviewToggle active={preview} label="Переглянути як учасник" connection={connection} onConnectionChange={setConnection} onClick={() => setPreview((value) => !value)} />
      {archiveReviewOpen && props.bookId ? <CompletedSessionArchiveReview journal={props.journal} bookId={props.bookId} kind="constellation" title={title} onClose={() => setArchiveReviewOpen(false)} /> : exportOpen ? (
        <SessionExportToBookView kind="constellation" sessionTitle={title} participants={constellationLobbyParticipants.filter((p) => p.role !== 'Game Master' && p.role !== 'Facilitator' && p.role !== 'Host').map((p, i) => ({ id: p.id, label: `Учасник ${i + 1}`, sessionRole: p.role }))} onClose={() => setExportOpen(false)} />
      ) : preview ? (
        <SessionPreviewFlow kind="constellation" title={title} phase={status === 'lobby' ? 'Lobby' : status === 'completed' ? 'Завершено' : 'Розстановка'} roleLabel="Представник" visibility="ROLE_BASED" primaryTitle="Залишайтеся у своїй позиції" primaryText="Спостерігайте за напрямком і дистанцією. Якщо потрібно, ви можете поставити сесію на паузу." secondaryText="Нотатки фасилітатора та дані інших учасників не показуються." exitLabel="Вийти з ролі" status={status} connection={connection} onStatusChange={setStatus} onConnectionChange={setConnection} />
      ) : status === 'lobby' ? (
        <SessionLobbyView title={title} participants={constellationLobbyParticipants} minReady={3} visibility="ROLE_BASED" joinCode="CON-7314" onStart={() => setStatus('live')} />
      ) : status === 'completed' ? (
        <SessionCompletionView onExportToBook={() => setExportOpen(true)} onArchive={props.bookId ? () => { void Promise.resolve(props.onPrepareJournal?.()).then(() => setArchiveReviewOpen(true)).catch(() => setArchiveReviewOpen(false)); } : undefined} title={title} kindLabel="Constellation Session" participantCount={4} participantExitLabel="Після етапу «Вихід з ролей» учасники бачать лише завершення сесії та безпечну дію виходу." summaryItems={['Етап «Вихід з ролей» завершено', 'Розстановка та snapshots готові до архівації', 'Participant payload закритий для подальших змін']} onReturnToProject={() => setStatus('lobby')} onCreateNextSession={() => { setPreview(false); setConnection('online'); setStatus('lobby'); }} />
      ) : <ConstellationSessionView title={props.title} onSnapshot={props.onConstellationSnapshot} />}
    </StoryExperienceAiShell>
  );
};

export interface IntegratedLeelaViewProps extends SharedIntegratedProps { title?: string; cellCount?: number; }
export const IntegratedLeelaView: React.FC<IntegratedLeelaViewProps> = (props) => {
  const [preview, setPreview] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [archiveReviewOpen, setArchiveReviewOpen] = useState(false);
  const [status, setStatus] = useState<SessionStatus>('lobby');
  const [connection, setConnection] = useState<SessionConnectionState>('online');
  const title = props.title || 'Leela session';
  return (
    <StoryExperienceAiShell preferredModelId={props.preferredModelId} value={props.aiAssignments} onChange={props.onAiAssignmentsChange} contextLabel="AI · Leela Studio">
      <JevSlot title="Jev · процесний статус маршруту" hint="Оцінюється лише стан маршруту/сесії. Jev не дає об’єктивних духовних чи психологічних трактувань." {...props} />
      <SessionModeratorBar title={title} phase={status === 'lobby' ? 'Lobby' : status === 'completed' ? 'Завершено' : 'Хід 7'} status={status} connection={connection} participants={1} onStatusChange={setStatus} />
      <PreviewToggle active={preview} label="Переглянути як учасник" connection={connection} onConnectionChange={setConnection} onClick={() => setPreview((value) => !value)} />
      {archiveReviewOpen && props.bookId ? <CompletedSessionArchiveReview journal={props.journal} bookId={props.bookId} kind="leela" title={title} onClose={() => setArchiveReviewOpen(false)} /> : exportOpen ? (
        <SessionExportToBookView kind="leela" sessionTitle={title} participants={leelaLobbyParticipants.filter((p) => p.role !== 'Game Master' && p.role !== 'Facilitator' && p.role !== 'Host').map((p, i) => ({ id: p.id, label: `Учасник ${i + 1}`, sessionRole: p.role }))} onClose={() => setExportOpen(false)} />
      ) : preview ? (
        <SessionPreviewFlow kind="leela" title={title} phase={status === 'lobby' ? 'Lobby' : status === 'completed' ? 'Завершено' : 'Хід 7'} roleLabel="Учасник" visibility="PRIVATE" primaryTitle="Клітина 21 · Усвідомлення" primaryText="Що я продовжую робити за інерцією, хоча вже знаю інший шлях?" secondaryText="Ваша відповідь приватна. Ведучий бачить її лише якщо це дозволено правилами сесії." actionLabel="Записати рефлексію" status={status} connection={connection} onStatusChange={setStatus} onConnectionChange={setConnection} />
      ) : status === 'lobby' ? (
        <SessionLobbyView title={title} participants={leelaLobbyParticipants} minReady={2} visibility="PRIVATE" joinCode="LEELA-21" onStart={() => setStatus('live')} />
      ) : status === 'completed' ? (
        <SessionCompletionView onExportToBook={() => setExportOpen(true)} onArchive={props.bookId ? () => { void Promise.resolve(props.onPrepareJournal?.()).then(() => setArchiveReviewOpen(true)).catch(() => setArchiveReviewOpen(false)); } : undefined} title={title} kindLabel="Leela Journey Session" participantCount={1} summaryItems={['Маршрут завершено на поточній клітині', 'Приватні рефлексії залишаються у визначеній visibility policy', 'Історія ходів готова до snapshot/archive']} onReturnToProject={() => setStatus('lobby')} onCreateNextSession={() => { setPreview(false); setConnection('online'); setStatus('lobby'); }} />
      ) : <LeelaSessionView title={props.title} cellCount={props.cellCount} onJourneyStep={props.onLeelaStep} />}
    </StoryExperienceAiShell>
  );
};

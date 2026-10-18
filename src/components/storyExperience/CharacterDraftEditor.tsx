import React from 'react';
import type { ExportCharacterMapping, AnonymizationMode, ExportParticipant } from './SessionExportToBookView';

export interface CharacterDraft {
  participantId: string;
  fictionalName: string;
  sessionRole: string;
  bookRole: string;
  archetype: string;
  goal: string;
  conflict: string;
  portraitStyle: PortraitStyle;
  portraitPrompt: string;
}
export type PortraitStyle = 'illustration' | 'cinematic' | 'graphic-novel' | 'silhouette' | 'fantasy';
export interface CharacterDraftEditorProps {
  drafts: CharacterDraft[];
  privacy: AnonymizationMode;
  onChange: (drafts: CharacterDraft[]) => void;
  onRequestPortrait?: (draft: CharacterDraft) => void;
  onChooseFromLibrary?: (draft: CharacterDraft) => void;
}
const styles: { value: PortraitStyle; label: string }[] = [
  { value: 'illustration', label: 'Книжкова ілюстрація' },
  { value: 'cinematic', label: 'Кінематографічний' },
  { value: 'graphic-novel', label: 'Графічний роман' },
  { value: 'silhouette', label: 'Анонімний силует' },
  { value: 'fantasy', label: 'Фантастичний образ' },
];
export const createCharacterDrafts = (participants: ExportParticipant[], mappings: ExportCharacterMapping[]): CharacterDraft[] =>
  mappings.filter((mapping) => mapping.action !== 'skip').map((mapping) => {
    const participant = participants.find((p) => p.id === mapping.participantId);
    return {
      participantId: mapping.participantId,
      fictionalName: mapping.fictionalName,
      sessionRole: participant?.sessionRole || 'Учасник',
      bookRole: '',
      archetype: '',
      goal: '',
      conflict: '',
      portraitStyle: 'illustration' as const,
      portraitPrompt: '',
    };
  });
export const CharacterDraftEditor: React.FC<CharacterDraftEditorProps> = ({
  drafts, onChange, onRequestPortrait, onChooseFromLibrary, privacy,
}) => {
  const update = (id: string, patch: Partial<CharacterDraft>) =>
    onChange(drafts.map((draft) => draft.participantId === id ? { ...draft, ...patch } : draft));
  return <section className="space-y-4" aria-label="Попередній перегляд карток героїв">
    <header><h2 className="text-lg font-semibold text-white">Картки майбутніх героїв</h2><p className="mt-1 text-xs text-slate-400">Це чернетки для автора. Картки ще не створено в загальній бібліотеці героїв.</p></header>
    {drafts.length === 0 && <p className="rounded-xl border border-slate-700 p-4 text-sm text-slate-300">Учасників для перетворення на героїв не вибрано. Можна продовжити текстовий експорт.</p>}
    {drafts.map((draft) => <article key={draft.participantId} className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
      <div className="mb-3 flex items-center gap-3"><div aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-lg text-slate-500">✦</div><div><h3 className="font-semibold text-white">{draft.fictionalName}</h3><p className="text-xs text-slate-400">Художній герой · {privacy === 'none' ? 'режим без анонімізації' : 'анонімізований образ'}</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        {([{ field: 'bookRole', label: 'Роль у книзі', placeholder: 'Наприклад, головний герой' },
          { field: 'archetype', label: 'Архетип', placeholder: 'Наприклад, дослідник' },
          { field: 'goal', label: 'Мета', placeholder: 'Чого прагне герой?' },
          { field: 'conflict', label: 'Конфлікт', placeholder: 'Що стоїть на заваді?' }] as const).map((item) => (
          <label key={item.field} className="text-xs text-slate-400">{item.label}
            <input value={draft[item.field]} onChange={(event) => update(draft.participantId, { [item.field]: event.target.value })}
              placeholder={item.placeholder} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white" />
          </label>))}
      </div>
      <div className="mt-4 border-t border-slate-800 pt-4">
        <h4 className="text-sm font-semibold text-white">Образ героя для Медіатеки</h4>
        <p className="my-2 text-xs text-slate-400">Використовується опис вигаданого персонажа, без реальних фотографій та зовнішніх прикмет учасника.</p>
        <label className="block text-xs text-slate-400">Художній стиль
          <select value={draft.portraitStyle} onChange={(event) => update(draft.participantId, { portraitStyle: event.target.value as PortraitStyle })}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white">
            {styles.map((style) => <option key={style.value} value={style.value}>{style.label}</option>)}
          </select>
        </label>
        <label className="mt-3 block text-xs text-slate-400">Опис вигаданого образу
          <textarea rows={3} value={draft.portraitPrompt} onChange={(event) => update(draft.participantId, { portraitPrompt: event.target.value })}
            placeholder="Вигаданий персонаж, одяг, настрій, композиція..." className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-sm text-white" />
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={!onRequestPortrait} onClick={() => onRequestPortrait?.(draft)}
            className="rounded-lg border border-cyan-500/50 px-3 py-2 text-xs text-cyan-100 disabled:cursor-not-allowed disabled:opacity-40">Згенерувати портрет</button>
          <button type="button" disabled={!onChooseFromLibrary} onClick={() => onChooseFromLibrary?.(draft)}
            className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-300 disabled:cursor-not-allowed disabled:opacity-40">Вибрати з Медіатеки</button>
        </div>
        {!onRequestPortrait && !onChooseFromLibrary && <p className="mt-2 text-xs text-slate-500">Генерація та вибір медіафайлів стануть доступними після підключення відповідних дій.</p>}
      </div>
    </article>)}
  </section>;
};

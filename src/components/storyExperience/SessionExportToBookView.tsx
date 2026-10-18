import React, { useMemo, useState } from 'react';
import type { SessionPortraitAsset } from './sessionPortraitService';
import { CharacterDraftEditor, createCharacterDrafts, type CharacterDraft } from './CharacterDraftEditor';

export type SessionExportKind = 'mafia' | 'constellation' | 'leela';
export type AnonymizationMode = 'fiction' | 'moderate' | 'names' | 'none';
export type CharacterMappingAction = 'new' | 'existing' | 'skip' | 'merge' | 'split';
export interface ExportParticipant { id: string; label: string; sessionRole: string; fictionalName?: string; }
export interface ExportCharacterMapping { participantId: string; action: CharacterMappingAction; fictionalName: string; existingCharacterId?: string; }
export interface SessionBookExportRequest {
  sessionKind: SessionExportKind;
  sessionTitle: string;
  source: 'summary' | 'eligible-events' | 'approved-snapshots';
  formats: string[];
  privacy: AnonymizationMode;
  mappings: ExportCharacterMapping[];
  originalAppearance: false;
  characterDrafts: CharacterDraft[];
}
export interface SessionExportToBookViewProps {
  kind: SessionExportKind;
  sessionTitle: string;
  participants: ExportParticipant[];
  existingCharacters?: { id: string; name: string }[];
  onClose: () => void;
  onSubmit?: (request: SessionBookExportRequest) => Promise<void> | void;
  onRequestPortrait?: (draft: CharacterDraft) => Promise<SessionPortraitAsset>;
  portraitAssets?: SessionPortraitAsset[];
  onChooseFromLibrary?: (draft: CharacterDraft) => void;
}
const formats = [
  ['chapter', 'Глава'], ['scene', 'Сцена'], ['scenes', 'Серія сцен'],
  ['story', 'Розповідь'], ['fiction', 'Художня адаптація'],
  ['outline', 'План книги'], ['notes', 'Нотатки автора'],
] as const;
const steps = ['Джерело', 'Формат', 'Приватність', 'Герої', 'Образи', 'Перевірка'];
const aliases = ['Оріана', 'Мирослав', 'Лада', 'Ренат', 'Ярина', 'Артемій', 'Елія', 'Марко'];
const modeLabels: Record<AnonymizationMode, string> = {
  fiction: 'Художня адаптація', moderate: 'Помірна анонімізація', names: 'Заміна імен', none: 'Без анонімізації',
};
export const SessionAnonymizationPanel: React.FC<{ value: AnonymizationMode; onChange: (mode: AnonymizationMode) => void }> = ({ value, onChange }) => (
  <fieldset className="space-y-3">
    <legend className="mb-3 text-lg font-semibold text-white">Як захистити учасників?</legend>
    {(Object.keys(modeLabels) as AnonymizationMode[]).map((mode) => (
      <label key={mode} className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3">
        <input type="radio" name="anonymization" value={mode} checked={value === mode} onChange={() => onChange(mode)} />
        <span className="text-sm text-slate-200">{modeLabels[mode]}</span>
      </label>
    ))}
    <div role="note" className="rounded-xl border border-amber-600/40 p-3 text-sm text-amber-100">
      Заміна імен не гарантує анонімності. Перевірте впізнавані події, репліки та деталі перед використанням у книзі.
    </div>
    <p className="text-xs text-slate-400">Приватні записи, приховані ролі та чутливі дані не входять до доступного для експорту матеріалу за замовчуванням.</p>
  </fieldset>
);
export const ParticipantToCharacterMapper: React.FC<{
  participants: ExportParticipant[];
  mappings: ExportCharacterMapping[];
  onChange: (value: ExportCharacterMapping[]) => void;
  existingCharacters?: { id: string; name: string }[];
  privacy: AnonymizationMode;
}> = ({ participants, mappings, onChange, existingCharacters = [], privacy }) => {
  const update = (id: string, patch: Partial<ExportCharacterMapping>) =>
    onChange(mappings.map((item) => item.participantId === id ? { ...item, ...patch } : item));
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white">Учасники → герої книги</h2>
      <p className="text-xs text-slate-400">Імена та призначення можна змінити вручну. Зв’язок із реальними особами не показується у книжковій картці.</p>
      {participants.map((participant) => {
        const item = mappings.find((m) => m.participantId === participant.id);
        if (!item) return null;
        return <div key={participant.id} className="grid gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3 md:grid-cols-3">
          <div className="text-sm text-slate-300"><strong className="block text-slate-100">{participant.label}</strong>{participant.sessionRole}</div>
          <label className="text-xs text-slate-400">Ім’я героя
            <input aria-label={`Вигадане ім’я: ${participant.label}`} value={item.fictionalName} onChange={(e) => update(participant.id, { fictionalName: e.target.value })}
              disabled={item.action === 'skip'} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-white disabled:opacity-50" />
          </label>
          <div>
            <label className="text-xs text-slate-400">Використання
              <select value={item.action} onChange={(e) => update(participant.id, { action: e.target.value as CharacterMappingAction })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-white">
                <option value="new">Новий герой</option><option value="existing">Існуючий герой</option>
                <option value="skip">Не переносити</option><option value="merge">Об’єднати</option><option value="split">Розділити образ</option>
              </select>
            </label>
            {item.action === 'existing' && <select aria-label="Існуючий герой" value={item.existingCharacterId || ''} onChange={(e) => update(participant.id, { existingCharacterId: e.target.value })}
              className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-white">
              <option value="">Виберіть героя</option>{existingCharacters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
            </select>}
          </div>
        </div>;
      })}
      {privacy !== 'none' && <button type="button" className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200"
        onClick={() => onChange(mappings.map((m, i) => ({ ...m, fictionalName: aliases[(i + 3) % aliases.length] })))}>
        Запропонувати інші вигадані імена (приклад)
      </button>}
    </section>
  );
};

export const SessionExportToBookView: React.FC<SessionExportToBookViewProps> = ({
  kind, sessionTitle, participants, existingCharacters = [], onClose, onSubmit, onRequestPortrait, portraitAssets = [], onChooseFromLibrary,
}) => {
  const [step, setStep] = useState(0);
  const [source, setSource] = useState<SessionBookExportRequest['source']>('summary');
  const [selectedFormats, setSelectedFormats] = useState<string[]>(['chapter']);
  const [privacy, setPrivacy] = useState<AnonymizationMode>('fiction');
  const [mappings, setMappings] = useState<ExportCharacterMapping[]>(() => participants.map((p, i) => ({
    participantId: p.id, action: 'new', fictionalName: p.fictionalName || aliases[i % aliases.length],
  })));
  const [drafts, setDrafts] = useState<CharacterDraft[]>(() => createCharacterDrafts(participants, participants.map((p, i) => ({ participantId: p.id, action: 'new', fictionalName: p.fictionalName || aliases[i % aliases.length] }))));
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [portraitError, setPortraitError] = useState('');
  const [portraitBusy, setPortraitBusy] = useState(false);
  const invalidMapping = mappings.some((m) => m.action !== 'skip' && (!m.fictionalName.trim() || (m.action === 'existing' && !m.existingCharacterId)));
  const canNext = (step !== 1 || selectedFormats.length > 0) && (step !== 3 || !invalidMapping);
  const synchronizedDrafts = useMemo(() => mappings.filter((m) => m.action !== 'skip').map((mapping) => ({ ...(drafts.find((d) => d.participantId === mapping.participantId) || createCharacterDrafts(participants, [mapping])[0]), fictionalName: mapping.fictionalName })), [drafts, mappings, participants]);
  const request = useMemo<SessionBookExportRequest>(() => ({
    sessionKind: kind, sessionTitle, source, formats: selectedFormats, privacy, mappings: mappings.filter((m) => m.action !== 'skip'), originalAppearance: false, characterDrafts: synchronizedDrafts,
  }), [kind, sessionTitle, source, selectedFormats, privacy, mappings, synchronizedDrafts]);
  const submit = async () => {
    if (!onSubmit || saving || !confirmed || invalidMapping) return;
    setError(''); setSaving(true);
    try { await onSubmit(request); setSubmitted(true); }
    catch { setError('Не вдалося створити матеріал. Налаштування збережені на цьому екрані; повторіть дію.'); }
    finally { setSaving(false); }
  };
  return <section className="min-h-0 flex-1 overflow-y-auto bg-slate-950 p-4 text-slate-100 lg:p-6" data-story-experience="session-export-book">
    <div className="mx-auto max-w-4xl">
      <header className="mb-5 flex items-start justify-between gap-4">
        <div><div className="text-xs uppercase tracking-widest text-cyan-300">Сесія → книга</div><h1 className="mt-1 text-2xl font-bold">Перетворити досвід на історію</h1><p className="mt-1 text-sm text-slate-400">{sessionTitle}</p></div>
        <button type="button" onClick={onClose} className="rounded-lg border border-slate-700 p-2 text-xs">Закрити</button>
      </header>
      <nav aria-label="Етапи експорту" className="mb-6 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {steps.map((label, i) => <button key={label} type="button" disabled={i > step} aria-current={i === step ? 'step' : undefined}
          onClick={() => { setStep(i); setConfirmed(false); }} className={`rounded-xl border p-2 text-xs disabled:opacity-40 ${step === i ? 'border-cyan-400 text-white' : 'border-slate-700 text-slate-400'}`}>
          {i + 1}. {label}</button>)}
      </nav>
      <div className="min-h-64 space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-4">
        {step === 0 && <fieldset className="space-y-3"><legend className="text-lg font-semibold">Що використати із сесії?</legend>
          {([['summary', 'Лише дозволений підсумок'], ['eligible-events', 'Дозволені події'], ['approved-snapshots', 'Дозволені snapshots']] as const).map(([value, label]) =>
            <label key={value} className="flex gap-3 rounded-xl border border-slate-700 p-3 text-sm"><input type="radio" checked={source === value} onChange={() => setSource(value)} />{label}</label>)}
          <p className="text-xs text-slate-400">Доступність джерел визначає сервер; тут показаний UX-приклад.</p>
        </fieldset>}
        {step === 1 && <fieldset className="space-y-3"><legend className="text-lg font-semibold">У що перетворити матеріал?</legend>
          <div className="grid gap-3 sm:grid-cols-2">{formats.map(([value, label]) => <label key={value} className="flex gap-3 rounded-xl border border-slate-700 p-3 text-sm">
            <input type="checkbox" checked={selectedFormats.includes(value)} onChange={(e) => setSelectedFormats((old) => e.target.checked ? [...old, value] : old.filter((v) => v !== value))} />{label}
          </label>)}</div></fieldset>}
        {step === 2 && <SessionAnonymizationPanel value={privacy} onChange={(value) => { setPrivacy(value); setConfirmed(false); }} />}
        {step === 3 && <ParticipantToCharacterMapper participants={participants} mappings={mappings} onChange={setMappings} existingCharacters={existingCharacters} privacy={privacy} />}
        {step === 4 && <CharacterDraftEditor drafts={synchronizedDrafts} privacy={privacy} onChange={setDrafts} onRequestPortrait={onRequestPortrait ? async draft => { setPortraitError(''); setPortraitBusy(true); try { await onRequestPortrait(draft); } catch (error) { setPortraitError(error instanceof Error ? error.message : 'Не вдалося створити портрет'); } finally { setPortraitBusy(false); } } : undefined} onChooseFromLibrary={onChooseFromLibrary} />}
        {step === 4 && <div role="status" className="text-xs text-slate-400">{portraitBusy ? 'Генерація портрета…' : 'Згенеровано портретів: ' + portraitAssets.length}{portraitError && <p role="alert" className="text-rose-300">{portraitError}</p>}{portraitAssets.map(asset => <img key={asset.participantId} className="mr-2 mt-2 inline-block h-20 w-20 rounded-lg object-cover" src={asset.imageUrl} alt="Згенерований художній портрет" />)}</div>}
        {step === 5 && <div className="space-y-3"><h2 className="text-lg font-semibold">Перевірка перед створенням</h2>
          <dl className="grid gap-2 text-sm text-slate-300 sm:grid-cols-2"><div>Джерело: {source}</div><div>Приватність: {modeLabels[privacy]}</div>
          <div>Форматів: {selectedFormats.length}</div><div>Героїв: {mappings.filter((m) => m.action !== 'skip').length}</div></dl>
          <div className="rounded-xl border border-amber-500/30 p-3 text-sm text-amber-100" role="alert">Перевірте непрямі ознаки особистості. Вигадані імена не усувають ризик впізнавання.</div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Я переглянув доступний матеріал і маю право його використовувати.</label>
          {!onSubmit && <p className="text-xs text-slate-400">Підключення до «Книга & Текст», «Героїв» і Медіатеки очікує реалізації технічного шару.</p>}
          {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
          {submitted && <p role="status" className="text-sm text-emerald-300">Запит на створення виконано. Перевірте результат у розділі книги.</p>}
        </div>}
      </div>
      <footer className="mt-4 flex flex-wrap justify-between gap-2">
        <button type="button" onClick={() => step === 0 ? onClose() : setStep(step - 1)} className="rounded-xl border border-slate-700 px-4 py-2 text-sm">Назад</button>
        {step < 5 ? <button type="button" disabled={!canNext} onClick={() => setStep(step + 1)}
          className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">Продовжити</button>
          : <button type="button" disabled={!confirmed || !onSubmit || saving || submitted} onClick={submit}
            className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">
            {saving ? 'Створення…' : 'Створити матеріал книги'}</button>}
      </footer>
    </div>
  </section>;
};

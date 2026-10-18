import React, { useCallback, useEffect, useState } from 'react';
import type { ReviewedSessionBookMaterial } from './sessionBookCommit';
import { SessionExportToBookView, type SessionExportKind, type SessionBookExportRequest } from './SessionExportToBookView';
import type { CharacterDraft } from './CharacterDraftEditor';
import type { SessionPortraitAsset } from './sessionPortraitService';

interface ArchivedSession {
  id: string;
  bookId: string;
  kind: SessionExportKind;
  title: string;
  completedAt: string;
  status: 'completed';
  eventCount: number;
  participantCount: number;
}
export interface SessionHistoryViewProps {
  bookId: string;
  existingCharacters: { id: string; name: string }[];
  onCommitBookExport: (request: SessionBookExportRequest, material: ReviewedSessionBookMaterial) => void;
  onRequestPortrait?: (draft: CharacterDraft) => Promise<SessionPortraitAsset>;
  portraitAssets?: SessionPortraitAsset[];
}
export const SessionHistoryView: React.FC<SessionHistoryViewProps> = ({ bookId, existingCharacters, onCommitBookExport, onRequestPortrait, portraitAssets }) => {
  const [records, setRecords] = useState<ArchivedSession[]>([]);
  const [selected, setSelected] = useState<ArchivedSession | null>(null);
  const [material, setMaterial] = useState<ReviewedSessionBookMaterial | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/story-experience/completed?bookId=' + encodeURIComponent(bookId), { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Не вдалося прочитати архів завершених сесій.');
      const data = await response.json();
      setRecords(Array.isArray(data.sessions) ? data.sessions : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Помилка архіву'); }
    finally { setLoading(false); }
  }, [bookId]);
  useEffect(() => { void load(); }, [load]);
  const open = async (session: ArchivedSession) => {
    setError(''); setOpening(true);
    try {
      const response = await fetch('/api/story-experience/completed/' + encodeURIComponent(session.id) + '/book-material?bookId=' + encodeURIComponent(bookId), { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Для цієї сесії немає підтвердженого матеріалу для книги.');
      const data = await response.json();
      if (data.exportAllowed !== true || data.sessionId !== session.id || typeof data.approvedText !== 'string' || !data.approvedText.trim()) throw new Error('Матеріал не підтверджено.');
      setMaterial(data); setSelected(session);
    } catch (e) { setError(e instanceof Error ? e.message : 'Помилка завантаження'); }
    finally { setOpening(false); }
  };
  if (selected && material) return <SessionExportToBookView key={selected.id} kind={selected.kind} sessionTitle={selected.title}
    participants={[]} existingCharacters={existingCharacters} onClose={() => { setSelected(null); setMaterial(null); }}
    onSubmit={request => onCommitBookExport(request, material)} onRequestPortrait={onRequestPortrait} portraitAssets={portraitAssets} />;
  const filtered = records.filter(record => (record.title + ' ' + record.kind).toLowerCase().includes(query.toLowerCase()));
  return <section className="min-h-0 flex-1 overflow-y-auto bg-[#F4ECE1] p-4 text-[#2C1A12] lg:p-6" aria-label="Історія завершених сесій">
    <header className="mb-5"><p className="text-xs uppercase tracking-wider text-[#92633C]">Story & Experience</p><h2 className="text-2xl font-semibold">Історія сесій</h2><p className="mt-2 text-sm text-[#71645A]">Тільки збережені завершені сесії поточної книги. Приватні записи не показуються в архіві.</p></header>
    <div className="mb-5 flex flex-wrap gap-3"><input aria-label="Пошук сесій" placeholder="Пошук за назвою…" value={query} onChange={event => setQuery(event.target.value)} className="min-w-48 flex-1 rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] px-3 py-2 text-sm" /><button type="button" onClick={() => void load()} disabled={loading} className="rounded-2xl border border-[#E0D4C7] px-4 py-2 text-sm disabled:opacity-50">Оновити</button></div>
    {error && <p role="alert" className="mb-4 rounded-2xl border border-[#D49A8B] p-3 text-sm text-[#A63A2B]">{error}</p>}
    {loading ? <p role="status" className="text-sm text-[#71645A]">Завантаження архіву…</p> : filtered.length === 0 ? <p className="rounded-2xl border border-[#E0D4C7] p-5 text-sm text-[#584940]">{records.length ? 'Немає сесій за вашим запитом.' : 'У цій книзі немає збережених завершених сесій.'}</p> :
      <div className="grid gap-3 lg:grid-cols-2">{filtered.map(record => <article key={record.id} className="rounded-2xl border border-[#E0D4C7] bg-[#FFFCF8] p-4"><p className="text-xs uppercase text-[#92633C]">{record.kind}</p><h3 className="mt-1 text-lg font-semibold">{record.title}</h3><p className="mt-2 text-xs text-[#71645A]">{new Date(record.completedAt).toLocaleDateString('uk-UA')} · Дозволених подій: {record.eventCount}</p><button type="button" disabled={opening} onClick={() => void open(record)} className="mt-4 rounded-xl bg-[#2E1B12] px-4 py-2 text-sm font-semibold text-[#FFF9F1] disabled:opacity-50">Використати у книзі</button></article>)}</div>}
  </section>;
};

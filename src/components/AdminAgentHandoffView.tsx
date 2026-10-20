import React, { useEffect, useState } from 'react';
import { HandoffGitPanel } from './HandoffGitPanel';
import { HANDOFF_FIELDS, HANDOFF_REPOSITORIES, type HandoffDraft, type HandoffEntry } from '../types/agentHandoff';

const blank = (): HandoffDraft => Object.fromEntries([
  ...HANDOFF_FIELDS.map(([key]) => [key, '']), ['repository', HANDOFF_REPOSITORIES[0]],
]) as HandoffDraft;
const fieldClass = 'w-full rounded-lg border border-slate-500/40 bg-transparent p-2 text-sm';
async function request(url: string, body?: unknown) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store',
    ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function AcceptForm({ entry, onAccepted }: { entry: HandoffEntry; onAccepted: (row: HandoffEntry) => void }) {
  const [agent, setAgent] = useState('');
  const [session, setSession] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <form className="mt-3 space-y-2 border-t border-slate-500/30 pt-3" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    try { const data = await request(`/api/admin/agent-handoffs/${entry.id}/accept`, { agent, session, notes }); onAccepted(data.entry); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }}>
    <label className="block text-sm">Агент, що приймає<input className={fieldClass} required maxLength={300} value={agent} onChange={e => setAgent(e.target.value)} /></label>
    <label className="block text-sm">Нова сесія<input className={fieldClass} required maxLength={300} value={session} onChange={e => setSession(e.target.value)} /></label>
    <label className="block text-sm">Що звірено: гілка, SHA, контекст; розбіжності<textarea className={fieldClass} required maxLength={12000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
    {error ? <p role="alert">{error}</p> : null}
    <button className="rounded-lg border border-slate-500/40 px-3 py-2 text-sm disabled:opacity-50" disabled={busy}>{busy ? 'Зберігаємо…' : 'Підтвердити приймання'}</button>
  </form>;
}
export const AdminAgentHandoffView: React.FC = () => {
  const [entries, setEntries] = useState<HandoffEntry[]>([]);
  const [draft, setDraft] = useState(blank);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    request('/api/admin/agent-handoffs').then(data => {
      if (active) { setEntries(data.entries); setTotal(data.total); }
    }).catch(err => { if (active) setError((err as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const visible = entries.filter(entry => !filter || entry.repository === filter);
  return <section className="space-y-4">
    <h2 className="text-lg font-semibold">Журнал прийому та передачі між агентами й сесіями</h2>
    <p className="text-sm text-slate-400">Записи зберігаються в базі Студії. Приймання підтверджує ознайомлення з контекстом; push та деплой потрібно перевіряти окремо. Вказані гілка й SHA — дані автора запису, а не автоматична перевірка GitHub.</p>
    <p className="text-sm text-slate-400">Локальна й хмарна Студії можуть мати різні бази. Для передавання між середовищами використовуйте спільний сервер журналу та зберігайте важливий контекст також у репозиторії. Не додавайте ключів і паролів.</p>
    <HandoffGitPanel onProof={(repository, branch, head, evidence) => {
      setDraft(previous => ({ ...previous, repository: repository as HandoffDraft['repository'], branch, commit: head,
        evidence: [previous.evidence, evidence].filter(Boolean).join('\n') }));
      setMessage('Доказ push додано до форми. Заповніть решту полів і збережіть передачу.');
    }} />
    <details className="rounded-xl border border-slate-500/30 p-3">
      <summary className="cursor-pointer font-semibold">Передати роботу — новий запис</summary>
      <form className="mt-3 space-y-3" onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError(''); setMessage('');
        try {
          const data = await request('/api/admin/agent-handoffs', draft);
          setEntries(previous => [data.entry, ...previous].slice(0, 500)); setTotal(n => n + 1);
          setDraft(blank()); setMessage('Передачу збережено на сервері. Очікує приймання.');
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}>
        <label className="block text-sm">Репозиторій<select className={fieldClass} value={draft.repository} onChange={e => setDraft({ ...draft, repository: e.target.value as HandoffDraft['repository'] })}>
          {HANDOFF_REPOSITORIES.map(repo => <option key={repo} value={repo}>{repo}</option>)}
        </select></label>
        {HANDOFF_FIELDS.map(([key, label]) => <label key={key} className="block text-sm">{label}{key === 'commit' || key === 'done' ? ' (необов’язково)' : ' *'}
          <textarea className={fieldClass} rows={key === 'done' || key === 'remaining' || key === 'checks' ? 3 : 2}
            required={key !== 'commit' && key !== 'done'} maxLength={12000} value={draft[key]}
            onChange={e => setDraft({ ...draft, [key]: e.target.value })} />
        </label>)}
        <button className="rounded-lg border border-slate-500/40 px-3 py-2 disabled:opacity-50" disabled={busy}>{busy ? 'Зберігаємо…' : 'Зберегти передачу'}</button>
        <p className="text-xs text-slate-400">Незбережений текст форми втратиться при закритті сторінки. Підтвердження з’являється лише після відповіді сервера.</p>
      </form>
    </details>
    {error ? <p role="alert" className="text-rose-400">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className="flex flex-wrap gap-3">
      <label className="text-sm">Фільтр репозиторію<select className={fieldClass} value={filter} onChange={e => setFilter(e.target.value)}>
        <option value="">Усі</option>{HANDOFF_REPOSITORIES.map(repo => <option key={repo}>{repo}</option>)}
      </select></label>
      <button className="rounded-lg border border-slate-500/40 px-3 py-2 text-sm disabled:opacity-50" disabled={loading || busy} onClick={() => setRefresh(n => n + 1)}>Оновити</button>
    </div>
    <p className="text-xs text-slate-400">На сервері: {total}. Завантажено останніх: {entries.length}. Після фільтру: {visible.length}.</p>
    {loading ? <p role="status">Читаємо журнал…</p> : null}
    {!loading && !error && !visible.length ? <p>Записів поки немає.</p> : null}
    {visible.map(entry => <article key={entry.id} className="rounded-xl border border-slate-500/30 p-4 space-y-2">
      <h3 className="font-semibold">{entry.task}</h3>
      <p className="text-sm">{entry.acceptedAt ? 'Прийнято' : 'Очікує приймання'} · {new Date(entry.createdAt).toLocaleString('uk-UA', { timeZone: 'Europe/Uzhgorod' })}</p>
      <p className="text-xs break-all">{entry.repository} · ID: {entry.id} · Обліковий запис автора: {entry.recordedBy}</p>
      <dl className="space-y-2">{HANDOFF_FIELDS.map(([key, label]) => <div key={key}><dt className="text-xs text-slate-400">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{entry[key] || 'Не вказано'}</dd></div>)}</dl>
      {entry.acceptedAt ? <div className="border-t border-slate-500/30 pt-2 text-sm whitespace-pre-wrap">
        Прийняв: {entry.receivingAgent} · сесія {entry.receivingSession}<br />
        {new Date(entry.acceptedAt).toLocaleString('uk-UA', { timeZone: 'Europe/Uzhgorod' })} · обліковий запис: {entry.acceptedBy}<br />{entry.acceptanceNotes}
      </div> : <details><summary className="cursor-pointer text-sm font-semibold">Прийняти роботу в новій сесії</summary>
        <AcceptForm entry={entry} onAccepted={updated => setEntries(previous => previous.map(row => row.id === updated.id ? updated : row))} />
      </details>}
    </article>)}
  </section>;
};

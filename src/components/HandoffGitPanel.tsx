import React, { useEffect, useState } from 'react';
interface GitState { directory: string; computer: string; repository: string; branch: string; head: string; status: string; staged: string; stagedHash: string; }
interface Device { id: string; name: string; last_seen: string | null; expires_at: string; revoked_at: string | null; state: GitState | null; }
interface Job { id: string; device_id: string; action: string; status: string; created_at: string; result: { output?: string; verifiedPush?: boolean; checkedAt?: string; pushedHead?: string; pushedBranch?: string; pushedRepository?: string; state?: GitState } | null; }
const labels: Record<string,string> = { pending:'У черзі', running:'Виконується', succeeded:'Виконано', failed:'Помилка', unknown:'Результат невідомий', expired:'Не було виконано вчасно', cancelled:'Скасовано до запуску' };
const button = 'rounded-lg border border-slate-500/40 px-3 py-2 text-sm disabled:opacity-40';
const input = 'w-full rounded-lg border border-slate-500/40 bg-transparent p-2 text-sm';
async function api(url: string, body?: unknown) {
  const response = await fetch(url, { credentials:'same-origin', cache:'no-store',
    ...(body === undefined ? {} : { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status);
  return data;
}
export function HandoffGitPanel({ onProof }: { onProof: (repository: string, branch: string, head: string, evidence: string) => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('Мій комп’ютер');
  const [pair, setPair] = useState<{token:string;expiresAt:string} | null>(null);
  const [path, setPath] = useState('');
  const [message, setMessage] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const data = await api('/api/admin/agent-companion');
        if (active) { setDevices(data.devices); setJobs(data.jobs); }
      } catch (err) { if (active) setError((err as Error).message); }
      finally { if (active) timer = setTimeout(load, 5000); }
    }
    void load();
    return () => { active = false; clearTimeout(timer); };
  }, [refresh]);
  const device = devices.find(row => row.id === selected);
  const state = device?.state;
  const deviceJobs = jobs.filter(job => job.device_id === selected);
  const running = deviceJobs.some(job => ['pending','running'].includes(job.status));
  const online = !!device && !device.revoked_at && Date.parse(device.expires_at) > Date.now() &&
    !!device.last_seen && Date.now() - Date.parse(device.last_seen) < 20000;
  useEffect(() => { setReviewed(false); }, [selected, state?.stagedHash, state?.head]);
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); setRefresh(n => n + 1); }
    catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  function queue(action: string) {
    return perform(async () => {
      await api('/api/admin/agent-companion/' + selected + '/jobs', {
        action, path, message, expectedHead:state?.head, expectedBranch:state?.branch, expectedIndexHash:state?.stagedHash,
      });
      setNotice('Команду поставлено в чергу. Результат з’явиться після відповіді комп’ютера.');
    });
  }
  const base = typeof window === 'undefined' ? '' : window.location.origin + (window.location.pathname.startsWith('/studio') ? '/studio' : '');
  const startCommand = ".\\scripts\\start-agent-companion.ps1 -StudioUrl '" + base + "' -RepositoryPath 'D:\\Rama\\Book_Creality'";
  const blocked = busy || running || !online || !state;
  return <section className="rounded-xl border border-slate-500/30 p-3 space-y-3">
    <h3 className="font-semibold">Підключення комп’ютера та Git</h3>
    <details>
      <summary className="cursor-pointer text-sm">Підключити через PowerShell</summary>
      <div className="space-y-3 mt-3">
        <label className="block text-sm">Назва комп’ютера<input className={input} value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label>
        <button className={button} type="button" disabled={busy || !name.trim()} onClick={() => perform(async () => {
          const data = await api('/api/admin/agent-companion/pair', {name});
          setPair(data); setSelected(data.id); setNotice('Токен створено. Підключення підтвердиться лише після запуску помічника.');
        })}>Створити токен підключення</button>
        {pair ? <>
          <label className="block text-sm">Токен — скопіюйте в прихований запит PowerShell<input className={input} type="password" readOnly value={pair.token} autoComplete="off" /></label>
          <button className={button} type="button" onClick={() => perform(async () => { await navigator.clipboard.writeText(pair.token); setNotice('Токен скопійовано.'); })}>Копіювати токен</button>
          <button className={button} type="button" onClick={() => setPair(null)}>Прибрати токен з екрана</button>
          <p className="text-xs">Діє до {new Date(pair.expiresAt).toLocaleString('uk-UA')}. Токен не зберігається в браузері; підключення можна відкликати нижче.</p>
        </> : null}
        <p className="text-sm">Після отримання файлів цієї версії відкрийте PowerShell у папці Book_Creator і запустіть команду. Потрібні Node.js 22+ та Git. Для маркетплейсу змініть лише RepositoryPath на його локальну папку.</p>
        <pre className="overflow-x-auto whitespace-pre-wrap text-xs">{startCommand}</pre>
        <p className="text-xs text-slate-400">Залиште PowerShell відкритим. Помічник сам підключається до Студії; вхідний порт не потрібен. Ctrl+C зупиняє приймання нових команд. Уже запущена команда завершується.</p>
      </div>
    </details>
    <label className="block text-sm">Комп’ютер<select className={input} value={selected} onChange={event => setSelected(event.target.value)}>
      <option value="">Оберіть підключення</option>
      {devices.map(row => <option key={row.id} value={row.id}>{row.name}{row.revoked_at ? ' — відкликано' : ''}</option>)}
    </select></label>
    {device ? <>
      <p role="status" className="text-sm">{running ? 'Команда очікує або виконується' : online ? 'На зв’язку' : 'Не на зв’язку або токен завершив дію'}</p>
      {state ? <>
        <p className="text-sm break-all">{state.computer} · {state.directory}<br />{state.repository} · {state.branch}<br />SHA: {state.head}</p>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">{state.status || 'Робоче дерево чисте.'}</pre>
        <p className="text-sm">Підготовлено до коміту:</p>
        <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">{state.staged || 'Індекс порожній.'}</pre>
      </> : <p>Очікуємо перший зв’язок із помічником.</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={blocked} onClick={() => queue('status')}>Стан Git</button>
        <button className={button} disabled={blocked} onClick={() => queue('staged-diff')}>Переглянути зміни коміту</button>
        <button className={button} disabled={blocked} onClick={() => queue('push')}>Push поточної гілки</button>
        <button className={button} disabled={blocked || !!state?.status?.trim()} onClick={() => queue('receive')}>Отримати зміни — лише fast-forward</button>
      </div>
      <label className="block text-sm">Один файл від кореня репозиторію<input className={input} value={path} onChange={event => setPath(event.target.value)} placeholder="src/components/Example.tsx" /></label>
      <button className={button} disabled={blocked || !path.trim()} onClick={() => queue('stage-file')}>Додати цей файл до коміту</button>
      <label className="block text-sm">Опис коміту<input className={input} maxLength={2000} value={message} onChange={event => setMessage(event.target.value)} /></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} />Я переглянув зміни та хочу закомітити весь поточний індекс.</label>
      <button className={button} disabled={blocked || !message.trim() || !reviewed || !state?.staged?.trim()} onClick={() => queue('commit')}>Створити коміт</button>
      <p className="text-xs text-slate-400">Git працює у показаній папці. Коміт і push — окремі операції. Незакомічені файли не передаються; force-push і довільні команди не підтримуються.</p>
      {!device.revoked_at ? <button className={button} disabled={busy} onClick={() => perform(async () => {
        const data = await api('/api/admin/agent-companion/' + selected + '/revoke', {});
        setPair(null); setNotice(data.note);
      })}>Відкликати підключення</button> : null}
    </> : null}
    {error ? <p role="alert" className="text-sm text-rose-400">{error}</p> : null}
    {notice ? <p role="status" className="text-sm">{notice}</p> : null}
    {deviceJobs.slice(0,10).map(job => <details key={job.id} className="rounded-lg border border-slate-500/30 p-2">
      <summary className="cursor-pointer text-sm">{job.action} — {labels[job.status] || job.status} · {new Date(job.created_at).toLocaleTimeString('uk-UA')}</summary>
      <p className="text-xs break-all">ID: {job.id}</p>
      <pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{job.result?.output || 'Виводу ще немає.'}</pre>
      {job.status === 'unknown' ? <p className="text-sm">Команду не повторено автоматично. Перевірте «Стан Git» і вивід PowerShell.</p> : null}
      {job.result?.verifiedPush && job.result.state && job.result.pushedHead && job.result.pushedBranch && job.result.pushedRepository ? <button className={button} onClick={() => {
        const result = job.result!; const s = result.state!;
        onProof(result.pushedRepository!, result.pushedBranch!, result.pushedHead!,
          'Помічник підтвердив push: ' + result.checkedAt + '; ' + result.pushedRepository + '; ' + result.pushedBranch + '; SHA ' + result.pushedHead + '; операція ' + job.id + '; комп’ютер ' + s.computer + '.');
      }}>Додати підтвердження push до передачі</button> : null}
    </details>)}
  </section>;
}

import React, { useEffect, useMemo, useState } from 'react';
import type { GithubWorkspace } from '../../server/githubWorkspace';

const states = { draft: 'Чернетка PR · очікує злиття', open: 'Очікує злиття', merged: 'PR злито', closed: 'PR закрито без злиття' };
export function GithubWorkspacePanel({ selected, onSelect }: {
  selected: string; onSelect: (branch: string) => void;
}) {
  const [data, setData] = useState<GithubWorkspace | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [search, setSearch] = useState('');
  const [allPulls, setAllPulls] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const response = await fetch('/api/admin/git/workspace', {
          credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Не вдалося отримати гілки.');
        if (!controller.signal.aborted) { setData(body); setError(''); }
      } catch (err) {
        if (!controller.signal.aborted) setError((err as Error).message);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(load, 60000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [refresh]);
  const activePulls = useMemo(() => {
    const result = new Map<string, GithubWorkspace['pulls'][number]>();
    for (const p of data?.pulls ?? []) {
      if (p.repository === 'DenisDemenko/Book_Creator' && (p.state === 'open' || p.state === 'draft') && !result.has(p.branch))
        result.set(p.branch, p);
    }
    return result;
  }, [data]);
  const needle = search.trim().toLocaleLowerCase();
  const branches = useMemo(() => (data?.branches ?? []).filter(b => b.name.toLocaleLowerCase().includes(needle) ||
    b.head.toLowerCase().includes(needle)).slice().sort((a, b) => a.name === 'master' ? -1 : b.name === 'master' ? 1 :
    Number(activePulls.has(b.name)) - Number(activePulls.has(a.name)) || a.name.localeCompare(b.name)), [data, needle, activePulls]);
  const pulls = (data?.pulls ?? []).filter(p => (allPulls || p.state === 'open' || p.state === 'draft') &&
    `${p.number} ${p.title} ${p.branch} ${p.head}`.toLocaleLowerCase().includes(needle));
  const masterHead = data?.branches.find(b => b.name === 'master')?.head;
  return <section className="rounded-xl border border-slate-500/30 p-3 space-y-3" aria-label="Гілки та Pull Requests">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="font-semibold">Гілки та Pull Requests</h3>
      <button type="button" onClick={() => setRefresh(n => n + 1)} className="ml-auto rounded-lg border border-slate-500/40 px-3 py-2 text-xs">Оновити гілки та PR</button>
    </div>
    <p className="text-xs text-slate-400">Тут видно опубліковані робочі гілки до злиття. Вибір гілки змінює історію нижче.</p>
    <label className="block text-sm">Пошук гілки, PR або SHA
      <input type="search" value={search} onChange={e => setSearch(e.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-500/40 bg-transparent p-2" />
    </label>
    {!data && !error ? <p role="status" className="text-xs">Завантажуємо гілки та PR…</p> : null}
    {error ? <p role="alert" className="text-sm text-amber-300">{error}{data ? ' Нижче залишено попередній знімок.' : ''}</p> : null}
    {data ? <>
      <p role="status" className="text-xs text-slate-400">Знімок GitHub: {new Date(data.checkedAt).toLocaleString('uk-UA')}. Кеш до 5 хвилин.</p>
      {data.truncated ? <p className="text-xs text-amber-300">Список обмежено 1000 гілками та 1000 останніми PR. Повний перелік доступний на GitHub.</p> : null}
      <div className="max-h-64 overflow-y-auto space-y-2" aria-label="Робочі гілки">
        {branches.map(b => <button key={b.name} type="button" aria-pressed={selected === b.name}
          onClick={() => onSelect(b.name)} className={`block w-full rounded-lg border p-2 text-left text-xs ${selected === b.name ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-500/30'}`}>
          <span className="block break-all font-mono">{b.name} · {b.head.slice(0, 7)}</span>
          <span className="block mt-1 text-slate-400">{b.head === masterHead ? 'У master' : 'Опубліковано в гілці'}
            {activePulls.has(b.name) ? ` · PR #${activePulls.get(b.name)!.number} · ${states[activePulls.get(b.name)!.state]}` : ''}</span>
        </button>)}
        {!branches.length ? <p className="text-xs text-slate-400">Гілок за цим пошуком немає.</p> : null}
      </div>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={allPulls} onChange={e => setAllPulls(e.target.checked)} />Показати також злиті й закриті PR</label>
      <div className="max-h-64 overflow-y-auto space-y-2" aria-label="Pull Requests">
        {pulls.map(p => <article key={p.number} className="rounded-lg border border-slate-500/30 p-2 text-xs space-y-1">
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 hover:underline">PR #{p.number} · {p.title}</a>
          <p className="break-all text-slate-400">{p.branch} → {p.base} · {p.head.slice(0, 7)}</p>
          <p>{states[p.state]}</p>
          {p.repository === 'DenisDemenko/Book_Creator' && data.branches.some(b => b.name === p.branch) ?
            <button type="button" onClick={() => onSelect(p.branch)} className="text-cyan-300 underline">Показати коміти цієї гілки</button> : null}
        </article>)}
        {!pulls.length ? <p className="text-xs text-slate-400">PR за цим фільтром немає.</p> : null}
      </div>
      <p className="text-xs text-slate-400">Статус PR не підтверджує проходження CI або деплой. Незбережені й незапушені локальні файли GitHub не бачить.</p>
    </> : null}
  </section>;
}

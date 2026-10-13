import LabyrinthGroupReader from "./LabyrinthGroupReader";
import ReaderMap from "./ReaderMap";
import React, { useEffect, useRef, useState } from "react";
import type { ReaderAction, ReaderEdition, ReaderSessionSummary, ReaderView } from "../../../shared/labyrinthReader";
import { gs, GsError } from "../graphStudio/gsApi";

const button = "min-h-11 rounded-lg border border-slate-500 px-3 py-2 text-left hover:bg-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-300 disabled:opacity-50";
const field = "w-full min-w-0 rounded-lg border border-slate-500 bg-slate-950 p-2 text-slate-100";
type Library = { editions: ReaderEdition[]; sessions: ReaderSessionSummary[] };
type Pending = { path: string; body: unknown };

export default function LabyrinthReader({ projectId }: { projectId: string }) {
  const [groupMode,setGroupMode]=useState(()=>new URL(location.href).searchParams.get("labyrinth")==="group"||new URL(location.href).searchParams.has("groupRun"));
  const base = "/api/core/projects/" + encodeURIComponent(projectId) + "/labyrinth/reader";
  const [library, setLibrary] = useState<Library>({ editions: [], sessions: [] });
  const [view, setView] = useState<ReaderView | null>(null);
  const [mapId, setMapId] = useState(""), [heroId, setHeroId] = useState("");
  const [checkpoint, setCheckpoint] = useState(0);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [fontSize, setFontSize] = useState(18);
  const alive = useRef(true), title = useRef<HTMLHeadingElement>(null);
  const bookmark = (id?: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("labyrinth", "reader");
    if (id) url.searchParams.set("readerRun", id); else url.searchParams.delete("readerRun");
    window.history.replaceState(window.history.state, "", url);
  };
  const accept = (next: ReaderView) => {
    if (!alive.current) return;
    setView(next); setCheckpoint(next.checkpoints[0]?.revision ?? 0);
    setPending(null); bookmark(next.id);
  };
  const reject = (e: unknown) => {
    if (!alive.current) return;
    if (e instanceof GsError && [401,403,404].includes(e.status)) {
      setView(null); setLibrary({ editions: [], sessions: [] }); setPending(null); bookmark();
    }
    setError((e as Error).message || "Не вдалося отримати сцену.");
  };
  const loadLibrary = async () => {
    setBusy(true); setError(""); setPending(null); setView(null); bookmark();
    try { const next = await gs<Library>("GET", base + "/library"); if (alive.current) setLibrary(next); }
    catch (e) { reject(e); } finally { if (alive.current) setBusy(false); }
  };
  useEffect(() => {
    alive.current = true;
    if(groupMode){setBusy(false);return()=>{alive.current=false;};}
    void (async () => {
      try {
        const next = await gs<Library>("GET", base + "/library");
        if (!alive.current) return;
        setLibrary(next);
        const saved = new URL(window.location.href).searchParams.get("readerRun");
        if (saved) accept(await gs<ReaderView>("GET", base + "/sessions/" + encodeURIComponent(saved)));
      } catch (e) { reject(e); }
      finally { if (alive.current) setBusy(false); }
    })();
    return () => { alive.current = false; };
  }, [base,groupMode]);
  useEffect(() => {
    const edition = library.editions.find((e) => e.mapId === mapId) ?? library.editions[0];
    if (edition) { setMapId(edition.mapId); setHeroId(edition.heroes[0]?.id ?? ""); }
  }, [library.editions, mapId]);
  useEffect(() => { if (view) title.current?.focus(); }, [view?.id, view?.revision]);
  const edition = library.editions.find((e) => e.mapId === mapId);
  const open = async (id: string) => {
    setBusy(true); setError(""); setPending(null);
    try { accept(await gs<ReaderView>("GET", base + "/sessions/" + id)); }
    catch (e) { reject(e); } finally { if (alive.current) setBusy(false); }
  };
  const submit = async (operation: Pending) => {
    setBusy(true); setError(""); setPending(operation);
    try { accept(await gs<ReaderView>("POST", operation.path, operation.body)); }
    catch (e) {
      reject(e);
      if (e instanceof GsError && e.status < 500) {
        setPending(null);
        if (e.status === 409 && view) {
          try { accept(await gs<ReaderView>("GET", base + "/sessions/" + view.id)); }
          catch (refreshError) { reject(refreshError); }
        }
      }
    } finally { if (alive.current) setBusy(false); }
  };
  const action = (a: ReaderAction) => {
    if (!view) return;
    void submit({ path: base + "/sessions/" + view.id + "/actions",
      body: { expectedRevision: view.revision, action: a, key: crypto.randomUUID() } });
  };
  if(groupMode)return <div className="min-w-0 space-y-3">
    <button className={button} onClick={()=>{const u=new URL(location.href);u.searchParams.delete("groupRun");u.searchParams.set("labyrinth","reader");history.replaceState(history.state,"",u);setGroupMode(false);}}>Читати самостійно</button>
    <LabyrinthGroupReader projectId={projectId}/>
  </div>;
  return <section className="min-w-0 space-y-4 rounded-xl bg-slate-900 p-3 text-slate-100 [overflow-wrap:anywhere]" data-labyrinth-reader aria-busy={busy}>
    <header className="space-y-2">
      <h2 className="text-xl font-bold">Читач книги-лабіринта</h2>
      <button className={button} data-reader-group-mode onClick={()=>setGroupMode(true)}>Групове проходження</button>
      <p>Читайте у власному темпі. Час історії змінюється лише після вашої дії. Перезапуск браузера зберігає маршрут.</p>
    </header>
    {error && <p role="alert" className="rounded-lg border border-amber-400 p-3">{error}</p>}
    {busy && <p role="status">Завантаження…</p>}
    {pending && !busy && <button className={button} onClick={() => void submit(pending)} data-reader-retry>Повторити запит</button>}
    {!view ? <div className="space-y-4">
      <button className={button} disabled={busy} onClick={() => void loadLibrary()}>Оновити бібліотеку</button>
      {!busy && !library.editions.length && <p>Автор ще не відкрив для вас книгу-лабіринт. Потрібні відкрита версія та право перегляду книги.</p>}
      {!!library.editions.length && <fieldset disabled={busy || !!pending} className="grid min-w-0 gap-3 md:grid-cols-2">
        <legend>Нове проходження</legend>
        <label>Книга-лабіринт<select className={field} value={mapId} onChange={(e) => setMapId(e.target.value)} data-reader-edition>
          {library.editions.map((e) => <option key={e.mapId} value={e.mapId}>{e.title} · v{e.mapRevision}</option>)}
        </select></label>
        <label>Герой<select className={field} value={heroId} onChange={(e) => setHeroId(e.target.value)} data-reader-hero>
          {edition?.heroes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select></label>
        <button className={button} disabled={!edition || !heroId} data-reader-start onClick={() => {
          if (edition) void submit({ path: base + "/maps/" + edition.mapId + "/start",
            body: { publicationRevision: edition.publicationRevision, heroId, key: crypto.randomUUID() } });
        }}>Почати читання</button>
      </fieldset>}
      {!!library.sessions.length && <section className="space-y-2">
        <h3 className="font-semibold">Мої збережені проходження</h3>
        {library.sessions.map((s) => <button key={s.id} className={button + " mr-2 mb-2"} disabled={busy} onClick={() => void open(s.id)} data-reader-resume>
          {s.title} · {s.heroName} · хід {s.turn} · v{s.mapRevision}
        </button>)}
      </section>}
    </div> : <>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => void loadLibrary()}>До бібліотеки</button>
        <button className={button} disabled={busy} onClick={() => void open(view.id)} data-reader-refresh>Оновити сцену</button>
        <button className={button} disabled={fontSize <= 16} onClick={() => setFontSize((v) => v - 2)} aria-label="Зменшити текст">А−</button>
        <button className={button} disabled={fontSize >= 28} onClick={() => setFontSize((v) => v + 2)} aria-label="Збільшити текст">А+</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true" data-reader-progress>
        Збережено на сервері · хід {view.turn} · час історії {view.storyTime} · карта v{view.mapRevision} · книга r{view.bookRevision}
      </p>
      <article className="space-y-3 whitespace-pre-wrap leading-relaxed" style={{ fontSize }} data-reader-scene>
        <h2 ref={title} tabIndex={-1} className="text-2xl font-bold outline-offset-4">{view.scene.title}</h2>
        {view.scene.paragraphs.map((p,i) => p.kind === "heading" ? <h3 key={i} className="font-bold">{p.text}</h3> :
          p.kind === "blockquote" ? <blockquote key={i} className="border-l-2 border-teal-400 pl-3">{p.text}</blockquote> : <p key={i}>{p.text}</p>)}
        <p data-reader-narration>{view.description}</p>
      </article>
      <div className="flex flex-wrap gap-3" aria-label="Ресурси героя">
        <strong>{view.hero.name}</strong>
        {Object.entries(view.hero.resources).map(([k,v]) => <span key={k}>{k === "health" ? "Здоров'я" : k === "energy" ? "Сили" : k}: {v}</span>)}
      </div>
      {!!view.warnings.length && <div className="space-y-2 rounded-lg border border-amber-400 p-3" role="status" data-reader-warnings>
        {view.warnings.map((w,i) => <p key={i}><strong>{w.phase === "warning" ? "Попередження" : "Небезпека"}: </strong>{w.text} {w.avoidance}</p>)}
      </div>}
      <fieldset disabled={busy || !!pending || view.completed} className="space-y-3" data-reader-choices>
        <legend className="font-semibold">Що зробить герой?</legend>
        <div className="flex flex-col gap-2">
          {view.choices.map((c) => <button className={button} key={c.edgeId} disabled={!c.available}
            data-reader-move={c.edgeId} onClick={() => action({ kind: "move", edgeId: c.edgeId })}>{c.label}{c.reason ? " — " + c.reason : ""}</button>)}
          {view.interactions.map((i) => <button className={button} key={i.objectId + ":" + i.to} disabled={!i.available}
            data-reader-interact={i.objectId} onClick={() => action({ kind: "interact", objectId: i.objectId, to: i.to })}>{i.label}</button>)}
          <button className={button} onClick={() => action({ kind: "wait" })} data-reader-wait>Зачекати один крок історії</button>
        </div>
      </fieldset>
      {view.completed && <p role="status" className="rounded-lg border border-teal-400 p-3" data-reader-complete>Герой дістався виходу. Проходження завершено.</p>}
      <ReaderMap map={view.map} />
      <details>
        <summary className="cursor-pointer py-2">Предмети та знання героя</summary>
        <p>Предмети: {view.hero.inventory.join(", ") || "немає"}</p>
        <ul className="list-inside list-disc">{view.hero.knowledge.map((k,i) => <li key={i}>{k}</li>)}</ul>
      </details>
      <fieldset disabled={busy || !!pending} className="min-w-0 space-y-2 rounded-lg border border-slate-600 p-3">
        <legend>Повернутися до збереженого ходу</legend>
        <label>Хід<select className={field} value={checkpoint} onChange={(e) => setCheckpoint(Number(e.target.value))} data-reader-checkpoint>
          {view.checkpoints.map((c) => <option key={c.revision} value={c.revision}>r{c.revision} · {c.label} · час {c.storyTime}</option>)}
        </select></label>
        <p>Відновлення створить новий маршрут. Попередній залишиться у бібліотеці.</p>
        <button className={button} data-reader-restore onClick={() => void submit({ path: base + "/sessions/" + view.id + "/restore",
          body: { expectedRevision: view.revision, sourceRevision: checkpoint, key: crypto.randomUUID() } })}>Відновити як новий маршрут</button>
      </fieldset>
    </>}
  </section>;
}

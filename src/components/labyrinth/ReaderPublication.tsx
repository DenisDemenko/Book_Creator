import { GroupSetup } from "./GroupSetup";
import { StoryAssembly } from "./StoryAssembly";
import React, { useEffect, useRef, useState } from "react";
import type { LabyrinthHero, LabyrinthDefinition } from "../../../shared/labyrinth";
import type { ReaderPublication as Publication } from "../../../shared/labyrinthReader";
import { gs } from "../graphStudio/gsApi";
const button = "rounded-lg border border-slate-500 px-3 py-2 hover:bg-slate-700 disabled:opacity-50";
export function ReaderPublication({ base, mapId, mapRevision, heroes, definition, dirty, busy: authorBusy }: {
  base: string; mapId: string; mapRevision: number; heroes: LabyrinthHero[]; definition?: LabyrinthDefinition; dirty: boolean; busy: boolean;
}) {
  const [publication, setPublication] = useState<Publication | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const token = ++generation.current;
    setPublication(null); setNotice(""); setBusy(false);
    setSelected(heroes.length === 1 ? [heroes[0].id] : []);
    if (!mapId) return;
    setBusy(true);
    gs<Publication>("GET", base + "/maps/" + mapId + "/reader-publication")
      .then((p) => { if (generation.current === token) { setPublication(p); if (p.active) setSelected(p.heroIds); } })
      .catch((e) => { if (generation.current === token) setNotice(e.message); })
      .finally(() => { if (generation.current === token) setBusy(false); });
    return () => { generation.current++; };
  }, [base, mapId, mapRevision]);
  const update = async (withdraw = false) => {
    if (!publication) return;
    const token = generation.current;
    setBusy(true); setNotice("");
    try {
      const p = await gs<Publication>("POST", base + "/maps/" + mapId + (withdraw ? "/reader-withdraw" : "/reader-publication"),
        withdraw ? { expectedRevision: publication.revision } :
          { expectedRevision: publication.revision, mapRevision, heroIds: selected });
      if (token === generation.current) {
        setPublication(p);
        setNotice(withdraw ? "Доступ відкликано, включно з уже розпочатими проходженнями." :
          "Версію відкрито. Учасники з переглядом книги можуть перейти до вкладки «Читач лабіринта».");
      }
    } catch (e) { if (token === generation.current) setNotice((e as Error).message); }
    finally { if (token === generation.current) setBusy(false); }
  };
  if (!mapId || !mapRevision) return <p className="text-sm">Щоб відкрити читання, спочатку збережіть карту.</p>;
  return <section className="space-y-3 rounded-xl border border-teal-700 p-3" data-reader-publication>
    <h3 className="font-semibold">Версія для читачів</h3>
    <p className="text-sm text-slate-200">{publication?.active ?
      "Відкрита карта v" + publication.mapRevision + ", книга r" + publication.bookRevision + "." :
      "Карта ще не відкрита читачам."} Текст сцен фіксується під час відкриття версії.</p>
    <fieldset disabled={busy || authorBusy || dirty} className="space-y-2">
      <legend>Герої, яких читач може вибрати</legend>
      {heroes.map((h) => <label className="mr-4 inline-flex items-center gap-2" key={h.id}>
        <input type="checkbox" checked={selected.includes(h.id)} onChange={(e) =>
          setSelected((old) => e.target.checked ? [...old, h.id] : old.filter((id) => id !== h.id))} />
        {h.name}
      </label>)}
    </fieldset>
    {dirty && <p>Спочатку збережіть зміни карти.</p>}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || authorBusy || dirty || !publication || !selected.length}
        onClick={() => void update()} data-reader-publish>Відкрити v{mapRevision} читачам</button>
      <button className={button} disabled={busy || authorBusy || !publication?.active}
        onClick={() => void update(true)} data-reader-withdraw>Відкликати доступ</button>
    </div>
    {notice && <p role="status">{notice}</p>}
    {definition && publication?.active && publication.mapRevision===mapRevision && <GroupSetup base={base} mapId={mapId} definition={definition} publication={publication} disabled={dirty||busy||authorBusy}/>}
    <StoryAssembly base={base} mapId={mapId} disabled={dirty||busy||authorBusy}/>
  </section>;
}

import {CollaborationTaskSuggestions} from './CollaborationTaskSuggestions';
import React, { useState } from "react";
import type { Book } from "../types";
import { gs } from "./graphStudio/gsApi";
export function CollaborationChanges({
  bookId,
  onUpdateBook,
}: {
  bookId: string;
  onUpdateBook?: (book: Book) => void;
}) {
  const [source, setSource] = useState<any>(null),
    [rows, setRows] = useState<any[]>([]),
    [history, setHistory] = useState<any[]>([]),
    [approve, setApprove] = useState(false),
    [target, setTarget] = useState(""),
    [text, setText] = useState(""),
    [note, setNote] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [before, setBefore] = useState<Record<string, string>>({});
  const root = `/api/core/projects/${encodeURIComponent(bookId)}`,
    field = "rounded bg-slate-900 border border-slate-700 p-2 max-w-full",
    button = "rounded border border-slate-600 p-2 disabled:opacity-40";
  const load = async () => {
    const [s, p, c] = await Promise.all([
      gs<any>("GET", `${root}/source`),
      gs<any>("GET", `${root}/collaboration/proposals`),
      gs<any>("GET", `${root}/collaboration/contributions`),
    ]);
    setSource(s);
    setRows(p.proposals);
    setApprove(p.canApprove);
    setHistory(c.contributions);
  };
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const scenes = (source?.book.chapters ?? []).flatMap((c: any) =>
    c.sections.map((s: any) => ({
      key: JSON.stringify([c.id, s.id]),
      chapterId: c.id,
      sectionId: s.id,
      label: `${c.title ?? c.id} / ${s.title ?? s.id}`,
      content: s.content ?? "",
    })),
  );
  const selected = scenes.find((s: any) => s.key === target);
  const submit = async () => {
    if (!selected) return;
    await gs("POST", `${root}/collaboration/proposals`, {
      chapterId: selected.chapterId,
      sectionId: selected.sectionId,
      sourceRevision: source.revision,
      patch: { content: text },
      note,
    });
    setText("");
    setTarget("");
    await load();
    setMessage("Пропозицію надіслано. Серверний текст не змінено.");
  };
  const review = async (id: string, decision: string) => {
    const r = await gs<any>(
      "POST",
      `${root}/collaboration/proposals/${encodeURIComponent(id)}/${decision}`,
      {},
    );
    if (decision === "merge") {
      const s = await gs<any>("GET", `${root}/source`);
      onUpdateBook?.(s.book);
    }
    await load();
    setMessage(
      decision === "merge"
        ? `Злиття виконано, ревізія ${r.revision}.`
        : "Пропозицію відхилено.",
    );
  };
  return (
    <section className="space-y-3 min-w-0" data-collaboration-changes>
      <h2 className="font-bold">Пропозиції змін і внески</h2>
      <CollaborationTaskSuggestions bookId={bookId}/>
      <button className={button} disabled={busy} onClick={() => void act(load)}>
        Завантажити зміни
      </button>
      {message && (
        <p role="status" className="break-words">
          {message}
        </p>
      )}
      {source && (
        <>
          <p className="text-xs">
            Серверна ревізія: {source.revision}. Злиття створює нову ревізію
            після схвалення власником або адміністратором.
          </p>
          <label className="block">
            Сцена
            <select
              className={field}
              aria-label="Сцена пропозиції"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setText(
                  scenes.find((s: any) => s.key === e.target.value)?.content ??
                    "",
                );
              }}
            >
              <option value="">Оберіть сцену</option>
              {scenes.map((s: any) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {selected && (
            <>
              <label className="block">
                Новий текст
                <textarea
                  aria-label="Текст пропозиції"
                  className={`${field} w-full h-48`}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
              </label>
              <input
                aria-label="Пояснення пропозиції"
                className={field}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Пояснення зміни"
              />
              <button
                className={button}
                disabled={busy}
                onClick={() => void act(submit)}
              >
                Надіслати пропозицію
              </button>
            </>
          )}
          <h3>Пропозиції ({rows.length})</h3>
          {rows.map((p) => (
            <article
              key={p.id}
              className="space-y-2 rounded border border-slate-700 p-3 break-words"
            >
              <p>
                {p.userId} · {p.sectionId} · {p.status} · ревізія{" "}
                {p.sourceRevision}
              </p>
              <p>{p.note}</p>
              <button
                className={button}
                onClick={() =>
                  void act(async () => {
                    const s = await gs<any>(
                      "GET",
                      `${root}/source/history/${p.sourceRevision}`,
                    );
                    const t =
                      s.book.chapters
                        .find((c: any) => c.id === p.chapterId)
                        ?.sections.find((s: any) => s.id === p.sectionId)
                        ?.content ?? "";
                    setBefore((v) => ({ ...v, [p.id]: t }));
                  })
                }
              >
                Показати початковий текст
              </button>
              {before[p.id] !== undefined && (
                <pre className="whitespace-pre-wrap">Було: {before[p.id]}</pre>
              )}
              <pre className="whitespace-pre-wrap">
                Пропонується:{" "}
                {typeof p.patch.content === "string"
                  ? p.patch.content
                  : JSON.stringify(p.patch)}
              </pre>
              {approve && p.status === "pending" && (
                <div className="flex flex-wrap gap-2">
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void act(() => review(p.id, "merge"))}
                  >
                    Схвалити та злити
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void act(() => review(p.id, "reject"))}
                  >
                    Відхилити
                  </button>
                </div>
              )}
            </article>
          ))}
          <h3>Історія внесків ({history.length})</h3>
          <p className="text-xs">
            Це історія походження роботи, а не юридичне визначення авторських
            прав.
          </p>
          {history.map((c) => (
            <p key={c.id} className="break-words text-xs">
              {c.userId} · {c.actionType} · {c.resourceId} · {c.sourceRevision}{" "}
              → {c.resultRevision} · {c.timestamp} · схвалив {c.approvedBy}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

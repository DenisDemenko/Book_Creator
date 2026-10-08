import React, { useState } from "react";
import { gs } from "./graphStudio/gsApi";
export function CollaborationTaskSuggestions({ bookId }: { bookId: string }) {
  const [rows, setRows] = useState<any[]>([]),
    [canReview, setCanReview] = useState(false),
    [assignee, setAssignee] = useState<Record<string, string>>({}),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const root = `/api/core/projects/${encodeURIComponent(bookId)}/collaboration/ai/suggestions`;
  const load = async () => {
    const r = await gs<any>("GET", root);
    setRows(r.suggestions);
    setCanReview(r.canReview);
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
  const review = async (id: string, decision: string) => {
    await gs("POST", `${root}/${encodeURIComponent(id)}/${decision}`, {
      assigneeId: assignee[id],
    });
    await load();
    setMessage(
      decision === "accept"
        ? "Завдання створено після вашого підтвердження."
        : "Пропозицію відхилено.",
    );
  };
  return (
    <section className="space-y-3" data-collaboration-ai-suggestions>
      <h2 className="font-bold">Пропозиції завдань ШІ</h2>
      <p className="text-xs">
        Виконавець не призначається автоматично. Після розгляду власник або
        адміністратор явно обирає учасника.
      </p>
      <button disabled={busy} onClick={() => void act(load)}>
        Завантажити пропозиції ШІ
      </button>
      {message && <p role="status">{message}</p>}
      {rows.map((p) => (
        <article
          key={p.id}
          className="rounded border border-slate-700 p-3 space-y-2 break-words"
        >
          <h3>{p.title}</h3>
          <p>{p.reason}</p>
          <p>
            {p.status} · {p.target.kind}:{p.target.id ?? "book"} · кандидат{" "}
            {p.candidateId ?? "не запропоновано"}
          </p>
          {canReview && p.status === "pending" && (
            <div className="flex flex-wrap gap-2">
              <input
                aria-label={`Виконавець ${p.id}`}
                className="bg-slate-900 border border-slate-700 p-2 max-w-full"
                placeholder="ID обраного учасника"
                value={assignee[p.id] ?? ""}
                onChange={(e) =>
                  setAssignee((v) => ({ ...v, [p.id]: e.target.value }))
                }
              />
              <button
                disabled={busy || !assignee[p.id]}
                onClick={() => void act(() => review(p.id, "accept"))}
              >
                Підтвердити завдання
              </button>
              <button
                disabled={busy}
                onClick={() => void act(() => review(p.id, "reject"))}
              >
                Відхилити завдання
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

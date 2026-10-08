import {buildCreativeAccessPath,buildCreativeWorkspacePath} from '../utils/appRoutes';
import {API_BASE} from '../utils/basePath';
import { useCallback, useEffect, useState } from "react";
import type { CreativeProject } from "../../server/core/creative/projects";
export function CreativeProjects({ bookId }: { bookId: string }) {
  const [projects, setProjects] = useState<CreativeProject[]>([]),
    [title, setTitle] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const request = useCallback(
    async (method = "GET", body?: unknown) => {
      const r = await fetch(
        `/api/core/projects/${encodeURIComponent(bookId)}/creative-projects`,
        {
          method,
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      return data;
    },
    [bookId],
  );
  const load = useCallback(async () => {
    setProjects((await request()).projects);
  }, [request]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  return (
    <section className="space-y-3" aria-label="Творчі проєкти">
      <h2 className="font-bold">Creative Studio — творчі проєкти</h2>
      <p>
        Доступно: бриф, біржа замовлень, вибір фахівця та робочий простір. Створення проєкту не відкриває книгу іншим
        людям.
      </p>
      <a
        className="underline"
        href="https://www.fusionlab.in.ua/creative-marketplace"
        target="_blank"
        rel="noreferrer"
      >
        Профілі та заявки фахівців у маркетплейсі
      </a>
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          void request("POST", { title })
            .then(async () => {
              setTitle("");
              await load();
            })
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          Назва творчого проєкту
          <input
            className="block rounded border border-slate-600 bg-slate-950 p-2"
            required
            minLength={2}
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <button
          disabled={busy}
          className="rounded border border-slate-600 p-2 disabled:opacity-40"
        >
          {busy ? "Збереження…" : "Створити чернетку"}
        </button>
      </form>
      <ul className="space-y-2">
        {projects.map((p) => (
          <li key={p.id} className="rounded border border-slate-700 p-3">
            <a className="underline" href={buildCreativeAccessPath(p.id,API_BASE)}>{p.title} — бриф і доступ</a> · {p.status}{" "}
            <a className="underline" href={buildCreativeWorkspacePath(p.id,API_BASE)}>Workspace</a> · <small>{new Date(p.createdAt).toLocaleDateString("uk-UA")}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

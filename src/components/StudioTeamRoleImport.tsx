import React, { useState } from "react";
import { useLanguage } from "../i18n/LanguageContext";
import type { TeamRoleSnapshot } from "../../server/core/collaboration/teamRoles";
export function StudioTeamRoleImport({
  bookId,
  onChanged,
}: {
  bookId: string;
  onChanged: () => Promise<void>;
}) {
  const { lang } = useLanguage(),
    en = lang === "en",
    l = (u: string, e: string) => (en ? e : u);
  const [id, setId] = useState(""),
    [data, setData] = useState<{
      team: TeamRoleSnapshot;
      registryVersion: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  const root = `/api/core/projects/${encodeURIComponent(bookId)}/team-roles`;
  async function api(op: string, b: object) {
    const r = await fetch(root + "/" + op, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });
    const a = await r.json();
    if (!r.ok) throw Error(a.error);
    return a;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const options =
    data?.team.members.flatMap((m) =>
      m.roles.map((r) => ({ member: m, role: r })),
    ) || [];
  return (
    <section className="rounded-lg border border-slate-600 p-3 space-y-2">
      <h3 className="font-bold">
        {l("Ролі з STEAM-команди", "Roles from a STEAM team")}
      </h3>
      <p className="text-sm">
        {l(
          "Ви маєте бути власником і цієї книги, і команди. Учасник має увійти в Studio. Роль не відкриває текст: доступ надається окремо. Відкликати роль книги можна в списку учасників вище.",
          "You must own this book and the team. Members must sign in to Studio. Roles do not grant text access. Revoke book roles in the participants list above.",
        )}
      </p>
      <label className="block">
        {l("ID команди Marketplace", "Marketplace team ID")}
        <input
          className="block w-full rounded bg-slate-800 p-2"
          value={id}
          disabled={busy}
          onChange={(e) => {
            setId(e.target.value);
            setData(null);
            setConfirmed(false);
            setSelected("");
          }}
        />
      </label>
      <button
        className="rounded border border-slate-500 px-3 py-2"
        disabled={busy || !id.trim()}
        onClick={() =>
          void run(async () => {
            setData(await api("preview", { teamId: id.trim() }));
            setConfirmed(false);
            setSelected("");
          })
        }
      >
        {l("Перевірити ролі команди", "Preview team roles")}
      </button>
      {data && (
        <>
          <label className="block">
            {l("Підтверджена роль учасника", "Confirmed member role")}
            <select
              className="block w-full rounded bg-slate-800 p-2"
              disabled={busy}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">
                {l("Оберіть призначення", "Choose assignment")}
              </option>
              {options.map((o) => (
                <option key={o.role.id} value={o.role.id}>
                  {o.member.name} · {o.role.roleId}
                  {o.role.specialization ? " / " + o.role.specialization : ""}
                </option>
              ))}
            </select>
          </label>
          {!options.length && (
            <p>
              {l(
                "У команді ще немає професійних ролей.",
                "No professional roles assigned in this team.",
              )}
            </p>
          )}
          <label className="block">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {l(
              " Підтверджую призначення обраної ролі в цій книзі",
              " I confirm assigning the selected role in this book",
            )}
          </label>
          <button
            className="rounded border border-slate-500 px-3 py-2"
            disabled={busy || !selected || !confirmed}
            onClick={() =>
              void run(async () => {
                const o = options.find((x) => x.role.id === selected)!;
                const r = await api("import", {
                  teamId: id.trim(),
                  memberId: o.member.id,
                  assignmentId: o.role.id,
                  expectedRevision: data.team.revision,
                  registryVersion: data.registryVersion,
                  confirmed,
                });
                await onChanged();
                setConfirmed(false);
                setNotice(r.notice);
              })
            }
          >
            {l("Призначити роль в книзі", "Assign book role")}
          </button>
        </>
      )}
      {busy && <p role="status">{l("Перевірка…", "Checking…")}</p>}
      {error && (
        <p role="alert" className="text-rose-300">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

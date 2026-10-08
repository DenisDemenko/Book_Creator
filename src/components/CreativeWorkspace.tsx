import { emptyAi } from '../../shared/mediaProvenance';
import { AiDeclarationFields } from './MediaProvenancePanel';
import { WorkspaceMediaTransfer } from './WorkspaceMediaTransfer';
import { buildCreativeBiblePath, buildAppPath } from "../utils/appRoutes";
import { API_BASE } from "../utils/basePath";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CreativeAsset,
  CreativeAnnotation,
} from "../../server/core/creative/workspace";
import type { BriefData } from "../../server/core/creative/briefs";
interface State {
  project: { id: string; title: string; bookId: string; status: string };
  brief: BriefData | null;
  assets: CreativeAsset[];
  annotations: CreativeAnnotation[];
  entities: Array<{ id: string; type: string; name: string }>;
  references: Array<{ id: string; title: string; url: string }>;
  participants: Array<{ id: string; name: string; role: string }>;
  userId: string;
  permissions: { owner: boolean; work: boolean; comment: boolean };
  unread: number;
  mediaTargets?: { characters: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }>; scenes: Array<{ id: string; name: string }> } | null;
  workspaceGrants: Array<{
    id: string;
    level: string;
    status: string;
    validFrom: string;
    validUntil: string | null;
  }>;
}
interface Event {
  seq: number;
  id: string;
  type: string;
  actorId: string;
  createdAt: string;
  text?: string;
  note?: string;
  assetId?: string;
  assetIds?: string[];
  mentions?: string[];
  from?: string;
  to?: string;
}
const tabs = [
  "Огляд",
  "Бриф",
  "Матеріали",
  "Роботи",
  "Чат",
  "Коментарі",
  "Версії",
  "AI Tools",
  "Учасники",
  "Історія",
] as const;
const statuses: Record<string, string> = {
  DRAFT: "Чернетка",
  SUBMITTED_FOR_REVIEW: "На перевірці",
  CHANGES_REQUESTED: "Потрібні зміни",
  RESUBMITTED: "Повторна перевірка",
  APPROVED: "Затверджено",
  FINAL: "Фінальний",
  REJECTED: "Відхилено",
  ARCHIVED: "Архів",
};
function linkedText(value: string) {
  return value.split(/(https?:\/\/[^\s<>]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        className="underline break-all"
        href={part}
        target="_blank"
        rel="noreferrer"
      >
        {part}
      </a>
    ) : (
      part
    ),
  );
}
const labels: Record<string, string> = {
  WORKSPACE_ACCESS_GRANTED: "Надано доступ Workspace",
  WORKSPACE_ACCESS_REVOKED: "Відкликано доступ Workspace",
  ASSET_UPLOADED: "Завантажено нову версію",
  ASSET_IMPORTED_TO_LIBRARY: "Результат збережено в медіатеку",
  ASSET_STATE_CHANGED: "Змінено статус",
  ANNOTATION_ADDED: "Додано коментар",
  ANNOTATION_RESOLVED: "Закрито коментар",
};
const field = "w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2";
const button = "rounded border border-slate-600 px-3 py-2 disabled:opacity-40";
export function CreativeWorkspace({
  creativeProjectId,
}: {
  creativeProjectId: string;
}) {
  const [state, setState] = useState<State | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [tab, setTab] = useState<string>("Огляд"),
    [selected, setSelected] = useState(""),
    [compare, setCompare] = useState(""),
    [mode, setMode] = useState("side"),
    [blend, setBlend] = useState(50),
    [zoom, setZoom] = useState(100),
    [url, setUrl] = useState(""),
    [compareUrl, setCompareUrl] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [pin, setPin] = useState<{ x: number; y: number } | null>(null),
    [timecode, setTimecode] = useState(0),
    [note, setNote] = useState(""),
    [reviewNote, setReviewNote] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [message, setMessage] = useState(""),
    [mention, setMention] = useState(""),
    [attachment, setAttachment] = useState(""),
    [context, setContext] = useState<any>(null),
    [contextOpen, setContextOpen] = useState(false),
    [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [uploadAi, setUploadAi] = useState(emptyAi);
  const [workspaceLevel, setWorkspaceLevel] = useState("WORK"),
    [accessConfirm, setAccessConfirm] = useState(false),
    [validFrom, setValidFrom] = useState(""),
    [validUntil, setValidUntil] = useState("");
  const canvas = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    epoch = useRef(0),
    olderHistoryLoaded = useRef(false),
    pendingSeek = useRef<number | null>(null);
  const root = `/api/creative/projects/${encodeURIComponent(creativeProjectId)}/workspace`;
  const api = useCallback(
    async (path = "", method = "GET", body?: unknown) => {
      const r = await fetch(root + path, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `Помилка ${r.status}`);
      return d;
    },
    [root],
  );
  const load = useCallback(async () => {
    const e = ++epoch.current;
    const [s, c, refreshedContext] = await Promise.all([
      api(),
      api("/chat"),
      contextOpen ? api("/context") : Promise.resolve(null),
    ]);
    if (e !== epoch.current) return;
    setState(s);
    if (refreshedContext) setContext(refreshedContext);
    setEvents((old) =>
      [
        ...new Map(
          [...old, ...c.events].map((e: Event) => [e.seq, e]),
        ).values(),
      ].sort((a, b) => a.seq - b.seq),
    );
    if (!olderHistoryLoaded.current) setHistoryCursor(c.nextBefore);
    setSelected((old) =>
      s.assets.some((a: CreativeAsset) => a.id === old)
        ? old
        : (s.assets[0]?.id ?? ""),
    );
  }, [api, contextOpen]);
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void load().catch((e) => {
        if (active) {
          setError(e.message);
          setState(null);
          setContext(null);
          setEvents([]);
        }
      });
    refresh();
    const t = setInterval(refresh, 5000);
    const ref = epoch;
    return () => {
      active = false;
      ref.current++;
      clearInterval(t);
    };
  }, [load]);
  const a = state?.assets.find((x) => x.id === selected),
    other = state?.assets.find(
      (x) => x.id === compare && x.rootId === a?.rootId,
    );
  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    setUrl("");
    setCompareUrl("");
    setPin(null);
    setConfirmed(false);
    const get = async (id: string, set: (v: string) => void) => {
      try {
        const r = await fetch(root + `/assets/${encodeURIComponent(id)}/file`, {
          credentials: "same-origin",
        });
        if (!r.ok) throw new Error("Файл більше недоступний.");
        const u = URL.createObjectURL(await r.blob());
        if (!active) {
          URL.revokeObjectURL(u);
          return;
        }
        urls.push(u);
        set(u);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    if (a) void get(a.id, setUrl);
    if (other) void get(other.id, setCompareUrl);
    return () => {
      active = false;
      urls.forEach(URL.revokeObjectURL);
    };
  }, [a?.id, other?.id, root, state?.permissions.work]);
  // A revoked workspace must stop displaying already-fetched content as well.
  useEffect(() => {
    if (!state) {
      setUrl("");
      setCompareUrl("");
    }
  }, [state]);
  async function action(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice(success);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const latest =
    !!a &&
    !state?.assets.some((x) => x.rootId === a.rootId && x.version > a.version);
  const canUpload = state?.permissions.work;
  const transitions = a
    ? state?.permissions.owner
      ? ((
          {
            DRAFT: ["SUBMITTED_FOR_REVIEW", "ARCHIVED"],
            SUBMITTED_FOR_REVIEW: ["CHANGES_REQUESTED", "APPROVED", "REJECTED"],
            CHANGES_REQUESTED: ["RESUBMITTED", "ARCHIVED"],
            RESUBMITTED: ["CHANGES_REQUESTED", "APPROVED", "REJECTED"],
            APPROVED: ["FINAL", "CHANGES_REQUESTED"],
            FINAL: ["ARCHIVED"],
            REJECTED: ["ARCHIVED"],
          } as Record<string, string[]>
        )[a.status] ?? [])
      : state?.permissions.work && a.createdBy === state.userId
        ? ((
            {
              DRAFT: ["SUBMITTED_FOR_REVIEW"],
              CHANGES_REQUESTED: ["RESUBMITTED"],
            } as Record<string, string[]>
          )[a.status] ?? [])
        : []
    : [];
  const name = (id: string) =>
    state?.participants.find((p) => p.id === id)?.name ?? id;
  const activity = (e: Event) => (
    <li key={e.id} className="break-words border-b border-slate-700 py-2">
      <small>
        {name(e.actorId)} · {new Date(e.createdAt).toLocaleString("uk-UA")}
      </small>
      <p>
        {e.type === "CHAT_MESSAGE"
          ? linkedText(e.text ?? "")
          : (labels[e.type] ?? e.type)}{" "}
        {e.to && `→ ${statuses[e.to] ?? e.to}`}
      </p>
      {e.note && <p>{e.note}</p>}
      {e.mentions?.map((id) => (
        <span key={id} className="mr-2">
          @{name(id)}
        </span>
      ))}
      {e.assetIds?.map((id) => (
        <button
          key={id}
          className="underline mr-2"
          onClick={() => {
            setSelected(id);
            setTab("Роботи");
          }}
        >
          Вкладення:{" "}
          {state?.assets.find((a) => a.id === id)?.filename ?? "матеріал"}
        </button>
      ))}
    </li>
  );
  async function upload(file: File, parent?: CreativeAsset) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    const safeMime =
      file.type ||
      (/\.glb$/i.test(file.name)
        ? "model/gltf-binary"
        : /\.zip$/i.test(file.name)
          ? "application/zip"
          : "");
    return api("/assets", "POST", {
      filename: file.name,
      ai: uploadAi,
      dataUrl: dataUrl.replace(/^data:[^;]*;/, `data:${safeMime};`),
      ...(parent
        ? { parentId: parent.id, expectedRevision: parent.revision }
        : {}),
    }).then((r) => setSelected(r.asset.id));
  }
  if (!state)
    return (
      <section aria-label="Creative Workspace">
        <h1 className="text-xl font-bold">Creative Workspace</h1>
        {error ? <p role="alert">{error}</p> : <p>Завантаження…</p>}
        <button
          className={button}
          onClick={() => void load().catch((e) => setError(e.message))}
        >
          Повторити
        </button>
      </section>
    );
  const specialist = state.participants.find((p) => p.role === "Фахівець");
  const accessPanel = state.permissions.owner ? (
    <section className="space-y-3 rounded border border-slate-700 p-3">
      <h2 className="font-bold">Окремий доступ до цього Workspace</h2>
      <p>
        Не відкриває всю медіатеку, сцени чи рукопис. Референси книги надаються
        окремо у брифі й доступі.
      </p>
      {specialist ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                api("/access", "POST", {
                  userId: specialist.id,
                  level: workspaceLevel,
                  confirmed: accessConfirm,
                  validFrom: validFrom
                    ? new Date(validFrom).toISOString()
                    : undefined,
                  validUntil: validUntil
                    ? new Date(validUntil).toISOString()
                    : null,
                }).then(() => setAccessConfirm(false)),
              "Доступ Workspace надано окремо від книги.",
            );
          }}
        >
          <p>Фахівець: {specialist.name}</p>
          <label className="block">
            Рівень
            <select
              className={field}
              value={workspaceLevel}
              onChange={(e) => setWorkspaceLevel(e.target.value)}
            >
              <option value="VIEW">VIEW — перегляд</option>
              <option value="COMMENT">COMMENT — коментарі</option>
              <option value="WORK">WORK — власні роботи й коментарі</option>
            </select>
          </label>
          <label className="block">
            Початок
            <input
              type="datetime-local"
              className={field}
              value={validFrom}
              onChange={(e) => setValidFrom(e.target.value)}
            />
          </label>
          <label className="block">
            Закінчення
            <input
              type="datetime-local"
              className={field}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </label>
          <label className="block">
            <input
              aria-label="Підтвердження доступу Workspace"
              type="checkbox"
              checked={accessConfirm}
              onChange={(e) => setAccessConfirm(e.target.checked)}
            />{" "}
            Явно надаю доступ тільки до цього Workspace
          </label>
          <button className={button} disabled={busy || !accessConfirm}>
            Надати доступ Workspace
          </button>
        </form>
      ) : (
        <p>Спершу синхронізуйте вибір фахівця в брифі.</p>
      )}
      {state.workspaceGrants
        .filter((g) => g.status === "active")
        .map((g) => (
          <p key={g.id}>
            {g.level === "edit" ? "WORK" : g.level.toUpperCase()} · до{" "}
            {g.validUntil ?? "відкликання"}{" "}
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                if (window.confirm("Відкликати цей доступ Workspace?"))
                  void action(
                    () =>
                      api(`/access/${g.id}/revoke`, "POST", {
                        confirmed: true,
                      }),
                    "Доступ Workspace відкликано.",
                  );
              }}
            >
              Відкликати
            </button>
          </p>
        ))}
    </section>
  ) : null;
  const left = (
    <aside className="min-w-0 space-y-4 rounded border border-slate-700 p-3">
      <h2 className="font-bold">Бриф і матеріали</h2>
      <p>{state.brief?.description ?? "Бриф ще не створено."}</p>
      <p>Результат: {state.brief?.result ?? "—"}</p>
      <p>Дедлайн: {state.brief?.deadline || "Не задано"}</p>
      <p>Стиль: {state.brief?.style || "Не задано"}</p>
      <p>ШІ: {state.brief?.aiPolicy ?? "Не задано"}</p>
      <h3>Checklist</h3>
      <ul>
        <li>Формат: {state.brief?.format || "—"}</li>
        <li>Розміри: {state.brief?.dimensions || "—"}</li>
        <li>Концепцій: {state.brief?.concepts ?? "—"}</li>
        <li>Раундів правок: {state.brief?.revisionRounds ?? "—"}</li>
        <li>Вихідні файли: {state.brief?.sourceFiles || "—"}</li>
      </ul>
      <h3>Дозволені сутності</h3>
      <ul>
        {state.entities.map((e) => (
          <li key={e.id}>
            {e.type}: {e.name}
          </li>
        ))}
      </ul>
      <h3>Референси книги</h3>
      {state.references.map((x) => (
        <a
          className="block underline"
          key={x.id}
          href={x.url}
          target="_blank"
          rel="noreferrer"
        >
          {x.title}
        </a>
      ))}
      <h3>Публічні референси брифу</h3>
      {state.brief?.references.map((x, i) => (
        <a
          className="block break-all underline"
          key={i}
          href={x}
          target="_blank"
          rel="noreferrer"
        >
          {x}
        </a>
      ))}
      <p>Style Bible: окремий етап Т7.6.</p>
      <button
        className={button}
        onClick={() =>
          void action(async () => {
            setContext(await api("/context"));
            setContextOpen(true);
          }, "Дозволений контекст завантажено.")
        }
      >
        Переглянути дозволений текст
      </button>
      {contextOpen && context && (
        <div className="max-h-80 overflow-auto whitespace-pre-wrap break-words">
          <button onClick={() => setContextOpen(false)}>Закрити текст</button>
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(context.context, null, 2)}
          </pre>
        </div>
      )}
    </aside>
  );
  const notes = (
    <section className="space-y-3">
      <h2 className="font-bold">Коментарі до версії {a?.version ?? "—"}</h2>
      {a &&
        state.annotations
          .filter((n) => n.assetId === a.id)
          .map((n) => (
            <article className="rounded border border-slate-700 p-2" key={n.id}>
              <p>
                {name(n.authorId)}: {n.text}
              </p>
              <small>
                {n.x !== null
                  ? `Pin ${Math.round(n.x * 100)}%, ${Math.round(n.y! * 100)}%`
                  : n.timecode !== null
                    ? `Таймкод ${n.timecode.toFixed(1)} с`
                    : "Текст"}{" "}
                · {n.status === "open" ? "Відкрито" : "Вирішено"}
              </small>
              {n.timecode !== null && (
                <button
                  className={button}
                  onClick={() => {
                    if (video.current?.readyState) {
                      video.current.currentTime = n.timecode!;
                    } else {
                      pendingSeek.current = n.timecode;
                    }
                    setTab("Роботи");
                  }}
                >
                  До таймкоду
                </button>
              )}
              {n.x !== null && (
                <button
                  className={button}
                  onClick={() => {
                    setPin({ x: n.x!, y: n.y! });
                    setTab("Роботи");
                  }}
                >
                  Показати pin
                </button>
              )}
              {n.status === "open" &&
                state.permissions.comment &&
                (state.permissions.owner || n.authorId === state.userId) && (
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void action(
                        () =>
                          api(`/annotations/${n.id}/resolve`, "POST", {
                            expectedRevision: n.revision,
                          }),
                        "Коментар закрито.",
                      )
                    }
                  >
                    Вирішено
                  </button>
                )}
            </article>
          ))}
      {a && state.permissions.comment && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                api("/annotations", "POST", {
                  assetId: a.id,
                  text: note,
                  ...(a.mimeType.startsWith("image/")
                    ? (pin ?? {})
                    : a.mimeType.startsWith("video/")
                      ? { timecode }
                      : {}),
                }).then(() => setNote("")),
              "Коментар збережено.",
            );
          }}
        >
          <label className="block">
            Коментар
            <textarea
              className={field}
              required
              maxLength={4000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {a.mimeType.startsWith("image/") ? (
            <p>
              {pin
                ? `Pin: ${Math.round(pin.x * 100)}%, ${Math.round(pin.y * 100)}%`
                : "Натисніть точку на зображенні."}
            </p>
          ) : a.mimeType.startsWith("video/") ? (
            <label>
              Таймкод, секунд
              <input
                type="number"
                className={field}
                min={0}
                max={86400}
                step="0.1"
                value={timecode}
                onChange={(e) => setTimecode(Number(e.target.value))}
              />
            </label>
          ) : null}
          <button
            className={button}
            disabled={busy || (a.mimeType.startsWith("image/") && !pin)}
          >
            Додати коментар
          </button>
        </form>
      )}
    </section>
  );
  const chat = (
    <section className="space-y-3">
      <h2 className="font-bold">Чат і системні події</h2>
      <p className="text-sm">
        Оновлення кожні 5 секунд. Непрочитаних подій: {state.unread}.
      </p>
      {historyCursor && (
        <button
          className={button}
          onClick={() =>
            void action(async () => {
              const old = await api(`/chat?before=${historyCursor}`);
              olderHistoryLoaded.current = true;
              setEvents((v) => [...old.events, ...v]);
              setHistoryCursor(old.nextBefore);
            }, "Історію завантажено.")
          }
        >
          Попередні події
        </button>
      )}
      <ol className="max-h-80 overflow-auto">{events.map(activity)}</ol>
      {events.length > 0 && (
        <button
          className={button}
          onClick={() =>
            void action(
              () => api("/read", "POST", { seq: events.at(-1)!.seq }),
              "Позначено прочитаним.",
            )
          }
        >
          Позначити прочитаним
        </button>
      )}
      {state.permissions.comment && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            void action(
              () =>
                api("/chat", "POST", {
                  text: message,
                  mentions: mention ? [mention] : [],
                  assetIds: attachment ? [attachment] : [],
                }).then(() => {
                  setMessage("");
                  setMention("");
                  setAttachment("");
                }),
              "Повідомлення надіслано.",
            );
          }}
        >
          <label className="block">
            Повідомлення
            <textarea
              aria-label="Повідомлення"
              className={field}
              required
              maxLength={4000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label className="block">
            Згадати
            <select
              className={field}
              value={mention}
              onChange={(e) => setMention(e.target.value)}
            >
              <option value="">Без згадування</option>
              {state.participants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            Вкладення
            <select
              className={field}
              value={attachment}
              onChange={(e) => setAttachment(e.target.value)}
            >
              <option value="">Без вкладення</option>
              {state.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.filename} v{a.version}
                </option>
              ))}
            </select>
          </label>
          <button className={button} disabled={busy}>
            Надіслати
          </button>
        </form>
      )}
    </section>
  );
  const viewer = (
    <section className="min-w-0 space-y-3 rounded border border-slate-700 p-3">
      <h2 className="font-bold">Роботи й версії</h2>
      <label className="block">
        Матеріал
        <select
          aria-label="Матеріал"
          className={field}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Оберіть матеріал</option>
          {state.assets.map((x) => (
            <option value={x.id} key={x.id}>
              {x.filename} · v{x.version} · {statuses[x.status]}
            </option>
          ))}
        </select>
      </label>
      {canUpload && (
        <div className="space-y-2">
          <AiDeclarationFields value={uploadAi} onChange={setUploadAi} />
          <label className="block">
            Нова робота
            <input
              aria-label="Нова робота"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,application/pdf,application/zip,.glb"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void action(() => upload(f), "Нову роботу збережено.");
              }}
            />
          </label>
          {a &&
            latest &&
            !["FINAL", "ARCHIVED"].includes(a.status) &&
            (state.permissions.owner || a.createdBy === state.userId) && (
              <label className="block">
                Нова версія вибраної роботи
                <input
                  aria-label="Нова версія вибраної роботи"
                  type="file"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f)
                      void action(
                        () => upload(f, a),
                        "Нову версію додано, попередня збережена.",
                      );
                  }}
                />
              </label>
            )}
          <p className="text-sm">
            До 20 МБ. Файли залишаються приватними. Нова версія починається як
            чернетка.
          </p>
        </div>
      )}
      {a && (
        <>
          <p>
            v{a.version} · {statuses[a.status]} · {name(a.createdBy)} ·{" "}
            {(a.bytes / 1024).toFixed(1)} КБ
          </p>
          {a.approvedBy && (
            <p>
              Затвердив: {name(a.approvedBy)} · {a.approvedAt}
            </p>
          )}
          {state.permissions.owner && state.permissions.work && ['APPROVED', 'FINAL'].includes(a.status) && <WorkspaceMediaTransfer key={a.id} asset={a} targets={state.mediaTargets} busy={busy} onTransfer={metadata => void action(() => api(`/assets/${a.id}/library`, 'POST', { expectedRevision: a.revision, confirmed: true, metadata }), `Версію v${a.version} збережено в медіатеці зі збереженням походження.`)} />}
          <p>ШІ: {a.ai?.used === true ? `${a.ai.provider} / ${a.ai.model}` : a.ai?.used === false ? 'не використано' : 'не заявлено'}</p>
          <div className="flex flex-wrap gap-2">
            <label>
              Масштаб
              <input
                aria-label="Масштаб"
                type="range"
                min={50}
                max={200}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              />
              {zoom}%
            </label>
            <button
              className={button}
              onClick={() =>
                void canvas.current
                  ?.requestFullscreen?.()
                  .catch((e) => setError(e.message))
              }
            >
              На весь екран
            </button>
            {url && (
              <a className={button} href={url} download={a.filename}>
                Завантажити файл
              </a>
            )}
          </div>
          <label className="block">
            Порівняти з версією
            <select
              className={field}
              aria-label="Порівняти з версією"
              value={compare}
              onChange={(e) => setCompare(e.target.value)}
            >
              <option value="">Без порівняння</option>
              {state.assets
                .filter((x) => x.rootId === a.rootId && x.id !== a.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    v{x.version}: {x.filename}
                  </option>
                ))}
            </select>
          </label>
          {other &&
            a.mimeType.startsWith("image/") &&
            other.mimeType.startsWith("image/") && (
              <>
                <label>
                  Режим
                  <select
                    className={field}
                    aria-label="Режим порівняння"
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="side">Поруч</option>
                    <option value="before">До / після</option>
                    <option value="overlay">Накладання</option>
                  </select>
                </label>
                {mode !== "side" && (
                  <label>
                    Положення / прозорість
                    <input
                      aria-label="Положення порівняння"
                      type="range"
                      min={0}
                      max={100}
                      value={blend}
                      onChange={(e) => setBlend(Number(e.target.value))}
                    />
                  </label>
                )}
              </>
            )}
          <div
            ref={canvas}
            className="max-w-full overflow-auto rounded bg-slate-900 p-2"
          >
            <div
              className="relative"
              style={{ width: `${zoom}%`, minWidth: "50%" }}
            >
              {url && a.mimeType.startsWith("image/") ? (
                <div
                  className={
                    other && mode === "side"
                      ? "grid grid-cols-2 gap-2"
                      : "relative"
                  }
                >
                  <div className="relative">
                    <img
                      alt={`${a.filename}, версія ${a.version}`}
                      src={url}
                      className="block w-full"
                      onClick={(e) => {
                        const box = e.currentTarget.getBoundingClientRect();
                        setPin({
                          x: (e.clientX - box.left) / box.width,
                          y: (e.clientY - box.top) / box.height,
                        });
                      }}
                    />
                    {pin && (
                      <span
                        aria-label="Вибрана точка"
                        className="absolute rounded-full bg-red-500 p-1"
                        style={{
                          left: `${pin.x * 100}%`,
                          top: `${pin.y * 100}%`,
                          transform: "translate(-50%,-50%)",
                        }}
                      >
                        ●
                      </span>
                    )}
                  </div>
                  {compareUrl && other?.mimeType.startsWith("image/") && (
                    <img
                      alt={`Попередня версія ${other.version}`}
                      src={compareUrl}
                      className={
                        mode === "side"
                          ? "block w-full"
                          : "absolute inset-0 h-full w-full object-contain pointer-events-none"
                      }
                      style={
                        mode === "overlay"
                          ? { opacity: blend / 100 }
                          : mode === "before"
                            ? { clipPath: `inset(0 ${100 - blend}% 0 0)` }
                            : {}
                      }
                    />
                  )}
                </div>
              ) : url && a.mimeType.startsWith("video/") ? (
                <video
                  ref={video}
                  aria-label="Перегляд відео"
                  src={url}
                  controls
                  className="w-full"
                  onLoadedMetadata={(e) => {
                    if (pendingSeek.current !== null) {
                      e.currentTarget.currentTime = Math.min(
                        pendingSeek.current,
                        e.currentTarget.duration,
                      );
                      pendingSeek.current = null;
                    }
                  }}
                  onTimeUpdate={(e) => setTimecode(e.currentTarget.currentTime)}
                />
              ) : url && a.mimeType.startsWith("audio/") ? (<audio src={url} controls className="max-w-full" />) : url && a.mimeType === "application/pdf" ? (
                <iframe
                  title="Перегляд PDF"
                  src={url}
                  className="h-96 w-full"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <p>Цей формат доступний для завантаження.</p>
              )}
            </div>
          </div>
          {other && compareUrl && !a.mimeType.startsWith("image/") && (
            <a
              className="underline"
              href={compareUrl}
              download={other.filename}
            >
              Попередня версія v{other.version}
            </a>
          )}
          {latest && transitions.length > 0 && (
            <section className="space-y-2">
              <h3>Перевірка</h3>
              <label className="block">
                Причина / правки
                <textarea
                  className={field}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  maxLength={4000}
                />
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  aria-label="Підтвердити рішення"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                Підтверджую рішення для цієї версії
              </label>
              <div className="flex flex-wrap gap-2">
                {transitions.map((status) => (
                  <button
                    key={status}
                    className={button}
                    disabled={busy || !confirmed}
                    onClick={() =>
                      void action(
                        () =>
                          api(`/assets/${a.id}/state`, "POST", {
                            status,
                            expectedRevision: a.revision,
                            confirmed,
                            note: reviewNote,
                          }).then(() => setConfirmed(false)),
                        `Статус: ${statuses[status]}.`,
                      )
                    }
                  >
                    {statuses[status]}
                  </button>
                ))}
              </div>
              <p className="text-sm">
                Затвердження не додає матеріал до канону й не змінює рукопис.
              </p>
            </section>
          )}
        </>
      )}
    </section>
  );
  return (
    <section className="space-y-4 min-w-0" aria-label="Creative Workspace">
      <header>
        <a className="underline" href={buildCreativeBiblePath(state.project.bookId, API_BASE)}>Visual Bible і Style Bible</a>
      <h1 className="text-2xl font-bold">
          {state.project.title} — Creative Workspace
        </h1>
        <p>
          {state.project.status} ·{" "}
          {state.permissions.owner
            ? "Власник"
            : state.permissions.work
              ? "Робота з матеріалами"
              : "Лише перегляд"}
        </p>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Вкладки Workspace">
        {tabs.map((t) => (
          <button
            key={t}
            aria-pressed={tab === t}
            className={button + (tab === t ? " bg-teal-800" : "")}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      {error && (
        <p role="alert" className="text-red-400">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-teal-300">
          {notice}
        </p>
      )}
      {tab === "Огляд" ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          {left}
          {viewer}
          <aside className="min-w-0 space-y-4 rounded border border-slate-700 p-3">
            {notes}
            {chat}
          </aside>
        </div>
      ) : tab === "Бриф" || tab === "Матеріали" ? (
        left
      ) : tab === "Роботи" || tab === "Версії" ? (
        viewer
      ) : tab === "Коментарі" ? (
        notes
      ) : tab === "Чат" ? (
        chat
      ) : tab === "Учасники" ? (
        <div>
          {accessPanel}
          <ul>
            {state.participants.map((p) => (
              <li key={p.id}>
                {p.name} — {p.role}
              </li>
            ))}
          </ul>
        </div>
      ) : tab === "Історія" ? (
        <section>
          <h2>Історія — події останнього завантаженого пакета</h2>
          <ol>
            {events.filter((e) => e.type !== "CHAT_MESSAGE").map(activity)}
          </ol>
          {historyCursor && (
            <button className={button} onClick={() => setTab("Чат")}>
              Попередні події в чаті
            </button>
          )}
        </section>
      ) : (
        <section>
          <h2>AI Tools</h2>
          <p>
            Бриф: ШІ {state.brief?.aiPolicy ?? "не задано"}. Використання
            провайдерів і квоти залишається у наявній AI Studio, з перевіркою
            доступу на сервері. Автоматичної генерації або затвердження тут
            немає.
          </p>
          <a
            className="underline"
            href={
              buildAppPath(
                { projectId: state.project.bookId, tab: "ai-studio" },
                API_BASE,
              ) ?? "#"
            }
          >
            Відкрити AI Studio
          </a>
        </section>
      )}
    </section>
  );
}

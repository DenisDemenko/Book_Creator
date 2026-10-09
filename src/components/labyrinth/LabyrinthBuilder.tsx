import { RouteDescription } from "./RouteDescription";
import { ReferenceMaze, hasSvgPoint } from "./ReferenceMaze";
import svgExample from "../../../shared/labyrinthSvgExample.json";
import React, { useEffect, useState } from "react";
import {
  Background,
  Controls,
  ReactFlow,
  type Connection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Book } from "../../types";
import type {
  LabyrinthDefinition,
  LabyrinthVersion,
  LabyrinthRun,
  ObjectCondition,
} from "../../../shared/labyrinth";
import {
  analyzeLabyrinth,
  blankLabyrinth,
  type DesignIssue,
} from "../../../shared/labyrinthDesign";
import { labyrinthDemo } from "../../../shared/labyrinthDemo";
import { gs } from "../graphStudio/gsApi";
const cls =
  "w-full rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100";
const btn =
  "rounded-lg border border-slate-600 px-3 py-2 text-sm hover:bg-slate-700 disabled:opacity-40";
function Text({
  label,
  value,
  onChange,
  area = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  area?: boolean;
}) {
  return (
    <label className="block space-y-1 text-xs">
      {label}
      {area ? (
        <textarea
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className={cls}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Num({
  label,
  value,
  onChange,
  min = 0,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
}) {
  return (
    <label className="block text-xs">
      {label}
      <input
        className={cls}
        type="number"
        min={min}
        step="1"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function Pick({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block text-xs">
      {label}
      <select
        className={cls}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Multi({
  label,
  values,
  options,
  onChange,
}: {
  label: string;
  values: string[];
  options: [string, string][];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-700 p-2">
      <legend className="text-xs">{label}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map(([id, name]) => (
          <label key={id} className="text-xs">
            <input
              type="checkbox"
              checked={values.includes(id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, id]
                    : values.filter((v) => v !== id),
                )
              }
            />{" "}
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function Rules({
  label,
  value,
  d,
  onChange,
  exclude,
}: {
  label: string;
  value: ObjectCondition[];
  d: LabyrinthDefinition;
  onChange: (v: ObjectCondition[]) => void;
  exclude?: string;
}) {
  const objects = d.objects.filter((o) => o.id !== exclude);
  return (
    <fieldset className="space-y-2 rounded-lg border border-slate-700 p-2">
      <legend>{label}</legend>
      {value.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
          <Pick
            label="Об’єкт правила"
            value={r.objectId}
            options={objects.map((o) => [o.id, o.id])}
            onChange={(id) =>
              onChange(
                value.map((v, j) =>
                  j === i
                    ? {
                        objectId: id,
                        state: objects.find((o) => o.id === id)!.states[0],
                      }
                    : v,
                ),
              )
            }
          />
          <Pick
            label="Стан правила"
            value={r.state}
            options={(
              d.objects.find((o) => o.id === r.objectId)?.states ?? []
            ).map((s) => [s, s])}
            onChange={(state) =>
              onChange(value.map((v, j) => (j === i ? { ...v, state } : v)))
            }
          />
          <button
            type="button"
            className={btn}
            aria-label="Видалити правило"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={btn}
        disabled={!objects.length}
        onClick={() =>
          onChange([
            ...value,
            { objectId: objects[0].id, state: objects[0].states[0] },
          ])
        }
      >
        Додати правило
      </button>
    </fieldset>
  );
}
const edgeNames: [string, string][] = [
  ["corridor", "Коридор"],
  ["bridge", "Міст"],
  ["stairs", "Сходи"],
  ["ladder", "Драбина"],
  ["lift", "Підйомник"],
];
const objectNames: [string, string][] = [
  ["door", "Двері"],
  ["gate", "Решітка"],
  ["switch", "Перемикач"],
  ["generator", "Генератор"],
  ["barrier", "Бар’єр"],
  ["cache", "Схованка"],
  ["bridge_mechanism", "Механізм мосту"],
];
export function LabyrinthBuilder({
  book,
  onOpenSection,
  onDirtyChange,
}: {
  book: Book;
  onOpenSection?: (chapterId: string, sectionId: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const base = `/api/core/projects/${encodeURIComponent(book.id)}/labyrinth`;
  const [d, setD] = useState(() => blankLabyrinth(book.title)),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(true),
    [allowed, setAllowed] = useState(false);
  const [maps, setMaps] = useState<
      (Omit<LabyrinthVersion, "definition"> & { title: string })[]
    >([]),
    [versions, setVersions] = useState<Omit<LabyrinthVersion, "definition">[]>(
      [],
    ),
    [mapId, setMapId] = useState(""),
    [head, setHead] = useState(0),
    [loaded, setLoaded] = useState(0);
  const [mapView, setMapView] = useState("graph");
  const svgMap = d.nodes.some((n) => n.id.startsWith("svg-cell-"));
  const [notice, setNotice] = useState(""),
    [issues, setIssues] = useState<DesignIssue[] | null>(null),
    [tab, setTab] = useState("nodes"),
    [selected, setSelected] = useState("entry"),
    [level, setLevel] = useState("both"),
    [run, setRun] = useState<LabyrinthRun | null>(null);
  const nodeOptions: [string, string][] = d.nodes.map((n) => [
    n.id,
    `${n.title} (${n.level === "upper" ? "верх" : "низ"})`,
  ]);
  const sections = book.chapters.flatMap((c) =>
    c.sections.map((s) => ({
      chapterId: c.id,
      id: s.id,
      title: `${c.title} / ${s.title}`,
    })),
  );
  useEffect(() => {
    let active = true;
    gs<{ maps: typeof maps }>("GET", `${base}/maps`)
      .then((r) => {
        if (active) {
          setMaps(r.maps);
          setAllowed(true);
        }
      })
      .catch((e) => {
        if (active) setNotice(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [base]);
  useEffect(() => {
    onDirtyChange?.(dirty);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, onDirtyChange]);
  const edit = (next: LabyrinthDefinition) => {
    setD(next);
    setDirty(true);
    setIssues(null);
    setRun(null);
  };
  const update = <
    K extends "nodes" | "edges" | "objects" | "events" | "heroes",
  >(
    key: K,
    id: string,
    patch: Partial<LabyrinthDefinition[K][number]>,
  ) =>
    edit({
      ...d,
      [key]: d[key].map((v) => (v.id === id ? { ...v, ...patch } : v)),
    });
  const uid = (prefix: string) =>
    `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const replace = () =>
    !dirty || window.confirm("Незбережені зміни буде втрачено. Продовжити?");
  const load = async (id: string, revision: number, latest: number) => {
    if (!replace()) return;
    await act(async () => {
      const v = await gs<LabyrinthVersion>(
        "GET",
        `${base}/maps/${id}/versions/${revision}`,
      );
      const list = await gs<{ versions: typeof versions }>(
        "GET",
        `${base}/maps/${id}/versions`,
      );
      setD(v.definition);
      setMapId(id);
      setHead(latest);
      setLoaded(revision);
      setVersions(list.versions);
      setSelected(v.definition.startNodeId);
      setDirty(false);
      setIssues(null);
      setRun(null);
    });
  };
  const save = (asNew = false) =>
    act(async () => {
      const result = await gs<{ issues: DesignIssue[] }>(
        "POST",
        `${base}/validate`,
        { definition: d },
      );
      setIssues(result.issues);
      const v = await gs<LabyrinthVersion>(
        "POST",
        mapId && !asNew ? `${base}/maps/${mapId}/versions` : `${base}/maps`,
        { definition: d, expectedRevision: asNew ? 0 : head },
      );
      setD(v.definition);
      setMapId(v.mapId);
      setHead(v.revision);
      setLoaded(v.revision);
      setDirty(false);
      setRun(null);
      setMaps((await gs<{ maps: typeof maps }>("GET", `${base}/maps`)).maps);
      setVersions(
        (
          await gs<{ versions: typeof versions }>(
            "GET",
            `${base}/maps/${v.mapId}/versions`,
          )
        ).versions,
      );
      setNotice(
        `Збережено v${v.revision}. Це авторська версія, не публікація гри.`,
      );
    });
  const reset = (demo = false) => {
    if (!replace()) return;
    setD(demo ? structuredClone(labyrinthDemo) : blankLabyrinth(book.title));
    setMapId("");
    setHead(0);
    setLoaded(0);
    setVersions([]);
    setRun(null);
    setDirty(true);
    setIssues(null);
    setSelected(demo ? "lower-entry" : "entry");
  };
  const addNode = () => {
    const id = uid("node");
    edit({
      ...d,
      nodes: [
        ...d.nodes,
        {
          id,
          title: "Нова сцена",
          level: level === "upper" ? "upper" : "lower",
          x: d.nodes.length * 2,
          y: 0,
          sceneId: null,
          description: "",
          cover: false,
        },
      ],
    });
    setSelected(id);
    setTab("nodes");
  };
  const connect = (c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const a = d.nodes.find((n) => n.id === c.source)!,
      b = d.nodes.find((n) => n.id === c.target)!;
    const id = uid("edge");
    edit({
      ...d,
      edges: [
        ...d.edges,
        {
          id,
          from: a.id,
          to: b.id,
          kind:
            a.level !== b.level
              ? "stairs"
              : a.level === "upper"
                ? "bridge"
                : "corridor",
          bidirectional: true,
          duration: 1,
          costs: {},
          conditions: [],
          overNodeIds: [],
        },
      ],
    });
    setSelected(id);
    setTab("edges");
  };
  const remove = (
    key: "nodes" | "edges" | "objects" | "events",
    id: string,
  ) => {
    if (
      !window.confirm(
        "Видалити елемент? Посилання на нього потрібно виправити перед збереженням.",
      )
    )
      return;
    edit({ ...d, [key]: d[key].filter((v) => v.id !== id) });
    setSelected("");
  };
  const visible = d.nodes.filter((n) => level === "both" || n.level === level);
  const shown = new Set(visible.map((n) => n.id));
  const staticIssues = issues ?? analyzeLabyrinth(d);
  if (!allowed)
    return (
      <div className="p-5" role="status">
        {busy ? "Завантаження доступу до лабіринта…" : notice}
      </div>
    );
  const node = d.nodes.find((n) => n.id === selected),
    edge = d.edges.find((e) => e.id === selected),
    object = d.objects.find((o) => o.id === selected),
    event = d.events.find((e) => e.id === selected);
  return (
    <section
      className="space-y-4 rounded-xl bg-slate-900 p-3 text-slate-100"
      data-labyrinth-builder
    >
      <header>
        <h2 className="text-lg font-bold">Книга-лабіринт</h2>
        <p className="text-sm text-slate-300">
          Карта й правила проходження. Текст сцен редагується у наявному
          редакторі книги. Події поки є шаблонами; повний рушій — наступний
          етап.
        </p>
        <p role="status">
          {dirty
            ? "Є незбережені зміни"
            : loaded
              ? `Відкрита v${loaded}; остання v${head}`
              : "Нова карта"}
        </p>
      </header>
      {notice && (
        <p className="rounded-lg border border-amber-500 p-3" role="alert">
          {notice}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={() => reset()}>
            Нова карта
          </button>
          <button className={btn} onClick={() => reset(true)}>
            Дворівневий приклад
          </button>
          <button
            className={btn}
            onClick={() => {
              if (!replace()) return;
              setD(structuredClone(svgExample) as LabyrinthDefinition);
              setMapId("");
              setHead(0);
              setLoaded(0);
              setVersions([]);
              setRun(null);
              setDirty(true);
              setIssues(null);
              setSelected("svg-cell-0-0");
              setMapView("svg");
            }}
          >
            Приклад із вашого SVG
          </button>
          <button className={btn} onClick={() => void save()}>
            Зберегти версію
          </button>
          <button
            className={btn}
            disabled={!mapId}
            onClick={() =>
              void act(async () => {
                const list = (
                  await gs<{ maps: typeof maps }>("GET", `${base}/maps`)
                ).maps;
                setMaps(list);
                const latest = list.find((v) => v.mapId === mapId);
                if (latest) await load(mapId, latest.revision, latest.revision);
              })
            }
          >
            Завантажити останню версію
          </button>
          <button className={btn} onClick={() => void save(true)}>
            Зберегти як нову карту
          </button>
          <button
            className={btn}
            onClick={() =>
              void act(async () => {
                setIssues(
                  (
                    await gs<{ issues: DesignIssue[] }>(
                      "POST",
                      `${base}/validate`,
                      { definition: d },
                    )
                  ).issues,
                );
                setNotice("Серверна перевірка структури й посилань виконана.");
              })
            }
          >
            Перевірити карту
          </button>
          <button
            className={btn}
            disabled={dirty || !loaded}
            onClick={() =>
              void act(async () => {
                setRun(
                  await gs<LabyrinthRun>("POST", `${base}/maps/${mapId}/runs`, {
                    mapRevision: loaded,
                    seed: crypto.randomUUID(),
                  }),
                );
              })
            }
          >
            Тестовий прогін
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Pick
            label="Збережена карта"
            value={mapId}
            options={[
              ["", "Виберіть карту"],
              ...maps.map(
                (v) =>
                  [
                    v.mapId,
                    `${v.title} · ${v.mapId.slice(0, 8)} · v${v.revision}`,
                  ] as [string, string],
              ),
            ]}
            onChange={(id) => {
              const m = maps.find((v) => v.mapId === id);
              if (m) void load(id, m.revision, m.revision);
            }}
          />
          <Pick
            label="Версія карти"
            value={String(loaded)}
            options={[
              ["0", "Нова"],
              ...versions.map(
                (v) =>
                  [
                    String(v.revision),
                    `v${v.revision} · ${new Date(v.createdAt).toLocaleString("uk-UA")}`,
                  ] as [string, string],
              ),
            ]}
            onChange={(v) => {
              if (Number(v)) void load(mapId, Number(v), head);
            }}
          />
          <Text
            label="Назва карти"
            value={d.title}
            onChange={(title) => edit({ ...d, title })}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Pick
            label="Вхід карти"
            value={d.startNodeId}
            options={nodeOptions}
            onChange={(startNodeId) => edit({ ...d, startNodeId })}
          />
          <Multi
            label="Виходи"
            values={d.exitNodeIds}
            options={nodeOptions}
            onChange={(exitNodeIds) => edit({ ...d, exitNodeIds })}
          />
        </div>
        <Pick
          label="Рівень карти"
          value={level}
          options={[
            ["both", "Обидва рівні"],
            ["lower", "Нижні коридори"],
            ["upper", "Верхні мости"],
          ]}
          onChange={setLevel}
        />
        {svgMap && (
          <div className="flex gap-2">
            <button
              className={btn}
              aria-pressed={mapView === "svg"}
              onClick={() => setMapView("svg")}
            >
              Зразок SVG
            </button>
            <button
              className={btn}
              aria-pressed={mapView === "graph"}
              onClick={() => setMapView("graph")}
            >
              Граф карти
            </button>
          </div>
        )}
        {svgMap &&
        mapView === "svg" &&
        (!run ||
          Object.values(run.state.heroes).every((h) =>
            hasSvgPoint(h.nodeId),
          )) ? (
          <ReferenceMaze heroes={run?.state.heroes ?? {}} />
        ) : (
          <div
            className="h-[420px] rounded-lg border border-slate-600"
            data-labyrinth-canvas
          >
            <ReactFlow
              key={`${mapId}-${loaded}-${level}-${d.nodes.length}`}
              nodes={visible.map((n) => ({
                id: n.id,
                width: 180,
                height: 64,
                measured: { width: 180, height: 64 },
                position: {
                  x: n.x * 160,
                  y: n.y * 160 + (n.level === "upper" ? -350 : 0),
                },
                ariaLabel: `${n.title}${
                  run
                    ? Object.entries(run.state.heroes)
                        .filter(([, h]) => h.nodeId === n.id)
                        .map(
                          ([id]) =>
                            ` · Герой ${d.heroes.find((h) => h.id === id)?.name ?? id} тут`,
                        )
                        .join("")
                    : ""
                }`,
                data: {
                  label: `${n.level === "upper" ? "↑" : "↓"} ${n.title}${d.exitNodeIds.includes(n.id) ? " · Вихід" : ""}${run && Object.values(run.state.heroes).some((h) => h.nodeId === n.id) ? " · 📍 Герой тут" : ""}`,
                },
                style: {
                  width: 180,
                  height: 64,
                  color: "#0f172a",
                  background: n.level === "upper" ? "#dbeafe" : "#dcfce7",
                  border:
                    run &&
                    Object.values(run.state.heroes).some(
                      (h) => h.nodeId === n.id,
                    )
                      ? "4px solid #facc15"
                      : selected === n.id
                        ? "3px solid #d97706"
                        : "1px solid #475569",
                },
              }))}
              edges={d.edges
                .filter((e) => shown.has(e.from) && shown.has(e.to))
                .map((e) => ({
                  id: e.id,
                  source: e.from,
                  target: e.to,
                  label: edgeNames.find((k) => k[0] === e.kind)?.[1],
                  style: {
                    stroke: e.kind === "bridge" ? "#38bdf8" : "#a3e635",
                  },
                }))}
              onNodeClick={(_, n) => {
                setSelected(n.id);
                setTab("nodes");
              }}
              onEdgeClick={(_, e) => {
                setSelected(e.id);
                setTab("edges");
              }}
              onNodeDragStop={(_, n) => {
                const original = d.nodes.find((v) => v.id === n.id)!;
                update("nodes", n.id, {
                  x: Math.round(n.position.x / 160),
                  y: Math.round(
                    (n.position.y - (original.level === "upper" ? -350 : 0)) /
                      160,
                  ),
                });
              }}
              nodesDraggable={!busy}
              nodesConnectable={!busy}
              onConnect={connect}
              fitView
              minZoom={0.1}
            >
              <Background />
              <Controls style={{ color: "#0f172a" }} />
            </ReactFlow>
          </div>
        )}
        <p className="text-xs text-slate-300">
          ↑ верхній, ↓ нижній рівень. Перетягування змінює координати; переходи
          можна створити з’єднанням вузлів або формою нижче.
        </p>
        <nav className="flex flex-wrap gap-2" aria-label="Елементи лабіринта">
          {[
            ["nodes", "Сцени"],
            ["edges", "Переходи"],
            ["objects", "Механізми"],
            ["events", "Події"],
            ["heroes", "Герої"],
          ].map(([id, title]) => (
            <button
              className={btn}
              aria-pressed={tab === id}
              key={id}
              onClick={() => {
                setTab(id);
                setSelected(d[id as "nodes"][0]?.id ?? "");
              }}
            >
              {title}
            </button>
          ))}
        </nav>
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="max-h-[480px] overflow-y-auto space-y-2">
            {tab !== "heroes" && (
              <button
                className={btn}
                onClick={() => {
                  if (tab === "nodes") {
                    addNode();
                    return;
                  }
                  if (tab === "edges") {
                    if (d.nodes.length < 2) return;
                    connect({
                      source: d.nodes[0].id,
                      target: d.nodes[1].id,
                      sourceHandle: null,
                      targetHandle: null,
                    });
                    return;
                  }
                  const id = uid(tab === "objects" ? "object" : "event");
                  if (tab === "objects")
                    edit({
                      ...d,
                      objects: [
                        ...d.objects,
                        {
                          id,
                          nodeId: d.startNodeId,
                          entityId: null,
                          kind: "switch",
                          states: ["on", "off"],
                          initialState: "on",
                          transitions: [
                            {
                              from: "on",
                              to: "off",
                              conditions: [],
                              effects: [],
                            },
                            {
                              from: "off",
                              to: "on",
                              conditions: [],
                              effects: [],
                            },
                          ],
                        },
                      ],
                    });
                  else
                    edit({
                      ...d,
                      events: [
                        ...d.events,
                        {
                          id,
                          nodeIds: [d.startNodeId],
                          conditions: [],
                          warning: "Попередження про небезпеку",
                          preparation: 2,
                          duration: 3,
                          cooldown: 5,
                          effects: [],
                          avoidance: "Опишіть шлях обходу",
                        },
                      ],
                    });
                  setSelected(id);
                }}
              >
                Додати{" "}
                {tab === "nodes"
                  ? "сцену"
                  : tab === "edges"
                    ? "перехід"
                    : tab === "objects"
                      ? "механізм"
                      : "подію"}
              </button>
            )}
            {d[tab as "nodes" | "edges" | "objects" | "events" | "heroes"].map(
              (v) => (
                <button
                  key={v.id}
                  className={`${btn} block w-full text-left ${selected === v.id ? "border-amber-400" : ""}`}
                  onClick={() => setSelected(v.id)}
                >
                  {"title" in v ? v.title : v.id}
                </button>
              ),
            )}
          </aside>
          <div className="space-y-3">
            {tab === "nodes" && node && (
              <>
                <Text
                  label="Назва сцени"
                  value={node.title}
                  onChange={(title) => update("nodes", node.id, { title })}
                />
                <Pick
                  label="Рівень сцени"
                  value={node.level}
                  options={[
                    ["lower", "Нижній"],
                    ["upper", "Верхній"],
                  ]}
                  onChange={(v) =>
                    update("nodes", node.id, { level: v as "lower" | "upper" })
                  }
                />
                <div className="grid grid-cols-2 gap-2">
                  <Num
                    label="X"
                    value={node.x}
                    min={-10000}
                    onChange={(x) => update("nodes", node.id, { x })}
                  />
                  <Num
                    label="Y"
                    value={node.y}
                    min={-10000}
                    onChange={(y) => update("nodes", node.id, { y })}
                  />
                </div>
                <Text
                  label="Опис місця (не текст рукопису)"
                  area
                  value={node.description}
                  onChange={(description) =>
                    update("nodes", node.id, { description })
                  }
                />
                <Pick
                  label="Сцена з книги"
                  value={node.sceneId ?? ""}
                  options={[
                    ["", "Без прив’язки"],
                    ...sections.map((s) => [s.id, s.title] as [string, string]),
                  ]}
                  onChange={(sceneId) =>
                    update("nodes", node.id, { sceneId: sceneId || null })
                  }
                />
                <button
                  className={btn}
                  disabled={!node.sceneId || dirty}
                  onClick={() => {
                    const s = sections.find((s) => s.id === node.sceneId);
                    if (s) onOpenSection?.(s.chapterId, s.id);
                  }}
                >
                  Відкрити текст у редакторі
                </button>
                <label className="block">
                  <input
                    type="checkbox"
                    checked={node.cover}
                    onChange={(e) =>
                      update("nodes", node.id, { cover: e.target.checked })
                    }
                  />{" "}
                  Є укриття
                </label>
                <button
                  className={btn}
                  onClick={() => remove("nodes", node.id)}
                >
                  Видалити сцену
                </button>
              </>
            )}
            {tab === "edges" && edge && (
              <>
                <Pick
                  label="Звідки"
                  value={edge.from}
                  options={nodeOptions}
                  onChange={(from) => update("edges", edge.id, { from })}
                />
                <Pick
                  label="Куди"
                  value={edge.to}
                  options={nodeOptions}
                  onChange={(to) => update("edges", edge.id, { to })}
                />
                <Pick
                  label="Тип переходу"
                  value={edge.kind}
                  options={edgeNames}
                  onChange={(kind) =>
                    update("edges", edge.id, {
                      kind: kind as typeof edge.kind,
                      overNodeIds: kind === "bridge" ? edge.overNodeIds : [],
                    })
                  }
                />
                <label className="block">
                  <input
                    type="checkbox"
                    checked={edge.bidirectional}
                    onChange={(e) =>
                      update("edges", edge.id, {
                        bidirectional: e.target.checked,
                      })
                    }
                  />{" "}
                  Двосторонній
                </label>
                <Num
                  label="Тривалість переходу"
                  min={1}
                  value={edge.duration}
                  onChange={(duration) =>
                    update("edges", edge.id, { duration })
                  }
                />
                <Num
                  label="Витрата енергії"
                  value={edge.costs.energy ?? 0}
                  onChange={(energy) =>
                    update("edges", edge.id, {
                      costs: { ...edge.costs, energy },
                    })
                  }
                />
                {edge.kind === "bridge" && (
                  <Multi
                    label="Коридори під мостом"
                    values={edge.overNodeIds}
                    options={d.nodes
                      .filter((n) => n.level === "lower")
                      .map((n) => [n.id, n.title])}
                    onChange={(overNodeIds) =>
                      update("edges", edge.id, { overNodeIds })
                    }
                  />
                )}
                <Rules
                  label="Умови переходу"
                  value={edge.conditions}
                  d={d}
                  onChange={(conditions) =>
                    update("edges", edge.id, { conditions })
                  }
                />
                <button
                  className={btn}
                  onClick={() => remove("edges", edge.id)}
                >
                  Видалити перехід
                </button>
              </>
            )}
            {tab === "objects" && object && (
              <>
                <Pick
                  label="Місце механізму"
                  value={object.nodeId}
                  options={nodeOptions}
                  onChange={(nodeId) =>
                    update("objects", object.id, { nodeId })
                  }
                />
                <Pick
                  label="Тип механізму"
                  value={object.kind}
                  options={objectNames}
                  onChange={(kind) =>
                    update("objects", object.id, {
                      kind: kind as typeof object.kind,
                    })
                  }
                />
                <Pick
                  label="Початковий стан"
                  value={object.initialState}
                  options={object.states.map((s) => [s, s])}
                  onChange={(initialState) =>
                    update("objects", object.id, { initialState })
                  }
                />
                {object.transitions.map((t, i) => (
                  <fieldset
                    key={i}
                    className="space-y-2 rounded-lg border border-slate-700 p-3"
                  >
                    <legend>
                      {t.from} → {t.to}
                    </legend>
                    <Pick
                      label="Зі стану"
                      value={t.from}
                      options={object.states.map((s) => [s, s])}
                      onChange={(from) =>
                        update("objects", object.id, {
                          transitions: object.transitions.map((v, j) =>
                            j === i ? { ...v, from } : v,
                          ),
                        })
                      }
                    />
                    <Pick
                      label="У стан"
                      value={t.to}
                      options={object.states.map((s) => [s, s])}
                      onChange={(to) =>
                        update("objects", object.id, {
                          transitions: object.transitions.map((v, j) =>
                            j === i ? { ...v, to } : v,
                          ),
                        })
                      }
                    />
                    <button
                      className={btn}
                      onClick={() =>
                        update("objects", object.id, {
                          transitions: object.transitions.filter(
                            (_, j) => j !== i,
                          ),
                        })
                      }
                    >
                      Видалити перехід стану
                    </button>
                    <Rules
                      label="Умови активації"
                      d={d}
                      value={t.conditions}
                      onChange={(conditions) =>
                        update("objects", object.id, {
                          transitions: object.transitions.map((v, j) =>
                            j === i ? { ...v, conditions } : v,
                          ),
                        })
                      }
                    />
                    <Rules
                      label="Зміни пов’язаних об’єктів"
                      d={d}
                      exclude={object.id}
                      value={t.effects}
                      onChange={(effects) =>
                        update("objects", object.id, {
                          transitions: object.transitions.map((v, j) =>
                            j === i ? { ...v, effects } : v,
                          ),
                        })
                      }
                    />
                  </fieldset>
                ))}
                <button
                  className={btn}
                  disabled={object.states.length < 2}
                  onClick={() =>
                    update("objects", object.id, {
                      transitions: [
                        ...object.transitions,
                        {
                          from: object.states[0],
                          to: object.states[1],
                          conditions: [],
                          effects: [],
                        },
                      ],
                    })
                  }
                >
                  Додати перехід стану
                </button>
                <button
                  className={btn}
                  onClick={() => remove("objects", object.id)}
                >
                  Видалити механізм
                </button>
              </>
            )}
            {tab === "events" && event && (
              <>
                <Multi
                  label="Зона події"
                  values={event.nodeIds}
                  options={nodeOptions}
                  onChange={(nodeIds) =>
                    update("events", event.id, { nodeIds })
                  }
                />
                <Text
                  label="Попередження"
                  area
                  value={event.warning}
                  onChange={(warning) =>
                    update("events", event.id, { warning })
                  }
                />
                <Text
                  label="Підказка обходу"
                  area
                  value={event.avoidance}
                  onChange={(avoidance) =>
                    update("events", event.id, { avoidance })
                  }
                />
                <div className="grid gap-2 sm:grid-cols-3">
                  <Num
                    label="Час підготовки"
                    min={1}
                    value={event.preparation}
                    onChange={(preparation) =>
                      update("events", event.id, { preparation })
                    }
                  />
                  <Num
                    label="Тривалість події"
                    min={1}
                    value={event.duration}
                    onChange={(duration) =>
                      update("events", event.id, { duration })
                    }
                  />
                  <Num
                    label="Пауза до повтору"
                    value={event.cooldown}
                    onChange={(cooldown) =>
                      update("events", event.id, { cooldown })
                    }
                  />
                </div>
                <Rules
                  label="Умови події"
                  d={d}
                  value={event.conditions}
                  onChange={(conditions) =>
                    update("events", event.id, { conditions })
                  }
                />
                <Rules
                  label="Наслідки події"
                  d={d}
                  value={event.effects}
                  onChange={(effects) =>
                    update("events", event.id, { effects })
                  }
                />
                <button
                  className={btn}
                  onClick={() => remove("events", event.id)}
                >
                  Видалити подію
                </button>
              </>
            )}
            {tab === "heroes" &&
              d.heroes.map((h) => (
                <fieldset key={h.id} className="space-y-2">
                  <legend>{h.id}</legend>
                  <Text
                    label="Ім’я героя"
                    value={h.name}
                    onChange={(name) => update("heroes", h.id, { name })}
                  />
                  <Pick
                    label="Старт героя"
                    value={h.startNodeId}
                    options={nodeOptions}
                    onChange={(startNodeId) =>
                      update("heroes", h.id, { startNodeId })
                    }
                  />
                  <Num
                    label="Здоров’я"
                    value={h.resources.health ?? 0}
                    onChange={(health) =>
                      update("heroes", h.id, {
                        resources: { ...h.resources, health },
                      })
                    }
                  />
                  <Num
                    label="Енергія"
                    value={h.resources.energy ?? 0}
                    onChange={(energy) =>
                      update("heroes", h.id, {
                        resources: { ...h.resources, energy },
                      })
                    }
                  />
                </fieldset>
              ))}
          </div>
        </div>
      </fieldset>
      <section
        className="rounded-lg border border-slate-600 p-3"
        aria-label="Перевірка прохідності"
      >
        <h3 className="font-bold">Перевірка прохідності</h3>
        <p className="text-xs text-slate-300">
          Статична перевірка напрямків, початкових станів та окремих
          подій/механізмів. Ресурси, час порятунку й комбінації пасток
          перевірятиме рушій Т9.3. Зауваження не забороняють зберегти авторську
          чернетку.
        </p>
        {staticIssues.length ? (
          <ul className="list-disc pl-5">
            {staticIssues.map((v, i) => (
              <li key={i} data-design-issue={v.code}>
                {v.message}
              </li>
            ))}
          </ul>
        ) : (
          <p>Статичних проблем не знайдено.</p>
        )}
      </section>
      {run && (
        <section
          className="space-y-2 rounded-lg border border-emerald-700 p-3"
          data-labyrinth-run
        >
          <h3>
            Авторський прогін v{run.mapRevision} · хід {run.state.turn}
          </h3>
          <p className="text-xs">
            Структурна перевірка переходів і механізмів; події автоматично не
            запускаються.
          </p>
          <RouteDescription
            key={run.id}
            base={base}
            run={run}
            onRunChange={setRun}
          />
          {Object.entries(run.state.heroes).map(([heroId, h]) => (
            <div key={heroId}>
              <p>
                {d.heroes.find((v) => v.id === heroId)?.name}:{" "}
                {d.nodes.find((n) => n.id === h.nodeId)?.title} · енергія{" "}
                {h.resources.energy ?? 0}
              </p>
              <div className="flex flex-wrap gap-2">
                {d.edges
                  .filter(
                    (e) =>
                      e.from === h.nodeId ||
                      (e.bidirectional && e.to === h.nodeId),
                  )
                  .map((e) => (
                    <button
                      disabled={busy}
                      className={btn}
                      key={e.id}
                      onClick={() =>
                        void act(async () => {
                          const result = await gs<{ run: LabyrinthRun }>(
                            "POST",
                            `${base}/runs/${run.id}/structural-actions`,
                            {
                              expectedRevision: run.revision,
                              action: { kind: "move", heroId, edgeId: e.id },
                            },
                          );
                          setRun(result.run);
                        })
                      }
                    >
                      Йти:{" "}
                      {
                        d.nodes.find(
                          (n) => n.id === (e.from === h.nodeId ? e.to : e.from),
                        )?.title
                      }
                    </button>
                  ))}
                {d.objects
                  .filter((o) => o.nodeId === h.nodeId)
                  .flatMap((o) =>
                    o.transitions
                      .filter((t) => t.from === run.state.objects[o.id])
                      .map((t) => (
                        <button
                          disabled={busy}
                          className={btn}
                          key={`${o.id}-${t.to}`}
                          onClick={() =>
                            void act(async () => {
                              setRun(
                                (
                                  await gs<{ run: LabyrinthRun }>(
                                    "POST",
                                    `${base}/runs/${run.id}/structural-actions`,
                                    {
                                      expectedRevision: run.revision,
                                      action: {
                                        kind: "interact",
                                        heroId,
                                        objectId: o.id,
                                        to: t.to,
                                      },
                                    },
                                  )
                                ).run,
                              );
                            })
                          }
                        >
                          {o.id} → {t.to}
                        </button>
                      )),
                  )}
              </div>
            </div>
          ))}
        </section>
      )}
    </section>
  );
}
export default LabyrinthBuilder;

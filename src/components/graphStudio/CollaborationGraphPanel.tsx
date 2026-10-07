import React, { useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { gs } from "./gsApi";
const views = [
  "Participant",
  "Role",
  "Contribution",
  "Access",
  "Production",
] as const;
export const CollaborationGraphPanel: React.FC = () => {
  const [project, setProject] = useState(""),
    [data, setData] = useState<any>(null),
    [view, setView] = useState<(typeof views)[number]>("Participant"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [workflow, setWorkflow] = useState("");
  const load = async () => {
    setBusy(true);
    setError("");
    setData(null);
    try {
      setData(
        await gs(
          "GET",
          `/api/core/projects/${encodeURIComponent(project)}/collaboration/graph`,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const nodes: Node[] = [],
    edges: Edge[] = [];
  if (data) {
    for (const [i, p] of data.participants.entries()) {
      nodes.push({
        id: p.id,
        position: { x: 0, y: i * 130 },
        data: { label: `PERSON ${p.userId}\nPARTICIPANT ${p.status}` },
        style: { whiteSpace: "pre-wrap", width: 220 },
      });
    }
    const records =
      view === "Role"
        ? data.roles
        : view === "Contribution"
          ? data.contributions
          : view === "Access"
            ? data.access
            : view === "Production"
              ? data.production
              : [];
    for (const [i, r] of records.entries()) {
      const id = `${view}:${r.id}`;
      nodes.push({
        id,
        position: { x: 360, y: i * 130 },
        data: {
          label:
            view === "Role"
              ? `${r.roleId} · ${r.status}`
              : view === "Access"
                ? `${r.level} → ${r.scopeType}:${r.scopeRef ?? "book"} · ${r.status}`
                : view === "Contribution"
                  ? `${r.actionType} → ${r.resourceId}\nrev ${r.sourceRevision} → ${r.resultRevision}`
                  : `Change Proposal · ${r.status}\n${r.sectionId}`,
        },
        style: { whiteSpace: "pre-wrap", width: 270 },
      });
      const participant =
        r.participantId ??
        data.participants.find((p: any) => p.userId === r.userId)?.id;
      if (participant && nodes.some((n) => n.id === participant))
        edges.push({
          id: `edge:${id}`,
          source: participant,
          target: id,
          label: view,
        });
    }
  }
  const dispatch = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await gs<any>("POST", "/api/core/workflow-runs", {
        workflowId: workflow,
        projectId: data.projectId,
        input: { collaborationEventId: id },
      });
      setError(`Запуск створено: ${r.run?.id ?? r.runId ?? "див. Запуски"}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 min-w-0" data-collaboration-graph>
      <h2 className="font-bold">Граф співпраці</h2>
      <div className="flex flex-wrap gap-2">
        <input
          aria-label="Проєкт графа співпраці"
          className="rounded bg-slate-900 border border-slate-700 p-2 max-w-full"
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setData(null);
          }}
          placeholder="ID книги"
        />
        <button disabled={busy || !project} onClick={() => void load()}>
          Завантажити граф
        </button>
      </div>
      {error && (
        <p role="status" className="break-words">
          {error}
        </p>
      )}
      {data && (
        <>
          <div className="flex flex-wrap gap-3">
            {views.map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400">
            Записи внесків описують походження роботи. Вони не визначають
            юридичне авторство. Production показує розгляд і злиття змін;
            замовлення та результати фахівців — етап 7.
          </p>
          <div className="h-[480px] border border-slate-700 rounded-xl overflow-hidden">
            <ReactFlowProvider>
              <ReactFlow
                key={`${data.projectId}:${view}`}
                nodes={nodes}
                edges={edges}
                fitView
                nodesDraggable={false}
                nodesConnectable={false}
              >
                <Background />
                <Controls />
              </ReactFlow>
            </ReactFlowProvider>
          </div>
          <details>
            <summary>
              Походження та ревізії ({data.contributions.length})
            </summary>
            {data.contributions.map((c: any) => (
              <p key={c.id} className="break-all text-xs">
                {c.userId} · {c.actionType} · {c.resourceId} ·{" "}
                {c.sourceRevision} → {c.resultRevision} · {c.timestamp} ·
                схвалив {c.approvedBy} · {c.provenance.source}
              </p>
            ))}
          </details>
          <details>
            <summary>Події співпраці ({data.events.length})</summary>
            <p className="text-xs">
              Запуск — лише за вашою командою для production-процесу,
              підписаного на подію. Нових прав подія не надає.
            </p>
            <input
              aria-label="Процес для події"
              value={workflow}
              onChange={(e) => setWorkflow(e.target.value)}
              placeholder="ID production-процесу"
              className="max-w-full bg-slate-900 p-2"
            />
            {data.events.map((e: any) => (
              <div key={e.id} className="flex flex-wrap gap-2 text-xs p-2">
                <span>
                  {e.type} · {e.timestamp}
                </span>
                <button
                  disabled={busy || !workflow}
                  onClick={() => void dispatch(e.id)}
                >
                  Запустити процес
                </button>
              </div>
            ))}
          </details>
        </>
      )}
    </section>
  );
};

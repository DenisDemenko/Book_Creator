import { useRef, useState } from "react";
import type {
  LabyrinthDefinition,
  LabyrinthRun,
  RuntimeAction,
} from "../../../shared/labyrinth";
import { gs } from "../graphStudio/gsApi";
const btn =
  "rounded-lg border border-slate-600 px-3 py-2 text-sm disabled:opacity-40";
const directorSources = {
  rules: "Авторські правила",
  jev: "Jev",
  mock: "Контрольована модель (тест)",
  llm_fallback: "Запасний ШІ",
};
const directorReasons: Record<string, string> = {
  offline: "Рішення без ШІ",
  budget: "Бюджет ШІ вичерпано",
  cooldown: "Перерва між подіями",
  completed: "Герой досяг виходу",
  no_safe_event: "Безпечної події не знайдено",
  provider_unavailable: "Провайдер недоступний",
  provider_error: "Збій провайдера",
  timeout: "ШІ не відповів вчасно",
  uncertain_or_invalid: "Відповідь недостатньо певна",
  invalid_choice: "Недозволений вибір",
  context_budget: "Перевищено ліміт контексту",
  model_choice: "Вибір ШІ перевірено",
  model_pressure_pause: "Напруга висока: нове ускладнення відкладено",
  rules: "Безпечний авторський резерв",
};
export function RuntimeControls({
  base,
  run,
  definition: d,
  onRunChange,
  onBusyChange,
}: {
  base: string;
  run: LabyrinthRun;
  definition: LabyrinthDefinition;
  onRunChange: (run: LabyrinthRun) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [checkpoint, setCheckpoint] = useState(0),
    [useAI, setUseAI] = useState(false),
    [automatic, setAutomatic] = useState(Boolean(d.director?.enabled));
  const setWorking = (value: boolean) => {
    setBusy(value);
    onBusyChange(value);
  };
  const pending = useRef<{ signature: string; key: string } | null>(null);
  async function step(action: RuntimeAction) {
    const signature = JSON.stringify({
      runId: run.id,
      revision: run.revision,
      action,
    });
    if (pending.current?.signature !== signature)
      pending.current = { signature, key: crypto.randomUUID() };
    setWorking(true);
    setError("");
    try {
      const result = await gs<{ run: LabyrinthRun }>(
        "POST",
        `${base}/runs/${run.id}/runtime-actions`,
        { expectedRevision: run.revision, action, key: pending.current.key },
      );
      onRunChange(result.run);
      if (
        automatic &&
        (action.kind === "move" || action.kind === "interact") &&
        d.director?.enabled
      ) {
        const directed = await gs<{ run: LabyrinthRun }>(
          "POST",
          `${base}/runs/${run.id}/director-actions`,
          {
            expectedRevision: result.run.revision,
            useAI,
            key: `${pending.current!.key}:director`,
          },
        );
        onRunChange(directed.run);
      }
      pending.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося виконати дію.");
    } finally {
      setWorking(false);
    }
  }
  async function direct() {
    const signature = JSON.stringify({
      runId: run.id,
      revision: run.revision,
      useAI,
      director: true,
    });
    if (pending.current?.signature !== signature)
      pending.current = { signature, key: crypto.randomUUID() };
    setWorking(true);
    setError("");
    try {
      const result = await gs<{ run: LabyrinthRun }>(
        "POST",
        `${base}/runs/${run.id}/director-actions`,
        { expectedRevision: run.revision, useAI, key: pending.current.key },
      );
      onRunChange(result.run);
      pending.current = null;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося виконати рішення.");
    } finally {
      setWorking(false);
    }
  }
  return (
    <div className="space-y-3" data-runtime-controls>
      <p>
        Безпечний прогін · час {run.state.storyTime}. Небезпеки запускає автор;
        кожна дія зберігає контрольну точку. Вихід має лишатися досяжним.
      </p>
      {d.director?.enabled && (
        <section
          className="space-y-2 rounded border border-violet-500 p-2"
          data-labyrinth-director
          data-director-source={run.state.engine?.director?.last?.source}
          data-director-reason={run.state.engine?.director?.last?.reason}
        >
          <p>
            Директор:{" "}
            {run.state.engine?.director?.last
              ? directorSources[run.state.engine.director.last.source]
              : "ще не викликано"}{" "}
            · причина:{" "}
            {directorReasons[run.state.engine?.director?.last?.reason ?? ""] ??
              "—"}{" "}
            · подія:{" "}
            {run.state.engine?.director?.last?.eventId ?? "без зміни світу"}
          </p>
          <p>
            Бюджет ШІ: {run.state.engine?.director?.modelCalls ?? 0} /{" "}
            {d.director.maxModelCalls} спроб · Оцінки героя:{" "}
            {run.state.engine?.director?.last
              ? (
                  [
                    ["health", "здоров’я"],
                    ["resources", "ресурси"],
                    ["confidence", "впевненість маршруту"],
                    ["tension", "напруга"],
                  ] as const
                )
                  .map(
                    ([key, label]) =>
                      `${label}: ${run.state.engine!.director!.last!.scores[key]}%`,
                  )
                  .join(" · ")
              : "ще не оцінено"}
          </p>
          <label className="block">
            <input
              type="checkbox"
              disabled={busy}
              checked={automatic}
              onChange={(e) => setAutomatic(e.target.checked)}
            />{" "}
            Рішення після руху та взаємодії
          </label>
          <label className="block">
            <input
              type="checkbox"
              disabled={busy}
              checked={useAI}
              onChange={(e) => setUseAI(e.target.checked)}
            />{" "}
            Використати Jev / запасний ШІ (витрачає бюджет)
          </label>
          <button className={btn} disabled={busy} onClick={() => void direct()}>
            Хід директора
          </button>
          <p className="text-xs">
            Впевненість — оцінка маршруту героя. Час читання та емоції людини не
            вимірюються.
          </p>
        </section>
      )}
      {d.events.map((e) => {
        const scheduled = run.state.engine?.events.find(
          (s) => s.eventId === e.id,
        );
        const elapsed = scheduled
          ? run.state.storyTime - scheduled.startedAt
          : -1;
        const phase =
          elapsed < 0
            ? "готова"
            : elapsed < e.preparation
              ? "попередження"
              : elapsed < e.preparation + e.duration
                ? "активна"
                : elapsed < e.preparation + e.duration + e.cooldown
                  ? "перезаряджання"
                  : "готова";
        return (
          <div key={e.id}>
            <button
              className={btn}
              disabled={busy || phase !== "готова"}
              onClick={() => void step({ kind: "start_event", eventId: e.id })}
            >
              Запустити: {e.id}
            </button>{" "}
            <span>{phase}</span>
            {phase === "попередження" && (
              <p role="status">
                {e.warning} · {e.avoidance} · до активації:{" "}
                {e.preparation - elapsed}
              </p>
            )}
          </div>
        );
      })}
      {Object.entries(run.state.heroes).map(([heroId, h]) => (
        <div key={heroId} className="flex flex-wrap gap-2">
          <p className="w-full">
            Ресурси:{" "}
            {Object.entries(h.resources)
              .map(([k, v]) => `${k}: ${v}`)
              .join(", ")}{" "}
            · Предмети: {h.inventory.join(", ") || "немає"}
          </p>
          <button
            disabled={busy}
            className={btn}
            onClick={() => void step({ kind: "wait", heroId })}
          >
            Чекати один крок
          </button>
          {d.edges
            .filter(
              (e) =>
                e.from === h.nodeId || (e.bidirectional && e.to === h.nodeId),
            )
            .map((e) => (
              <button
                className={btn}
                disabled={busy}
                key={e.id}
                onClick={() =>
                  void step({ kind: "move", heroId, edgeId: e.id })
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
              o.transitions.map((t) => (
                <button
                  disabled={busy}
                  className={btn}
                  key={`${o.id}-${t.from}-${t.to}`}
                  onClick={() =>
                    void step({
                      kind: "interact",
                      heroId,
                      objectId: o.id,
                      to: t.to,
                    })
                  }
                >
                  {o.id}: {t.from} → {t.to}
                </button>
              )),
            )}
        </div>
      ))}
      <label>
        Контрольна точка{" "}
        <input
          type="number"
          min={0}
          max={run.revision}
          value={checkpoint}
          onChange={(e) => setCheckpoint(Number(e.target.value))}
          className="w-20 rounded border p-1"
        />
      </label>{" "}
      <button
        className={btn}
        disabled={
          busy ||
          !Number.isInteger(checkpoint) ||
          checkpoint < 0 ||
          checkpoint > run.revision
        }
        onClick={() => {
          setWorking(true);
          setError("");
          void gs<LabyrinthRun>("POST", `${base}/runs/${run.id}/restore`, {
            expectedRevision: run.revision,
            sourceRevision: checkpoint,
          })
            .then(onRunChange)
            .catch((e) => setError(e.message))
            .finally(() => setWorking(false));
        }}
      >
        Відновити як новий прогін
      </button>
      <button
        className={btn}
        disabled={busy}
        onClick={() => {
          setWorking(true);
          setError("");
          void gs<LabyrinthRun>("GET", `${base}/runs/${run.id}`)
            .then(onRunChange)
            .catch((e) => setError(e.message))
            .finally(() => setWorking(false));
        }}
      >
        Оновити прогін
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

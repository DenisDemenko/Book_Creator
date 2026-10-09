import React, { useEffect, useState } from "react";
import type { LabyrinthRun } from "../../../shared/labyrinth";
import type { RouteView, Heading } from "../../../shared/labyrinthNarration";
import { gs } from "../graphStudio/gsApi";
export function RouteDescription({
  base,
  run,
  onRunChange,
}: {
  base: string;
  run: LabyrinthRun;
  onRunChange: (r: LabyrinthRun) => void;
}) {
  const [heroId, setHeroId] = useState(Object.keys(run.state.heroes)[0]),
    [heading, setHeading] = useState(""),
    [view, setView] = useState<(RouteView & { runRevision: number }) | null>(
      null,
    ),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setView(null);
    setError("");
    const query = new URLSearchParams({ heroId });
    if (heading) query.set("heading", heading);
    gs<RouteView & { runRevision: number }>(
      "GET",
      `${base}/runs/${run.id}/view?${query}`,
    )
      .then(async (v) => {
        if (!active) return;
        if (v.runRevision !== run.revision) {
          const latest = await gs<LabyrinthRun>(
            "GET",
            `${base}/runs/${run.id}`,
          );
          if (active) onRunChange(latest);
          return;
        }
        setView(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, run.id, run.revision, heroId, heading, onRunChange]);
  return (
    <section
      className="space-y-2 rounded-lg border border-violet-600 p-3"
      aria-label="Словесний вибір маршруту"
    >
      <h4 className="font-bold">Що бачить мандрівник</h4>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="min-w-0">
          Герой{" "}
          <select
            className="block w-full max-w-full rounded bg-slate-950 p-2"
            value={heroId}
            onChange={(e) => setHeroId(e.target.value)}
          >
            {Object.keys(run.state.heroes).map((id) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          Напрямок погляду{" "}
          <select
            className="block w-full max-w-full rounded bg-slate-950 p-2"
            value={heading}
            onChange={(e) => setHeading(e.target.value)}
          >
            {[
              ["", "За останнім ходом (на старті — північ)"],
              ["north", "Північ ↑"],
              ["east", "Схід →"],
              ["south", "Південь ↓"],
              ["west", "Захід ←"],
            ].map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-300">
        Опис формується з поточної позиції, напрямків, мостів і доступності
        переходів за серверним станом. Це авторський перегляд.
      </p>
      <p
        aria-live="polite"
        data-route-description
        data-description-node={view?.nodeId}
        data-description-revision={view?.runRevision}
      >
        {error || view?.description || "Формування опису поточного місця…"}
      </p>
    </section>
  );
}

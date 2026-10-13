import React, {useId} from "react";
import type {ReaderView} from "../../../shared/labyrinthReader";
export default function ReaderMap({ map }: { map: ReaderView["map"] }) {
  const labelId = useId(), descId = useId();
  const xs = map.nodes.map((n) => n.x), ys = map.nodes.map((n) => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const upper = map.nodes.some((n) => n.level === "upper");
  const point = (n: typeof map.nodes[number]) => ({
    x: 48 + (n.x - minX) / Math.max(1, maxX - minX) * 324,
    y: 65 + (n.y - minY) / Math.max(1, maxY - minY) * 130 + (n.level === "upper" ? 230 : 0),
  });
  const current = map.nodes.find((n) => n.current)!;
  return <section className="min-w-0 space-y-2" aria-label="Карта проходження">
    <h3 className="font-semibold">Відкриті місця</h3>
    <svg viewBox={"0 0 420 " + (upper ? 470 : 240)} role="img"
      aria-labelledby={labelId + " " + descId} className="w-full rounded-lg border border-slate-600 bg-slate-950" style={{maxHeight:440}} data-reader-map>
      <title id={labelId}>Карта. Поточне місце: {current.title}</title>
      <desc id={descId}>Коло з подвійною обводкою позначає героя. Верхній і нижній рівні показані окремо. Нижче є текстовий опис.</desc>
      <text x="20" y="26" fill="#cbd5e1">Нижній рівень</text>
      {upper && <text x="20" y="256" fill="#cbd5e1">Верхній рівень</text>}
      {map.edges.map((e) => {
        const from = point(map.nodes.find((n) => n.id === e.from)!);
        const to = point(map.nodes.find((n) => n.id === e.to)!);
        return <line key={e.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#94a3b8"
          strokeWidth="3" strokeDasharray={e.kind === "bridge" ? "8 4" : undefined} />;
      })}
      {map.nodes.map((n) => { const p = point(n); return <g key={n.id}>
        {n.current && <circle cx={p.x} cy={p.y} r="17" fill="none" stroke="#fbbf24" strokeWidth="3" />}
        <circle cx={p.x} cy={p.y} r="10" fill={n.current ? "#fbbf24" : n.visited ? "#2dd4bf" : "#64748b"} />
        <text x={p.x} y={p.y + 33} textAnchor={p.x < 80 ? "start" : p.x > 340 ? "end" : "middle"} fill="#f1f5f9" fontSize="16">{n.title.slice(0,24)}</text>
      </g>; })}
    </svg>
    <details>
      <summary className="cursor-pointer py-2">Текстовий опис карти</summary>
      <ul className="list-inside list-disc">
        {map.nodes.map((n) => <li key={n.id}>{n.title} · {n.level === "upper" ? "верхній рівень" : "нижній рівень"} ·
          {n.current ? " герой тут" : n.visited ? " відвідано" : " видно з відкритого місця"}</li>)}
      </ul>
    </details>
  </section>;
}

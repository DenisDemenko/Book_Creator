import React, { useEffect, useRef } from "react";
import points from "../../../shared/labyrinthSvgPoints.json";
export const hasSvgPoint = (id: string) => Object.hasOwn(points, id);
export function ReferenceMaze({
  heroes,
}: {
  heroes: Record<string, { nodeId: string }>;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = container.current,
      id = Object.values(heroes)[0]?.nodeId,
      p = (points as Record<string, { x: number; y: number }>)[id];
    if (el && p) {
      const height =
        el.querySelector("svg")?.getBoundingClientRect().height ?? 0;
      el.scrollTop = (p.y / 1240) * height - el.clientHeight / 2;
    }
  }, [heroes]);
  return (
    <figure className="space-y-2">
      <div
        ref={container}
        className="max-h-[650px] overflow-auto rounded border border-slate-600"
      >
        <svg
          viewBox="0 0 1000 1240"
          className="w-full"
          role="img"
          aria-label="Зразок лабіринта: червоні стіни, сині мости, позначки поточних місць героїв"
        >
          <image
            href={`${import.meta.env?.BASE_URL || "/"}labyrinth/maze-reference.svg`}
            width="1000"
            height="1240"
          />
          {Object.entries(heroes).map(([id, h]) => {
            const p = (points as Record<string, { x: number; y: number }>)[
              h.nodeId
            ];
            return p ? (
              <g key={id} data-maze-marker={id} data-marker-node={h.nodeId}>
                <circle
                  cx={p.x}
                  cy={p.y}
                  r="15"
                  fill="#facc15"
                  stroke="#0f172a"
                  strokeWidth="4"
                />
                <circle cx={p.x} cy={p.y} r="5" fill="#0f172a" />
                <title>
                  {id}: {h.nodeId}
                </title>
              </g>
            ) : null;
          })}
        </svg>
      </div>
      <figcaption className="text-xs text-slate-300">
        Ваш SVG, сітка 25 × 31. Жовта точка — поточне місце героя. Червоні стіни
        перенесено в тестовий граф; для синіх мостів місця сходів інтерпретовано
        й потребують перевірки автором. Нові вузли без координат у зразку видно
        лише на графі.
      </figcaption>
    </figure>
  );
}

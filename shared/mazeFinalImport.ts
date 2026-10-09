import type { LabyrinthDefinition, LabyrinthEdge } from "./labyrinth";
export const MAZE_FINAL_FORMAT = "fusion-lab.maze-final";
/** Untrusted JSON adapter; topology only. Never imports HTML, canon, people or game progress. */
export function importMazeFinal(input: unknown): LabyrinthDefinition {
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const obj = (v: unknown): Record<string, any> => {
    if (!v || typeof v !== "object" || Array.isArray(v))
      fail("Потрібен JSON лабіринту MazeFinal.");
    return v as Record<string, any>;
  };
  const envelope = obj(input);
  if (
    envelope.format !== undefined &&
    (envelope.format !== MAZE_FINAL_FORMAT || envelope.version !== 1)
  )
    fail("Невідомий формат або версія експорту.");
  const m =
    envelope.format === MAZE_FINAL_FORMAT ? obj(envelope.maze) : envelope;
  const integer = (n: unknown, min: number, max: number): number => {
    if (!Number.isSafeInteger(n) || Number(n) < min || Number(n) > max)
      fail("Некоректні розміри або координати MazeFinal.");
    return Number(n);
  };
  const w = integer(m.width, 2, 100),
    h = integer(m.height, 2, 100);
  if (w * h > 800)
    fail(
      "Для редактора книги оберіть менший лабіринт: не більше 800 клітинок.",
    );
  if (!Array.isArray(m.grid) || m.grid.length !== h)
    fail("Неповна сітка MazeFinal.");
  if (!Array.isArray(m.keys) || !Array.isArray(m.barriers))
    fail("Відсутні списки ключів і бар’єрів.");
  if (m.keys.length || m.barriers.length)
    fail(
      "Ключі й парольні бар’єри потребують авторського сценарію. Експортуйте карту без ключів; вони не вилучаються мовчки.",
    );
  const directions = ["top", "right", "bottom", "left"] as const;
  const grid = (m.grid as unknown[]).map((row: unknown, y: number) => {
    if (!Array.isArray(row) || row.length !== w) fail("Неповний рядок сітки.");
    return (row as unknown[]).map((raw, x) => {
      const c = obj(raw),
        walls = obj(c.walls);
      if (
        c.x !== x ||
        c.y !== y ||
        typeof c.isBridge !== "boolean" ||
        directions.some((d) => typeof walls[d] !== "boolean")
      )
        fail("Некоректна клітинка MazeFinal.");
      if (
        c.isBridge
          ? !["horizontal", "vertical"].includes(c.bridgeDirection)
          : c.bridgeDirection !== null
      )
        fail("Некоректний напрямок мосту.");
      return {
        x,
        y,
        walls: Object.fromEntries(
          directions.map((d) => [d, walls[d]]),
        ) as Record<(typeof directions)[number], boolean>,
        isBridge: c.isBridge,
        bridgeDirection: c.bridgeDirection as "horizontal" | "vertical" | null,
      };
    });
  });
  const endpoint = (v: unknown) => {
    const p = obj(v);
    return { x: integer(p.x, 0, w - 1), y: integer(p.y, 0, h - 1) };
  };
  const start = endpoint(m.entrance),
    end = endpoint(m.exit);
  const id = (x: number, y: number) => `mf-${x}-${y}`;
  const nodes: LabyrinthDefinition["nodes"] = grid.flatMap((row, y) =>
    row.map((c, x) => ({
      id: id(x, y),
      title: `Коридор ${x + 1}:${y + 1}`,
      level: "lower" as const,
      x: x * 10,
      y: y * 10,
      sceneId: null,
      description: c.isBridge ? "Коридор під мостом." : "",
      cover: false,
    })),
  );
  const edges: LabyrinthEdge[] = [];
  const edge = (
    from: string,
    to: string,
    kind: LabyrinthEdge["kind"],
    overNodeIds: string[] = [],
  ) =>
    edges.push({
      id: `mf-edge-${edges.length}`,
      from,
      to,
      kind,
      bidirectional: true,
      duration: 1,
      costs: {},
      conditions: [],
      overNodeIds,
    });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (x + 1 < w) {
        if (c.walls.right !== grid[y][x + 1].walls.left)
          fail("Сусідні стіни не узгоджені.");
        if (!c.walls.right) edge(id(x, y), id(x + 1, y), "corridor");
      }
      if (y + 1 < h) {
        if (c.walls.bottom !== grid[y + 1][x].walls.top)
          fail("Сусідні стіни не узгоджені.");
        if (!c.walls.bottom) edge(id(x, y), id(x, y + 1), "corridor");
      }
      if (c.isBridge) {
        const horizontal = c.bridgeDirection === "horizontal",
          dx = horizontal ? 1 : 0,
          dy = horizontal ? 0 : 1;
        if (x - dx < 0 || x + dx >= w || y - dy < 0 || y + dy >= h)
          fail("Міст на межі сітки не має двох схилів.");
        const a = `${id(x, y)}-upper-a`,
          b = `${id(x, y)}-upper-b`;
        nodes.push(
          {
            id: a,
            title: `Початок мосту ${x + 1}:${y + 1}`,
            level: "upper",
            x: x * 10 - dx * 3,
            y: y * 10 - dy * 3,
            sceneId: null,
            description: "Схил мосту MazeFinal.",
            cover: false,
          },
          {
            id: b,
            title: `Кінець мосту ${x + 1}:${y + 1}`,
            level: "upper",
            x: x * 10 + dx * 3,
            y: y * 10 + dy * 3,
            sceneId: null,
            description: "Схил мосту MazeFinal.",
            cover: false,
          },
        );
        edge(id(x - dx, y - dy), a, "stairs");
        edge(a, b, "bridge", [id(x, y)]);
        edge(b, id(x + dx, y + dy), "stairs");
      }
    }
  if (nodes.length > 1000 || edges.length > 4000)
    fail(
      "Мапа з мостами перевищує місткість редактора. Оберіть менший розмір.",
    );
  // Verify real connectivity. Teleport pairs are generated during play and absent from MazeData.
  const adj = new Map(nodes.map((n) => [n.id, [] as string[]]));
  for (const e of edges) {
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  const seen = new Set([id(start.x, start.y)]),
    queue = [...seen];
  for (let i = 0; i < queue.length; i++)
    for (const n of adj.get(queue[i])!) {
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  if (!seen.has(id(end.x, end.y)) || seen.size !== nodes.length)
    fail(
      "Вихід без телепортів недосяжний. Вимкніть телепорти й створіть нову карту: їхні пари не зберігаються в експорті.",
    );
  return {
    schemaVersion: 1,
    title: `MazeFinal · ${w}×${h}`,
    startNodeId: id(start.x, start.y),
    exitNodeIds: [id(end.x, end.y)],
    nodes,
    edges,
    objects: [],
    events: [],
    heroes: [
      {
        id: "hero",
        entityId: null,
        name: "Мандрівник",
        startNodeId: id(start.x, start.y),
        resources: { health: 100 },
        inventory: [],
        goals: ["Знайти вихід"],
        fears: [],
        knowledge: ["Карта імпортована з MazeFinal."],
      },
    ],
  };
}

/**
 * Розкладка графа історії (Т1.4) — без сторонніх бібліотек розкладки.
 *
 *  • `radialLayout` — фокус у центрі, сусіди першого рівня по колу, другого —
 *    по зовнішньому колу біля «свого» сусіда. Для «клік по героєві».
 *  • `forceLayout` — огляд: відштовхування вузлів, пружини ребер, тяжіння до
 *    центру. Детермінована (стартові точки — «золотий кут», без Math.random),
 *    тож однаковий граф завжди має однакову картинку й тести стабільні.
 *  • `placeAround` — нові вузли (довантажені сусіди) кладуться навколо вузла,
 *    з якого їх відкрили, не зсуваючи вже розкладені.
 */

export interface LayoutNode {
  id: string;
}
export interface LayoutEdge {
  from: string;
  to: string;
}
export type Positions = Record<string, { x: number; y: number }>;

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

function ringRadius(count: number, minGap: number, min: number): number {
  return Math.max(min, (count * minGap) / (2 * Math.PI));
}

export function radialLayout(focus: string, nodes: LayoutNode[], edges: LayoutEdge[], opts: { gap?: number } = {}): Positions {
  const gap = opts.gap ?? 170;
  const pos: Positions = { [focus]: { x: 0, y: 0 } };
  const ids = new Set(nodes.map((n) => n.id));
  const neighbours = (id: string) =>
    edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])).filter((x) => ids.has(x));
  const first = [...new Set(neighbours(focus))].filter((id) => id !== focus).sort();
  const r1 = ringRadius(first.length, gap, 220);
  first.forEach((id, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, first.length) - Math.PI / 2;
    pos[id] = { x: Math.round(r1 * Math.cos(a)), y: Math.round(r1 * Math.sin(a)) };
  });
  const placed = new Set([focus, ...first]);
  const second: { id: string; parent: string }[] = [];
  for (const p of first) for (const n of neighbours(p)) if (!placed.has(n) && !second.some((s) => s.id === n)) second.push({ id: n, parent: p });
  const r2 = Math.max(r1 + 200, ringRadius(second.length, gap, r1 + 200));
  second.forEach(({ id, parent }, i) => {
    const pa = Math.atan2(pos[parent].y, pos[parent].x);
    const spread = (i % 3) - 1;
    const a = pa + spread * 0.25;
    pos[id] = { x: Math.round(r2 * Math.cos(a)), y: Math.round(r2 * Math.sin(a)) };
    placed.add(id);
  });
  // Решта (не зв'язані з фокусом) — рядком унизу, щоб не губились.
  const rest = nodes.filter((n) => !placed.has(n.id));
  rest.forEach((n, i) => {
    pos[n.id] = { x: Math.round((i - (rest.length - 1) / 2) * gap), y: Math.round(r2 + 220) };
  });
  return pos;
}

export function forceLayout(nodes: LayoutNode[], edges: LayoutEdge[], opts: { iterations?: number; spring?: number } = {}): Positions {
  const n = nodes.length;
  const iterations = opts.iterations ?? 250;
  const springLen = opts.spring ?? 190;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const start = Math.sqrt(n) * 90;
  for (let i = 0; i < n; i++) {
    const r = start * Math.sqrt((i + 0.5) / Math.max(1, n));
    x[i] = r * Math.cos(i * GOLDEN);
    y[i] = r * Math.sin(i * GOLDEN);
  }
  const links = edges
    .map((e) => [index.get(e.from), index.get(e.to)] as const)
    .filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);
  const repulse = springLen * springLen;
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations; // «температура»: крок зменшується
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = x[i] - x[j];
        let vy = y[i] - y[j];
        let d2 = vx * vx + vy * vy;
        if (d2 < 1) {
          vx = 1;
          vy = 0;
          d2 = 1;
        }
        const f = repulse / d2;
        const d = Math.sqrt(d2);
        dx[i] += (vx / d) * f;
        dy[i] += (vy / d) * f;
        dx[j] -= (vx / d) * f;
        dy[j] -= (vy / d) * f;
      }
    }
    for (const [a, b] of links) {
      const vx = x[b] - x[a];
      const vy = y[b] - y[a];
      const d = Math.max(1, Math.sqrt(vx * vx + vy * vy));
      const f = (d - springLen) * 0.1;
      dx[a] += (vx / d) * f;
      dy[a] += (vy / d) * f;
      dx[b] -= (vx / d) * f;
      dy[b] -= (vy / d) * f;
    }
    for (let i = 0; i < n; i++) {
      dx[i] -= x[i] * 0.01;
      dy[i] -= y[i] * 0.01;
      const len = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]);
      const max = 40 * t + 2;
      const k = len > max ? max / len : 1;
      x[i] += dx[i] * k;
      y[i] += dy[i] * k;
    }
  }
  const pos: Positions = {};
  nodes.forEach((node, i) => {
    pos[node.id] = { x: Math.round(x[i]), y: Math.round(y[i]) };
  });
  return pos;
}

/** Нові вузли — по колу навколо `center`, подалі від уже зайнятих місць. */
export function placeAround(center: { x: number; y: number }, newIds: string[], taken: Positions, radius = 230): Positions {
  const out: Positions = {};
  const occupied = Object.values(taken);
  const free = (p: { x: number; y: number }) => occupied.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 120);
  let angle = -Math.PI / 2;
  for (const id of newIds) {
    let p = { x: 0, y: 0 };
    for (let tries = 0; tries < 36; tries++) {
      const r = radius + Math.floor(tries / 12) * 150;
      p = { x: Math.round(center.x + r * Math.cos(angle)), y: Math.round(center.y + r * Math.sin(angle)) };
      angle += (2 * Math.PI) / 12;
      if (free(p)) break;
    }
    out[id] = p;
    occupied.push(p);
  }
  return out;
}

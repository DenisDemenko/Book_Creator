/* Physical geometry is measured in centimetres. No visual scaling changes slab size. */
(function (root) {
  const area = (p) =>
    Math.abs(
      p.reduce((a, v, i) => {
        const q = p[(i + 1) % p.length];
        return a + v[0] * q[1] - q[0] * v[1];
      }, 0),
    ) / 2;
  function inside(p, x, y) {
    let yes = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      let a = p[i],
        b = p[j];
      if (
        a[1] > y != b[1] > y &&
        x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
      )
        yes = !yes;
    }
    return yes;
  }
  function worldPoints(s, p) {
    const a = (p.angle * Math.PI) / 180,
      c = Math.cos(a),
      n = Math.sin(a);
    return s.points.map(([x, y]) => {
      x = (x - 0.5) * s.w;
      y = (y - 0.5) * s.h;
      return [p.x + x * c - y * n, p.y + x * n + y * c];
    });
  }
  function inTable(d, x, y) {
    return d.shape === "square"
      ? Math.abs(x) <= d.l / 2 && Math.abs(y) <= d.w / 2
      : (x / (d.l / 2)) ** 2 + (y / (d.w / 2)) ** 2 <= 1;
  }
  function measure(d, slabs) {
    const ps = d.pieces.map((p) =>
      worldPoints(
        slabs.find((s) => s.id === p.id),
        p,
      ),
    );
    const step = Math.max(d.l, d.w) / 650;
    let wood = 0,
      overlap = 0;
    const used = ps.map(() => 0);
    for (let y = -d.w / 2 + step / 2; y < d.w / 2; y += step)
      for (let x = -d.l / 2 + step / 2; x < d.l / 2; x += step) {
        let hits = 0;
        ps.forEach((p, i) => {
          if (inside(p, x, y)) {
            hits++;
            if (inTable(d, x, y)) used[i] += step * step;
          }
        });
        if (hits > 1) overlap += step * step;
        if (inTable(d, x, y) && hits) wood += step * step;
      }
    const total = d.shape === "square" ? d.l * d.w : (Math.PI * d.l * d.w) / 4;
    wood = Math.min(wood, total);
    return {
      area: total / 10000,
      wood: wood / 10000,
      resin: (total - wood) / 10000,
      overlap: overlap / 10000,
      used: used.map((x) => x / 10000),
      resolution: step,
    };
  }
  function quote(d, slabs, c) {
    const m = measure(d, slabs),
      litres = m.resin * d.t * 10,
      kg = litres * c.density * (1 + c.waste / 100);
    const wood = d.pieces.reduce((sum, p) => {
      const s = slabs.find((s) => s.id === p.id);
      return sum + ((area(s.points) * s.w * s.h) / 10000) * s.rate;
    }, 0);
    const resin = kg * c.resin,
      work = m.area * c.work,
      finish = m.area * c.finish,
      legs = c[d.legs] || 0,
      subtotal = wood + resin + work + finish + legs,
      total = Math.round(subtotal * (1 + c.markup / 100));
    return {
      ...m,
      litres,
      kg,
      woodCost: wood,
      resinCost: resin,
      workCost: work,
      finishCost: finish,
      legsCost: legs,
      markupCost: total - subtotal,
      total,
      deposit: Math.round(total / 2),
    };
  }
  function simplify(points, eps = 1) {
    if (points.length < 4) return points;
    const sqdist = (p, a, b) => {
      let x = a[0],
        y = a[1],
        dx = b[0] - x,
        dy = b[1] - y;
      if (dx || dy) {
        let t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
        t = Math.max(0, Math.min(1, t));
        x += t * dx;
        y += t * dy;
      }
      return (p[0] - x) ** 2 + (p[1] - y) ** 2;
    };
    function rdp(p) {
      let max = eps * eps,
        at = 0;
      for (let i = 1; i < p.length - 1; i++) {
        let n = sqdist(p[i], p[0], p[p.length - 1]);
        if (n > max) {
          max = n;
          at = i;
        }
      }
      return at
        ? [...rdp(p.slice(0, at + 1)).slice(0, -1), ...rdp(p.slice(at))]
        : [p[0], p[p.length - 1]];
    }
    const mid = Math.floor(points.length / 2);
    return [
      ...rdp(points.slice(0, mid + 1)).slice(0, -1),
      ...rdp([...points.slice(mid), points[0]]).slice(0, -1),
    ];
  }
  function trace(rgba, w, h, tolerance) {
    const corners = [
        [0, 0],
        [w - 1, 0],
        [0, h - 1],
        [w - 1, h - 1],
      ],
      bg = [0, 0, 0];
    for (const [x, y] of corners)
      for (let c = 0; c < 3; c++) bg[c] += rgba[(y * w + x) * 4 + c] / 4;
    const transparentBackground = corners.every(
      ([x, y]) => rgba[(y * w + x) * 4 + 3] < 100,
    );
    const mask = new Uint8Array(w * h),
      seen = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++)
      mask[i] =
        rgba[i * 4 + 3] > 100 &&
        (transparentBackground ||
          Math.hypot(...bg.map((v, c) => v - rgba[i * 4 + c])) > tolerance)
          ? 1
          : 0;
    let best = [];
    const queue = new Int32Array(w * h);
    for (let i = 0; i < mask.length; i++)
      if (mask[i] && !seen[i]) {
        let head = 0,
          tail = 1;
        queue[0] = i;
        seen[i] = 1;
        while (head < tail) {
          let n = queue[head++],
            x = n % w;
          for (const j of [
            x ? n - 1 : -1,
            x < w - 1 ? n + 1 : -1,
            n - w,
            n + w,
          ])
            if (j >= 0 && j < mask.length && mask[j] && !seen[j]) {
              seen[j] = 1;
              queue[tail++] = j;
            }
        }
        if (tail > best.length) best = Array.from(queue.subarray(0, tail));
      }
    if (best.length < 40)
      throw Error(
        "Контур не знайдено. Змініть допуск фону або намалюйте вручну.",
      );
    const solid = new Uint8Array(w * h);
    best.forEach((i) => (solid[i] = 1));
    const edges = new Map();
    const add = (a, b) => {
      const k = a.join(",");
      if (!edges.has(k)) edges.set(k, []);
      edges.get(k).push(b);
    };
    for (const i of best) {
      let x = i % w,
        y = Math.floor(i / w);
      if (y === 0 || !solid[i - w]) add([x, y], [x + 1, y]);
      if (x === w - 1 || !solid[i + 1]) add([x + 1, y], [x + 1, y + 1]);
      if (y === h - 1 || !solid[i + w]) add([x + 1, y + 1], [x, y + 1]);
      if (x === 0 || !solid[i - 1]) add([x, y + 1], [x, y]);
    }
    let largest = [];
    while (edges.size) {
      let start = edges.keys().next().value,
        p = start.split(",").map(Number),
        poly = [],
        guard = 0;
      do {
        poly.push(p);
        const k = p.join(","),
          list = edges.get(k);
        if (!list) break;
        p = list.pop();
        if (!list.length) edges.delete(k);
        if (++guard > w * h * 4) break;
      } while (p.join(",") !== start);
      if (area(poly) > area(largest)) largest = poly;
    }
    return simplify(largest, 1.4);
  }
  function validPolygon(p) {
    if (
      !Array.isArray(p) ||
      p.length < 3 ||
      p.some(
        (q) =>
          !Array.isArray(q) ||
          q.length !== 2 ||
          q.some((v) => !Number.isFinite(v)),
      )
    )
      return false;
    const xs = p.map((q) => q[0]),
      ys = p.map((q) => q[1]);
    const span = Math.max(
      1,
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
    );
    const linear = span * 1e-9,
      epsilon = span * span * 1e-9;
    if (area(p) <= epsilon) return false;
    const cross = (a, b, c) =>
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const on = (a, b, c) =>
      Math.abs(cross(a, b, c)) <= epsilon &&
      c[0] >= Math.min(a[0], b[0]) - linear &&
      c[0] <= Math.max(a[0], b[0]) + linear &&
      c[1] >= Math.min(a[1], b[1]) - linear &&
      c[1] <= Math.max(a[1], b[1]) + linear;
    const sign = (v) => (Math.abs(v) <= epsilon ? 0 : Math.sign(v));
    for (let i = 0; i < p.length; i++) {
      const a = p[i],
        b = p[(i + 1) % p.length],
        prev = p[(i + p.length - 1) % p.length];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= linear) return false;
      if (
        Math.abs(cross(prev, a, b)) <= epsilon &&
        (a[0] - prev[0]) * (b[0] - a[0]) + (a[1] - prev[1]) * (b[1] - a[1]) <
          -linear * linear
      )
        return false;
      for (let j = i + 2; j < p.length; j++) {
        if (i === 0 && j === p.length - 1) continue;
        const c = p[j],
          d = p[(j + 1) % p.length];
        if (
          (sign(cross(a, b, c)) * sign(cross(a, b, d)) < 0 &&
            sign(cross(c, d, a)) * sign(cross(c, d, b)) < 0) ||
          on(a, b, c) ||
          on(a, b, d) ||
          on(c, d, a) ||
          on(c, d, b)
        )
          return false;
      }
    }
    return true;
  }
  const api = {
    area,
    inside,
    worldPoints,
    inTable,
    measure,
    quote,
    trace,
    simplify,
    validPolygon,
  };
  root.Geo = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);

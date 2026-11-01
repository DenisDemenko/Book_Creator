/* Wooden table bases: ten layouts, the plates that fix them under the top, and
 * the drawings / volumes derived from them. All lengths are centimetres.
 *
 * A base is a list of convex parts (a part is a rectangular or round frustum
 * between a bottom and a top point, so it can lean). The same parts give:
 *   - the 3D model (a frustum mesh per part),
 *   - the front and side drawings (convex hull of the projected vertices),
 *   - the wood volume (exact for linearly varying sections, Cavalieri),
 * so the three can never disagree. The server has a twin of this file
 * (apps/api/src/tables/table-legs.ts); a parity test keeps them equal.
 *
 * Coordinates: x along the table length, y along its width, z up, floor z = 0.
 * Overall table height H = leg length + plate thickness + top thickness.
 *
 * The ten layouts follow the base families furniture makers list for wooden
 * tables: four straight legs, tapered, splayed, turned, trestle, slab (panel)
 * ends, X-frame, sled, pedestal and tripod.
 */
(function (root) {
  "use strict";
  const DEG = Math.PI / 180;

  // limits: minimum / maximum / default of the overall height and of the leg
  // thickness (the side of its section, or the diameter of a column).
  const SCHEMES = [
    { id: "straight", name: "Прямі квадратні", note: "Чотири прямі ніжки по кутах", legs: 4 },
    { id: "tapered", name: "Конічні", note: "Звужуються донизу", legs: 4 },
    { id: "splayed", name: "Розвальні", note: "Нахилені назовні, як у mid-century", legs: 4 },
    { id: "turned", name: "Точені", note: "Круглі, виточені на верстаті", legs: 4 },
    { id: "trestle", name: "Козли", note: "Дві бічні рами та поздовжня стяжка", legs: 4 },
    { id: "slab", name: "Панельні опори", note: "Дві масивні дошки по торцях", legs: 2 },
    { id: "xframe", name: "X-подібні", note: "Діагональні схрещені опори", legs: 4 },
    { id: "sled", name: "Саночки", note: "Бічні рами з полозами", legs: 4 },
    { id: "pedestal", name: "Центральна колона", note: "Одна колона на круглій основі", legs: 1 },
    { id: "tripod", name: "Триног", note: "Три розвальні ніжки", legs: 3 },
  ].map((s) => ({
    minHeight: 40,
    maxHeight: 110,
    defaultHeight: 75,
    minThickness: s.id === "slab" ? 2 : s.id === "pedestal" ? 5 : 3,
    maxThickness: s.id === "slab" ? 10 : s.id === "pedestal" ? 18 : 14,
    defaultThickness: { straight: 6, tapered: 6, splayed: 5, turned: 7, trestle: 5, slab: 4, xframe: 5, sled: 5, pedestal: 9, tripod: 6 }[s.id],
    ...s,
  }));

  const part = (id, role, type, bottom, top, bs, ts, yaw = 0, extra = {}) => ({
    id, role, type, bottom, top, bs, ts, yaw, ...extra,
  });

  // Where the four legs stand. They keep a margin from the edge, and on a
  // round or oval top they are pulled in so that they stay under the top.
  function corners(p, T) {
    const edge = 4 + T / 2;
    let hx = p.l / 2 - edge,
      hy = p.w / 2 - edge;
    if (p.shape !== "square") {
      hx *= 0.72;
      hy *= 0.72;
    }
    hx = Math.max(hx, T / 2 + 1);
    hy = Math.max(hy, T / 2 + 1);
    return { hx, hy, list: [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]] };
  }

  // Leg length: what is left of the overall height under the plate and the top.
  function legLength(p) {
    return p.height - p.t - p.plateT;
  }

  function build(id, p) {
    const T = p.thickness,
      Lg = legLength(p),
      parts = [],
      mounts = [];
    const c = corners(p, T);
    const mount = (x, y, a, b, yaw = 0, kind = "leg") =>
      mounts.push({ x, y, a, b, yaw, kind });
    switch (id) {
      case "straight":
        c.list.forEach(([x, y], i) => {
          parts.push(part("leg" + i, "leg", "rect", [x, y, 0], [x, y, Lg], [T, T], [T, T]));
          mount(x, y, T, T);
        });
        break;
      case "tapered":
        c.list.forEach(([x, y], i) => {
          parts.push(part("leg" + i, "leg", "rect", [x, y, 0], [x, y, Lg], [T * 0.5, T * 0.5], [T, T]));
          mount(x, y, T, T);
        });
        break;
      case "splayed": {
        const out = Math.min(16, Lg * 0.2);
        c.list.forEach(([x, y], i) => {
          const sx = Math.sign(x),
            sy = Math.sign(y);
          parts.push(
            part("leg" + i, "leg", "rect", [x + sx * out, y + sy * out * 0.6, 0], [x, y, Lg], [T * 0.8, T * 0.8], [T, T]),
          );
          mount(x, y, T, T);
        });
        break;
      }
      case "turned": {
        // profile from the floor up: [height fraction, diameter in thicknesses]
        const prof = [[0, 0.55], [0.1, 0.62], [0.45, 0.92], [0.62, 1.0], [0.74, 0.7], [0.8, 0.7]];
        c.list.forEach(([x, y], i) => {
          for (let k = 0; k < prof.length - 1; k++)
            parts.push(
              part(`leg${i}.${k}`, "leg", "round", [x, y, prof[k][0] * Lg], [x, y, prof[k + 1][0] * Lg],
                [T * prof[k][1], T * prof[k][1]], [T * prof[k + 1][1], T * prof[k + 1][1]]),
            );
          parts.push(part(`leg${i}.block`, "leg", "rect", [x, y, 0.8 * Lg], [x, y, Lg], [T, T], [T, T]));
          mount(x, y, T, T);
        });
        break;
      }
      case "trestle": {
        const px = c.hx,
          py = c.hy;
        [-1, 1].forEach((sx, k) => {
          [-1, 1].forEach((sy, j) => {
            const x = sx * px,
              ty = sy * py * 0.82,
              by = sy * py;
            parts.push(part(`post${k}${j}`, "leg", "rect", [x, by, 0], [x, ty, Lg], [T * 0.8, T], [T * 0.8, T]));
            mount(x, ty, T * 0.8, T);
          });
          parts.push(
            part(`bar${k}`, "rail", "rect", [x0(sx, px), 0, 0.84 * Lg], [x0(sx, px), 0, Lg], [T * 0.8, py * 1.64], [T * 0.8, py * 1.64]),
          );
        });
        parts.push(part("stretcher", "rail", "rect", [0, 0, 0.22 * Lg], [0, 0, 0.22 * Lg + T * 0.7], [px * 2, T * 0.7], [px * 2, T * 0.7]));
        break;
      }
      case "slab": {
        const x = Math.max(p.l / 2 - 4 - T / 2, T);
        const k = p.shape === "square" ? 1 : 0.72;
        const px = x * k;
        const wid = Math.max(10, Math.min(p.w * 0.72, p.w - 10));
        [-1, 1].forEach((sx, i) => {
          parts.push(part("panel" + i, "panel", "rect", [sx * px, 0, 0], [sx * px, 0, Lg], [T, wid], [T, wid]));
          mount(sx * px, 0, T, wid, 0, "panel");
        });
        break;
      }
      case "xframe": {
        const px = c.hx * 0.8,
          py = c.hy;
        [-1, 1].forEach((sx, k) =>
          [-1, 1].forEach((sy, j) => {
            const topY = sy * py * 0.85;
            parts.push(part(`bar${k}${j}`, "leg", "rect", [sx * px, -sy * py, 0], [sx * px, topY, Lg], [T * 0.7, T], [T * 0.7, T]));
            mount(sx * px, topY, T * 0.7, T);
          }),
        );
        break;
      }
      case "sled": {
        const rh = T * 0.8;
        [-1, 1].forEach((sy, j) =>
          parts.push(part("runner" + j, "rail", "rect", [0, sy * c.hy, 0], [0, sy * c.hy, rh], [c.hx * 2 + T, T * 0.9], [c.hx * 2 + T, T * 0.9])),
        );
        c.list.forEach(([x, y], i) => {
          parts.push(part("leg" + i, "leg", "rect", [x, y, rh], [x, y, Lg], [T, T * 0.9], [T, T * 0.9]));
          mount(x, y, T, T * 0.9);
        });
        break;
      }
      case "pedestal": {
        const D = Math.max(T * 2.4, 12);
        const foot = Math.min(0.55 * Math.min(p.l, p.w), 60);
        const fh = Math.max(3, Lg * 0.06);
        parts.push(part("foot", "leg", "round", [0, 0, 0], [0, 0, fh], [foot, foot], [foot * 0.92, foot * 0.92]));
        parts.push(part("column", "leg", "round", [0, 0, fh], [0, 0, Lg], [D * 0.85, D * 0.85], [D, D]));
        mount(0, 0, D, D, 0, "column");
        break;
      }
      case "tripod": {
        const m = Math.min(p.l, p.w),
          rt = m * 0.14,
          rb = m * 0.36;
        [90, 210, 330].forEach((deg, i) => {
          const cx = Math.cos(deg * DEG),
            cy = Math.sin(deg * DEG);
          parts.push(part("leg" + i, "leg", "round", [rb * cx, rb * cy, 0], [rt * cx, rt * cy, Lg], [T * 0.75, T * 0.75], [T * 1.1, T * 1.1]));
          mount(rt * cx, rt * cy, T * 1.1, T * 1.1);
        });
        break;
      }
      default:
        throw new Error("Невідома схема ніжок: " + id);
    }
    return { parts, mounts, legLength: Lg };
  }
  const x0 = (sx, px) => sx * px;

  // A leg drawn by the workshop as an SVG: the file is the silhouette seen
  // from the front (or from the side for end panels). `fill` is the share of
  // its bounding box that is wood; `placement` says how many and where.
  function buildFromSvg(design, p) {
    const T = p.thickness,
      Lg = legLength(p),
      parts = [],
      mounts = [];
    const c = corners(p, T);
    if (design.placement === "ends") {
      const wid = Math.max(10, Math.min(p.w * 0.72, p.w - 10));
      const px = Math.max(p.l / 2 - 4 - T / 2, T) * (p.shape === "square" ? 1 : 0.72);
      [-1, 1].forEach((sx, i) => {
        parts.push(part("panel" + i, "panel", "rect", [sx * px, 0, 0], [sx * px, 0, Lg], [T, wid], [T, wid], 0, { svg: "side", fill: design.fill }));
        mounts.push({ x: sx * px, y: 0, a: T, b: wid, yaw: 0, kind: "panel" });
      });
    } else if (design.placement === "center") {
      const D = Math.max(T * 2.4, 12);
      parts.push(part("column", "leg", "rect", [0, 0, 0], [0, 0, Lg], [D, D], [D, D], 0, { svg: "front", fill: design.fill }));
      mounts.push({ x: 0, y: 0, a: D, b: D, yaw: 0, kind: "column" });
    } else {
      c.list.forEach(([x, y], i) => {
        parts.push(part("leg" + i, "leg", "rect", [x, y, 0], [x, y, Lg], [T, T], [T, T], 0, { svg: "front", fill: design.fill }));
        mounts.push({ x, y, a: T, b: T, yaw: 0, kind: "leg" });
      });
    }
    return { parts, mounts, legLength: Lg };
  }

  // The mounting plate under every leg: wooden, as thick as the administrator
  // says, with four holes whose size and distance from the edge belong to the
  // plate type. It is never smaller than the foot of the leg it carries.
  function plates(mounts, spec, plateT, z) {
    return mounts.map((m, i) => {
      const w = Math.max(spec.widthCm, m.a + 4),
        d = Math.max(spec.depthCm, m.b + 4);
      const inset = Math.min(spec.holeInsetMm / 10, w / 2 - 0.5, d / 2 - 0.5);
      const r = spec.holeDiameterMm / 20;
      const hx = w / 2 - inset,
        hy = d / 2 - inset;
      const holes = [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([hx0, hy0]) => ({
        x: m.x + hx0,
        y: m.y + hy0,
        diameterMm: spec.holeDiameterMm,
      }));
      const volume = Math.max(0, w * d * plateT - 4 * Math.PI * r * r * plateT);
      return { id: "plate" + i, x: m.x, y: m.y, z, w, d, t: plateT, holes, volume, countersink: !!spec.countersink };
    });
  }

  function vertices(pt) {
    const out = [],
      n = pt.type === "round" ? 24 : 4;
    const cos = Math.cos(pt.yaw * DEG),
      sin = Math.sin(pt.yaw * DEG);
    for (const [c, s] of [[pt.bottom, pt.bs], [pt.top, pt.ts]]) {
      for (let k = 0; k < n; k++) {
        let u, v;
        if (pt.type === "round") {
          const a = (k / n) * Math.PI * 2;
          u = (Math.cos(a) * s[0]) / 2;
          v = (Math.sin(a) * s[1]) / 2;
        } else {
          u = (k === 0 || k === 3 ? -1 : 1) * (s[0] / 2);
          v = (k < 2 ? -1 : 1) * (s[1] / 2);
        }
        out.push([c[0] + u * cos - v * sin, c[1] + u * sin + v * cos, c[2]]);
      }
    }
    return out;
  }

  function hull(points) {
    const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return pts;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
      upper.push(p);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
  }

  /** Outline of one part seen from the front ("front": x,z) or the side ("side": y,z). */
  function outline(pt, view) {
    const i = view === "front" ? 0 : 1;
    return hull(vertices(pt).map((v) => [v[i], v[2]]));
  }

  /** Volume of one part in cm3, exact for sections that vary linearly. */
  function volume(pt) {
    const h = Math.abs(pt.top[2] - pt.bottom[2]);
    const [a1, b1] = pt.bs,
      [a2, b2] = pt.ts;
    const da = a2 - a1,
      db = b2 - b1;
    const mean = a1 * b1 + (a1 * db + b1 * da) / 2 + (da * db) / 3;
    const k = pt.type === "round" ? Math.PI / 4 : 1;
    return h * mean * k * (pt.fill ?? 1);
  }

  /**
   * The cost of a base. `material.pricePerM3` is per cubic metre of the leg
   * wood; the plates have their own price; work is per fixing point.
   */
  function cost(base, plateList, material, settings) {
    const legVolume = base.parts.reduce((s, x) => s + volume(x), 0);
    const plateVolume = plateList.reduce((s, x) => s + x.volume, 0);
    const wood = (legVolume / 1e6) * material.pricePerM3;
    const plate = (plateVolume / 1e6) * settings.plateWoodPerM3;
    const work = base.mounts.length * settings.workPerMount;
    return { legVolume, plateVolume, wood, plate, work, total: wood + plate + work };
  }

  function layout(p, design) {
    const known = SCHEMES.find((s) => s.id === p.scheme);
    return known ? build(p.scheme, p) : buildFromSvg(design, p);
  }

  root.TableLegs = { SCHEMES, build, buildFromSvg, layout, plates, vertices, outline, volume, cost, legLength, hull };
})(typeof window !== "undefined" ? window : globalThis);

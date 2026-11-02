/* The edges of the tabletop: rounded or cut straight at 45 degrees. The rules for choosing, and the geometry for
 * the 3D view.
 *
 * The top of a table is worked on the face side (upper) and on the underside, each with its own style:
 *   "round"   - a quarter circle of radius r,
 *   "chamfer" - a straight cut at 45 degrees, r across and r down,
 * with r from 1 mm up to the thickness of the top; together the two cannot be more than the thickness (a half-round
 * edge, top = bottom = thickness / 2, is the largest). Radii are in millimetres, the table in centimetres, as in
 * the rest of the builder. No THREE here: the 3D view makes its mesh from the arrays this returns, and the tests
 * read them directly.
 */
(function (root) {
  "use strict";

  const MIN_MM = 1;
  const ARC_STEPS = 8;
  const ELLIPSE_STEPS = 96;
  const STYLES = ["round", "chamfer"];
  const H = Math.SQRT1_2; // the normal of a 45 degree cut

  const styleOf = (s) => (s === "chamfer" ? "chamfer" : "round");

  // One size: nothing below 1 mm (that is "no work on this edge"), nothing above the thickness.
  function clampOne(value, thicknessMm) {
    const v = Math.round(Number(value) || 0);
    if (v < MIN_MM) return 0;
    return Math.min(v, Math.max(0, Math.round(thicknessMm)));
  }

  // The pair of sizes that is allowed: each 0 or 1..T, and together at most T. When they do not fit, the one the
  // buyer is not touching gives way (`prefer` is the one he is changing).
  function fit(top, bottom, thicknessMm, prefer = "top") {
    const T = Math.max(0, Math.round(thicknessMm));
    let a = clampOne(top, T),
      b = clampOne(bottom, T);
    if (a + b > T) {
      if (prefer === "bottom") a = clampOne(T - b, T);
      else b = clampOne(T - a, T);
    }
    return { top: a, bottom: b };
  }

  // The choices offered for a top T mm thick: sizes in proportion to the thickness, never more than together fit.
  function presets(thicknessMm) {
    const T = Math.max(1, Math.round(thicknessMm));
    const r = (k) => Math.max(MIN_MM, Math.min(Math.floor(T / 2), Math.round(T * k)));
    const R = "round",
      C = "chamfer";
    const list = [
      { id: "none", name: "Без обробки країв", top: 0, bottom: 0, topStyle: R, bottomStyle: R },
      { id: "light", name: "Легке скруглення", top: r(0.05), bottom: r(0.05), topStyle: R, bottomStyle: R },
      { id: "soft", name: "М’яке скруглення", top: r(0.12), bottom: r(0.12), topStyle: R, bottomStyle: R },
      { id: "classic", name: "Класичне скруглення", top: r(0.25), bottom: r(0.25), topStyle: R, bottomStyle: R },
      { id: "face", name: "Лицьове (верх більший)", top: Math.min(T - r(0.1), r(0.4) + Math.round(T * 0.1)), bottom: r(0.1), topStyle: R, bottomStyle: R },
      { id: "bullnose", name: "Напівкругле", top: Math.floor(T / 2), bottom: Math.floor(T / 2), topStyle: R, bottomStyle: R },
      { id: "chamfer-light", name: "Фаска 45° (легка)", top: r(0.06), bottom: r(0.06), topStyle: C, bottomStyle: C },
      { id: "chamfer", name: "Фаска 45°", top: r(0.2), bottom: r(0.2), topStyle: C, bottomStyle: C },
      { id: "chamfer-top", name: "Фаска 45° лише зверху", top: r(0.25), bottom: 0, topStyle: C, bottomStyle: R },
    ];
    const seen = new Set();
    return list
      .map((p) => ({ ...p, ...fit(p.top, p.bottom, T) }))
      .filter((p) => {
        const key = [p.top, p.bottom, p.top ? p.topStyle : "", p.bottom ? p.bottomStyle : ""].join("/");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  // ---------------------------------------------------------------- geometry
  // The outline of the top, drawn in from its edge by `inset` cm: as the edges of a rectangle (each with its
  // own normal, so the corners stay sharp) or as one closed curve for a round or oval top.
  function outline(top, inset) {
    const a = top.l / 2,
      b = top.w / 2;
    if (top.shape === "square") {
      const x = Math.max(a - inset, 0.01),
        y = Math.max(b - inset, 0.01);
      return [
        { pts: [[-x, -y], [x, -y]], ns: [[0, -1], [0, -1]] },
        { pts: [[x, -y], [x, y]], ns: [[1, 0], [1, 0]] },
        { pts: [[x, y], [-x, y]], ns: [[0, 1], [0, 1]] },
        { pts: [[-x, y], [-x, -y]], ns: [[-1, 0], [-1, 0]] },
      ];
    }
    const ea = Math.max(a - inset, 0.01),
      eb = Math.max(b - inset, 0.01);
    const pts = [],
      ns = [];
    for (let k = 0; k <= ELLIPSE_STEPS; k++) {
      const t = (k / ELLIPSE_STEPS) * Math.PI * 2;
      const c = Math.cos(t),
        s = Math.sin(t);
      const nx = c / ea,
        ny = s / eb,
        len = Math.hypot(nx, ny) || 1;
      pts.push([ea * c, eb * s]);
      ns.push([nx / len, ny / len]);
    }
    return [{ pts, ns }];
  }

  // The section of the edge, from the underside up: where each point is (inset from the edge, height) and which way
  // it faces (a share of the outward normal along the table, and upwards). A straight cut has its own normal at both
  // ends and the next point repeated with the normal of what follows, so the line stays sharp where it meets the wall.
  function profile(t, rt, rb, styleTop = "round", styleBottom = "round") {
    const out = [];
    if (rb > 0 && styleOf(styleBottom) === "chamfer") {
      out.push({ inset: rb, z: 0, hn: H, vn: -H }, { inset: 0, z: rb, hn: H, vn: -H }, { inset: 0, z: rb, hn: 1, vn: 0 });
    } else if (rb > 0) {
      for (let k = 0; k <= ARC_STEPS; k++) {
        const th = (k / ARC_STEPS) * (Math.PI / 2);
        out.push({ inset: rb * (1 - Math.sin(th)), z: rb * (1 - Math.cos(th)), hn: Math.sin(th), vn: -Math.cos(th) });
      }
    } else out.push({ inset: 0, z: 0, hn: 1, vn: 0 });
    if (rt > 0 && styleOf(styleTop) === "chamfer") {
      out.push({ inset: 0, z: t - rt, hn: 1, vn: 0 }, { inset: 0, z: t - rt, hn: H, vn: H }, { inset: rt, z: t, hn: H, vn: H });
    } else if (rt > 0) {
      for (let k = 0; k <= ARC_STEPS; k++) {
        const th = (k / ARC_STEPS) * (Math.PI / 2);
        out.push({ inset: rt * (1 - Math.cos(th)), z: t - rt + rt * Math.sin(th), hn: Math.cos(th), vn: Math.sin(th) });
      }
    } else out.push({ inset: 0, z: t, hn: 1, vn: 0 });
    return out;
  }

  /**
   * The mesh of the top. top = { shape, l, w, t } in cm, rt and rb in cm (face side and underside), and the style of
   * each ("round" or "chamfer"). Coordinates: x along the length, y up (0 = the underside, t = the face), z across
   * the width (the same as the shape's y of the 2D sketch). Returns flat arrays: positions, normals, uvs, and two
   * index lists: `cap` for the faces and the worked edges (these carry the picture of the composition) and `wall`
   * for the plain side. Every triangle faces outwards. The UVs are the plan of the top, as in the sketch.
   */
  function geometry(top, rt, rb, styleTop = "round", styleBottom = "round") {
    const positions = [],
      normals = [],
      uvs = [],
      cap = [],
      wall = [];
    const t = top.t;
    const vertex = (x, y, z, n) => {
      positions.push(x, y, z);
      normals.push(n[0], n[1], n[2]);
      uvs.push(x / top.l + 0.5, 1 - (z / top.w + 0.5));
      return positions.length / 3 - 1;
    };
    // A triangle, turned if need be so that it faces the way its normals do.
    const triangle = (list, a, b, c) => {
      const p = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]],
        v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = [0, 1, 2].map((k) => normals[a * 3 + k] + normals[b * 3 + k] + normals[c * 3 + k]);
      if (cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] >= 0) list.push(a, b, c);
      else list.push(a, c, b);
    };

    const prof = profile(t, rt, rb, styleTop, styleBottom);
    const levels = prof.map((q) => outline(top, q.inset));
    // The sides: a strip for every edge, between two neighbouring points of the section.
    for (let e = 0; e < levels[0].length; e++) {
      const rows = prof.map((q, i) =>
        levels[i][e].pts.map(([x, z], j) => {
          const [nx, nz] = levels[i][e].ns[j];
          return vertex(x, q.z, z, [nx * q.hn, q.vn, nz * q.hn]);
        }),
      );
      for (let i = 0; i + 1 < prof.length; i++) {
        const isWall = prof[i].inset === 0 && prof[i + 1].inset === 0;
        if (isWall && Math.abs(prof[i + 1].z - prof[i].z) < 1e-9) continue;
        const list = isWall ? wall : cap;
        for (let j = 0; j + 1 < rows[i].length; j++) {
          triangle(list, rows[i][j], rows[i][j + 1], rows[i + 1][j + 1]);
          triangle(list, rows[i][j], rows[i + 1][j + 1], rows[i + 1][j]);
        }
      }
    }
    // The flat faces: a fan from the centre (the top is convex).
    const face = (inset, y, normal) => {
      const ring = [];
      for (const edge of outline(top, inset)) for (let j = 0; j < edge.pts.length - (top.shape === "square" ? 1 : 0); j++) ring.push(edge.pts[j]);
      const centre = vertex(0, y, 0, normal);
      const ids = ring.map(([x, z]) => vertex(x, y, z, normal));
      for (let k = 0; k < ids.length; k++) triangle(cap, centre, ids[k], ids[(k + 1) % ids.length]);
    };
    face(rt, t, [0, 1, 0]);
    face(rb, 0, [0, -1, 0]);
    return { positions, normals, uvs, cap, wall };
  }

  // The section of the top for the front and side drawings of the table: a rectangle whose two top corners are worked
  // by rt and the two bottom ones by rb (cm), rounded or cut straight, as an SVG path. x0..x1 across, y0 the face, y1
  // the underside (y grows down).
  function sectionPath(x0, x1, y0, y1, rt, rb, styleTop = "round", styleBottom = "round") {
    const f = (v) => +v.toFixed(3);
    // From the point we are at to (x, y) round a corner: an arc, or the straight cut.
    const corner = (r, style, x, y) => (style === "chamfer" || !r ? `L ${f(x)} ${f(y)}` : `A ${f(r)} ${f(r)} 0 0 1 ${f(x)} ${f(y)}`);
    return [
      `M ${f(x0 + rt)} ${f(y0)}`,
      `L ${f(x1 - rt)} ${f(y0)}`,
      corner(rt, styleOf(styleTop), x1, y0 + rt),
      `L ${f(x1)} ${f(y1 - rb)}`,
      corner(rb, styleOf(styleBottom), x1 - rb, y1),
      `L ${f(x0 + rb)} ${f(y1)}`,
      corner(rb, styleOf(styleBottom), x0, y1 - rb),
      `L ${f(x0)} ${f(y0 + rt)}`,
      corner(rt, styleOf(styleTop), x0 + rt, y0),
      "Z",
    ].join(" ");
  }

  root.TableEdges = { MIN_MM, STYLES, styleOf, fit, presets, geometry, profile, outline, sectionPath };
})(typeof window !== "undefined" ? window : globalThis);

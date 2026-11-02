/* Production files of an ordered table: vector sheets as SVG and DXF, a 3D model as OBJ, a bill of materials.
 *
 * The files are made from the order the admin already holds (the design, the slabs and the quote of the legs), with the
 * same geometry the buyer saw: Geo (the top and the slabs), TableLegs (legs, slats, plates), TableEdges (worked edges).
 * No DOM and no THREE here, so the page and the tests (and the PDF drawings that reuse these sheets) read the same
 * output. Every sheet is a list of primitives on named layers, drawn 1:1 in millimetres; SVG and DXF only write them.
 */
(function (root) {
  "use strict";

  const MM = 10; // the builder works in cm
  const n = (v) => String(Math.round(v * 1000) / 1000);
  // a figure on a drawing: tenths of a millimetre are enough
  const fmt = (v) => n(Math.round(v * 10) / 10);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const deps = () => {
    const { Geo, TableLegs, TableEdges } = root;
    if (!Geo || !TableLegs || !TableEdges) throw Error("Потрібні geometry.js, table-legs.js і table-edges.js.");
    return { Geo, TL: TableLegs, TE: TableEdges };
  };

  // ------------------------------------------------------------------ the order
  const boxy = (o) => o.shape === "square" || o.shape === "rect";
  function cornerCm(o) {
    return boxy(o) ? Math.min(Math.max(Number(o.cornerMm) || 0, 0) / 10, o.l / 2, o.w / 2) : 0;
  }
  // The outline of the top, mm, centre at 0,0, y down.
  function topRing(o) {
    const a = (o.l / 2) * MM,
      b = (o.w / 2) * MM;
    if (!boxy(o)) return Array.from({ length: 144 }, (_, k) => [a * Math.cos((k / 144) * Math.PI * 2), b * Math.sin((k / 144) * Math.PI * 2)]);
    const r = cornerCm(o) * MM;
    if (!(r > 0)) return [[-a, -b], [a, -b], [a, b], [-a, b]];
    const out = [];
    const steps = 12;
    for (const [sx, sy, from] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]])
      for (let k = 0; k <= steps; k++) {
        const t = ((from + (90 * k) / steps) * Math.PI) / 180;
        out.push([sx * (a - r) + r * Math.cos(t), sy * (b - r) + r * Math.sin(t)]);
      }
    return out;
  }
  const scaleRing = (ring) => ring.map(([x, y]) => [x * MM, y * MM]);

  // A polygon cut by a convex one (Sutherland-Hodgman): the part of a slab that lies on the top.
  function clipTo(subject, clip) {
    const turn = clip.reduce((a, q, i) => a + (q[0] * clip[(i + 1) % clip.length][1] - clip[(i + 1) % clip.length][0] * q[1]), 0);
    const c = turn < 0 ? clip.slice().reverse() : clip;
    let out = subject;
    for (let i = 0; i < c.length && out.length; i++) {
      const a = c[i], b = c[(i + 1) % c.length];
      const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const cross = (p, q) => {
        const sp = side(p), sq = side(q), t = sp / (sp - sq);
        return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      };
      const next = [];
      out.forEach((p, k) => {
        const q = out[(k + out.length - 1) % out.length];
        if (side(p) >= 0) { if (side(q) < 0) next.push(cross(q, p)); next.push(p); }
        else if (side(q) >= 0) next.push(cross(q, p));
      });
      out = next;
    }
    return out;
  }
  // The pieces on the top: the slab and where it lies, mm in the plan, cut by the edge of the top.
  function placed(o) {
    const { Geo } = deps();
    const out = [];
    for (const p of o.pieces || []) {
      const slab = (o.slabs || []).find((s) => s.id === p.id);
      if (!slab) throw Error("У замовленні немає слеба " + p.id + ".");
      const ring = clipTo(scaleRing(Geo.worldPoints(slab, p)), topRing(o));
      if (ring.length >= 3) out.push({ slab, piece: p, ring });
    }
    return out;
  }

  // The legs of the order as the buyer drew them.
  function legsOf(o) {
    const { TL } = deps();
    const q = o.quote && o.quote.legs;
    const set = o.legSet;
    if (!q || !set) return null;
    const known = TL.SCHEMES.find((s) => s.id === set.scheme);
    const plateSpec = q.plate;
    const input = {
      shape: o.shape, l: o.l, w: o.w, t: o.t,
      corner: (Number(o.cornerMm) || 0) / 10,
      scheme: set.scheme, height: q.height, thickness: q.thickness,
      plateT: q.plateThicknessCm, inset: q.inset,
      legDims: q.legDims || undefined, columnDims: q.columnDims || undefined, slats: q.slats || undefined,
      plateCm: Math.max(TL.plateSide(plateSpec.widthCm), TL.plateSide(plateSpec.depthCm)),
    };
    if (!known) return { q, input, base: null, plates: null, custom: true };
    const base = TL.layout(input);
    const plates = TL.plates(base.mounts, plateSpec, input.plateT, base.legLength, { l: o.l, w: o.w });
    return { q, input, base, plates, custom: false };
  }

  // ------------------------------------------------------------------ primitives and the sheets
  // poly: { layer, pts, closed, fill? } · rings: { layer, rings, fill } (even-odd) · circle: { layer, c, r }
  // text: { layer, p, h, s, anchor? } · line: { layer, a, b }
  const LAYERS = {
    TABLE_OUTLINE: { color: 7, stroke: "#222", width: 1.2, note: "контур стільниці: різ" },
    SLABS: { color: 3, stroke: "#6b4a2b", width: 0.8, fill: "#c9a36b", note: "слеби: контури й дерево" },
    RESIN: { color: 4, stroke: "none", width: 0, fill: "#2f6f78", note: "залив епоксидної смоли" },
    EDGE_LINE: { color: 8, stroke: "#777", width: 0.6, dash: "8 5", note: "де закінчується лицьова обробка краю" },
    PLATES: { color: 1, stroke: "#8a5a2b", width: 0.9, fill: "#d6b98a", note: "пластини" },
    PLATE_HOLES: { color: 5, stroke: "#222", width: 0.7, fill: "#fff", note: "отвори під болти" },
    LEGS: { color: 2, stroke: "#4a3320", width: 0.9, fill: "#b88a56", note: "ніжки" },
    LEG_SEAMS: { color: 6, stroke: "#4a3320", width: 0.5, note: "рейки" },
    TOP_SECTION: { color: 7, stroke: "#222", width: 1.0, fill: "#8aa7a8", note: "розріз стільниці" },
    DIMENSIONS: { color: 8, stroke: "#555", width: 0.5, note: "розміри" },
    TEXT: { color: 7, stroke: "#222", width: 0, note: "підписи" },
  };
  const poly = (layer, pts, closed = true, extra = {}) => ({ kind: "poly", layer, pts, closed, ...extra });
  const circle = (layer, c, r) => ({ kind: "circle", layer, c, r });
  const text = (layer, p, h, s, anchor = "start") => ({ kind: "text", layer, p, h, s: String(s), anchor });
  const line = (layer, a, b) => ({ kind: "poly", layer, pts: [a, b], closed: false });

  // A dimension line with its figure, horizontal (a to b at height y) or vertical (a to b at x).
  function dimH(x0, x1, y, label, h = 28) {
    const t = 12;
    return [
      line("DIMENSIONS", [x0, y], [x1, y]), line("DIMENSIONS", [x0, y - t], [x0, y + t]), line("DIMENSIONS", [x1, y - t], [x1, y + t]),
      text("TEXT", [(x0 + x1) / 2, y - 8], h, label, "middle"),
    ];
  }
  function dimV(y0, y1, x, label, h = 28) {
    const t = 12;
    return [
      line("DIMENSIONS", [x, y0], [x, y1]), line("DIMENSIONS", [x - t, y0], [x + t, y0]), line("DIMENSIONS", [x - t, y1], [x + t, y1]),
      text("TEXT", [x - 10, (y0 + y1) / 2], h, label, "end"),
    ];
  }
  const bbox = (prims) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const p of prims) {
      if (p.kind === "poly") p.pts.forEach(([x, y]) => add(x, y));
      else if (p.kind === "path") p.pts.forEach(([x, y]) => add(x, y));
      else if (p.kind === "rings") p.rings.forEach((r) => r.forEach(([x, y]) => add(x, y)));
      else if (p.kind === "circle") { add(p.c[0] - p.r, p.c[1] - p.r); add(p.c[0] + p.r, p.c[1] + p.r); }
      else if (p.kind === "text") { const w = p.s.length * p.h * 0.6; add(p.anchor === "middle" ? p.p[0] - w / 2 : p.anchor === "end" ? p.p[0] - w : p.p[0], p.p[1] - p.h); add(p.anchor === "middle" ? p.p[0] + w / 2 : p.anchor === "end" ? p.p[0] : p.p[0] + w, p.p[1] + p.h * 0.3); }
    }
    return { x0, y0, x1, y1 };
  };
  // A sheet: the primitives moved so that the margin starts at 0,0.
  function sheet(id, title, all, margin = 80) {
    // the caption stands above the drawing, whatever its size
    const prims = all.filter((p) => !p.caption);
    const body = bbox(prims);
    for (const c of all.filter((p) => p.caption)) prims.push({ ...c, p: [body.x0, body.y0 - 60] });
    const b = bbox(prims);
    const dx = margin - b.x0,
      dy = margin - b.y0;
    const mv = ([x, y]) => [x + dx, y + dy];
    const moved = prims.map((p) =>
      p.kind === "poly" ? { ...p, pts: p.pts.map(mv) }
        : p.kind === "path" ? { ...p, pts: p.pts.map(mv), tx: dx, ty: dy }
        : p.kind === "rings" ? { ...p, rings: p.rings.map((r) => r.map(mv)) }
        : p.kind === "circle" ? { ...p, c: mv(p.c) }
        : { ...p, p: mv(p.p) });
    return { id, title, w: b.x1 - b.x0 + 2 * margin, h: b.y1 - b.y0 + 2 * margin, prims: moved };
  }
  const header = (o, what) => [
    { ...text("TEXT", [0, 0], 34, `Стіл №${o.number} · ${what}`), caption: true },
  ];

  // ---- 01 the top in plan: outline, slabs, resin, where the edge work ends
  function sheetTop(o) {
    const { TE } = deps();
    const ring = topRing(o);
    const pcs = placed(o);
    const prims = [...header(o, "стільниця зверху, мм")];
    prims.push({ kind: "rings", layer: "RESIN", rings: [ring, ...pcs.map((p) => p.ring)], fill: true });
    prims.push(poly("TABLE_OUTLINE", ring));
    for (const p of pcs) {
      prims.push(poly("SLABS", p.ring));
      const cx = p.ring.reduce((s, q) => s + q[0], 0) / p.ring.length,
        cy = p.ring.reduce((s, q) => s + q[1], 0) / p.ring.length;
      prims.push(text("TEXT", [cx, cy], 30, `${p.slab.number} · ${p.slab.species}`, "middle"));
    }
    const top = { shape: o.shape, l: o.l, w: o.w, t: o.t, corner: cornerCm(o) };
    const e = Math.max(Number(o.edgeTopMm) || 0, 0) / 10;
    if (e > 0)
      for (const lp of TE.outline(top, e)) prims.push(poly("EDGE_LINE", scaleRing(lp.pts), lp.closed !== false && lp.pts.length > 2));
    const a = (o.l / 2) * MM, b = (o.w / 2) * MM;
    prims.push(...dimH(-a, a, b + 90, `${fmt(o.l * MM)} мм`));
    prims.push(...dimV(-b, b, a + 90, `${fmt(o.w * MM)} мм`));
    prims.push(text("TEXT", [-a, b + 170], 26, `Товщина ${fmt(o.t * MM)} мм` + (cornerCm(o) ? ` · радіус кутів ${fmt(cornerCm(o) * MM)} мм` : "") + (e > 0 || Number(o.edgeBottomMm) > 0 ? ` · краї: верх ${Number(o.edgeTopMm) || 0} мм, низ ${Number(o.edgeBottomMm) || 0} мм` : "")));
    return sheet("01-top-plan", "Стільниця зверху", prims);
  }

  // ---- 02 the section of the top with its worked edges
  function sheetSection(o) {
    const { TE } = deps();
    const half = (o.l / 2) * MM;
    const rt = Math.min(Math.max(Number(o.edgeTopMm) || 0, 0), o.t * MM),
      rb = Math.min(Math.max(Number(o.edgeBottomMm) || 0, 0), o.t * MM - rt);
    const prims = [...header(o, "розріз стільниці, мм")];
    prims.push({ kind: "path", layer: "TOP_SECTION", d: TE.sectionPath(-half, half, 0, o.t * MM, rt, rb, o.edgeTopStyle, o.edgeBottomStyle), pts: [[-half, 0], [half, o.t * MM]] });
    prims.push(...dimV(0, o.t * MM, half + 60, `${fmt(o.t * MM)} мм`));
    prims.push(...dimH(-half, half, o.t * MM + 70, `${fmt(o.l * MM)} мм`));
    if (rt) prims.push(text("TEXT", [-half, o.t * MM + 130], 24, `Верхній край: ${o.edgeTopStyle === "chamfer" ? "фаска 45°" : "скруглення"} ${fmt(rt)} мм`));
    if (rb) prims.push(text("TEXT", [-half, o.t * MM + 165], 24, `Нижній край: ${o.edgeBottomStyle === "chamfer" ? "фаска 45°" : "скруглення"} ${fmt(rb)} мм`));
    return sheet("02-top-section", "Розріз стільниці", prims);
  }

  // ---- 03 plates and legs in plan
  function sheetLegsPlan(o, lg) {
    const { TL } = deps();
    const prims = [...header(o, "ніжки й пластини зверху, мм")];
    prims.push(poly("TABLE_OUTLINE", topRing(o)));
    const fp = TL.footprint(lg.base, lg.plates);
    for (const p of fp.parts) prims.push(poly("LEGS", p.poly.map(([x, y]) => [x * MM, y * MM])));
    lg.plates.forEach((p, i) => {
      const x0 = (p.x - p.w / 2) * MM, y0 = (p.y - p.d / 2) * MM, x1 = (p.x + p.w / 2) * MM, y1 = (p.y + p.d / 2) * MM;
      prims.push(poly("PLATES", [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]));
      for (const h of p.holes) prims.push(circle("PLATE_HOLES", [h.x * MM, h.y * MM], h.diameterMm / 2));
      prims.push(text("TEXT", [p.x * MM, p.y * MM + 8], 24, `П${i + 1}`, "middle"));
    });
    return sheet("03-legs-plan", "Ніжки й пластини зверху", prims);
  }

  // ---- 04 one plate in detail
  function sheetPlate(o, lg) {
    const p = lg.plates[0];
    const w = p.w * MM, d = p.d * MM;
    const prims = [...header(o, "пластина, мм")];
    prims.push(poly("PLATES", [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]));
    for (const h of p.holes) prims.push(circle("PLATE_HOLES", [(h.x - p.x) * MM, (h.y - p.y) * MM], h.diameterMm / 2));
    const hx = Math.abs(p.holes[0].x - p.x) * MM, hy = Math.abs(p.holes[0].y - p.y) * MM;
    prims.push(...dimH(-w / 2, w / 2, d / 2 + 60, `${fmt(w)} мм`));
    prims.push(...dimV(-d / 2, d / 2, w / 2 + 60, `${fmt(d)} мм`));
    prims.push(text("TEXT", [-w / 2, -d / 2 - 80], 26, `4 отвори Ø${fmt(lg.q.plate.holeDiameterMm)} мм${p.countersink ? " з зенківкою" : ""}, відступ від краю ${fmt(p.holeInsetMm)} мм (автоматично), між центрами ${fmt(hx * 2)} × ${fmt(hy * 2)} мм`));
    prims.push(text("TEXT", [-w / 2, -d / 2 - 45], 26, `Пластина «${lg.q.plate.name}», товщина ${fmt(lg.input.plateT * MM)} мм, кількість: ${lg.plates.length}`));
    return sheet("04-plate", "Пластина", prims);
  }

  // ---- 05 and 06 the table from the front and from the side
  function sheetElevation(o, lg, view) {
    const { TL, TE } = deps();
    const H = lg.q.height * MM;
    const y = (z) => H - z * MM;
    const across = view === "front" ? o.l : o.w;
    const half = (across / 2) * MM;
    const prims = [...header(o, `вигляд ${view === "front" ? "спереду" : "збоку"}, мм`)];
    const rt = Math.min(Math.max(Number(o.edgeTopMm) || 0, 0), o.t * MM),
      rb = Math.min(Math.max(Number(o.edgeBottomMm) || 0, 0), o.t * MM - rt);
    prims.push({ kind: "path", layer: "TOP_SECTION", d: TE.sectionPath(-half, half, 0, o.t * MM, rt, rb, o.edgeTopStyle, o.edgeBottomStyle), pts: [[-half, 0], [half, o.t * MM]] });
    for (const p of lg.plates) {
      const c = (view === "front" ? p.x : p.y) * MM, w = (view === "front" ? p.w : p.d) * MM;
      prims.push(poly("PLATES", [[c - w / 2, o.t * MM], [c + w / 2, o.t * MM], [c + w / 2, (o.t + lg.input.plateT) * MM], [c - w / 2, (o.t + lg.input.plateT) * MM]]));
    }
    for (const part of lg.base.parts) {
      const pts = TL.outline(part, view).map(([u, z]) => [u * MM, y(z)]);
      prims.push(poly(/[.]s[0-9]+$/.test(part.id) ? "LEG_SEAMS" : "LEGS", pts));
    }
    prims.push(line("TABLE_OUTLINE", [-half - 60, H], [half + 60, H]));
    prims.push(...dimV(0, H, half + 120, `${fmt(H)} мм`));
    prims.push(...dimV(0, o.t * MM, -half - 70, `${fmt(o.t * MM)} мм`));
    prims.push(...dimH(-half, half, H + 70, `${fmt(across * MM)} мм`));
    return sheet(view === "front" ? "05-front" : "06-side", view === "front" ? "Вигляд спереду" : "Вигляд збоку", prims);
  }

  // ---- 07 every different part of the legs, flat, with its length and quantity
  const partLength = (p) => Math.hypot(p.top[0] - p.bottom[0], p.top[1] - p.bottom[1], p.top[2] - p.bottom[2]);
  function partGroups(base) {
    const { TL } = deps();
    const groups = new Map();
    for (const p of base.parts) {
      const L = partLength(p);
      const key = [p.type, p.role, ...p.bs, ...p.ts, p.rr || 0, L.toFixed(2), p.svg || ""].map((v) => (typeof v === "number" ? Math.round(v * 100) / 100 : v)).join("|");
      const g = groups.get(key) || { part: p, length: L, qty: 0, ids: [] };
      g.qty += 1;
      g.ids.push(p.id);
      groups.set(key, g);
    }
    return [...groups.values()].map((g, i) => ({ ...g, name: "Д" + (i + 1), volume: TL.volume(g.part) }));
  }
  function sheetParts(o, lg) {
    const groups = partGroups(lg.base);
    const prims = [...header(o, "деталі ніжок, мм")];
    let x = 0, rowTop = 0, rowH = 0;
    for (const g of groups) {
      const p = g.part;
      const L = g.length * MM;
      const w0 = p.bs[0] * MM, w1 = p.ts[0] * MM; // across the face: at the foot and at the top
      const wide = Math.max(w0, w1);
      const boxW = Math.max(wide, 360);
      if (x + boxW > 2400 && x > 0) { x = 0; rowTop += rowH + 220; rowH = 0; }
      const cx = x + boxW / 2;
      // the part flat: a trapezoid, the top above
      const pts = [[cx - w1 / 2, rowTop + 60], [cx + w1 / 2, rowTop + 60], [cx + w0 / 2, rowTop + 60 + L], [cx - w0 / 2, rowTop + 60 + L]];
      prims.push(poly(p.rr ? "LEG_SEAMS" : "LEGS", pts));
      prims.push(text("TEXT", [cx, rowTop - 25], 26, `${g.name} × ${g.qty}`, "middle"));
      prims.push(...dimV(rowTop + 60, rowTop + 60 + L, cx - wide / 2 - 30, `${fmt(L)} мм`, 22));
      prims.push(...dimH(cx - w1 / 2, cx + w1 / 2, rowTop + 40, `${fmt(w1)}`, 20));
      prims.push(...dimH(cx - w0 / 2, cx + w0 / 2, rowTop + 60 + L + 45, `${fmt(w0)}`, 20));
      const thick = p.bs[1] * MM;
      const notes = [p.type === "round" ? `круглий Ø${fmt(p.bs[0] * MM)} → Ø${fmt(p.ts[0] * MM)} мм` : `товщина ${fmt(thick)} → ${fmt(p.ts[1] * MM)} мм`];
      if (p.rr) notes.push(`скруглення країв ${fmt(p.rr * MM)} мм`);
      notes.forEach((s, i) => prims.push(text("TEXT", [cx, rowTop + 60 + L + 100 + i * 26], 20, s, "middle")));
      rowH = Math.max(rowH, L + 180 + notes.length * 26);
      x += boxW + 120;
    }
    return sheet("07-leg-parts", "Деталі ніжок", prims);
  }

  function sheets(o) {
    const out = [sheetTop(o), sheetSection(o)];
    const lg = legsOf(o);
    if (lg && !lg.custom) {
      out.push(sheetLegsPlan(o, lg), sheetPlate(o, lg), sheetElevation(o, lg, "front"), sheetElevation(o, lg, "side"), sheetParts(o, lg));
    }
    return out;
  }

  // ------------------------------------------------------------------ SVG
  const attrs = (style, k = 1, floor = 0) => {
    if (!style) return "";
    const f = style.fill && style.fill !== "none" ? style.fill : "none";
    return ` fill="${f}" stroke="${style.stroke || "none"}" stroke-width="${style.width ? Math.max(style.width * k, floor) : 0}"${style.dash ? ` stroke-dasharray="${style.dash}"` : ""} stroke-linejoin="round"`;
  };
  // A path of M, L, A and Z commands (what sectionPath writes) with every length multiplied by k.
  const scalePath = (d, k) =>
    d.replace(/([MLAZ])([^MLAZ]*)/g, (_, c, rest) => {
      const v = rest.trim().split(/[ ,]+/).filter(Boolean).map(Number);
      if (c === "Z") return "Z";
      if (c === "A") return "A " + [v[0] * k, v[1] * k, v[2], v[3], v[4], v[5] * k, v[6] * k].map(n).join(" ");
      return c + " " + v.map((x) => n(x * k)).join(" ");
    });
  // The coordinates of every primitive multiplied by k: a reduced sheet is drawn small, not stretched by the viewer.
  const reduce = (p, k) =>
    p.kind === "poly" ? { ...p, pts: p.pts.map(([x, y]) => [x * k, y * k]) }
      : p.kind === "rings" ? { ...p, rings: p.rings.map((r) => r.map(([x, y]) => [x * k, y * k])) }
      : p.kind === "path" ? { ...p, d: scalePath(p.d, k), tx: (p.tx || 0) * k, ty: (p.ty || 0) * k }
      : p.kind === "circle" ? { ...p, c: [p.c[0] * k, p.c[1] * k], r: p.r * k }
      : { ...p, p: [p.p[0] * k, p.p[1] * k], h: Math.max(p.h * k, 2.4) }; // a figure never under 2.4 mm high on the paper
  // opts.scale (1/N): the sheet reduced to 1:N for paper; a line is never thinner than a fifth of a millimetre there.
  function svg(s, o, opts = {}) {
    const k = opts.scale > 0 && opts.scale < 1 ? opts.scale : 1;
    // opts.mmText: for a reader that takes the position and size of a text as CSS pixels whatever the scale of the drawing (DesignCraft)
    const px = opts.mmText ? 96 / 25.4 : 1;
    const byLayer = new Map();
    for (const p of s.prims.map((q) => (k === 1 ? q : reduce(q, k)))) {
      const list = byLayer.get(p.layer) || [];
      list.push(p);
      byLayer.set(p.layer, list);
    }
    const parts = [];
    for (const [layer, prims] of byLayer) {
      const st = LAYERS[layer] || {};
      const body = prims
        .map((p) => {
          if (p.kind === "poly") return `<${p.closed ? "polygon" : "polyline"} points="${p.pts.map(([x, y]) => n(x) + "," + n(y)).join(" ")}"${p.closed ? "" : ' fill="none"'}/>`;
          // in the picture the resin is the whole top and the slabs lie over it; a CAD file keeps every ring
          if (p.kind === "rings") return `<polygon points="${p.rings[0].map(([x, y]) => n(x) + "," + n(y)).join(" ")}"/>`;
          if (p.kind === "path") return `<path d="${p.d}" transform="translate(${n(p.tx || 0)} ${n(p.ty || 0)})"/>`;
          if (p.kind === "circle") return `<circle cx="${n(p.c[0])}" cy="${n(p.c[1])}" r="${n(p.r)}"/>`;
          return `<text x="${n(p.p[0] * px)}" y="${n(p.p[1] * px)}" font-size="${n(p.h * px)}" text-anchor="${p.anchor}">${esc(p.s)}</text>`;
        })
        .join("");
      const isText = layer === "TEXT";
      const style = isText ? ' fill="#111" stroke="none" font-family="DejaVu Sans, Arial, sans-serif"' : attrs(st, k, k === 1 ? 0 : 0.2);
      parts.push(`<g id="${layer}"${style}><title>${esc(st.note || layer)}</title>${body}</g>`);
    }
    const meta = `Стіл №${o.number}: ${s.title}. Одиниці: міліметри, масштаб 1:${n(1 / k)}.`;
    const body = parts.join("");
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(s.w * k)}mm" height="${n(s.h * k)}mm" viewBox="0 0 ${n(s.w * k)} ${n(s.h * k)}"><title>${esc(meta)}</title><desc>Fusion Lab · виробничий аркуш ${esc(s.id)}</desc>${body}</svg>\n`;
  }

  // ------------------------------------------------------------------ DXF (AutoCAD 2000, mm)
  function dxf(s) {
    const lines = [];
    const pair = (...xs) => lines.push(...xs.map(String));
    let handle = 0x100;
    const h = () => (handle++).toString(16).toUpperCase();
    const layers = ["0", ...new Set(s.prims.map((p) => p.layer))];
    pair(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1015", 9, "$INSUNITS", 70, 4, 9, "$MEASUREMENT", 70, 1, 9, "$EXTMIN", 10, 0, 20, 0, 30, 0, 9, "$EXTMAX", 10, n(s.w), 20, n(s.h), 30, 0, 0, "ENDSEC");
    pair(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LTYPE", 5, "2", 100, "AcDbSymbolTable", 70, 1, 0, "LTYPE", 5, "10", 330, "2", 100, "AcDbSymbolTableRecord", 100, "AcDbLinetypeTableRecord", 2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, 0, 0, "ENDTAB");
    pair(0, "TABLE", 2, "LAYER", 5, "3", 100, "AcDbSymbolTable", 70, layers.length);
    for (const name of layers)
      pair(0, "LAYER", 5, h(), 330, "3", 100, "AcDbSymbolTableRecord", 100, "AcDbLayerTableRecord", 2, name, 70, 0, 62, (LAYERS[name] || {}).color || 7, 6, "CONTINUOUS");
    pair(0, "ENDTAB", 0, "TABLE", 2, "BLOCK_RECORD", 5, "4", 100, "AcDbSymbolTable", 70, 2);
    for (const [name, hd] of [["*Model_Space", "1F"], ["*Paper_Space", "20"]]) pair(0, "BLOCK_RECORD", 5, hd, 330, "4", 100, "AcDbSymbolTableRecord", 100, "AcDbBlockTableRecord", 2, name);
    pair(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "BLOCKS");
    for (const [name, owner, a, b] of [["*Model_Space", "1F", "21", "22"], ["*Paper_Space", "20", "23", "24"]])
      pair(0, "BLOCK", 5, a, 330, owner, 100, "AcDbEntity", 8, "0", 100, "AcDbBlockBegin", 2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name, 1, "", 0, "ENDBLK", 5, b, 330, owner, 100, "AcDbEntity", 8, "0", 100, "AcDbBlockEnd");
    pair(0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
    const Y = (y) => n(s.h - y); // DXF y goes up
    const lw = (layer, pts, closed) => {
      pair(0, "LWPOLYLINE", 5, h(), 330, "1F", 100, "AcDbEntity", 8, layer, 100, "AcDbPolyline", 90, pts.length, 70, closed ? 1 : 0, 38, 0);
      for (const [x, y] of pts) pair(10, n(x), 20, Y(y));
    };
    for (const p of s.prims) {
      if (p.kind === "poly") lw(p.layer, p.pts, p.closed);
      else if (p.kind === "rings") p.rings.forEach((r) => lw(p.layer, r, true));
      else if (p.kind === "path") lw(p.layer, [p.pts[0], [p.pts[1][0], p.pts[0][1]], p.pts[1], [p.pts[0][0], p.pts[1][1]]], true);
      else if (p.kind === "circle") pair(0, "CIRCLE", 5, h(), 330, "1F", 100, "AcDbEntity", 8, p.layer, 100, "AcDbCircle", 10, n(p.c[0]), 20, Y(p.c[1]), 30, 0, 40, n(p.r));
      else {
        pair(0, "TEXT", 5, h(), 330, "1F", 100, "AcDbEntity", 8, p.layer, 100, "AcDbText", 10, n(p.p[0]), 20, Y(p.p[1]), 30, 0, 40, n(p.h), 1, p.s);
        if (p.anchor !== "start") pair(72, p.anchor === "middle" ? 1 : 2, 11, n(p.p[0]), 21, Y(p.p[1]), 31, 0);
        pair(100, "AcDbText");
      }
    }
    pair(0, "ENDSEC", 0, "EOF");
    return lines.join("\r\n") + "\r\n";
  }

  // ------------------------------------------------------------------ OBJ (mm, y up)
  // Triangles of a simple polygon (ear clipping), as index triples into `pts`.
  function triangulate(pts) {
    const area = pts.reduce((s, p, i) => s + (p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1]), 0);
    const idx = pts.map((_, i) => i);
    if (area < 0) idx.reverse();
    const tris = [];
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const inside = (p, a, b, c) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
    let guard = idx.length * idx.length;
    while (idx.length > 3 && guard-- > 0) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        if (cross(pts[a], pts[b], pts[c]) <= 1e-12) continue;
        if (idx.some((k) => k !== a && k !== b && k !== c && inside(pts[k], pts[a], pts[b], pts[c]))) continue;
        tris.push([a, b, c]);
        idx.splice(i, 1);
        cut = true;
        break;
      }
      if (!cut) break;
    }
    if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
    return tris;
  }
  function obj(o) {
    const { TL, TE } = deps();
    const out = ["# Fusion Lab · стіл №" + o.number, "# одиниці: міліметри, вісь Y угору, X уздовж довжини, Z уздовж ширини"];
    let vcount = 0;
    const emit = (name, verts, faces) => {
      out.push("g " + name);
      for (const v of verts) out.push(`v ${n(v[0])} ${n(v[1])} ${n(v[2])}`);
      for (const f of faces) out.push("f " + f.map((i) => i + 1 + vcount).join(" "));
      vcount += verts.length;
    };
    const lg = legsOf(o);
    const H = (lg && !lg.custom ? lg.q.height : (lg && lg.q.height) || o.t) * MM;
    // the top, from the same mesh the 3D view draws
    const top = { shape: o.shape, l: o.l, w: o.w, t: o.t, corner: cornerCm(o) };
    const rt = (Number(o.edgeTopMm) || 0) / 10, rb = (Number(o.edgeBottomMm) || 0) / 10;
    const g = TE.geometry(top, rt, rb, o.edgeTopStyle, o.edgeBottomStyle);
    const verts = [];
    for (let i = 0; i < g.positions.length; i += 3) verts.push([g.positions[i] * MM, g.positions[i + 1] * MM + H - o.t * MM, g.positions[i + 2] * MM]);
    const faces = [];
    const index = [...g.cap, ...g.wall];
    for (let i = 0; i < index.length; i += 3) faces.push([index[i], index[i + 1], index[i + 2]]);
    emit("TABLETOP", verts, faces);
    // slabs: prisms from the underside to the face of the top
    for (const p of placed(o)) {
      // counter-clockwise in the plan, so that the faces look outward
      const turn = p.ring.reduce((a, q, i) => a + (q[0] * p.ring[(i + 1) % p.ring.length][1] - p.ring[(i + 1) % p.ring.length][0] * q[1]), 0);
      const ring = turn < 0 ? p.ring.slice().reverse() : p.ring,
        y0 = H - o.t * MM,
        y1 = H;
      const v = [...ring.map(([x, z]) => [x, y0, z]), ...ring.map(([x, z]) => [x, y1, z])];
      const k = ring.length, f = [];
      for (const [a, b, c] of triangulate(ring)) { f.push([a, b, c], [k + a, k + c, k + b]); }
      for (let i = 0; i < k; i++) { const j = (i + 1) % k; f.push([i, k + j, j], [i, k + i, k + j]); }
      emit("SLAB_" + p.slab.number.replace(/[^A-Za-z0-9_-]/g, "_"), v, f);
    }
    if (lg && !lg.custom) {
      lg.base.parts.forEach((part) => {
        const vs = TL.vertices(part).map(([x, y, z]) => [x * MM, z * MM, y * MM]);
        const m = TL.ringSize(part), f = [];
        for (let k = 0; k < m; k++) { const k2 = (k + 1) % m; f.push([k, k2, m + k2], [k, m + k2, m + k]); }
        for (let k = 1; k < m - 1; k++) f.push([0, k + 1, k], [m, m + k, m + k + 1]);
        emit("LEG_" + part.id.replace(/[.]/g, "_"), vs, f);
      });
      lg.plates.forEach((p, i) => {
        const x0 = (p.x - p.w / 2) * MM, x1 = (p.x + p.w / 2) * MM, z0 = (p.y - p.d / 2) * MM, z1 = (p.y + p.d / 2) * MM;
        const y0 = lg.base.legLength * MM, y1 = y0 + lg.input.plateT * MM;
        const v = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
        emit("PLATE_" + (i + 1), v, [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]);
        // the four bolt holes as their own tubes through the plate
        p.holes.forEach((hole, j) => {
          const steps = 16, r = hole.diameterMm / 2, hv = [], hf = [];
          for (const y of [y0, y1]) for (let a = 0; a < steps; a++) hv.push([hole.x * MM + r * Math.cos((a / steps) * Math.PI * 2), y, hole.y * MM + r * Math.sin((a / steps) * Math.PI * 2)]);
          for (let a = 0; a < steps; a++) { const b = (a + 1) % steps; hf.push([a, b, steps + b], [a, steps + b, steps + a]); }
          emit(`PLATE_${i + 1}_HOLE_${j + 1}`, hv, hf);
        });
      });
    }
    return out.join("\n") + "\n";
  }

  // ------------------------------------------------------------------ the bill of materials
  function bom(o) {
    const lg = legsOf(o);
    const rows = [["Позиція", "Назва", "Кількість", "Розмір, мм", "Обʼєм, см3", "Примітка"]];
    const { Geo } = deps();
    const pcs = placed(o);
    rows.push(["Стільниця", `${o.shape}`, 1, `${n(o.l * MM)} × ${n(o.w * MM)} × ${n(o.t * MM)}`, "", cornerCm(o) ? `радіус кутів ${n(cornerCm(o) * MM)} мм` : ""]);
    pcs.forEach((p) => rows.push(["Слеб", `${p.slab.number} · ${p.slab.species}`, 1, `${n(p.slab.w * MM)} × ${n(p.slab.h * MM)} × ${n(p.slab.t * MM)}`, "", `положення ${n(p.piece.x * MM)}; ${n(p.piece.y * MM)} мм, кут ${n(p.piece.angle)}°`]));
    rows.push(["Епоксидна смола", `колір ${o.color}`, 1, "", "", o.quote ? `${n(o.quote.litres)} л · ${n(o.quote.kg)} кг` : ""]);
    if (lg && !lg.custom) {
      const { TL } = deps();
      for (const g of partGroups(lg.base)) rows.push(["Деталь ніжки", g.name, g.qty, `${n(g.part.bs[0] * MM)}→${n(g.part.ts[0] * MM)} × ${n(g.part.bs[1] * MM)}→${n(g.part.ts[1] * MM)} × ${n(g.length * MM)}`, n(g.volume * g.qty), g.part.rr ? `скруглення ${n(g.part.rr * MM)} мм` : ""]);
      rows.push(["Пластина", lg.q.plate.name, lg.plates.length, `${n(lg.plates[0].w * MM)} × ${n(lg.plates[0].d * MM)} × ${n(lg.input.plateT * MM)}`, n(lg.plates[0].volume * lg.plates.length), `4 отвори Ø${n(lg.q.plate.holeDiameterMm)} мм, відступ ${n(lg.plates[0].holeInsetMm)} мм`]);
      void TL;
    }
    void Geo;
    return rows.map((r) => r.map((c) => (/[;"\n,]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c)).join(";")).join("\r\n") + "\r\n";
  }

  // ------------------------------------------------------------------ the set of files
  /** All production files of an order: [{ name, type, data }]. */
  function files(o) {
    const sh = sheets(o);
    const out = [];
    for (const s of sh) out.push({ name: `svg/${o.number}-${s.id}.svg`, type: "image/svg+xml", data: svg(s, o) });
    for (const s of sh) out.push({ name: `dxf/${o.number}-${s.id}.dxf`, type: "application/dxf", data: dxf(s) });
    out.push({ name: `obj/${o.number}.obj`, type: "model/obj", data: obj(o) });
    out.push({ name: `${o.number}-bom.csv`, type: "text/csv", data: "﻿" + bom(o) });
    out.push({ name: `${o.number}-order.json`, type: "application/json", data: JSON.stringify(o, null, 2) });
    return out;
  }

  // ------------------------------------------------------------------ a zip (stored, no compression)
  let crcTable;
  const crc32 = (bytes) => {
    if (!crcTable) crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  function zip(list) {
    const enc = new TextEncoder();
    const chunks = [], central = [];
    let offset = 0;
    const u16 = (v) => [v & 255, (v >> 8) & 255], u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    for (const f of list) {
      const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
      chunks.push(Uint8Array.from(head), name, data);
      central.push(Uint8Array.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
      offset += head.length + name.length + data.length;
    }
    const size = central.reduce((s, c) => s + c.length, 0);
    const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(list.length), ...u16(list.length), ...u32(size), ...u32(offset), ...u16(0)]);
    const all = [...chunks, ...central, end];
    const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
    let p = 0;
    for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  root.TableProduction = { files, sheets, svg, dxf, obj, bom, zip, topRing, placed, legsOf, partGroups, triangulate, LAYERS };
  if (typeof module !== "undefined") module.exports = root.TableProduction;
})(typeof window !== "undefined" ? window : globalThis);

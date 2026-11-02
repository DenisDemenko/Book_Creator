/* The legs panel of the builder: a choice of ten wooden bases (and the legs the
 * workshop drew as SVG), the height and thickness of the legs, the wood, the
 * mounting plate, two drawings (front and side, with the top's thickness) and
 * a 3D view of the table with the chosen legs.
 *
 * It owns no design data: the choice lives in design.legSet (so it is saved
 * with the draft and sent with the quote) and every change goes back through
 * env.changed().
 */
(function (root) {
  "use strict";

  function create(env) {
    const { $, esc, num, money } = env;
    const TL = root.TableLegs;
    let viewer = null,
      drawTimer = 0,
      threeTimer = 0;

    const catalog = () => env.catalog();
    const design = () => env.design();
    const customMeta = (d) => ({
      id: d.id,
      name: d.name,
      note: "Малюнок майстерні",
      minHeight: d.minHeightCm,
      maxHeight: d.maxHeightCm,
      defaultHeight: Math.min(Math.max(75, d.minHeightCm), d.maxHeightCm),
      minThickness: d.minThicknessCm,
      maxThickness: d.maxThicknessCm,
      defaultThickness: d.defaultThicknessCm,
      custom: d,
    });
    const hiddenSchemes = () => catalog()?.settings?.hiddenSchemes || [];
    const allSchemes = () => [
      ...TL.SCHEMES.filter((s) => !hiddenSchemes().includes(s.id)),
      ...(catalog()?.designs || []).map(customMeta),
    ];
    // A layout switched off since the buyer picked it still resolves, so the
    // drawing does not break; the server refuses it at the quote.
    const metaOf = (id) =>
      allSchemes().find((s) => s.id === id) || TL.SCHEMES.find((s) => s.id === id);
    const materialOf = (set) =>
      catalog().settings.materials.find((m) => m.id === set.material) || catalog().settings.materials[0];
    const plateOf = (set) =>
      catalog().plates.find((p) => p.id === set.plate) ||
      catalog().plates.find((p) => p.isDefault) ||
      catalog().plates[0];

    // The height can never leave the legs shorter than 15 cm under the top.
    function clampSet(set) {
      const meta = metaOf(set.scheme);
      if (!meta) return false;
      const d = design();
      const floor = Math.max(meta.minHeight, d.t + catalog().settings.plateThicknessCm + 15);
      set.height = Math.round(Math.min(meta.maxHeight, Math.max(floor, set.height)) * 10) / 10;
      set.thickness = Math.round(Math.min(meta.maxThickness, Math.max(meta.minThickness, set.thickness)) * 10) / 10;
      if (set.legDims) {
        const ok = ["topW", "topD", "footW", "footD"].every((k) => Number.isFinite(set.legDims[k]));
        if (!ok || !TL.DIMS_SCHEMES.includes(set.scheme) || meta.custom) delete set.legDims;
        else for (const k of ["topW", "topD", "footW", "footD"]) set.legDims[k] = Math.round(Math.min(TL.LEG_MAX_CM, Math.max(TL.LEG_MIN_CM, set.legDims[k])) * 10) / 10;
      }
      if (set.columnDims) {
        const c = set.columnDims;
        if (!Number.isFinite(c.top) || !Number.isFinite(c.foot) || set.scheme !== "pedestal" || meta.custom) delete set.columnDims;
        else {
          const r = (v, hi) => Math.round(Math.min(hi, Math.max(TL.COLUMN_MIN_CM, v)) * 10) / 10;
          c.top = r(c.top, TL.columnTopMax(d));
          c.foot = r(c.foot, TL.COLUMN_MAX_CM);
        }
      }
      const inset = Number.isFinite(set.inset) ? set.inset : TL.DEFAULT_INSET_CM;
      set.inset = Math.round(Math.min(TL.MAX_INSET_CM, Math.max(0, inset)) * 10) / 10;
      return true;
    }
    function layoutOf(set) {
      const d = design();
      const meta = metaOf(set.scheme);
      const input = {
        shape: d.shape, l: d.l, w: d.w, t: d.t,
        scheme: set.scheme, height: set.height, thickness: set.thickness,
        corner: (Number(d.cornerMm) || 0) / 10,
        plateT: catalog().settings.plateThicknessCm,
        inset: set.inset,
        legDims: set.legDims,
        columnDims: set.columnDims,
        plateCm: Math.max(TL.plateSide(plateOf(set).widthCm), TL.plateSide(plateOf(set).depthCm)),
      };
      const base = TL.layout(input, meta?.custom);
      const plates = TL.plates(base.mounts, plateOf(set), input.plateT, base.legLength, { l: input.l, w: input.w });
      const priced = TL.cost(base, plates, materialOf(set), catalog().settings);
      return { input, base, plates, priced, meta };
    }

    /* ---------------------------------------------------------- drawings */
    const WOOD = "#b88a56";
    const svgUrl = (svg) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

    function arrowV(x, y0, y1, label, fs, left) {
      const a = fs * 0.5;
      const tx = left ? x - fs * 0.5 : x + fs * 1.3;
      return (
        `<g stroke="#2b1a10" stroke-width=".25" fill="none"><path d="M ${x} ${y0} V ${y1}"/>` +
        `<path d="M ${x - a * 0.4} ${y0 + a} L ${x} ${y0} L ${x + a * 0.4} ${y0 + a}"/>` +
        `<path d="M ${x - a * 0.4} ${y1 - a} L ${x} ${y1} L ${x + a * 0.4} ${y1 - a}"/></g>` +
        `<text x="${tx}" y="${(y0 + y1) / 2}" font-size="${fs}" fill="#2b1a10" font-family="Arial" ${left ? 'text-anchor="end"' : ""} dominant-baseline="middle">${esc(label)}</text>`
      );
    }
    function arrowH(y, x0, x1, label, fs) {
      const a = fs * 0.5;
      return (
        `<g stroke="#2b1a10" stroke-width=".25" fill="none"><path d="M ${x0} ${y} H ${x1}"/>` +
        `<path d="M ${x0 + a} ${y - a * 0.4} L ${x0} ${y} L ${x0 + a} ${y + a * 0.4}"/>` +
        `<path d="M ${x1 - a} ${y - a * 0.4} L ${x1} ${y} L ${x1 - a} ${y + a * 0.4}"/></g>` +
        `<text x="${(x0 + x1) / 2}" y="${y + fs * 1.15}" font-size="${fs}" fill="#2b1a10" font-family="Arial" text-anchor="middle">${esc(label)}</text>`
      );
    }

    // One drawing, "front" (along the length) or "side" (along the width).
    function drawing(set, view) {
      const d = design();
      const { input, base, plates, meta } = layoutOf(set);
      const H = set.height,
        t = d.t,
        pt = input.plateT;
      const half = view === "front" ? d.l / 2 : d.w / 2;
      // Text is sized against the wider of the height and the span, so it stays
      // legible on a 3.5 m table as well as on a small one.
      const fs = Math.max(2.4, H / 26, (half * 2) / 38);
      const y = (z) => H - z; // floor at the bottom
      const left = -half - fs * 9,
        right = half + fs * 9;
      let g = `<line x1="${left}" y1="${H}" x2="${right}" y2="${H}" stroke="#7f8a72" stroke-width=".5"/>`;
      // the top
      // (the section of the top shows its worked edges)
      const rt = Math.min((Number(d.edgeTopMm) || 0) / 10, t),
        rb = Math.min((Number(d.edgeBottomMm) || 0) / 10, t - rt);
      g += `<path d="${root.TableEdges.sectionPath(-half, half, y(H), y(H) + t, rt, rb, d.edgeTopStyle, d.edgeBottomStyle)}" fill="${esc(d.color)}" stroke="#2b1a10" stroke-width=".4" stroke-linejoin="round"/>`;
      const hatch = view === "front" ? "" : "";
      g += hatch;
      // plates
      for (const p of plates) {
        const c = view === "front" ? p.x : p.y,
          w = view === "front" ? p.w : p.d;
        g += `<rect x="${c - w / 2}" y="${y(H - t)}" width="${w}" height="${pt}" fill="#d6b98a" stroke="#6b5238" stroke-width=".3"/>`;
      }
      // legs
      const svgImage = meta?.custom ? svgUrl(meta.custom.svg) : "";
      for (const part of base.parts) {
        if (part.svg === view && svgImage) {
          const xs = TL.outline(part, view).map((v) => v[0]);
          const x0 = Math.min(...xs),
            x1 = Math.max(...xs);
          g += `<image href="${svgImage}" x="${x0}" y="${y(part.top[2])}" width="${x1 - x0}" height="${Math.abs(part.top[2] - part.bottom[2])}" preserveAspectRatio="none"/>`;
          continue;
        }
        const poly = TL.outline(part, view)
          .map(([u, z]) => `${u.toFixed(2)},${y(z).toFixed(2)}`)
          .join(" ");
        g += `<polygon points="${poly}" fill="${esc(materialOf(set).color || WOOD)}" stroke="#4a3320" stroke-width=".35" stroke-linejoin="round"/>`;
      }
      // dimensions: height, the top's thickness, the leg thickness, the plate
      g += arrowV(right - fs * 6, y(H), y(0), `${num(H, 1)} см`, fs, false);
      g += arrowV(left + fs * 6.5, y(H), y(H) + t, `стільниця ${num(t, 1)} см`, fs, true);
      g += arrowV(left + fs * 6.5, y(H) + t, y(H) + t + pt, `пластина ${num(pt, 1)} см`, fs * 0.85, true);
      const foot = base.parts.find((p) => p.role !== "rail" && p.bottom[2] < 0.01) || base.parts[0];
      const outline = TL.outline(foot, view);
      const fx0 = Math.min(...outline.map((v) => v[0])),
        fx1 = Math.max(...outline.map((v) => v[0]));
      g += arrowH(H + fs * 1.6, fx0, fx1, `${num(fx1 - fx0, 1)} см`, fs);
      const pad = fs * 4;
      return `<svg viewBox="${left - fs * 1} ${-fs * 2} ${right - left + fs * 2} ${H + fs * 7}" role="img" aria-label="${view === "front" ? "Вигляд спереду" : "Вигляд збоку"}" preserveAspectRatio="xMidYMid meet">${g}</svg>`;
    }

    function miniCard(meta) {
      if (meta.custom)
        return `<img alt="" src="${svgUrl(meta.custom.svg)}" />`;
      const input = {
        shape: "square", l: 120, w: 70, t: 4, scheme: meta.id,
        height: 75, thickness: meta.defaultThickness, plateT: 2,
      };
      const base = TL.layout(input);
      let g = `<rect x="-62" y="0" width="124" height="4" fill="#8aa7a8"/>`;
      for (const part of base.parts) {
        const poly = TL.outline(part, "front").map(([u, z]) => `${u.toFixed(1)},${(75 - z).toFixed(1)}`).join(" ");
        g += `<polygon points="${poly}" fill="${WOOD}" stroke="#4a3320" stroke-width="1"/>`;
      }
      return `<svg viewBox="-70 -6 140 92" aria-hidden="true">${g}</svg>`;
    }

    function plateSvg(plate) {
      const w = plate.w,
        dd = plate.d;
      const fs = Math.max(1.6, Math.min(w, dd) / 12);
      let g = `<rect x="${-w / 2}" y="${-dd / 2}" width="${w}" height="${dd}" fill="#d6b98a" stroke="#6b5238" stroke-width=".3"/>`;
      for (const h of plate.holes) {
        const hx = h.x - plate.x,
          hy = h.y - plate.y;
        g += `<circle cx="${hx}" cy="${hy}" r="${h.diameterMm / 20}" fill="#fff" stroke="#6b5238" stroke-width=".25"/>`;
      }
      const h0 = plate.holes[0];
      g += arrowH(dd / 2 + fs * 2, -w / 2, w / 2, `${num(w, 1)} см`, fs);
      g += `<text x="0" y="${-dd / 2 - fs * 0.8}" font-size="${fs}" text-anchor="middle" font-family="Arial" fill="#2b1a10">${num(dd, 1)} × ${num(w, 1)} см · 4 отвори Ø${num(h0.diameterMm, 1)} мм</text>`;
      return `<svg viewBox="${-w / 2 - fs * 3} ${-dd / 2 - fs * 3} ${w + fs * 6} ${dd + fs * 8}" aria-label="Пластина кріплення і її отвори">${g}</svg>`;
    }

    /* ------------------------------------------------------------- render */
    function renderCards(set) {
      $("legSchemes").innerHTML = allSchemes()
        .map(
          (m) =>
            `<button type="button" class="leg-scheme" role="radio" aria-checked="${set?.scheme === m.id}" data-leg-scheme="${esc(m.id)}" title="${esc(m.note)}"><span class="leg-mini">${miniCard(m)}</span><b>${esc(m.name)}</b></button>`,
        )
        .join("");
      $$all("[data-leg-scheme]").forEach(
        (b) =>
          (b.onclick = () => choose(b.dataset.legScheme)),
      );
    }
    const $$all = (s) => [...document.querySelectorAll(s)];

    function render() {
      const c = catalog();
      const panel = $("studioLegs");
      panel.hidden = !c || !c.available;
      if (panel.hidden) return;
      const d = design();
      const set = d.legSet;
      const ready = c.available;
      env.paint?.();
      $("legsNotReady").hidden = !c.demo;
      renderCards(ready ? set : undefined);
      $$all("[data-leg-scheme]").forEach((b) => (b.disabled = !ready));
      for (const id of ["legControls", "legDrawings", "leg3dWrap", "legSummary"]) $(id).hidden = !set || !ready;
      $("legPrompt").hidden = !!set || !ready;
      $("legClear").hidden = !set;
      if (!set || !ready) return;
      if (!clampSet(set)) {
        delete d.legSet;
        env.changed();
        return render();
      }
      const meta = metaOf(set.scheme);
      const floor = Math.max(meta.minHeight, d.t + c.settings.plateThicknessCm + 15);
      for (const [id, v, lo, hi] of [
        ["legHeight", set.height, floor, meta.maxHeight],
        ["legThickness", set.thickness, meta.minThickness, meta.maxThickness],
        ["legInset", set.inset, 0, TL.MAX_INSET_CM],
      ]) {
        for (const suffix of ["", "Range"]) {
          const el = $(id + suffix);
          el.min = lo;
          el.max = hi;
          if (document.activeElement !== el) el.value = v;
        }
      }
      $("legHeightHint").textContent = `${num(floor)}–${num(meta.maxHeight)} см`;
      $("legThicknessHint").textContent = `${num(meta.minThickness)}–${num(meta.maxThickness)} см`;
      // Both ends of the leg by hand (a trapezoid), for the layouts where one leg is copied.
      const dimsApply = !meta.custom && TL.DIMS_SCHEMES.includes(set.scheme);
      const manual = dimsApply && !!set.legDims;
      $("legDimsBox").hidden = !dimsApply;
      $("legDimsOn").checked = manual;
      $("legDimsFields").hidden = !manual;
      // The central column: its two circles by hand (a trapezoid in the drawing).
      const colApply = !meta.custom && set.scheme === "pedestal";
      const colManual = colApply && !!set.columnDims;
      $("colDimsBox").hidden = !colApply;
      $("colDimsOn").checked = colManual;
      $("colDimsFields").hidden = !colManual;
      if (colManual) {
        const topMax = TL.columnTopMax(design());
        $("colTop").max = Math.round(topMax * 10);
        $("colDimsHint").textContent = `Діаметри кіл у міліметрах: нижнє 100–1000, верхнє 100–${num(topMax * 10)} (пластина 4 см має вміститись у стільницю). Верхнє коло — під стільницею, нижнє — на підлозі.`;
        if (document.activeElement !== $("colTop")) $("colTop").value = Math.round(set.columnDims.top * 10);
        if (document.activeElement !== $("colFoot")) $("colFoot").value = Math.round(set.columnDims.foot * 10);
      }
      $("legThicknessField").hidden = manual || colManual;
      if (manual)
        for (const [id, key] of [["legTopW", "topW"], ["legTopD", "topD"], ["legFootW", "footW"], ["legFootD", "footD"]])
          if (document.activeElement !== $(id)) $(id).value = Math.round(set.legDims[key] * 10);
      $("legInsetHint").textContent = `0–${num(TL.MAX_INSET_CM)} см`;
      $("legMaterial").innerHTML = c.settings.materials
        .map((m) => `<option value="${esc(m.id)}" ${m.id === set.material ? "selected" : ""}>${esc(m.name)}</option>`)
        .join("");
      $("legPlate").innerHTML = c.plates
        .map((p) => `<option value="${esc(p.id)}" ${p.id === plateOf(set).id ? "selected" : ""}>${esc(p.name)} · ${num(p.widthCm)}×${num(p.depthCm)} см</option>`)
        .join("");
      $("legPlateField").hidden = c.plates.length < 2;
      draw();
    }

    // What the 2D sketch of the tabletop draws under it: legs and plates in plan (null when there are none).
    function footprint() {
      const c = catalog(),
        set = design().legSet;
      if (!c?.available || !set || !metaOf(set.scheme)) return null;
      const { base, plates } = layoutOf(set);
      return { ...TL.footprint(base, plates), color: materialOf(set).color || "#b88a56" };
    }

    function draw() {
      const c = catalog(),
        set = design().legSet;
      if (!c?.available || !set) return;
      const { input, base, plates, priced } = layoutOf(set);
      $("legFront").innerHTML = drawing(set, "front");
      $("legSide").innerHTML = drawing(set, "side");
      const plate = plateOf(set);
      $("legSummary").innerHTML =
        `<b>${esc(metaOf(set.scheme).name)}</b> · довжина ніжки ${num(base.legLength, 1)} см (стіл ${num(set.height, 1)} см = ніжка + пластина ${num(input.plateT, 1)} см + стільниця ${num(design().t, 1)} см) · ${esc(materialOf(set).name)}` +
        (set.columnDims ? `<br>Колона: верхнє коло Ø${num(set.columnDims.top * 10)} мм → нижнє Ø${num(set.columnDims.foot * 10)} мм` : "") +
        (set.legDims ? `<br>Ніжка: верх ${num(set.legDims.topW * 10)} × ${num(set.legDims.topD * 10)} мм → низ ${num(set.legDims.footW * 10)} × ${num(set.legDims.footD * 10)} мм` : "") +
        `<br>Кріплення: ${plates.length} × пластина «${esc(plate.name)}» ${num(plates[0].w, 1)} × ${num(plates[0].d, 1)} × ${num(input.plateT, 1)} см, по 4 отвори Ø${num(plate.holeDiameterMm, 1)} мм (відступ ${num(plate.holeInsetMm / 10, 1)} см від краю). Пластини стоять на ${num(set.inset, 1)} см від краю стільниці` +
        `<br>Орієнтовна вартість ніжок: <b>${money(priced.total)}</b> (дерево ${money(priced.wood)} · пластини ${money(priced.plate)} · робота ${money(priced.work)}). Остаточна — після розрахунку.`;
      $("legPlateDetail").innerHTML = plateSvg(plates[0]);
      schedule3d();
      env.paint?.();
    }

    function schedule3d() {
      clearTimeout(threeTimer);
      threeTimer = setTimeout(update3d, 450);
    }
    async function update3d() {
      const d = design(),
        set = d.legSet;
      if (!set || !catalog()?.available || $("leg3dWrap").hidden) return;
      const Table3D = root.Table3D;
      if (!Table3D) {
        root.addEventListener("table3d-ready", schedule3d, { once: true });
        return;
      }
      if (!viewer) viewer = Table3D.create($("leg3d"));
      if (!viewer) {
        $("leg3dFallback").hidden = false;
        return;
      }
      const { base, plates, input, meta } = layoutOf(set);
      await viewer.update({
        height: set.height,
        top: { shape: d.shape, l: d.l, w: d.w, t: d.t, color: d.color, texture: env.topTexture(), transparent: (Number(d.resinTransparency) || 0) > 0,
          corner: (Number(d.cornerMm) || 0) / 10,
          edgeTop: (Number(d.edgeTopMm) || 0) / 10, edgeBottom: (Number(d.edgeBottomMm) || 0) / 10,
          edgeTopStyle: d.edgeTopStyle, edgeBottomStyle: d.edgeBottomStyle },
        legs: {
          parts: base.parts,
          plates,
          plateT: input.plateT,
          legLength: base.legLength,
          color: materialOf(set).color,
          svgImage: meta?.custom ? svgUrl(meta.custom.svg) : null,
        },
      });
    }

    /* ------------------------------------------------------------ changes */
    function choose(id) {
      const d = design();
      const meta = metaOf(id);
      if (!meta || !catalog().available) return;
      const prev = d.legSet;
      d.legSet = {
        scheme: id,
        height: prev?.height ?? meta.defaultHeight,
        thickness: meta.defaultThickness,
        inset: prev?.inset ?? TL.DEFAULT_INSET_CM,
        ...(prev?.legDims && TL.DIMS_SCHEMES.includes(id) ? { legDims: { ...prev.legDims } } : {}),
        ...(prev?.columnDims && id === "pedestal" ? { columnDims: { ...prev.columnDims } } : {}),
        material: prev?.material || catalog().settings.materials[0].id,
        ...(prev?.plate ? { plate: prev.plate } : {}),
      };
      d.legs = "wood";
      env.syncLegsSelect("wood");
      env.changed();
      render();
    }
    function clear() {
      const d = design();
      delete d.legSet;
      d.legs = "metal";
      env.syncLegsSelect("metal");
      env.changed();
      render();
    }
    function bindInputs() {
      const set = () => design().legSet;
      const num2 = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
      for (const [id, key] of [["legHeight", "height"], ["legThickness", "thickness"], ["legInset", "inset"]]) {
        for (const suffix of ["", "Range"])
          $(id + suffix).oninput = (e) => {
            const s = set();
            const v = num2(e.target.value);
            if (!s || !Number.isFinite(v)) return;
            s[key] = v;
            clampSet(s);
            // keep what is being typed; the clamp shows when the field loses focus
            for (const sfx of ["", "Range"]) if ($(id + sfx) !== e.target) $(id + sfx).value = s[key];
            env.changed();
            clearTimeout(drawTimer);
            drawTimer = setTimeout(draw, 80);
          };
        $(id).onchange = () => render();
      }
      $("colDimsOn").onchange = (e) => {
        const s = set();
        if (!s) return;
        const d = design();
        if (e.target.checked) s.columnDims = TL.defaultColumn(s.thickness, d.l, d.w);
        else delete s.columnDims;
        env.changed();
        render();
      };
      for (const [id, key] of [["colTop", "top"], ["colFoot", "foot"]]) {
        $(id).oninput = (e) => {
          const s = set();
          const v = num2(e.target.value) / 10;
          if (!s || !s.columnDims || !Number.isFinite(v)) return;
          s.columnDims[key] = Math.min(key === "top" ? TL.columnTopMax(design()) : TL.COLUMN_MAX_CM, Math.max(TL.COLUMN_MIN_CM, v));
          env.changed();
          clearTimeout(drawTimer);
          drawTimer = setTimeout(draw, 80);
        };
        $(id).onchange = () => render();
      }
      // Quick shapes from the biggest circle typed: a cylinder, narrowing to the floor, widening.
      $$all("[data-col-shape]").forEach(
        (b) =>
          (b.onclick = () => {
            const s = set();
            if (!s || !s.columnDims) return;
            const big = Math.min(Math.max(s.columnDims.top, s.columnDims.foot), TL.columnTopMax(design()));
            const small = Math.max(TL.COLUMN_MIN_CM, Math.round((big / 2) * 10) / 10);
            const [top, foot] = { straight: [big, big], down: [big, small], up: [small, big] }[b.dataset.colShape];
            s.columnDims = { top, foot };
            env.changed();
            render();
          }),
      );
      $("legDimsOn").onchange = (e) => {
        const s = set();
        if (!s) return;
        if (e.target.checked) s.legDims = TL.defaultDims(s.scheme, s.thickness);
        else delete s.legDims;
        env.changed();
        render();
      };
      for (const [id, key] of [["legTopW", "topW"], ["legTopD", "topD"], ["legFootW", "footW"], ["legFootD", "footD"]]) {
        $(id).oninput = (e) => {
          const s = set();
          const v = num2(e.target.value) / 10;
          if (!s || !s.legDims || !Number.isFinite(v)) return;
          s.legDims[key] = Math.min(TL.LEG_MAX_CM, Math.max(TL.LEG_MIN_CM, v));
          env.changed();
          clearTimeout(drawTimer);
          drawTimer = setTimeout(draw, 80);
        };
        $(id).onchange = () => render();
      }
      // Quick shapes, made from the biggest end the buyer has typed: straight, narrowing to the floor, widening.
      $$all("[data-leg-shape]").forEach(
        (b) =>
          (b.onclick = () => {
            const s = set();
            if (!s || !s.legDims) return;
            const big = Math.max(s.legDims.topW, s.legDims.topD, s.legDims.footW, s.legDims.footD);
            const small = Math.max(TL.LEG_MIN_CM, Math.round((big / 2) * 10) / 10);
            const [top, foot] = { straight: [big, big], down: [big, small], up: [small, big] }[b.dataset.legShape];
            s.legDims = { topW: top, topD: top, footW: foot, footD: foot };
            env.changed();
            render();
          }),
      );
      $("legMaterial").onchange = (e) => {
        const s = set();
        if (!s) return;
        s.material = e.target.value;
        env.changed();
        draw();
      };
      $("legPlate").onchange = (e) => {
        const s = set();
        if (!s) return;
        s.plate = e.target.value;
        env.changed();
        draw();
      };
      $("legClear").onclick = clear;
    }
    bindInputs();

    return {
      render,
      footprint,
      mini: miniCard,
      // The table changed shape, size or composition: redraw soon, not per pixel.
      schedule() {
        if (!design().legSet || !catalog()?.available) return;
        clearTimeout(drawTimer);
        drawTimer = setTimeout(() => {
          const s = design().legSet;
          if (s) {
            clampSet(s);
            draw();
          }
        }, 120);
      },
      drop() {
        const d = design();
        delete d.legSet;
        render();
      },
    };
  }

  root.LegsUi = { create };
})(typeof window !== "undefined" ? window : globalThis);

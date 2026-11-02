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
      return true;
    }
    function layoutOf(set) {
      const d = design();
      const meta = metaOf(set.scheme);
      const input = {
        shape: d.shape, l: d.l, w: d.w, t: d.t,
        scheme: set.scheme, height: set.height, thickness: set.thickness,
        plateT: catalog().settings.plateThicknessCm,
      };
      const base = TL.layout(input, meta?.custom);
      const plates = TL.plates(base.mounts, plateOf(set), input.plateT, base.legLength);
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
      g += `<rect x="${-half}" y="${y(H)}" width="${half * 2}" height="${t}" fill="${esc(d.color)}" stroke="#2b1a10" stroke-width=".4"/>`;
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
      $("legMaterial").innerHTML = c.settings.materials
        .map((m) => `<option value="${esc(m.id)}" ${m.id === set.material ? "selected" : ""}>${esc(m.name)}</option>`)
        .join("");
      $("legPlate").innerHTML = c.plates
        .map((p) => `<option value="${esc(p.id)}" ${p.id === plateOf(set).id ? "selected" : ""}>${esc(p.name)} · ${num(p.widthCm)}×${num(p.depthCm)} см</option>`)
        .join("");
      $("legPlateField").hidden = c.plates.length < 2;
      draw();
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
        `<br>Кріплення: ${plates.length} × пластина «${esc(plate.name)}» ${num(plates[0].w, 1)} × ${num(plates[0].d, 1)} × ${num(input.plateT, 1)} см, по 4 отвори Ø${num(plate.holeDiameterMm, 1)} мм (відступ ${num(plate.holeInsetMm / 10, 1)} см від краю)` +
        `<br>Орієнтовна вартість ніжок: <b>${money(priced.total)}</b> (дерево ${money(priced.wood)} · пластини ${money(priced.plate)} · робота ${money(priced.work)}). Остаточна — після розрахунку.`;
      $("legPlateDetail").innerHTML = plateSvg(plates[0]);
      schedule3d();
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
        top: { shape: d.shape, l: d.l, w: d.w, t: d.t, color: d.color, texture: env.topTexture() },
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
      for (const [id, key] of [["legHeight", "height"], ["legThickness", "thickness"]]) {
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

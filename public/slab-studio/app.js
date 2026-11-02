"use strict";
(async () => {
  const bridge = window.SlabBridge;
  const mode = new URLSearchParams(location.search).get("mode");
  const admin = mode === "admin";
  const inventory = admin || mode === "inventory";
  const $ = (id) => document.getElementById(id),
    $$ = (s) => [...document.querySelectorAll(s)],
    esc = (s) =>
      String(s).replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      ),
    uid = () => crypto.randomUUID(),
    money = (n) =>
      new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 2 }).format(n) +
      " грн",
    num = (n, d = 1) =>
      new Intl.NumberFormat("uk-UA", { maximumFractionDigits: d }).format(n),
    clone = (x) => JSON.parse(JSON.stringify(x));
  let remote = await bridge.request("GET", "/tables/state");
  $("resinTextureControls").hidden = !remote.capabilities?.resinTextures;
  if (remote.theme) {
    for (const [key, value] of Object.entries(remote.theme.tokens || {}))
      document.documentElement.style.setProperty(key, value);
    const fonts = document.createElement("style");
    fonts.textContent = remote.theme.fonts || "";
    document.head.append(fonts);
  }

  let db = {
    slabs: remote.slabs,
    costs: remote.costs,
    resinTextures: remote.resinTextures || [],
    cart: [],
    orders: [],
  };
  async function reloadRemote() {
    remote = await bridge.request("GET", "/tables/state");
    db.slabs = remote.slabs;
    db.costs = remote.costs;
    db.resinTextures = remote.resinTextures || [];
    if (admin)
      db.orders = await bridge.request("GET", "/tables/admin/production");
  }
  let design = {
      shape: "oval",
      l: 180,
      w: 90,
      t: 4,
      color: "#24474b",
      legs: "metal",
      pieces: [],
    },
    selected = null,
    estimate = null,
    quotePending = false,
    cartPending = false,
    texturePending = false,
    designRevision = 0,
    toastTimer,
    legsUi,
    legsAdmin;
  const draftKey = "fusionlab:table-builder:draft:v1";
  if (!inventory) {
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) || "null");
      const d = draft?.design;
      const between = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
      if (d && Date.now() - draft.savedAt < 86400000 &&
          ["square", "round", "oval"].includes(d.shape) &&
          between(d.l, 40, 350) && between(d.w, 40, 180) && between(d.t, 1, 15) &&
          (d.shape === "oval" || d.l === d.w) && /^#[0-9a-f]{6}$/i.test(d.color) &&
          ["metal", "wood", "none"].includes(d.legs) && Array.isArray(d.pieces) &&
          d.pieces.length <= 6 && d.pieces.every(p =>
            typeof p.uid === "string" && available(p.id) &&
            between(p.x, -1000, 1000) && between(p.y, -1000, 1000) && between(p.angle, -360, 360)) &&
          (d.legSet === undefined || (d.legSet && typeof d.legSet.scheme === "string" &&
            between(d.legSet.height, 20, 150) && between(d.legSet.thickness, 1, 30) &&
            typeof d.legSet.material === "string")) &&
          (d.resinTransparency === undefined || between(d.resinTransparency, 0, 100)) &&
          (!d.resinTexture || (typeof d.resinTexture.name === "string" &&
            d.resinTexture.name.length <= 120 && typeof d.resinTexture.image === "string" &&
            d.resinTexture.image.length <= 400000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d.resinTexture.image)))) {
        design = d;
      } else sessionStorage.removeItem(draftKey);
    } catch { /* Storage may be unavailable in private browsing. */ }
  }
  function saveDraft() {
    if (inventory) return;
    try { sessionStorage.setItem(draftKey, JSON.stringify({ design, savedAt: Date.now() })); }
    catch { /* The current composition remains usable when storage is full. */ }
  }
  function toast(s) {
    $("toast").textContent = s;
    $("toast").classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4500);
  }
  function available(id) {
    return db.slabs.find((s) => s.id === id)?.available === true;
  }
  const names = {
    builder: ["Магазин", "Конструктор столу"],
    inventory: ["Майстерня", "Бібліотека слебів"],
    legcatalog: ["Майстерня", "Ніжки та кріплення"],
    textures: ["Майстерня", "Текстури смоли"],
    costs: ["Майстерня", "Калькулятор витрат"],
    cart: ["Магазин", "Кошик"],
    orders: ["Майстерня", "Виробництво"],
  };
  function view(name) {
    if (
      new URLSearchParams(location.search).get("host") === "studio" &&
      ["builder", "cart"].includes(name)
    )
      name = "inventory";
    if (
      !names[name] ||
      (!inventory && ["inventory", "legcatalog"].includes(name)) ||
      (!admin && ["costs", "orders", "textures"].includes(name))
    )
      name = inventory ? "inventory" : "builder";
    if (name === "cart") {
      bridge.navigate("/cart");
      return;
    }
    $$(".view").forEach((v) => (v.hidden = v.id !== name));
    $$("[data-view]").forEach((b) =>
      b.classList.toggle("active", b.dataset.view === name),
    );
    $("crumb").textContent = names[name][0];
    $("pageName").textContent = names[name][1];
    location.hash = name;
    if (name === "inventory") renderInventory();
    if (name === "costs") renderCosts();
    if (name === "textures") renderPresetAdmin();
    if (name === "legcatalog") legsAdmin.render();
    if (name === "orders") void refreshOrders();
    window.scrollTo(0, 0);
  }
  $$("[data-view]").forEach((b) => (b.onclick = () => view(b.dataset.view)));
  window.addEventListener("hashchange", () => view(location.hash.slice(1)));
  function woodDefs(s, key) {
    let tones = [
      ["#aa7847", "#5b371e", "#c1935c"],
      ["#bc945a", "#79512e", "#d7b87b"],
      ["#cfac76", "#8c6338", "#e2c998"],
    ][s.tone || 0];
    let paths = "";
    for (let i = 0; i < 15; i++) {
      let x = -60 + i * 12;
      paths += `<path d="M ${x} -130 C ${x + 35} -60 ${x - 22} -25 ${x + 8} 20 S ${x + 35} 85 ${x + 10} 150" fill="none" stroke="${i % 3 ? tones[1] : tones[2]}" stroke-width="${i % 4 ? 0.45 : 1.4}" opacity="${i % 3 ? 0.45 : 0.7}"/>`;
    }
    return `<pattern id="${key}" width="100" height="280" patternUnits="userSpaceOnUse" viewBox="-50 -140 100 280"><rect x="-50" y="-140" width="100" height="280" fill="${tones[0]}"/>${paths}<ellipse cx="5" cy="15" rx="8" ry="26" fill="none" stroke="${tones[1]}" opacity=".6"/><ellipse cx="5" cy="15" rx="3" ry="12" fill="${tones[1]}" opacity=".5"/></pattern>`;
  }
  function polygon(s) {
    return s.points
      .map(([x, y]) => `${(x - 0.5) * s.w},${(y - 0.5) * s.h}`)
      .join(" ");
  }
  function slabSvg(s, key) {
    return `<svg viewBox="${-s.w / 2 - 3} ${-s.h / 2 - 3} ${s.w + 6} ${s.h + 6}" aria-label="${esc(s.number)}"><defs>${woodDefs(s, key)}<clipPath id="clip-${key}"><polygon points="${polygon(s)}"/></clipPath></defs><g clip-path="url(#clip-${key})"><polygon points="${polygon(s)}" fill="url(#${key})"/>${s.photo ? `<image href="${s.photo}" x="${-s.w / 2}" y="${-s.h / 2}" width="${s.w}" height="${s.h}" preserveAspectRatio="none"/>` : ""}</g></svg>`;
  }
  function tableShape(d, extra = "") {
    return d.shape === "square"
      ? `<rect x="${-d.l / 2}" y="${-d.w / 2}" width="${d.l}" height="${d.w}" ${extra}/>`
      : `<ellipse rx="${d.l / 2}" ry="${d.w / 2}" ${extra}/>`;
  }
  function composition(d, slabs, key, interactive = false) {
    let defs = "",
      pieces = "";
    for (const [i, p] of d.pieces.entries()) {
      let s = slabs.find((s) => s.id === p.id);
      if (!s) continue;
      let k = key + "-" + i;
      defs +=
        woodDefs(s, k) +
        `<clipPath id="c-${k}"><polygon points="${polygon(s)}"/></clipPath>`;
      pieces += `<g ${interactive ? `class="piece ${selected === p.uid ? "selected" : ""}" data-piece="${p.uid}"` : ""} transform="translate(${p.x} ${p.y}) rotate(${p.angle})"><g clip-path="url(#c-${k})"><polygon points="${polygon(s)}" fill="url(#${k})"/>${s.photo ? `<image href="${s.photo}" x="${-s.w / 2}" y="${-s.h / 2}" width="${s.w}" height="${s.h}" preserveAspectRatio="none"/>` : ""}</g><polygon points="${polygon(s)}" fill="transparent" stroke="#382c1c" stroke-width=".25"/></g>`;
    }
    // Clear resin: how much of the resin colour is let through (0 = none, 100 = all); the slabs stay opaque.
    const clear = Math.min(100, Math.max(0, Math.round(Number(d.resinTransparency) || 0)));
    const glass = clear
      ? `<linearGradient id="glass-${key}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".5"/><stop offset=".45" stop-color="#cfe6ee" stop-opacity=".12"/><stop offset="1" stop-color="#ffffff" stop-opacity=".34"/></linearGradient>`
      : "";
    const base = tableShape(d, `fill="${d.color}"${clear ? ` fill-opacity="${(1 - clear / 100).toFixed(2)}"` : ""} filter="url(#shadow-${key})"`);
    const sheen = clear ? tableShape(d, `fill="url(#glass-${key})" pointer-events="none"`) : "";
    const edge = clear ? 'fill="none" stroke="#8fb6c2" stroke-width=".6" pointer-events="none"' : 'fill="none" stroke="#ffffff88" stroke-width=".5" pointer-events="none"';
    return `<defs><clipPath id="table-${key}">${tableShape(d)}</clipPath>${defs}${glass}<filter id="shadow-${key}" x="-50%" y="-60%" width="200%" height="240%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#33402c" flood-opacity=".18"/></filter></defs>${base}<g clip-path="url(#table-${key})">${ResinTexture.layer(d)}${sheen}${pieces}</g>${tableShape(d, edge)}`;
  }
  function renderDesign() {
    const svg = $("design"),
      vw = Math.max(design.l + 65, 150),
      vh = Math.max(design.w + 70, (vw * 200) / 260);
    svg.setAttribute("viewBox", `${-vw / 2} ${-vh / 2} ${vw} ${vh}`);
    svg.innerHTML =
      composition(design, db.slabs, "live", true) +
      `<g stroke="#929e83" stroke-width=".3" fill="none"><path d="M ${-design.l / 2} ${design.w / 2 + 12} v 5 m 0 -2.5 h ${design.l} m 0 -2.5 v 5"/><path d="M ${-design.l / 2 - 12} ${-design.w / 2} h -5 m 2.5 0 v ${design.w} m -2.5 0 h 5"/></g><g fill="#79896c" font-family="Arial" font-size="4" text-anchor="middle"><text x="0" y="${design.w / 2 + 23}">${num(design.l)} см</text><text transform="translate(${-design.l / 2 - 22} 0) rotate(-90)">${num(design.w)} см</text></g>`;
    $("canvasEmpty").hidden = design.pieces.length > 0;
    syncClarity();
    updateResin();
    legsUi?.schedule();
    const p = design.pieces.find((p) => p.uid === selected);
    $("selectedTools").hidden = !design.pieces.length;
    $("pieceControls").hidden = !p;
    renderOnTable();
    $("selectionLabel").textContent = p
      ? "Стрілки: 1 см · Shift: 5 см · [ ]: поворот · Delete: видалити"
      : "Оберіть слеб для редагування";
    if (p) {
      $("selectedName").textContent = db.slabs.find(
        (s) => s.id === p.id,
      ).number;
      ["X", "Y"].forEach(
        (k) => ($("piece" + k).value = numInput(p[k.toLowerCase()])),
      );
      const angle = normAngle(p.angle);
      if (document.activeElement !== $("pieceAngle")) $("pieceAngle").value = numInput(angle);
      $("pieceAngleRange").value = angle;
    }
  }
  // An angle in degrees, always 0-360: a slab or the resin texture can be turned all the way round.
  function normAngle(a) {
    const n = Number(a);
    return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
  }
  // Every slab on the table as a chip: click to select it, x to take it off the table.
  function renderOnTable() {
    $("onTable").innerHTML = design.pieces
      .map((p) => {
        const s = db.slabs.find((s) => s.id === p.id);
        if (!s) return "";
        const on = p.uid === selected;
        return `<span class="chip ${on ? "is-on" : ""}"><button type="button" data-chip="${esc(p.uid)}" aria-pressed="${on}">${esc(s.number)}${s.species ? " · " + esc(s.species) : ""}</button><button type="button" class="chip-x" data-chip-remove="${esc(p.uid)}" aria-label="Прибрати слеб ${esc(s.number)} зі столу">×</button></span>`;
      })
      .join("");
  }
  // Epoxy the table takes: the part of the top not covered by a slab, times the
  // thickness, times the density plus the waste allowance — the same formula as
  // the server's quote, so the figure on screen is the one that is ordered.
  // It follows every move of a slab: a coarse grid while dragging (cheap
  // enough for each frame), the full grid a moment after the last change.
  let resinCoarse, resinFine;
  function resinFigures(resolution) {
    const here = { ...design, pieces: design.pieces.filter((p) => db.slabs.some((s) => s.id === p.id)) };
    const m = Geo.measure(here, db.slabs, resolution);
    const litres = m.resin * design.t * 10;
    const costs = db.costs || {};
    const density = costs.density || 1.1,
      waste = costs.waste ?? 10;
    return { litres, kg: litres * density * (1 + waste / 100), area: m.resin, density, waste };
  }
  function updateResin() {
    clearTimeout(resinCoarse);
    clearTimeout(resinFine);
    if (!design.pieces.length) {
      $("resinLiveText").textContent =
        "Додайте слеб — кількість епоксидки порахується автоматично";
      return;
    }
    const show = (resolution) => {
      const r = resinFigures(resolution);
      $("resinLiveText").innerHTML =
        `Епоксидка: <b>${num(r.litres, 2)} л</b> · <b>${num(r.kg, 2)} кг</b>` +
        `<span class="resin-detail"> з запасом ${num(r.waste, 0)}% · щільність ${num(r.density, 2)} · товщина ${num(design.t)} см · вільна площа ${num(r.area, 3)} м²</span>`;
    };
    resinCoarse = setTimeout(() => show(160), 20);
    resinFine = setTimeout(() => show(650), 300);
  }
  function numInput(n) {
    return Math.round(n * 10) / 10;
  }
  // The price sits in the bar above the preview, which stays on screen on a
  // phone: otherwise "Calculate" is at the very bottom of the controls, far
  // from the shape and sizes it prices.
  function syncBarPrice() {
    $("barPriceText").textContent = estimate
      ? money(estimate.total)
      : "Ціну не розраховано";
    $("barCalc").hidden = !!estimate;
    $("barCalc").disabled = $("calculate").disabled;
  }
  $("barCalc").onclick = () => $("calculate").click();
  function invalidate() {
    designRevision++;
    estimate = null;
    $("approvePrice").checked = false;
    $("approveLabel").hidden = true;
    $("addCart").hidden = true;
    $("calculate").hidden = false;
    $("estimate").innerHTML =
      '<p class="muted">Композицію змінено. Розрахуйте актуальну вартість.</p>';
    $("designWarning").textContent = "";
    $("cartError").hidden = true;
    syncBarPrice();
    saveDraft();
  }
  let librarySpecies = "",
    inventorySpecies = "";
  function speciesButtons(id, value, slabs, choose) {
    const options = [
      { value: "", label: "Усі породи" },
      ...WoodSpecies.options(db.slabs),
    ];
    $(id).innerHTML = options
      .map((o) => {
        const count = slabs.filter(
          (s) => !o.value || WoodSpecies.key(s.species) === o.value,
        ).length;
        return `<button type="button" data-species="${esc(o.value)}" aria-pressed="${value === o.value}">${esc(o.label)} <span>${count}</span></button>`;
      })
      .join("");
    $(id)
      .querySelectorAll("button")
      .forEach((b) => (b.onclick = () => choose(b.dataset.species)));
  }
  function speciesOptions() {
    speciesButtons(
      "speciesFilter",
      librarySpecies,
      db.slabs.filter((s) => available(s.id)),
      (value) => {
        librarySpecies = value;
        speciesOptions();
        renderLibrary();
      },
    );
    speciesButtons(
      "inventorySpeciesFilter",
      inventorySpecies,
      db.slabs,
      (value) => {
        inventorySpecies = value;
        speciesOptions();
        renderInventory();
      },
    );
  }
  function renderLibrary() {
    const items = db.slabs.filter(
      (s) =>
        available(s.id) &&
        (!librarySpecies || WoodSpecies.key(s.species) === librarySpecies) &&
        s.h >= Number($("minLength").value) &&
        s.w >= Number($("minWidth").value),
    );
    $("stockCount").textContent = `/ ${items.length}`;
    $("slabLibrary").innerHTML = items.length
      ? items
          .map((s, i) => {
            let added = design.pieces.some((p) => p.id === s.id);
            return `<article class="slab-card"><div class="slab-preview"><span class="slab-number">${esc(s.number)}</span>${slabSvg(s, "lib" + i)}</div><div class="slab-content"><h3>${esc(s.species)} · натуральний край</h3><p>${num(s.h)} × ${num(s.w)} × ${num(s.t)} см</p><div class="slab-card-bottom"><b>${money(((Geo.area(s.points) * s.w * s.h) / 10000) * s.rate)}</b><button data-add="${s.id}" aria-label="Додати ${esc(s.number)}" ${added ? "disabled" : ""}>${added ? "✓" : "+"}</button></div></div></article>`;
          })
          .join("")
      : '<p class="hint">Немає слебів за цими фільтрами.</p>';
    $$("[data-add]").forEach(
      (b) => (b.onclick = () => addPiece(b.dataset.add)),
    );
  }
  function addPiece(id) {
    if (design.pieces.length >= 6) {
      toast("Максимум шість слебів у композиції.");
      return;
    }
    if (design.pieces.some((p) => p.id === id) || !available(id)) return;
    const s = db.slabs.find((s) => s.id === id),
      count = design.pieces.length,
      p = {
        id,
        uid: uid(),
        x: 0,
        y: count ? design.w / 4 : -design.w / 4,
        angle: 90,
      };
    if (!count) design.t = s.t;
    $("tableT").value = design.t;
    dimensionsValid();
    design.pieces.push(p);
    selected = p.uid;
    invalidate();
    renderDesign();
    renderLibrary();
    toast("Слеб додано. Перемістіть його на полотні.");
  }
  ["minLength", "minWidth"].forEach((id) =>
    $(id).addEventListener("input", renderLibrary),
  );
  function dimensionsValid(showError = false) {
    const fields = [$("tableL"), $("tableW"), $("tableT")];
    const valid = fields.every(
      (field) => field.disabled || field.validity.valid,
    );
    for (const field of fields) {
      if (!field.disabled && !field.validity.valid && showError)
        field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    }
    $("dimensionError").hidden = valid || !showError;
    $("calculate").disabled = !valid || quotePending || texturePending;
    $("barCalc").disabled = $("calculate").disabled;
    return valid;
  }
  // The slabs are placed in table coordinates. When the table changes shape or
  // size they keep their old coordinates, so on a smaller or different table
  // they ended up outside the clip and vanished while still counted as added.
  // Follow the table: scale the positions with it and keep each slab's centre
  // on the table.
  function refitPieces(oldL, oldW) {
    const kx = design.l / oldL,
      ky = design.w / oldW;
    for (const p of design.pieces) {
      p.x = numInput(Math.max(-design.l / 2, Math.min(design.l / 2, p.x * kx)));
      p.y = numInput(Math.max(-design.w / 2, Math.min(design.w / 2, p.y * ky)));
    }
  }
  function readDimensions(event) {
    // Incomplete keyboard input stays in the field. Never restore an old value
    // while the customer is clearing or typing a replacement dimension.
    invalidate();
    if (!dimensionsValid(event?.type !== "input")) return false;
    const l = $("tableL").valueAsNumber,
      w = design.shape === "oval" ? $("tableW").valueAsNumber : l,
      t = $("tableT").valueAsNumber;
    const [oldL, oldW] = [design.l, design.w];
    Object.assign(design, { l, w, t });
    refitPieces(oldL, oldW);
    saveDraft();
    if (design.shape !== "oval") $("tableW").value = w;
    renderDesign();
    return true;
  }
  function syncDimensions() {
    ["L", "W", "T"].forEach(
      (k) => ($("table" + k).value = design[k.toLowerCase()]),
    );
    $("tableW").disabled = design.shape !== "oval";
    $("tableWidthField").hidden = design.shape !== "oval";
    $("tableDimensions").style.gridTemplateColumns =
      design.shape === "oval" ? "1fr 1fr" : "1fr";
    $("tableL").max = design.shape === "oval" ? 350 : 180;
    $("tableLengthLabel").textContent =
      design.shape === "round"
        ? "Діаметр, см"
        : design.shape === "square"
          ? "Сторона, см"
          : "Довжина, см";
    $("dimensionHint").textContent =
      (design.shape === "oval"
        ? "Довжина 40–350 см · ширина 40–180 см."
        : design.shape === "round"
          ? "Діаметр кола 40–180 см."
          : "Сторона квадрата 40–180 см.") + " Товщина 1–15 см.";
    dimensionsValid();
  }
  ["tableL", "tableW", "tableT"].forEach((id) => {
    $(id).oninput = readDimensions;
    $(id).onchange = readDimensions;
  });
  $$("[data-shape]").forEach(
    (b) =>
      (b.onclick = () => {
        const [oldL, oldW] = [design.l, design.w];
        design.shape = b.dataset.shape;
        if (design.shape !== "oval") {
          design.l = Math.min(design.l, 180);
          design.w = design.l;
        }
        refitPieces(oldL, oldW);
        $$("[data-shape]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        syncDimensions();
        invalidate();
        renderDesign();
      }),
  );
  // The 24 named colours of the Fusion Lab palette. They are plain
  // [data-color] buttons, so they share the handler (and the saved `color`)
  // with the four classic ones.
  $("paletteColors").innerHTML = ResinCatalog.COLORS.map(
    (c) =>
      `<button type="button" data-color="${c.hex}" style="--color: ${c.hex}" aria-label="${esc(c.name)}" title="${esc(c.name)}"></button>`,
  ).join("");
  $$("[data-color]").forEach(
    (b) =>
      (b.onclick = () => {
        clearResinTexture();
        design.color = b.dataset.color;
        $$("[data-color]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        $("colorName").textContent = b.getAttribute("aria-label");
        invalidate();
        renderDesign();
      }),
  );
  let textureRevision = 0;
  function syncResinTexture() {
    const texture = design.resinTexture;
    $$("[data-preset-texture]").forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(
          db.resinTextures.some(
            (t) =>
              t.id === b.dataset.presetTexture &&
              t.image === texture?.image &&
              t.name === texture?.name,
          ),
        ),
      ),
    );
    $("resinTexturePreview").hidden = !texture;
    $("resinAngleBox").hidden = !texture;
    {
      const a = normAngle(design.resinAngle);
      if (document.activeElement !== $("resinAngle")) $("resinAngle").value = numInput(a);
      $("resinAngleRange").value = a;
    }
    if (texture) {
      $("resinTextureThumbnail").src = texture.image;
      $("resinTextureName").textContent = texture.name;
      $("colorName").textContent = "текстура · " + texture.name;
    } else {
      $("resinTextureThumbnail").removeAttribute("src");
      $("resinTextureName").textContent = "";
      $("colorName").textContent =
        $$("[data-color]")
          .find((b) => b.dataset.color === design.color)
          ?.getAttribute("aria-label") || "Колір смоли";
    }
    $$("[data-color]").forEach((b) =>
      b.classList.toggle(
        "active",
        !texture && b.dataset.color === design.color,
      ),
    );
    markBuiltinTextures();
  }
  function textureProgress(scope, progress) {
    $(scope + "Processing").hidden = false;
    $(scope + "Progress").value = progress.percent;
    $(scope + "Progress").setAttribute(
      "aria-valuetext",
      progress.stage + ": " + progress.percent + "%",
    );
    $(scope + "ProgressText").textContent =
      progress.stage + " · " + progress.percent + "%";
  }
  function textureSummary(texture) {
    const s = texture.stats;
    return s
      ? `${s.width} × ${s.height} пкс · ${Math.ceil(s.bytes / 1024)} КіБ (вхідний файл ${num(s.sourceBytes / 1024 / 1024, 1)} МБ).`
      : "";
  }
  function clearResinTexture() {
    textureRevision++;
    texturePending = false;
    dimensionsValid();
    delete design.resinTexture;
    delete design.resinAngle;
    $("resinTextureFile").value = "";
    $("uploadResinTexture").disabled = false;
    $("resinTextureStatus").textContent =
      "PNG, JPG або WEBP · до 35 МБ · автоматичне стиснення";
    $("resinTextureProcessing").hidden = true;
    syncResinTexture();
  }
  // Turn the resin texture all the way round, independent of the slabs.
  function setResinAngle(value) {
    if (!design.resinTexture || !Number.isFinite(value)) return;
    const a = normAngle(value);
    if (a) design.resinAngle = a;
    else delete design.resinAngle;
    invalidate();
    renderDesign();
    syncResinTexture();
  }
  $("resinAngleRange").oninput = (e) => setResinAngle(Number(e.target.value));
  $("resinAngle").onchange = (e) => setResinAngle(Number(e.target.value));
  $("resinAngleReset").onclick = () => setResinAngle(0);
  $$("[data-resin-rot]").forEach(
    (b) => (b.onclick = () => setResinAngle(normAngle(design.resinAngle) + Number(b.dataset.resinRot))),
  );
  $("uploadResinTexture").onclick = () => $("resinTextureFile").click();
  $("resinTextureFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    await applyTextureFile(file);
    event.target.value = "";
  };
  // One path for an uploaded file and for the built-in samples: both are
  // compressed and validated by ResinTexture.read() before they are saved.
  // `color` (a hex) is set under the texture for the built-in ones.
  async function applyTextureFile(file, color) {
    const revision = ++textureRevision;
    texturePending = true;
    invalidate();
    dimensionsValid();
    $("uploadResinTexture").disabled = true;
    $("resinTextureStatus").textContent = "Завантаження текстури…";
    try {
      const texture = await ResinTexture.read(file, (p) => {
        if (revision === textureRevision) textureProgress("resinTexture", p);
      });
      if (revision !== textureRevision) return;
      design.resinTexture = { image: texture.image, name: texture.name };
      if (color) design.color = color;
      syncResinTexture();
      invalidate();
      renderDesign();
      $("resinTextureStatus").textContent =
        "Текстура застосована. " + textureSummary(texture);
    } catch (error) {
      if (revision !== textureRevision) return;
      $("resinTextureProcessing").hidden = true;
      $("resinTextureStatus").textContent = error.message;
      toast(error.message);
    } finally {
      if (revision === textureRevision) {
        texturePending = false;
        dimensionsValid();
        $("uploadResinTexture").disabled = false;
      }
    }
  }
  $("removeResinTexture").onclick = () => {
    clearResinTexture();
    invalidate();
    renderDesign();
  };
  function renderPresetChoices() {
    const textures = db.resinTextures;
    $("presetTextureSection").hidden = !textures.length;
    $("presetTextureChoices").innerHTML = textures
      .map(
        (t) =>
          `<button type="button" data-preset-texture="${t.id}" aria-pressed="false"><img src="${esc(t.image)}" alt="" /><span>${esc(t.name)}</span></button>`,
      )
      .join("");
    $$("[data-preset-texture]").forEach(
      (b) =>
        (b.onclick = () => {
          const t = textures.find((t) => t.id === b.dataset.presetTexture);
          clearResinTexture();
          design.resinTexture = { image: t.image, name: t.name };
          syncResinTexture();
          invalidate();
          renderDesign();
          $("resinTextureStatus").textContent =
            "Застосовано текстуру майстерні.";
        }),
    );
  }
  let presetDraft = null,
    presetDraftRevision = 0,
    presetSaving = false;
  function renderPresetAdmin() {
    const supported = !!remote.capabilities?.resinTexturePresets;
    $("presetTextureForm").hidden = !supported;
    $("presetTextureList").innerHTML = db.resinTextures.length
      ? db.resinTextures
          .map(
            (t) =>
              `<article class="slab-card" data-texture-card="${t.id}"><img class="preset-catalog-image" src="${esc(t.image)}" alt="${esc(t.name)}" /><div class="slab-content"><label class="texture-name"><span>Назва</span><input data-texture-name="${t.id}" value="${esc(t.name)}" maxlength="120" /></label><div class="texture-actions"><button type="button" class="secondary" data-rename-texture="${t.id}">Зберегти назву</button><button type="button" class="secondary" data-replace-texture="${t.id}">Замінити зображення</button><input type="file" accept="image/png,image/jpeg,image/webp" hidden data-replace-file="${t.id}" aria-label="Нове зображення для «${esc(t.name)}»" /></div><button type="button" class="text-btn danger" data-delete-texture="${t.id}">Видалити з каталогу</button></div></article>`,
          )
          .join("")
      : '<p class="hint">Ще немає готових текстур. Завантажте перше зображення.</p>';
    // Editing a catalogue texture never touches orders: each order keeps its
    // own copy of the picture and the name it was placed with.
    const patchTexture = async (id, body, done) => {
      try {
        await bridge.request("PATCH", "/tables/admin/resin-textures/" + id, body);
        await reloadRemote();
        renderPresetAdmin();
        renderPresetChoices();
        renderBuiltinTextures();
        syncResinTexture();
        toast(done);
      } catch (error) {
        toast(error.message);
      }
    };
    $$("[data-rename-texture]").forEach(
      (b) =>
        (b.onclick = async () => {
          const input = $$("[data-texture-name]").find(
            (i) => i.dataset.textureName === b.dataset.renameTexture,
          );
          const name = input.value.trim();
          if (!name) {
            toast("Вкажіть назву текстури.");
            return;
          }
          b.disabled = true;
          await patchTexture(b.dataset.renameTexture, { name }, "Назву збережено.");
          b.disabled = false;
        }),
    );
    $$("[data-replace-texture]").forEach(
      (b) =>
        (b.onclick = () =>
          $$("[data-replace-file]")
            .find((i) => i.dataset.replaceFile === b.dataset.replaceTexture)
            .click()),
    );
    $$("[data-replace-file]").forEach(
      (input) =>
        (input.onchange = async () => {
          const file = input.files[0];
          if (!file) return;
          try {
            const texture = await ResinTexture.read(file);
            await patchTexture(
              input.dataset.replaceFile,
              { image: texture.image },
              "Зображення замінено.",
            );
          } catch (error) {
            toast(error.message);
          } finally {
            input.value = "";
          }
        }),
    );
    renderBuiltinImport(supported);
    $$("[data-delete-texture]").forEach(
      (b) =>
        (b.onclick = async () => {
          if (
            !confirm(
              "Видалити текстуру з каталогу? Збережені замовлення залишаться з цією текстурою.",
            )
          )
            return;
          b.disabled = true;
          try {
            await bridge.request(
              "DELETE",
              "/tables/admin/resin-textures/" + b.dataset.deleteTexture,
            );
            await reloadRemote();
            renderPresetAdmin();
            renderPresetChoices();
            syncResinTexture();
            toast("Текстуру видалено з каталогу.");
          } catch (error) {
            toast(error.message);
            b.disabled = false;
          }
        }),
    );
  }
  // The built-in samples (resin-catalog.js) can be moved into the catalogue,
  // after which they are ordinary, editable presets.
  function missingSamples() {
    return ResinCatalog.SAMPLES.filter(
      (s) => !db.resinTextures.some((t) => t.name === s.name),
    );
  }
  function renderBuiltinImport(supported) {
    const missing = missingSamples();
    $("builtinImport").hidden = !supported || !missing.length;
    $("builtinImportList").innerHTML = missing
      .map(
        (s) =>
          `<article class="slab-card"><img class="preset-catalog-image" src="${esc(s.url)}" alt="${esc(s.name)}" loading="lazy" /><div class="slab-content"><h3>${esc(s.name)}</h3><button type="button" class="secondary" data-import-sample="${s.id}">Додати до каталогу</button></div></article>`,
      )
      .join("");
    $$("[data-import-sample]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          await importSamples([b.dataset.importSample]);
        }),
    );
    $("importAllSamples").disabled = false;
  }
  async function importSamples(ids) {
    let added = 0;
    try {
      for (const id of ids) {
        const sample = ResinCatalog.SAMPLES.find((s) => s.id === id);
        const texture = await ResinTexture.read(await ResinCatalog.sampleFile(sample));
        await bridge.request("POST", "/tables/admin/resin-textures", {
          name: sample.name,
          image: texture.image,
        });
        added++;
      }
    } catch (error) {
      toast(error.message);
    }
    await reloadRemote();
    renderPresetAdmin();
    renderPresetChoices();
    renderBuiltinTextures();
    if (added) toast(added === 1 ? "Зразок додано до каталогу." : `Додано зразків: ${added}.`);
  }
  $("importAllSamples").onclick = async () => {
    $("importAllSamples").disabled = true;
    await importSamples(missingSamples().map((s) => s.id));
  };
  $("choosePresetTexture").onclick = () => $("presetTextureFile").click();
  $("presetTextureFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file || presetSaving) return;
    const revision = ++presetDraftRevision;
    $("savePresetTexture").disabled = true;
    $("presetTextureStatus").textContent = "Підготовка зображення…";
    try {
      const texture = await ResinTexture.read(file, (p) => {
        if (revision === presetDraftRevision)
          textureProgress("presetTexture", p);
      });
      if (revision !== presetDraftRevision) return;
      presetDraft = texture;
      $("presetTextureDraft").src = texture.image;
      $("presetTextureDraft").hidden = false;
      if (!$("presetTextureTitle").value.trim())
        $("presetTextureTitle").value = texture.name.replace(/\.[^.]+$/, "");
      $("presetTextureStatus").textContent =
        "Зображення готове. " +
        textureSummary(texture) +
        " Опублікуйте його для покупців.";
    } catch (error) {
      if (revision !== presetDraftRevision) return;
      $("presetTextureProcessing").hidden = true;
      $("presetTextureStatus").textContent = error.message;
    } finally {
      if (revision === presetDraftRevision) {
        $("savePresetTexture").disabled = !presetDraft;
        event.target.value = "";
      }
    }
  };
  $("presetTextureForm").onsubmit = async (event) => {
    event.preventDefault();
    const name = $("presetTextureTitle").value.trim();
    if (!admin || !presetDraft || !name || presetSaving) return;
    presetSaving = true;
    $("savePresetTexture").disabled = true;
    $("choosePresetTexture").disabled = true;
    $("presetTextureTitle").disabled = true;
    try {
      await bridge.request("POST", "/tables/admin/resin-textures", {
        name,
        image: presetDraft.image,
      });
      presetDraft = null;
      $("presetTextureTitle").value = "";
      $("presetTextureDraft").hidden = true;
      $("presetTextureDraft").removeAttribute("src");
      $("presetTextureStatus").textContent =
        "Текстура опублікована для покупців.";
      await reloadRemote();
      renderPresetAdmin();
      renderPresetChoices();
      syncResinTexture();
    } catch (error) {
      $("presetTextureStatus").textContent = error.message;
    } finally {
      presetSaving = false;
      $("savePresetTexture").disabled = !presetDraft;
      $("choosePresetTexture").disabled = false;
      $("presetTextureTitle").disabled = false;
    }
  };
  $("legs").onchange = () => {
    design.legs = $("legs").value;
    // The flat tariffs and a drawn wooden base are alternatives.
    if (design.legs !== "wood" && design.legSet) delete design.legSet;
    invalidate();
    legsUi.render();
  };
  let dragging = null;
  function svgPoint(e) {
    let p = $("design").createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform($("design").getScreenCTM().inverse());
  }
  $("design").onpointerdown = (e) => {
    let target = e.target.closest("[data-piece]");
    if (!target) {
      selected = null;
      renderDesign();
      return;
    }
    e.preventDefault();
    $("workArea").focus({ preventScroll: true });
    selected = target.dataset.piece;
    const p = design.pieces.find((p) => p.uid === selected),
      pt = svgPoint(e);
    dragging = { uid: selected, dx: pt.x - p.x, dy: pt.y - p.y };
    $("design").setPointerCapture(e.pointerId);
    renderDesign();
  };
  $("design").onpointermove = (e) => {
    if (!dragging) return;
    const pt = svgPoint(e),
      p = design.pieces.find((p) => p.uid === dragging.uid);
    p.x = Math.max(-design.l, Math.min(design.l, pt.x - dragging.dx));
    p.y = Math.max(-design.w, Math.min(design.w, pt.y - dragging.dy));
    invalidate();
    renderDesign();
  };
  $("design").onpointerup = $("design").onpointercancel = () => {
    dragging = null;
  };
  ["X", "Y"].forEach(
    (k) =>
      ($("piece" + k).onchange = () => {
        const p = design.pieces.find((p) => p.uid === selected),
          n = Number($("piece" + k).value);
        if (p && Number.isFinite(n)) {
          p[k.toLowerCase()] = Math.max(-1000, Math.min(1000, n));
          invalidate();
          renderDesign();
        }
      }),
  );
  // Turn the selected slab: any angle, 0-360.
  function setPieceAngle(value) {
    const p = design.pieces.find((p) => p.uid === selected);
    if (!p || !Number.isFinite(value)) return;
    p.angle = normAngle(value);
    invalidate();
    renderDesign();
  }
  $("pieceAngleRange").oninput = (e) => setPieceAngle(Number(e.target.value));
  $("pieceAngle").onchange = (e) => setPieceAngle(Number(e.target.value));
  $$("[data-rot]").forEach(
    (b) =>
      (b.onclick = () => {
        const p = design.pieces.find((p) => p.uid === selected);
        if (p) setPieceAngle(normAngle(p.angle) + Number(b.dataset.rot));
      }),
  );
  function removePiece(uid = selected) {
    design.pieces = design.pieces.filter((p) => p.uid !== uid);
    if (selected === uid) selected = null;
    invalidate();
    renderDesign();
    renderLibrary();
    toast("Слеб прибрано зі столу. Він знову доступний у бібліотеці.");
  }
  $("removePiece").onclick = () => removePiece();
  $("onTable").onclick = (e) => {
    const remove = e.target.closest("[data-chip-remove]");
    if (remove) return removePiece(remove.dataset.chipRemove);
    const chip = e.target.closest("[data-chip]");
    if (!chip) return;
    selected = chip.dataset.chip;
    renderDesign();
  };
  $("workArea").onkeydown = (e) => {
    const p = design.pieces.find((p) => p.uid === selected);
    if (!p || e.target.tagName === "INPUT") return;
    const n = e.shiftKey ? 5 : 1;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removePiece();
      return;
    }
    if (e.key === "[" || e.key === "]") {
      e.preventDefault();
      setPieceAngle(normAngle(p.angle) + (e.key === "]" ? 1 : -1) * (e.shiftKey ? 1 : 15));
      return;
    }
    const delta = {
      ArrowLeft: [-n, 0],
      ArrowRight: [n, 0],
      ArrowUp: [0, -n],
      ArrowDown: [0, n],
    }[e.key];
    if (delta) {
      e.preventDefault();
      p.x += delta[0];
      p.y += delta[1];
      invalidate();
      renderDesign();
    }
  };
  $("resetDesign").onclick = () => {
    design = {
      shape: "oval",
      l: 180,
      w: 90,
      t: 4,
      color: "#24474b",
      legs: "metal",
      pieces: [],
    };
    selected = null;
    clearResinTexture();
    syncDimensions();
    legsUi.render();
    $("legs").value = "metal";
    $$("[data-shape]").forEach((b) =>
      b.classList.toggle("active", b.dataset.shape === "oval"),
    );
    $$("[data-color]").forEach((b) =>
      b.classList.toggle("active", b.dataset.color === design.color),
    );
    $("colorName").textContent = "Глибокий океан";
    invalidate();
    renderDesign();
    renderLibrary();
  };
  function breakdown(q) {
    return `<div class="breakdown"><div><span>Дерево · повні слеби</span><b>${money(q.woodCost)}</b></div><div><span>Смола · ${num(q.kg, 2)} кг</span><b>${money(q.resinCost)}</b></div><div><span>Виготовлення та інші витрати</span><b>${money(q.workCost)}</b></div><div><span>Фінішне покриття</span><b>${money(q.finishCost)}</b></div><div><span>Ніжки${q.legs ? " · " + esc(q.legs.schemeName) + ", " + esc(q.legs.material.name) : ""}</span><b>${money(q.legsCost)}</b></div><div><span>Націнка</span><b>${money(q.markupCost)}</b></div></div>`;
  }
  function validation(d, q) {
    if (!d.pieces.length) return "Додайте хоча б один слеб.";
    if (d.pieces.some((p) => !available(p.id)))
      return "Один зі слебів уже зарезервовано.";
    if (
      d.pieces.some(
        (p) => Math.abs(db.slabs.find((s) => s.id === p.id).t - d.t) > 0.05,
      )
    )
      return "Товщина кожного слеба має відповідати товщині столу.";
    if (q.overlap > 0.0002)
      return "Слеби перетинаються. Розсуньте їх перед розрахунком.";
    if (q.used.some((a) => a < 0.001))
      return "Один зі слебів розташований поза стільницею. Перемістіть його або видаліть.";
    return "";
  }
  $("calculate").onclick = async () => {
    if (!readDimensions()) return;
    if (!design.pieces.length) {
      toast("Додайте хоча б один слеб з бібліотеки.");
      return;
    }
    const key = JSON.stringify(design);
    const revision = designRevision;
    quotePending = true;
    $("calculate").disabled = true;
    let q;
    try {
      q = await bridge.request("POST", "/tables/quote", design);
    } finally {
      quotePending = false;
      dimensionsValid();
    }
    if (revision !== designRevision || key !== JSON.stringify(design)) {
      toast("Композиція змінилася. Повторіть розрахунок.");
      return;
    }
    const error = validation(design, q);
    $("designWarning").textContent = error;
    if (error) return;
    estimate = q;
    $("estimate").innerHTML =
      `<div class="price-total">${money(q.total)}</div><div class="price-sub">Передоплата 50% — ${money(q.deposit)}</div>${breakdown(q)}<p class="hint">Площа ${num(q.area, 3)} м² · дерево ${num(q.wood, 3)} м²<br>Смола ${num(q.litres, 2)} л до запасу. Маса містить запас ${db.costs.waste}%.<br>Площа розрахована чисельно, похибка контуру залежить від фото. Вартість дерева включає обрізки.</p>`;
    $("calculate").hidden = true;
    $("approveLabel").hidden = false;
    $("addCart").hidden = false;
    $("addCart").disabled = true;
    syncBarPrice();
  };
  $("approvePrice").onchange = () =>
    ($("addCart").disabled = !$("approvePrice").checked);
  $("addCart").onclick = async () => {
    if (cartPending || !estimate || !$("approvePrice").checked) return;
    cartPending = true;
    saveDraft();
    $("addCart").disabled = true;
    $("addCart").textContent = "Додаємо стіл у кошик…";
    $("cartError").hidden = true;
    $("builder").inert = true;
    $("builder").setAttribute("aria-busy", "true");
    try {
      await bridge.request("POST", "/tables/preorders", {
        quoteId: estimate.quoteId,
        approved: true,
      });
      try { sessionStorage.removeItem(draftKey); } catch { /* Optional storage. */ }
      bridge.navigate("/cart");
    } catch (error) {
      if (error.status === 401) {
        bridge.navigate("/login");
        return;
      }
      if (error.status === 409) invalidate();
      $("cartError").textContent = error.message || "Не вдалося додати стіл у кошик. Спробуйте ще раз.";
      $("cartError").hidden = false;
    } finally {
      cartPending = false;
      $("builder").inert = false;
      $("builder").removeAttribute("aria-busy");
      $("addCart").disabled = !$("approvePrice").checked;
      $("addCart").textContent = "Додати стіл у кошик →";
    }
  };
  function renderInventory() {
    const items = db.slabs.filter(
      (s) =>
        !inventorySpecies || WoodSpecies.key(s.species) === inventorySpecies,
    );
    $("inventoryList").innerHTML = items.length
      ? items
          .map(
            (s, i) =>
              `<article class="slab-card"><div class="slab-preview"><span class="slab-number">${esc(s.number)}</span>${slabSvg(s, "inv" + i)}</div><div class="slab-content"><h3>${esc(s.species)} · ${esc(s.number)}</h3><p>${num(s.h)} × ${num(s.w)} × ${num(s.t)} см · ${s.points.length} вершин<br>Площа ${num((Geo.area(s.points) * s.w * s.h) / 10000, 3)} м²<br>${money(s.rate)} / м² ${s.demo ? "· демо" : ""}</p><div class="slab-card-bottom"><span class="badge">${available(s.id) ? "На складі" : "Зарезервовано"}</span><button data-delete="${s.id}" aria-label="Видалити ${esc(s.number)}" ${available(s.id) ? "" : "disabled"}>×</button></div><button class="text-btn" data-vector="${s.id}">SVG · 1:1 · мм ↓</button><button class="text-btn" data-dxf="${s.id}">DXF 2000 · 1:1 · мм ↓</button></div></article>`,
          )
          .join("")
      : '<p class="hint">Немає слебів цієї породи.</p>';
    $$("[data-delete]").forEach(
      (b) =>
        (b.onclick = async () => {
          const id = b.dataset.delete;
          if (!confirm("Прибрати слеб зі складу?")) return;
          await bridge.request("DELETE", "/tables/admin/slabs/" + id);
          await reloadRemote();
          {
            design.pieces = design.pieces.filter((p) => p.id !== id);
            invalidate();
            renderInventory();
            speciesOptions();
            renderLibrary();
            renderDesign();
          }
        }),
    );
    $$("[data-vector]").forEach(
      (b) =>
        (b.onclick = () => {
          const slab = db.slabs.find((s) => s.id === b.dataset.vector);
          try {
            download(
              slab.number + ".svg",
              SlabContour.svg(slab),
              "image/svg+xml",
            );
          } catch (error) {
            toast(error.message);
          }
        }),
    );
    $$("[data-dxf]").forEach(
      (b) =>
        (b.onclick = () => {
          const slab = db.slabs.find((s) => s.id === b.dataset.dxf);
          try {
            download(
              slab.number + ".dxf",
              SlabContour.dxf(slab),
              "application/dxf",
            );
          } catch (error) {
            toast(error.message);
          }
        }),
    );
  }
  const costFields = [
    ["resin", "Смола, грн/кг", 0, 100000, 1],
    ["density", "Густина смоли, кг/л", 0.5, 3, 0.01],
    ["waste", "Технологічний запас, %", 0, 100, 1],
    ["work", "Виготовлення, грн/м²", 0, 100000, 1],
    ["finish", "Фінішне покриття, грн/м²", 0, 100000, 1],
    ["metal", "Металеві ніжки, грн/комплект", 0, 100000, 1],
    ["wood", "Дерев’яні ніжки, грн/комплект", 0, 100000, 1],
    ["markup", "Націнка на витрати, %", 0, 300, 1],
  ];
  function renderCosts() {
    $("costForm").innerHTML =
      '<div class="notice">Тестові значення. Смола = вільна площа × товщина × густина × технологічний запас. Кошик зберігає погоджену ціну; нові ставки застосовуються до наступних розрахунків.</div>' +
      costFields
        .map(
          ([k, l, min, max, step]) =>
            `<label>${l}<input name="${k}" required type="number" min="${min}" max="${max}" step="${step}" value="${db.costs[k]}"></label>`,
        )
        .join("") +
      '<button type="submit" class="primary">Зберегти витрати →</button>';
  }
  $("costForm").onsubmit = async (e) => {
    e.preventDefault();
    const costs = { none: 0 };
    for (const [k] of costFields)
      costs[k] = Number(new FormData(e.target).get(k));
    await bridge.request("PUT", "/tables/admin/costs", {
      expectedVersion: remote.costsVersion,
      data: costs,
    });
    await reloadRemote();
    invalidate();
    toast("Витрати затверджено. Нові розрахунки використовують ці ставки.");
  };
  function orderImage(o) {
    let w = o.l + 50,
      h = o.w + 40;
    return `<svg viewBox="${-w / 2} ${-h / 2} ${w} ${h}" aria-label="Збережена композиція">${composition(o, o.slabs, "o" + o.id.replaceAll("-", ""))}</svg>`;
  }
  const shapeNames = {
      square: "Квадратний",
      round: "Круглий",
      oval: "Овальний",
    },
    statusNames = {
      cart: "У кошику · очікує передоплати",
      pending: "Очікує передоплати 50%",
      queued: "Очікує виробництва",
      making: "Прийнято в роботу",
      ready: "Готовий",
      payment_review: "Потрібна перевірка платежу",
    };
  let orderFilter = "all", ordersLoading = false;
  async function refreshOrders() {
    if (!admin || ordersLoading) return;
    ordersLoading = true;
    $("refreshOrders").disabled = true;
    $("refreshOrders").textContent = "Оновлюємо…";
    $("ordersError").hidden = true;
    try {
      db.orders = await bridge.request("GET", "/tables/admin/production");
      renderOrders();
    } catch (error) {
      $("ordersError").textContent = error.message || "Не вдалося завантажити замовлення.";
      $("ordersError").hidden = false;
    } finally {
      ordersLoading = false;
      $("refreshOrders").disabled = false;
      $("refreshOrders").textContent = "Оновити замовлення";
    }
  }
  $("refreshOrders").onclick = () => void refreshOrders();
  // Where an order is in the payment of its two halves. The API says so
  // (paymentStage); the fallback reads the same fields for an older API.
  const stageOf = (o) =>
    o.paymentStage ||
    (o.balancePaidAt
      ? "paid_full"
      : o.paidAt
        ? "deposit_paid"
        : ["cart", "pending"].includes(o.status)
          ? "in_cart"
          : "closed");
  const stageTabs = [
    ["all", "Усі замовлення"],
    ["in_cart", "У кошику клієнта"],
    ["deposit_paid", "Передоплата 50% отримана"],
    ["paid_full", "Оплачено 100%"],
  ];
  let orderStage = "all";
  const orderMatches = (o, f) => f === "all" ||
    (f === "unpaid" ? ["cart", "pending"].includes(o.status) : o.status === f);
  function renderOrders() {
    $("orderStages").innerHTML = stageTabs
      .map(
        ([key, label]) =>
          `<button type="button" role="tab" class="${orderStage === key ? "active" : ""}" data-order-stage="${key}" aria-selected="${orderStage === key}">${label} · ${db.orders.filter((o) => key === "all" || stageOf(o) === key).length}</button>`,
      )
      .join("");
    $$("[data-order-stage]").forEach((b) => (b.onclick = () => {
      orderStage = b.dataset.orderStage;
      renderOrders();
    }));
    const filters = [["all", "Усі"], ["unpaid", "Очікують оплати"], ["queued", "До прийняття"], ["making", "У роботі"], ["ready", "Готові"], ["payment_review", "Перевірка платежу"]];
    const inStage = db.orders.filter((o) => orderStage === "all" || stageOf(o) === orderStage);
    $("orderFilters").innerHTML = filters.map(([key, label]) =>
      `<button type="button" class="${orderFilter === key ? "active" : ""}" data-order-filter="${key}" aria-pressed="${orderFilter === key}">${label} · ${inStage.filter(o => orderMatches(o, key)).length}</button>`).join("");
    $$("[data-order-filter]").forEach(b => b.onclick = () => {
      orderFilter = b.dataset.orderFilter;
      renderOrders();
    });
    const orders = inStage.filter(o => orderMatches(o, orderFilter));
    $("ordersList").innerHTML = orders.length
      ? orders
          .map(
            (o) =>
              `<article class="order-card" data-order-id="${esc(o.id)}"><div class="order-image">${orderImage(o)}</div><div class="order-details"><span class="badge">${esc(statusNames[o.status] || o.status)}</span><h2 style="margin-top:12px">${shapeNames[o.shape]} стіл ${num(o.l)} × ${num(o.w)}</h2><p>#${esc(o.number)}<br>${o.buyer ? `Покупець: ${esc(o.buyer.displayName || "Без імені")} · ${esc(o.buyer.email)}<br>` : ""}Слеби: ${o.slabs.map((s) => esc(s.number)).join(", ")}<br>Товщина ${num(o.t)} см · епоксидка ${num(o.quote.litres, 2)} л · ${num(o.quote.kg, 2)} кг (щільність ${num(o.costs?.density ?? 0, 2)}, запас ${num(o.costs?.waste ?? 0, 0)}%, вільна площа ${num(o.quote.resin, 3)} м²)<br>${o.quote.legs ? `Ніжки: ${esc(o.quote.legs.schemeName)} · ${esc(o.quote.legs.material.name)} · стіл ${num(o.quote.legs.height, 1)} см, ніжки ${num(o.quote.legs.thickness, 1)} см (довжина ${num(o.quote.legs.legLength, 1)} см)<br>Кріплення: ${o.quote.legs.mounts.length} × пластина «${esc(o.quote.legs.plate.name)}» ${num(o.quote.legs.mounts[0].w, 1)} × ${num(o.quote.legs.mounts[0].d, 1)} × ${num(o.quote.legs.plateThicknessCm, 1)} см, по 4 отвори Ø${num(o.quote.legs.plate.holeDiameterMm, 1)} мм<br>` : ""}1. Передоплата 50%: ${money(o.depositMinor / 100)} · ${o.paidAt ? o.paymentMode === "demo" ? "ДЕМО · реальні кошти не зараховано" : o.paymentMode === "sandbox" ? "ТЕСТ LIQPAY · реальні кошти не зараховано" : "підтверджено банком" : "не підтверджена"}<br>2. Залишок 50%: ${money((o.balanceMinor ?? o.totalMinor - o.depositMinor) / 100)} · ${o.balancePaidAt ? o.balancePaymentMode === "demo" ? "ДЕМО · реальні кошти не зараховано" : o.balancePaymentMode === "sandbox" ? "ТЕСТ LIQPAY · реальні кошти не зараховано" : "підтверджено банком" : o.status === "ready" ? "очікуємо від покупця" : "сплачується після виготовлення"}</p>${stageOf(o) === "paid_full" ? `<p class="hint">Оплачено 100%${o.status === "ready" ? " — стіл можна відправляти." : "."}</p>` : o.status === "ready" && o.paidAt ? '<p class="hint">Стіл готовий. Відправляйте після оплати залишку покупцем.</p>' : ""}${["cart", "pending"].includes(o.status) ? '<p class="hint">Прийняття в роботу стане доступним після передоплати 50%.</p>' : ""}<div class="order-actions">${o.paidAt && ["queued", "making"].includes(o.status) ? `<button class="primary" data-next="${o.id}" data-status="${o.status === "queued" ? "making" : "ready"}">${o.status === "queued" ? "Прийняти в роботу" : "Позначити готовим"}</button>` : ""}<button class="text-btn" data-spec="${o.id}">Специфікація ↓</button></div></div><div class="order-price">${money(o.totalMinor / 100)}</div></article>`,
          )
          .join("")
      : '<div class="empty-panel"><h2>Замовлень поки немає</h2><p>Стіл з’явиться тут після додавання покупцем у кошик. Для початку виробництва потрібна передоплата 50%.</p></div>';
    $$("[data-next]").forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          $("ordersError").hidden = true;
          try {
            await bridge.request(
              "PATCH",
              "/tables/admin/production/" + b.dataset.next,
              { status: b.dataset.status },
            );
            await refreshOrders();
            toast(b.dataset.status === "making" ? "Стільницю прийнято в роботу." : "Стільниця готова.");
          } catch (error) {
            $("ordersError").textContent = error.message || "Не вдалося змінити статус.";
            $("ordersError").hidden = false;
          } finally { b.disabled = false; }
        }),
    );
    $$("[data-spec]").forEach(
      (b) =>
        (b.onclick = () =>
          download(
            "table-" + b.dataset.spec + ".json",
            JSON.stringify(
              db.orders.find((o) => o.id === b.dataset.spec),
              null,
              2,
            ),
            "application/json",
          )),
    );
  }
  function download(name, data, type) {
    const u = URL.createObjectURL(new Blob([data], { type })),
      a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 5000);
  }
  $("exportData").onclick = () =>
    download(
      "slab-studio-backup.json",
      JSON.stringify(db, null, 2),
      "application/json",
    );
  const contourEditor = new SlabContour.Editor({
    toast,
    maxPoints: remote.capabilities?.slabContourMaxPoints || 128,
  });
  $("newSlab").onclick = () => {
    contourEditor.reset();
    $("slabNumber").value =
      "SL-" + String(db.slabs.length + 1).padStart(3, "0");
    $("slabDialog").showModal();
    contourEditor.draw();
  };
  $("closeSlab").onclick = () => {
    contourEditor.reset();
    $("slabDialog").close();
  };
  $("slabForm").onsubmit = async (e) => {
    e.preventDefault();
    let data;
    try {
      data = contourEditor.value();
    } catch (error) {
      toast(error.message);
      return;
    }
    const number = $("slabNumber").value.trim(),
      species = $("slabSpecies").value.trim();
    if (!number || !species) {
      toast("Вкажіть номер та породу дерева.");
      return;
    }
    if (db.slabs.some((s) => s.number.toLowerCase() === number.toLowerCase())) {
      toast("Слеб із таким номером уже є у бібліотеці.");
      return;
    }
    $("saveSlab").disabled = true;
    try {
      await bridge.request("POST", "/tables/admin/slabs", {
        ...data,
        number,
        species,
        t: Number($("slabThickness").value),
        rate: Number($("slabRate").value),
      });
      await reloadRemote();
      $("slabDialog").close();
      contourEditor.reset();
      renderInventory();
      speciesOptions();
      renderLibrary();
      toast("Фото, перевірений контур та реальний масштаб збережено.");
    } catch (error) {
      toast(error.message);
      contourEditor.status();
    }
  };
  // ---- Wooden legs (table-legs.js, legs-ui.js, table-3d.js) ----------------
  // The picture of the top as the buyer composed it, for the 3D view.
  function topTexture() {
    const d = { ...design, pieces: design.pieces.filter((p) => db.slabs.some((s) => s.id === p.id)) };
    const width = 1024,
      height = Math.max(256, Math.round((width * d.w) / d.l));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-d.l / 2} ${-d.w / 2} ${d.l} ${d.w}" width="${width}" height="${height}">${composition(d, db.slabs, "t3d")}</svg>`;
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  legsUi = LegsUi.create({
    $, esc, num, money,
    design: () => design,
    catalog: () => remote.legs,
    changed: () => invalidate(),
    syncLegsSelect: (value) => ($("legs").value = value),
    topTexture,
  });

  legsAdmin = LegsAdmin.create({
    $, esc, num, bridge, toast, admin,
    legs: () => remote.legs,
    mini: (meta) => legsUi.mini(meta),
    reload: async () => {
      await reloadRemote();
      legsAdmin.render();
      legsUi.render();
    },
  });

  // ---- Built-in resin textures (resin-catalog.js) -------------------------
  // A style ("Хвилі", "Перламутр") is a grey base painted in the colour the
  // buyer picks; a sample is a photograph of a poured piece as it is. Both end
  // up as design.resinTexture through applyTextureFile().
  const builtin = {
    style: "waves",
    colors: Object.fromEntries(
      ResinCatalog.STYLES.map((s) => [s.id, s.defaultColor]),
    ),
  };
  const textureLabel = (style, colorName) => `${style.name} · ${colorName}`;
  // Reopening a saved draft: show the choice that produced its texture.
  for (const style of ResinCatalog.STYLES) {
    for (const color of ResinCatalog.COLORS) {
      if (design.resinTexture?.name === textureLabel(style, color.name)) {
        builtin.style = style.id;
        builtin.colors[style.id] = color.name;
      }
    }
  }
  function currentStyle() {
    return ResinCatalog.STYLES.find((s) => s.id === builtin.style);
  }
  function renderBuiltinTextures() {
    const style = currentStyle(),
      colorName = builtin.colors[style.id];
    $("styleHeading").textContent = style.name;
    $("styleColorName").textContent = colorName;
    $("textureStyles").innerHTML = ResinCatalog.STYLES.map(
      (s) =>
        `<button type="button" data-texture-style="${s.id}" aria-pressed="${s.id === style.id}">${esc(s.name)}</button>`,
    ).join("");
    $("styleColors").innerHTML = ResinCatalog.COLORS.map(
      (c) =>
        `<button type="button" data-style-color="${esc(c.name)}" style="--color: ${c.hex}" aria-label="${esc(c.name)}" title="${esc(c.name)}"></button>`,
    ).join("");
    // A sample the workshop has added to the catalogue is shown there, under
    // "Текстури від майстерні", with whatever name and picture it now has.
    $("sampleTextures").innerHTML = ResinCatalog.SAMPLES.filter(
      (s) => !db.resinTextures.some((t) => t.name === s.name),
    ).map(
      (s) =>
        `<button type="button" data-sample-texture="${s.id}" aria-pressed="false"><img src="${esc(s.url)}" alt="" loading="lazy" /><span>${esc(s.name)}</span></button>`,
    ).join("");
    $$("[data-texture-style]").forEach(
      (b) =>
        (b.onclick = () => {
          builtin.style = b.dataset.textureStyle;
          renderBuiltinTextures();
          applyStyle();
        }),
    );
    $$("[data-style-color]").forEach(
      (b) =>
        (b.onclick = () => {
          builtin.colors[builtin.style] = b.dataset.styleColor;
          renderBuiltinTextures();
          applyStyle();
        }),
    );
    $$("[data-sample-texture]").forEach(
      (b) =>
        (b.onclick = async () => {
          const sample = ResinCatalog.SAMPLES.find(
            (s) => s.id === b.dataset.sampleTexture,
          );
          try {
            await applyTextureFile(await ResinCatalog.sampleFile(sample));
          } catch (error) {
            toast(error.message);
          }
        }),
    );
    markBuiltinTextures();
  }
  async function applyStyle() {
    const style = currentStyle(),
      color = ResinCatalog.COLORS.find(
        (c) => c.name === builtin.colors[style.id],
      );
    try {
      await applyTextureFile(await ResinCatalog.styleFile(style, color), color.hex);
    } catch (error) {
      toast(error.message);
    }
  }
  // Which built-in choice is the one currently on the table.
  function markBuiltinTextures() {
    const applied = design.resinTexture?.name;
    const style = currentStyle();
    $$("[data-style-color]").forEach((b) =>
      b.setAttribute(
        "aria-pressed",
        String(
          applied === textureLabel(style, b.dataset.styleColor),
        ),
      ),
    );
    $$("[data-sample-texture]").forEach((b) => {
      const sample = ResinCatalog.SAMPLES.find(
        (s) => s.id === b.dataset.sampleTexture,
      );
      b.setAttribute("aria-pressed", String(applied === sample.name));
    });
  }

  // ---- Resin by transparency: 0 = opaque, 100 = clear. The slabs on the table stay opaque.
  function clarityOf() {
    const n = Math.round(Number(design.resinTransparency));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }
  function setClarity(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return;
    const t = Math.min(100, Math.max(0, n));
    if (t) design.resinTransparency = t;
    else delete design.resinTransparency;
    invalidate();
    renderDesign();
  }
  function syncClarity() {
    const t = clarityOf(),
      textured = !!design.resinTexture,
      waves = !!design.resinTexture?.name?.startsWith("Хвилі");
    const mode = !t ? "plain" : t >= 100 && !textured ? "clear" : t === 50 && waves ? "half-waves" : t === 50 && !textured ? "half" : "";
    $$("[data-clarity]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.clarity === mode)));
    if (document.activeElement !== $("clarity")) $("clarity").value = t;
    $("clarityRange").value = t;
    $("clarityHint").textContent = !t
      ? ""
      : t >= 100
        ? "Повністю прозора смола: видно те, що під столом. Слеби лишаються непрозорими."
        : `Смола прозора на ${t}%: колір і текстура напівпрозорі, слеби лишаються непрозорими.`;
  }
  $$("[data-clarity]").forEach(
    (b) =>
      (b.onclick = async () => {
        const mode = b.dataset.clarity;
        if (mode === "plain") return setClarity(0);
        if (mode === "clear" || mode === "half") {
          clearResinTexture();
          return setClarity(mode === "clear" ? 100 : 50);
        }
        // 50% with the waves: the "Хвилі" style in the colour chosen for it.
        builtin.style = "waves";
        renderBuiltinTextures();
        setClarity(50);
        await applyStyle();
      }),
  );
  $("clarityRange").oninput = (e) => setClarity(e.target.value);
  $("clarity").onchange = (e) => setClarity(e.target.value);

  // On a phone the builder scrolls inside its frame: tell the page, so that it brings the frame to the top
  // and the header and the guide above it are out of the way (the pinned 2D sketch is all that stays).
  if (parent !== window) {
    let reported = 0;
    window.addEventListener(
      "scroll",
      () => {
        if (!matchMedia("(max-width: 650px)").matches || window.scrollY < 6) return;
        const now = Date.now();
        if (now - reported < 500) return;
        reported = now;
        parent.postMessage({ type: "slab:inner-scroll" }, location.origin);
      },
      { passive: true },
    );
  }

  window.addEventListener("unhandledrejection", (e) => {
    e.preventDefault();
    toast(e.reason?.message || "Не вдалося виконати дію.");
  });
  if (new URLSearchParams(location.search).get("host") === "studio")
    $$('[data-view="builder"],[data-view="cart"]').forEach(
      (e) => (e.hidden = true),
    );
  if (!inventory)
    $$('[data-view="inventory"],[data-view="legcatalog"],.admin-label').forEach(
      (e) => (e.hidden = true),
    );
  if (!admin)
    $$(
      '[data-view="costs"],[data-view="orders"],[data-view="textures"]',
    ).forEach((e) => (e.hidden = true));
  $("exportData").hidden = !admin;
  speciesOptions();
  renderPresetChoices();
  renderBuiltinTextures();
  $("legs").value = design.legs;
  legsUi.render();
  $$("[data-shape]").forEach(b => b.classList.toggle("active", b.dataset.shape === design.shape));
  $$("[data-color]").forEach(b => b.classList.toggle("active", !design.resinTexture && b.dataset.color === design.color));
  const chosenColor = $$('[data-color]').find(b => b.dataset.color === design.color);
  if (chosenColor) $("colorName").textContent = chosenColor.getAttribute("aria-label");
  syncResinTexture();
  syncDimensions();
  renderLibrary();
  renderDesign();
  renderOrders();
  view(location.hash.slice(1) || (inventory ? "inventory" : "builder"));
})().catch((e) => {
  document.querySelector("main").innerHTML =
    '<div class="panel" style="margin:40px"><h1>Сервіс тимчасово недоступний</h1><p id="bootError"></p><button onclick="location.reload()">Повторити</button></div>';
  document.getElementById("bootError").textContent = e.message;
});

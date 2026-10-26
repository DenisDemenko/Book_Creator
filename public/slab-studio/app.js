"use strict";
(async () => {
  const bridge = window.SlabBridge;
  const admin = new URLSearchParams(location.search).get("mode") === "admin";
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

  let db = { slabs: remote.slabs, costs: remote.costs, cart: [], orders: [] };
  async function reloadRemote() {
    remote = await bridge.request("GET", "/tables/state");
    db.slabs = remote.slabs;
    db.costs = remote.costs;
    if (admin)
      db.orders = await bridge.request("GET", "/tables/admin/production");
  }
  if (admin)
    db.orders = await bridge.request("GET", "/tables/admin/production");
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
    toastTimer;
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
      (!admin && ["inventory", "costs", "orders"].includes(name))
    )
      name = "builder";
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
    if (name === "cart" || name === "orders") renderOrders();
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
    return `<defs><clipPath id="table-${key}">${tableShape(d)}</clipPath>${defs}<filter id="shadow-${key}" x="-50%" y="-60%" width="200%" height="240%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#33402c" flood-opacity=".18"/></filter></defs>${tableShape(d, `fill="${d.color}" filter="url(#shadow-${key})"`)}<g clip-path="url(#table-${key})">${ResinTexture.layer(d)}${pieces}</g>${tableShape(d, 'fill="none" stroke="#ffffff88" stroke-width=".5" pointer-events="none"')}`;
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
    const p = design.pieces.find((p) => p.uid === selected);
    $("selectedTools").hidden = !p;
    $("selectionLabel").textContent = p
      ? "Стрілки: 1 см · Shift: 5 см · Delete: видалити"
      : "Оберіть слеб для редагування";
    if (p) {
      $("selectedName").textContent = db.slabs.find(
        (s) => s.id === p.id,
      ).number;
      ["X", "Y", "Angle"].forEach(
        (k) => ($("piece" + k).value = numInput(p[k.toLowerCase()])),
      );
    }
  }
  function numInput(n) {
    return Math.round(n * 10) / 10;
  }
  function invalidate() {
    estimate = null;
    $("approvePrice").checked = false;
    $("approveLabel").hidden = true;
    $("addCart").hidden = true;
    $("calculate").hidden = false;
    $("estimate").innerHTML =
      '<p class="muted">Композицію змінено. Розрахуйте актуальну вартість.</p>';
    $("designWarning").textContent = "";
  }
  function speciesOptions() {
    const select = $("speciesFilter"),
      value = select.value;
    select.innerHTML =
      '<option value="">Усі породи</option>' +
      [...new Set(db.slabs.map((s) => s.species))]
        .map((s) => `<option>${esc(s)}</option>`)
        .join("");
    select.value = value;
  }
  function renderLibrary() {
    const items = db.slabs.filter(
      (s) =>
        available(s.id) &&
        (!$("speciesFilter").value || s.species === $("speciesFilter").value) &&
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
    design.pieces.push(p);
    selected = p.uid;
    invalidate();
    renderDesign();
    renderLibrary();
    toast("Слеб додано. Перемістіть його на полотні.");
  }
  ["speciesFilter", "minLength", "minWidth"].forEach((id) =>
    $(id).addEventListener("input", renderLibrary),
  );
  function readDimensions() {
    let l = Number($("tableL").value),
      w = Number($("tableW").value),
      t = Number($("tableT").value);
    if (
      !Number.isFinite(l + w + t) ||
      l < 40 ||
      l > 350 ||
      w < 40 ||
      w > 180 ||
      t < 1 ||
      t > 15
    ) {
      toast("Розміри: довжина 40–350 см, ширина 40–180 см, товщина 1–15 см.");
      syncDimensions();
      return;
    }
    if (design.shape !== "oval") {
      l = Math.min(l, 180);
      w = l;
    }
    Object.assign(design, { l, w, t });
    syncDimensions();
    invalidate();
    renderDesign();
  }
  function syncDimensions() {
    ["L", "W", "T"].forEach(
      (k) => ($("table" + k).value = design[k.toLowerCase()]),
    );
    $("tableW").disabled = design.shape !== "oval";
    $("tableL").max = design.shape === "oval" ? 350 : 180;
  }
  ["tableL", "tableW", "tableT"].forEach(
    (id) => ($(id).onchange = readDimensions),
  );
  $$("[data-shape]").forEach(
    (b) =>
      (b.onclick = () => {
        design.shape = b.dataset.shape;
        if (design.shape !== "oval") {
          design.l = Math.min(design.l, 180);
          design.w = design.l;
        }
        $$("[data-shape]").forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        syncDimensions();
        invalidate();
        renderDesign();
      }),
  );
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
    $("resinTexturePreview").hidden = !texture;
    if (texture) {
      $("resinTextureThumbnail").src = texture.image;
      $("resinTextureName").textContent = texture.name;
      $("colorName").textContent = "Завантажена текстура";
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
  }
  function clearResinTexture() {
    textureRevision++;
    delete design.resinTexture;
    $("resinTextureFile").value = "";
    $("uploadResinTexture").disabled = false;
    $("resinTextureStatus").textContent = "PNG, JPG або WEBP · до 12 МБ";
    syncResinTexture();
  }
  $("uploadResinTexture").onclick = () => $("resinTextureFile").click();
  $("resinTextureFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const revision = ++textureRevision;
    $("uploadResinTexture").disabled = true;
    $("resinTextureStatus").textContent = "Завантаження текстури…";
    try {
      const texture = await ResinTexture.read(file);
      if (revision !== textureRevision) return;
      design.resinTexture = texture;
      syncResinTexture();
      invalidate();
      renderDesign();
      $("resinTextureStatus").textContent = "Текстура застосована до заливки.";
    } catch (error) {
      if (revision !== textureRevision) return;
      $("resinTextureStatus").textContent = error.message;
      toast(error.message);
    } finally {
      if (revision === textureRevision) {
        $("uploadResinTexture").disabled = false;
        event.target.value = "";
      }
    }
  };
  $("removeResinTexture").onclick = () => {
    clearResinTexture();
    invalidate();
    renderDesign();
  };
  $("legs").onchange = () => {
    design.legs = $("legs").value;
    invalidate();
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
  ["X", "Y", "Angle"].forEach(
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
  function removePiece() {
    design.pieces = design.pieces.filter((p) => p.uid !== selected);
    selected = null;
    invalidate();
    renderDesign();
    renderLibrary();
  }
  $("removePiece").onclick = removePiece;
  $("workArea").onkeydown = (e) => {
    const p = design.pieces.find((p) => p.uid === selected);
    if (!p || e.target.tagName === "INPUT") return;
    const n = e.shiftKey ? 5 : 1;
    if (e.key === "Delete") {
      removePiece();
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
    return `<div class="breakdown"><div><span>Дерево · повні слеби</span><b>${money(q.woodCost)}</b></div><div><span>Смола · ${num(q.kg, 2)} кг</span><b>${money(q.resinCost)}</b></div><div><span>Виготовлення та інші витрати</span><b>${money(q.workCost)}</b></div><div><span>Фінішне покриття</span><b>${money(q.finishCost)}</b></div><div><span>Ніжки</span><b>${money(q.legsCost)}</b></div><div><span>Націнка</span><b>${money(q.markupCost)}</b></div></div>`;
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
    if (!design.pieces.length) {
      toast("Додайте хоча б один слеб з бібліотеки.");
      return;
    }
    const key = JSON.stringify(design);
    $("calculate").disabled = true;
    let q;
    try {
      q = await bridge.request("POST", "/tables/quote", design);
    } finally {
      $("calculate").disabled = false;
    }
    if (key !== JSON.stringify(design)) {
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
  };
  $("approvePrice").onchange = () =>
    ($("addCart").disabled = !$("approvePrice").checked);
  $("addCart").onclick = async () => {
    if (!estimate || !$("approvePrice").checked) return;
    $("addCart").disabled = true;
    try {
      await bridge.request("POST", "/tables/preorders", {
        quoteId: estimate.quoteId,
        approved: true,
      });
      bridge.navigate("/cart");
    } finally {
      $("addCart").disabled = false;
    }
  };
  function renderInventory() {
    $("inventoryList").innerHTML = db.slabs
      .map(
        (s, i) =>
          `<article class="slab-card"><div class="slab-preview"><span class="slab-number">${esc(s.number)}</span>${slabSvg(s, "inv" + i)}</div><div class="slab-content"><h3>${esc(s.species)} · ${esc(s.number)}</h3><p>${num(s.h)} × ${num(s.w)} × ${num(s.t)} см · ${s.points.length} вершин<br>Площа ${num((Geo.area(s.points) * s.w * s.h) / 10000, 3)} м²<br>${money(s.rate)} / м² ${s.demo ? "· демо" : ""}</p><div class="slab-card-bottom"><span class="badge">${available(s.id) ? "На складі" : "Зарезервовано"}</span><button data-delete="${s.id}" aria-label="Видалити ${esc(s.number)}" ${available(s.id) ? "" : "disabled"}>×</button></div><button class="text-btn" data-vector="${s.id}">Завантажити SVG ↓</button></div></article>`,
      )
      .join("");
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
          let s = db.slabs.find((s) => s.id === b.dataset.vector);
          download(
            s.number + ".svg",
            `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w * 10}mm" height="${s.h * 10}mm" viewBox="0 0 ${s.w} ${s.h}"><polygon points="${s.points.map(([x, y]) => `${x * s.w},${y * s.h}`).join(" ")}" fill="none" stroke="black" stroke-width="0.05"/></svg>`,
            "image/svg+xml",
          );
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
      queued: "Очікує виробництва",
      making: "У виробництві",
      ready: "Готовий",
    };
  function renderOrders() {
    $("ordersList").innerHTML = db.orders.length
      ? db.orders
          .map(
            (o) =>
              `<article class="order-card"><div class="order-image">${orderImage(o)}</div><div class="order-details"><span class="badge">${esc(statusNames[o.status] || "Потрібна перевірка платежу")}</span><h2 style="margin-top:12px">${shapeNames[o.shape]} стіл ${num(o.l)} × ${num(o.w)}</h2><p>#${esc(o.number)}<br>Слеби: ${o.slabs.map((s) => esc(s.number)).join(", ")}<br>Товщина ${num(o.t)} см · смола ${num(o.quote.kg, 2)} кг<br>Передоплата: ${money(o.depositMinor / 100)} · ${o.paymentMode === "demo" ? "ДЕМО" : o.paymentMode === "sandbox" ? "ТЕСТ LIQPAY" : "підтверджено банком"}</p><div class="order-actions">${o.status === "queued" || o.status === "making" ? `<button class="primary" data-next="${o.id}" data-status="${o.status === "queued" ? "making" : "ready"}">${o.status === "queued" ? "Почати виробництво" : "Позначити готовим"}</button>` : ""}<button class="text-btn" data-spec="${o.id}">Специфікація ↓</button></div></div><div class="order-price">${money(o.totalMinor / 100)}</div></article>`,
          )
          .join("")
      : '<div class="empty-panel"><h2>Виробництво очікує замовлення</h2><p>Стіл потрапить сюди після підтвердження передоплати 50%.</p></div>';
    $$("[data-next]").forEach(
      (b) =>
        (b.onclick = async () => {
          await bridge.request(
            "PATCH",
            "/tables/admin/production/" + b.dataset.next,
            { status: b.dataset.status },
          );
          await reloadRemote();
          renderOrders();
          toast("Статус оновлено.");
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
  /* Photo coordinates remain in the resampled source pixel system until save. */
  let photo = null,
    points = [],
    calPoints = [],
    pxPerCm = 0,
    photoMode = "edit",
    activeVertex = -1,
    photoMap = { s: 1, x: 0, y: 0 };
  const pc = $("photoCanvas"),
    ctx = pc.getContext("2d");
  function resetPhoto() {
    photo = null;
    points = [];
    calPoints = [];
    pxPerCm = 0;
    photoMode = "edit";
    activeVertex = -1;
    $("manual").textContent = "Намалювати вручну";
    $("slabPhoto").value = "";
    $("scaleInfo").textContent = "Масштаб не задано";
    $("contourInfo").textContent = "Контур не створено";
    $("photoHint").textContent =
      "Фото зверху, без перспективи. Покладіть поряд лінійку.";
    drawPhoto();
  }
  $("newSlab").onclick = () => {
    resetPhoto();
    $("slabNumber").value =
      "SL-" + String(db.slabs.length + 1).padStart(3, "0");
    $("slabDialog").showModal();
  };
  $("closeSlab").onclick = () => $("slabDialog").close();
  $("slabPhoto").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 12 * 1024 * 1024) {
      toast("Фото має бути до 12 МБ.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp"].includes(f.type)) {
      toast("Оберіть PNG, JPG або WEBP.");
      return;
    }
    try {
      const image = await createImageBitmap(f),
        ratio = Math.min(1, 1200 / Math.max(image.width, image.height)),
        c = document.createElement("canvas");
      c.width = Math.round(image.width * ratio);
      c.height = Math.round(image.height * ratio);
      c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
      image.close();
      photo = c;
      points = [];
      calPoints = [];
      pxPerCm = 0;
      photoMode = "edit";
      $("manual").textContent = "Намалювати вручну";
      $("scaleInfo").textContent = "Масштаб не задано";
      $("contourInfo").textContent = "Контур не створено";
      $("photoHint").textContent =
        "Натисніть «Задати масштаб» та позначте два кінці відомої відстані.";
      drawPhoto();
    } catch {
      toast("Не вдалося прочитати зображення. Спробуйте інше фото.");
    }
  };
  function drawPhoto() {
    ctx.clearRect(0, 0, pc.width, pc.height);
    if (!photo) return;
    const s = Math.min(
        (pc.width - 30) / photo.width,
        (pc.height - 35) / photo.height,
      ),
      x = (pc.width - photo.width * s) / 2,
      y = (pc.height - photo.height * s) / 2;
    photoMap = { s, x, y };
    ctx.drawImage(photo, x, y, photo.width * s, photo.height * s);
    if (points.length) {
      ctx.beginPath();
      points.forEach(([a, b], i) =>
        i ? ctx.lineTo(x + a * s, y + b * s) : ctx.moveTo(x + a * s, y + b * s),
      );
      if (photoMode !== "manual") ctx.closePath();
      ctx.fillStyle = "#a5d17333";
      ctx.fill();
      ctx.strokeStyle = "#cef382";
      ctx.lineWidth = 2;
      ctx.stroke();
      for (const [a, b] of points) {
        ctx.beginPath();
        ctx.arc(x + a * s, y + b * s, 3, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#547d27";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    if (calPoints.length) {
      ctx.strokeStyle = "#ec815a";
      ctx.fillStyle = "#ec815a";
      ctx.lineWidth = 2;
      ctx.beginPath();
      calPoints.forEach(([a, b], i) => {
        if (i) ctx.lineTo(x + a * s, y + b * s);
        else ctx.moveTo(x + a * s, y + b * s);
      });
      ctx.stroke();
      for (const [a, b] of calPoints) {
        ctx.beginPath();
        ctx.arc(x + a * s, y + b * s, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  function photoPoint(e) {
    const r = pc.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(
          photo.width,
          (((e.clientX - r.left) * pc.width) / r.width - photoMap.x) /
            photoMap.s,
        ),
      ),
      Math.max(
        0,
        Math.min(
          photo.height,
          (((e.clientY - r.top) * pc.height) / r.height - photoMap.y) /
            photoMap.s,
        ),
      ),
    ];
  }
  function setCalibration() {
    let n = Number($("knownDistance").value);
    if (calPoints.length !== 2 || n <= 0 || !Number.isFinite(n)) return;
    let distance = Math.hypot(
      calPoints[1][0] - calPoints[0][0],
      calPoints[1][1] - calPoints[0][1],
    );
    if (distance < 5) {
      pxPerCm = 0;
      $("scaleInfo").textContent =
        "Точки надто близько. Повторіть калібрування.";
      return;
    }
    pxPerCm = distance / n;
    $("scaleInfo").textContent =
      `Масштаб: ${num(pxPerCm, 3)} пікселів/см · відрізок ${num(n)} см`;
    updateContourInfo();
  }
  $("knownDistance").oninput = setCalibration;
  $("calibrate").onclick = () => {
    if (!photo) {
      toast("Спершу завантажте фото.");
      return;
    }
    calPoints = [];
    pxPerCm = 0;
    photoMode = "calibrate";
    $("scaleInfo").textContent = "Очікується вибір двох точок";
    $("photoHint").textContent =
      "Клацніть на двох кінцях відрізка відомої довжини.";
    drawPhoto();
  };
  $("tolerance").oninput = () =>
    ($("toleranceOut").value = $("tolerance").value);
  $("trace").onclick = () => {
    if (!photo) {
      toast("Спершу завантажте фото.");
      return;
    }
    try {
      const s = Math.min(1, 500 / Math.max(photo.width, photo.height)),
        c = document.createElement("canvas");
      c.width = Math.round(photo.width * s);
      c.height = Math.round(photo.height * s);
      const cx = c.getContext("2d");
      cx.drawImage(photo, 0, 0, c.width, c.height);
      points = Geo.trace(
        cx.getImageData(0, 0, c.width, c.height).data,
        c.width,
        c.height,
        Number($("tolerance").value),
      ).map(([x, y]) => [
        (x * photo.width) / c.width,
        (y * photo.height) / c.height,
      ]);
      photoMode = "edit";
      $("manual").textContent = "Намалювати вручну";
      $("photoHint").textContent =
        "Перевірте контур і за потреби перетягніть вершини. Після зміни допуску натисніть обведення ще раз.";
      drawPhoto();
      updateContourInfo();
    } catch (e) {
      toast(e.message);
    }
  };
  $("manual").onclick = () => {
    if (!photo) {
      toast("Спершу завантажте фото.");
      return;
    }
    if (photoMode === "manual") {
      if (points.length < 3) {
        toast("Позначте принаймні три вершини.");
        return;
      }
      photoMode = "edit";
      $("manual").textContent = "Намалювати вручну";
      $("photoHint").textContent =
        "Контур замкнено. Вершини можна перетягувати.";
      updateContourInfo();
    } else {
      points = [];
      photoMode = "manual";
      $("manual").textContent = "Завершити контур";
      $("photoHint").textContent =
        "Клацайте по краю слеба за порядком, потім натисніть «Завершити контур».";
    }
    drawPhoto();
  };
  function updateContourInfo() {
    if (!points.length) return;
    $("contourInfo").textContent =
      `Контур: ${points.length} вершин` +
      (pxPerCm
        ? ` · ${num((Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0]))) / pxPerCm)} × ${num((Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1]))) / pxPerCm)} см · площа ${num(Geo.area(points) / pxPerCm ** 2 / 10000, 3)} м²`
        : " · задайте масштаб");
  }
  pc.onpointerdown = (e) => {
    if (!photo) return;
    e.preventDefault();
    const p = photoPoint(e);
    if (photoMode === "calibrate") {
      calPoints.push(p);
      if (calPoints.length === 2) {
        setCalibration();
        photoMode = "edit";
        $("photoHint").textContent =
          "Масштаб задано. Обведіть контур автоматично або вручну.";
      }
      drawPhoto();
      return;
    }
    if (photoMode === "manual") {
      points.push(p);
      drawPhoto();
      return;
    }
    let idx = points.findIndex(
      (q) => Math.hypot(p[0] - q[0], p[1] - q[1]) * photoMap.s < 12,
    );
    if (e.altKey && idx >= 0 && points.length > 3) {
      points.splice(idx, 1);
      drawPhoto();
      updateContourInfo();
      return;
    }
    if (e.shiftKey && points.length > 2) {
      let best = Infinity,
        at = 0;
      for (let i = 0; i < points.length; i++) {
        let a = points[i],
          b = points[(i + 1) % points.length],
          dx = b[0] - a[0],
          dy = b[1] - a[1],
          t = Math.max(
            0,
            Math.min(
              1,
              ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) /
                (dx * dx + dy * dy || 1),
            ),
          ),
          dist = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
        if (dist < best) {
          best = dist;
          at = i + 1;
        }
      }
      points.splice(at, 0, p);
      drawPhoto();
      updateContourInfo();
      return;
    }
    if (idx >= 0) {
      activeVertex = idx;
      pc.setPointerCapture(e.pointerId);
    }
  };
  pc.onpointermove = (e) => {
    if (activeVertex < 0 || !photo) return;
    points[activeVertex] = photoPoint(e);
    drawPhoto();
    updateContourInfo();
  };
  pc.onpointerup = pc.onpointercancel = () => (activeVertex = -1);
  $("slabForm").onsubmit = async (e) => {
    e.preventDefault();
    if (!photo || !pxPerCm || calPoints.length !== 2) {
      toast("Завантажте фото та задайте масштаб за двома точками.");
      return;
    }
    if (photoMode === "manual" || !Geo.validPolygon(points)) {
      toast("Завершіть контур без самоперетинів (мінімум 3 вершини).");
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
    const xs = points.map((p) => p[0]),
      ys = points.map((p) => p[1]),
      x = Math.floor(Math.min(...xs)),
      y = Math.floor(Math.min(...ys)),
      w = Math.ceil(Math.max(...xs)) - x,
      h = Math.ceil(Math.max(...ys)) - y;
    if (w < 2 || h < 2) {
      toast("Контур надто малий.");
      return;
    }
    const wcm = w / pxPerCm,
      hcm = h / pxPerCm;
    if (wcm > 1000 || hcm > 1000 || wcm < 1 || hcm < 1) {
      toast("Перевірте масштаб: габарити слеба мають бути в межах 1–1000 см.");
      return;
    }
    const crop = document.createElement("canvas"),
      ratio = Math.min(1, 900 / Math.max(w, h));
    crop.width = Math.round(w * ratio);
    crop.height = Math.round(h * ratio);
    crop
      .getContext("2d")
      .drawImage(photo, x, y, w, h, 0, 0, crop.width, crop.height);
    let photoData = crop.toDataURL("image/jpeg", 0.82);
    if (photoData.length > 480000)
      photoData = crop.toDataURL("image/jpeg", 0.55);
    if (photoData.length > 500000) {
      toast("Фото завелике. Зменште його роздільність.");
      return;
    }
    if (points.length > 128) {
      toast("Контур має понад 128 вершин. Спростіть його вручну.");
      return;
    }
    await bridge.request("POST", "/tables/admin/slabs", {
      number,
      species,
      w: wcm,
      h: hcm,
      t: Number($("slabThickness").value),
      rate: Number($("slabRate").value),
      points: points.map(([a, b]) => [(a - x) / w, (b - y) / h]),
      photo: photoData,
      calibration: {
        distanceCm: Number($("knownDistance").value),
        pixelsPerCm: pxPerCm,
        points: calPoints,
        sourceWidth: photo.width,
        sourceHeight: photo.height,
      },
    });
    await reloadRemote();
    $("slabDialog").close();
    renderInventory();
    speciesOptions();
    renderLibrary();
    toast("Слеб із масштабом та контуром збережено на сервері.");
  };
  window.addEventListener("unhandledrejection", (e) => {
    e.preventDefault();
    toast(e.reason?.message || "Не вдалося виконати дію.");
  });
  if (new URLSearchParams(location.search).get("host") === "studio")
    $$('[data-view="builder"],[data-view="cart"]').forEach(
      (e) => (e.hidden = true),
    );
  if (!admin) {
    $$(
      '[data-view="inventory"],[data-view="costs"],[data-view="orders"],.admin-label',
    ).forEach((e) => (e.hidden = true));
  }
  $("exportData").hidden = !admin;
  speciesOptions();
  syncDimensions();
  renderLibrary();
  renderDesign();
  renderOrders();
  view(location.hash.slice(1) || (admin ? "inventory" : "builder"));
})().catch((e) => {
  document.querySelector("main").innerHTML =
    '<div class="panel" style="margin:40px"><h1>Сервіс тимчасово недоступний</h1><p id="bootError"></p><button onclick="location.reload()">Повторити</button></div>';
  document.getElementById("bootError").textContent = e.message;
});

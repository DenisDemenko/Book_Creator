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
    quotePending = false,
    texturePending = false,
    designRevision = 0,
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
      (!inventory && name === "inventory") ||
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
    designRevision++;
    estimate = null;
    $("approvePrice").checked = false;
    $("approveLabel").hidden = true;
    $("addCart").hidden = true;
    $("calculate").hidden = false;
    $("estimate").innerHTML =
      '<p class="muted">Композицію змінено. Розрахуйте актуальну вартість.</p>';
    $("designWarning").textContent = "";
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
    return valid;
  }
  function readDimensions(event) {
    // Incomplete keyboard input stays in the field. Never restore an old value
    // while the customer is clearing or typing a replacement dimension.
    invalidate();
    if (!dimensionsValid(event?.type !== "input")) return false;
    const l = $("tableL").valueAsNumber,
      w = design.shape === "oval" ? $("tableW").valueAsNumber : l,
      t = $("tableT").valueAsNumber;
    Object.assign(design, { l, w, t });
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
    $("resinTextureFile").value = "";
    $("uploadResinTexture").disabled = false;
    $("resinTextureStatus").textContent =
      "PNG, JPG або WEBP · до 35 МБ · автоматичне стиснення";
    $("resinTextureProcessing").hidden = true;
    syncResinTexture();
  }
  $("uploadResinTexture").onclick = () => $("resinTextureFile").click();
  $("resinTextureFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
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
        event.target.value = "";
      }
    }
  };
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
              `<article class="slab-card"><img class="preset-catalog-image" src="${esc(t.image)}" alt="${esc(t.name)}" /><div class="slab-content"><h3>${esc(t.name)}</h3><button type="button" class="text-btn danger" data-delete-texture="${t.id}">Видалити з каталогу</button></div></article>`,
          )
          .join("")
      : '<p class="hint">Ще немає готових текстур. Завантажте перше зображення.</p>';
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
  window.addEventListener("unhandledrejection", (e) => {
    e.preventDefault();
    toast(e.reason?.message || "Не вдалося виконати дію.");
  });
  if (new URLSearchParams(location.search).get("host") === "studio")
    $$('[data-view="builder"],[data-view="cart"]').forEach(
      (e) => (e.hidden = true),
    );
  if (!inventory)
    $$('[data-view="inventory"],.admin-label').forEach(
      (e) => (e.hidden = true),
    );
  if (!admin)
    $$(
      '[data-view="costs"],[data-view="orders"],[data-view="textures"]',
    ).forEach((e) => (e.hidden = true));
  $("exportData").hidden = !admin;
  speciesOptions();
  renderPresetChoices();
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

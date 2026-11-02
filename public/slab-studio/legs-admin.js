/* Admin: everything the wooden bases are made of.
 *
 *   materials, prices, plate thickness   — the administrator only
 *   mounting plates and their four holes — the administrator and the furniture designer
 *   legs drawn as SVG files              — the administrator and the furniture designer
 *
 * The page works through the bridge (env.bridge): the host decides who may do
 * what, the API checks it again.
 */
(function (root) {
  "use strict";

  function create(env) {
    const { $, esc, num, bridge, toast } = env;
    const TL = root.TableLegs;
    const legs = () => env.legs();
    let draft = null; // the SVG being uploaded: { svg, fill, name }

    const slug = (name) =>
      (name || "")
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 30);

    // ----------------------------------------------------------- settings
    function materialRow(m, i) {
      return `<div class="leg-row" data-material-row="${i}">
        <label>Назва<input data-m="name" value="${esc(m.name)}" maxlength="60" /></label>
        <label>Ціна, грн / м³<input data-m="pricePerM3" type="number" min="0" step="100" value="${esc(m.pricePerM3)}" /></label>
        <label>Колір у 3D<input data-m="color" type="color" value="${esc(m.color)}" /></label>
        <button type="button" class="text-btn danger" data-remove-material="${i}" aria-label="Видалити матеріал">×</button>
      </div>`;
    }
    let materials = [];
    function renderSettings() {
      const l = legs();
      const form = $("legSettingsForm");
      form.hidden = !env.admin;
      if (!env.admin) return;
      materials = materials.length && form.dataset.touched ? materials : l.settings.materials.map((m) => ({ ...m }));
      $("legMaterialRows").innerHTML = materials.map(materialRow).join("");
      $("legPlateThickness").value = l.settings.plateThicknessCm;
      $("legPlatePrice").value = l.settings.plateWoodPerM3;
      $("legWork").value = l.settings.workPerMount;
      $("legSettingsStatus").textContent = l.configured
        ? `Збережено (версія ${l.version}).`
        : "Показано демо-значення: орієнтовні ціни сухих пиломатеріалів в Україні (листопад 2026). Покупці вже можуть вибирати ніжки за цими цінами. Виправте на свої й натисніть «Зберегти» — тоді це будуть ваші ціни.";
      $$all("[data-m]").forEach((input) => {
        input.oninput = () => {
          const row = Number(input.closest("[data-material-row]").dataset.materialRow);
          materials[row][input.dataset.m] = input.dataset.m === "pricePerM3" ? Number(input.value) : input.value;
          form.dataset.touched = "1";
        };
      });
      $$all("[data-remove-material]").forEach((b) => {
        b.onclick = () => {
          if (materials.length < 2) return toast("Потрібен принаймні один матеріал.");
          materials.splice(Number(b.dataset.removeMaterial), 1);
          form.dataset.touched = "1";
          renderSettings();
        };
      });
    }
    const $$all = (s) => [...document.querySelectorAll(s)];

    function bindSettings() {
      $("legAddMaterial").onclick = () => {
        materials.push({ id: "", name: "Нове дерево", pricePerM3: 50000, color: "#b88a56" });
        $("legSettingsForm").dataset.touched = "1";
        renderSettings();
      };
      $("legSettingsForm").onsubmit = async (event) => {
        event.preventDefault();
        const used = new Set();
        const list = materials.map((m) => {
          let id = m.id || slug(m.name) || "wood";
          while (used.has(id)) id += "-2";
          used.add(id);
          return { id, name: m.name.trim(), pricePerM3: Number(m.pricePerM3), color: m.color };
        });
        if (list.some((m) => !m.name || !Number.isFinite(m.pricePerM3) || m.pricePerM3 < 0))
          return toast("Вкажіть назву й ціну кожного матеріалу.");
        try {
          await bridge.request("PUT", "/tables/admin/leg-settings", {
            expectedVersion: legs().version,
            data: {
              materials: list,
              plateThicknessCm: Number($("legPlateThickness").value),
              plateWoodPerM3: Number($("legPlatePrice").value),
              workPerMount: Number($("legWork").value),
              hiddenSchemes: legs().settings.hiddenSchemes || [],
            },
          });
          delete $("legSettingsForm").dataset.touched;
          materials = [];
          await env.reload();
          toast("Налаштування ніжок збережено.");
        } catch (error) {
          toast(error.message);
        }
      };
    }

    // ------------------------------------------- the built-in layouts
    function schemeCard(m, hidden) {
      const range = (a, b, unit) => `${num(a, 0)}–${num(b, 0)} ${unit}`;
      return `<article class="slab-card" data-builtin="${esc(m.id)}"><div class="leg-plate-preview">${env.mini(m)}</div><div class="slab-content">
        <b>${esc(m.name)}</b>
        <p class="hint">${esc(m.note)}. Висота столу ${range(m.minHeight, m.maxHeight, "см")}, товщина ніжок ${range(m.minThickness, m.maxThickness, "см")}.</p>
        <label class="check"><input type="checkbox" data-scheme-on ${hidden ? "" : "checked"} ${env.admin ? "" : "disabled"} /> Показувати покупцям</label>
      </div></article>`;
    }
    function renderSchemes() {
      const hidden = legs().settings.hiddenSchemes || [];
      $("legBuiltinList").innerHTML = TL.SCHEMES.map((m) => schemeCard(m, hidden.includes(m.id))).join("");
      $("legBuiltinSave").hidden = !env.admin;
    }
    function bindSchemes() {
      $("legBuiltinSave").onclick = async () => {
        if (!legs().configured) return toast("Спершу збережіть матеріали й ціни ніжок.");
        const off = $$all("[data-builtin]")
          .filter((card) => !card.querySelector("[data-scheme-on]").checked)
          .map((card) => card.dataset.builtin);
        const { materials, plateThicknessCm, plateWoodPerM3, workPerMount } = legs().settings;
        try {
          await bridge.request("PUT", "/tables/admin/leg-settings", {
            expectedVersion: legs().version,
            data: { materials, plateThicknessCm, plateWoodPerM3, workPerMount, hiddenSchemes: off },
          });
          await env.reload();
          toast(off.length ? `Покупці не бачать схем: ${off.length}.` : "Усі схеми показано покупцям.");
        } catch (error) {
          toast(error.message);
        }
      };
    }

    // -------------------------------------------------------------- plates
    function plateCard(p) {
      const spec = { widthCm: p.widthCm, depthCm: p.depthCm, holeDiameterMm: p.holeDiameterMm, holeInsetMm: p.holeInsetMm };
      const plate = TL.plates([{ x: 0, y: 0, a: 1, b: 1 }], spec, legs().settings.plateThicknessCm, 0)[0];
      const fs = Math.max(1.4, Math.min(plate.w, plate.d) / 12);
      const holes = plate.holes
        .map((h) => `<circle cx="${h.x}" cy="${h.y}" r="${h.diameterMm / 20}" fill="#fff" stroke="#6b5238" stroke-width=".25"/>`)
        .join("");
      const preview = `<svg viewBox="${-plate.w / 2 - fs} ${-plate.d / 2 - fs} ${plate.w + fs * 2} ${plate.d + fs * 2}" aria-hidden="true"><rect x="${-plate.w / 2}" y="${-plate.d / 2}" width="${plate.w}" height="${plate.d}" fill="#d6b98a" stroke="#6b5238" stroke-width=".3"/>${holes}</svg>`;
      const builtin = p.id === "standard" && !legs().plates.some((x) => x.id !== "standard");
      const outOfRange = [p.widthCm, p.depthCm].some((v) => v < TL.PLATE_MIN_CM || v > TL.PLATE_MAX_CM);
      return `<article class="slab-card" data-plate="${esc(p.id)}"><div class="leg-plate-preview">${preview}</div><div class="slab-content">
        ${outOfRange ? '<p class="warning">Розмір поза межами 50–300 мм: у розрахунку й на кресленні замість нього береться 150 мм. Виправте й збережіть.</p>' : ""}
        <label class="texture-name"><span>Назва</span><input data-p="name" value="${esc(p.name)}" maxlength="80" ${builtin ? "disabled" : ""} /></label>
        <div class="leg-fields">
          <label>Ширина, мм<input data-p="widthCm" data-mm type="number" step="5" min="50" max="300" value="${esc(Math.round(p.widthCm * 10))}" ${builtin ? "disabled" : ""} /></label>
          <label>Глибина, мм<input data-p="depthCm" data-mm type="number" step="5" min="50" max="300" value="${esc(Math.round(p.depthCm * 10))}" ${builtin ? "disabled" : ""} /></label>
          <label>Отвір Ø, мм<input data-p="holeDiameterMm" type="number" step="0.5" min="2" max="25" value="${esc(p.holeDiameterMm)}" ${builtin ? "disabled" : ""} /></label>
          <p class="hint">Чотири отвори в кутах: ${plate.holeInsetMm} мм від краю — автоматично (10–20 мм).</p>
        </div>
        <label class="check"><input data-p="countersink" type="checkbox" ${p.countersink ? "checked" : ""} ${builtin ? "disabled" : ""}/> Зенківка під шуруп</label>
        <label class="check"><input data-p="isDefault" type="checkbox" ${p.isDefault ? "checked" : ""} ${builtin ? "disabled" : ""}/> Основна пластина</label>
        ${builtin ? '<p class="hint">Вбудована. Додайте свою — вона замінить цю.</p>' : `<div class="texture-actions"><button type="button" class="secondary" data-save-plate="${esc(p.id)}">Зберегти</button><button type="button" class="text-btn danger" data-delete-plate="${esc(p.id)}">Видалити</button></div>`}
      </div></article>`;
    }
    function readFields(scope) {
      const out = {};
      scope.querySelectorAll("[data-p]").forEach((el) => {
        // Sizes are typed in millimetres and stored in centimetres.
        out[el.dataset.p] = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.dataset.mm ? Number(el.value) / 10 : Number(el.value)) : el.value.trim();
      });
      return out;
    }
    function renderPlates() {
      $("legPlateList").innerHTML = legs().plates.map(plateCard).join("");
      $$all("[data-save-plate]").forEach((b) => {
        b.onclick = async () => {
          const card = b.closest("[data-plate]");
          try {
            await bridge.request("PATCH", "/tables/admin/leg-plates/" + b.dataset.savePlate, readFields(card));
            await env.reload();
            toast("Пластину збережено.");
          } catch (error) {
            toast(error.message);
          }
        };
      });
      $$all("[data-delete-plate]").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("Видалити пластину? Існуючі замовлення зберігають свій варіант.")) return;
          try {
            await bridge.request("DELETE", "/tables/admin/leg-plates/" + b.dataset.deletePlate);
            await env.reload();
          } catch (error) {
            toast(error.message);
          }
        };
      });
    }
    function bindPlateForm() {
      $("legPlateForm").onsubmit = async (event) => {
        event.preventDefault();
        const body = readFields($("legPlateForm"));
        try {
          await bridge.request("POST", "/tables/admin/leg-plates", body);
          $("legPlateForm").reset();
          await env.reload();
          toast("Пластину додано.");
        } catch (error) {
          toast(error.message);
        }
      };
    }

    // ---------------------------------------------------------- SVG legs
    // The share of the file's bounding box that is wood: the SVG is drawn on a
    // canvas and its opaque pixels are counted.
    async function measureSvg(text) {
      const doc = new DOMParser().parseFromString(text, "image/svg+xml");
      const svg = doc.documentElement;
      if (svg.nodeName !== "svg" || doc.querySelector("parsererror"))
        throw new Error("Це не схоже на SVG-файл.");
      const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
      if (vb.length !== 4 || !(vb[2] > 0) || !(vb[3] > 0))
        throw new Error("У SVG потрібен viewBox: він задає габарит ніжки.");
      const w = 200,
        h = Math.max(20, Math.min(1200, Math.round((200 * vb[3]) / vb[2])));
      svg.setAttribute("width", w);
      svg.setAttribute("height", h);
      svg.setAttribute("preserveAspectRatio", "none");
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(svg));
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error("Браузер не зміг відкрити цей SVG."));
        image.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(image, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      let on = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 40) on++;
      return on / (w * h);
    }
    const placements = { corners: "4 ніжки по кутах", ends: "2 опори по торцях", center: "1 центральна" };

    function legCard(d) {
      return `<article class="slab-card" data-leg="${esc(d.id)}"><div class="leg-plate-preview"><img alt="${esc(d.name)}" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(d.svg)}" /></div><div class="slab-content">
        <label class="texture-name"><span>Назва</span><input data-d="name" value="${esc(d.name)}" maxlength="80" /></label>
        <label class="texture-name"><span>Розміщення</span><select data-d="placement">${Object.entries(placements).map(([k, v]) => `<option value="${k}" ${k === d.placement ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <div class="leg-fields">
          <label>Висота від, см<input data-d="minHeightCm" type="number" step="1" value="${esc(d.minHeightCm)}" /></label>
          <label>Висота до, см<input data-d="maxHeightCm" type="number" step="1" value="${esc(d.maxHeightCm)}" /></label>
          <label>Товщина від, см<input data-d="minThicknessCm" type="number" step="0.5" value="${esc(d.minThicknessCm)}" /></label>
          <label>Товщина до, см<input data-d="maxThicknessCm" type="number" step="0.5" value="${esc(d.maxThicknessCm)}" /></label>
          <label>Типова товщина, см<input data-d="defaultThicknessCm" type="number" step="0.5" value="${esc(d.defaultThicknessCm)}" /></label>
        </div>
        <p class="hint">Заповнення силуету: ${num(d.fill * 100, 0)}% габариту (за ним рахується об’єм дерева).</p>
        <div class="texture-actions"><button type="button" class="secondary" data-save-leg="${esc(d.id)}">Зберегти</button><button type="button" class="secondary" data-replace-leg="${esc(d.id)}">Замінити SVG</button><input type="file" accept=".svg,image/svg+xml" hidden data-leg-file="${esc(d.id)}" /><button type="button" class="text-btn danger" data-delete-leg="${esc(d.id)}">Видалити</button></div>
      </div></article>`;
    }
    function readLeg(card) {
      const out = {};
      card.querySelectorAll("[data-d]").forEach((el) => {
        out[el.dataset.d] = el.type === "number" ? Number(el.value) : el.value.trim();
      });
      return out;
    }
    function renderLegs() {
      const list = legs().designs;
      $("legDesignList").innerHTML = list.length ? list.map(legCard).join("") : '<p class="hint">Ще немає власних ніжок. Завантажте перший SVG.</p>';
      $$all("[data-save-leg]").forEach((b) => {
        b.onclick = async () => {
          try {
            await bridge.request("PATCH", "/tables/admin/leg-designs/" + b.dataset.saveLeg, readLeg(b.closest("[data-leg]")));
            await env.reload();
            toast("Ніжку збережено.");
          } catch (error) {
            toast(error.message);
          }
        };
      });
      $$all("[data-delete-leg]").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("Видалити ніжку з каталогу? Існуючі замовлення зберігають свій варіант.")) return;
          try {
            await bridge.request("DELETE", "/tables/admin/leg-designs/" + b.dataset.deleteLeg);
            await env.reload();
          } catch (error) {
            toast(error.message);
          }
        };
      });
      $$all("[data-replace-leg]").forEach((b) => {
        b.onclick = () => $$all("[data-leg-file]").find((i) => i.dataset.legFile === b.dataset.replaceLeg).click();
      });
      $$all("[data-leg-file]").forEach((input) => {
        input.onchange = async () => {
          const file = input.files[0];
          input.value = "";
          if (!file) return;
          try {
            const svg = await file.text();
            const fill = await measureSvg(svg);
            await bridge.request("PATCH", "/tables/admin/leg-designs/" + input.dataset.legFile, { svg, fill });
            await env.reload();
            toast("SVG замінено.");
          } catch (error) {
            toast(error.message);
          }
        };
      });
    }
    function bindUpload() {
      $("legSvgChoose").onclick = () => $("legSvgFile").click();
      $("legSvgFile").onchange = async (event) => {
        const file = event.target.files[0];
        event.target.value = "";
        if (!file) return;
        $("legSvgStatus").textContent = "Перевіряємо файл…";
        try {
          if (file.size > 80000) throw new Error("SVG завеликий: до 80 КБ. Спростіть контури.");
          const svg = await file.text();
          const fill = await measureSvg(svg);
          draft = { svg, fill };
          $("legSvgPreview").src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
          $("legSvgPreview").hidden = false;
          if (!$("legSvgName").value.trim()) $("legSvgName").value = file.name.replace(/\.svg$/i, "");
          $("legSvgStatus").textContent = `Файл прочитано. Заповнення силуету ${num(fill * 100, 0)}% габариту (viewBox).`;
          $("legSvgSave").disabled = false;
        } catch (error) {
          draft = null;
          $("legSvgSave").disabled = true;
          $("legSvgStatus").textContent = error.message;
        }
      };
      $("legSvgForm").onsubmit = async (event) => {
        event.preventDefault();
        if (!draft) return;
        const f = (id) => Number($(id).value);
        try {
          await bridge.request("POST", "/tables/admin/leg-designs", {
            name: $("legSvgName").value.trim(),
            svg: draft.svg,
            fill: draft.fill,
            placement: $("legSvgPlacement").value,
            minHeightCm: f("legSvgMinH"),
            maxHeightCm: f("legSvgMaxH"),
            minThicknessCm: f("legSvgMinT"),
            maxThicknessCm: f("legSvgMaxT"),
            defaultThicknessCm: f("legSvgDefT"),
          });
          draft = null;
          $("legSvgForm").reset();
          $("legSvgPreview").hidden = true;
          $("legSvgSave").disabled = true;
          $("legSvgStatus").textContent = "Ніжку додано. Покупці бачать її серед схем.";
          await env.reload();
        } catch (error) {
          $("legSvgStatus").textContent = error.message;
        }
      };
    }

    bindSettings();
    bindSchemes();
    bindPlateForm();
    bindUpload();
    return {
      render() {
        if (!legs()?.available) {
          $("legCatalogOff").hidden = false;
          return;
        }
        $("legCatalogOff").hidden = true;
        renderSettings();
        renderSchemes();
        renderPlates();
        renderLegs();
      },
    };
  }

  root.LegsAdmin = { create };
})(typeof window !== "undefined" ? window : globalThis);

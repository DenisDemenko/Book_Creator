/* One image coordinate system -> calibrated centimetres -> CAD millimetres. */
(function (root) {
  "use strict";
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const bounds = (p) => {
    const xs = p.map((q) => q[0]),
      ys = p.map((q) => q[1]);
    const x = Math.min(...xs),
      y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  };
  function scale(points, cm) {
    if (
      points.length !== 2 ||
      !Number.isFinite(cm) ||
      cm <= 0 ||
      cm > 1000 ||
      distance(...points) < 5
    )
      return 0;
    return distance(...points) / cm;
  }
  function physical(points, pxPerCm) {
    if (
      !Number.isFinite(pxPerCm) ||
      pxPerCm <= 0 ||
      !root.Geo.validPolygon(points)
    )
      throw Error("Потрібен масштаб і коректний замкнутий контур.");
    const b = bounds(points);
    return {
      ...b,
      wcm: b.w / pxPerCm,
      hcm: b.h / pxPerCm,
      points: points.map(([x, y]) => [(x - b.x) / b.w, (y - b.y) / b.h]),
    };
  }
  function outline(s) {
    if (
      !Number.isFinite(s.w) ||
      !Number.isFinite(s.h) ||
      s.w <= 0 ||
      s.h <= 0 ||
      !root.Geo.validPolygon(s.points)
    )
      throw Error("Некоректний контур для експорту.");
    return s.points.map(([x, y]) => [x * s.w * 10, y * s.h * 10]);
  }
  const n = (x) => String(Math.round(x * 1000000) / 1000000);
  function svg(s) {
    const points = outline(s),
      w = s.w * 10,
      h = s.h * 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${n(w)}mm" height="${n(h)}mm" viewBox="0 0 ${n(w)} ${n(h)}"><title>Slab outline, millimetres, 1:1</title><polygon id="slab-outline" points="${points.map((p) => p.map(n).join(",")).join(" ")}" fill="none" stroke="black" stroke-width="0.1"/></svg>`;
  }
  // ASCII DXF AutoCAD 2000 (AC1015), planar closed LWPOLYLINE, $INSUNITS=4 (mm).
  function dxf(s) {
    const p = outline(s),
      w = s.w * 10,
      h = s.h * 10,
      lines = [];
    const pair = (...xs) => lines.push(...xs.map(String));
    pair(
      0,
      "SECTION",
      2,
      "HEADER",
      9,
      "$ACADVER",
      1,
      "AC1015",
      9,
      "$INSUNITS",
      70,
      4,
      9,
      "$MEASUREMENT",
      70,
      1,
      9,
      "$LUNITS",
      70,
      2,
      9,
      "$INSBASE",
      10,
      0,
      20,
      0,
      30,
      0,
      9,
      "$EXTMIN",
      10,
      0,
      20,
      0,
      30,
      0,
      9,
      "$EXTMAX",
      10,
      n(w),
      20,
      n(h),
      30,
      0,
      0,
      "ENDSEC",
    );
    pair(
      0,
      "SECTION",
      2,
      "TABLES",
      0,
      "TABLE",
      2,
      "LTYPE",
      5,
      "2",
      100,
      "AcDbSymbolTable",
      70,
      1,
      0,
      "LTYPE",
      5,
      "10",
      330,
      "2",
      100,
      "AcDbSymbolTableRecord",
      100,
      "AcDbLinetypeTableRecord",
      2,
      "CONTINUOUS",
      70,
      0,
      3,
      "Solid line",
      72,
      65,
      73,
      0,
      40,
      0,
      0,
      "ENDTAB",
    );
    pair(0, "TABLE", 2, "LAYER", 5, "3", 100, "AcDbSymbolTable", 70, 2);
    for (const [name, handle] of [
      ["0", "11"],
      ["SLAB_OUTLINE", "12"],
    ])
      pair(
        0,
        "LAYER",
        5,
        handle,
        330,
        "3",
        100,
        "AcDbSymbolTableRecord",
        100,
        "AcDbLayerTableRecord",
        2,
        name,
        70,
        0,
        62,
        7,
        6,
        "CONTINUOUS",
      );
    pair(
      0,
      "ENDTAB",
      0,
      "TABLE",
      2,
      "BLOCK_RECORD",
      5,
      "4",
      100,
      "AcDbSymbolTable",
      70,
      2,
    );
    for (const [name, handle] of [
      ["*Model_Space", "1F"],
      ["*Paper_Space", "20"],
    ])
      pair(
        0,
        "BLOCK_RECORD",
        5,
        handle,
        330,
        "4",
        100,
        "AcDbSymbolTableRecord",
        100,
        "AcDbBlockTableRecord",
        2,
        name,
      );
    pair(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "BLOCKS");
    for (const [name, owner, a, b] of [
      ["*Model_Space", "1F", "21", "22"],
      ["*Paper_Space", "20", "23", "24"],
    ])
      pair(
        0,
        "BLOCK",
        5,
        a,
        330,
        owner,
        100,
        "AcDbEntity",
        8,
        "0",
        100,
        "AcDbBlockBegin",
        2,
        name,
        70,
        0,
        10,
        0,
        20,
        0,
        30,
        0,
        3,
        name,
        1,
        "",
        0,
        "ENDBLK",
        5,
        b,
        330,
        owner,
        100,
        "AcDbEntity",
        8,
        "0",
        100,
        "AcDbBlockEnd",
      );
    pair(
      0,
      "ENDSEC",
      0,
      "SECTION",
      2,
      "ENTITIES",
      0,
      "LWPOLYLINE",
      5,
      "50",
      330,
      "1F",
      100,
      "AcDbEntity",
      8,
      "SLAB_OUTLINE",
      100,
      "AcDbPolyline",
      90,
      p.length,
      70,
      1,
      38,
      0,
    );
    for (const [x, y] of p) pair(10, n(x), 20, n(h - y));
    pair(0, "ENDSEC", 0, "EOF");
    return lines.join("\r\n") + "\r\n";
  }
  class Editor {
    constructor({ toast, maxPoints = 128 }) {
      this.$ = (id) => document.getElementById(id);
      this.toast = toast;
      this.maxPoints = Math.min(512, maxPoints);
      this.canvas = this.$("photoCanvas");
      this.ctx = this.canvas.getContext("2d");
      this.revision = 0;
      this.reset();
      this.$("slabPhoto").onchange = (e) => this.load(e.target.files[0]);
      this.$("calibrate").onclick = () => this.tool("calibrate");
      this.$("manual").onclick = () => this.tool("freehand");
      this.$("pointContour").onclick = () => this.tool("points");
      this.$("panPhoto").onclick = () => this.tool("pan");
      this.$("editRuler").onclick = () => this.tool("ruler");
      this.$("editContour").onclick = () => this.tool("edit");
      this.$("trace").onclick = () => this.auto();
      this.$("closeContour").onclick = () => this.finish();
      this.$("undoContour").onclick = () => {
        this.points.pop();
        this.closed = false;
        this.changed();
      };
      this.$("clearContour").onclick = () => {
        this.points = [];
        this.closed = false;
        this.changed();
      };
      this.$("knownDistance").oninput = () => {
        this.px = scale(this.ruler, Number(this.$("knownDistance").value));
        this.changed();
      };
      this.$("photoZoom").oninput = () => {
        this.zoom = Number(this.$("photoZoom").value);
        this.draw();
      };
      this.$("resetPhotoView").onclick = () => {
        this.zoom = 1;
        this.center = this.photo
          ? [this.photo.width / 2, this.photo.height / 2]
          : [0, 0];
        this.draw();
      };
      this.$("tolerance").oninput = () =>
        (this.$("toleranceOut").value = this.$("tolerance").value);
      this.$("contourVerified").onchange = () => this.status();
      for (const format of ["svg", "dxf"])
        this.$("exportContour" + format.toUpperCase()).onclick = () => {
          try {
            const s = this.value(false);
            this.download(format, s);
          } catch (e) {
            this.toast(e.message);
          }
        };
      this.canvas.onpointerdown = (e) => this.down(e);
      this.canvas.onpointermove = (e) => this.move(e);
      this.canvas.onpointerup = (e) => this.up(e);
      this.canvas.onpointercancel = (e) => this.up(e, true);
      this.observer = new ResizeObserver(() => this.draw());
      this.observer.observe(this.canvas);
    }
    reset() {
      this.revision++;
      this.photo = null;
      this.points = [];
      this.ruler = [];
      this.px = 0;
      this.mode = "edit";
      this.closed = false;
      this.zoom = 1;
      this.center = [0, 0];
      this.gesture = null;
      this.$("slabPhoto").value = "";
      this.$("photoZoom").value = "1";
      this.$("contourVerified").checked = false;
      this.hint(
        "Фото строго зверху. Рівномірний масштаб не усуває перспективу.",
      );
      this.draw();
      this.status();
    }
    hint(s) {
      this.$("photoHint").textContent = s;
    }
    changed() {
      this.$("contourVerified").checked = false;
      this.draw();
      this.status();
    }
    async load(file) {
      if (!file) return;
      const revision = ++this.revision;
      if (
        file.size > 12 * 1024 * 1024 ||
        !["image/png", "image/jpeg", "image/webp"].includes(file.type)
      ) {
        this.toast("Оберіть PNG, JPG або WEBP до 12 МБ.");
        return;
      }
      try {
        const image = await createImageBitmap(file);
        if (revision !== this.revision) {
          image.close();
          return;
        }
        if (image.width * image.height > 80000000) {
          image.close();
          throw Error("Зменште роздільність фото.");
        }
        const ratio = Math.min(1, 2400 / Math.max(image.width, image.height)),
          c = document.createElement("canvas");
        c.width = Math.round(image.width * ratio);
        c.height = Math.round(image.height * ratio);
        c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
        image.close();
        this.photo = c;
        this.points = [];
        this.ruler = [];
        this.px = 0;
        this.closed = false;
        this.mode = "edit";
        this.zoom = 1;
        this.center = [c.width / 2, c.height / 2];
        this.hint(
          "Введіть реальну відстань і позначте її два кінці на фото. Потім обведіть лише дерево.",
        );
        this.changed();
      } catch (e) {
        this.toast(e.message || "Не вдалося прочитати фото.");
      }
    }
    tool(mode) {
      if (!this.photo) {
        this.toast("Спершу завантажте фото.");
        return;
      }
      if (this.gesture) return;
      this.mode = mode;
      if (mode === "calibrate") {
        this.ruler = [];
        this.px = 0;
        this.hint(
          "Позначте два кінці відстані, яку ви виміряли на реальному слебі або лінійці.",
        );
      }
      if (["freehand", "points"].includes(mode)) {
        if (this.closed) {
          this.points = [];
          this.closed = false;
        }
        this.hint(
          mode === "freehand"
            ? "Тримайте мишку або стилус і ведіть по краю. Поверніться до початкової точки, щоб замкнути контур."
            : "Ставте точки по краю. Натисніть першу точку або «Замкнути контур».",
        );
      }
      if (mode === "edit")
        this.hint(
          "Перетягуйте вершини. Shift + клік — додати точку; Alt + клік — видалити.",
        );
      if (mode === "pan")
        this.hint(
          "Перетягніть фото для огляду. Далі поверніться до обведення або редагування.",
        );
      if (["calibrate", "freehand", "points"].includes(mode)) this.changed();
      else {
        this.draw();
        this.status();
      }
    }
    draw() {
      const c = this.canvas,
        r = c.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 2);
      if (r.width > 0 && r.height > 0) {
        const w = Math.round(r.width * dpr),
          h = Math.round(r.height * dpr);
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
      }
      const ctx = this.ctx;
      ctx.clearRect(0, 0, c.width, c.height);
      this.$("photoZoom").value = String(this.zoom);
      for (const [id, mode] of [
        ["manual", "freehand"],
        ["pointContour", "points"],
        ["panPhoto", "pan"],
        ["editContour", "edit"],
        ["calibrate", "calibrate"],
        ["editRuler", "ruler"],
      ])
        this.$(id).setAttribute("aria-pressed", String(this.mode === mode));
      if (!this.photo) return;
      const fit = Math.min(
          (c.width - 32 * dpr) / this.photo.width,
          (c.height - 40 * dpr) / this.photo.height,
        ),
        s = fit * this.zoom;
      const x = c.width / 2 - this.center[0] * s,
        y = c.height / 2 - this.center[1] * s;
      this.map = { s, x, y };
      ctx.drawImage(
        this.photo,
        x,
        y,
        this.photo.width * s,
        this.photo.height * s,
      );
      const at = (p) => [x + p[0] * s, y + p[1] * s];
      if (this.points.length) {
        ctx.beginPath();
        this.points.forEach((p, i) => {
          const q = at(p);
          i ? ctx.lineTo(...q) : ctx.moveTo(...q);
        });
        if (this.closed) {
          ctx.closePath();
          ctx.fillStyle = "#8cd35530";
          ctx.fill();
        }
        ctx.strokeStyle = this.closed ? "#a3ed62" : "#ffb02e";
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        const step =
          this.points.length > 600 ? Math.ceil(this.points.length / 300) : 1;
        this.points.forEach((p, i) => {
          if (i % step && i !== this.points.length - 1) return;
          ctx.beginPath();
          ctx.arc(...at(p), (i === 0 ? 6 : 3) * dpr, 0, 2 * Math.PI);
          ctx.fillStyle = i === 0 ? "#ffb02e" : "white";
          ctx.fill();
          ctx.strokeStyle = "#334522";
          ctx.lineWidth = dpr;
          ctx.stroke();
        });
      }
      if (this.ruler.length) {
        ctx.beginPath();
        this.ruler.forEach((p, i) =>
          i ? ctx.lineTo(...at(p)) : ctx.moveTo(...at(p)),
        );
        ctx.strokeStyle = "#ee7048";
        ctx.lineWidth = 2 * dpr;
        ctx.stroke();
        for (const p of this.ruler) {
          ctx.beginPath();
          ctx.arc(...at(p), 6 * dpr, 0, 2 * Math.PI);
          ctx.fillStyle = "#ee7048";
          ctx.fill();
        }
        if (this.ruler.length === 2) {
          const a = at(this.ruler[0]),
            b = at(this.ruler[1]);
          ctx.font = `${12 * dpr}px Arial`;
          ctx.textAlign = "center";
          ctx.fillStyle = "white";
          ctx.strokeStyle = "#332219";
          ctx.lineWidth = 4 * dpr;
          const text = Number(this.$("knownDistance").value) + " см";
          const tx = (a[0] + b[0]) / 2,
            ty = (a[1] + b[1]) / 2 - 12 * dpr;
          ctx.strokeText(text, tx, ty);
          ctx.fillText(text, tx, ty);
        }
      }
    }
    point(e) {
      const r = this.canvas.getBoundingClientRect(),
        m = this.map;
      return [
        Math.max(
          0,
          Math.min(
            this.photo.width,
            (((e.clientX - r.left) * this.canvas.width) / r.width - m.x) / m.s,
          ),
        ),
        Math.max(
          0,
          Math.min(
            this.photo.height,
            (((e.clientY - r.top) * this.canvas.height) / r.height - m.y) / m.s,
          ),
        ),
      ];
    }
    near(a, b) {
      return (
        (distance(a, b) *
          this.map.s *
          this.canvas.getBoundingClientRect().width) /
          this.canvas.width <
        14
      );
    }
    down(e) {
      if (
        !this.photo ||
        this.gesture ||
        e.button > 0 ||
        (e.pointerType === "touch" && !e.isPrimary)
      )
        return;
      e.preventDefault();
      const p = this.point(e);
      if (this.mode === "calibrate") {
        this.ruler.push(p);
        if (this.ruler.length === 2) {
          this.px = scale(this.ruler, Number(this.$("knownDistance").value));
          this.mode = "edit";
          this.hint(
            "Масштаб задано. Кінці лінійки можна перетягувати. Обведіть контур.",
          );
        }
        this.changed();
        return;
      }
      if (this.mode === "points") {
        if (this.closed) {
          this.closed = false;
          this.points = [];
        }
        if (this.points.length >= 3 && this.near(p, this.points[0])) {
          this.finish();
          return;
        }
        if (!this.points.length || !this.near(p, this.points.at(-1)))
          this.points.push(p);
        this.changed();
        return;
      }
      let type, index;
      if (this.mode === "pan") {
        type = "pan";
      } else if (this.mode === "ruler") {
        index = this.ruler.findIndex((q) => this.near(p, q));
        if (index >= 0) type = "ruler";
      } else if (this.mode === "freehand") {
        if (this.closed) {
          this.closed = false;
          this.points = [];
        }
        if (this.points.length && !this.near(p, this.points.at(-1))) {
          this.toast("Продовжуйте від останньої точки або очистьте контур.");
          return;
        }
        if (!this.points.length) this.points.push(p);
        type = "draw";
      } else {
        {
          index = this.points.findIndex((q) => this.near(p, q));
          if (e.altKey && index >= 0) {
            if (this.points.length > 3) this.points.splice(index, 1);
            this.changed();
            return;
          }
          if (e.shiftKey && this.closed) {
            let best = Infinity,
              insert = 0;
            for (let i = 0; i < this.points.length; i++) {
              const a = this.points[i],
                b = this.points[(i + 1) % this.points.length],
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
                d = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t);
              if (d < best) {
                best = d;
                insert = i + 1;
              }
            }
            if (this.points.length < this.maxPoints)
              this.points.splice(insert, 0, p);
            this.changed();
            return;
          }
          if (index >= 0) type = "vertex";
        }
      }
      if (type) {
        this.gesture = {
          id: e.pointerId,
          type,
          index,
          last: [e.clientX, e.clientY],
        };
        this.canvas.setPointerCapture(e.pointerId);
        if (type === "pan") this.draw();
        else this.changed();
      }
    }
    move(e) {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      e.preventDefault();
      if (g.type === "pan") {
        const r = this.canvas.getBoundingClientRect(),
          k = this.canvas.width / r.width / this.map.s;
        this.center[0] -= (e.clientX - g.last[0]) * k;
        this.center[1] -= (e.clientY - g.last[1]) * k;
        this.center[0] = Math.max(
          0,
          Math.min(this.photo.width, this.center[0]),
        );
        this.center[1] = Math.max(
          0,
          Math.min(this.photo.height, this.center[1]),
        );
        g.last = [e.clientX, e.clientY];
        this.draw();
        return;
      }
      if (g.type === "draw") {
        for (const event of e.getCoalescedEvents?.().length
          ? e.getCoalescedEvents()
          : [e]) {
          const p = this.point(event);
          if (
            distance(p, this.points.at(-1)) >= 0.5 &&
            this.points.length < 10000
          )
            this.points.push(p);
        }
      } else if (g.type === "vertex") this.points[g.index] = this.point(e);
      else {
        this.ruler[g.index] = this.point(e);
        this.px = scale(this.ruler, Number(this.$("knownDistance").value));
      }
      this.changed();
    }
    up(e, cancel = false) {
      const g = this.gesture;
      if (!g || g.id !== e.pointerId) return;
      if (!cancel) this.move(e);
      this.gesture = null;
      if (this.canvas.hasPointerCapture(e.pointerId))
        this.canvas.releasePointerCapture(e.pointerId);
      if (g.type === "draw") {
        if (
          !cancel &&
          this.points.length > 3 &&
          this.near(this.points.at(-1), this.points[0])
        )
          this.finish();
        else {
          this.closed = false;
          this.hint(
            cancel
              ? "Штрих перервано. Контур не замкнуто."
              : "Контур відкритий. Продовжіть від останньої точки до початкової.",
          );
          this.changed();
        }
      } else this.status();
    }
    finish() {
      if (this.gesture || this.points.length < 3) {
        this.toast("Позначте принаймні три точки й завершіть штрих.");
        return;
      }
      if (
        this.mode === "freehand" &&
        !this.near(this.points.at(-1), this.points[0])
      ) {
        this.toast("Відкритий контур: доведіть лінію до початкової точки.");
        return;
      }
      let p = this.points.slice();
      if (distance(p[0], p.at(-1)) < 0.5) p.pop();
      if (this.mode === "freehand") {
        p = root.Geo.simplify(p, Math.max(0.4, this.px * 0.05));
      }
      if (p.length > this.maxPoints) {
        this.toast(
          `Контур має ${p.length} точок. Зменште кількість до ${this.maxPoints}; масштаб і точність не змінюються автоматично.`,
        );
        return;
      }
      if (!root.Geo.validPolygon(p)) {
        this.toast(
          "Контур має самоперетин, накладені ребра або повторні точки. Виправте його.",
        );
        this.closed = false;
        this.changed();
        return;
      }
      this.points = p;
      this.closed = true;
      this.mode = "edit";
      this.hint(
        "Контур замкнуто й перевірено. За потреби перетягніть вершини; потім підтвердьте відповідність фото.",
      );
      this.changed();
    }
    auto() {
      if (!this.photo) {
        this.toast("Спершу завантажте фото.");
        return;
      }
      try {
        const k = Math.min(
            1,
            500 / Math.max(this.photo.width, this.photo.height),
          ),
          c = document.createElement("canvas");
        c.width = Math.round(this.photo.width * k);
        c.height = Math.round(this.photo.height * k);
        const cx = c.getContext("2d");
        cx.drawImage(this.photo, 0, 0, c.width, c.height);
        const p = root.Geo.trace(
          cx.getImageData(0, 0, c.width, c.height).data,
          c.width,
          c.height,
          Number(this.$("tolerance").value),
        ).map(([x, y]) => [
          (x * this.photo.width) / c.width,
          (y * this.photo.height) / c.height,
        ]);
        if (!root.Geo.validPolygon(p) || p.length > this.maxPoints)
          throw Error(
            "Автообведення не дало коректного контуру. Обведіть дерево вручну.",
          );
        this.points = p;
        this.closed = true;
        this.mode = "edit";
        this.hint(
          "Автоматичний контур потребує перевірки по фото. Виправте зайвий фон або обведіть вручну.",
        );
        this.changed();
      } catch (e) {
        this.toast(e.message);
      }
    }
    status() {
      const valid =
        this.closed &&
        this.points.length <= this.maxPoints &&
        root.Geo.validPolygon(this.points);
      this.$("scaleInfo").textContent = this.px
        ? `Масштаб: ${this.px.toFixed(4)} пікселів/см. Однаковий для дерева й стільниці.`
        : "Масштаб не задано: введіть відстань і позначте її два кінці.";
      let text = !this.points.length
        ? "Контур не створено"
        : `${valid ? "Замкнутий контур" : "Відкритий або некоректний контур"} · ${this.points.length} точок`;
      if (valid && this.px) {
        const b = physical(this.points, this.px);
        text += ` · ${b.hcm.toFixed(2)} × ${b.wcm.toFixed(2)} см · ${(root.Geo.area(this.points) / this.px ** 2 / 10000).toFixed(3)} м²`;
      }
      this.$("contourInfo").textContent = text;
      this.$("closeContour").disabled = this.closed || this.points.length < 3;
      for (const f of ["SVG", "DXF"])
        this.$("exportContour" + f).disabled = !(valid && this.px);
      this.$("saveSlab").disabled = !(
        valid &&
        this.px &&
        this.$("contourVerified").checked
      );
    }
    value(requireVerified = true) {
      if (!this.photo || !this.px || this.ruler.length !== 2)
        throw Error("Завантажте фото й задайте його фізичний масштаб.");
      if (
        !this.closed ||
        !root.Geo.validPolygon(this.points) ||
        this.points.length > this.maxPoints
      )
        throw Error("Потрібен замкнутий контур без самоперетинів.");
      if (requireVerified && !this.$("contourVerified").checked)
        throw Error("Підтвердьте відповідність контуру реальному слебу.");
      const b = physical(this.points, this.px);
      if (Math.min(b.wcm, b.hcm) < 1 || Math.max(b.wcm, b.hcm) > 1000)
        throw Error(
          "Габарити слеба мають бути в межах 1–1000 см. Перевірте масштаб.",
        );
      const crop = document.createElement("canvas"),
        k = Math.min(1, 1200 / Math.max(b.w, b.h));
      crop.width = Math.max(1, Math.round(b.w * k));
      crop.height = Math.max(1, Math.round(b.h * k));
      crop
        .getContext("2d")
        .drawImage(
          this.photo,
          b.x,
          b.y,
          b.w,
          b.h,
          0,
          0,
          crop.width,
          crop.height,
        );
      let photo = crop.toDataURL("image/jpeg", 0.85);
      if (photo.length > 480000) photo = crop.toDataURL("image/jpeg", 0.55);
      if (photo.length > 500000)
        throw Error("Фото завелике. Зменште роздільність.");
      return {
        w: b.wcm,
        h: b.hcm,
        points: b.points,
        photo,
        contourClosed: true,
        calibration: {
          version: 2,
          verified: !!this.$("contourVerified").checked,
          distanceCm: Number(this.$("knownDistance").value),
          pixelsPerCm: this.px,
          points: this.ruler.map((p) => [...p]),
          sourceWidth: this.photo.width,
          sourceHeight: this.photo.height,
          bounds: { x: b.x, y: b.y, w: b.w, h: b.h },
        },
      };
    }
    download(format, s) {
      const name = (this.$("slabNumber").value.trim() || "slab").replace(
          /[^\p{L}\p{N}_.-]/gu,
          "_",
        ),
        blob = new Blob([format === "svg" ? svg(s) : dxf(s)], {
          type: format === "svg" ? "image/svg+xml" : "application/dxf",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = name + "." + format;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
  root.SlabContour = { bounds, scale, physical, svg, dxf, Editor };
  if (typeof module !== "undefined") module.exports = root.SlabContour;
})(globalThis);

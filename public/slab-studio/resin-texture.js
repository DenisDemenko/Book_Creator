/* Resin appearance is saved with the design; physical geometry stays in centimetres. */
(function (root) {
  "use strict";
  const validImage = (image) =>
    typeof image === "string" &&
    image.length <= 400000 &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image);

  function layer(design) {
    const image = design.resinTexture?.image;
    if (!validImage(image)) return "";
    // resinTransparency: 0 = opaque resin, 100 = clear; the texture is as see-through as the resin.
    const clear = Math.min(100, Math.max(0, Math.round(Number(design.resinTransparency) || 0)));
    const opacity = clear ? ` opacity="${(1 - clear / 100).toFixed(2)}"` : "";
    const tag = `<image class="resin-texture-layer" href="${image}" x="${-design.l / 2}" y="${-design.w / 2}" width="${design.l}" height="${design.w}"${opacity} preserveAspectRatio="xMidYMid slice" pointer-events="none" aria-label="Текстура епоксидної смоли"/>`;
    const angle = ((Number(design.resinAngle) || 0) % 360 + 360) % 360;
    if (!angle) return tag;
    // Turned about the centre of the top and enlarged just enough that its corners still cover it.
    const c = Math.abs(Math.cos((angle * Math.PI) / 180)),
      s = Math.abs(Math.sin((angle * Math.PI) / 180));
    const scale = Math.max((c * design.l + s * design.w) / design.l, (s * design.l + c * design.w) / design.w);
    // Rounded up, never down: a hair too small would leave a bare edge.
    const cover = Math.ceil(scale * 10000 - 1e-6) / 10000;
    return `<g transform="rotate(${angle}) scale(${cover.toFixed(4)})">${tag}</g>`;
  }

  const MAX_INPUT_BYTES = 35 * 1024 * 1024;
  const MAX_OUTPUT_BYTES = 280 * 1024;
  const encode = (canvas, type, quality) =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Не вдалося стиснути текстуру.")),
        type,
        quality,
      );
    });
  function readFile(file, method, onProgress) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reader.onabort = () =>
        reject(new Error("Не вдалося прочитати файл текстури."));
      if (onProgress)
        reader.onprogress = (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        };
      reader[method](file);
    });
  }
  async function read(file, onProgress = () => {}) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new Error(
        "Оберіть зображення текстури у форматі PNG, JPG або WEBP.",
      );
    if (file.size > MAX_INPUT_BYTES)
      throw new Error("Зображення текстури має бути не більше 35 МБ.");
    const progress = (percent, stage) => onProgress({ percent, stage });
    progress(0, "Читання файла");
    const buffer = await readFile(file, "readAsArrayBuffer", (ratio) =>
      progress(Math.round(ratio * 30), "Читання файла"),
    );
    progress(35, "Декодування зображення");
    let image;
    try {
      image = await createImageBitmap(new Blob([buffer], { type: file.type }));
    } catch {
      throw new Error(
        "Не вдалося прочитати зображення текстури. Оберіть інший файл.",
      );
    }
    try {
      if (
        !image.width ||
        !image.height ||
        image.width * image.height > 80000000
      )
        throw new Error(
          "Зменште роздільність зображення текстури й повторіть завантаження.",
        );
      const canvas = document.createElement("canvas");
      const plan = [
        [2048, 0.86],
        [2048, 0.76],
        [2048, 0.66],
        [1600, 0.78],
        [1600, 0.66],
        [1280, 0.76],
        [1024, 0.7],
        [1024, 0.58],
        [800, 0.7],
        [800, 0.55],
        [640, 0.66],
      ];
      let type = "image/webp";
      progress(50, "Підготовка розміру");
      for (const [index, [limit, quality]] of plan.entries()) {
        progress(
          55 + Math.floor((index * 38) / plan.length),
          "Стиснення текстури",
        );
        // Yield before drawing; progress and controls remain responsive.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const ratio = Math.min(1, limit / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        const context = canvas.getContext("2d");
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        let blob = await encode(canvas, type, quality);
        if (type === "image/webp" && blob.type !== type) type = "image/jpeg";
        if (type === "image/jpeg") {
          context.globalCompositeOperation = "destination-over";
          context.fillStyle = "white";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.globalCompositeOperation = "source-over";
          blob = await encode(canvas, type, quality);
        }
        if (blob.size > MAX_OUTPUT_BYTES) continue;
        progress(95, "Підготовка до збереження");
        const data = await readFile(blob, "readAsDataURL");
        if (validImage(data)) {
          progress(100, "Готово");
          return {
            image: data,
            name: (file.name || "Текстура смоли").slice(0, 120),
            stats: {
              sourceBytes: file.size,
              bytes: blob.size,
              width: canvas.width,
              height: canvas.height,
            },
          };
        }
      }
      throw new Error(
        "Текстура завелика для збереження. Оберіть менше зображення.",
      );
    } finally {
      image.close();
    }
  }
  root.ResinTexture = {
    layer,
    read,
    validImage,
    MAX_INPUT_BYTES,
    MAX_OUTPUT_BYTES,
  };
})(typeof window !== "undefined" ? window : globalThis);

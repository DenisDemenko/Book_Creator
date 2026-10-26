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
    return `<image class="resin-texture-layer" href="${image}" x="${-design.l / 2}" y="${-design.w / 2}" width="${design.l}" height="${design.w}" preserveAspectRatio="xMidYMid slice" pointer-events="none" aria-label="Текстура епоксидної смоли"/>`;
  }

  async function read(file) {
    if (!file || !["image/jpeg", "image/png", "image/webp"].includes(file.type))
      throw new Error(
        "Оберіть зображення текстури у форматі PNG, JPG або WEBP.",
      );
    if (file.size > 12 * 1024 * 1024)
      throw new Error("Зображення текстури має бути не більше 12 МБ.");
    let image;
    try {
      image = await createImageBitmap(file);
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
      let data;
      for (const [limit, quality] of [
        [1200, 0.84],
        [900, 0.72],
        [600, 0.65],
      ]) {
        const ratio = Math.min(1, limit / Math.max(image.width, image.height));
        canvas.width = Math.max(1, Math.round(image.width * ratio));
        canvas.height = Math.max(1, Math.round(image.height * ratio));
        canvas
          .getContext("2d")
          .drawImage(image, 0, 0, canvas.width, canvas.height);
        data = canvas.toDataURL("image/webp", quality);
        if (validImage(data))
          return {
            image: data,
            name: (file.name || "Текстура смоли").slice(0, 120),
          };
      }
      throw new Error(
        "Текстура завелика для збереження. Оберіть менше зображення.",
      );
    } finally {
      image.close();
    }
  }
  root.ResinTexture = { layer, read, validImage };
})(typeof window !== "undefined" ? window : globalThis);

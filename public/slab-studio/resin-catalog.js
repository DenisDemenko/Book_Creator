/* Resin colours and textures offered in the table builder.
 *
 * Colours are the 24 named resin dyes of the Fusion Lab palette; the hex
 * values were sampled from the studio's own "Кольори епоксидної смоли" sheet
 * (resin strip of each sample table), so the swatch is what the workshop pours.
 *
 * Textures come in two kinds:
 *  - ready photos (originals) — applied as they are;
 *  - grey bases ("Хвилі", "Перламутр") that are painted in a chosen colour in
 *    the browser: darkest areas take a deep shade of the colour, mid tones the
 *    colour itself, highlights a light tint of it (foam stays pale).
 * Either way the result goes through ResinTexture.read(), so what is saved with
 * the design is the same compressed, validated data URL as for an upload.
 */
(function (root) {
  "use strict";

  const COLORS = [
    { name: "Жовтий", hex: "#f3b502" },
    { name: "Яскравий зелений", hex: "#b7d760" },
    { name: "Лимонний", hex: "#eff327" },
    { name: "Червоний", hex: "#e70210" },
    { name: "Морська хвиля", hex: "#0181ab" },
    { name: "Смарагдовий", hex: "#128e4c" },
    { name: "Зелений", hex: "#087a53" },
    { name: "Помаранчевий", hex: "#fd4102" },
    { name: "Червона троянда", hex: "#a80116" },
    { name: "Чорний", hex: "#1c1c1d" },
    { name: "Кава", hex: "#673013" },
    { name: "Індиго синій", hex: "#575add" },
    { name: "Діамантовий блакитний", hex: "#002e99" },
    { name: "Золотистий світанок", hex: "#f5ac02" },
    { name: "Рожевий", hex: "#feabbc" },
    { name: "Синій", hex: "#0171e9" },
    { name: "Білий", hex: "#f3f1f1" },
    { name: "Блакитний", hex: "#72c8cf" },
    { name: "Пурпуровий", hex: "#55108e" },
    { name: "Червоне вино", hex: "#a70110" },
    { name: "Коричневий", hex: "#6b2905" },
    { name: "Весняна трава", hex: "#5ea304" },
    { name: "Фіолетовий", hex: "#9c64d3" },
    { name: "Персиковий", hex: "#f68f81" },
  ];

  const BASE = "textures/";

  // Poured samples as supplied by the workshop (resized for the web).
  const SAMPLES = [
    { id: "pearl-indigo", group: "pearl", name: "Перламутр · Індіго синій", file: "pearl-indigo.webp" },
    { id: "pearl-diamond", group: "pearl", name: "Перламутр · Діамантовий блакитний", file: "pearl-diamond.webp" },
    { id: "pearl-yellow", group: "pearl", name: "Перламутр · Жовтий", file: "pearl-yellow.webp" },
    { id: "pearl-green", group: "pearl", name: "Перламутр · Зелений", file: "pearl-green.webp" },
    { id: "pearl-emerald", group: "pearl", name: "Перламутр · Смарагдовий", file: "pearl-emerald.webp" },
    { id: "pearl-coffee", group: "pearl", name: "Перламутр · Кава", file: "pearl-coffee.webp" },
    { id: "pearl-lemon", group: "pearl", name: "Перламутр · Лимонний", file: "pearl-lemon.webp" },
    { id: "pearl-rose", group: "pearl", name: "Перламутр · Червона троянда", file: "pearl-rose.webp" },
    { id: "pearl-orange", group: "pearl", name: "Перламутр · Помаранчевий", file: "pearl-orange.webp" },
    { id: "pearl-purple", group: "pearl", name: "Перламутр · Пурпуровий", file: "pearl-purple.webp" },
    { id: "pearl-blue", group: "pearl", name: "Перламутр · Синій", file: "pearl-blue.webp" },
    { id: "pearl-red", group: "pearl", name: "Перламутр · Червоний", file: "pearl-red.webp" },
    { id: "pearl-black", group: "pearl", name: "Перламутр · Чорний", file: "pearl-black.webp" },
    { id: "pearl-lime", group: "pearl", name: "Перламутр · Яскравий зелений", file: "pearl-lime.webp" },
    { id: "wave-ocean", group: "waves", name: "Хвилі · Океан", file: "wave-ocean.webp" },
    { id: "wave-shore", group: "waves", name: "Хвилі · Прибій", file: "wave-shore.webp" },
    { id: "wave-deep", group: "waves", name: "Хвилі · Глибина", file: "wave-deep.webp" },
  ].map((sample) => ({ ...sample, url: BASE + sample.file }));

  // Grey bases that take any palette colour.
  const STYLES = [
    { id: "waves", name: "Хвилі", url: BASE + "wave-base.webp", defaultColor: "Морська хвиля" },
    { id: "pearl", name: "Перламутр", url: BASE + "pearl-base.webp", defaultColor: "Пурпуровий" },
  ];

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new Error("Не вдалося завантажити зразок текстури."));
      image.src = url;
    });
  }

  /** Paints a grey base in `hex` and returns a canvas. */
  async function tint(baseUrl, hex, maxSide = 1024) {
    const image = await loadImage(baseUrl);
    const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const px = frame.data;
    const base = rgb(hex);
    // Shade and light are fixed fractions of the colour so every colour keeps
    // the same depth: deep end at 35% of it, light end 60% of the way to white.
    const dark = base.map((v) => v * 0.35);
    const light = base.map((v) => v + (255 - v) * 0.6);
    for (let i = 0; i < px.length; i += 4) {
      const l = px[i] / 255; // the base is grey: any channel is the luminance
      const from = l < 0.5 ? dark : base;
      const to = l < 0.5 ? base : light;
      const t = l < 0.5 ? l / 0.5 : (l - 0.5) / 0.5;
      px[i] = from[0] + (to[0] - from[0]) * t;
      px[i + 1] = from[1] + (to[1] - from[1]) * t;
      px[i + 2] = from[2] + (to[2] - from[2]) * t;
      px[i + 3] = 255;
    }
    context.putImageData(frame, 0, 0);
    return canvas;
  }

  function toFile(canvas, name) {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(new File([blob], name, { type: blob.type || "image/png" }))
            : reject(new Error("Не вдалося підготувати текстуру.")),
        "image/webp",
        0.82,
      ),
    );
  }

  /** A File of the sample as it is, for ResinTexture.read(). */
  async function sampleFile(sample) {
    const response = await fetch(sample.url);
    if (!response.ok) throw new Error("Не вдалося завантажити зразок текстури.");
    const blob = await response.blob();
    return new File([blob], sample.name, { type: blob.type || "image/webp" });
  }

  /** A File of a style painted in `color` ({name, hex}). */
  async function styleFile(style, color) {
    const canvas = await tint(style.url, color.hex);
    return toFile(canvas, `${style.name} · ${color.name}`);
  }

  root.ResinCatalog = { COLORS, SAMPLES, STYLES, sampleFile, styleFile, tint };
})(typeof window !== "undefined" ? window : globalThis);

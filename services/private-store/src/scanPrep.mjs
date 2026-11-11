/**
 * Підготовка знімка до розпізнавання (журнал #550): вирівнювання нахилу, вирівнювання освітлення, масштаб, бінаризація.
 *
 * Чому це потрібно. Замір 11.11.2026 на українському тексті: Tesseract на чистому скані — 98%, на «телефонному» фото (нахил 3°,
 * тінь, шум, JPEG) без обробки — 21%, а після цих кроків — 87% по рядках. Рушій сам не виправляє нахил і нерівне світло.
 *
 * Декодує й малює `@napi-rs/canvas` (Skia; залежність образу). Якщо його немає — повертає `null`, і розпізнавання йде по оригіналу.
 * Вхід перевірено заздалегідь (imageInfo.mjs): формат і кількість пікселів.
 */

let canvasModule;
async function loadCanvas() {
  if (canvasModule !== undefined) return canvasModule;
  try {
    canvasModule = await import('@napi-rs/canvas');
  } catch {
    canvasModule = null;
  }
  return canvasModule;
}

function toGray(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}

/** Нахил: на правильному куті горизонтальний профіль темних пікселів найконтрастніший (дисперсія рядків найбільша). */
function estimateSkew(createCanvas, img) {
  const S = 420;
  const scale = S / Math.max(img.width, img.height);
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  let best = { angle: 0, score: -1 };
  for (let a = -8; a <= 8.001; a += 0.25) {
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.translate(w / 2, h / 2);
    ctx.rotate((-a * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
    const g = toGray(ctx, w, h);
    let mean = 0;
    for (let i = 0; i < g.length; i++) mean += g[i];
    mean /= g.length;
    const rows = new Float64Array(h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g[y * w + x] < mean * 0.7) rows[y] += 1;
    let sum = 0;
    let sq = 0;
    for (let y = 0; y < h; y++) {
      sum += rows[y];
      sq += rows[y] * rows[y];
    }
    const variance = sq / h - (sum / h) ** 2;
    if (variance > best.score) best = { angle: a, score: variance };
  }
  return best.angle;
}

/**
 * @param {Buffer} bytes
 * @returns {Promise<{ png: Buffer, angle: number, width: number, height: number } | null>}
 */
export async function prepareForOcr(bytes, { minSide = 1800, maxSide = 2600 } = {}) {
  const mod = await loadCanvas();
  if (!mod) return null;
  const { createCanvas, loadImage } = mod;
  let img;
  try {
    img = await loadImage(bytes);
  } catch {
    return null;
  }
  if (!img.width || !img.height) return null;
  const angle = estimateSkew(createCanvas, img);
  const longest = Math.max(img.width, img.height);
  const scale = longest < minSide ? Math.min(2, maxSide / longest) : longest > maxSide ? maxSide / longest : 1;
  const w = Math.max(16, Math.round(img.width * scale));
  const h = Math.max(16, Math.round(img.height * scale));
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((-angle * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const g = toGray(ctx, w, h);
  // Тло = сильно розмите зображення (інтегральне зображення): значення «темніше за місцеве тло» — чорне, решта — біле.
  const r = Math.max(8, Math.round(Math.min(w, h) / 16));
  const stride = w + 1;
  const integ = new Float64Array(stride * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += g[y * w + x];
      integ[(y + 1) * stride + (x + 1)] = integ[y * stride + (x + 1)] + row;
    }
  }
  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const area = (x1 - x0) * (y1 - y0);
      const mean = (integ[y1 * stride + x1] - integ[y0 * stride + x1] - integ[y1 * stride + x0] + integ[y0 * stride + x0]) / area;
      const v = g[y * w + x] < mean * 0.8 ? 0 : 255;
      const i = (y * w + x) * 4;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return { png: canvas.toBuffer('image/png'), angle, width: w, height: h };
}

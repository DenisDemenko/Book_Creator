/**
 * Контур силуету фотографії для обтікання тексту «по контуру».
 *
 * Навіщо взагалі рахувати: CSS-властивість `shape-outside: url(...)`
 * вирізає форму ВИКЛЮЧНО з альфа-каналу зображення. Для PNG/SVG з
 * прозорим тлом цього достатньо — там альфа вже є, і браузер зробить
 * точніше за будь-який наш скан. Але у JPG альфа-каналу немає взагалі,
 * тобто для звичайної фотографії обтікання «по контуру» без обчислення
 * силуету просто вироджується у прямокутник.
 *
 * Метод свідомо простий і без залежностей (у проєкті немає жодної
 * бібліотеки обробки зображень): колір чотирьох кутів беремо за колір
 * тла, порядково шукаємо першу й останню НЕ-фонову точку, з цих меж
 * будуємо полігон і спрощуємо його алгоритмом Дугласа-Пекера.
 *
 * Через це метод чесно працює лише там, де тло однорідне (студійне,
 * біле, небо). На строкатому тлі силует займе майже весь кадр — такий
 * результат ми НЕ повертаємо (див. MAX_SILHOUETTE_SHARE), щоб не
 * підсовувати авторові «контур», який насправді є прямокутником.
 *
 * Координати — у ВІДСОТКАХ від розміру кадру, тому при зміні розміру
 * фото кубиками-ручками полігон лишається чинним і не потребує
 * перерахунку. У такому ж вигляді він зберігається в маркері книги
 * (`[IMG: … shape="…"]`, utils/manuscriptDoc.ts) і потрапляє в експорт.
 */

/** Розмір, до якого зменшуємо фото перед скануванням: контур для обтікання не потребує піксельної точності, а 160px рахуються миттєво. */
const SCAN_WIDTH = 160;
/** Максимальна різниця за каналом, за якої піксель ще вважається фоном. */
const BG_TOLERANCE = 38;
/** Якщо силует займає більше за цю частку кадру — тло не розпізналось, чесніше відмовитись, ніж віддати прямокутник. */
const MAX_SILHOUETTE_SHARE = 0.9;
/** Стеля кількості точок полігона: рядок у маркері книги живе всередині тексту рукопису, в кожному бекапі й дифі. */
const MAX_POINTS = 24;

export interface ContourResult {
  /** Готовий вміст для `polygon(...)` — «x% y%, x% y%, …». */
  polygon: string;
  points: number;
}

type Pt = { x: number; y: number };

/** Чи достатньо в зображенні справжньої прозорості, щоб довірити обтікання самому браузеру (`shape-outside: url()`). */
function hasUsableAlpha(data: Uint8ClampedArray): boolean {
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 16) transparent += 1;
  }
  return transparent / (data.length / 4) > 0.02;
}

function isBackground(r: number, g: number, b: number, bg: [number, number, number]): boolean {
  return (
    Math.abs(r - bg[0]) <= BG_TOLERANCE &&
    Math.abs(g - bg[1]) <= BG_TOLERANCE &&
    Math.abs(b - bg[2]) <= BG_TOLERANCE
  );
}

/** Спрощення ламаної: викидає точки, що лежать ближче за `epsilon` до прямої між кінцями. */
function douglasPeucker(points: Pt[], epsilon: number): Pt[] {
  if (points.length <= 2) return points;
  const first = points[0];
  const last = points[points.length - 1];

  let maxDist = -1;
  let index = 0;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const norm = Math.hypot(dx, dy) || 1;

  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i];
    const dist = Math.abs(dy * p.x - dx * p.y + last.x * first.y - last.y * first.x) / norm;
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }

  if (maxDist <= epsilon) return [first, last];
  const left = douglasPeucker(points.slice(0, index + 1), epsilon);
  const right = douglasPeucker(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Підбирає epsilon так, щоб уміститись у стелю точок: одразу з великим кроком, без пошуку по одній точці. */
function simplifyToBudget(points: Pt[], budget: number): Pt[] {
  let epsilon = 0.5;
  let simplified = douglasPeucker(points, epsilon);
  while (simplified.length > budget && epsilon < 40) {
    epsilon *= 1.6;
    simplified = douglasPeucker(points, epsilon);
  }
  return simplified.slice(0, budget);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Для зовнішніх URL без CORS-заголовків canvas стане "tainted" і
    // getImageData кине помилку — це нормально, викликач отримає null.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = url;
  });
}

/**
 * Рахує полігон обтікання для фото. Повертає `null`, якщо:
 *   • у зображенні вже є справжня прозорість (хай працює `shape-outside: url()`);
 *   • тло не розпізналось (силует майже на весь кадр);
 *   • картинку не вдалося прочитати (CORS, битий файл).
 *
 * Виклик лінивий — лише коли автор натиснув кнопку «По контуру»,
 * а не при відкритті розділу: розділ із трьома десятками фотографій
 * інакше гриз би канвас на завантаженні.
 */
export async function computeContourPolygon(url: string): Promise<ContourResult | null> {
  let img: HTMLImageElement;
  try {
    img = await loadImage(url);
  } catch {
    return null;
  }

  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) return null;

  const w = Math.min(SCAN_WIDTH, naturalW);
  const h = Math.max(1, Math.round((naturalH / naturalW) * w));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    // tainted canvas — зображення з чужого домену без CORS
    return null;
  }

  // Уже прозорий PNG/SVG: полігон тільки зіпсував би те, що браузер
  // і так зробить точніше з альфа-каналу.
  if (hasUsableAlpha(data)) return null;

  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  };

  // Колір тла — медіана по чотирьох кутах (медіана, а не середнє: один
  // «зіпсований» кут із деталлю не має зміщувати оцінку).
  const corners: [number, number, number][] = [
    at(0, 0),
    at(w - 1, 0),
    at(0, h - 1),
    at(w - 1, h - 1),
  ];
  const median = (vals: number[]) => vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)];
  const bg: [number, number, number] = [
    median(corners.map((c) => c[0])),
    median(corners.map((c) => c[1])),
    median(corners.map((c) => c[2])),
  ];

  const leftEdge: Pt[] = [];
  const rightEdge: Pt[] = [];
  let silhouettePixels = 0;

  for (let y = 0; y < h; y += 1) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = at(x, y);
      if (!isBackground(r, g, b, bg)) {
        if (first === -1) first = x;
        last = x;
      }
    }
    if (first === -1) continue;
    silhouettePixels += last - first + 1;
    leftEdge.push({ x: (first / (w - 1)) * 100, y: (y / (h - 1)) * 100 });
    rightEdge.push({ x: (last / (w - 1)) * 100, y: (y / (h - 1)) * 100 });
  }

  if (leftEdge.length < 3) return null;
  if (silhouettePixels / (w * h) > MAX_SILHOUETTE_SHARE) return null;

  // Обхід за годинниковою: вниз правою межею, вгору лівою.
  const budgetPerSide = Math.floor(MAX_POINTS / 2);
  const right = simplifyToBudget(rightEdge, budgetPerSide);
  const left = simplifyToBudget(leftEdge.slice().reverse(), budgetPerSide);

  const ring = [...right, ...left];
  const polygon = ring
    .map((p) => `${p.x.toFixed(1)}% ${p.y.toFixed(1)}%`)
    .join(', ');

  return { polygon, points: ring.length };
}

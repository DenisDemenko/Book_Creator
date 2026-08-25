/**
 * Заглушки для гостьового режиму.
 *
 * Гість не витрачає платні генерації, але й не має впиратися в порожній
 * екран: замість зображення підставляється намальована на льоту картинка
 * у стилі інтерфейсу з поясненням, що для справжньої генерації потрібен
 * обліковий запис.
 *
 * SVG будується в data-URL, тож не потребує ані мережі, ані файлів.
 */

const PALETTE = [
  ['#0f172a', '#1e3a5f', '#22d3ee'],
  ['#1a1033', '#3b1a63', '#a78bfa'],
  ['#2a1810', '#5c3317', '#f59e0b'],
  ['#0d1f1a', '#14432f', '#34d399'],
];

/** Детермінований вибір палітри — та сама підказка дає ту саму заглушку. */
function paletteFor(seed: string): string[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function ratioToSize(aspectRatio: string): { w: number; h: number } {
  const [rw, rh] = aspectRatio.split(':').map(Number);
  if (!rw || !rh) return { w: 1024, h: 1024 };
  const base = 1024;
  return rw >= rh
    ? { w: base, h: Math.round((base * rh) / rw) }
    : { w: Math.round((base * rw) / rh), h: base };
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Розбиває підпис на рядки, що вміщаються у ширину. */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current) lines.push(current.trim());
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current && lines.length < maxLines) lines.push(current.trim());
  return lines;
}

export interface PlaceholderOptions {
  /** Текст, який показати всередині (назва сцени, імʼя персонажа). */
  caption?: string;
  aspectRatio?: string;
  /** 'portrait' малює силует людини, 'scene' — умовний пейзаж. */
  kind?: 'portrait' | 'scene' | 'cover';
}

/** Повертає data-URL зі згенерованою заглушкою. */
export function placeholderImage(options: PlaceholderOptions = {}): string {
  const { caption = '', aspectRatio = '1:1', kind = 'scene' } = options;
  const { w, h } = ratioToSize(aspectRatio);
  const [bg1, bg2, accent] = paletteFor(caption || kind);

  const captionLines = wrap(caption || 'Демонстраційна заглушка', 28, 2);
  const captionSvg = captionLines
    .map(
      (line, i) =>
        `<text x="50%" y="${h / 2 + 78 + i * 30}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" fill="#cbd5e1">${escapeXml(line)}</text>`
    )
    .join('');
  // Підказку тримаємо в центральній смузі: контейнери в інтерфейсі
  // кадрують зображення по висоті, і текст біля краю зникав.
  const hintY = h / 2 + 78 + captionLines.length * 30 + 26;

  const art =
    kind === 'portrait'
      ? `<circle cx="${w / 2}" cy="${h / 2 - 60}" r="58" fill="none" stroke="${accent}" stroke-width="3" opacity="0.55"/>
         <path d="M ${w / 2 - 96} ${h / 2 + 78} a 96 96 0 0 1 192 0" fill="none" stroke="${accent}" stroke-width="3" opacity="0.55"/>`
      : kind === 'cover'
        ? `<rect x="${w / 2 - 90}" y="${h / 2 - 130}" width="180" height="240" rx="8" fill="none" stroke="${accent}" stroke-width="3" opacity="0.55"/>
           <line x1="${w / 2 - 60}" y1="${h / 2 - 130}" x2="${w / 2 - 60}" y2="${h / 2 + 110}" stroke="${accent}" stroke-width="2" opacity="0.35"/>`
        : `<path d="M ${w * 0.15} ${h * 0.62} L ${w * 0.35} ${h * 0.4} L ${w * 0.5} ${h * 0.55} L ${w * 0.68} ${h * 0.32} L ${w * 0.85} ${h * 0.62} Z"
             fill="none" stroke="${accent}" stroke-width="3" opacity="0.55"/>
           <circle cx="${w * 0.72}" cy="${h * 0.26}" r="26" fill="${accent}" opacity="0.35"/>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg1}"/>
      <stop offset="100%" stop-color="${bg2}"/>
    </linearGradient>
    <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse">
      <path d="M 44 0 L 0 0 0 44" fill="none" stroke="#94a3b8" stroke-width="1" opacity="0.07"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect width="${w}" height="${h}" fill="url(#grid)"/>
  ${art}
  <text x="50%" y="${h / 2 + 34}" text-anchor="middle" font-family="ui-monospace,monospace" font-size="15" letter-spacing="3" fill="${accent}" opacity="0.9">ГОСТЬОВИЙ РЕЖИМ</text>
  ${captionSvg}
  <text x="50%" y="${hintY}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="#94a3b8">Зареєструйтеся, щоб генерувати зображення</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Розпізнає відповідь сервера про гостьове обмеження. */
export function isGuestRestriction(status: number, payload: unknown): boolean {
  return (
    status === 403 &&
    typeof payload === 'object' &&
    payload !== null &&
    (payload as { kind?: string }).kind === 'guest_restricted'
  );
}

/**
 * Шкала емоцій (Т2.2, сторінка 4 «Емоційний монітор») — спільне для сервера
 * й клієнта.
 *
 * Автор пише емоцію словами (`[/emotion:тривога — 7 @Олена]`), а монітор
 * групує їх у родини, щоб «тривога», «жах» і «страх» лягли на одну криву.
 * Назва емоції не губиться: на графіку й у підказці видно саме слово автора.
 *
 * Інтенсивність — друга характеристика тега (реєстр: «Тип, інтенсивність,
 * тривалість, причина»): число 0…10, «7/10», «70%» або слово («слабка»,
 * «сильна»). Без інтенсивності точка стає на середину шкали (5) і позначається
 * як оцінена — монітор показує її порожнім кружком.
 */

export type EmotionFamily = 'fear' | 'joy' | 'guilt' | 'resolve' | 'anger' | 'sadness' | 'love' | 'hope' | 'other';

export interface EmotionFamilyInfo {
  key: EmotionFamily;
  label: string;
  /** −1 — важка, +1 — ресурсна, 0 — нейтральна (для «температури» сцени). */
  valence: -1 | 0 | 1;
  color: string;
}

/**
 * Порядок і кольори — перевірена категоріальна палітра для темної поверхні
 * (скіл dataviz, validate_palette: сусідні пари CVD ΔE ≥ 8.4, звичайний зір
 * ≥ 19.3). Колір іде за родиною, не за місцем у списку: фільтр не
 * перефарбовує криві. Родин на екрані може бути більше трьох — тому кожна
 * лінія ще й підписана в кінці й має свою форму маркера.
 */
export const EMOTION_FAMILIES: EmotionFamilyInfo[] = [
  { key: 'fear', label: 'Страх', valence: -1, color: '#3987e5' },
  { key: 'anger', label: 'Гнів', valence: -1, color: '#d95926' },
  { key: 'hope', label: 'Надія', valence: 1, color: '#199e70' },
  { key: 'joy', label: 'Радість', valence: 1, color: '#c98500' },
  { key: 'love', label: 'Любов', valence: 1, color: '#d55181' },
  { key: 'resolve', label: 'Рішучість', valence: 1, color: '#008300' },
  { key: 'sadness', label: 'Сум', valence: -1, color: '#9085e9' },
  { key: 'guilt', label: 'Провина', valence: -1, color: '#e66767' },
  { key: 'other', label: 'Інше', valence: 0, color: '#94a3b8' },
];

export const EMOTION_FAMILY_KEYS = EMOTION_FAMILIES.map((f) => f.key);

export const familyInfo = (key: string): EmotionFamilyInfo => EMOTION_FAMILIES.find((f) => f.key === key) ?? EMOTION_FAMILIES[EMOTION_FAMILIES.length - 1];

/** Початки слів → родина. Порядок важить: «сумнів» — не «сум». */
const FAMILY_STEMS: [RegExp, EmotionFamily][] = [
  [/^(сумнів|вагання|doubt)/, 'other'],
  [/^(страх|тривог|жах|пані|боязк|боязн|переля|нажах|моторош|fear|anxi|terror|dread|panic|scare)/, 'fear'],
  [/^(провин|сором|каятт|докор|вин[ау]$|guilt|shame|remorse)/, 'guilt'],
  [/^(рішуч|смілив|відваг|мужн|впевнен|твердіст|resolve|determin|courage|confiden)/, 'resolve'],
  [/^(гнів|лют|злість|злоб|роздрат|обур|ненавис|anger|angry|rage|fury|irrit|hate)/, 'anger'],
  [/^(сум$|суму$|сумно|смуток|туг[аи]|гор[еяю]$|відчай|печал|журб|розпач|самотн|sad|grief|despair|sorrow|lonel)/, 'sadness'],
  [/^(любов|любові|кохан|ніжн|прив['ʼ’]?язан|закохан|love|tender|affection)/, 'love'],
  [/^(надія|надії|надію|сподіван|hope)/, 'hope'],
  [/^(радість|радості|радіс|щаст|захват|весел|полегш|втіх|ейфор|joy|happ|relief|delight|elat)/, 'joy'],
];

/** Родина емоції за її назвою; незнайома — «other». */
export function emotionFamily(name: string): EmotionFamily {
  const s = String(name ?? '').trim().toLocaleLowerCase('uk');
  for (const [re, fam] of FAMILY_STEMS) if (re.test(s)) return fam;
  return 'other';
}

const INTENSITY_WORDS: [RegExp, number][] = [
  [/(дуже сильн|нестерпн|надзвичайн|шален|максимальн|паралізу|extreme|overwhelm)/, 10],
  [/(сильн|глибок|гостр|велик|strong|intense|deep)/, 8],
  [/(помірн|середн|moderate|medium)/, 5],
  [/(слабк|легк|трохи|ледь|незначн|мал|weak|slight|mild)/, 3],
];

/**
 * Інтенсивність з характеристик тега: спершу поле «інтенсивність» (друга
 * частина), далі будь-яке поле-число. null — не вказано.
 */
export function parseIntensity(parts: string[]): number | null {
  const ordered = parts.length > 1 ? [parts[1], ...parts.slice(2)] : [];
  for (const raw of ordered) {
    const s = String(raw ?? '').trim().toLocaleLowerCase('uk');
    if (!s) continue;
    const pct = /^(\d{1,3})\s*%$/.exec(s);
    if (pct) return clampIntensity(Number(pct[1]) / 10);
    const frac = /^(\d{1,2}(?:[.,]\d+)?)\s*\/\s*(\d{1,3})$/.exec(s);
    if (frac && Number(frac[2]) > 0) return clampIntensity((Number(frac[1].replace(',', '.')) / Number(frac[2])) * 10);
    const num = /^(\d{1,2}(?:[.,]\d+)?)$/.exec(s);
    if (num) return clampIntensity(Number(num[1].replace(',', '.')));
    for (const [re, v] of INTENSITY_WORDS) if (re.test(s)) return v;
  }
  return null;
}

export const DEFAULT_INTENSITY = 5;

export function clampIntensity(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_INTENSITY;
  return Math.max(0, Math.min(10, Math.round(v)));
}

// ── Шар емоції і показники (ТЗ-11, сторінка 4) ──────────────────────────────

export type EmotionLayer = 'primary' | 'secondary' | 'hidden';
export const EMOTION_LAYERS: { key: EmotionLayer; label: string }[] = [
  { key: 'primary', label: 'основна' },
  { key: 'secondary', label: 'другорядна' },
  { key: 'hidden', label: 'прихована' },
];
export const layerLabel = (key: string) => EMOTION_LAYERS.find((l) => l.key === key)?.label ?? 'основна';

/**
 * Шар з тега: будь-яка частина значення «прихована» / «підтекст» чи
 * «другорядна» / «фонова» (`[/emotion:сором — 6 — прихована @Олена]`);
 * інакше — основна.
 */
export function parseLayer(parts: string[]): EmotionLayer {
  for (const raw of parts.slice(1)) {
    const s = String(raw ?? '').trim().toLocaleLowerCase('uk');
    if (/^(прихован|підтекст|затаєн|hidden|subtext)/.test(s)) return 'hidden';
    if (/^(другоряд|фонов|побіжн|secondary|background)/.test(s)) return 'secondary';
  }
  return 'primary';
}

export type EmotionMetric = 'intensity' | 'craft' | 'impact';
export const EMOTION_METRICS: { key: EmotionMetric; label: string; hint: string }[] = [
  { key: 'intensity', label: 'Сила емоції', hint: 'наскільки сильно герой це відчуває' },
  { key: 'craft', label: 'Майстерність передачі', hint: 'показано дією, тілом, підтекстом (10) чи лише назване (0–3)' },
  { key: 'impact', label: 'Вплив на сюжет', hint: 'чи змінює ця емоція рішення й події' },
];

export type EmotionAxis = 'chapter' | 'scene' | 'world';
export const EMOTION_AXES: { key: EmotionAxis; label: string }[] = [
  { key: 'chapter', label: 'глави' },
  { key: 'scene', label: 'сцени' },
  { key: 'world', label: 'час світу' },
];

/**
 * Ведична (сидерична) натальна карта персонажа — «задіак джйотіш» із
 * завдання письменника: реальний астрономічний розрахунок, а не текст,
 * вигаданий моделлю. AI пізніше ЛИШЕ інтерпретує вже пораховані позиції
 * (Лагна/Раші/Накшатра) у характерні риси — сам розрахунок робить ця
 * функція, бо довіряти моделі арифметику ефемерид не можна.
 *
 * Двигун — circular-natal-horoscope-js (чиста JS, ефемерида Мошьє,
 * без нативної компіляції й без зовнішніх файлів даних; залежності —
 * moment/moment-timezone/tz-lookup, теж чисті). Бібліотека вміє
 * перемикати «sidereal», але її вбудована аянamша — ФІКСОВАНА константа
 * (~24.1°), не прив'язана до дати; перевірено емпірично (однакове
 * значення для 1950/1975/2000/2010/2026). Тому тут аянамша РАХУЄТЬСЯ
 * окремо — за формулою Лахірі з поправкою на прецесію — і застосовується
 * до ТРОПІЧНИХ довгот, які бібліотека рахує коректно (вони прив'язані до
 * реальної ефемериди на дату, а не до фіксованого зсуву).
 *
 * Місце народження задається текстом (назва міста) — геокодується через
 * публічний Nominatim (OpenStreetMap), без ключа. Часовий пояс і
 * історичний перехід на літній/зимовий час бере на себе клас `Origin`
 * бібліотеки (tz-lookup + moment-timezone) — координат досить.
 */

import pkg from 'circular-natal-horoscope-js';
const { Origin, Horoscope } = pkg as any;

/** Аянамша Лахірі на епоху J2000.0 (1 січня 2000, 12:00 TT) — стандартне довідкове значення 23°51'11". */
const LAHIRI_AT_J2000 = 23.8531;
/** Швидкість прецесії — 50.2719"/рік (IAU 2006, практично збігається зі швидкістю Лахірі). */
const PRECESSION_DEG_PER_YEAR = 50.2719 / 3600;

function lahiriAyanamsa(year: number): number {
  return LAHIRI_AT_J2000 + (year - 2000) * PRECESSION_DEG_PER_YEAR;
}

/** 12 сидеричних знаків (Раші) — ті самі українські назви, що й для тропічного зодіаку. */
const RASHI_NAMES = [
  'Овен', 'Телець', 'Близнюки', 'Рак', 'Лев', 'Діва',
  'Терези', 'Скорпіон', 'Стрілець', 'Козеріг', 'Водолій', 'Риби',
] as const;

/** 27 накшатр (місячних станцій) — транслітерація прийнятих санскритських назв. */
const NAKSHATRA_NAMES = [
  'Ашвіні', 'Бгарані', 'Крітіка', 'Рохіні', 'Мріґашіра', 'Ардра', 'Пунарвасу', 'Пушья', 'Ашлеша',
  'Магха', 'Пурва Пхалгуні', 'Уттара Пхалгуні', 'Хаста', 'Чітра', 'Сваті', 'Вішакха', 'Анурадга', 'Джйештга',
  'Мула', 'Пурва Ашадга', 'Уттара Ашадга', 'Шравана', 'Дганіштга', 'Шатабгіша', 'Пурва Бгадрапада', 'Уттара Бгадрапада', 'Ревати',
] as const;

const NAKSHATRA_SPAN = 360 / 27; // 13°20'
const PADA_SPAN = NAKSHATRA_SPAN / 4; // 3°20'

function rashiOf(siderealLon: number): string {
  const idx = Math.floor(((siderealLon % 360) + 360) % 360 / 30);
  return RASHI_NAMES[idx];
}

function nakshatraOf(siderealLon: number): { name: string; pada: number } {
  const norm = ((siderealLon % 360) + 360) % 360;
  const idx = Math.floor(norm / NAKSHATRA_SPAN);
  const withinNakshatra = norm - idx * NAKSHATRA_SPAN;
  const pada = Math.floor(withinNakshatra / PADA_SPAN) + 1;
  return { name: NAKSHATRA_NAMES[idx], pada };
}

function toSidereal(tropicalLon: number, ayanamsa: number): number {
  let v = tropicalLon - ayanamsa;
  if (v < 0) v += 360;
  return v;
}

export interface JyotishInput {
  /** YYYY-MM-DD */
  birthDate: string;
  /** HH:MM, 24-годинний формат; якщо не вказано — опівдні (12:00) з поміткою про неточність Лагни. */
  birthTime?: string;
  /** Довільна назва міста/місця — геокодується через Nominatim. */
  birthPlace?: string;
}

export interface JyotishChart {
  /** Лагна (висхідний знак) — відсутня, якщо не було ТОЧНОГО часу народження. */
  lagna?: string;
  moonRashi: string;
  moonNakshatra: string;
  moonPada: number;
  sunRashi: string;
  /** Інші класичні грахи (без Раху/Кету — вони окремо, як вузли, а не «знак»). */
  planets: Record<string, string>;
  rahuRashi: string;
  ketuRashi: string;
  /** Чи час народження був заданий точно (впливає на надійність Лагни/будинків). */
  hasExactTime: boolean;
  /** Готовий текстовий підсумок українською — для показу письменнику і як вхід у AI-промпт. */
  summary: string;
  computedAt: string;
}

export class JyotishError extends Error {
  kind: 'geocode_failed' | 'bad_date' | 'unknown';
  constructor(kind: JyotishError['kind'], message: string) {
    super(message);
    this.name = 'JyotishError';
    this.kind = kind;
  }
}

interface GeoResult {
  lat: number;
  lon: number;
  displayName: string;
}

/** Проста пам'яттю-кешована мапа: повторний запит того самого місця не б'є в Nominatim знову. */
const geocodeCache = new Map<string, GeoResult>();

/**
 * Геокодує назву місця через публічний Nominatim (OpenStreetMap), без ключа.
 * User-Agent обов'язковий за політикою використання сервісу — інакше запити
 * можуть тихо відхилятись.
 */
export async function geocodePlace(place: string): Promise<GeoResult> {
  const key = place.trim().toLowerCase();
  if (!key) throw new JyotishError('geocode_failed', 'Не вказано місце народження.');

  const cached = geocodeCache.get(key);
  if (cached) return cached;

  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(place.trim())}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': 'NovaStudio/1.0 (writer character natal-chart lookup)',
        Accept: 'application/json',
      },
    });
  } catch (err) {
    throw new JyotishError('geocode_failed', `Геокодування недоступне: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new JyotishError('geocode_failed', `Геокодування повернуло помилку (HTTP ${res.status}).`);
  }
  const json = (await res.json().catch(() => null)) as { lat?: string; lon?: string; display_name?: string }[] | null;
  const first = json?.[0];
  if (!first?.lat || !first?.lon) {
    throw new JyotishError('geocode_failed', `Місце «${place}» не знайдено. Спробуйте вказати точніше (напр. «Львів, Україна»).`);
  }
  const result: GeoResult = { lat: parseFloat(first.lat), lon: parseFloat(first.lon), displayName: first.display_name || place };
  geocodeCache.set(key, result);
  return result;
}

const PLANET_LABELS: Record<string, string> = {
  mercury: 'Меркурій',
  venus: 'Венера',
  mars: 'Марс',
  jupiter: 'Юпітер',
  saturn: 'Сатурн',
};

/** Рахує ведичну натальну карту. `lat`/`lon` — координати місця народження (вже геокодовані). */
export function computeJyotishChart(input: JyotishInput, lat: number, lon: number): JyotishChart {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.birthDate?.trim() || '');
  if (!dateMatch) {
    throw new JyotishError('bad_date', 'Дата народження має бути у форматі РРРР-ММ-ДД.');
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const date = Number(dateMatch[3]);

  const hasExactTime = !!input.birthTime?.trim();
  let hour = 12;
  let minute = 0;
  if (hasExactTime) {
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(input.birthTime!.trim());
    if (timeMatch) {
      hour = Number(timeMatch[1]);
      minute = Number(timeMatch[2]);
    }
  }

  const origin = new Origin({ year, month: month - 1, date, hour, minute, latitude: lat, longitude: lon });
  const horoscope = new Horoscope({ origin, houseSystem: 'whole-sign', zodiac: 'tropical', language: 'en' });

  const ayanamsa = lahiriAyanamsa(year);
  const sid = (tropicalDeg: number) => toSidereal(tropicalDeg, ayanamsa);

  const sunLon = horoscope.CelestialBodies.sun.ChartPosition.Ecliptic.DecimalDegrees;
  const moonLon = horoscope.CelestialBodies.moon.ChartPosition.Ecliptic.DecimalDegrees;
  const moonSid = sid(moonLon);
  const { name: moonNakshatra, pada: moonPada } = nakshatraOf(moonSid);

  const planets: Record<string, string> = {};
  for (const key of Object.keys(PLANET_LABELS)) {
    const body = horoscope.CelestialBodies[key];
    if (body?.ChartPosition?.Ecliptic?.DecimalDegrees != null) {
      planets[PLANET_LABELS[key]] = rashiOf(sid(body.ChartPosition.Ecliptic.DecimalDegrees));
    }
  }

  const northNodeLon = horoscope.CelestialPoints?.northnode?.ChartPosition?.Ecliptic?.DecimalDegrees;
  const southNodeLon = horoscope.CelestialPoints?.southnode?.ChartPosition?.Ecliptic?.DecimalDegrees;
  const rahuRashi = northNodeLon != null ? rashiOf(sid(northNodeLon)) : '';
  const ketuRashi = southNodeLon != null ? rashiOf(sid(southNodeLon)) : '';

  let lagna: string | undefined;
  if (hasExactTime) {
    const ascLon = horoscope.Ascendant?.ChartPosition?.Ecliptic?.DecimalDegrees;
    if (ascLon != null) lagna = rashiOf(sid(ascLon));
  }

  const moonRashi = rashiOf(moonSid);
  const sunRashi = rashiOf(sid(sunLon));

  // Форма «Планета: Знак» навмисно без прийменникових конструкцій
  // («у Тельці», «в Овні») — відмінювання 12 назв знаків при місцевому
  // відмінку неоднорідне (Овен→Овні, але Телець→Тельці, Козеріг→Козерозі
  // тощо), а список лейблів без прийменника лишається грамотним і без
  // окремої таблиці відмінкових форм.
  const planetLine = Object.entries(planets)
    .map(([label, rashi]) => `${label} — ${rashi}`)
    .join(', ');

  const summaryParts = [
    lagna ? `Лагна (висхідний знак): ${lagna}.` : 'Лагна не порахована — не вказано точний час народження.',
    `Місяць: ${moonRashi} (накшатра «${moonNakshatra}», пада ${moonPada}).`,
    `Сонце: ${sunRashi}.`,
    planetLine ? `${planetLine}.` : '',
    rahuRashi && ketuRashi ? `Раху: ${rahuRashi}, Кету: ${ketuRashi}.` : '',
  ].filter(Boolean);

  return {
    lagna,
    moonRashi,
    moonNakshatra,
    moonPada,
    sunRashi,
    planets,
    rahuRashi,
    ketuRashi,
    hasExactTime,
    summary: summaryParts.join(' '),
    computedAt: new Date().toISOString(),
  };
}

/** Зручна обгортка: геокодує місце (якщо задано) і рахує карту одним викликом. */
export async function buildJyotishChart(input: JyotishInput): Promise<JyotishChart> {
  let lat = 0;
  let lon = 0;
  if (input.birthPlace?.trim()) {
    const geo = await geocodePlace(input.birthPlace);
    lat = geo.lat;
    lon = geo.lon;
  }
  return computeJyotishChart(input, lat, lon);
}

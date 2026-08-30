import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Sparkles, Gauge, Sun } from 'lucide-react';
import { useLanguage } from '../i18n/LanguageContext';
import { useSunLighting } from '../context/SunLightingContext';

/** Ключі localStorage для персистентності налаштувань сяйва. */
const POINTS_KEY = 'nova_glow_points';
const PALETTE_KEY = 'nova_glow_palette';
const SPEED_KEY = 'nova_glow_speed';
const DEFAULT_POINTS = 150;
const MAX_POINTS = 500;
/** Амплітуда автоматичної "аврора"-хвилі — рівно ±30 пунктів, як просив користувач. */
const WAVE_AMPLITUDE = 30;
/** Період одного повного циклу хвилі (мс) — повільне, схоже на аврору, дихання. */
const WAVE_PERIOD_MS = 6000;
/** Переводить пункти повзунка (0..500) у той самий діапазон --glow-intensity
 *  (0..2), що й у референсному коді (там повзунок був 0..2 з кроком 0.1). */
const POINTS_TO_INTENSITY = 1 / 250;

/** Межі періоду повного оберту кольорів палітри (мс): за цей час кожен
 *  шар встигає пройти всі три кольори й повернутися до свого.
 *  Повзунок швидкості (1..100) відображається на цей діапазон обернено:
 *  100 = найшвидше (SPEED_MIN_CYCLE_MS), 1 = найповільніше. */
const SPEED_MIN_CYCLE_MS = 3000;
const SPEED_MAX_CYCLE_MS = 60000;
const SPEED_MIN = 1;
const SPEED_MAX = 100;
/** ≈18 с на оберт — темп, який був зашитий константою до появи повзунка. */
const DEFAULT_SPEED = 74;

/** Швидкість (1..100) → період оберту в мс. Обернено-лінійно, щоб рух
 *  повзунка вправо однозначно читався як «швидше». */
function speedToCycleMs(speed: number): number {
  const f = (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  return SPEED_MAX_CYCLE_MS + (SPEED_MIN_CYCLE_MS - SPEED_MAX_CYCLE_MS) * f;
}

/** Кадр довший за це (мс) вважаємо «поверненням на вкладку» і не даємо
 *  фазі стрибнути — інакше після фонового простою кольори смикаються. */
const MAX_FRAME_DELTA_MS = 100;

export type Rgb = [number, number, number];

export interface GlowPalette {
  id: string;
  nameUk: string;
  nameEn: string;
  /** Три кольори сяйва. Шари (--glow-c1 ядро, --glow-c2 середина,
   *  --glow-c3 зовнішній ореол) не закріплені за кольорами намертво —
   *  вони повільно переливаються по колу цієї трійки. */
  colors: [Rgb, Rgb, Rgb];
}

/** [34, 211, 238] → "34, 211, 238" — формат, який чекає rgba() в index.css. */
const rgbToVar = (c: Rgb): string => `${c[0]}, ${c[1]}, ${c[2]}`;

/** Лінійна інтерполяція двох кольорів; f = 0 → from, f = 1 → to. */
function mixRgb(from: Rgb, to: Rgb, f: number): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * f),
    Math.round(from[1] + (to[1] - from[1]) * f),
    Math.round(from[2] + (to[2] - from[2]) * f),
  ];
}

/**
 * 10 схем сяйва. Композиція чергується: непарні — два холодних кольори
 * плюс один теплий, парні — навпаки, два теплих плюс один холодний.
 * Саме це чергування дає «аврорний» контраст замість монохрому.
 */
export const GLOW_PALETTES: GlowPalette[] = [
  // 1 · 2 холодних + 1 теплий
  { id: 'aurora',  nameUk: 'Аврора',        nameEn: 'Aurora',      colors: [[34, 211, 238], [139, 92, 246], [245, 158, 11]] },
  // 2 · 2 теплих + 1 холодний
  { id: 'sunset',  nameUk: 'Захід сонця',   nameEn: 'Sunset',      colors: [[245, 158, 11], [244, 63, 94], [99, 102, 241]] },
  // 3 · 2 холодних + 1 теплий
  { id: 'glacier', nameUk: 'Льодовик',      nameEn: 'Glacier',     colors: [[56, 189, 248], [45, 212, 191], [251, 146, 60]] },
  // 4 · 2 теплих + 1 холодний
  { id: 'magma',   nameUk: 'Магма',         nameEn: 'Magma',       colors: [[249, 115, 22], [239, 68, 68], [124, 58, 237]] },
  // 5 · 2 холодних + 1 теплий
  { id: 'neon',    nameUk: 'Неон',          nameEn: 'Neon',        colors: [[52, 211, 153], [34, 211, 238], [236, 72, 153]] },
  // 6 · 2 теплих + 1 холодний
  { id: 'desert',  nameUk: 'Пустеля',       nameEn: 'Desert',      colors: [[251, 191, 36], [251, 146, 60], [56, 189, 248]] },
  // 7 · 2 холодних + 1 теплий
  { id: 'cosmos',  nameUk: 'Космос',        nameEn: 'Cosmos',      colors: [[99, 102, 241], [168, 85, 247], [245, 158, 11]] },
  // 8 · 2 теплих + 1 холодний
  { id: 'rose',    nameUk: 'Троянда',       nameEn: 'Rose',        colors: [[251, 113, 133], [236, 72, 153], [34, 211, 238]] },
  // 9 · 2 холодних + 1 теплий
  { id: 'emerald', nameUk: 'Смарагд',       nameEn: 'Emerald',     colors: [[34, 197, 94], [20, 184, 166], [234, 179, 8]] },
  // 10 · 2 теплих + 1 холодний
  { id: 'amber',   nameUk: 'Бурштин',       nameEn: 'Amber',       colors: [[250, 204, 21], [245, 158, 11], [139, 92, 246]] },
];

function readInitialPoints(): number {
  try {
    const stored = localStorage.getItem(POINTS_KEY);
    const n = stored !== null ? Number(stored) : NaN;
    if (!Number.isNaN(n) && n >= 0 && n <= MAX_POINTS) return n;
  } catch {
    /* localStorage недоступний (приватний режим тощо) — типове значення */
  }
  return DEFAULT_POINTS;
}

function readInitialSpeed(): number {
  try {
    const stored = localStorage.getItem(SPEED_KEY);
    const n = stored !== null ? Number(stored) : NaN;
    if (!Number.isNaN(n) && n >= SPEED_MIN && n <= SPEED_MAX) return n;
  } catch {
    /* не критично */
  }
  return DEFAULT_SPEED;
}

function readInitialPaletteId(): string {
  try {
    const stored = localStorage.getItem(PALETTE_KEY);
    if (stored && GLOW_PALETTES.some((p) => p.id === stored)) return stored;
  } catch {
    /* не критично */
  }
  return GLOW_PALETTES[0].id;
}

/**
 * Глобальне керування аврора-сяйвом усіх блоків сайту, закріплене
 * у шапці (HeaderNav) — тобто видиме на кожній сторінці:
 *
 *   • повзунок сили 0–500pt → CSS-змінна `--glow-intensity`;
 *   • випадаючий список із 10 триколірних палітр → `--glow-c1..c3`.
 *
 * Обидві групи змінних споживає index.css (правило AURORA GLOW плюс
 * .glass-panel / .glass-panel-elevated / .badge-glass), тому зміна
 * тут миттєво перефарбовує весь застосунок в обох темах.
 *
 * Один requestAnimationFrame-цикл веде дві незалежні анімації:
 *   1) сила — синусоїдальна хвиля ±30 пунктів навколо значення повзунка;
 *   2) колір — три шари сяйва їдуть по колу трійки кольорів палітри
 *      (період задає повзунок швидкості, 3–60 с на оберт) із взаємним
 *      зсувом на один крок, тож усі три кольори видно одночасно і вони
 *      плавно перетікають один в одного. Разом це й дає рух, схожий на
 *      справжню аврору.
 *
 * Обидві анімації працюють, поки вкладка видима й система не просить
 * «зменшити рух»: цикл ставиться на паузу, коли вкладка схована
 * (document.hidden) чи ввімкнено prefers-reduced-motion, і продовжується
 * з того самого кольору/фази після повернення — без стрибка (сила й
 * колір лишаються останнім застосованим кадром, а не застигають у
 * випадковій точці синусоїди).
 */
export const GlowIntensityControl: React.FC = () => {
  const { lang, t } = useLanguage();
  // Сила аури живе в контексті сонця, а не в localStorage цього компонента:
  // її споживає SunAuraManager і кільцевий повзунок у DraggableSun, і два
  // джерела істини для одного значення розійшлися б.
  const { sunStrength, setSunStrength } = useSunLighting();
  const [points, setPoints] = useState<number>(readInitialPoints);
  const [paletteId, setPaletteId] = useState<string>(readInitialPaletteId);
  const [speed, setSpeed] = useState<number>(readInitialSpeed);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  const palette = GLOW_PALETTES.find((p) => p.id === paletteId) ?? GLOW_PALETTES[0];
  const paletteName = (p: GlowPalette) => (lang === 'en' ? p.nameEn : p.nameUk);

  // Персистуємо базове значення, як тему (useTheme.ts)
  useEffect(() => {
    try {
      localStorage.setItem(POINTS_KEY, String(points));
    } catch {
      /* не критично */
    }
  }, [points]);

  // Персистуємо швидкість переливання
  useEffect(() => {
    try {
      localStorage.setItem(SPEED_KEY, String(speed));
    } catch {
      /* не критично */
    }
  }, [speed]);

  // Тримаємо палітру в ref: кольори щокадрово пише анімаційний цикл
  // нижче, тож окремо виставляти їх у цьому ефекті не можна — наступний
  // же кадр перезаписав би значення.
  const paletteRef = useRef(palette);
  paletteRef.current = palette;

  // Персистуємо вибір палітри
  useEffect(() => {
    try {
      localStorage.setItem(PALETTE_KEY, palette.id);
    } catch {
      /* не критично */
    }
  }, [palette]);

  // Запасна палітра — щоб аврора НІКОЛИ не «завмирала», навіть якщо
  // поточна палітра з якоїсь причини виявиться неповною.
  const FALLBACK_COLORS: Rgb[] = [
    [34, 211, 238],
    [139, 92, 246],
    [245, 158, 11],
  ];

  // Повертаємо валідну палітру кольорів (з фолбеком).
  const getColors = useCallback((): Rgb[] => {
    const c = paletteRef.current?.colors;
    if (Array.isArray(c) && c.length >= 3 && c[0] && c[1] && c[2]) return c as Rgb[];
    return FALLBACK_COLORS;
  }, []);

  // Єдиний цикл анімації: сила сяйва (хвиля ±30pt) + переливання трьох
  // кольорів. Анімація працює ЗАВЖДИ (це декоративне авторське сяйво —
  // за вимогою автора воно мусить пульсувати трьома кольорами).
  //
  // Цикл НЕ ПОВИНЕН ПОМИРАТИ: будь-яка помилка або неповна палітра лише
  // пропускає кадр, але цикл продовжує працювати (інакше аврора
  // «завмирає», а бігунок сили перестає впливати).
  useEffect(() => {
    const root = document.documentElement;
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    let frameId: number | null = null;
    let start = performance.now();
    let lastNow = start;
    // Фаза кольору (0..3) накопичується по дельті кадру, а не рахується
    // від elapsed: інакше зміна швидкості повзунком стрибком змістила б
    // фазу й кольори смикнулися б. Лишається живою й під час паузи, тож
    // після відновлення переливання продовжується з того самого місця.
    let colorPhase = 0;
    // Останній запис у CSS-змінні — звідси тротлінг нижче.
    let lastWriteAt = 0;
    // Хвиля дихає 6с, колір — щонайменше 3с на оберт: обидва набагато
    // повільніші за кадрову частоту екрана, тож людське око не бачить
    // різниці між оновленням щокадру й ~30 разів/сек. А от глобальне CSS-
    // правило AURORA GLOW (index.css) через ці змінні перемальовує тінь
    // на ~600 елементах сайту на кожен запис — тому пишемо в DOM удвічі
    // рідше (~30fps), а не на кожен requestAnimationFrame (~60fps).
    const WRITE_INTERVAL_MS = 1000 / 30;

    const tick = (now: number) => {
      const elapsed = now - start;
      const delta = Math.min(now - lastNow, MAX_FRAME_DELTA_MS);
      lastNow = now;

      // Фаза кольору накопичується КОЖЕН кадр (дешева арифметика, без
      // запису в DOM) — інакше пропущені між записами кадри загубили б
      // свою дельту часу, і переливання йшло б повільніше за налаштовану
      // швидкість. Тротлюємо нижче лише сам запис у CSS-змінні.
      const cycleMs = speedToCycleMs(speedRef.current);
      if (Number.isFinite(cycleMs) && cycleMs > 0) {
        colorPhase = (colorPhase + (delta / cycleMs) * 3) % 3;
      }

      if (now - lastWriteAt >= WRITE_INTERVAL_MS) {
        lastWriteAt = now;

        // 1. Сила: синусоїдальна хвиля ±30pt навколо значення повзунка
        const wave = WAVE_AMPLITUDE * Math.sin((2 * Math.PI * elapsed) / WAVE_PERIOD_MS);
        const effectivePoints = Math.min(MAX_POINTS, Math.max(0, pointsRef.current + wave));
        root.style.setProperty('--glow-intensity', String(effectivePoints * POINTS_TO_INTENSITY));

        // 2. Колір: три шари сяйва повільно «їдуть» по колу палітри.
        //    Фаза 0..3 за цикл; шар k стартує зі зсувом k, тому в кожен
        //    момент видно всі три кольори одразу, а не лише перший.
        try {
          const paletteColors = getColors();
          const step = Math.floor(colorPhase);
          // smoothstep — без ривка швидкості на стику кольорів
          const raw = colorPhase - step;
          const f = raw * raw * (3 - 2 * raw);

          for (let k = 0; k < 3; k++) {
            const from = paletteColors[(step + k) % 3];
            const to = paletteColors[(step + k + 1) % 3];
            root.style.setProperty(`--glow-c${k + 1}`, rgbToVar(mixRgb(from, to, f)));
          }
        } catch {
          /* ігноруємо — головне, щоб цикл вижив */
        }
      }

      frameId = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (frameId !== null) return; // вже крутиться
      start = performance.now();
      lastNow = start;
      frameId = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    };

    // Перевіряє обидві умови паузи й вмикає/вимикає цикл відповідно.
    // Викликається одразу і на кожну зміну видимості вкладки чи
    // системної настройки «зменшити рух» — саме тут цикл, який раніше
    // крутився 60 разів/сек назавжди (навіть на згорнутій вкладці),
    // тепер зупиняється, коли ефект нікому не видно.
    const evaluate = () => {
      if (reducedMotionQuery.matches || document.hidden) {
        stopLoop();
      } else {
        startLoop();
      }
    };

    evaluate();
    document.addEventListener('visibilitychange', evaluate);
    reducedMotionQuery.addEventListener('change', evaluate);

    return () => {
      stopLoop();
      document.removeEventListener('visibilitychange', evaluate);
      reducedMotionQuery.removeEventListener('change', evaluate);
    };
  }, [getColors]);

  return (
    /* Ширина віддана контейнеру, а не зашита: панель тепер живе в сайдбарі
       (256px розгорнутий), і фіксовані w-24 на повзунках виштовхували б
       значення за край. Три ряди читаються як таблиця — підпис, повзунок,
       число — тому мітки мають спільну ширину. */
    <div className="flex w-full min-w-0 flex-col gap-1.5 px-2.5 py-2 rounded-xl badge-glass">
      {/* Ряд 1 — сила сяйва */}
      <div className="flex items-center gap-2" title={t('header.glowIntensityTitle')}>
        <Sparkles className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
        <span className="w-12 shrink-0 text-[11px] font-semibold text-slate-300 whitespace-nowrap">
          {t('header.glowIntensity')}
        </span>
        <input
          id="glow-intensity-slider"
          type="range"
          min={0}
          max={MAX_POINTS}
          step={1}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          className="min-w-0 flex-1 accent-cyan-400"
          aria-label={t('header.glowIntensity')}
        />
        <span className="w-9 shrink-0 text-right text-[10px] font-mono text-slate-500">
          {Math.round(points)}
        </span>
      </div>

      {/* Ряд 2 — швидкість переливання кольорів */}
      <div className="flex items-center gap-2" title={t('header.glowSpeedTitle')}>
        <Gauge className="w-3.5 h-3.5 text-violet-300 shrink-0" />
        <span className="w-12 shrink-0 text-[11px] font-semibold text-slate-300 whitespace-nowrap">
          {t('header.glowSpeed')}
        </span>
        <input
          id="glow-speed-slider"
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={1}
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          className="min-w-0 flex-1 accent-violet-400"
          aria-label={t('header.glowSpeed')}
        />
        {/* Показуємо не абстрактні «пункти», а реальний період оберту */}
        <span className="w-9 shrink-0 text-right text-[10px] font-mono text-slate-500">
          {(speedToCycleMs(speed) / 1000).toFixed(0)}с
        </span>
      </div>

      {/* Ряд 3 — сила аури сонця над текстом і вікнами.
          Досі це налаштування існувало лише кільцевим повзунком навколо
          палітри в DraggableSun: щоб дотягнутись до нього, треба було
          спершу здогадатись клацнути сонце правою кнопкою. Тут воно поруч
          із двома іншими, які керують тим самим сяйвом. */}
      <div className="flex items-center gap-2" title={t('header.sunAuraTitle')}>
        <Sun className="w-3.5 h-3.5 text-amber-300 shrink-0" />
        <span className="w-12 shrink-0 text-[11px] font-semibold text-slate-300 whitespace-nowrap">
          {t('header.sunAura')}
        </span>
        <input
          id="sun-aura-slider"
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(sunStrength * 100)}
          onChange={(e) => setSunStrength(Number(e.target.value) / 100)}
          className="min-w-0 flex-1 accent-amber-400"
          aria-label={t('header.sunAura')}
        />
        <span className="w-9 shrink-0 text-right text-[10px] font-mono text-slate-500">
          {Math.round(sunStrength * 100)}%
        </span>
      </div>

      {/* Ряд 4 — палітра сяйва */}
      <div className="flex items-center gap-1.5" title={t('header.glowPaletteTitle')}>
        {/* Прев'ю трьох кольорів обраної схеми */}
        <span className="flex items-center gap-0.5 shrink-0" aria-hidden="true">
          {palette.colors.map((c, i) => (
            <span
              key={i}
              className="w-2 h-2 rounded-full border border-white/20"
              style={{ backgroundColor: `rgb(${rgbToVar(c)})` }}
            />
          ))}
        </span>
        <select
          id="glow-palette-select"
          value={paletteId}
          onChange={(e) => setPaletteId(e.target.value)}
          className="w-full min-w-0 bg-transparent text-[10px] font-semibold text-slate-300 outline-none cursor-pointer"
          aria-label={t('header.glowPalette')}
        >
          {GLOW_PALETTES.map((p) => (
            <option key={p.id} value={p.id} className="bg-slate-900 text-slate-100">
              {paletteName(p)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

import { useEffect, useRef } from 'react';

export interface WaterCausticsSettings {
  /** Швидкість анімації, 0.5–2 (як у мокапі «FusionWrite»). */
  speed: number;
  /** Кількість/інтенсивність шарів каустики. */
  level: 'low' | 'medium' | 'high' | 'ultra';
  /** Частота хвиль, 0.5–2. */
  frequency: number;
  /** Додатковий шар мерехтливих відблисків поверх хвиль. */
  shimmer: boolean;
  /** Вимикає ефект повністю (кнопка «Вимкнути» у панелі керування). */
  enabled: boolean;
}

export const DEFAULT_WATER_SETTINGS: WaterCausticsSettings = {
  speed: 1,
  level: 'medium',
  frequency: 1,
  shimmer: true,
  enabled: true,
};

const LEVEL_LAYERS: Record<WaterCausticsSettings['level'], number> = {
  low: 2,
  medium: 3,
  high: 4,
  ultra: 6,
};

interface Ripple {
  x: number;
  y: number;
  born: number;
}

export interface WaterCausticsHandle {
  splash: (xRatio?: number, yRatio?: number) => void;
}

/**
 * Canvas-анімація "світлових хвиль як від води" на фоні редактора (світла
 * тема, задача: "задній фон ефект світлових хвиль як від води добавь" +
 * повний пульт керування як у мокапі "FusionWrite — Water & Caustics").
 *
 * Малює кілька шарів м'яких рухомих плям (каустика) + опційне мерехтіння
 * (shimmer) + ручні "сплески" (splash) — розширювані кільця, що гаснуть.
 * Рендериться позаду .editor-shell-glass (z-index від'ємний, pointer-events
 * none), тому не заважає жодній взаємодії з редактором.
 */
export function WaterCausticsCanvas({
  settings,
  splashRef,
}: {
  settings: WaterCausticsSettings;
  /** Викликач "сплеску" передається назовні через ref-об'єкт, щоб кнопка
      «Splash» у панелі керування могла тригернути ефект без переписування
      canvas-стану через React (анімація живе в requestAnimationFrame, не в
      React-рендерах). */
  splashRef: React.MutableRefObject<WaterCausticsHandle | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const ripplesRef = useRef<Ripple[]>([]);

  useEffect(() => {
    splashRef.current = {
      splash: (xRatio = Math.random(), yRatio = Math.random()) => {
        ripplesRef.current.push({ x: xRatio, y: yRatio, born: performance.now() });
      },
    };
    return () => {
      splashRef.current = null;
    };
  }, [splashRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const parent = canvas.parentElement;
      width = parent ? parent.clientWidth : window.innerWidth;
      height = parent ? parent.clientHeight : window.innerHeight;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const palette = ['#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#f0f9ff'];

    const draw = (t: number) => {
      const s = settingsRef.current;
      ctx.clearRect(0, 0, width, height);

      if (s.enabled) {
        const layers = LEVEL_LAYERS[s.level];
        const time = (t / 1000) * s.speed;
        // 'lighter' (адитивне змішування) замість звичайного alpha-blend —
        // плями СВІТЯТЬСЯ, накладаючись одна на одну, а не просто злегка
        // тонують тло. На темному тлі (за замовчуванням у застосунку)
        // звичайний alpha-blend на суцільному #0f172a був майже непомітний
        // — саме тому власник і повідомив, що ефект «ніде не відображається»,
        // хоча технічно вже рендерився. Підвищено й саму прозорість плям
        // (55 → 99 у hex-alpha), щоб «світіння хвиль» читалось як таке, а
        // не як ледь помітний градієнт.
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < layers; i++) {
          const freq = 0.4 + i * 0.17 * s.frequency;
          const phase = i * 1.7;
          const cx = width * (0.5 + 0.38 * Math.sin(time * freq + phase));
          const cy = height * (0.5 + 0.38 * Math.cos(time * freq * 0.8 + phase * 1.3));
          const r = Math.max(width, height) * (0.4 + 0.06 * i);
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          const color = palette[i % palette.length];
          grad.addColorStop(0, `${color}99`);
          grad.addColorStop(0.45, `${color}55`);
          grad.addColorStop(1, `${color}00`);
          ctx.fillStyle = grad;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.globalCompositeOperation = 'source-over';

        if (s.shimmer) {
          const shimmerCount = 14;
          for (let i = 0; i < shimmerCount; i++) {
            const a = (i / shimmerCount) * Math.PI * 2 + time * 0.6;
            const sx = width * 0.5 + Math.cos(a * 1.3) * width * 0.4;
            const sy = height * 0.5 + Math.sin(a * 1.7) * height * 0.4;
            const alpha = 0.12 + 0.1 * Math.sin(time * 2 + i);
            if (alpha <= 0) continue;
            ctx.beginPath();
            ctx.arc(sx, sy, 1.5 + (i % 3), 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255,255,255,${Math.max(0, alpha)})`;
            ctx.fill();
          }
        }

        // Сплески (Splash): кільця, що розширюються й гаснуть за ~2.4с.
        const now = performance.now();
        ripplesRef.current = ripplesRef.current.filter((rp) => now - rp.born < 2400);
        for (const rp of ripplesRef.current) {
          const age = (now - rp.born) / 1000;
          const progress = Math.min(1, age / 2.4);
          const radius = progress * Math.max(width, height) * 0.5;
          const alpha = (1 - progress) * 0.5;
          ctx.beginPath();
          ctx.arc(rp.x * width, rp.y * height, radius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(rp.x * width, rp.y * height, radius * 0.7, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(14,165,233,${alpha * 0.6})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 0 }}
    />
  );
}

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";

export interface SunColorTheme {
  id: string;
  name: string;
  nameEn: string;
  primary: string;       // base color
  secondary: string;     // mid gradient
  highlight: string;     // light tint
  glow: string;          // hex or rgba for outer glow
  ambientRgb: string;    // 'r, g, b' for background overlays
  gradient: string;      // CSS radial gradient
}

export const SUN_12_COLORS: SunColorTheme[] = [
  {
    id: "emerald",
    name: "Смарагд Майстра",
    nameEn: "Emerald",
    primary: "#006d37",
    secondary: "#10b981",
    highlight: "#a7f3d0",
    glow: "#10b981",
    ambientRgb: "0, 109, 55",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #a7f3d0 22%, #10b981 55%, #006d37 85%, #004d26 100%)",
  },
  {
    id: "amber",
    name: "Золоте Сяйво",
    nameEn: "Amber Gold",
    primary: "#d97706",
    secondary: "#f59e0b",
    highlight: "#fef08a",
    glow: "#f59e0b",
    ambientRgb: "245, 158, 11",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #fff5a5 22%, #f59e0b 60%, #d97706 90%, #b45309 100%)",
  },
  {
    id: "ruby",
    name: "Рубіновий Драйв",
    nameEn: "Ruby Passion",
    primary: "#b91c1c",
    secondary: "#ef4444",
    highlight: "#fecaca",
    glow: "#ef4444",
    ambientRgb: "239, 68, 68",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #fee2e2 22%, #ef4444 58%, #b91c1c 88%, #7f1d1d 100%)",
  },
  {
    id: "amethyst",
    name: "Магічний Аметист",
    nameEn: "Royal Amethyst",
    primary: "#6d28d9",
    secondary: "#8b5cf6",
    highlight: "#ddd6fe",
    glow: "#8b5cf6",
    ambientRgb: "139, 92, 246",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #ede9fe 22%, #8b5cf6 55%, #6d28d9 85%, #4c1d95 100%)",
  },
  {
    id: "sapphire",
    name: "Глибокий Сапфір",
    nameEn: "Deep Sapphire",
    primary: "#1d4ed8",
    secondary: "#3b82f6",
    highlight: "#bfdbfe",
    glow: "#3b82f6",
    ambientRgb: "59, 130, 246",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #dbeafe 22%, #3b82f6 55%, #1d4ed8 85%, #1e3a8a 100%)",
  },
  {
    id: "turquoise",
    name: "Океанічна Бірюза",
    nameEn: "Ocean Turquoise",
    primary: "#0e7490",
    secondary: "#06b6d4",
    highlight: "#cffafe",
    glow: "#06b6d4",
    ambientRgb: "6, 182, 212",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #cffafe 22%, #06b6d4 55%, #0e7490 85%, #164e63 100%)",
  },
  {
    id: "coral",
    name: "Кораловий Захід",
    nameEn: "Sunset Coral",
    primary: "#c2410c",
    secondary: "#f97316",
    highlight: "#fed7aa",
    glow: "#f97316",
    ambientRgb: "249, 115, 22",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #ffedd5 22%, #f97316 55%, #c2410c 85%, #7c2d12 100%)",
  },
  {
    id: "rose",
    name: "Рожевий Кварц",
    nameEn: "Rose Quartz",
    primary: "#be185d",
    secondary: "#ec4899",
    highlight: "#fbcfe8",
    glow: "#ec4899",
    ambientRgb: "236, 72, 153",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #fce7f3 22%, #ec4899 55%, #be185d 85%, #831843 100%)",
  },
  {
    id: "indigo",
    name: "Нічне Індиго",
    nameEn: "Midnight Indigo",
    primary: "#4338ca",
    secondary: "#6366f1",
    highlight: "#e0e7ff",
    glow: "#6366f1",
    ambientRgb: "99, 102, 241",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #e0e7ff 22%, #6366f1 55%, #4338ca 85%, #312e81 100%)",
  },
  {
    id: "lime",
    name: "Весняний Лайм",
    nameEn: "Spring Lime",
    primary: "#4d7c0f",
    secondary: "#84cc16",
    highlight: "#ecfccb",
    glow: "#84cc16",
    ambientRgb: "132, 204, 22",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #f7fee7 22%, #84cc16 55%, #4d7c0f 85%, #365314 100%)",
  },
  {
    id: "platinum",
    name: "Місячна Платина",
    nameEn: "Moon Platinum",
    primary: "#475569",
    secondary: "#94a3b8",
    highlight: "#f8fafc",
    glow: "#cbd5e1",
    ambientRgb: "148, 163, 184",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #f1f5f9 25%, #94a3b8 60%, #475569 88%, #1e293b 100%)",
  },
  {
    id: "bronze",
    name: "Антична Бронза",
    nameEn: "Warm Bronze",
    primary: "#854d0e",
    secondary: "#ca8a04",
    highlight: "#fef9c3",
    glow: "#ca8a04",
    ambientRgb: "202, 138, 4",
    gradient: "radial-gradient(circle at 35% 32%, #ffffff 0%, #fef9c3 22%, #ca8a04 55%, #854d0e 85%, #451a03 100%)",
  },
];

const TOTAL_SESSION_SECONDS = 600; // 10 minutes
const PAUSE_DURATION_SECONDS = 60; // 1 minute relax break

// Gentle Web Audio Chime Generator
function playGentleChime(type: "pause-start" | "session-resume") {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    if (type === "pause-start") {
      // 3 soft zen bell notes (Chime down then resolve warm)
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.15);

        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.15);
        gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i * 0.15 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.15 + 1.2);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 1.3);
      });
    } else {
      // Uplifting resume notes
      const notes = [440, 554.37, 659.25]; // A4, C#5, E5
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.12);

        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.12);
        gain.gain.linearRampToValueAtTime(0.09, ctx.currentTime + i * 0.12 + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.9);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 1.0);
      });
    }
  } catch (e) {
    // AudioContext maybe blocked or unsupported
  }
}

interface SunPosition {
  x: number; // in pixels
  y: number; // in pixels
}

interface SunLightingContextType {
  sunPosition: SunPosition;
  isDragging: boolean;
  setSunPosition: (pos: SunPosition) => void;
  resetSunPosition: (preset?: "top-right" | "top-left" | "center" | "bottom-right") => void;
  isAutoOrbit: boolean;
  setIsAutoOrbit: React.Dispatch<React.SetStateAction<boolean>>;

  // Site Theme (light -> shadows, dark -> glow)
  theme: "dark" | "light";

  // Sun Visibility Toggle
  isSunEnabled: boolean;
  setIsSunEnabled: (enabled: boolean) => void;
  toggleSunEnabled: () => void;

  // 12 Colors Theme
  selectedColor: SunColorTheme;
  setSelectedColor: (color: SunColorTheme) => void;

  // Ручна сила світла сонця (кільцевий повзунок навколо палітри кольорів,
  // DraggableSun.tsx) — 0.0..1.0, незалежно від прогресу сесії письма.
  sunStrength: number;
  setSunStrength: (value: number) => void;

  // 10-Minute Writer Focus & Illumination Engine
  sessionSeconds: number;
  totalSessionSeconds: number;
  isSessionRunning: boolean;
  intensityFactor: number; // 0.0 to 1.0 — max(прогрес сесії, ручна сила sunStrength)
  isPauseActive: boolean;
  pauseSecondsRemaining: number;
  toggleSessionTimer: () => void;
  resetSessionTimer: () => void;
  completePauseAndRestart: () => void;
  skipPause: () => void;
}

const SunLightingContext = createContext<SunLightingContextType | null>(null);

export const useSunLighting = () => {
  const context = useContext(SunLightingContext);
  if (!context) {
    throw new Error("useSunLighting must be used within a SunLightingProvider");
  }
  return context;
};

export const SunLightingProvider: React.FC<{
  children: React.ReactNode;
  /** Тема сайту ("dark" | "light"). Світла тема = тіні, темна = сяйво. */
  theme?: "dark" | "light";
}> = ({ children, theme: themeProp }) => {
  // Theme-aware lighting: light -> shadows, dark -> glow
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") return attr;
    }
    return themeProp || "dark";
  });

  // Sync from the prop (App's useTheme) if provided.
  useEffect(() => {
    if (themeProp) setTheme(themeProp);
  }, [themeProp]);

  // Fallback: watch <html data-theme="..."> mutations (useTheme sets it).
  useEffect(() => {
    if (themeProp) return;
    const observer = new MutationObserver(() => {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") setTheme(attr);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [themeProp]);

  // Default position at top-right (approx 78% width, 160px height)
  const [sunPosition, setSunPosition] = useState<SunPosition>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mastery_sun_position_v1");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (typeof parsed.x === "number" && typeof parsed.y === "number") {
            return {
              x: Math.min(window.innerWidth - 40, Math.max(40, parsed.x)),
              y: Math.min(window.innerHeight - 40, Math.max(40, parsed.y)),
            };
          }
        } catch (e) {
          // ignore
        }
      }
      // Домівка сонця — правий нижній кут, під панеллю керування сяйвом:
      // звідти його беруть і несуть туди, де треба підсвітити. Раніше воно
      // стартувало вгорі праворуч, у відриві від власних налаштувань, і
      // виглядало декорацією шапки, а не інструментом, який можна взяти.
      return {
        x: Math.round(window.innerWidth - 84),
        y: Math.round(window.innerHeight - 96),
      };
    }
    return { x: 900, y: 160 };
  });

  // Selected Sun Color Theme (Default: Emerald)
  const [selectedColor, setSelectedColorState] = useState<SunColorTheme>(() => {
    if (typeof window !== "undefined") {
      const savedId = localStorage.getItem("mastery_sun_color_id_v1");
      if (savedId) {
        const found = SUN_12_COLORS.find((c) => c.id === savedId);
        if (found) return found;
      }
    }
    return SUN_12_COLORS[0]; // Emerald
  });

  // Sun Visibility (Enabled / Disabled toggle)
  const [isSunEnabled, setIsSunEnabledState] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mastery_sun_enabled_v1");
      if (saved !== null) {
        return saved === "true";
      }
    }
    return true;
  });

  const setIsSunEnabled = (enabled: boolean) => {
    setIsSunEnabledState(enabled);
    try {
      localStorage.setItem("mastery_sun_enabled_v1", enabled ? "true" : "false");
    } catch (e) {
      // ignore
    }
  };

  // Ручна сила світла сонця — керується білою кулькою на кільці (радіус
  // 200px) навколо 12-кольорової палітри (DraggableSun.tsx). За замовчуванням
  // 0.5 — та сама середня яскравість, що й раніше давав середній прогрес сесії.
  const [sunStrength, setSunStrengthState] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("mastery_sun_strength_v1");
      const n = saved !== null ? Number(saved) : NaN;
      if (!Number.isNaN(n) && n >= 0 && n <= 1) return n;
    }
    return 0.5;
  });

  const setSunStrength = (value: number) => {
    const clamped = Math.min(1, Math.max(0, value));
    setSunStrengthState(clamped);
    try {
      localStorage.setItem("mastery_sun_strength_v1", String(clamped));
    } catch (e) {
      // ignore
    }
  };

  const toggleSunEnabled = () => {
    setIsSunEnabledState((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("mastery_sun_enabled_v1", next ? "true" : "false");
      } catch (e) {
        // ignore
      }
      return next;
    });
  };

  const setSelectedColor = (color: SunColorTheme) => {
    setSelectedColorState(color);
    try {
      localStorage.setItem("mastery_sun_color_id_v1", color.id);
    } catch (e) {
      // ignore
    }
  };

  const [isDragging] = useState<boolean>(false);
  const [isAutoOrbit, setIsAutoOrbit] = useState<boolean>(false);
  const animationFrameRef = useRef<number | null>(null);
  const orbitAngleRef = useRef<number>(0);

  // 10-Minute Writer Practice Session State
  const [sessionSeconds, setSessionSeconds] = useState<number>(0);
  const [isSessionRunning, setIsSessionRunning] = useState<boolean>(true);
  const [isPauseActive, setIsPauseActive] = useState<boolean>(false);
  const [pauseSecondsRemaining, setPauseSecondsRemaining] = useState<number>(PAUSE_DURATION_SECONDS);

  // Intensity factor from 0.0 to 1.0 — або природний прогрес 10-хв сесії
  // письма, або ручна сила з кільцевого повзунка (DraggableSun.tsx),
  // залежно від того, що зараз більше. Так ручне підкручування завжди
  // одразу видно, а автоматичне зростання за сесію нікуди не зникає.
  const intensityFactor = Math.max(Math.min(1.0, sessionSeconds / TOTAL_SESSION_SECONDS), sunStrength);

  // 10-minute Timer Interval Loop
  useEffect(() => {
    if (!isSessionRunning || isPauseActive) return;

    const interval = setInterval(() => {
      setSessionSeconds((prev) => {
        if (prev + 1 >= TOTAL_SESSION_SECONDS) {
          // 10 Minutes Reached -> Trigger Pause Mode!
          setIsPauseActive(true);
          setPauseSecondsRemaining(PAUSE_DURATION_SECONDS);
          playGentleChime("pause-start");
          return TOTAL_SESSION_SECONDS;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isSessionRunning, isPauseActive]);

  // Pause Mode Countdown Interval
  useEffect(() => {
    if (!isPauseActive) return;

    const interval = setInterval(() => {
      setPauseSecondsRemaining((prev) => {
        if (prev <= 1) {
          // Pause finished automatically!
          setIsPauseActive(false);
          setSessionSeconds(0);
          playGentleChime("session-resume");
          return PAUSE_DURATION_SECONDS;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isPauseActive]);

  // Actions
  const toggleSessionTimer = () => {
    setIsSessionRunning((prev) => !prev);
  };

  const resetSessionTimer = () => {
    setSessionSeconds(0);
    setIsPauseActive(false);
    setPauseSecondsRemaining(PAUSE_DURATION_SECONDS);
  };

  const completePauseAndRestart = () => {
    setIsPauseActive(false);
    setSessionSeconds(0);
    setPauseSecondsRemaining(PAUSE_DURATION_SECONDS);
    playGentleChime("session-resume");
  };

  const skipPause = () => {
    setIsPauseActive(false);
    setSessionSeconds(0);
  };

  // Update CSS Variables based on Sun position & Selected Color & Intensity
  const updateCSSLighting = useCallback(
    (x: number, y: number, color: SunColorTheme, intensityProgress: number, pauseMode: boolean, themeMode: "dark" | "light", sunEnabled: boolean) => {
      if (typeof window === "undefined") return;

      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Normalized unit vector pointing from center towards the Sun
      let ux = dist > 1 ? dx / dist : 0.707;
      let uy = dist > 1 ? dy / dist : -0.707;

      // Base intensity scaling
      const baseDistIntensity = Math.min(1.25, Math.max(0.75, dist / (Math.min(window.innerWidth, window.innerHeight) * 0.4)));

      // Extra boost from the 10-minute writer focus session (from 1x up to 1.35x)
      const sessionBoost = 1 + intensityProgress * 0.35;
      const finalIntensity = baseDistIntensity * sessionBoost;

      // Shadow offset distances (pixels)
      const baseDist = 8 * finalIntensity;
      const lgDist = 14 * finalIntensity;
      const softDist = 4.5 * finalIntensity;
      const hoverDist = 11 * finalIntensity;
      const insetDist = 3.5 * finalIntensity;

      // 1. Light Highlight (toward the sun: ux, uy)
      const lightX = Math.round(ux * baseDist * 10) / 10;
      const lightY = Math.round(uy * baseDist * 10) / 10;

      // 2. Dark Shadow (opposite to the sun: -ux, -uy)
      const shadowX = Math.round(-ux * baseDist * 10) / 10;
      const shadowY = Math.round(-uy * baseDist * 10) / 10;

      // Large variants
      const lightLgX = Math.round(ux * lgDist * 10) / 10;
      const lightLgY = Math.round(uy * lgDist * 10) / 10;
      const shadowLgX = Math.round(-ux * lgDist * 10) / 10;
      const shadowLgY = Math.round(-uy * lgDist * 10) / 10;

      // Soft variants
      const lightSoftX = Math.round(ux * softDist * 10) / 10;
      const lightSoftY = Math.round(uy * softDist * 10) / 10;
      const shadowSoftX = Math.round(-ux * softDist * 10) / 10;
      const shadowSoftY = Math.round(-uy * softDist * 10) / 10;

      // Hover variants
      const lightHoverX = Math.round(ux * hoverDist * 10) / 10;
      const lightHoverY = Math.round(uy * hoverDist * 10) / 10;
      const shadowHoverX = Math.round(-ux * hoverDist * 10) / 10;
      const shadowHoverY = Math.round(-uy * hoverDist * 10) / 10;

      // Inset (pressed) shadows
      const insetShadowX = Math.round(ux * insetDist * 10) / 10;
      const insetShadowY = Math.round(uy * insetDist * 10) / 10;
      const insetLightX = Math.round(-ux * insetDist * 10) / 10;
      const insetLightY = Math.round(-uy * insetDist * 10) / 10;

      // Неоморфні кольори тіні/хайлайту — як у референсному коді з архіву:
      // завжди СІРА тінь + білий хайлайт. Напрямок світла задає сонце
      // (light — до сонця, shadow — від сонця).
      // У темній темі ефект для .neo-* бере АВРОРА (--glow-c1..c3 та
      // --glow-intensity) через CSS-перевизначення [data-theme="dark"],
      // тож тут тримаємо стандартні сірі значення незалежно від теми.
      const shadowColor = "#bebebe";
      const shadowColorLg = "#b8b8b8";
      const shadowColorSoft = "#d1d1d1";
      const highlightColor = "#ffffff";

      // Set properties on document root
      const root = document.documentElement;
      root.style.setProperty("--shadow-color", shadowColor);
      root.style.setProperty("--shadow-color-lg", shadowColorLg);
      root.style.setProperty("--shadow-color-soft", shadowColorSoft);
      root.style.setProperty("--highlight-color", highlightColor);
      // Глобальний множник світіння для ВСІХ блоків сайту: перемножується
      // з --glow-intensity повзунка у --aurora-glow-layers (index.css), тож
      // повзунок регулює сяйво всюди. 1 = повне світіння; вимкнене сонце =
      // залишкове 0.4; прогрес 10-хв сесії додає до +0.3. Позиція сонця
      // впливає на напрямок світла (--sun-shadow-*/--sun-light-*) та на
      // амбієнтний ореол (SunAmbientOverlay), тому тут позицію не множимо.
      const glowFactor = sunEnabled ? 1 + intensityProgress * 0.3 : 0.4;
      root.style.setProperty("--sun-glow-opacity", glowFactor.toFixed(3));
      root.style.setProperty("--sun-glow-color", color.glow);

      root.style.setProperty("--sun-shadow-x", `${shadowX}px`);
      root.style.setProperty("--sun-shadow-y", `${shadowY}px`);
      root.style.setProperty("--sun-light-x", `${lightX}px`);
      root.style.setProperty("--sun-light-y", `${lightY}px`);

      root.style.setProperty("--sun-shadow-lg-x", `${shadowLgX}px`);
      root.style.setProperty("--sun-shadow-lg-y", `${shadowLgY}px`);
      root.style.setProperty("--sun-light-lg-x", `${lightLgX}px`);
      root.style.setProperty("--sun-light-lg-y", `${lightLgY}px`);

      root.style.setProperty("--sun-shadow-soft-x", `${shadowSoftX}px`);
      root.style.setProperty("--sun-shadow-soft-y", `${shadowSoftY}px`);
      root.style.setProperty("--sun-light-soft-x", `${lightSoftX}px`);
      root.style.setProperty("--sun-light-soft-y", `${lightSoftY}px`);

      root.style.setProperty("--sun-shadow-hover-x", `${shadowHoverX}px`);
      root.style.setProperty("--sun-shadow-hover-y", `${shadowHoverY}px`);
      root.style.setProperty("--sun-light-hover-x", `${lightHoverX}px`);
      root.style.setProperty("--sun-light-hover-y", `${lightHoverY}px`);

      root.style.setProperty("--sun-inset-shadow-x", `${insetShadowX}px`);
      root.style.setProperty("--sun-inset-shadow-y", `${insetShadowY}px`);
      root.style.setProperty("--sun-inset-light-x", `${insetLightX}px`);
      root.style.setProperty("--sun-inset-light-y", `${insetLightY}px`);

      // Color Theme variables
      root.style.setProperty("--sun-color-primary", color.primary);
      root.style.setProperty("--sun-color-secondary", color.secondary);
      root.style.setProperty("--sun-color-highlight", color.highlight);
      root.style.setProperty("--sun-color-glow", color.glow);
      root.style.setProperty("--sun-ambient-rgb", color.ambientRgb);
      root.style.setProperty("--sun-intensity-progress", intensityProgress.toString());
      root.style.setProperty("--sun-pause-active", pauseMode ? "1" : "0");

      // Angle in degrees
      const angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
      root.style.setProperty("--sun-angle-deg", `${angleDeg}deg`);
    },
    []
  );

  // Update on position / color / intensity / theme / sun-visibility changes
  useEffect(() => {
    updateCSSLighting(sunPosition.x, sunPosition.y, selectedColor, intensityFactor, isPauseActive, theme, isSunEnabled);
  }, [sunPosition, selectedColor, intensityFactor, isPauseActive, theme, isSunEnabled, updateCSSLighting]);

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      setSunPosition((prev) => ({
        x: Math.min(window.innerWidth - 30, Math.max(30, prev.x)),
        y: Math.min(window.innerHeight - 30, Math.max(30, prev.y)),
      }));
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Auto orbit mode loop
  useEffect(() => {
    if (!isAutoOrbit || isDragging) return;

    let lastTime = performance.now();
    const animateOrbit = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;
      orbitAngleRef.current += dt * 0.5;

      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight * 0.4;
      const radiusX = window.innerWidth * 0.38;
      const radiusY = window.innerHeight * 0.28;

      const newX = centerX + Math.cos(orbitAngleRef.current) * radiusX;
      const newY = centerY + Math.sin(orbitAngleRef.current) * radiusY;

      setSunPosition({ x: newX, y: newY });
      animationFrameRef.current = requestAnimationFrame(animateOrbit);
    };

    animationFrameRef.current = requestAnimationFrame(animateOrbit);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isAutoOrbit, isDragging]);

  // Reset preset positions
  const resetSunPosition = (preset: "top-right" | "top-left" | "center" | "bottom-right" = "top-right") => {
    setIsAutoOrbit(false);
    let target = { x: window.innerWidth * 0.8, y: 150 };
    if (preset === "top-left") target = { x: window.innerWidth * 0.2, y: 150 };
    if (preset === "center") target = { x: window.innerWidth * 0.5, y: window.innerHeight * 0.4 };
    if (preset === "bottom-right") target = { x: window.innerWidth * 0.8, y: window.innerHeight * 0.75 };

    setSunPosition(target);
    try {
      localStorage.setItem("mastery_sun_position_v1", JSON.stringify(target));
    } catch (e) {
      // ignore
    }
  };

  return (
    <SunLightingContext.Provider
      value={{
        sunPosition,
        isDragging,
        setSunPosition: (pos) => {
          setSunPosition(pos);
          try {
            localStorage.setItem("mastery_sun_position_v1", JSON.stringify(pos));
          } catch (e) {
            // ignore
          }
        },
        resetSunPosition,
        isAutoOrbit,
        setIsAutoOrbit,
        theme,
        isSunEnabled,
        setIsSunEnabled,
        toggleSunEnabled,
        sunStrength,
        setSunStrength,
        selectedColor,
        setSelectedColor,
        sessionSeconds,
        totalSessionSeconds: TOTAL_SESSION_SECONDS,
        isSessionRunning,
        intensityFactor,
        isPauseActive,
        pauseSecondsRemaining,
        toggleSessionTimer,
        resetSessionTimer,
        completePauseAndRestart,
        skipPause,
      }}
    >
      {children}
    </SunLightingContext.Provider>
  );
};


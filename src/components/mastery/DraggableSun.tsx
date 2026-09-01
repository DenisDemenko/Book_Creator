import React, { useState, useRef, useEffect, useCallback } from "react";
import { useSunLighting, SUN_12_COLORS, SunColorTheme } from "../../context/SunLightingContext";
import {
  Sun,
  SunDim,
  Move,
  RotateCw,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Palette,
  Play,
  Pause,
  RotateCcw,
  Check,
  Sparkles,
  Power,
  X,
  Camera,
} from "lucide-react";

/** Радіус кільця-повзунка сили сонця навколо палітри кольорів (px). */
const STRENGTH_RING_RADIUS = 200;
/** Друге, декоративне коло — трохи ширше за основне, суто для візуального ефекту. */
const STRENGTH_OUTER_RING_RADIUS = STRENGTH_RING_RADIUS + 16;
/** Радіус, на якому підписані відсотки сили (0/25/50/75/100%) — зовні обох кіл. */
const STRENGTH_LABEL_RADIUS = STRENGTH_RING_RADIUS + 42;
/** Проміжок унизу кільця (град.), де мін. і макс. НЕ стикаються — як у
 *  класичного поворотного регулятора гучності: кулька йде «в обхід зверху». */
const STRENGTH_RING_GAP_DEG = 60;
const STRENGTH_SWEEP_DEG = 360 - STRENGTH_RING_GAP_DEG;
/** Компасний кут (0° = вгору, за годинниковою) початку діапазону (strength=0). */
const STRENGTH_START_COMPASS_DEG = 180 + STRENGTH_RING_GAP_DEG / 2;

/** strength (0..1) → {x, y} кульки відносно центру сонця. */
function strengthToPoint(strength: number, radius: number): { x: number; y: number } {
  const compassDeg = STRENGTH_START_COMPASS_DEG + strength * STRENGTH_SWEEP_DEG;
  const mathRad = ((compassDeg - 90) * Math.PI) / 180;
  return { x: Math.cos(mathRad) * radius, y: Math.sin(mathRad) * radius };
}

/** Кут вказівника відносно центру → strength (0..1), із затиском у проміжку внизу. */
function pointToStrength(dx: number, dy: number): number {
  // Компасний кут вказівника (0° = вгору, за годинниковою стрілкою).
  const compassDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const normalized = ((compassDeg % 360) + 360) % 360;
  const delta = ((normalized - STRENGTH_START_COMPASS_DEG) % 360 + 360) % 360;
  if (delta <= STRENGTH_SWEEP_DEG) {
    return delta / STRENGTH_SWEEP_DEG;
  }
  // У проміжку внизу — прилипаємо до ближчого краю (0 чи 1).
  const gapMid = STRENGTH_SWEEP_DEG + STRENGTH_RING_GAP_DEG / 2;
  return delta < gapMid ? 1 : 0;
}

export const DraggableSun: React.FC<{ onScreenshotForAi?: (file: File) => void }> = ({ onScreenshotForAi }) => {
  const {
    sunPosition,
    setSunPosition,
    resetSunPosition,
    isAutoOrbit,
    setIsAutoOrbit,
    isSunEnabled,
    setIsSunEnabled,
    toggleSunEnabled,
    selectedColor,
    setSelectedColor,
    sunStrength,
    setSunStrength,
    sessionSeconds,
    totalSessionSeconds,
    isSessionRunning,
    intensityFactor,
    isPauseActive,
    toggleSessionTimer,
    resetSessionTimer,
  } = useSunLighting();

  const [isStrengthDragging, setIsStrengthDragging] = useState(false);
  const strengthRingRef = useRef<HTMLDivElement>(null);

  const [isPointerDown, setIsPointerDown] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showToolbar, setShowToolbar] = useState(false);
  const [showColorWheel, setShowColorWheel] = useState(false);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [scrollDirection, setScrollDirection] = useState<"up" | "down" | null>(null);

  const orbRef = useRef<HTMLDivElement>(null);
  const scrollAnimFrameRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const pointerStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastTapTimeRef = useRef<number>(0);

  /**
   * Знаходить реальний контейнер прокрутки під курсором/на сторінці.
   * У студії контент живе у вкладеному overflow-y-auto (напр. .mastery-fw),
   * а не у вікні — тому window.scrollBy там нічого не скролить. Шукаємо
   * видимий скрол-контейнер (спершу вкладку Майстерності), інакше вікно.
   */
  const getScrollTarget = useCallback((): Element => {
    const doc = typeof document !== "undefined" ? document : null;
    if (!doc) return {} as Element;
    // 1) Контейнер вкладки Майстерності (укладений overflow-y-auto)
    const mastery = doc.querySelector<HTMLElement>(".mastery-fw .overflow-y-auto");
    if (mastery && mastery.scrollHeight > mastery.clientHeight + 20) return mastery;
    // 2) Найглибший видимий елемент з прокруткою
    const candidates = Array.from(doc.querySelectorAll<HTMLElement>("*")).filter((el) => {
      if (el === doc.body || el === doc.documentElement) return false;
      const s = getComputedStyle(el);
      return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 20;
    });
    for (let i = candidates.length - 1; i >= 0; i--) {
      const r = candidates[i].getBoundingClientRect();
      if (r.height > 120 && r.width > 240) return candidates[i];
    }
    return doc.scrollingElement || doc.documentElement;
  }, []);

  // Auto-scroll loop when sun is dragged above or below viewport center
  useEffect(() => {
    if (!isPointerDown) {
      setScrollDirection(null);
      if (scrollAnimFrameRef.current) {
        cancelAnimationFrame(scrollAnimFrameRef.current);
        scrollAnimFrameRef.current = null;
      }
      return;
    }

    const checkAndScroll = () => {
      const vh = window.innerHeight;
      const centerY = vh / 2;
      const deadzone = vh * 0.12; // 12% neutral buffer around center
      const currentY = sunPosition.y;

      let scrollDelta = 0;

      if (currentY < centerY - deadzone) {
        // Above center -> Scroll UP
        const ratio = Math.min(1, Math.max(0, (centerY - deadzone - currentY) / (centerY - deadzone)));
        scrollDelta = -Math.round(ratio * 22); // up to 22px per frame
        setScrollDirection("up");
      } else if (currentY > centerY + deadzone) {
        // Below center -> Scroll DOWN
        const ratio = Math.min(1, Math.max(0, (currentY - (centerY + deadzone)) / (vh - centerY - deadzone)));
        scrollDelta = Math.round(ratio * 22); // up to 22px per frame
        setScrollDirection("down");
      } else {
        setScrollDirection(null);
      }

      if (scrollDelta !== 0) {
        getScrollTarget().scrollBy({
          top: scrollDelta,
          behavior: "auto",
        });
      }

      scrollAnimFrameRef.current = requestAnimationFrame(checkAndScroll);
    };

    scrollAnimFrameRef.current = requestAnimationFrame(checkAndScroll);

    return () => {
      if (scrollAnimFrameRef.current) {
        cancelAnimationFrame(scrollAnimFrameRef.current);
      }
    };
  }, [isPointerDown, sunPosition.y, getScrollTarget]);

  // Handle right-click on the sun to open 12-color radial wheel
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowColorWheel((prev) => !prev);
  };

  // Handle pointer down (Left mouse button / Touch)
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only respond to main/left button (button === 0) for dragging
    if (e.button !== 0) return;

    // Check for double tap on touch
    const now = Date.now();
    if (now - lastTapTimeRef.current < 300) {
      setShowColorWheel((prev) => !prev);
      lastTapTimeRef.current = 0;
      return;
    }
    lastTapTimeRef.current = now;

    pointerStartPosRef.current = { x: e.clientX, y: e.clientY };

    // Setup Long Press detection for Mobile (450ms hold opens color palette)
    if (e.pointerType === "touch") {
      longPressTimerRef.current = window.setTimeout(() => {
        setShowColorWheel(true);
        setIsPointerDown(false);
      }, 450);
    }

    // Disable auto orbit on user manual drag
    if (isAutoOrbit) {
      setIsAutoOrbit(false);
    }

    setIsPointerDown(true);
    setHasInteracted(true);

    const rect = orbRef.current?.getBoundingClientRect();
    const currentOrbX = rect ? rect.left + rect.width / 2 : sunPosition.x;
    const currentOrbY = rect ? rect.top + rect.height / 2 : sunPosition.y;

    setDragOffset({
      x: e.clientX - currentOrbX,
      y: e.clientY - currentOrbY,
    });

    if (orbRef.current) {
      orbRef.current.setPointerCapture(e.pointerId);
    }
  };

  // Handle pointer move
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isPointerDown) return;

    // Cancel long press if moved significantly
    const distMoved = Math.hypot(e.clientX - pointerStartPosRef.current.x, e.clientY - pointerStartPosRef.current.y);
    if (distMoved > 7 && longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    e.preventDefault();
    e.stopPropagation();

    const padding = 20;
    const newX = Math.min(window.innerWidth - padding, Math.max(padding, e.clientX - dragOffset.x));
    const newY = Math.min(window.innerHeight - padding, Math.max(padding, e.clientY - dragOffset.y));

    setSunPosition({ x: newX, y: newY });
  };

  // Handle pointer up (Release & Fix in place)
  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!isPointerDown) return;

    setIsPointerDown(false);
    setScrollDirection(null);
    if (orbRef.current && orbRef.current.hasPointerCapture(e.pointerId)) {
      try {
        orbRef.current.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
  };

  // Select color from wheel
  const handleSelectColor = (color: SunColorTheme, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedColor(color);
    setShowColorWheel(false);
  };

  // --- Кулька-повзунок сили сонця (кільце радіусом 200px) ---

  // Живий проміжок радіусів, у яких кульці дозволено ВІЗУАЛЬНО йти за
  // курсором під час перетягування (людська рука не веде мишку ідеальним
  // колом — курсор природно "гуляє" на ±40px від лінії). Значення сили
  // рахується лише з КУТА (як у справжнього поворотного регулятора), але
  // сама кулька, поки її тягнуть, малюється саме там, де зараз курсор
  // (у цих межах) — інакше вона "відривається" від пальця/курсора.
  const DRAG_RADIUS_MIN = STRENGTH_RING_RADIUS - 60;
  const DRAG_RADIUS_MAX = STRENGTH_RING_RADIUS + 60;
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);

  const updateStrengthFromPointer = useCallback((clientX: number, clientY: number) => {
    const ring = strengthRingRef.current;
    if (!ring) return;
    const rect = ring.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    setSunStrength(pointToStrength(dx, dy));

    const dist = Math.hypot(dx, dy) || 1;
    const clampedDist = Math.min(DRAG_RADIUS_MAX, Math.max(DRAG_RADIUS_MIN, dist));
    const scale = clampedDist / dist;
    setDragPoint({ x: dx * scale, y: dy * scale });
  }, [setSunStrength, DRAG_RADIUS_MIN, DRAG_RADIUS_MAX]);

  const handleStrengthPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setIsStrengthDragging(true);
    updateStrengthFromPointer(e.clientX, e.clientY);
  };

  /**
   * Рух/відпускання під час перетягування кульки слухаємо на WINDOW у фазі
   * ЗАХОПЛЕННЯ (capture: true), а не на самій кульці й не на фазі спливання.
   * Перша версія цього фікса слухала на спливанні — і досі "зависала", бо
   * якщо мишку відпустили над іншим елементом застосунку (сайдбар, кнопка
   * тощо), який десь у себе викликає e.stopPropagation() на pointerup,
   * подія взагалі не доходила до window на фазі спливання. Слухачі в фазі
   * ЗАХОПЛЕННЯ спрацьовують ПЕРШИМИ, ще до того, як подія дійде до цільового
   * елемента і хтось встигне викликати stopPropagation — тож ми гарантовано
   * побачимо завершення драгу, де б курсор не опинився.
   */
  useEffect(() => {
    if (!isStrengthDragging) return;

    const onMove = (e: PointerEvent) => updateStrengthFromPointer(e.clientX, e.clientY);
    const onEnd = () => {
      setIsStrengthDragging(false);
      setDragPoint(null);
    };

    window.addEventListener('pointermove', onMove, { capture: true });
    window.addEventListener('pointerup', onEnd, { capture: true });
    window.addEventListener('pointercancel', onEnd, { capture: true });
    window.addEventListener('blur', onEnd);

    return () => {
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', onEnd, { capture: true });
      window.removeEventListener('pointercancel', onEnd, { capture: true });
      window.removeEventListener('blur', onEnd);
    };
  }, [isStrengthDragging, updateStrengthFromPointer]);

  /**
   * Малює квадратний знімок поточного стану "сонечка" (кільце + кулька сили
   * + палітра кольорів + сфера сонця) на canvas і надсилає його в AI-чат
   * письменника. Без бібліотек скріншотів DOM — компонуємо той самий
   * візуал напряму на canvas, тож результат завжди квадратний PNG.
   */
  const handleScreenshotForAi = useCallback(() => {
    if (!onScreenshotForAi) return;

    const beadRadius = 62;
    const margin = 65;
    const half = STRENGTH_RING_RADIUS + margin;
    const size = half * 2;

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Фон — темна плашка, щоб знімок читався в чаті незалежно від теми.
    ctx.fillStyle = "#0b1220";
    ctx.beginPath();
    ctx.roundRect(0, 0, size, size, 24);
    ctx.fill();

    const cx = half;
    const cy = half;

    // Зовнішнє кільце-трек повзунка сили.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, STRENGTH_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Друге, декоративне коло.
    ctx.strokeStyle = `${selectedColor.glow}55`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, STRENGTH_OUTER_RING_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    // Підписи сили сяйва — 0/25/50/75/100%.
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    [0, 0.25, 0.5, 0.75, 1].forEach((s) => {
      const lp = strengthToPoint(s, STRENGTH_LABEL_RADIUS);
      ctx.fillStyle = Math.abs(sunStrength - s) < 0.06 ? "#ffffff" : "rgba(255,255,255,0.4)";
      ctx.fillText(`${Math.round(s * 100)}%`, cx + lp.x, cy + lp.y);
    });

    // 12 кольорових кульок палітри.
    SUN_12_COLORS.forEach((color, idx) => {
      const angleDeg = idx * (360 / 12) - 90;
      const angleRad = (angleDeg * Math.PI) / 180;
      const bx = cx + Math.cos(angleRad) * beadRadius;
      const by = cy + Math.sin(angleRad) * beadRadius;
      ctx.beginPath();
      ctx.arc(bx, by, 11, 0, Math.PI * 2);
      ctx.fillStyle = color.primary;
      ctx.fill();
      if (color.id === selectedColor.id) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    });

    // Центральна сфера сонця з приблизним "сяйвом" (кілька напівпрозорих кіл).
    for (let i = 4; i >= 1; i--) {
      ctx.beginPath();
      ctx.arc(cx, cy, 16 + i * 8, 0, Math.PI * 2);
      ctx.fillStyle = `${selectedColor.glow}${Math.round(18 - i * 3)
        .toString(16)
        .padStart(2, "0")}`;
      ctx.fill();
    }
    const sphereGradient = ctx.createRadialGradient(cx - 6, cy - 6, 2, cx, cy, 18);
    sphereGradient.addColorStop(0, "#ffffff");
    sphereGradient.addColorStop(0.4, selectedColor.highlight);
    sphereGradient.addColorStop(1, selectedColor.primary);
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fillStyle = sphereGradient;
    ctx.fill();

    // Біла кулька повзунка сили — на своїй поточній позиції.
    const ballPoint = strengthToPoint(sunStrength, STRENGTH_RING_RADIUS);
    ctx.beginPath();
    ctx.arc(cx + ballPoint.x, cy + ballPoint.y, 9, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = selectedColor.glow;
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Підпис із поточною силою сонця.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Сила сонця: ${Math.round(sunStrength * 100)}%`, cx, size - 18);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `sun-strength-${Date.now()}.png`, { type: "image/png" });
      onScreenshotForAi(file);
    }, "image/png");
  }, [onScreenshotForAi, selectedColor, sunStrength]);

  // Hide initial hint after 9 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasInteracted(true);
    }, 9000);
    return () => clearTimeout(timer);
  }, []);

  // Format time mm:ss
  const minutes = Math.floor(sessionSeconds / 60);
  const seconds = sessionSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;

  if (!isSunEnabled) {
    return null;
  }

  return (
    <>
      {/* 1. Backdrop when Color Wheel is open */}
      {showColorWheel && (
        <div
          onClick={() => setShowColorWheel(false)}
          className="fixed inset-0 z-[55] bg-black/20 backdrop-blur-[2px] transition-opacity duration-200"
        />
      )}

      {/*
        2. Draggable Sun Orb Element with Auto-Scroll & 12-Color Radial Palette

        Без масштабування на hover/drag: сонце — це wrapper для кільця
        повзунка сили (радіус 200px) і 12-кольорової палітри, тож будь-яке
        hover:scale-* тут ВІЗУАЛЬНО роздуває всю композицію навколо (кільця,
        підписи відсотків, кульку) щоразу, як курсор опиняється поруч під час
        перетягування — саме це й "смикало" білу кульку.
      */}
      <div
        ref={orbRef}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          left: `${sunPosition.x}px`,
          top: `${sunPosition.y}px`,
          transform: "translate(-50%, -50%)",
          touchAction: "none",
        }}
        className={`fixed z-[60] select-none cursor-grab active:cursor-grabbing ${
          isPointerDown ? "cursor-grabbing" : ""
        }`}
        title="☀️ Сонце-Навігатор: Праву кнопку миші — палітра 12 кольорів! Затисніть ліву кнопку: вище центру — скрол вгору, нижче — скрол вниз!"
      >
        {/* Outer Radiant Glow Halo (Dynamic based on 10-min intensity progress) */}
        <div
          className="absolute rounded-full pointer-events-none transition-all duration-700 blur-md"
          style={{
            inset: `-${12 + Math.round(intensityFactor * 16)}px`,
            opacity: 0.7 + intensityFactor * 0.3,
            background: `radial-gradient(circle, ${selectedColor.glow}66 0%, ${selectedColor.primary}33 60%, transparent 100%)`,
          }}
        />

        {/* Outer Flare Rings in selected color */}
        <div
          className="absolute rounded-full pointer-events-none animate-spin"
          style={{
            inset: `-${7 + Math.round(intensityFactor * 6)}px`,
            border: `1px solid ${selectedColor.highlight}80`,
            animationDuration: "24s",
          }}
        />
        <div
          className="absolute rounded-full pointer-events-none animate-spin"
          style={{
            inset: `-${4 + Math.round(intensityFactor * 4)}px`,
            border: `1px solid ${selectedColor.secondary}90`,
            animationDuration: "16s",
            animationDirection: "reverse",
          }}
        />

        {/* 3D Sun Sphere in selected 12-color theme */}
        <div
          className="relative w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all duration-150"
          style={{
            background: selectedColor.gradient,
            boxShadow: `0 0 ${16 + Math.round(intensityFactor * 18)}px ${selectedColor.glow}, 0 0 ${32 + Math.round(intensityFactor * 25)}px ${
              selectedColor.primary
            }99`,
          }}
        >
          {/* Inner Light Specular Highlight */}
          <div className="absolute top-1 left-1.5 w-2.5 h-1.5 rounded-full bg-white/95 blur-[0.5px] transform -rotate-45 pointer-events-none" />

          {/* Directional Scroll Indicator or Center Move Icon */}
          {scrollDirection === "up" ? (
            <ArrowUp className="w-4 h-4 text-white font-black animate-bounce pointer-events-none drop-shadow-md" />
          ) : scrollDirection === "down" ? (
            <ArrowDown className="w-4 h-4 text-white font-black animate-bounce pointer-events-none drop-shadow-md" />
          ) : (
            <Move
              className={`w-3.5 h-3.5 text-white/90 drop-shadow-sm transition-opacity ${
                isPointerDown ? "opacity-100" : "opacity-60 group-hover:opacity-90"
              }`}
            />
          )}

          {/* Active drag waves */}
          {isPointerDown && (
            <div className="absolute inset-0 rounded-full border border-white/90 animate-ping opacity-60 pointer-events-none" />
          )}
        </div>

        {/* RADIAL 12-COLOR PALETTE WHEEL (Triggered by Right Click or Mobile Long-Press) */}
        {showColorWheel && (
          <div ref={strengthRingRef} className="absolute inset-0 pointer-events-auto">
            {/* Center close indicator */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center text-[9px] font-black shadow-md border border-white/40">
              ✕
            </div>

            {/* Зовнішнє кільце-повзунок сили сяйва сонця (радіус 200px, проміжок
                внизу — як у класичного поворотного регулятора гучності). */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
              style={{
                width: STRENGTH_RING_RADIUS * 2,
                height: STRENGTH_RING_RADIUS * 2,
                border: "2px dashed rgba(255,255,255,0.25)",
              }}
            />

            {/* Друге, трохи ширше коло — лише для візуальної краси (тонка
                світна лінія в кольорі поточної палітри сонця). */}
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
              style={{
                width: STRENGTH_OUTER_RING_RADIUS * 2,
                height: STRENGTH_OUTER_RING_RADIUS * 2,
                border: `1px solid ${selectedColor.glow}55`,
                boxShadow: `0 0 12px ${selectedColor.glow}40`,
              }}
            />

            {/* Підписи сили сяйва — 0/25/50/75/100% навколо кільця. */}
            {[0, 0.25, 0.5, 0.75, 1].map((s) => {
              const lp = strengthToPoint(s, STRENGTH_LABEL_RADIUS);
              const isActiveLabel = Math.abs(sunStrength - s) < 0.06;
              return (
                <div
                  key={s}
                  className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-[11px] font-black whitespace-nowrap transition-colors ${
                    isActiveLabel ? "text-white" : "text-white/40"
                  }`}
                  style={{ transform: `translate(${lp.x}px, ${lp.y}px) translate(-50%, -50%)` }}
                >
                  {Math.round(s * 100)}%
                </div>
              );
            })}

            {/* Кулька-повзунок сили сяйва — тягни лівою кнопкою миші по колу.
                Поки її тягнуть, вона йде за фактичною позицією курсора (в
                межах DRAG_RADIUS_MIN..MAX) — так вона не "відривається" від
                руки, коли рука веде мишку не ідеальним колом. Значення сили
                весь час рахується лише з кута. Відпустили — кулька плавно
                (transition-transform) прилипає назад точно на лінію кільця. */}
            {(() => {
              const p = dragPoint ?? strengthToPoint(sunStrength, STRENGTH_RING_RADIUS);
              return (
                <div
                  onPointerDown={handleStrengthPointerDown}
                  title={`Сила сяйва сонця: ${Math.round(sunStrength * 100)}% (тягни по колу)`}
                  style={{
                    transform: `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`,
                    touchAction: "none",
                    boxShadow: `0 0 10px 2px ${selectedColor.glow}, 0 2px 6px rgba(0,0,0,0.4)`,
                  }}
                  className={`absolute top-1/2 left-1/2 w-5 h-5 rounded-full bg-white border-2 border-white cursor-grab z-50 ${
                    isStrengthDragging ? "cursor-grabbing" : "transition-transform duration-150"
                  }`}
                />
              );
            })()}

            {/* Кнопка "Скріншот для AI" — у проміжку внизу кільця. */}
            {onScreenshotForAi && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleScreenshotForAi();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                title="Скріншот для AI — прикріпити знімок сонця в чат письменника з AI"
                style={{ transform: `translate(-50%, ${STRENGTH_RING_RADIUS + 26}px)` }}
                className="absolute top-1/2 left-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900/90 hover:bg-slate-800 text-white text-[10px] font-extrabold border border-white/30 shadow-lg cursor-pointer whitespace-nowrap z-50"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Скріншот для AI</span>
              </button>
            )}

            {/* 12 Circular Color Beads around Sun Orb */}
            {SUN_12_COLORS.map((color, idx) => {
              const angleDeg = idx * (360 / 12) - 90;
              const angleRad = (angleDeg * Math.PI) / 180;
              const radius = 62; // distance from sun center in pixels
              const beadX = Math.round(Math.cos(angleRad) * radius);
              const beadY = Math.round(Math.sin(angleRad) * radius);
              const isCurrent = color.id === selectedColor.id;

              return (
                <button
                  key={color.id}
                  onClick={(e) => handleSelectColor(color, e)}
                  onPointerDown={(e) => e.stopPropagation()}
                  title={`${color.name} (Клік лівою для вибору)`}
                  style={{
                    transform: `translate(${beadX}px, ${beadY}px) translate(-50%, -50%)`,
                    background: color.gradient,
                    boxShadow: isCurrent ? `0 0 14px ${color.glow}, 0 0 0 2.5px #ffffff` : `0 4px 10px rgba(0,0,0,0.3)`,
                  }}
                  className={`absolute top-1/2 left-1/2 w-7 h-7 rounded-full flex items-center justify-center cursor-pointer transition-colors duration-200 z-50 ${
                    isCurrent ? "ring-2 ring-white" : "hover:ring-2 hover:ring-white/80"
                  }`}
                >
                  {isCurrent && <Check className="w-3.5 h-3.5 text-white drop-shadow-md stroke-[3]" />}
                </button>
              );
            })}

            {/* Mini Label badge */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 mt-14 bg-gray-900/90 text-white text-[10px] font-extrabold px-3 py-1 rounded-full shadow-xl whitespace-nowrap border border-white/20">
              Оберіть колір лівим кліком
            </div>
          </div>
        )}

        {/* Scroll helper indicator chip when dragging */}
        {isPointerDown && scrollDirection && (
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap text-white text-[10px] font-extrabold px-2.5 py-1 rounded-full shadow-lg pointer-events-none border border-white/40 flex items-center gap-1"
            style={{ backgroundColor: selectedColor.primary }}
          >
            {scrollDirection === "up" ? <ArrowUp className="w-3 h-3 text-white" /> : <ArrowDown className="w-3 h-3 text-white" />}
            <span>{scrollDirection === "up" ? "Скрол вгору ↑" : "Скрол вниз ↓"}</span>
          </div>
        )}

        {/* Перша підказка. Головного вона раніше не казала: що сонце можна
            ВЗЯТИ й перенести, підсвітивши будь-яке вікно. Людина бачила
            кульку в кутку й не здогадувалась, що це інструмент. Підказка
            висить над сонцем, а не під ним, бо його домівка — нижній кут,
            і знизу для неї немає місця. */}
        {!hasInteracted && (
          <div className="absolute bottom-full right-0 mb-3 w-56 bg-[#1a1c1c]/95 text-white text-[11px] font-semibold px-3 py-2 rounded-xl shadow-lg pointer-events-none animate-bounce flex items-start gap-2 border border-white/30">
            <Move className="w-3.5 h-3.5 text-amber-300 shrink-0 mt-0.5" />
            <span className="leading-snug">
              Перетягніть сонце на будь-яке вікно — воно підсвітить його.
              <span className="block mt-0.5 font-normal text-white/70">
                Права кнопка — 12 кольорів. Сила сяйва — на панелі вище.
              </span>
            </span>
          </div>
        )}
      </div>

      {/* 3. Floating Sun Control Bar at Bottom-Right */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
        {showToolbar && (
          <div className="bg-[#f9f9f9]/95 backdrop-blur-md p-4 rounded-2xl neo-extruded border border-white/80 shadow-xl flex flex-col gap-3 min-w-[270px] max-w-[320px] animate-in fade-in slide-in-from-bottom-2 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 pb-2">
              <div className="flex items-center gap-2 text-xs font-extrabold text-[#1a1c1c]">
                <span
                  className="w-3.5 h-3.5 rounded-full shadow-sm"
                  style={{ background: selectedColor.gradient }}
                />
                <span>Сонячний Фокус & Тіні</span>
              </div>
              <button
                onClick={() => setShowToolbar(false)}
                className="text-gray-400 hover:text-gray-600 p-0.5 rounded-lg cursor-pointer"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            {/* 10-Minute Writer Session Status */}
            <div className="bg-white/80 p-3 rounded-xl border border-gray-100 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase font-black text-gray-500 tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  10-Хв Спринт & Пауза
                </span>
                <span className="text-xs font-black" style={{ color: selectedColor.primary }}>
                  {formattedTime} / 10:00
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round((sessionSeconds / totalSessionSeconds) * 100)}%`,
                    background: `linear-gradient(90deg, ${selectedColor.secondary}, ${selectedColor.primary})`,
                  }}
                />
              </div>

              <div className="flex items-center gap-1.5 pt-1">
                <button
                  onClick={toggleSessionTimer}
                  className="flex-1 py-1.5 px-2 rounded-lg text-[11px] font-bold text-white flex items-center justify-center gap-1 cursor-pointer transition-all shadow-sm"
                  style={{ backgroundColor: selectedColor.primary }}
                >
                  {isSessionRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  <span>{isSessionRunning ? "Пауза таймера" : "Запустити"}</span>
                </button>
                <button
                  onClick={resetSessionTimer}
                  title="Скинути таймер"
                  className="p-1.5 rounded-lg text-gray-600 hover:bg-gray-100 cursor-pointer border border-gray-200"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* 12-Colors Grid Selection */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">
                  Палітра (12 кольорів):
                </span>
                <span className="text-[10px] font-bold text-gray-700">{selectedColor.name}</span>
              </div>
              <div className="grid grid-cols-6 gap-1.5">
                {SUN_12_COLORS.map((color) => {
                  const isCurrent = color.id === selectedColor.id;
                  return (
                    <button
                      key={color.id}
                      onClick={() => setSelectedColor(color)}
                      title={color.name}
                      style={{ background: color.gradient }}
                      className={`h-6 rounded-lg transition-transform cursor-pointer flex items-center justify-center ${
                        isCurrent ? "ring-2 ring-gray-900 scale-110 shadow-md" : "hover:scale-105 opacity-85 hover:opacity-100"
                      }`}
                    >
                      {isCurrent && <Check className="w-3 h-3 text-white drop-shadow-md stroke-[3]" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Position Presets */}
            <div className="flex flex-col gap-1.5 pt-1 border-t border-gray-200">
              <span className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Швидкі позиції:</span>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => resetSunPosition("top-right")}
                  className="neo-extruded-soft neo-button-interactive px-2 py-1.5 rounded-xl text-[10px] font-bold text-[#1a1c1c] bg-white flex items-center gap-1 justify-center cursor-pointer"
                >
                  ↗️ Верх-Право
                </button>
                <button
                  onClick={() => resetSunPosition("top-left")}
                  className="neo-extruded-soft neo-button-interactive px-2 py-1.5 rounded-xl text-[10px] font-bold text-[#1a1c1c] bg-white flex items-center gap-1 justify-center cursor-pointer"
                >
                  ↖️ Верх-Ліво
                </button>
                <button
                  onClick={() => resetSunPosition("center")}
                  className="neo-extruded-soft neo-button-interactive px-2 py-1.5 rounded-xl text-[10px] font-bold text-[#1a1c1c] bg-white flex items-center gap-1 justify-center cursor-pointer"
                >
                  ⏺️ Центр
                </button>
                <button
                  onClick={() => resetSunPosition("bottom-right")}
                  className="neo-extruded-soft neo-button-interactive px-2 py-1.5 rounded-xl text-[10px] font-bold text-[#1a1c1c] bg-white flex items-center gap-1 justify-center cursor-pointer"
                >
                  ↘️ Низ-Право
                </button>
                {/*
                  Стартова позиція сонечка — лівий нижній кут (SunLightingContext.tsx).
                  Ця кнопка веде в ту саму точку, тому вона на всю ширину й
                  підписана «Старт», а не просто «Низ-Ліво» — щоб було видно,
                  що це не п'ята довільна точка, а «додому».
                */}
                <button
                  onClick={() => resetSunPosition("bottom-left")}
                  title="Позиція старту сонечка — лівий нижній кут"
                  className="col-span-2 neo-extruded-soft neo-button-interactive px-2 py-1.5 rounded-xl text-[10px] font-bold text-[#1a1c1c] bg-white flex items-center gap-1 justify-center cursor-pointer"
                >
                  🏠 Старт (Низ-Ліво)
                </button>
              </div>
            </div>

            {/* Auto Orbit Demo Mode */}
            <div className="pt-1 flex flex-col gap-1.5">
              <button
                onClick={() => setIsAutoOrbit(!isAutoOrbit)}
                className={`w-full py-1.5 px-3 rounded-xl text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  isAutoOrbit
                    ? "bg-[#1a1c1c] text-white shadow-md animate-pulse"
                    : "neo-extruded-soft bg-white text-[#1a1c1c] hover:bg-gray-50"
                }`}
              >
                <RotateCw className={`w-3 h-3 ${isAutoOrbit ? "animate-spin" : ""}`} />
                {isAutoOrbit ? "Зупинити авто-рух" : "Авто-рух по колу"}
              </button>

              <button
                onClick={() => setIsSunEnabled(false)}
                className="w-full py-1.5 px-3 rounded-xl text-[11px] font-bold text-gray-500 hover:text-red-600 hover:bg-red-50/70 border border-gray-200 hover:border-red-200 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                title="Вимкнути відображення сонця (можна знову увімкнути у верхньому меню)"
              >
                <SunDim className="w-3.5 h-3.5" />
                <span>Вимкнути сонце</span>
              </button>
            </div>
          </div>
        )}

        {/* Toggle Button */}
        <button
          onClick={() => setShowToolbar(!showToolbar)}
          className="neo-extruded neo-button-interactive bg-[#f9f9f9] text-[#1a1c1c] px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-2 border border-white/80 shadow-md cursor-pointer hover:bg-white"
        >
          <span
            className="w-3.5 h-3.5 rounded-full shadow-sm animate-spin"
            style={{ background: selectedColor.gradient, animationDuration: "12s" }}
          />
          <span className="hidden sm:inline">Сонце (12 кольорів & 10хв)</span>
          {showToolbar ? <ChevronDown className="w-3.5 h-3.5 text-gray-500" /> : <ChevronUp className="w-3.5 h-3.5 text-gray-500" />}
        </button>
      </div>
    </>
  );
};


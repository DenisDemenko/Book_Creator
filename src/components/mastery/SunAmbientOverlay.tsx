import React from "react";
import { useSunLighting } from "../../context/SunLightingContext";
import { Coffee, Eye, Sparkles, Play, RotateCcw, CheckCircle2 } from "lucide-react";

export const SunAmbientOverlay: React.FC = () => {
  const {
    sunPosition,
    selectedColor,
    intensityFactor,
    isPauseActive,
    pauseSecondsRemaining,
    completePauseAndRestart,
    skipPause,
    sessionSeconds,
    totalSessionSeconds,
    isSunEnabled,
  } = useSunLighting();

  if (!isSunEnabled) {
    return null;
  }

  // Calculate percentage of 10-minute session
  const progressPercent = Math.min(100, Math.round((sessionSeconds / totalSessionSeconds) * 100));
  const minutes = Math.floor(sessionSeconds / 60);
  const seconds = sessionSeconds % 60;
  const formattedTime = `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;

  return (
    <>
      {/* 1. Dynamic Whole-Site Illumination Layer (Gradually intensifies over 10 minutes) */}
      <div
        className="fixed inset-0 pointer-events-none z-[15] transition-opacity duration-1000 ease-out"
        style={{
          opacity: isPauseActive ? 0.35 : Math.max(0.04, intensityFactor * 0.28),
          // 0.6 = типова інтенсивність повзунка (150pt/250): діленням на неї
          // зберігаємо поточний вигляд, а повзунок «Сайво:» тепер регулює
          // і цей амбієнтний ореол від позиції сонця.
          background: `radial-gradient(circle 900px at ${sunPosition.x}px ${sunPosition.y}px, rgba(${selectedColor.ambientRgb}, calc(${(
            0.15 + intensityFactor * 0.45
          ).toFixed(3)} * var(--glow-intensity) / 0.6)) 0%, rgba(${selectedColor.ambientRgb}, ${(
            0.05 + intensityFactor * 0.15
          ).toFixed(3)}) 45%, transparent 75%)`,
        }}
      />

      {/* 2. Top-Center Subtle Focus Progress Bar (When not in full pause) */}
      {!isPauseActive && intensityFactor > 0.05 && (
        <div className="fixed top-2 left-1/2 -translate-x-1/2 z-40 pointer-events-none transition-all duration-500 opacity-80 hover:opacity-100">
          <div className="bg-[#fdfcfc]/90 backdrop-blur-md px-3 py-1 rounded-full border border-white shadow-sm flex items-center gap-2 text-[11px] font-bold text-gray-700">
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: selectedColor.primary }}
            />
            <span>Світловий спринт: {formattedTime} / 10:00</span>
            <span className="text-gray-400">({progressPercent}%)</span>
          </div>
        </div>
      )}

      {/* 3. Mindful Rest & Illumination Pause Screen (Triggered at 10:00 mark) */}
      {isPauseActive && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/40 backdrop-blur-md animate-in fade-in duration-500">
          <div
            className="bg-[#f9f9f9] text-[#1a1c1c] max-w-md w-full rounded-3xl p-6 sm:p-8 neo-extruded border border-white relative shadow-2xl overflow-hidden flex flex-col items-center text-center gap-5 animate-in zoom-in-95 duration-300"
            style={{
              boxShadow: `0 20px 50px rgba(${selectedColor.ambientRgb}, 0.25), 0 0 0 1px rgba(255,255,255,0.8)`,
            }}
          >
            {/* Ambient Background Aura */}
            <div
              className="absolute -top-24 -left-24 w-56 h-56 rounded-full blur-3xl opacity-30 pointer-events-none animate-pulse"
              style={{ backgroundColor: selectedColor.primary }}
            />
            <div
              className="absolute -bottom-24 -right-24 w-56 h-56 rounded-full blur-3xl opacity-30 pointer-events-none animate-pulse"
              style={{ backgroundColor: selectedColor.secondary }}
            />

            {/* Header Icon & Title */}
            <div className="flex flex-col items-center gap-2">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg transition-transform duration-700"
                style={{
                  background: `linear-gradient(135deg, ${selectedColor.primary}, ${selectedColor.secondary})`,
                }}
              >
                <Coffee className="w-7 h-7 text-white animate-bounce" />
              </div>
              <span
                className="text-xs uppercase tracking-widest font-black"
                style={{ color: selectedColor.primary }}
              >
                10-ХВИЛИННИЙ СПРИНТ ЗАВЕРШЕНО
              </span>
              <h2 className="text-xl sm:text-2xl font-black tracking-tight text-[#1a1c1c]">
                Світлова Пауза для Очей і Розуму
              </h2>
            </div>

            <p className="text-xs sm:text-sm text-gray-600 leading-relaxed max-w-xs">
              Сонечко засяяло на повну силу! Зробіть коротку паузу на 60 секунд, щоб освіжити фокус і зняти напругу з очей.
            </p>

            {/* Guided Breathing Circle Animation (4-4-4 rhythm) */}
            <div className="relative w-28 h-28 flex items-center justify-center my-2">
              {/* Outer expanding ring */}
              <div
                className="absolute inset-0 rounded-full animate-ping opacity-25"
                style={{ backgroundColor: selectedColor.glow }}
              />
              {/* Pulsing breathing bubble */}
              <div
                className="w-24 h-24 rounded-full flex flex-col items-center justify-center text-white shadow-xl transition-all duration-1000 animate-pulse"
                style={{
                  background: selectedColor.gradient,
                  boxShadow: `0 0 30px rgba(${selectedColor.ambientRgb}, 0.6)`,
                }}
              >
                <span className="text-2xl font-black">{pauseSecondsRemaining}s</span>
                <span className="text-[9px] uppercase font-bold tracking-wider opacity-90">Вдих-Видих</span>
              </div>
            </div>

            {/* Micro-exercise Tips */}
            <div className="w-full grid grid-cols-2 gap-2 text-left bg-white/70 backdrop-blur-sm p-3 rounded-2xl border border-gray-100 text-[11px] text-gray-700">
              <div className="flex items-start gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                <span>Подивіться у вікно вдалину на 20 секунд</span>
              </div>
              <div className="flex items-start gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                <span>Розправте плечі та зробіть ковток води</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-2 w-full pt-1">
              <button
                onClick={completePauseAndRestart}
                className="w-full py-3 px-4 rounded-xl text-xs sm:text-sm font-extrabold text-white shadow-lg cursor-pointer flex items-center justify-center gap-2 transition-all transform hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: `linear-gradient(135deg, ${selectedColor.primary}, ${selectedColor.secondary})`,
                }}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Завершити паузу & Новий спринт</span>
              </button>

              <button
                onClick={skipPause}
                className="w-full sm:w-auto py-2.5 px-3.5 rounded-xl text-xs font-bold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 transition-all cursor-pointer whitespace-nowrap"
              >
                Пропустити
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

/**
 * Прозорість БЛОКІВ студії над фото-фоном (StudioBackdrop).
 *
 * Навіщо окремий контекст, а не localStorage у самому повзунку
 * (як у решти налаштувань GlowIntensityControl).
 * Значення потрібне у ДВОХ місцях одночасно: повзунок у блоці «Сяйво та
 * аура» (SidebarNav) його ставить, а сам шар прозорості — це CSS-змінна на
 * `:root`, яку споживає index.css (правило `.app-shell-root > …`).
 * Два джерела істини для одного значення розійшлися б (це вже траплялося з
 * `sunStrength`, див. коментар у GlowIntensityControl.tsx), тож значення
 * живе тут, а в localStorage іде лише його знімок.
 *
 * Чому CSS-змінна, а не React-стан у дереві: прозорість має діяти на ВСІ
 * блоки студії (шапка, сайдбар, робоча область), тобто на прямі діти
 * `.app-shell-root` — а серед них є й ті, які React-стан не дістане без
 * обгортки на все дерево (а обгортка зламала б флекс-розкладку шкаралупи).
 */

/** Ключ у localStorage. Той самий префікс `nova_`, що й у решти налаштувань. */
const STORAGE_KEY = 'nova_blocks_opacity';

/** За замовчуванням блоки на 75% — так просив власник. */
export const BLOCKS_OPACITY_DEFAULT = 0.75;

/**
 * Нижче цього порогу повертаємо «рятівну» пігулку (див. RescuePill у цьому ж
 * файлі). Причина: повзунок доходить до 0% і гасить повзунок теж — разом із
 * блоком «Сяйво та аура», у якому він живе. Без видимої пігулки людина
 * лишилась би з порожнім екраном і без жодного способу повернути значення
 * назад, крім ручного чищення localStorage.
 */
export const BLOCKS_OPACITY_RESCUE_BELOW = 0.2;

interface BlocksOpacityValue {
  /** 0..1 — прозорість блоків студії. */
  blocksOpacity: number;
  /** Приймає 0..1 (затискає в межі), пише в CSS-змінну й у localStorage. */
  setBlocksOpacity: (value: number) => void;
  /** Скидає до 75%. */
  resetBlocksOpacity: () => void;
}

const BlocksOpacityContext = createContext<BlocksOpacityValue | null>(null);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return BLOCKS_OPACITY_DEFAULT;
  return Math.min(1, Math.max(0, value));
}

function readInitial(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      const n = Number(stored);
      if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
    }
  } catch {
    /* localStorage недоступний (приватний режим тощо) — типове значення */
  }
  return BLOCKS_OPACITY_DEFAULT;
}

/**
 * Рятівна пігулка. Показується лише коли прозорість нижча за
 * BLOCKS_OPACITY_RESCUE_BELOW, тобто коли інтерфейсу вже майже не видно.
 * Живе окремим прямим нащадком `.app-shell-root` із класом
 * `ui-opacity-exempt` — тому сама прозорість її не чіпає (див. index.css).
 */
const RescuePill: React.FC<{ value: number; onReset: () => void }> = ({ value, onReset }) => (
  <div className="ui-opacity-exempt fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-3 rounded-2xl border border-white/25 bg-slate-950/90 px-4 py-2.5 text-slate-100 shadow-2xl backdrop-blur-md">
    <span className="text-[11px] font-semibold">
      Блоки студії прозорі на {Math.round(value * 100)}% — інтерфейс майже не видно.
    </span>
    <button
      type="button"
      onClick={onReset}
      className="rounded-xl bg-cyan-500/90 px-3 py-1.5 text-[11px] font-bold text-slate-950 transition-colors hover:bg-cyan-400"
    >
      Повернути 75%
    </button>
  </div>
);

/**
 * Тримає прозорість блоків студії, переносить її в CSS-змінну
 * `--ui-blocks-opacity` на `:root` (її читає index.css) і зберігає між
 * сесіями. DOM не обгортає нічим: рендерить дітей і — за потреби — рятівну
 * пігулку, тож розкладка `.app-shell-root` лишається незмінною.
 */
export const BlocksOpacityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [blocksOpacity, setValue] = useState<number>(readInitial);

  const setBlocksOpacity = useCallback((value: number) => {
    setValue(clamp01(value));
  }, []);

  const resetBlocksOpacity = useCallback(() => {
    setValue(BLOCKS_OPACITY_DEFAULT);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-blocks-opacity', String(blocksOpacity));
    try {
      localStorage.setItem(STORAGE_KEY, String(blocksOpacity));
    } catch {
      /* не критично */
    }
  }, [blocksOpacity]);

  const api = useMemo<BlocksOpacityValue>(
    () => ({ blocksOpacity, setBlocksOpacity, resetBlocksOpacity }),
    [blocksOpacity, setBlocksOpacity, resetBlocksOpacity]
  );

  return (
    <BlocksOpacityContext.Provider value={api}>
      {children}
      {blocksOpacity < BLOCKS_OPACITY_RESCUE_BELOW && (
        <RescuePill value={blocksOpacity} onReset={resetBlocksOpacity} />
      )}
    </BlocksOpacityContext.Provider>
  );
};

/** Значення прозорості блоків. Поза провайдером — типовий стан, не помилка. */
export function useBlocksOpacity(): BlocksOpacityValue {
  const ctx = useContext(BlocksOpacityContext);
  return (
    ctx ?? {
      blocksOpacity: BLOCKS_OPACITY_DEFAULT,
      setBlocksOpacity: () => {},
      resetBlocksOpacity: () => {},
    }
  );
}

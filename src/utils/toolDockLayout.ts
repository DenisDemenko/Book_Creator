/**
 * Чиста геометрія плаваючого блока інструментів редактора (FloatingToolDock).
 *
 * Винесено окремо від компонента, бо саме тут живуть рішення, які легко
 * зламати непомітно: до якого краю «примагнітити» блок, скільки місця
 * зарезервувати під ним у полі тексту, як затиснути збережену позицію в
 * межах вікна. Усе це перевіряється без DOM (`test:tool-dock`).
 */

export type DockEdge = 'top' | 'bottom' | 'left' | 'right';

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ToolDockState {
  /** До якого краю поля тексту прилип блок; `null` — вільно плаває. */
  dock: DockEdge | null;
  /** Позиція вільного блока (лівий верхній кут, px вікна). */
  x: number;
  y: number;
  /** Ширина вільного блока. */
  w: number;
  /** Ширина блока, прилиплого ліворуч/праворуч (вертикальна колонка). */
  vw: number;
  /** Згорнуто до самої шапки. */
  minimized: boolean;
}

export const TOOL_DOCK_MIN_WIDTH = 176;
/** Відстань до краю, з якої блок «притягується» (px). */
export const SNAP_DISTANCE = 32;
/** Проміжок між прилиплим блоком і текстом (px). */
export const DOCK_GAP = 6;

export const DEFAULT_TOOL_DOCK: ToolDockState = {
  dock: 'top',
  x: 120,
  y: 120,
  w: 760,
  vw: 200,
  minimized: false,
};

/**
 * Найближчий край поля тексту, до якого варто прилипнути, або `null`.
 * Порівнюються відповідні краї: верх блока — з верхом поля, правий край
 * блока — з правим краєм поля (тобто з лівою межею правої панелі) тощо.
 */
export function snapTarget(box: Rect, anchor: Rect, distance = SNAP_DISTANCE): DockEdge | null {
  const candidates: Array<[DockEdge, number]> = [
    ['top', Math.abs(box.top - anchor.top)],
    ['bottom', Math.abs(box.bottom - anchor.bottom)],
    ['left', Math.abs(box.left - anchor.left)],
    ['right', Math.abs(box.right - anchor.right)],
  ];
  let best: [DockEdge, number] | null = null;
  for (const c of candidates) {
    if (c[1] <= distance && (!best || c[1] < best[1])) best = c;
  }
  return best ? best[0] : null;
}

/** Відступи, які поле тексту має звільнити під прилиплим блоком. */
export function reserveFor(
  dock: DockEdge | null,
  size: { width: number; height: number }
): { top: number; bottom: number; left: number; right: number } {
  const r = { top: 0, bottom: 0, left: 0, right: 0 };
  if (!dock) return r;
  if (dock === 'top' || dock === 'bottom') r[dock] = Math.ceil(size.height) + DOCK_GAP;
  else r[dock] = Math.ceil(size.width) + DOCK_GAP;
  return r;
}

/** Збережений стан → безпечний: зіпсоване поле — типове значення, позиція — у межах вікна. */
export function normalizeToolDockState(raw: unknown, viewport: { width: number; height: number }): ToolDockState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<ToolDockState>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const dock: DockEdge | null =
    s.dock === 'top' || s.dock === 'bottom' || s.dock === 'left' || s.dock === 'right' ? s.dock : s.dock === null ? null : DEFAULT_TOOL_DOCK.dock;
  const maxW = Math.max(TOOL_DOCK_MIN_WIDTH, viewport.width - 16);
  const w = Math.min(Math.max(num(s.w, DEFAULT_TOOL_DOCK.w), TOOL_DOCK_MIN_WIDTH), maxW);
  const vw = Math.min(Math.max(num(s.vw, DEFAULT_TOOL_DOCK.vw), TOOL_DOCK_MIN_WIDTH), maxW);
  const x = Math.min(Math.max(num(s.x, DEFAULT_TOOL_DOCK.x), 0), Math.max(0, viewport.width - 80));
  const y = Math.min(Math.max(num(s.y, DEFAULT_TOOL_DOCK.y), 0), Math.max(0, viewport.height - 40));
  return { dock, x, y, w, vw, minimized: s.minimized === true };
}

/** Ширина блока в поточному стані (для прилиплого згори/знизу — ширина поля). */
export function dockWidth(state: ToolDockState, anchor: Rect): number {
  if (state.dock === 'top' || state.dock === 'bottom') return Math.max(TOOL_DOCK_MIN_WIDTH, anchor.right - anchor.left);
  if (state.dock === 'left' || state.dock === 'right') return state.vw;
  return state.w;
}

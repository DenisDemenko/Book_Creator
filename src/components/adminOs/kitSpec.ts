/**
 * Специфікація й собівартість дитячого набору-конструктора (трек K1 плану
 * GrabFusion, docs/proposals/GRABFUSION_PHOTO_COURSE_APP_2026-10-28.md, §4а).
 *
 * Набір — НЕ окремий тип товару, а ознака фізичного виробу (рішення за
 * замовчуванням плану): картка виробу вже має артикул, варіанти, склад і
 * публікацію на вітрину, тож специфікація лежить у полі `kit` тієї самої
 * картки. Модуль чистий (без React, Node і побічних ефектів): його читають і
 * редактор, і сервер, і тест — одне джерело арифметики, щоб ціна в редакторі
 * не розійшлася з ціною на сервері.
 *
 * Собівартість НЕ зберігається, а завжди рахується зі специфікації: так «зміна
 * ціни деталі перераховує набір» виконується сама собою, без «застарілих»
 * підсумків. Це ж стане єдиним джерелом для комплектації інструкції (K3) і
 * складу коробки (K5).
 *
 * Стартових цін і ставок тут немає: порожнє — це 0, а не вигадане число.
 * Єдині «розумні за замовчуванням» — націнка й крок округлення; їх змінює
 * власник у картці.
 */

import { blankSafety, normalizeSafety, safetyIssues, type KitSafety } from './kitSafety';
import type { Instruction } from '../../types';
import { normalizeKitInstruction, syncInstructionWithKit } from '../../utils/kitInstruction';

/** Підказки одиниць виміру; поле вільне, це лише datalist. */
export const KIT_UNITS = ['шт', 'компл.', 'м', 'см', 'г', 'кг', 'мл', 'л', 'арк.'] as const;

export const MAX_KIT_PARTS = 200;
export const MAX_KIT_PACKAGING = 30;
export const KIT_NAME_MAX = 120;
export const KIT_UNIT_MAX = 12;
export const KIT_MATERIAL_MAX = 80;
export const KIT_SUPPLIER_MAX = 120;
export const KIT_NOTE_MAX = 300;
export const KIT_QTY_MAX = 100_000;
export const KIT_PRICE_MAX = 10_000_000;
export const KIT_LABOR_MINUTES_MAX = 100_000;
export const KIT_MARGIN_MAX = 1000;

export const DEFAULT_KIT_MARGIN_PERCENT = 30;
export const DEFAULT_KIT_ROUND_TO_UAH = 5;

/** Рядок специфікації: деталь набору або предмет пакування. */
export interface KitLine {
  id: string;
  name: string;
  /** Кількість у ОДНОМУ наборі; дробова дозволена (0,5 м). */
  qty: number;
  unit: string;
  /** Матеріал деталі («береза 6 мм», «PLA») — для комплектації й безпеки (K2/K3). */
  material: string;
  supplier: string;
  /** Ціна за одиницю, грн. 0 — «ціну ще не вказано». */
  unitPriceUah: number;
  note: string;
}

/** Схвалена STEAM-команда, що створила конструктор (вибір із команд маркетплейсу). */
export interface KitSteamTeam {
  id: string;
  name: string;
}

export interface KitSpec {
  /** Чи є виріб набором. Вимкнений набір зберігає дані, але ніде не враховується. */
  enabled: boolean;
  /** Вік і безпека (K2): без них набір не публікується. Старі набори без поля читаються як порожні. */
  safety: KitSafety;
  parts: KitLine[];
  packaging: KitLine[];
  /** Робота майстерні на ОДИН набір, хвилин. */
  laborMinutes: number;
  /** Ставка, грн за годину. */
  laborRateUahPerHour: number;
  /** Націнка на собівартість, %. */
  marginPercent: number;
  /** Рекомендована ціна округлюється ВГОРУ до кратного цьому, грн (≥ 1). */
  roundToUah: number;
  steamTeam: KitSteamTeam | null;
  /**
   * Інструкція набору (K3): «Комплектація» і «Безпека» в ній беруться зі специфікації й
   * оновлюються при кожному збереженні картки (`normalizeKit`); решта — ручна.
   */
  instruction?: Instruction;
}

export interface KitCost {
  partsUah: number;
  packagingUah: number;
  laborUah: number;
  /** Деталі + пакування + робота. */
  totalUah: number;
  /** Націнка в грошах (до округлення ціни). */
  marginUah: number;
  /** Ціна, яку радить система; 0, коли собівартість нульова. */
  recommendedPriceUah: number;
  /** Вартість кожного рядка (деталі й пакування) за id. */
  lineTotals: Record<string, number>;
}

export function kitUid(): string {
  return `kl-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function blankKitLine(): KitLine {
  return { id: kitUid(), name: '', qty: 1, unit: 'шт', material: '', supplier: '', unitPriceUah: 0, note: '' };
}

export function blankKit(): KitSpec {
  return {
    enabled: false,
    safety: blankSafety(),
    parts: [],
    packaging: [],
    laborMinutes: 0,
    laborRateUahPerHour: 0,
    marginPercent: DEFAULT_KIT_MARGIN_PERCENT,
    roundToUah: DEFAULT_KIT_ROUND_TO_UAH,
    steamTeam: null,
  };
}

// ---------------------------------------------------------------------------
// Приведення (сервер не довіряє тілу запиту)
// ---------------------------------------------------------------------------

const clampNum = (value: unknown, min: number, max: number, fallback = 0): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.replace(',', '.')) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const clampText = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return [...text].slice(0, max).join('');
};

function normalizeLines(value: unknown, limit: number, seen: Set<string>): KitLine[] {
  if (!Array.isArray(value)) return [];
  const out: KitLine[] = [];
  for (const raw of value.slice(0, limit)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    let id = clampText(r.id, 40);
    if (!id || seen.has(id)) id = kitUid();
    seen.add(id);
    out.push({
      id,
      name: clampText(r.name, KIT_NAME_MAX),
      qty: clampNum(r.qty, 0, KIT_QTY_MAX, 0),
      unit: clampText(r.unit, KIT_UNIT_MAX) || 'шт',
      material: clampText(r.material, KIT_MATERIAL_MAX),
      supplier: clampText(r.supplier, KIT_SUPPLIER_MAX),
      unitPriceUah: Math.round(clampNum(r.unitPriceUah, 0, KIT_PRICE_MAX, 0) * 100) / 100,
      note: clampText(r.note, KIT_NOTE_MAX),
    });
  }
  return out;
}

/**
 * Специфікація із зовнішнього джерела → безпечний вигляд. `undefined` — значення
 * не схоже на специфікацію (поле `kit` просто не пишемо). Ідентифікатори
 * рядків унікальні в межах набору (дубль або порожній отримує новий).
 */
export function normalizeKit(value: unknown): KitSpec | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  const seen = new Set<string>();
  const team = v.steamTeam && typeof v.steamTeam === 'object' ? (v.steamTeam as Record<string, unknown>) : null;
  const teamId = team ? clampText(team.id, 80) : '';
  const kit: KitSpec = {
    enabled: v.enabled === true,
    safety: normalizeSafety(v.safety),
    parts: normalizeLines(v.parts, MAX_KIT_PARTS, seen),
    packaging: normalizeLines(v.packaging, MAX_KIT_PACKAGING, seen),
    laborMinutes: clampNum(v.laborMinutes, 0, KIT_LABOR_MINUTES_MAX, 0),
    laborRateUahPerHour: Math.round(clampNum(v.laborRateUahPerHour, 0, KIT_PRICE_MAX, 0) * 100) / 100,
    marginPercent: clampNum(v.marginPercent, 0, KIT_MARGIN_MAX, DEFAULT_KIT_MARGIN_PERCENT),
    roundToUah: Math.max(1, Math.round(clampNum(v.roundToUah, 1, 1000, DEFAULT_KIT_ROUND_TO_UAH))),
    steamTeam: teamId ? { id: teamId, name: clampText(team!.name, KIT_NAME_MAX) } : null,
  };
  // Інструкція набору: сміття відкидається, а комплектація й безпека доганяють специфікацію.
  const instruction = normalizeKitInstruction(v.instruction);
  if (instruction) kit.instruction = syncInstructionWithKit(instruction, kit).doc;
  return kit;
}

// ---------------------------------------------------------------------------
// Собівартість
// ---------------------------------------------------------------------------

/** Копійки цілими: накопичувати гривні з плаваючою комою означало б «0.1 + 0.2». */
const kop = (uah: number): number => Math.round(uah * 100);
const uah = (kopecks: number): number => kopecks / 100;

const lineKop = (line: Pick<KitLine, 'qty' | 'unitPriceUah'>): number => kop((Number(line.qty) || 0) * (Number(line.unitPriceUah) || 0));

/** Вартість набору за специфікацією: деталі, пакування, робота, націнка, рекомендована ціна. */
export function kitCost(kit: KitSpec | null | undefined): KitCost {
  const empty: KitCost = { partsUah: 0, packagingUah: 0, laborUah: 0, totalUah: 0, marginUah: 0, recommendedPriceUah: 0, lineTotals: {} };
  if (!kit) return empty;
  const lineTotals: Record<string, number> = {};
  let partsKop = 0;
  for (const p of kit.parts || []) {
    const k = lineKop(p);
    lineTotals[p.id] = uah(k);
    partsKop += k;
  }
  let packKop = 0;
  for (const p of kit.packaging || []) {
    const k = lineKop(p);
    lineTotals[p.id] = uah(k);
    packKop += k;
  }
  const laborKop = kop(((Number(kit.laborMinutes) || 0) / 60) * (Number(kit.laborRateUahPerHour) || 0));
  const totalKop = partsKop + packKop + laborKop;
  const margin = Math.max(0, Number(kit.marginPercent) || 0);
  const marginKop = Math.round((totalKop * margin) / 100);
  const step = Math.max(1, Math.round(Number(kit.roundToUah) || 1));
  const withMargin = uah(totalKop + marginKop);
  // Округлення вгору до кроку; epsilon не дає 100.00000000001 стати 105.
  const recommended = totalKop > 0 ? Math.ceil(withMargin / step - 1e-9) * step : 0;
  return {
    partsUah: uah(partsKop),
    packagingUah: uah(packKop),
    laborUah: uah(laborKop),
    totalUah: uah(totalKop),
    marginUah: uah(marginKop),
    recommendedPriceUah: recommended,
    lineTotals,
  };
}

/**
 * Ціна виробу з рекомендованої. `null` — застосовувати нічого (набір вимкнено
 * або собівартість ще нульова). Базова ціна й поточна збігаються: це нова
 * ціна «до знижки», знижку з закупівлі автор накладає окремо.
 */
export function kitPricePatch(kit: KitSpec | null | undefined): { priceUah: number; basePriceUah: number } | null {
  if (!kit || !kit.enabled) return null;
  const { recommendedPriceUah } = kitCost(kit);
  return recommendedPriceUah > 0 ? { priceUah: recommendedPriceUah, basePriceUah: recommendedPriceUah } : null;
}

// ---------------------------------------------------------------------------
// Перевірки
// ---------------------------------------------------------------------------

export interface KitIssues {
  /** Без цього специфікація не вважається готовою і набір не публікується (K2: сюди ж іде вік і безпека). */
  errors: string[];
  /** Не блокує, але вказує на прогалини, які спотворять собівартість. */
  warnings: string[];
}

export function kitIssues(kit: KitSpec | null | undefined): KitIssues {
  const issues: KitIssues = { errors: [], warnings: [] };
  if (!kit || !kit.enabled) return issues;
  if (kit.parts.length === 0) issues.errors.push('У наборі немає жодної деталі — додайте специфікацію.');
  kit.parts.forEach((p, i) => {
    const label = p.name.trim() ? `«${p.name.trim()}»` : `№${i + 1}`;
    if (!p.name.trim()) issues.errors.push(`Деталь ${label} без назви.`);
    if (!(p.qty > 0)) issues.errors.push(`Деталь ${label}: кількість має бути більшою за нуль.`);
    if (!(p.unitPriceUah > 0)) issues.warnings.push(`Деталь ${label}: ціну не вказано — собівартість занижена.`);
    if (!p.material.trim()) issues.warnings.push(`Деталь ${label}: не вказано матеріал.`);
  });
  const names = new Map<string, number>();
  for (const p of kit.parts) {
    const key = p.name.trim().toLowerCase();
    if (key) names.set(key, (names.get(key) || 0) + 1);
  }
  for (const [name, count] of names) {
    if (count > 1) issues.warnings.push(`Деталь «${name}» повторюється ${count} рази — обʼєднайте в один рядок із кількістю.`);
  }
  kit.packaging.forEach((p, i) => {
    const label = p.name.trim() ? `«${p.name.trim()}»` : `№${i + 1}`;
    if (!p.name.trim()) issues.errors.push(`Пакування ${label} без назви.`);
    if (!(p.qty > 0)) issues.errors.push(`Пакування ${label}: кількість має бути більшою за нуль.`);
  });
  if (!(kit.laborMinutes > 0)) issues.warnings.push('Не вказано час роботи майстерні — собівартість без роботи.');
  else if (!(kit.laborRateUahPerHour > 0)) issues.warnings.push('Вказано час роботи, але не ставку за годину — робота коштує 0.');
  if (!kit.steamTeam) issues.warnings.push('Не обрано STEAM-команду, що створила конструктор.');
  const safety = safetyIssues(kit);
  issues.errors.push(...safety.errors);
  issues.warnings.push(...safety.warnings);
  return issues;
}

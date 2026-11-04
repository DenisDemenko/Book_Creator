/**
 * Вік і безпека дитячого набору (трек K2 плану GrabFusion,
 * docs/proposals/GRABFUSION_PHOTO_COURSE_APP_2026-10-28.md, §4а).
 *
 * Поле `kit.safety` лежить у специфікації набору (K1) і, як і вона, живе в чистому
 * модулі без React і Node: його читають редактор, сервер (публікація, міст) і
 * тест — одне джерело правил, щоб клієнт не пропустив того, що сервер відхилить.
 *
 * Що тут НЕ вигадується. Жодного «безпечного за замовчуванням» віку чи попередження:
 * поки автор не відповів, поле порожнє (`null`), і це блокує публікацію. Перелік
 * матеріалів не вводиться вдруге — він збирається з поля `material` деталей
 * специфікації (одне джерело з K1/K3). Єдиний автоматичний текст — стандартне
 * попередження про дрібні деталі, бо воно прямо випливає з відповіді «є дрібні деталі».
 *
 * Документи відповідності тут — лише ПОЗНАЧКИ (назва, номер, хто видав, до якої дати):
 * самі файли з'являться з приватним сховищем у K4. Документи на вітрину не їдуть.
 *
 * Це не юридична експертиза: правило «дрібні деталі — не для дітей до 3 років» —
 * загальновідоме обмеження для іграшок, а не висновок про відповідність конкретного
 * набору вимогам закону. Відповідальність за декларацію лишається за виробником.
 */
import type { KitSpec } from './kitSpec';

/** Швидкий вибір віку; поле вільне в межах 0…18. */
export const KIT_AGE_PRESETS = [0, 3, 5, 6, 8, 10, 12, 14, 16, 18] as const;
export const KIT_AGE_MAX = 18;
/** Дрібні деталі заборонені для дітей молодших за цей вік. */
export const SMALL_PARTS_MIN_AGE = 3;

export const MAX_SAFETY_WARNINGS = 12;
export const SAFETY_WARNING_MAX = 200;
export const MAX_SAFETY_DOCS = 20;
export const SAFETY_DOC_TITLE_MAX = 120;
export const SAFETY_DOC_NUMBER_MAX = 60;
export const SAFETY_DOC_ISSUER_MAX = 120;
export const SAFETY_DOC_NOTE_MAX = 300;
export const SAFETY_MATERIALS_NOTE_MAX = 300;

/** Стандартне попередження, яке додається саме, коли автор позначив «є дрібні деталі». */
export const SMALL_PARTS_WARNING = 'Увага! Містить дрібні деталі. Не для дітей віком до 3 років — небезпека проковтування.';

/** Підказки для швидкого додавання; автор може написати власне. */
export const SAFETY_WARNING_PRESETS = [
  'Збирати разом із дорослим або під його наглядом.',
  'Після випилювання й обробки перевірте краї: гострі краї та задирки зачистіть наждачним папером.',
  'Клей, лак і фарбу використовувати лише дорослим, у провітрюваному приміщенні.',
  'Інструменти (ножівка, дриль, ніж) — лише для дорослих.',
] as const;

/** Позначка про документ відповідності (файл — у K4). */
export interface SafetyDoc {
  id: string;
  /** Що це: «Декларація відповідності», «Протокол випробувань іграшки»… */
  title: string;
  number: string;
  issuedBy: string;
  /** `YYYY-MM-DD` або порожньо — «безстроковий / не вказано». */
  validUntil: string;
  note: string;
}

export interface KitSafety {
  /** Мінімальний вік дитини, повних років (0…18). `null` — автор ще не вказав. */
  ageMinYears: number | null;
  /** Чи є дрібні деталі. `null` — автор ще не відповів. */
  smallParts: boolean | null;
  /** Власні попередження автора (без автоматичного про дрібні деталі). */
  warnings: string[];
  /** Явне «попереджень немає» — окреме підтвердження, а не мовчання. */
  noWarningsConfirmed: boolean;
  /** Додатково до списку матеріалів: «лак на водній основі», «без латексу». */
  materialsNote: string;
  documents: SafetyDoc[];
}

export function safetyUid(): string {
  return `sd-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-4)}`;
}

export function blankSafetyDoc(): SafetyDoc {
  return { id: safetyUid(), title: '', number: '', issuedBy: '', validUntil: '', note: '' };
}

export function blankSafety(): KitSafety {
  return { ageMinYears: null, smallParts: null, warnings: [], noWarningsConfirmed: false, materialsNote: '', documents: [] };
}

// ---------------------------------------------------------------------------
// Приведення (сервер не довіряє тілу запиту)
// ---------------------------------------------------------------------------

const clampText = (value: unknown, max: number): string => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return [...text].slice(0, max).join('');
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const cleanDate = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!ISO_DATE.test(text)) return '';
  const d = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== text ? '' : text;
};

const cleanAge = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.min(KIT_AGE_MAX, Math.max(0, Math.floor(n)));
};

/** Завжди повертає безпечний вигляд: чуже або відсутнє значення дає порожню (неповну) безпеку. */
export function normalizeSafety(value: unknown): KitSafety {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return blankSafety();
  const v = value as Record<string, unknown>;
  const seenWarn = new Set<string>();
  const warnings: string[] = [];
  for (const raw of Array.isArray(v.warnings) ? v.warnings : []) {
    const text = clampText(raw, SAFETY_WARNING_MAX);
    const key = text.toLowerCase();
    // Автоматичне попередження не дублюємо: воно додається з відповіді про дрібні деталі.
    if (!text || key === SMALL_PARTS_WARNING.toLowerCase() || seenWarn.has(key)) continue;
    seenWarn.add(key);
    warnings.push(text);
    if (warnings.length >= MAX_SAFETY_WARNINGS) break;
  }
  const seenIds = new Set<string>();
  const documents: SafetyDoc[] = [];
  for (const raw of (Array.isArray(v.documents) ? v.documents : []).slice(0, MAX_SAFETY_DOCS)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    let id = clampText(r.id, 40);
    if (!id || seenIds.has(id)) id = safetyUid();
    seenIds.add(id);
    documents.push({
      id,
      title: clampText(r.title, SAFETY_DOC_TITLE_MAX),
      number: clampText(r.number, SAFETY_DOC_NUMBER_MAX),
      issuedBy: clampText(r.issuedBy, SAFETY_DOC_ISSUER_MAX),
      validUntil: cleanDate(r.validUntil),
      note: clampText(r.note, SAFETY_DOC_NOTE_MAX),
    });
  }
  const smallParts = v.smallParts === true ? true : v.smallParts === false ? false : null;
  return {
    ageMinYears: cleanAge(v.ageMinYears),
    smallParts,
    warnings,
    // «Попереджень немає» має сенс лише тоді, коли їх справді немає.
    noWarningsConfirmed: v.noWarningsConfirmed === true && warnings.length === 0 && smallParts !== true,
    materialsNote: clampText(v.materialsNote, SAFETY_MATERIALS_NOTE_MAX),
    documents,
  };
}

// ---------------------------------------------------------------------------
// Похідні дані (вітрина, інструкція, етикетка)
// ---------------------------------------------------------------------------

export function ageLabel(ageMinYears: number | null | undefined): string {
  return typeof ageMinYears === 'number' ? `${ageMinYears}+` : '';
}

/** Унікальні матеріали деталей специфікації в порядку появи (без урахування регістру). */
export function kitMaterials(kit: Pick<KitSpec, 'parts'> | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of kit?.parts || []) {
    const m = String(p.material || '').replace(/\s+/g, ' ').trim();
    const key = m.toLowerCase();
    if (!m || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

/** Усі попередження, які побачить покупець: автоматичне про дрібні деталі — першим. */
export function effectiveWarnings(safety: KitSafety | null | undefined): string[] {
  if (!safety) return [];
  return [...(safety.smallParts === true ? [SMALL_PARTS_WARNING] : []), ...safety.warnings];
}

export interface KitSafetyIssues {
  errors: string[];
  warnings: string[];
}

const todayIso = (now: Date): string => now.toISOString().slice(0, 10);

/**
 * Перевірки безпеки. Помилки блокують публікацію (K2: «набір без віку й попереджень
 * не публікується»); застереження лише підказують. Для вимкненого набору — порожньо.
 */
export function safetyIssues(kit: KitSpec | null | undefined, now: Date = new Date()): KitSafetyIssues {
  const issues: KitSafetyIssues = { errors: [], warnings: [] };
  if (!kit || !kit.enabled) return issues;
  const s = kit.safety ?? blankSafety();
  if (s.ageMinYears === null) issues.errors.push('Вікова група не вказана: оберіть, з якого віку підходить набір.');
  if (s.smallParts === null) issues.errors.push('Позначте, чи є в наборі дрібні деталі (так / ні).');
  if (s.smallParts === true && s.ageMinYears !== null && s.ageMinYears < SMALL_PARTS_MIN_AGE) {
    issues.errors.push(
      `Набір із дрібними деталями не можна позначати для дітей до ${SMALL_PARTS_MIN_AGE} років — підвищте вік або приберіть дрібні деталі.`
    );
  }
  if (effectiveWarnings(s).length === 0 && !s.noWarningsConfirmed) {
    issues.errors.push('Додайте попередження для покупця або підтвердіть, що попереджень немає.');
  }
  const materials = kitMaterials(kit);
  // Деталі без матеріалу окремо попереджає `kitIssues` (K1); тут — лише випадок, коли список порожній.
  if ((kit.parts || []).length > 0 && materials.length === 0) {
    issues.errors.push('Не вказано матеріал жодної деталі — перелік матеріалів для вітрини порожній.');
  }
  if (s.documents.length === 0) {
    issues.warnings.push('Документів відповідності не додано (декларація, протокол випробувань) — додайте позначку, коли вони будуть.');
  }
  const today = todayIso(now);
  for (const d of s.documents) {
    const label = d.title ? `«${d.title}»` : 'без назви';
    if (!d.title) issues.warnings.push('Документ відповідності без назви.');
    if (d.validUntil && d.validUntil < today) issues.warnings.push(`Документ ${label} прострочений (до ${d.validUntil}).`);
  }
  return issues;
}

/** Структура для вітрини (`attributes.safety` мосту). Документи — приватні, не їдуть. */
export interface KitSafetyPublic {
  ageMinYears: number;
  ageLabel: string;
  smallParts: boolean;
  warnings: string[];
  materials: string[];
  materialsNote: string;
}

/** `undefined` — набір вимкнено або безпека неповна (публікацію в цьому разі блокує `safetyIssues`). */
export function kitSafetyPublic(kit: KitSpec | null | undefined): KitSafetyPublic | undefined {
  if (!kit || !kit.enabled) return undefined;
  const s = kit.safety;
  if (!s || s.ageMinYears === null || s.smallParts === null) return undefined;
  return {
    ageMinYears: s.ageMinYears,
    ageLabel: ageLabel(s.ageMinYears),
    smallParts: s.smallParts,
    warnings: effectiveWarnings(s),
    materials: kitMaterials(kit),
    materialsNote: s.materialsNote,
  };
}

/**
 * Рядки для розділу «Безпека» інструкції й етикетки (K3/K5 вставляють їх; зв'язок
 * «інструкція ↔ набір» з'являється в K3). Порожній масив — безпека ще не заповнена.
 */
export function kitSafetyLines(kit: KitSpec | null | undefined): string[] {
  const pub = kitSafetyPublic(kit);
  if (!pub) return [];
  const lines = [`Вік: ${pub.ageLabel}.`, ...pub.warnings];
  if (pub.materials.length) lines.push(`Матеріали: ${pub.materials.join(', ')}${pub.materialsNote ? `. ${pub.materialsNote}` : '.'}`);
  else if (pub.materialsNote) lines.push(pub.materialsNote);
  return lines;
}

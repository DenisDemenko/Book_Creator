/**
 * Fusion Story Ontology — формат визначення онтології для реєстру схем
 * (Т5.1, `PLAN_ONTOLOGY.md`; ТЗ Graph Studio v3.0 §4).
 *
 * ЩО ЦЕ. Одна версія онтології — один JSON-документ `fusion-ontology/1`:
 * доменні групи, типи сутностей (з властивостями, UI- і AI-метаданими),
 * типи зв'язків, переліки значень і декларативні правила перевірки.
 * Версії живуть у семантичному ядрі (`ontology_versions`, міграція 0019);
 * тут — сам формат, імпорт v1.0 із документа власника, перевірка
 * структури, різниця двох версій і застосування версії до реєстру
 * (`coreEntities.ts`), яким користуються редактор, чат і правила ядра.
 *
 * МОВНЕ ПРАВИЛО (ТЗ §0). Машинні ID — англійською й незмінні: `id` типу
 * сутності — це slug із тега книги (`character`), `id` зв'язку — ключ
 * (`participates_in`), `id` властивості — транслітерація її української
 * назви (`imia` для «Ім’я»). Назви для людей — `name.en` / `name.uk`; їх
 * правка ID не змінює (критерій ТЗ §39 №30).
 *
 * Файл спільний для сервера й клієнта: без залежностей від Node чи DOM
 * (хеш версії рахує сервер — від `canonicalJson`).
 */

import {
  FACTORY_ENTITIES,
  FACTORY_ENTITY_GROUPS,
  FACTORY_ENTITY_RELATIONS,
  FACTORY_EXTRA_ALIASES,
  applyRegistry,
  relationNameEn,
  type CoreEntity,
  type CoreEntityGroup,
  type CoreEntityRelation,
  type RegistrySnapshot,
} from './coreEntities';

export const ONTOLOGY_FORMAT = 'fusion-ontology/1';
/** Одна онтологія на платформу (рішення власника §2 п.1). */
export const FUSION_ONTOLOGY_ID = 'fusion-story';

export interface LocalizedName {
  en: string;
  uk: string;
}

export type OntologyRegistry = 'base' | 'critic' | 'custom';
export type OntologyRelationRegistry = OntologyRegistry | 'spec';
export type OntologyStatus = 'active' | 'deprecated';
export const ONTOLOGY_STATUSES: OntologyStatus[] = ['active', 'deprecated'];

/** Доменна група (ТЗ §11) — 12 груп документа A–J3 (рішення власника §2 п.3). */
export interface OntologyGroup {
  id: string;
  name: LocalizedName;
  registry: OntologyRegistry;
  order: number;
}

/** Сімейство сутностей усередині групи — для маршрутизації Jev (Т5.7); у v1.0 порожньо. */
export interface OntologyFamily {
  id: string;
  groupId: string;
  name: LocalizedName;
}

export type OntologyPropertyType = 'text' | 'number' | 'date' | 'enum' | 'entity_ref';
export const ONTOLOGY_PROPERTY_TYPES: OntologyPropertyType[] = ['text', 'number', 'date', 'enum', 'entity_ref'];

/** Властивість (характеристика) типу сутності. */
export interface OntologyProperty {
  id: string;
  name: { uk: string; en?: string };
  type: OntologyPropertyType;
  /** Для `enum` — id переліку з `enums`. */
  enumId?: string | null;
  /** Для `entity_ref` — дозволені типи сутностей (null — будь-який). */
  refTypes?: string[] | null;
  required?: boolean;
}

export interface OntologyEntityType {
  /** Машинний ключ — slug тега книги. Незмінний. */
  id: string;
  name: LocalizedName;
  groupId: string;
  family: string | null;
  status: OntologyStatus;
  registry: OntologyRegistry;
  ui: { color: string; order: number };
  ai: { description: string; hints: string[] };
  properties: OntologyProperty[];
  /** Додаткові слова-ключі тега («герой» → `character`). */
  aliases: string[];
}

export interface OntologyRelationType {
  /** Машинний ключ (`participates_in`). Незмінний. */
  id: string;
  name: LocalizedName;
  example: string;
  registry: OntologyRelationRegistry;
  status: OntologyStatus;
  /** Дозволені типи початку / кінця (null — будь-які). */
  from: string[] | null;
  to: string[] | null;
  /** Обернений зв'язок (`follows` ↔ `precedes`). */
  inverse: string | null;
  ui: { order: number };
}

export interface OntologyEnum {
  id: string;
  name: LocalizedName;
  values: { id: string; name: LocalizedName }[];
}

export type OntologyRuleKind = 'required_property' | 'relation_endpoints' | 'max_per_paragraph';
export const ONTOLOGY_RULE_KINDS: OntologyRuleKind[] = ['required_property', 'relation_endpoints', 'max_per_paragraph'];

/** Декларативне правило перевірки (ТЗ §4.2 VALIDATION_RULE). */
export interface OntologyValidationRule {
  id: string;
  kind: OntologyRuleKind;
  target: 'entity' | 'relation';
  /** До яких типів застосовується (null — до всіх). */
  appliesTo: string[] | null;
  params: Record<string, unknown>;
  message: LocalizedName;
}

export interface OntologyDefinition {
  format: typeof ONTOLOGY_FORMAT;
  id: string;
  name: LocalizedName;
  groups: OntologyGroup[];
  families: OntologyFamily[];
  entityTypes: OntologyEntityType[];
  relationTypes: OntologyRelationType[];
  enums: OntologyEnum[];
  validationRules: OntologyValidationRule[];
}

// ---------------------------------------------------------------------------
// Машинні ID властивостей — транслітерація (КМУ 2010)
// ---------------------------------------------------------------------------

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ъ: '', ё: 'io',
};
/** На початку слова — інша форма (КМУ 2010): «Юрій» → `yurii`. */
const TRANSLIT_INITIAL: Record<string, string> = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };

/** Українська (чи англійська) назва → машинний ID `a-z0-9_`. */
export function machineId(label: string): string {
  const src = String(label ?? '').toLowerCase().normalize('NFC').replace(/['’ʼ`]/g, '');
  let out = '';
  let prevLetter = false;
  for (const ch of src.replace(/зг/g, 'zgh')) {
    const isLetter = /\p{L}/u.test(ch);
    if (TRANSLIT[ch] !== undefined) out += !prevLetter && TRANSLIT_INITIAL[ch] ? TRANSLIT_INITIAL[ch] : TRANSLIT[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else out += '_';
    prevLetter = isLetter || /[0-9]/.test(ch);
  }
  out = out.replace(/_+/g, '_').replace(/^_|_$/g, '');
  if (!out) return 'property';
  return /^[a-z]/.test(out) ? out : `p_${out}`;
}

/** Властивості з характеристик: ID унікальні в межах типу (`_2`, `_3` для збігів). */
export function propertiesFromCharacteristics(characteristics: readonly string[]): OntologyProperty[] {
  const used = new Set<string>();
  return characteristics.map((c) => {
    const base = machineId(c);
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
    used.add(id);
    return { id, name: { uk: c }, type: 'text' as const };
  });
}

// ---------------------------------------------------------------------------
// Імпорт v1.0 із документа власника (критерій ТЗ §39 №1)
// ---------------------------------------------------------------------------

const INVERSE: Record<string, string> = { follows: 'precedes', precedes: 'follows' };

/** Fusion Story Ontology 1.0 — заводський реєстр (118 / 39 / 12) у форматі реєстру схем. */
export function factoryOntology(): OntologyDefinition {
  const aliasesBySlug = new Map<string, string[]>();
  for (const [alias, slug] of Object.entries(FACTORY_EXTRA_ALIASES)) aliasesBySlug.set(slug, [...(aliasesBySlug.get(slug) ?? []), alias]);
  return {
    format: ONTOLOGY_FORMAT,
    id: FUSION_ONTOLOGY_ID,
    name: { en: 'Fusion Story Ontology', uk: 'Онтологія твору Fusion' },
    groups: FACTORY_ENTITY_GROUPS.map((g, i) => ({ id: g.id, name: { en: g.nameEn, uk: g.nameUk }, registry: g.registry, order: i })),
    families: [],
    entityTypes: FACTORY_ENTITIES.map((e, i) => ({
      id: e.slug,
      name: { en: e.nameEn, uk: e.nameUk },
      groupId: e.groupId,
      family: null,
      status: 'active' as const,
      registry: e.registry,
      ui: { color: e.color, order: i },
      ai: { description: '', hints: [] },
      properties: propertiesFromCharacteristics(e.characteristics),
      aliases: aliasesBySlug.get(e.slug) ?? [],
    })),
    relationTypes: FACTORY_ENTITY_RELATIONS.map((r, i) => ({
      id: r.key,
      name: { en: r.nameEn ?? relationNameEn(r.key), uk: r.nameUk },
      example: r.example,
      registry: r.registry,
      status: 'active' as const,
      from: null,
      to: null,
      inverse: INVERSE[r.key] ?? null,
      ui: { order: i },
    })),
    enums: [],
    validationRules: [],
  };
}

// ---------------------------------------------------------------------------
// Визначення → реєстр (критерій ТЗ §39 №5: UI-метадані з реєстру)
// ---------------------------------------------------------------------------

const byOrder = <T extends { ui?: { order: number }; order?: number }>(a: T, b: T) =>
  (a.ui?.order ?? a.order ?? 0) - (b.ui?.order ?? b.order ?? 0);

/** Склад реєстру `coreEntities.ts` за визначенням онтології. */
export function registrySnapshot(def: OntologyDefinition, label?: string): RegistrySnapshot {
  const groups: CoreEntityGroup[] = [...def.groups].sort(byOrder).map((g) => ({ id: g.id, nameUk: g.name.uk, nameEn: g.name.en, registry: g.registry === 'critic' ? 'critic' : g.registry === 'custom' ? 'custom' : 'base' }));
  const entities: CoreEntity[] = [...def.entityTypes].sort(byOrder).map((t) => ({
    tag: `/${t.id}`,
    slug: t.id,
    nameUk: t.name.uk,
    nameEn: t.name.en,
    groupId: t.groupId,
    color: t.ui.color,
    characteristics: t.properties.map((p) => p.name.uk),
    registry: t.registry,
    ...(t.status === 'deprecated' ? { deprecated: true } : {}),
  }));
  const relations: CoreEntityRelation[] = [...def.relationTypes].sort(byOrder).map((r) => ({
    key: r.id,
    nameUk: r.name.uk,
    nameEn: r.name.en,
    example: r.example,
    registry: r.registry,
    ...(r.status === 'deprecated' ? { deprecated: true } : {}),
  }));
  const extraAliases: Record<string, string> = {};
  for (const t of def.entityTypes) for (const a of t.aliases ?? []) extraAliases[a] = t.id;
  return { groups, entities, relations, extraAliases, label: label ?? def.id };
}

/** Застосувати версію онтології до реєстру (сервер — на старті ядра й після публікації; клієнт — після завантаження). */
export function applyOntology(def: OntologyDefinition, label?: string): void {
  applyRegistry(registrySnapshot(def, label));
}

// ---------------------------------------------------------------------------
// Перевірка структури (VALIDATE, ТЗ §4.5)
// ---------------------------------------------------------------------------

export interface OntologyIssue {
  code: string;
  /** Де саме: `entityTypes.character.ui.color`. */
  path: string;
  message: string;
}

export interface OntologyValidation {
  ok: boolean;
  errors: OntologyIssue[];
  warnings: OntologyIssue[];
}

const ENTITY_ID_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const RELATION_ID_RE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const PROPERTY_ID_RE = /^[a-z][a-z0-9_]*$/;
const GROUP_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const nonEmpty = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/**
 * Структурна перевірка визначення. Не знає про дані книг — вплив на дані
 * (вилучений тип, що має сутності) рахує життєвий цикл на сервері
 * (MIGRATION IMPACT), бо для цього потрібна база.
 */
export function validateOntology(def: OntologyDefinition): OntologyValidation {
  const errors: OntologyIssue[] = [];
  const warnings: OntologyIssue[] = [];
  const err = (code: string, path: string, message: string) => errors.push({ code, path, message });
  const warn = (code: string, path: string, message: string) => warnings.push({ code, path, message });

  if (!def || typeof def !== 'object') {
    err('bad_definition', '', 'Визначення онтології має бути об\'єктом');
    return { ok: false, errors, warnings };
  }
  if (def.format !== ONTOLOGY_FORMAT) err('bad_format', 'format', `Формат має бути «${ONTOLOGY_FORMAT}», а не «${String(def.format)}»`);
  if (!nonEmpty(def.id)) err('bad_id', 'id', 'Немає id онтології');
  for (const key of ['groups', 'families', 'entityTypes', 'relationTypes', 'enums', 'validationRules'] as const) {
    if (!Array.isArray(def[key])) err('bad_definition', key, `«${key}» має бути масивом`);
  }
  if (errors.length) return { ok: false, errors, warnings };

  const names = (n: LocalizedName | undefined, path: string, needEn = true) => {
    if (!n || !nonEmpty(n.uk)) err('missing_name', `${path}.name.uk`, 'Немає української назви');
    if (needEn && (!n || !nonEmpty(n.en))) err('missing_name', `${path}.name.en`, 'Немає англійської назви (ТЗ §0: «English (Українська)»)');
  };
  const unique = <T extends { id: string }>(items: T[], what: string, re: RegExp) => {
    const seen = new Set<string>();
    for (const it of items) {
      const path = `${what}.${it?.id ?? '?'}`;
      if (!nonEmpty(it?.id) || !re.test(it.id)) err('bad_id', path, `Машинний ID «${String(it?.id)}» не відповідає формату ${re}`);
      else if (seen.has(it.id)) err('duplicate_id', path, `ID «${it.id}» повторюється`);
      seen.add(it?.id);
    }
    return seen;
  };

  const groupIds = unique(def.groups, 'groups', GROUP_ID_RE);
  def.groups.forEach((g) => names(g.name, `groups.${g.id}`));
  const familyIds = unique(def.families, 'families', PROPERTY_ID_RE);
  for (const f of def.families) {
    names(f.name, `families.${f.id}`);
    if (!groupIds.has(f.groupId)) err('unknown_group', `families.${f.id}.groupId`, `Група «${f.groupId}» не існує`);
  }
  const enumIds = unique(def.enums, 'enums', PROPERTY_ID_RE);
  for (const en of def.enums) {
    names(en.name, `enums.${en.id}`);
    if (!Array.isArray(en.values) || !en.values.length) err('empty_enum', `enums.${en.id}.values`, 'Перелік без значень');
    else unique(en.values, `enums.${en.id}.values`, PROPERTY_ID_RE);
  }

  const typeIds = unique(def.entityTypes, 'entityTypes', ENTITY_ID_RE);
  if (!def.entityTypes.length) err('empty_ontology', 'entityTypes', 'В онтології немає жодного типу сутності');
  const aliasOwner = new Map<string, string>();
  for (const t of def.entityTypes) {
    const path = `entityTypes.${t.id}`;
    names(t.name, path);
    if (!groupIds.has(t.groupId)) err('unknown_group', `${path}.groupId`, `Група «${t.groupId}» не існує`);
    if (t.family != null && !familyIds.has(t.family)) err('unknown_family', `${path}.family`, `Сімейство «${t.family}» не існує`);
    if (t.family != null && def.families.find((f) => f.id === t.family)?.groupId !== t.groupId) {
      err('family_group_mismatch', `${path}.family`, 'Сімейство належить іншій групі');
    }
    if (!ONTOLOGY_STATUSES.includes(t.status)) err('bad_status', `${path}.status`, `Невідомий статус «${t.status}»`);
    if (!['base', 'critic', 'custom'].includes(t.registry)) err('bad_registry', `${path}.registry`, `Невідоме походження «${t.registry}»`);
    if (!t.ui || !COLOR_RE.test(t.ui.color ?? '')) err('bad_color', `${path}.ui.color`, `Колір «${t.ui?.color}» — не HEX #RRGGBB`);
    if (!t.ui || !Number.isFinite(t.ui.order)) err('bad_order', `${path}.ui.order`, 'Порядок має бути числом');
    if (!t.ai || typeof t.ai.description !== 'string' || !Array.isArray(t.ai.hints)) err('bad_ai', `${path}.ai`, 'AI-метадані: { description, hints[] }');
    if (!Array.isArray(t.properties)) err('bad_definition', `${path}.properties`, 'Властивості мають бути масивом');
    else {
      unique(t.properties, `${path}.properties`, PROPERTY_ID_RE);
      for (const p of t.properties) {
        const pp = `${path}.properties.${p.id}`;
        if (!p.name || !nonEmpty(p.name.uk)) err('missing_name', `${pp}.name.uk`, 'Немає української назви властивості');
        if (!ONTOLOGY_PROPERTY_TYPES.includes(p.type)) err('bad_property_type', `${pp}.type`, `Невідомий тип властивості «${p.type}»`);
        if (p.type === 'enum' && !enumIds.has(String(p.enumId))) err('unknown_enum', `${pp}.enumId`, `Перелік «${p.enumId}» не існує`);
      }
    }
    if (!Array.isArray(t.aliases)) err('bad_definition', `${path}.aliases`, 'Аліаси мають бути масивом');
    else
      for (const a of t.aliases) {
        const norm = String(a ?? '').trim().toLowerCase();
        if (!norm) err('bad_alias', `${path}.aliases`, 'Порожній аліас');
        else if (aliasOwner.has(norm) && aliasOwner.get(norm) !== t.id) err('alias_conflict', `${path}.aliases`, `Аліас «${a}» уже веде на «${aliasOwner.get(norm)}»`);
        else if (typeIds.has(norm) && norm !== t.id) err('alias_conflict', `${path}.aliases`, `Аліас «${a}» збігається з машинним ID іншого типу`);
        aliasOwner.set(norm, t.id);
      }
  }
  for (const t of def.entityTypes)
    for (const p of t.properties ?? [])
      for (const ref of p.refTypes ?? []) if (!typeIds.has(ref)) err('unknown_entity_type', `entityTypes.${t.id}.properties.${p.id}.refTypes`, `Тип «${ref}» не існує`);

  const relIds = unique(def.relationTypes, 'relationTypes', RELATION_ID_RE);
  for (const r of def.relationTypes) {
    const path = `relationTypes.${r.id}`;
    names(r.name, path);
    if (!ONTOLOGY_STATUSES.includes(r.status)) err('bad_status', `${path}.status`, `Невідомий статус «${r.status}»`);
    if (!['base', 'critic', 'spec', 'custom'].includes(r.registry)) err('bad_registry', `${path}.registry`, `Невідоме походження «${r.registry}»`);
    for (const end of ['from', 'to'] as const) {
      const list = r[end];
      if (list === null || list === undefined) continue;
      if (!Array.isArray(list) || !list.length) err('bad_endpoints', `${path}.${end}`, 'Кінці зв\'язку: null або непорожній список типів');
      else for (const ty of list) if (!typeIds.has(ty)) err('unknown_entity_type', `${path}.${end}`, `Тип «${ty}» не існує`);
    }
    if (r.inverse != null) {
      if (!relIds.has(r.inverse)) err('unknown_relation_type', `${path}.inverse`, `Обернений зв'язок «${r.inverse}» не існує`);
      else if (def.relationTypes.find((x) => x.id === r.inverse)?.inverse !== r.id) warn('inverse_not_mutual', `${path}.inverse`, `«${r.inverse}» не вказує «${r.id}» оберненим`);
    }
  }
  for (const r of def.relationTypes) if (r.status === 'active' && r.inverse && def.relationTypes.find((x) => x.id === r.inverse)?.status === 'deprecated') warn('inverse_deprecated', `relationTypes.${r.id}.inverse`, 'Обернений зв\'язок застарілий');

  unique(def.validationRules, 'validationRules', PROPERTY_ID_RE);
  for (const rule of def.validationRules) {
    const path = `validationRules.${rule.id}`;
    if (!ONTOLOGY_RULE_KINDS.includes(rule.kind)) err('bad_rule', `${path}.kind`, `Невідомий вид правила «${rule.kind}»`);
    if (rule.target !== 'entity' && rule.target !== 'relation') err('bad_rule', `${path}.target`, 'Ціль правила — entity або relation');
    const pool = rule.target === 'relation' ? relIds : typeIds;
    for (const id of rule.appliesTo ?? []) if (!pool.has(id)) err('bad_rule', `${path}.appliesTo`, `«${id}» не існує`);
    if (!rule.message || !nonEmpty(rule.message.uk)) err('missing_name', `${path}.message.uk`, 'Немає повідомлення правила');
    if (rule.kind === 'required_property') {
      const prop = String((rule.params ?? {}).property ?? '');
      for (const id of rule.appliesTo ?? []) {
        if (!def.entityTypes.find((t) => t.id === id)?.properties.some((p) => p.id === prop)) err('bad_rule', `${path}.params.property`, `У типу «${id}» немає властивості «${prop}»`);
      }
    }
  }

  for (const g of def.groups) if (!def.entityTypes.some((t) => t.groupId === g.id)) warn('empty_group', `groups.${g.id}`, 'Група без жодного типу');
  if (!def.entityTypes.some((t) => t.status === 'active')) err('no_active_types', 'entityTypes', 'Немає жодного активного типу сутності');

  return { ok: errors.length === 0, errors, warnings };
}

// ---------------------------------------------------------------------------
// Різниця двох версій (PREVIEW, ТЗ §4.5)
// ---------------------------------------------------------------------------

export interface OntologyChange {
  id: string;
  /** Які поля змінились: `name`, `ui.color`, `status`, `properties`… */
  fields: string[];
}

export interface OntologyDiff {
  entityTypes: { added: string[]; removed: string[]; changed: OntologyChange[]; deprecated: string[]; restored: string[] };
  relationTypes: { added: string[]; removed: string[]; changed: OntologyChange[]; deprecated: string[]; restored: string[] };
  groups: { added: string[]; removed: string[]; changed: OntologyChange[] };
  other: string[];
  /** Чи є хоч одна зміна. */
  changed: boolean;
}

/**
 * Канонічний JSON: ключі об'єктів відсортовано — однакове визначення дає
 * однаковий рядок (хеш версії, порівняння полів), хоч би як його зібрали.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as object)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function fieldDiff(a: Record<string, unknown>, b: Record<string, unknown>, fields: string[]): string[] {
  const get = (o: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((x, k) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[k] : undefined), o);
  return fields.filter((f) => canonicalJson(get(a, f)) !== canonicalJson(get(b, f)));
}

const ENTITY_FIELDS = ['name.en', 'name.uk', 'groupId', 'family', 'status', 'registry', 'ui.color', 'ui.order', 'ai', 'properties', 'aliases'];
const RELATION_FIELDS = ['name.en', 'name.uk', 'example', 'registry', 'status', 'from', 'to', 'inverse', 'ui.order'];
const GROUP_FIELDS = ['name.en', 'name.uk', 'registry', 'order'];

function diffList<T extends { id: string; status?: OntologyStatus }>(before: T[], after: T[], fields: string[]) {
  const a = new Map(before.map((x) => [x.id, x]));
  const b = new Map(after.map((x) => [x.id, x]));
  const added = after.filter((x) => !a.has(x.id)).map((x) => x.id);
  const removed = before.filter((x) => !b.has(x.id)).map((x) => x.id);
  const changed: OntologyChange[] = [];
  const deprecated: string[] = [];
  const restored: string[] = [];
  for (const [id, x] of b) {
    const old = a.get(id);
    if (!old) continue;
    const f = fieldDiff(old as unknown as Record<string, unknown>, x as unknown as Record<string, unknown>, fields);
    if (f.length) changed.push({ id, fields: f });
    if (old.status === 'active' && x.status === 'deprecated') deprecated.push(id);
    if (old.status === 'deprecated' && x.status === 'active') restored.push(id);
  }
  return { added, removed, changed, deprecated, restored };
}

/** Що змінилось від `before` (активна версія) до `after` (чернетка). */
export function diffOntologies(before: OntologyDefinition, after: OntologyDefinition): OntologyDiff {
  const entityTypes = diffList(before.entityTypes, after.entityTypes, ENTITY_FIELDS);
  const relationTypes = diffList(before.relationTypes, after.relationTypes, RELATION_FIELDS);
  const g = diffList(before.groups as (OntologyGroup & { status?: OntologyStatus })[], after.groups, GROUP_FIELDS);
  const other = (['name', 'families', 'enums', 'validationRules'] as const).filter((k) => canonicalJson(before[k]) !== canonicalJson(after[k]));
  const changed =
    other.length > 0 ||
    [entityTypes, relationTypes].some((d) => d.added.length || d.removed.length || d.changed.length) ||
    g.added.length > 0 || g.removed.length > 0 || g.changed.length > 0;
  return { entityTypes, relationTypes, groups: { added: g.added, removed: g.removed, changed: g.changed }, other, changed };
}

/** T7.5 metadata. Ownership, approval and origin are supplied only by the server. */
export const MEDIA_TYPES = [
  "IMAGE",
  "VIDEO",
  "COVER",
  "REFERENCE",
  "DOCUMENT",
  "AUDIO",
  "SOURCE_FILE",
  "OTHER",
] as const;
export const CREATIVE_MEDIA_STATUSES = [
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "REJECTED",
  "CANON",
  "ARCHIVED",
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];
export type CreativeMediaStatus = (typeof CREATIVE_MEDIA_STATUSES)[number];
export interface AiDeclaration {
  used: boolean | null;
  provider: string | null;
  model: string | null;
  generationId: string | null;
  promptReference: string | null;
  settings: Record<string, string | number | boolean>;
}
export interface MediaProvenance {
  schema: 1;
  revision: number;
  type: MediaType;
  status: CreativeMediaStatus;
  origin: "legacy" | "upload" | "ai" | "workspace";
  createdBy: string | null;
  createdAt: string;
  creativeProjectId: string | null;
  workspace: {
    assetId: string;
    rootId: string;
    parentId: string | null;
    version: number;
    revision: number;
  } | null;
  importedBy: string | null;
  importedAt: string | null;
  approval: { by: string; at: string; version: number; assetId: string } | null;
  canon: { by: string; at: string } | null;
  ai: AiDeclaration;
  declaration: { by: string; at: string } | null;
  characterIds: string[];
  locationIds: string[];
  sceneIds: string[];
  tags: string[];
}
export const emptyAi = (): AiDeclaration => ({
  used: null,
  provider: null,
  model: null,
  generationId: null,
  promptReference: null,
  settings: {},
});
export function inferMediaType(mime: string, kind: string): MediaType {
  return kind === "cover_art"
    ? "COVER"
    : mime.startsWith("image/")
      ? "IMAGE"
      : mime.startsWith("video/")
        ? "VIDEO"
        : mime.startsWith("audio/")
          ? "AUDIO"
          : mime === "application/pdf"
            ? "DOCUMENT"
            : ["application/zip", "model/gltf-binary"].includes(mime)
              ? "SOURCE_FILE"
              : "OTHER";
}
const fail = (message: string): never => {
  throw new Error(message);
};
function object(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : fail("Очікується об’єкт метаданих.");
}
function value(v: unknown, max = 200): string | null {
  if (v == null || v === "") return null;
  if (typeof v !== "string" || v.trim().length > max || /[\x00-\x1f]/.test(v))
    fail("Некоректний текст метаданих.");
  const s = (v as string).trim();
  // These fields are identifiers, not containers for credentials or full prompts.
  if (
    /(?:bearer\s|sk-[a-z0-9]{12}|api[_ -]?key\s*[:=]|secret\s*[:=]|token\s*[:=])/i.test(
      s,
    )
  )
    fail("Не передавайте секрети в метаданих.");
  return s || null;
}
export function normalizeAi(raw: unknown): AiDeclaration {
  if (raw === undefined) return emptyAi();
  const b = object(raw);
  const allowed = [
    "used",
    "provider",
    "model",
    "generationId",
    "promptReference",
    "settings",
  ];
  if (Object.keys(b).some((k) => !allowed.includes(k)))
    fail("Невідоме поле ШІ. Ключі й токени не зберігаються.");
  if (b.used !== null && typeof b.used !== "boolean")
    fail("Вкажіть, чи використано ШІ.");
  const settings = b.settings === undefined ? {} : object(b.settings);
  const allowedSettings = [
    "seed",
    "width",
    "height",
    "steps",
    "guidanceScale",
    "temperature",
    "topP",
    "aspectRatio",
    "duration",
    "fps",
    "quality",
    "style",
    "imageSize",
    "resolution",
    "negativePromptReference",
  ];
  const out: AiDeclaration = {
    used: b.used as boolean | null,
    provider: value(b.provider),
    model: value(b.model),
    generationId: value(b.generationId),
    promptReference: value(b.promptReference),
    settings: {},
  };
  for (const id of [
    out.provider,
    out.model,
    out.generationId,
    out.promptReference,
  ]) {
    if (id && !/^[\p{L}\p{N}._:/-]+$/u.test(id))
      fail(
        "Дані ШІ — ідентифікатори, без тексту промпта, підписаних URL чи облікових даних.",
      );
  }
  for (const [key, v] of Object.entries(settings)) {
    if (!allowedSettings.includes(key))
      fail("Непідтримуване налаштування ШІ. Секрети заборонені.");
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail("Некоректне число.");
      out.settings[key] = v;
    } else if (typeof v === "boolean") out.settings[key] = v;
    else if (typeof v === "string") out.settings[key] = value(v, 100) ?? "";
    else fail("Налаштування ШІ мають бути простими значеннями.");
  }
  if (out.used === true && (!out.provider || !out.model))
    fail("Для ШІ вкажіть провайдера й модель.");
  if (
    out.used !== true &&
    (out.provider ||
      out.model ||
      out.generationId ||
      out.promptReference ||
      Object.keys(out.settings).length)
  )
    fail("Дані генерації потребують позначки використання ШІ.");
  return out;
}
export type MediaMetadataInput = Pick<
  MediaProvenance,
  "type" | "status" | "characterIds" | "locationIds" | "sceneIds" | "tags"
>;
export function normalizeMediaMetadata(
  raw: unknown,
): Partial<MediaMetadataInput> {
  const b = object(raw),
    out: Partial<MediaMetadataInput> = {};
  const keys = [
    "type",
    "status",
    "characterIds",
    "locationIds",
    "sceneIds",
    "tags",
  ];
  if (Object.keys(b).some((k) => !keys.includes(k)))
    fail("Походження, авторство й затвердження змінювати не можна.");
  if (b.type !== undefined) {
    if (!(MEDIA_TYPES as readonly unknown[]).includes(b.type))
      fail("Невідомий тип матеріалу.");
    out.type = b.type as MediaType;
  }
  if (b.status !== undefined) {
    if (
      !(CREATIVE_MEDIA_STATUSES as readonly unknown[]).includes(b.status) ||
      b.status === "CANON"
    )
      fail("CANON додається окремою дією Visual Bible (Т7.6).");
    out.status = b.status as CreativeMediaStatus;
  }
  for (const key of [
    "characterIds",
    "locationIds",
    "sceneIds",
    "tags",
  ] as const) {
    if (b[key] === undefined) continue;
    if (!Array.isArray(b[key]) || b[key].length > 50)
      fail("Максимум 50 прив’язок чи тегів.");
    out[key] = [
      ...new Set(
        (b[key] as unknown[]).map(
          (v) =>
            value(v, key === "tags" ? 80 : 200) ?? fail("Порожнє значення."),
        ),
      ),
    ];
  }
  return out;
}
export function mediaMatches(
  p: MediaProvenance,
  filters: Record<string, string>,
): boolean {
  return (
    (!filters.type || p.type === filters.type) &&
    (!filters.status || p.status === filters.status) &&
    (!filters.author ||
      (filters.author === "unknown"
        ? p.createdBy === null
        : p.createdBy === filters.author)) &&
    (!filters.project || p.creativeProjectId === filters.project) &&
    (!filters.ai ||
      (filters.ai === "yes"
        ? p.ai.used === true
        : filters.ai === "no"
          ? p.ai.used === false
          : p.ai.used === null)) &&
    (!filters.tag ||
      p.tags.some((t) =>
        t.toLocaleLowerCase().includes(filters.tag.toLocaleLowerCase()),
      )) &&
    (!filters.character || p.characterIds.includes(filters.character)) &&
    (!filters.location || p.locationIds.includes(filters.location)) &&
    (!filters.scene || p.sceneIds.includes(filters.scene)) &&
    (!filters.from || p.createdAt.slice(0, 10) >= filters.from) &&
    (!filters.to || p.createdAt.slice(0, 10) <= filters.to)
  );
}

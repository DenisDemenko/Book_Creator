import { apiPath } from "../utils/basePath";
import { useState } from "react";
import {
  CREATIVE_MEDIA_STATUSES,
  MEDIA_TYPES,
  mediaMatches,
} from "../../shared/mediaProvenance";
import { MediaProvenancePanel } from "./MediaProvenancePanel";
import { MediaLinksPanel } from "./MediaLinksPanel";
import type { PassportAsset } from "./MediaPassportPanel";
import { MediaPassportPanel } from "./MediaPassportPanel";
const field = "w-full min-w-0 rounded border border-slate-700 bg-slate-950 p-2";
export function CreativeMediaLibrary({
  assets,
  onChanged,
  onReload,
  onToast,
}: {
  assets: PassportAsset[];
  onChanged: (a: PassportAsset) => void;
  onReload: () => void;
  onToast: (s: string) => void;
}) {
  const [filters, setFilters] = useState<Record<string, string>>({}),
    [selected, setSelected] = useState("");
  const pick = (
    key: string,
    label: string,
    options: Array<{ value: string; label: string }>,
  ) => (
    <label className="min-w-0">
      {label}
      <select
        className={field}
        aria-label={label}
        value={filters[key] || ""}
        onChange={(e) => setFilters({ ...filters, [key]: e.target.value })}
      >
        <option value="">Усі</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  const unique = (key: "characterIds" | "locationIds" | "sceneIds") =>
    [...new Set(assets.flatMap((a) => a.provenance?.[key] || []))].map(
      (id) => ({ value: id, label: id }),
    );
  const visible = assets.filter(
    (a) => a.provenance && mediaMatches(a.provenance, filters),
  );
  const a = assets.find((a) => a.id === selected);
  return (
    <section
      aria-label="Медіатека з походженням"
      className="space-y-4 text-slate-200 min-w-0"
    >
      <h2 className="text-lg font-bold">Медіатека з походженням</h2>
      <p>
        Усі типи файлів і версії. Приватні матеріали залишаються у вашій
        медіатеці.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        {pick(
          "type",
          "Фільтр: тип",
          MEDIA_TYPES.map((t) => ({ value: t, label: t })),
        )}
        {pick(
          "status",
          "Фільтр: статус",
          CREATIVE_MEDIA_STATUSES.map((t) => ({ value: t, label: t })),
        )}
        {pick("author", "Фільтр: автор", [
          ...new Map(
            assets
              .filter((a) => a.provenance)
              .map((a) => [
                a.provenance!.createdBy,
                {
                  value: a.provenance!.createdBy || "unknown",
                  label:
                    a.author ||
                    a.provenance!.createdBy ||
                    "Автор не зафіксований",
                },
              ]),
          ).values(),
        ])}
        {pick(
          "project",
          "Фільтр: творчий проєкт",
          [
            ...new Set(
              assets.flatMap((a) =>
                a.provenance?.creativeProjectId
                  ? [a.provenance.creativeProjectId]
                  : [],
              ),
            ),
          ].map((id) => ({ value: id, label: id })),
        )}
        {pick("ai", "Фільтр: ШІ", [
          { value: "yes", label: "Використано ШІ" },
          { value: "no", label: "Без ШІ" },
          { value: "unknown", label: "Невідомо" },
        ])}
        {pick("character", "Фільтр: персонаж", unique("characterIds"))}
        {pick("location", "Фільтр: локація", unique("locationIds"))}
        {pick("scene", "Фільтр: сцена", unique("sceneIds"))}
        {(["tag", "from", "to"] as const).map((key, i) => (
          <label key={key}>
            {" "}
            {["Фільтр: тег", "Створено від", "Створено до"][i]}
            <input
              className={field}
              aria-label={["Фільтр: тег", "Створено від", "Створено до"][i]}
              type={key === "tag" ? "text" : "date"}
              value={filters[key] || ""}
              onChange={(e) =>
                setFilters({ ...filters, [key]: e.target.value })
              }
            />
          </label>
        ))}
        <button className="rounded border p-2" onClick={() => setFilters({})}>
          Скинути фільтри
        </button>
      </div>
      <p role="status">Знайдено: {visible.length}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {visible.map((a) => (
          <button
            className="text-left border border-slate-700 rounded p-3 break-words min-w-0"
            data-provenance-asset={a.id}
            key={a.id}
            onClick={() => setSelected(a.id)}
          >
            <strong>{a.title || a.filename}</strong>
            <p>
              {a.provenance!.type} · {a.provenance!.status} · v
              {a.provenance!.workspace?.version ?? a.version}
            </p>
            <p>
              {a.author || a.provenance!.createdBy || "Автор не зафіксований"} ·{" "}
              {a.provenance!.createdAt.slice(0, 10)}
            </p>
            <p>
              {a.provenance!.ai.used === null
                ? "ШІ: невідомо"
                : a.provenance!.ai.used
                  ? "Використано ШІ"
                  : "Без ШІ"}
            </p>
          </button>
        ))}
      </div>
      {a && (
        <div
          className="border rounded p-3 min-w-0 space-y-3"
          aria-label="Матеріал медіатеки"
        >
          <button
            className="border rounded p-2"
            onClick={() => setSelected("")}
          >
            Закрити матеріал
          </button>
          <h3>{a.title || a.filename}</h3>
          {a.mimeType?.startsWith("image/") && (
            <img
              src={apiPath(a.url)}
              alt={a.altText || a.title || a.filename}
              className="max-h-96 max-w-full mx-auto"
            />
          )}
          {a.mimeType?.startsWith("video/") && (
            <video
              src={apiPath(a.url)}
              controls
              className="max-h-96 max-w-full mx-auto"
            />
          )}
          {a.mimeType?.startsWith("audio/") && (
            <audio src={apiPath(a.url)} controls className="max-w-full" />
          )}
          <a href={apiPath(a.url)} download={a.filename} className="underline">
            Завантажити оригінал ({a.mimeType})
          </a>
          <MediaProvenancePanel asset={a} onChanged={onChanged} />
          <MediaPassportPanel
            assetId={a.id}
            metadataRevision={a.provenance?.revision}
            bookId={a.bookId || ""}
            onToast={onToast}
            onChanged={onChanged}
            onNewVersion={() => {
              onReload();
              return 0;
            }}
          />
          {a.bookId && (
            <MediaLinksPanel
              bookId={a.bookId}
              assetUrl={a.url}
              onToast={onToast}
            />
          )}
        </div>
      )}
    </section>
  );
}

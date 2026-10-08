import { useEffect, useState } from "react";
import {
  MEDIA_TYPES,
  inferMediaType,
  type MediaType,
} from "../../shared/mediaProvenance";
import type { CreativeAsset } from "../../server/core/creative/workspace";
const field = "w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2";
export function WorkspaceMediaTransfer({
  asset,
  targets,
  busy,
  onTransfer,
}: {
  asset: CreativeAsset;
  targets?: {
    characters: Array<{ id: string; name: string }>;
    locations: Array<{ id: string; name: string }>;
    scenes: Array<{ id: string; name: string }>;
  } | null;
  busy: boolean;
  onTransfer: (metadata: unknown) => void;
}) {
  const [type, setType] = useState<MediaType>(
      inferMediaType(asset.mimeType, "upload"),
    ),
    [tags, setTags] = useState(""),
    [characters, setCharacters] = useState<string[]>([]),
    [locations, setLocations] = useState<string[]>([]),
    [scenes, setScenes] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    setConfirmed(false);
  }, [asset.id, asset.revision]);
  if (asset.libraryAssetId)
    return (
      <p role="status">
        v{asset.version} збережено в медіатеці. ID: {asset.libraryAssetId}.
        Походження доступне на вкладці «Походження» медіатеки книги.
      </p>
    );
  const multi = (
    label: string,
    values: string[],
    options: Array<{ id: string; name: string }>,
    set: (v: string[]) => void,
  ) => (
    <label className="block">
      {label}
      <select
        multiple
        aria-label={label}
        className={field}
        value={values}
        onChange={(e) => {
          set(Array.from(e.target.selectedOptions, (o) => o.value));
          setConfirmed(false);
        }}
      >
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <fieldset className="space-y-2 border rounded p-3 min-w-0">
      <legend>Зберегти результат у медіатеку</legend>
      <p>
        Точна затверджена версія v{asset.version}, авторство й декларація ШІ
        зберігаються. Перенесення не додає матеріал до канону та не відкриває
        доступ фахівцю до медіатеки.
      </p>
      <label className="block">
        Тип результату
        <select
          className={field}
          aria-label="Тип результату"
          value={type}
          onChange={(e) => {
            setType(e.target.value as MediaType);
            setConfirmed(false);
          }}
        >
          {MEDIA_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <p>На основі яких сутностей і сцен створено цю версію:</p>
      {multi(
        "Персонажі результату",
        characters,
        targets?.characters ?? [],
        setCharacters,
      )}
      {multi(
        "Локації результату",
        locations,
        targets?.locations ?? [],
        setLocations,
      )}
      {multi("Сцени результату", scenes, targets?.scenes ?? [], setScenes)}
      <label className="block">
        Теги результату
        <input
          className={field}
          aria-label="Теги результату"
          maxLength={4000}
          value={tags}
          onChange={(e) => {
            setTags(e.target.value);
            setConfirmed(false);
          }}
        />
      </label>
      <label className="flex gap-2">
        <input
          type="checkbox"
          aria-label="Підтвердити перенесення"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Підтверджую перенесення v{asset.version} до своєї приватної медіатеки.
      </label>
      <button
        className="border rounded p-2 disabled:opacity-40"
        disabled={busy || !confirmed}
        onClick={() =>
          onTransfer({
            type,
            characterIds: characters,
            locationIds: locations,
            sceneIds: scenes,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean),
          })
        }
      >
        Зберегти в медіатеку
      </button>
    </fieldset>
  );
}

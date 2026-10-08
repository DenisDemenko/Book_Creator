import { useEffect, useState } from "react";
import {
  MEDIA_TYPES,
  CREATIVE_MEDIA_STATUSES,
  emptyAi,
  type MediaProvenance,
} from "../../shared/mediaProvenance";
import type { PassportAsset } from "./MediaPassportPanel";
const field = "w-full min-w-0 rounded border border-slate-700 bg-slate-950 p-2";
const button = "rounded border border-slate-600 p-2 disabled:opacity-40";
export function AiDeclarationFields({
  value,
  onChange,
}: {
  value: ReturnType<typeof emptyAi>;
  onChange: (v: ReturnType<typeof emptyAi>) => void;
}) {
  return (
    <fieldset className="space-y-2 min-w-0">
      <legend>Використання ШІ (без ключів і токенів)</legend>
      <label className="block">
        ШІ
        <select
          className={field}
          aria-label="Використання ШІ"
          value={value.used === null ? "unknown" : value.used ? "yes" : "no"}
          onChange={(e) =>
            onChange(
              e.target.value === "yes"
                ? { ...value, used: true }
                : {
                    ...emptyAi(),
                    used: e.target.value === "no" ? false : null,
                  },
            )
          }
        >
          <option value="unknown">Невідомо / не заявлено</option>
          <option value="no">Ручна робота, без ШІ</option>
          <option value="yes">Використано ШІ</option>
        </select>
      </label>
      {value.used === true && (
        <>
          {(
            ["provider", "model", "generationId", "promptReference"] as const
          ).map((key, i) => (
            <label className="block" key={key}>
              {
                [
                  "Провайдер",
                  "Модель",
                  "ID генерації (за наявності)",
                  "Посилання на промпт (ID, без тексту й секретів)",
                ][i]
              }
              <input
                className={field}
                aria-label={key}
                maxLength={200}
                value={value[key] ?? ""}
                onChange={(e) =>
                  onChange({ ...value, [key]: e.target.value || null })
                }
              />
            </label>
          ))}
          <label className="block">
            Seed
            <input
              className={field}
              aria-label="Seed"
              type="number"
              value={
                value.settings.seed == null ? "" : String(value.settings.seed)
              }
              onChange={(e) => {
                const settings = { ...value.settings };
                if (e.target.value === "") delete settings.seed;
                else settings.seed = Number(e.target.value);
                onChange({ ...value, settings });
              }}
            />
          </label>
          <label className="block">
            Співвідношення сторін
            <input
              className={field}
              aria-label="Співвідношення сторін"
              maxLength={30}
              value={String(value.settings.aspectRatio ?? "")}
              onChange={(e) =>
                onChange({
                  ...value,
                  settings: { ...value.settings, aspectRatio: e.target.value },
                })
              }
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
export function MediaProvenancePanel({
  asset,
  onChanged,
}: {
  asset: PassportAsset;
  onChanged: (a: PassportAsset) => void;
}) {
  const p = asset.provenance;
  const [tagsText, setTagsText] = useState(p?.tags.join(", ") ?? "");
  const [form, setForm] = useState(p),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [targets, setTargets] = useState<{
    entities: Array<{ id: string; name: string; type: string }>;
    sections: Array<{ id: string; title: string }>;
  }>({ entities: [], sections: [] });
  useEffect(() => {
    setForm(p);
    setTagsText(p?.tags.join(", ") ?? "");
    setConfirmed(false);
    setError("");
  }, [asset.id, p]);
  useEffect(() => {
    const abort = new AbortController();
    setTargets({ entities: [], sections: [] });
    if (asset.bookId)
      void fetch(
        `/api/media/${encodeURIComponent(asset.id)}/provenance-targets`,
        { credentials: "same-origin", signal: abort.signal },
      )
        .then(async (r) => {
          if (!r.ok) return;
          const t = await r.json();
          if (!abort.signal.aborted) setTargets(t);
        })
        .catch(() => {});
    return () => abort.abort();
  }, [asset.bookId, asset.id]);
  if (!p || !form) return null;
  const patch = (v: Partial<MediaProvenance>) => {
    setForm({ ...form, ...v });
    setConfirmed(false);
  };
  const multi = (
    key: "characterIds" | "locationIds" | "sceneIds",
    label: string,
    options: Array<{ id: string; name: string }>,
  ) => (
    <label className="block">
      {label}
      <select
        aria-label={label}
        multiple
        className={field}
        value={form[key]}
        onChange={(e) =>
          patch({ [key]: Array.from(e.target.selectedOptions, (o) => o.value) })
        }
      >
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
        {form[key]
          .filter((id) => !options.some((o) => o.id === id))
          .map((id) => (
            <option key={id} value={id}>
              {id} (історична прив’язка)
            </option>
          ))}
      </select>
    </label>
  );
  return (
    <section
      aria-label="Походження матеріалу"
      className="space-y-3 min-w-0 border border-cyan-800 rounded p-3 text-sm break-words"
    >
      <h3 className="font-bold">Походження матеріалу</h3>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <dt>Створив</dt>
          <dd>
            {asset.author || p.createdBy || "Не зафіксовано"} ·{" "}
            {p.createdBy || "ID автора не зафіксовано"}
          </dd>
        </div>
        <div>
          <dt>Створено</dt>
          <dd>{p.createdAt}</dd>
        </div>
        <div>
          <dt>Джерело</dt>
          <dd>
            {p.origin === "workspace"
              ? "Creative Workspace"
              : p.origin === "legacy"
                ? "Старий запис: дані походження неповні"
                : p.origin === "ai"
                  ? "Генерація Studio"
                  : "Завантаження"}
          </dd>
        </div>
        <div>
          <dt>Книга / творчий проєкт</dt>
          <dd>
            {asset.bookId || "Без книги"} / {p.creativeProjectId || "—"}
          </dd>
        </div>
        {p.workspace && (
          <div>
            <dt>Вихідна версія Workspace</dt>
            <dd>
              v{p.workspace.version} · {p.workspace.assetId}
              <br />
              Попередня: {p.workspace.parentId || "—"}
            </dd>
          </div>
        )}
        <div>
          <dt>Переніс до медіатеки</dt>
          <dd>
            {p.importedBy || "—"} · {p.importedAt || "—"}
          </dd>
        </div>
        <div>
          <dt>Затверджена версія</dt>
          <dd>
            {p.approval
              ? `v${p.approval.version} · ${p.approval.assetId} · ${p.approval.by} · ${p.approval.at}`
              : "Не зафіксовано"}
          </dd>
        </div>
        <div>
          <dt>Візуальний канон</dt>
          <dd>
            {p.canon
              ? `${p.canon.by} · ${p.canon.at}`
              : "Не додано. Окрема дія Visual Bible — Т7.6."}
          </dd>
        </div>
        <div>
          <dt>Дані про ШІ</dt>
          <dd>
            {p.ai.used === null
              ? "Невідомо"
              : p.ai.used
                ? `${p.ai.provider || "невідомий провайдер"} / ${p.ai.model || "невідома модель"}`
                : "Без ШІ"}
            <br />
            {p.declaration
              ? `Заявив: ${p.declaration.by} · ${p.declaration.at}`
              : "Декларацію не зафіксовано"}
          </dd>
        </div>
      </dl>
      {p.ai.used && (
        <pre className="whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(
            {
              generationId: p.ai.generationId,
              promptReference: p.ai.promptReference,
              settings: p.ai.settings,
            },
            null,
            2,
          )}
        </pre>
      )}
      {p.status === "CANON" && <p>Матеріал у Visual Bible. Щоб змінити метадані, спочатку вилучіть його з канону окремою дією.</p>}
      <label className="block">
        Тип матеріалу
        <select
          className={field}
          aria-label="Тип матеріалу"
          value={form.type}
          onChange={(e) =>
            patch({ type: e.target.value as MediaProvenance["type"] })
          }
        >
          {MEDIA_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label className="block">
        Статус матеріалу
        <select
          className={field}
          aria-label="Статус матеріалу"
          value={form.status}
          onChange={(e) =>
            patch({ status: e.target.value as MediaProvenance["status"] })
          }
        >
          {CREATIVE_MEDIA_STATUSES.map((t) => (
            <option disabled={t === "CANON"} key={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <p>
        Сутності, на основі яких створено матеріал. Поточні прив’язки зображення
        до книги змінюються в панелі «Прив’язки».
      </p>
      {multi(
        "characterIds",
        "Походження: персонажі",
        targets.entities.filter((e) => e.type === "character"),
      )}
      {multi(
        "locationIds",
        "Походження: локації",
        targets.entities.filter((e) => e.type === "location"),
      )}
      {multi(
        "sceneIds",
        "Походження: сцени",
        targets.sections.map((x) => ({ id: x.id, name: x.title })),
      )}
      <label className="block">
        Теги через кому
        <input
          className={field}
          aria-label="Теги"
          maxLength={4000}
          value={tagsText}
          onChange={(e) => {
            setTagsText(e.target.value);
            patch({
              tags: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            });
          }}
        />
      </label>
      {!["workspace", "ai"].includes(p.origin) && (
        <AiDeclarationFields value={form.ai} onChange={(ai) => patch({ ai })} />
      )}
      <label className="flex gap-2">
        <input
          type="checkbox"
          aria-label="Підтвердити метадані"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Підтверджую зміни метаданих і статусу цієї версії. Канон не змінюється.
      </label>
      {error && <p role="alert">{error}</p>}
      <button
        className={button}
        disabled={!confirmed || busy || p.status === "CANON"}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch(
              `/api/media/${encodeURIComponent(asset.id)}/provenance`,
              {
                method: "PATCH",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  expectedRevision: p.revision,
                  confirmed,
                  metadata: {
                    type: form.type,
                    status: form.status,
                    characterIds: form.characterIds,
                    locationIds: form.locationIds,
                    sceneIds: form.sceneIds,
                    tags: form.tags,
                  },
                  ...(["workspace", "ai"].includes(p.origin) ||
                  JSON.stringify(p.ai) === JSON.stringify(form.ai)
                    ? {}
                    : { ai: form.ai }),
                }),
              },
            );
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            onChanged(d.asset);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Зберегти метадані
      </button>
    </section>
  );
}

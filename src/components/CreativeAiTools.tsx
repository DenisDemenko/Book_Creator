import { useCallback, useEffect, useRef, useState } from "react";
import { apiPath } from "../utils/basePath";
import {
  CREATIVE_AI_ACTIONS,
  type CreativeAiAction,
  type CreativeAiJob,
  type CreativeAiModel,
  type CreativeAiContext,
} from "../../shared/creativeAi";
import { STYLE_FIELDS } from "../../shared/creativeBible";
import type { CreativeAsset } from "../../server/core/creative/workspace";
const titles: Record<CreativeAiAction, string> = {
  "creative:image:generate": "Створити зображення",
  "creative:image:edit": "Нова версія зображення",
  "creative:video:generate": "Створити відео",
  "creative:video:edit": "Нова відеоверсія за першим кадром",
};
interface State {
  models: CreativeAiModel[];
  actions: CreativeAiAction[];
  canOverride: boolean;
  entities: { id: string; name: string; type: string }[];
  references: { id: string; title: string }[];
  access: {
    userId: string;
    actions: CreativeAiAction[];
    revision: number;
    validUntil: string | null;
  }[];
  jobs: CreativeAiJob[];
  limits: { imagePerDay: number; videoPerDay: number; active: number };
  available: boolean;
}
const styleNames: Record<string, string> = {
  genre: "Жанр",
  mood: "Настрій",
  visualTone: "Візуальний тон",
  emotionalTone: "Емоційний тон",
  primaryPalette: "Основна палітра",
  secondaryPalette: "Додаткова палітра",
  accentPalette: "Акцентна палітра",
  prohibitedColors: "Заборонені кольори",
  lighting: "Освітлення",
  contrast: "Контраст",
  composition: "Композиція",
  framing: "Кадрування",
  cameraDistance: "Відстань камери",
  titleSafeZones: "Зони заголовка",
  visualLanguage: "Візуальна мова",
  prohibitedStyles: "Заборонені стилі",
};
const field = "w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2";
const button = "rounded border border-slate-500 px-3 py-2 disabled:opacity-40";
export function CreativeAiTools({
  projectId,
  owner,
  specialistId,
  selectedAsset,
  onCreated,
}: {
  projectId: string;
  owner: boolean;
  specialistId: string | null;
  selectedAsset: CreativeAsset | null;
  onCreated: (id: string) => void;
}) {
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [operation, setOperation] = useState<CreativeAiAction>(
      "creative:image:generate",
    ),
    [modelId, setModelId] = useState(""),
    [size, setSize] = useState(""),
    [ratio, setRatio] = useState("1:1"),
    [duration, setDuration] = useState(5),
    [prompt, setPrompt] = useState(""),
    [entities, setEntities] = useState<string[]>([]),
    [refs, setRefs] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState<CreativeAiContext | null>(null),
    [override, setOverride] = useState(false),
    [rules, setRules] = useState<Record<string, string>>({}),
    [grants, setGrants] = useState<CreativeAiAction[]>([]),
    [grantConfirm, setGrantConfirm] = useState(false),
    [until, setUntil] = useState("");
  const request = useRef<{ hash: string; id: string } | null>(null),
    seen = useRef(new Set<string>()),
    historyLoaded = useRef(false);
  const root = `/api/creative/projects/${encodeURIComponent(projectId)}/workspace/ai`;
  const api = useCallback(
    async (suffix = "", body?: unknown) => {
      const r = await fetch(apiPath(root + suffix), {
        credentials: "include",
        cache: "no-store",
        ...(body
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            }
          : {}),
      });
      const v = await r.json();
      if (!r.ok) throw new Error(v.error || "Не вдалося виконати дію ШІ.");
      return v;
    },
    [root],
  );
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const v: State = await api();
        if (!live) return;
        setState(v);
        for (const j of [...v.jobs].reverse())
          if (
            j.status === "COMPLETED" &&
            j.assetId &&
            !seen.current.has(j.id)
          ) {
            seen.current.add(j.id);
            if (historyLoaded.current) onCreated(j.assetId);
          }
        historyLoaded.current = true;
        setError("");
      } catch (e) {
        if (live) {
          setState(null);
          setPreview(null);
          setError((e as Error).message);
        }
      }
    };
    void load();
    const t = setInterval(() => void load(), 3000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [api, onCreated]);
  const kind = operation.includes(":video:") ? "video" : "image",
    edit = operation.endsWith(":edit"),
    models =
      state?.models.filter((m) => m.kind === kind && (!edit || m.edit)) ?? [],
    model = models.find((m) => m.id === modelId);
  useEffect(() => {
    if (!models.some((m) => m.id === modelId)) {
      const m = models.find((m) => m.available) || models[0];
      setModelId(m?.id || "");
      setSize(m?.sizes[0] || "");
      setRatio(m?.aspectRatios[0] || "1:1");
      setDuration(m?.durations[0] || 5);
    }
  }, [state?.models, operation, modelId]);
  useEffect(() => {
    setConfirmed(false);
    setPreview(null);
  }, [
    operation,
    modelId,
    size,
    ratio,
    duration,
    prompt,
    entities,
    refs,
    override,
    rules,
    selectedAsset?.id,
    selectedAsset?.revision,
  ]);
  useEffect(() => {
    setPreview(null);
  }, [
    state?.actions.join("|"),
    state?.entities.map((e) => e.id).join("|"),
    state?.references.map((r) => r.id).join("|"),
  ]);
  const currentGrant = state?.access.find((a) => a.userId === specialistId);
  useEffect(() => {
    if (currentGrant) {
      setGrants(currentGrant.actions);
      setUntil(
        currentGrant.validUntil
          ? new Date(
              new Date(currentGrant.validUntil).getTime() -
                new Date().getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)
          : "",
      );
      setGrantConfirm(false);
    }
  }, [currentGrant?.revision]);
  const body = () => ({
    confirmed: true,
    operation,
    model: modelId,
    prompt,
    settings: {
      size,
      aspectRatio: ratio,
      ...(kind === "video" ? { duration } : {}),
    },
    entityIds: entities,
    referenceIds: refs,
    ...(edit
      ? {
          parentId: selectedAsset?.id,
          expectedRevision: selectedAsset?.revision,
        }
      : {}),
    ...(override ? { styleOverride: rules } : {}),
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const valid =
    !!state?.actions.includes(operation) &&
    !!model?.available &&
    !!prompt.trim() &&
    (!edit || !!selectedAsset) &&
    !state?.jobs.some((j) => j.status === "RUNNING");
  const multiple = (
    label: string,
    values: string[],
    change: (v: string[]) => void,
    options: { id: string; name: string }[],
  ) => (
    <label>
      {label}
      <select
        aria-label={label}
        multiple
        className={field}
        value={values}
        onChange={(e) =>
          change(Array.from(e.target.selectedOptions, (x) => x.value))
        }
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section aria-label="Creative AI Tools" className="space-y-4 min-w-0">
      <h2 className="text-xl font-bold">AI Tools</h2>
      {error && <p role="alert">{error}</p>}
      <p>
        Результат додається як нова чернетка. Відеоверсія генерує новий ролик за
        першим кадром вибраного відео. Виберіть дозволені сутності та референси;
        активний Style Bible застосовується на сервері.
      </p>
      {state && (
        <>
          <p>
            Ліміти Workspace: {state.limits.imagePerDay} зображень і{" "}
            {state.limits.videoPerDay} відео на добу, одне активне завдання.
            Також діють дозвіл генерації та квоти вашого тарифу.
          </p>
          {owner && specialistId && (
            <fieldset className="border border-slate-600 rounded p-3 space-y-2">
              <legend>Окремі дозволи ШІ для фахівця</legend>
              {CREATIVE_AI_ACTIONS.map((a) => (
                <label className="block" key={a}>
                  <input
                    aria-label={a}
                    type="checkbox"
                    checked={grants.includes(a)}
                    onChange={(e) => {
                      setGrants(
                        e.target.checked
                          ? [...grants, a]
                          : grants.filter((x) => x !== a),
                      );
                      setGrantConfirm(false);
                    }}
                  />
                  {titles[a]}
                </label>
              ))}
              <p>
                Чинні:{" "}
                {state.access
                  .find((a) => a.userId === specialistId)
                  ?.actions.map((a) => titles[a])
                  .join(", ") || "немає"}
              </p>
              <label>
                Строк дії (необов’язково)
                <input
                  type="datetime-local"
                  className={field}
                  value={until}
                  onChange={(e) => {
                    setUntil(e.target.value);
                    setGrantConfirm(false);
                  }}
                />
              </label>
              <label className="block">
                <input
                  aria-label="Підтвердити дозволи ШІ"
                  type="checkbox"
                  checked={grantConfirm}
                  onChange={(e) => setGrantConfirm(e.target.checked)}
                />
                Підтверджую надання / відкликання вибраних дій
              </label>
              <button
                className={button}
                disabled={busy || !grantConfirm}
                onClick={() =>
                  void run(async () => {
                    await api("/access", {
                      confirmed: true,
                      userId: specialistId,
                      actions: grants,
                      expectedRevision:
                        state.access.find((a) => a.userId === specialistId)
                          ?.revision ?? 0,
                      validUntil: until ? new Date(until).toISOString() : null,
                    });
                    setGrantConfirm(false);
                    setState(await api());
                  })
                }
              >
                Зберегти дозволи ШІ
              </button>
            </fieldset>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              Дія
              <select
                aria-label="Дія ШІ"
                className={field}
                value={operation}
                onChange={(e) =>
                  setOperation(e.target.value as CreativeAiAction)
                }
              >
                {CREATIVE_AI_ACTIONS.map((a) => (
                  <option
                    disabled={!state.actions.includes(a)}
                    key={a}
                    value={a}
                  >
                    {titles[a]}
                    {!state.actions.includes(a) ? " — немає дозволу" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Модель
              <select
                aria-label="Модель ШІ"
                className={field}
                value={modelId}
                onChange={(e) => {
                  const m = models.find((m) => m.id === e.target.value)!;
                  setModelId(m.id);
                  setSize(m.sizes[0]);
                  setRatio(m.aspectRatios[0]);
                  setDuration(m.durations[0] || 5);
                }}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available}>
                    {m.label}
                    {m.available ? "" : " — немає ключа"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Розмір / роздільність
              <select
                aria-label="Розмір ШІ"
                className={field}
                value={size}
                onChange={(e) => setSize(e.target.value)}
              >
                {model?.sizes.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label>
              Формат
              <select
                aria-label="Формат ШІ"
                className={field}
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
              >
                {model?.aspectRatios.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            {kind === "video" && (
              <label>
                Тривалість (с)
                <select
                  aria-label="Тривалість ШІ"
                  className={field}
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {model?.durations.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {multiple("Сутності для ШІ", entities, setEntities, state.entities)}
            {multiple(
              "Референси для ШІ",
              refs,
              setRefs,
              state.references.map((r) => ({ id: r.id, name: r.title })),
            )}
          </div>
          {edit && (
            <p>
              Вихідний матеріал:{" "}
              {selectedAsset
                ? `${selectedAsset.filename} · v${selectedAsset.version}`
                : "Виберіть свою поточну роботу у вкладці «Роботи». Фінальні версії захищені."}
            </p>
          )}
          <label className="block">
            Опис завдання
            <textarea
              aria-label="Опис завдання ШІ"
              className={field}
              maxLength={4000}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </label>
          {state.canOverride && (
            <label className="block">
              <input
                type="checkbox"
                checked={override}
                onChange={(e) => setOverride(e.target.checked)}
              />
              Змінити стиль лише для цього завдання
            </label>
          )}
          {override && state.canOverride && (
            <div className="grid gap-3 sm:grid-cols-2">
              {STYLE_FIELDS.map((k) => (
                <label key={k}>
                  {styleNames[k]}
                  <textarea
                    className={field}
                    maxLength={2000}
                    value={rules[k] || ""}
                    onChange={(e) =>
                      setRules({ ...rules, [k]: e.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          )}
          <button
            className={button}
            disabled={busy || !valid}
            onClick={() =>
              void run(async () => {
                const v = await api("/context", {
                  ...body(),
                  requestId: "preview",
                });
                setPreview(v.context);
              })
            }
          >
            Перевірити контекст перед запитом
          </button>
          {!!preview && (
            <pre
              aria-label="Контекст Creative AI"
              className="whitespace-pre-wrap break-all overflow-auto max-w-full"
            >
              {JSON.stringify(preview, null, 2)}
            </pre>
          )}
          <label className="block">
            <input
              aria-label="Підтвердити генерацію ШІ"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Підтверджую запит до моделі та використання квоти
          </label>
          <button
            className={button}
            disabled={busy || !confirmed || !valid}
            onClick={() =>
              void run(async () => {
                const b = body(),
                  hash = JSON.stringify(b);
                if (request.current?.hash !== hash)
                  request.current = { hash, id: crypto.randomUUID() };
                await api("/jobs", { ...b, requestId: request.current.id });
                setConfirmed(false);
                setState(await api());
              })
            }
          >
            Запустити завдання ШІ
          </button>
          <button
            className={button}
            disabled={busy || state.jobs.some((j) => j.status === "RUNNING")}
            onClick={() => {
              request.current = null;
              setConfirmed(false);
            }}
          >
            Підготувати нову спробу
          </button>
          <div className="space-y-2">
            {state.jobs.map((j) => (
              <article
                key={j.id}
                className="border border-slate-600 rounded p-3"
              >
                <p>
                  {titles[j.operation]} · {j.status} · {j.createdAt}
                </p>
                {j.error && <p>{j.error}</p>}
                {j.assetId && (
                  <button
                    className={button}
                    onClick={() => onCreated(j.assetId!)}
                  >
                    Вибрати нову чернетку
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from "react";
import { apiPath, API_BASE } from "../utils/basePath";
import { buildCreativeBiblePath, buildAppPath } from "../utils/appRoutes";
import {
  BIBLE_CATEGORIES,
  VISUAL_FIELDS,
  STYLE_FIELDS,
  type BibleEntry,
  type StyleVersion,
} from "../../shared/creativeBible";
const labels: Record<string, string> = {
  character: "Персонажі",
  location: "Локації",
  object: "Предмети",
  costume: "Костюми",
  transport: "Транспорт",
  architecture: "Архітектура",
  creature: "Істоти",
  symbol: "Символи",
  palette: "Палітри",
  cover: "Обкладинки",
  description: "Опис",
  angle: "Ракурс",
  expression: "Вираз обличчя",
  clothing: "Одяг",
  visualAge: "Візуальний вік",
  keyFeatures: "Ключові ознаки",
  forbiddenChanges: "Заборонені зміни",
  timeOfDay: "Час доби",
  season: "Сезон",
  lighting: "Освітлення",
  materials: "Матеріали",
  colors: "Кольори",
  weather: "Погода",
  keyObjects: "Ключові об’єкти",
  forbiddenElements: "Заборонені елементи",
  genre: "Жанр",
  mood: "Настрій",
  visualTone: "Візуальний тон",
  emotionalTone: "Емоційний тон",
  primaryPalette: "Основна палітра",
  secondaryPalette: "Додаткова палітра",
  accentPalette: "Акцентна палітра",
  prohibitedColors: "Заборонені кольори",
  contrast: "Контраст",
  composition: "Композиція",
  framing: "Кадрування",
  cameraDistance: "Відстань камери",
  titleSafeZones: "Безпечні зони заголовка",
  visualLanguage: "Фотографічна / ілюстративна мова",
  prohibitedStyles: "Заборонені стилі",
};
interface BibleState {
  bookId: string;
  title: string;
  entries: BibleEntry[];
  entities: { id: string; type: string; name: string }[];
  appearances: { id: string; label: string; entityId: string }[];
  links: {
    id: string;
    assetId: string | null;
    entityId: string | null;
    appearanceVersionId: string | null;
    role: string;
  }[];
  assets: {
    id: string;
    title: string;
    version: number;
    revision: number;
    url: string;
  }[];
  permissions: { manage: boolean };
  history: BibleEntry[];
  audit: { id: string; by: string; at: string; action: string }[];
}
interface StyleState {
  versions: StyleVersion[];
  active: { revision: number; versionId: string | null };
  permissions: { manage: boolean };
}
const field = "w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2";
const button = "rounded border border-slate-500 px-3 py-2 disabled:opacity-40";
export function CreativeBible({
  bookId,
  initialStyle = false,
}: {
  bookId: string;
  initialStyle?: boolean;
}) {
  const [data, setData] = useState<BibleState | null>(null),
    [style, setStyle] = useState<StyleState | null>(null),
    [tab, setTab] = useState(initialStyle ? "style" : "visual"),
    [error, setError] = useState(""),
    [styleError, setStyleError] = useState(""),
    [busy, setBusy] = useState(false);
  const [category, setCategory] = useState("character"),
    [entity, setEntity] = useState(""),
    [asset, setAsset] = useState(""),
    [link, setLink] = useState(""),
    [title, setTitle] = useState(""),
    [master, setMaster] = useState(false),
    [rules, setRules] = useState<Record<string, string>>({}),
    [confirmed, setConfirmed] = useState(false);
  const [styleTitle, setStyleTitle] = useState(""),
    [styleRules, setStyleRules] = useState<Record<string, string>>({}),
    [styleConfirmed, setStyleConfirmed] = useState(false),
    [activation, setActivation] = useState(""),
    [activateConfirmed, setActivateConfirmed] = useState(false),
    [removeId, setRemoveId] = useState(""),
    [reason, setReason] = useState(""),
    [removeConfirmed, setRemoveConfirmed] = useState(false),
    [context, setContext] = useState<unknown>(null);
  const root = `/api/creative/bible/${encodeURIComponent(bookId)}`;
  const api = useCallback(
    async (suffix: string, body?: unknown) => {
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
      if (!r.ok) throw new Error(v.error || "Не вдалося виконати дію.");
      return v;
    },
    [root],
  );
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      await Promise.allSettled([
        api("")
          .then((v) => {
            if (live) {
              setData(v);
              setError("");
            }
          })
          .catch((e) => {
            if (live) {
              setData(null);
              setContext(null);
              setError(e.message);
            }
          }),
        api("/style")
          .then((v) => {
            if (live) {
              setStyle(v);
              setStyleError("");
            }
          })
          .catch((e) => {
            if (live) {
              setStyle(null);
              setContext(null);
              setStyleError(e.message);
            }
          }),
      ]);
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [api]);
  useEffect(
    () => setContext(null),
    [data?.entries.map((e) => e.id).join("|"), style?.active.versionId],
  );
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      setConfirmed(false);
      setStyleConfirmed(false);
      setActivateConfirmed(false);
      setRemoveConfirmed(false);
      try {
        setData(await api(""));
      } catch {}
      try {
        setStyle(await api("/style"));
      } catch {}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const fields = (
    keys: readonly string[],
    values: Record<string, string>,
    change: (v: Record<string, string>) => void,
  ) => (
    <div className="grid gap-3 sm:grid-cols-2">
      {keys.map((k) => (
        <label key={k}>
          {labels[k] || k}
          <textarea
            aria-label={labels[k] || k}
            className={field}
            maxLength={2000}
            value={values[k] || ""}
            onChange={(e) => change({ ...values, [k]: e.target.value })}
          />
        </label>
      ))}
    </div>
  );
  const current = style?.versions.find((v) => v.id === style.active.versionId);
  return (
    <section
      aria-label="Visual Bible"
      className="max-w-6xl mx-auto space-y-5 break-words"
    >
      <h1 className="text-2xl font-bold">
        Visual Bible · {data?.title || bookId}
      </h1>
      <nav className="flex gap-3 flex-wrap">
        <button className={button} onClick={() => setTab("visual")}>
          Візуальний канон
        </button>
        <button className={button} onClick={() => setTab("style")}>
          Style Bible
        </button>
        <a
          className="underline"
          href={
            buildAppPath({ projectId: bookId, tab: "media" }, API_BASE) || "#"
          }
        >
          Медіатека та зв’язки
        </a>
        <a
          className="underline"
          href={buildCreativeBiblePath(bookId, API_BASE, true)}
        >
          Адреса Style Bible
        </a>
      </nav>
      {error && <p role="alert">{error}</p>}
      {tab === "visual" && (
        <>
          <p>
            APPROVED — затверджений результат. CANON — окремо підтверджений
            образ світу. Для зміни потрібен MANAGE на Visual Bible та доступ до
            матеріалу й сутності.
          </p>
          {data &&
            BIBLE_CATEGORIES.map((c) => (
              <section key={c}>
                <h2 className="text-lg font-semibold">{labels[c]}</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  {data.entries
                    .filter((e) => e.category === c)
                    .map((e) => (
                      <article
                        key={e.id}
                        className="border border-slate-600 rounded p-3 space-y-2"
                      >
                        <h3>
                          {e.title} {e.master && "· Головний образ"}
                        </h3>
                        {e.snapshot.mimeType?.startsWith("image/") && (
                          <img
                            className="max-h-72 max-w-full mx-auto"
                            alt={e.title}
                            src={apiPath(`/api/media/file/${e.assetId}`)}
                          />
                        )}
                        {e.snapshot.mimeType?.startsWith("video/") && (
                          <video
                            controls
                            className="max-h-72 max-w-full mx-auto"
                            src={apiPath(`/api/media/file/${e.assetId}`)}
                          />
                        )}
                        {!!e.sceneIds?.length && (
                          <p>Пов’язані сцени: {e.sceneIds.join(", ")}</p>
                        )}
                        <a
                          className="underline"
                          href={apiPath(`/api/media/file/${e.assetId}`)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Відкрити канонічний матеріал · v
                          {e.snapshot.assetVersion}
                        </a>
                        <p>
                          {data.entities.find((x) => x.id === e.entityId)?.name}{" "}
                          {
                            data.appearances.find(
                              (x) => x.id === e.appearanceVersionId,
                            )?.label
                          }
                        </p>
                        <dl>
                          {Object.entries(e.rules)
                            .filter(([, v]) => v)
                            .map(([k, v]) => (
                              <div key={k}>
                                <dt className="font-semibold">{labels[k]}</dt>
                                <dd>{v}</dd>
                              </div>
                            ))}
                        </dl>
                        <p>
                          Додав: {e.addedBy} ·{" "}
                          {new Date(e.addedAt).toLocaleString()} · Стиль:{" "}
                          {e.styleVersionId
                            ? style?.versions.find(
                                (v) => v.id === e.styleVersionId,
                              )?.title || e.styleVersionId
                            : "Не визначено"}
                        </p>
                        {data.permissions.manage && (
                          <button
                            className={button}
                            onClick={() => {
                              setRemoveId(e.id);
                              setRemoveConfirmed(false);
                              setReason("");
                            }}
                          >
                            Вилучити з канону
                          </button>
                        )}
                      </article>
                    ))}
                </div>
                {!data.entries.some((e) => e.category === c) && (
                  <p className="text-slate-400">Матеріалів канону ще немає.</p>
                )}
              </section>
            ))}
          {removeId && data?.permissions.manage && (
            <fieldset className="border rounded p-3">
              <legend>Окреме вилучення з канону</legend>
              <label>
                Причина
                <textarea
                  className={field}
                  aria-label="Причина вилучення"
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={removeConfirmed}
                  onChange={(e) => setRemoveConfirmed(e.target.checked)}
                />{" "}
                Підтвердити вилучення
              </label>
              <button
                className={button}
                disabled={busy || !reason.trim() || !removeConfirmed}
                onClick={() =>
                  void act(async () => {
                    const e = data.entries.find((e) => e.id === removeId)!;
                    await api(`/canon/${removeId}/remove`, {
                      confirmed: true,
                      expectedRevision: e.revision,
                      reason,
                    });
                    setRemoveId("");
                  })
                }
              >
                Вилучити з канону з аудитом
              </button>
            </fieldset>
          )}
          {data?.permissions.manage && (
            <fieldset className="border border-slate-600 rounded p-4 space-y-3">
              <legend>Додати до візуального канону</legend>
              <label className="block">
                Категорія
                <select
                  aria-label="Категорія канону"
                  className={field}
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setEntity("");
                    setLink("");
                    setConfirmed(false);
                  }}
                >
                  {BIBLE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {labels[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Затверджений матеріал
                <select
                  aria-label="Матеріал канону"
                  className={field}
                  value={asset}
                  onChange={(e) => {
                    setAsset(e.target.value);
                    setLink("");
                    setConfirmed(false);
                  }}
                >
                  <option value="">Виберіть точну версію</option>
                  {data.assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.title} · v{a.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                Сутність
                <select
                  aria-label="Сутність канону"
                  className={field}
                  value={entity}
                  onChange={(e) => {
                    setEntity(e.target.value);
                    setLink("");
                    setConfirmed(false);
                  }}
                >
                  <option value="">
                    Без сутності (палітра / обкладинка тощо)
                  </option>
                  {data.entities
                    .filter(
                      (e) =>
                        !["character", "location", "object"].includes(
                          category,
                        ) || e.type === category,
                    )
                    .map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                </select>
              </label>
              {entity && (
                <label className="block">
                  Підтверджений зв’язок
                  <select
                    aria-label="Зв’язок канону"
                    className={field}
                    value={link}
                    onChange={(e) => {
                      setLink(e.target.value);
                      setConfirmed(false);
                    }}
                  >
                    <option value="">Виберіть зв’язок із медіатеки</option>
                    {data.links
                      .filter(
                        (l) => l.assetId === asset && l.entityId === entity,
                      )
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.role}{" "}
                          {
                            data.appearances.find(
                              (v) => v.id === l.appearanceVersionId,
                            )?.label
                          }
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <label className="block">
                Назва образу
                <input
                  className={field}
                  aria-label="Назва образу"
                  maxLength={160}
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label className="block">
                <input
                  type="checkbox"
                  checked={master}
                  onChange={(e) => {
                    setMaster(e.target.checked);
                    setConfirmed(false);
                  }}
                />{" "}
                Головний образ цієї сутності / категорії
              </label>
              {fields(VISUAL_FIELDS, rules, (v) => {
                setRules(v);
                setConfirmed(false);
              })}
              <label className="block">
                <input
                  aria-label="Підтвердити канон"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                Підтверджую точну версію та правила канону
              </label>
              <button
                className={button}
                disabled={
                  busy ||
                  !confirmed ||
                  !asset ||
                  !title.trim() ||
                  (!!entity && !link)
                }
                onClick={() =>
                  void act(() =>
                    api("/canon", {
                      confirmed: true,
                      expectedRevision: data.assets.find((a) => a.id === asset)
                        ?.revision,
                      assetId: asset,
                      entityId: entity || null,
                      linkId: link || null,
                      category,
                      title,
                      master,
                      rules,
                    }),
                  )
                }
              >
                Додати до візуального канону
              </button>
            </fieldset>
          )}
          {!!data?.audit.length && (
            <details>
              <summary>Аудит критичних змін</summary>
              {data.audit.map((a) => (
                <p key={a.id}>
                  {a.at} · {a.by} · {a.action}
                </p>
              ))}
            </details>
          )}
        </>
      )}
      {tab === "style" && (
        <div className="space-y-4">
          <h2 className="text-xl">Style Bible</h2>
          {styleError && <p role="alert">{styleError}</p>}
          <p>
            Активний стиль:{" "}
            {current
              ? `${current.title} · v${current.version}`
              : "Ще не активовано"}
            . Нові правила не змінюють затверджені матеріали та їхні знімки
            канону.
          </p>
          {style?.versions.map((v) => (
            <details key={v.id}>
              <summary>
                {v.title} · v{v.version}{" "}
                {v.id === style.active.versionId && "· Активний"}
              </summary>
              <dl>
                {Object.entries(v.rules).map(([k, x]) => (
                  <div key={k}>
                    <dt>{labels[k]}</dt>
                    <dd>{x}</dd>
                  </div>
                ))}
              </dl>
              <p>
                {v.createdBy} · {v.createdAt}
              </p>
              {style.permissions.manage && (
                <button
                  className={button}
                  onClick={() => {
                    setStyleTitle(v.title + " — нова версія");
                    setStyleRules({ ...v.rules });
                    setStyleConfirmed(false);
                  }}
                >
                  Взяти за основу нової версії
                </button>
              )}
            </details>
          ))}
          {style?.permissions.manage && (
            <>
              <fieldset className="border rounded p-3 space-y-3">
                <legend>Нова незмінна версія стилю</legend>
                <label>
                  Назва стилю
                  <input
                    className={field}
                    aria-label="Назва стилю"
                    maxLength={160}
                    value={styleTitle}
                    onChange={(e) => {
                      setStyleTitle(e.target.value);
                      setStyleConfirmed(false);
                    }}
                  />
                </label>
                {fields(STYLE_FIELDS, styleRules, (v) => {
                  setStyleRules(v);
                  setStyleConfirmed(false);
                })}
                <label className="block">
                  <input
                    aria-label="Підтвердити версію стилю"
                    type="checkbox"
                    checked={styleConfirmed}
                    onChange={(e) => setStyleConfirmed(e.target.checked)}
                  />{" "}
                  Підтверджую нову версію
                </label>
                <button
                  className={button}
                  disabled={busy || !styleConfirmed || !styleTitle.trim()}
                  onClick={() =>
                    void act(() =>
                      api("/style/versions", {
                        confirmed: true,
                        title: styleTitle,
                        rules: styleRules,
                      }),
                    )
                  }
                >
                  Зберегти версію стилю
                </button>
              </fieldset>
              <fieldset className="border rounded p-3 space-y-3">
                <legend>Окреме ввімкнення стилю</legend>
                <select
                  aria-label="Активувати версію"
                  className={field}
                  value={activation}
                  onChange={(e) => {
                    setActivation(e.target.value);
                    setActivateConfirmed(false);
                  }}
                >
                  <option value="">Виберіть версію</option>
                  {style.versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title} · v{v.version}
                    </option>
                  ))}
                </select>
                <label className="block">
                  <input
                    aria-label="Підтвердити активацію"
                    type="checkbox"
                    checked={activateConfirmed}
                    onChange={(e) => setActivateConfirmed(e.target.checked)}
                  />{" "}
                  Підтверджую активацію
                </label>
                <button
                  className={button}
                  disabled={busy || !activation || !activateConfirmed}
                  onClick={() =>
                    void act(() =>
                      api("/style/activate", {
                        confirmed: true,
                        versionId: activation,
                        expectedRevision: style.active.revision,
                      }),
                    )
                  }
                >
                  Активувати стиль
                </button>
              </fieldset>
            </>
          )}
          <button
            className={button}
            disabled={busy || !style || !data}
            onClick={() =>
              void act(async () => {
                setContext(await api("/context"));
              })
            }
          >
            Показати структурований контекст для людей і ШІ
          </button>
          {!!context && (
            <pre
              className="whitespace-pre-wrap break-all max-w-full overflow-auto"
              aria-label="Стильовий контекст"
            >
              {JSON.stringify(context, null, 2)}
            </pre>
          )}
        </div>
      )}
    </section>
  );
}

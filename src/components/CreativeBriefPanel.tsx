import { buildCreativeWorkspacePath } from "../utils/appRoutes";
import { API_BASE } from "../utils/basePath";
import { CreativeOrderBinding } from "./CreativeOrderBinding";
import type { CreativeProject } from "../../server/core/creative/projects";
import { useCallback, useEffect, useState } from "react";
import type {
  BriefData,
  CreativeBrief,
  CreativeTarget,
  Selection,
} from "../../server/core/creative/briefs";
const empty: BriefData = {
  type: "cover",
  language: "uk",
  title: "",
  description: "",
  result: "",
  format: "",
  dimensions: "",
  style: "",
  concepts: 1,
  revisionRounds: 1,
  deadline: "",
  budgetTerms: "",
  references: [],
  aiPolicy: "DISCLOSE",
  sourceFiles: "",
};
const names: Record<BriefData["type"], string> = {
  cover: "Обкладинка",
  illustration: "Ілюстрація",
  character: "Персонаж",
  location: "Локація",
  world_map: "Карта світу",
  object: "Предмет / артефакт",
  booktrailer: "Буктрейлер",
  promo_video: "Промовідео",
  social: "Соцмережі",
  advertising: "Реклама",
  layout: "Верстка",
  "3d": "3D модель",
  other: "Інше",
};
const labels = {
  title: "Назва",
  description: "Опис завдання",
  result: "Очікуваний результат",
  format: "Формат",
  dimensions: "Розміри",
  style: "Стиль",
  budgetTerms: "Бюджет / умови",
  sourceFiles: "Вихідні файли",
};
const field =
  "w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2 text-slate-100";
const button = "rounded border border-slate-600 px-3 py-2 disabled:opacity-40";
interface State {
  project: CreativeProject;
  bookTitle: string;
  brief: CreativeBrief | null;
  targets: CreativeTarget[];
  participants: Array<{ userId: string }>;
  unavailable: string[];
}
export function CreativeBriefPanel({
  creativeProjectId,
}: {
  creativeProjectId: string;
}) {
  const [state, setState] = useState<State | null>(null),
    [data, setData] = useState<BriefData>(empty),
    [scope, setScope] = useState<Selection[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [preview, setPreview] = useState(false),
    [step, setStep] = useState(1),
    [fullForm, setFullForm] = useState(false),
    [access, setAccess] = useState<{ grants: any[]; events: any[] }>({
      grants: [],
      events: [],
    }),
    [user, setUser] = useState(""),
    [target, setTarget] = useState(""),
    [level, setLevel] = useState<Selection["level"]>("VIEW"),
    [validFrom, setValidFrom] = useState(""),
    [validUntil, setValidUntil] = useState(""),
    [grantConfirm, setGrantConfirm] = useState(false),
    [modelId, setModelId] = useState("");
  const root = `/api/creative/projects/${encodeURIComponent(creativeProjectId)}`;
  const api = useCallback(
    async (path = "", method = "GET", body?: unknown) => {
      const r = await fetch(root + path, {
        method,
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error || `Помилка ${r.status}`);
      return result;
    },
    [root],
  );
  const load = useCallback(async () => {
    const [s, a] = await Promise.all([api(), api("/access")]);
    setState(s);
    setData(s.brief?.data ?? { ...empty, title: s.project.title });
    setScope(s.brief?.scope ?? []);
    setAccess(a);
    setConfirmed(false);
    setPreview(false);
  }, [api]);
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [load]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const dirty =
    JSON.stringify(data) !== JSON.stringify(state?.brief?.data) ||
    JSON.stringify(scope) !== JSON.stringify(state?.brief?.scope);
  const version = state?.brief?.version ?? 0;
  const selectedTarget = state?.targets.find(
    (t) => JSON.stringify([t.scope, t.ref]) === target,
  );
  return (
    <section className="space-y-4 min-w-0" data-creative-brief>
      <h1 className="text-xl font-bold">Творчий бриф і доступ</h1>
      {state && (
        <p>
          {state.project.title} · Книга: {state.bookTitle}
        </p>
      )}
      <p>
        Матеріали приватні. Початковий доступ — NONE. Вибір у дереві готує scope
        для майбутнього виконавця; доступ надається окремо і явно. WORK для
        тексту означає контекст для творчої роботи, без редагування рукопису.
      </p>
      {error && (
        <p role="alert" className="text-red-400 break-words">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!state && (
        <button className={button} onClick={() => void run(load)}>
          Завантажити / повторити
        </button>
      )}
      {state && (
        <>
          <a
            className="block underline"
            href={buildCreativeWorkspacePath(creativeProjectId, API_BASE)}
          >
            Відкрити Creative Workspace
          </a>
          <CreativeOrderBinding project={state.project} onSynced={load} />
          <p>
            Бриф: {state.brief?.status ?? "Не збережено"} · Версія {version}.
            Статус MODERATION означає надсилання в Marketplace. Після схвалення
            бриф з’явиться на біржі замовлень.
          </p>
          <nav
            aria-label="Кроки створення замовлення"
            className="flex flex-wrap gap-2"
          >
            {[
              "Проєкт",
              "Тип роботи",
              "Бриф",
              "Scope ACL",
              "Умови",
              "Публікація",
            ].map((label, i) => (
              <button
                key={label}
                type="button"
                className={button}
                aria-current={!fullForm && step === i + 1 ? "step" : undefined}
                onClick={() => {
                  setFullForm(false);
                  setStep(i + 1);
                }}
              >
                {i + 1}. {label}
              </button>
            ))}
            <button
              type="button"
              className={button}
              aria-pressed={fullForm}
              onClick={() => setFullForm(!fullForm)}
            >
              Усі поля
            </button>
          </nav>
          {(fullForm || step === 1) && (
            <section
              aria-label="Проєкт замовлення"
              className="rounded border border-slate-700 p-4 space-y-2"
            >
              <h2 className="font-bold">1. Проєкт</h2>
              <p>Книга: {state.bookTitle}</p>
              <p>Творчий проєкт: {state.project.title}</p>
              <p>
                Бриф належить цьому проєкту. Для іншої книги поверніться до
                «Творчих проєктів» і створіть проєкт у потрібній книзі.
              </p>
            </section>
          )}
          <form
            className="grid gap-3"
            hidden={!fullForm && ![2, 3, 5].includes(step)}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/brief", "PUT", {
                  expectedVersion: version,
                  data: {
                    ...data,
                    references: data.references
                      .map((u) => u.trim())
                      .filter(Boolean),
                  },
                  scope,
                });
                await load();
                setNotice("Бриф збережено приватно.");
              });
            }}
          >
            <label hidden={!fullForm && step !== 2}>
              Тип роботи
              <select
                className={field}
                value={data.type}
                onChange={(e) =>
                  setData({
                    ...data,
                    type: e.target.value as BriefData["type"],
                  })
                }
              >
                {Object.entries(names).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label hidden={!fullForm && step !== 3}>
              Мова брифу
              <select
                className={field}
                value={data.language ?? "other"}
                onChange={(e) =>
                  setData({
                    ...data,
                    language: e.target.value as BriefData["language"],
                  })
                }
              >
                <option value="uk">Українська</option>
                <option value="en">English</option>
                <option value="other">Інша / не вказано</option>
              </select>
            </label>
            {Object.entries(labels).map(([key, label]) => (
              <label
                key={key}
                hidden={
                  !fullForm &&
                  step !==
                    (["budgetTerms", "sourceFiles"].includes(key) ? 5 : 3)
                }
              >
                {label}
                <textarea
                  className={field}
                  aria-label={label}
                  value={(data as any)[key]}
                  maxLength={
                    key === "description"
                      ? 8000
                      : key === "title"
                        ? 160
                        : key === "format" || key === "dimensions"
                          ? 300
                          : key === "result"
                            ? 3000
                            : key === "style"
                              ? 2000
                              : 1000
                  }
                  onChange={(e) => {
                    setData({ ...data, [key]: e.target.value });
                    setConfirmed(false);
                  }}
                />
              </label>
            ))}
            <div
              className="grid gap-3 sm:grid-cols-3"
              hidden={!fullForm && step !== 5}
            >
              <label>
                Концепти
                <input
                  className={field}
                  type="number"
                  min={1}
                  max={50}
                  value={data.concepts}
                  onChange={(e) =>
                    setData({ ...data, concepts: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Раунди правок
                <input
                  className={field}
                  type="number"
                  min={0}
                  max={50}
                  value={data.revisionRounds}
                  onChange={(e) =>
                    setData({ ...data, revisionRounds: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Дедлайн
                <input
                  className={field}
                  type="date"
                  value={data.deadline}
                  onChange={(e) =>
                    setData({ ...data, deadline: e.target.value })
                  }
                />
              </label>
            </div>
            <label hidden={!fullForm && step !== 5}>
              AI policy
              <select
                className={field}
                value={data.aiPolicy}
                onChange={(e) =>
                  setData({
                    ...data,
                    aiPolicy: e.target.value as BriefData["aiPolicy"],
                  })
                }
              >
                <option value="DISCLOSE">
                  AI дозволено з розкриттям використання
                </option>
                <option value="ALLOWED">AI дозволено</option>
                <option value="FORBIDDEN">AI заборонено</option>
              </select>
            </label>
            <label hidden={!fullForm && step !== 3}>
              Публічні референси — HTTP(S), по рядку
              <textarea
                className={field}
                value={data.references.join("\n")}
                onChange={(e) =>
                  setData({ ...data, references: e.target.value.split("\n") })
                }
              />
            </label>
            <button
              className={button}
              disabled={busy || state.brief?.status === "CONFIRMED"}
            >
              Зберегти бриф і scope
            </button>
          </form>
          <aside
            hidden={!fullForm && step !== 3}
            className="space-y-2 rounded border border-slate-700 p-3"
          >
            <label>
              Модель AI (порожньо — автоматично)
              <input
                className={field}
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              />
            </label>
            <p>
              AI отримує лише поля брифу, без рукопису й приватних сутностей.
              Відповідь змінить тільки форму; перегляньте та збережіть її
              самостійно.
            </p>
            <button
              className={button}
              disabled={busy || state.brief?.status === "CONFIRMED"}
              onClick={() =>
                void run(async () => {
                  const result = await api("/brief/ai", "POST", {
                    expectedVersion: version,
                    data: {
                      ...data,
                      references: data.references.filter(Boolean),
                    },
                    modelId: modelId || undefined,
                  });
                  setData(result.draft);
                  setConfirmed(false);
                  setPreview(false);
                  setNotice(
                    "AI-чернетка у формі. Не збережено і не опубліковано.",
                  );
                })
              }
            >
              Допомогти скласти ТЗ
            </button>
          </aside>
          <section
            hidden={!fullForm && step !== 4}
            aria-label="Дерево матеріалів"
            className="space-y-2"
          >
            <h2 className="font-bold">Scope майбутнього виконавця</h2>
            <p>
              Вибір глави включає всі її сцени; вибір книги — всю книгу.
              Обирайте найменший необхідний обсяг. Частини й Style Bible без
              даних не створюються автоматично.
            </p>
            {state.targets.map((t) => {
              const item = scope.find(
                (s) => s.scope === t.scope && s.ref === t.ref,
              );
              return (
                <label
                  key={JSON.stringify([t.scope, t.ref])}
                  className={
                    "flex flex-wrap items-center gap-2 " +
                    (t.scope === "scene"
                      ? "pl-6"
                      : t.scope === "chapter"
                        ? "pl-3"
                        : "")
                  }
                >
                  <span className="min-w-0 break-words">
                    {t.scope}: {t.label}
                  </span>
                  <select
                    aria-label={`Доступ ${t.label}`}
                    className={field + " max-w-40"}
                    value={item?.level ?? "NONE"}
                    onChange={(e) => {
                      setScope((prev) => [
                        ...prev.filter(
                          (s) => !(s.scope === t.scope && s.ref === t.ref),
                        ),
                        ...(e.target.value === "NONE"
                          ? []
                          : [
                              {
                                scope: t.scope,
                                ref: t.ref,
                                level: e.target.value as Selection["level"],
                              },
                            ]),
                      ]);
                      setConfirmed(false);
                    }}
                  >
                    {["NONE", "VIEW", "COMMENT", "WORK", "MANAGE"].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </section>
          <section hidden={!fullForm && step !== 6} className="space-y-3">
            <h2 className="font-bold">Підтвердження публічного брифу</h2>
            <button
              className={button}
              disabled={busy || dirty || !state.brief}
              onClick={() => setPreview(!preview)}
            >
              Переглянути збережений публічний бриф
            </button>
            {preview && (
              <>
                <pre className="whitespace-pre-wrap break-words rounded border border-slate-700 p-3">
                  {JSON.stringify(state.brief?.data, null, 2)}
                </pre>
                <p>
                  Публікуються тільки ці поля. Scope, рукопис і приватні
                  ідентифікатори не надсилаються. Референси мають бути
                  публічними; перевірте текст на приватну інформацію.
                </p>
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Підтверджую надсилання цього брифу в Marketplace на модерацію
                </label>
                <button
                  className={button}
                  disabled={busy || dirty || !confirmed}
                  onClick={() =>
                    void run(async () => {
                      try {
                        await api("/brief/publish", "POST", {
                          expectedVersion: version,
                          confirmed: true,
                        });
                      } catch (e) {
                        await load();
                        throw e;
                      }
                      await load();
                      setNotice(
                        "Бриф надіслано на модерацію. Доступ до книги не змінено.",
                      );
                    })
                  }
                >
                  Надіслати підтверджений бриф
                </button>
              </>
            )}
            {state.brief?.published && (
              <p>
                Підтверджений snapshot: версія {state.brief.published.revision}.
                Нова чернетка не замінює його автоматично.
              </p>
            )}
          </section>
          {!fullForm && (
            <div
              className="flex flex-wrap items-center gap-3"
              aria-label="Навігація майстра"
            >
              <button
                type="button"
                className={button}
                disabled={busy || step === 1}
                onClick={() => setStep(step - 1)}
              >
                Назад
              </button>
              <span>Крок {step} з 6</span>
              <button
                type="button"
                className={button}
                disabled={busy || step === 6}
                onClick={() => setStep(step + 1)}
              >
                Далі
              </button>
              <p className="text-sm">
                Перехід між кроками не зберігає і не публікує. Після scope й
                умов збережіть бриф на кроці 5; на кроці 6 перегляньте
                збережений текст і підтвердьте надсилання.
              </p>
            </div>
          )}
          <section className="space-y-3">
            <h2 className="font-bold">Явно надати доступ активному учаснику</h2>
            <p>
              До вибору виконавця доступ не надається автоматично. Тут можна
              працювати з уже доданим учасником книги. Доступи цієї книги
              об’єднуються; NONE у брифі не відкликає раніше надані права.
            </p>
            <label>
              Учасник
              <select
                className={field}
                value={user}
                onChange={(e) => {
                  setUser(e.target.value);
                  setGrantConfirm(false);
                }}
              >
                <option value="">Оберіть учасника</option>
                {state.participants.map((p) => (
                  <option key={p.userId}>{p.userId}</option>
                ))}
              </select>
            </label>
            <label>
              Конкретний матеріал
              <select
                className={field}
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                  setGrantConfirm(false);
                }}
              >
                <option value="">Оберіть матеріал</option>
                {state.targets.map((t) => (
                  <option
                    key={JSON.stringify([t.scope, t.ref])}
                    value={JSON.stringify([t.scope, t.ref])}
                  >
                    {t.scope}: {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Рівень
              <select
                className={field}
                value={level}
                onChange={(e) => {
                  setLevel(e.target.value as Selection["level"]);
                  setGrantConfirm(false);
                }}
              >
                {["VIEW", "COMMENT", "WORK", "MANAGE"].map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label>
              Діє від
              <input
                type="datetime-local"
                className={field}
                value={validFrom}
                onChange={(e) => setValidFrom(e.target.value)}
              />
            </label>
            <label>
              Діє до
              <input
                type="datetime-local"
                className={field}
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={grantConfirm}
                onChange={(e) => setGrantConfirm(e.target.checked)}
              />
              Підтверджую надання {level} на цей матеріал учаснику {user}
            </label>
            <button
              className={button}
              disabled={busy || !grantConfirm || !user || !selectedTarget}
              onClick={() =>
                void run(async () => {
                  await api("/access", "POST", {
                    confirmed: true,
                    userId: user,
                    target: {
                      scope: selectedTarget.scope,
                      ref: selectedTarget.ref,
                      level,
                    },
                    ...(validFrom
                      ? { validFrom: new Date(validFrom).toISOString() }
                      : {}),
                    ...(validUntil
                      ? { validUntil: new Date(validUntil).toISOString() }
                      : {}),
                  });
                  setGrantConfirm(false);
                  setAccess(await api("/access"));
                  setNotice("Доступ надано.");
                })
              }
            >
              Надати підтверджений доступ
            </button>
            {access.grants
              .filter((g) => g.status === "active")
              .map((g) => (
                <article
                  key={g.id}
                  className="flex flex-wrap gap-2 border border-slate-700 p-2"
                >
                  <span className="break-all">
                    {g.scopeType} {g.scopeRef} · {g.level} · учасник{" "}
                    {g.participantId} · до {g.validUntil ?? "відкликання"}
                  </span>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/access/${g.id}`, "DELETE");
                        setAccess(await api("/access"));
                      })
                    }
                  >
                    Відкликати
                  </button>
                </article>
              ))}
            <details>
              <summary>Аудит доступу ({access.events.length})</summary>
              <pre className="overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(access.events, null, 2)}
              </pre>
            </details>
          </section>
        </>
      )}
    </section>
  );
}

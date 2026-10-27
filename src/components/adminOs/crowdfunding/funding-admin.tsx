"use client";
import { useCallback, useEffect, useState } from "react";
import {
  AdminState,
  Campaign,
  FundingRequest,
  FundingSettings,
  money,
  status,
  toMinor,
} from "./funding-types";
import "./funding.css";
export function FundingAdmin({
  request,
  theme = "marketplace",
}: {
  request: FundingRequest;
  theme?: "studio" | "marketplace";
}) {
  const [state, setState] = useState<AdminState | null>(null),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [recipient, setRecipient] = useState<{ name: string; iban: string } | null>(
      null,
    );
  const load = useCallback(async () => {
    setState(await request<AdminState>(""));
  }, [request]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);
  async function act(
    path: string,
    body: unknown,
    message: string,
    method = "POST",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await request(path, method, body);
      await load();
      setNotice(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Помилка фінансової операції.");
    } finally {
      setBusy(false);
    }
  }
  const c =
    state?.campaigns.find((c) => c.id === selected) || state?.campaigns[0];
  const canReview = state?.permissions.includes("funding:review"),
    canPayout = state?.permissions.includes("funding:payout");
  return (
    <div className="funding" data-theme={theme}>
      <span className="fund-eyebrow">Fusion Lab · Фінанси проєктів</span>
      <h1>Краудфандинг STEAM</h1>
      <p className="fund-lead">
        100% цілі → 3% платформі → 97% команді за етапами паспорта.
      </p>
      <p className="fund-notice">
        Банківські перекази виконує оператор у банку. Тут записуються їхні
        документи та фактичне підтвердження. Запит або схвалення траншу резервує
        кошти.
      </p>
      {error && (
        <p className="fund-notice fund-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="fund-notice" role="status">
          {notice}
        </p>
      )}
      <div className="fund-actions">
        <button
          className="fund-secondary"
          disabled={busy}
          onClick={() => {
            setError("");
            void load().catch((e) => setError(e.message));
          }}
        >
          Оновити дані
        </button>
        <a
          href="https://www.fusionlab.in.ua/crowdfunding"
          target="_blank"
          rel="noreferrer"
        >
          Вітрина зборів ↗
        </a>
      </div>
      {!state ? (
        <p role="status">Завантаження фінансових даних…</p>
      ) : (
        <>
          {canReview && (
            <SettingsForm
              settings={state.settings}
              gateway={state.gatewayConfigured}
              busy={busy}
              save={(body) =>
                act("/settings", body, "Налаштування збережено.", "PUT")
              }
            />
          )}
          <section className="fund-section">
            <h2>Кампанії · {state.campaigns.length}</h2>
            {state.campaigns.length === 0 ? (
              <p className="fund-empty">
                Заявок поки немає. Керівник команди подає фінансовий розділ
                електронного паспорта.
              </p>
            ) : (
              <>
                <label>
                  Проєкт
                  <select
                    value={c?.id || ""}
                    onChange={(e) => {
                      setSelected(e.target.value);
                      setRecipient(null);
                      setError("");
                      setNotice("");
                    }}
                  >
                    {state.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title} · {status(c.status)}
                      </option>
                    ))}
                  </select>
                </label>
                {c && (
                  <div key={c.id}>
                    <div className="fund-card">
                      <p className="fund-eyebrow">
                        {c.team.name} · {status(c.status)}
                      </p>
                      <h2>{c.title}</h2>
                      <p>{c.summary}</p>
                      <div className="fund-stats">
                        {[
                          ["Повна ціль", c.targetMinor],
                          ["Команді · чистий бюджет", c.teamBudgetMinor],
                          ["Отримано внесків", c.raisedMinor],
                          ["Комісія платформи", c.feeMinor],
                          ["Передано команді", c.paidOutMinor],
                          ["Зарезервовано", c.reservedMinor],
                          ["Вільний бюджет команди", c.availableTeamMinor],
                          ["Доступно за банком", c.availableCashMinor],
                          ["Повернено", c.refundedMinor],
                          ["Резерв повернень", c.refundHoldMinor],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{money(value)}</dd>
                          </div>
                        ))}
                      </div>
                      {c.reviewReason && (
                        <p className="fund-notice">{c.reviewReason}</p>
                      )}
                      <p className="fund-check">
                        Паспорт: версія {c.snapshot?.passportRevision} · SHA-256{" "}
                        {c.snapshot?.sha256}
                      </p>
                      <a
                        href={`https://www.fusionlab.in.ua/crowdfunding/${c.slug}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Публічна сторінка ↗
                      </a>
                      <details>
                        <summary>
                          Зафіксований паспорт, бюджет та отримувач
                        </summary>
                        <h3>Мета</h3>
                        <p className="fund-pre">
                          {c.snapshot?.content.objective}
                        </p>
                        <h3>Результат</h3>
                        <p className="fund-pre">{c.snapshot?.content.result}</p>
                        {c.snapshot?.content.budget.map((b, i) => (
                          <p key={i}>
                            <strong>
                              {b.title} · {money(b.amountMinor)}
                            </strong>
                            <br />
                            {b.justification}
                          </p>
                        ))}
                        <h3>Отримувач</h3>
                        <p>
                          {c.snapshot?.content.recipientName} ·{" "}
                          {c.snapshot?.content.recipientType === "organization"
                            ? "Організація"
                            : "Повнолітній представник"}
                        </p>
                        <p className="fund-pre">
                          {c.snapshot?.content.recipientMandate}
                        </p>
                        {canPayout && (
                          <button
                            type="button"
                            className="fund-secondary"
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              void request<{ name: string; iban: string }>(
                                `/campaigns/${c.id}/recipient`,
                              )
                                .then(setRecipient)
                                .catch((e) => setError(e.message));
                            }}
                          >
                            Показати реквізити для банківського переказу
                          </button>
                        )}
                        {recipient && (
                          <p className="fund-notice">
                            {recipient.name}
                            <br />
                            {recipient.iban}
                          </p>
                        )}
                      </details>
                      {canReview && (
                        <ReviewForm
                          c={c}
                          busy={busy}
                          save={(body) =>
                            act(
                              `/campaigns/${c.id}/review`,
                              { ...body, expectedVersion: c.version },
                              "Рішення збережено.",
                            )
                          }
                        />
                      )}
                    </div>
                    {canPayout && (
                      <BankForm
                        busy={busy}
                        save={(body) =>
                          act(
                            `/campaigns/${c.id}/bank-facts`,
                            body,
                            "Банківський документ записано.",
                          )
                        }
                      />
                    )}
                    <section className="fund-section">
                      <h2>Етапи, звіти та транші</h2>
                      {c.milestones.map((m, i) => (
                        <article
                          key={m.id}
                          className="fund-card"
                          style={{ marginBottom: 18 }}
                        >
                          <span className="fund-eyebrow">
                            Етап {i + 1} · {status(m.state)}
                          </span>
                          <h3>
                            {m.title} · {money(m.amountMinor)}
                          </h3>
                          <p>{m.deliverable}</p>
                          <p className="fund-muted">
                            {m.responsible} · До{" "}
                            {new Date(m.dueAt).toLocaleDateString("uk-UA")} ·
                            Аванс {money(m.advanceMinor)} · Прийняті витрати{" "}
                            {money(m.acceptedSpentMinor)}
                          </p>
                          <h3>Звіти</h3>
                          {m.reports.length === 0 && (
                            <p className="fund-muted">Звітів ще немає.</p>
                          )}
                          {m.reports.map((r) => (
                            <div className="fund-notice" key={r.id}>
                              <strong>
                                {status(r.state)} · {money(r.spentMinor)}
                              </strong>
                              <p className="fund-pre">{r.description}</p>
                              <p>
                                <strong>Публічно:</strong> {r.publicSummary}
                              </p>
                              <p className="fund-pre">
                                <strong>Підтвердження:</strong> {r.evidence}
                              </p>
                              {r.reviewNote && <p>Рішення: {r.reviewNote}</p>}
                              {canReview && r.state === "submitted" && (
                                <ReportForm
                                  busy={busy}
                                  save={(body) =>
                                    act(
                                      `/campaigns/${c.id}/reports/${r.id}`,
                                      body,
                                      "Рішення щодо звіту збережено.",
                                    )
                                  }
                                />
                              )}
                            </div>
                          ))}
                          <h3>Транші</h3>
                          {!m.disbursements?.length && (
                            <p className="fund-muted">
                              Запитів на транші ще немає.
                            </p>
                          )}
                          {m.disbursements?.map((p) => (
                            <div className="fund-notice" key={p.id}>
                              <strong>
                                {money(p.amountMinor)} ·{" "}
                                {p.kind === "advance"
                                  ? "Аванс"
                                  : "Остаточний транш"}{" "}
                                · {status(p.status)}
                              </strong>
                              <p>{p.purpose}</p>
                              {p.bankReference && (
                                <p>Банк: {p.bankReference}</p>
                              )}
                              {p.evidence && (
                                <p className="fund-pre">{p.evidence}</p>
                              )}
                              {canPayout &&
                                !["confirmed", "failed"].includes(p.status) && (
                                  <PayoutForm
                                    payoutStatus={p.status}
                                    busy={busy}
                                    save={(body) =>
                                      act(
                                        `/campaigns/${c.id}/payouts/${p.id}`,
                                        body,
                                        "Стан траншу оновлено.",
                                      )
                                    }
                                  />
                                )}
                            </div>
                          ))}
                        </article>
                      ))}
                    </section>
                    <details>
                      <summary>
                        Повернення внесків · {c.refunds?.length || 0}
                      </summary>
                      {c.refunds?.map((r) => (
                        <div key={r.id} className="fund-notice">
                          <strong>
                            {money(r.amountMinor)} · {status(r.status)}
                          </strong>
                          <p>{r.reason}</p>
                          {r.bankReference && <p>{r.bankReference}</p>}
                          {canPayout && r.status === "requested" && (
                            <BankEvidenceForm
                              label="Записати фактичне повернення"
                              busy={busy}
                              save={(body) =>
                                act(
                                  `/campaigns/${c.id}/refunds/${r.id}`,
                                  body,
                                  "Повернення підтверджено банківським документом.",
                                )
                              }
                            />
                          )}
                        </div>
                      ))}
                    </details>
                    <details>
                      <summary>Зарахування та поповнення платформи</summary>
                      {c.bankFacts?.map((b) => (
                        <p key={b.id}>
                          {b.kind === "settlement"
                            ? "Зарахування внесків"
                            : "Кошти платформи"}{" "}
                          · {money(b.amountMinor)} · Банківські витрати{" "}
                          {money(b.providerCostMinor)} · {b.bankReference}
                        </p>
                      ))}
                    </details>
                    <details>
                      <summary>Фінансовий журнал</summary>
                      <p className="fund-muted">
                        Останні 200 операцій. Кожна має збалансовані проводки.
                        Суми в копійках.
                      </p>
                      <div className="fund-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Дата</th>
                              <th>Операція</th>
                              <th>Рахунок</th>
                              <th>Копійки</th>
                            </tr>
                          </thead>
                          <tbody>
                            {c.ledger?.flatMap((b) =>
                              b.entries.map((e, i) => (
                                <tr key={`${b.id}-${i}`}>
                                  <td>
                                    {new Date(b.createdAt).toLocaleString(
                                      "uk-UA",
                                    )}
                                  </td>
                                  <td>{b.kind}</td>
                                  <td>{e.account}</td>
                                  <td>{e.deltaMinor}</td>
                                </tr>
                              )),
                            )}
                          </tbody>
                        </table>
                      </div>
                      <button
                        className="fund-secondary"
                        type="button"
                        onClick={() => exportLedger(c)}
                      >
                        Завантажити журнал CSV
                      </button>
                    </details>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
function exportLedger(c: Campaign) {
  const rows = [
    ["date", "operation", "account", "minor"],
    ...(c.ledger || []).flatMap((b) =>
      b.entries.map((e) => [b.createdAt, b.kind, e.account, e.deltaMinor]),
    ),
  ];
  const blob = new Blob(
    ["\ufeff" + rows.map((r) => r.join(";")).join("\r\n")],
    { type: "text/csv;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `funding-${c.slug}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function SettingsForm({
  settings: s,
  gateway,
  busy,
  save,
}: {
  settings: FundingSettings;
  gateway: boolean;
  busy: boolean;
  save: (b: unknown) => Promise<void>;
}) {
  const [d, setD] = useState(s);
  useEffect(() => setD(s), [s]);
  return (
    <details>
      <summary>Налаштування оператора та приймання внесків</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({ ...d, expectedVersion: s.version, version: undefined });
        }}
      >
        <p className="fund-muted">
          Платіжний сервіс: {gateway ? "налаштований" : "ще не налаштований"}.
          Перед відкриттям внесків оператор перевіряє договірні умови зборів і
          повернень.
        </p>
        <label>
          Назва оператора
          <input
            required
            maxLength={240}
            value={d.operatorName}
            onChange={(e) => setD({ ...d, operatorName: e.target.value })}
          />
        </label>
        <label>
          Умови участі, призначення коштів, розподіл 97/3
          <textarea
            required
            minLength={60}
            maxLength={12000}
            value={d.terms}
            onChange={(e) => setD({ ...d, terms: e.target.value })}
          />
        </label>
        <label>
          Правила повернення та відповідальність платформи
          <textarea
            required
            minLength={60}
            maxLength={12000}
            value={d.refundPolicy}
            onChange={(e) => setD({ ...d, refundPolicy: e.target.value })}
          />
        </label>
        <label>
          Час звірки незавершених внесків після кінця збору, хв
          <input
            type="number"
            min={30}
            max={10080}
            value={d.settlementGraceMinutes}
            onChange={(e) =>
              setD({ ...d, settlementGraceMinutes: Number(e.target.value) })
            }
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={d.liveEnabled}
            disabled={!gateway}
            onChange={(e) => setD({ ...d, liveEnabled: e.target.checked })}
          />
          Увімкнути приймання внесків після перевірки умов оператором
        </label>
        <button disabled={busy}>Зберегти налаштування</button>
      </form>
    </details>
  );
}
function ReviewForm({
  c,
  busy,
  save,
}: {
  c: Campaign;
  busy: boolean;
  save: (b: {
    action: string;
    reason: string;
    recipientVerification: string;
  }) => Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [verification, setVerification] = useState("");
  const actions =
    c.status === "review"
      ? [
          ["publish", "Схвалити й опублікувати"],
          ["reject", "Відхилити заявку"],
        ]
      : c.status === "active"
        ? [
            ["pause", "Призупинити збір"],
            ["close", "Закрити нові внески"],
          ]
        : c.status === "paused"
          ? [
              ["resume", "Відновити збір"],
              ["close", "Закрити нові внески"],
            ]
          : c.status === "funded"
            ? [
                ["pause", "Призупинити виконання"],
                ["finish", "Завершити проєкт"],
              ]
            : c.status === "execution_paused"
              ? [["resume", "Відновити виконання"]]
              : [];
  return actions.length ? (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
          "value",
        );
        if (action)
          void save({ action, reason, recipientVerification: verification });
      }}
    >
      <h3>Рішення адміністратора</h3>
      {c.status === "review" && (
        <label>
          Результат перевірки отримувача, повноважень і паспорта
          <textarea
            minLength={10}
            maxLength={2000}
            value={verification}
            onChange={(e) => setVerification(e.target.value)}
            placeholder="Документи, підтверджені реквізити, дорослий представник…"
          />
        </label>
      )}
      <label>
        Пояснення рішення
        <textarea
          maxLength={3000}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="fund-actions">
        {actions.map(([action, label]) => (
          <button disabled={busy} name="action" value={action} key={action}>
            {label}
          </button>
        ))}
      </div>
    </form>
  ) : null;
}
function BankForm({
  busy,
  save,
}: {
  busy: boolean;
  save: (b: unknown) => Promise<void>;
}) {
  const [kind, setKind] = useState("settlement"),
    [amount, setAmount] = useState(""),
    [cost, setCost] = useState("0");
  return (
    <details>
      <summary>Додати банківське зарахування</summary>
      <BankEvidenceForm
        busy={busy}
        label="Записати зарахування з виписки"
        save={(b) =>
          save({
            ...b,
            kind,
            amountMinor: toMinor(amount),
            providerCostMinor: toMinor(cost),
          })
        }
      >
        <div className="fund-row">
          <label>
            Вид
            <select
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setCost("0");
              }}
            >
              <option value="settlement">Зарахування внесків</option>
              <option value="platform_topup">
                Поповнення власними коштами платформи
              </option>
            </select>
          </label>
          <label>
            Повна сума до комісії, грн
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <label>
            Утримано банком, грн
            <input
              required
              type="number"
              min="0"
              step="0.01"
              disabled={kind === "platform_topup"}
              value={cost}
              onChange={(e) => setCost(e.target.value)}
            />
          </label>
        </div>
        <p className="fund-muted">
          Банківські витрати не зменшують бюджет команди. Якщо доступних коштів
          бракує, платформа поповнює рахунок власним коштом.
        </p>
      </BankEvidenceForm>
    </details>
  );
}
function BankEvidenceForm({
  busy,
  label,
  save,
  children,
}: {
  busy: boolean;
  label: string;
  save: (b: { bankReference: string; evidence: string }) => Promise<void>;
  children?: React.ReactNode;
}) {
  const [reference, setReference] = useState(""),
    [evidence, setEvidence] = useState(""),
    [checked, setChecked] = useState(false);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save({ bankReference: reference, evidence });
      }}
    >
      {children}
      <label>
        Унікальний номер банківського документа
        <input
          required
          minLength={8}
          maxLength={180}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </label>
      <label>
        Підтвердження з банківської виписки
        <textarea
          required
          minLength={10}
          maxLength={4000}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          required
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        Я звірив фактичну операцію з банківською випискою
      </label>
      <button disabled={busy || !checked}>{label}</button>
    </form>
  );
}
function ReportForm({
  busy,
  save,
}: {
  busy: boolean;
  save: (b: { action: string; note: string }) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const action = (e.nativeEvent as SubmitEvent).submitter?.getAttribute(
          "value",
        );
        if (action) void save({ action, note });
      }}
    >
      <label>
        Рішення щодо результату та документів
        <textarea
          required
          minLength={3}
          maxLength={3000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </label>
      <div className="fund-actions">
        <button disabled={busy} value="accept">
          Прийняти звіт
        </button>
        <button disabled={busy} value="rework" className="fund-secondary">
          На доопрацювання
        </button>
      </div>
    </form>
  );
}
function PayoutForm({
  payoutStatus: s,
  busy,
  save,
}: {
  payoutStatus: string;
  busy: boolean;
  save: (b: unknown) => Promise<void>;
}) {
  const [evidence, setEvidence] = useState("");
  return (
    <>
      {s === "requested" && (
        <button
          disabled={busy}
          onClick={() => void save({ action: "approve" })}
        >
          Схвалити транш
        </button>
      )}
      {["approved", "reconciliation"].includes(s) && (
        <BankEvidenceForm
          busy={busy}
          label="Підтвердити фактичний банківський переказ"
          save={(b) => save({ ...b, action: "confirm" })}
        />
      )}
      <details>
        <summary>Звірка або відмова переказу</summary>
        <label>
          Доказ відмови / стан банківської звірки
          <textarea
            required
            minLength={10}
            maxLength={4000}
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
          />
        </label>
        <div className="fund-actions">
          {s === "approved" && (
            <button
              className="fund-secondary"
              disabled={busy || evidence.length < 10}
              onClick={() => void save({ action: "unknown", evidence })}
            >
              Переказ потребує звірки · резерв зберегти
            </button>
          )}
          <button
            className="fund-secondary"
            disabled={busy || evidence.length < 10}
            onClick={() => void save({ action: "fail", evidence })}
          >
            Підтверджено відсутність переказу · зняти резерв
          </button>
        </div>
      </details>
    </>
  );
}

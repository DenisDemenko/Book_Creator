import React, { useEffect, useState } from "react";
const profiles = [
  ["table", "Столи"],
  ["cabinet", "Тумби"],
  ["wardrobe", "Шафи"],
  ["dome", "Куполи"],
];
export function ConstructorTariffEditor({
  input,
  rates,
}: {
  input: any;
  rates: any;
}) {
  const [state, setState] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    fetch("/api/admin/constructor-products/tariffs", {
      credentials: "same-origin",
    })
      .then(async (r) => {
        if (r.status === 403) return;
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        if (active) setState(b);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  if (!state)
    return error ? (
      <p className="px-6 text-sm text-amber-300">
        Тарифи конфігурацій: {error}
      </p>
    ) : null;
  const patch = (data: any) => setState({ ...state, data });
  const data = state.data,
    keys = [
      ...new Set([
        ...state.suggestions.map((s: any) => s.key),
        ...Object.keys(data.items),
      ]),
    ];
  return (
    <section
      className="mx-auto my-6 max-w-7xl rounded-2xl border border-cyan-500/30 bg-slate-900 p-5 text-white"
      aria-label="Тарифи чотирьох конструкторів"
    >
      <h2 className="text-xl font-bold">Єдині тарифи конструкторів</h2>
      <p className="my-2 text-sm text-slate-300">
        Столи · тумби · шафи · куполи. Версія {state.version}. Зміна ставок
        потребує перерахунку чернеток; ціни опублікованих товарів і старі
        замовлення зберігаються.
      </p>
      <label>
        <input
          type="checkbox"
          checked={data.enabled}
          onChange={(e) => patch({ ...data, enabled: e.target.checked })}
        />{" "}
        Активувати затверджений довідник
      </label>
      <div className="my-3 flex flex-wrap gap-4">
        {["USD", "EUR"].map((currency) => (
          <label key={currency}>
            {currency} → грн
            <input
              type="number"
              className="ml-2 w-24 rounded bg-white/10 p-2"
              min="0.001"
              step="0.001"
              value={data.rates[currency] ?? ""}
              onChange={(e) =>
                patch({
                  ...data,
                  rates: {
                    ...data.rates,
                    [currency]:
                      e.target.value === "" ? null : Number(e.target.value),
                  },
                })
              }
            />
          </label>
        ))}
        <button
          type="button"
          className="rounded border px-3 py-2"
          onClick={() => {
            const items = { ...data.items };
            const set = (key: string, unit: string, price: number) => {
              if (Number.isFinite(price) && price >= 0)
                items[key] = {
                  unit,
                  currency: "UAH",
                  priceMinor: Math.round(price * 100),
                  wastePercent: 0,
                };
            };
            set("material:resin", "kg", input.epoxyPricePerLiter / 1.1);
            set(
              "operation:cnc",
              "hour",
              input.cncMachineRatePerHour + input.cncOperatorRatePerHour,
            );
            const area = (input.woodLengthMm * input.woodWidthMm) / 1e6;
            if (area > 0)
              set(
                "operation:finish",
                "m2",
                ((input.finishAmountMl / 1000) * input.finishCostPerLiter +
                  input.abrasivesAndSandingCost) /
                  area,
              );
            patch({
              ...data,
              rates: { UAH: 1, USD: rates.USD, EUR: rates.EUR },
              items,
            });
          }}
        >
          Взяти сумісні ставки поточного розрахунку
        </button>
      </div>
      <div className="overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Матеріал / операція</th>
              <th>Од.</th>
              <th>Ціна за одиницю</th>
              <th>Валюта</th>
              <th>Відходи, %</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key: any) => {
              const row = state.suggestions.find((s: any) => s.key === key) || {
                  name: key,
                  unit: data.items[key].unit,
                },
                item = data.items[key];
              const update = (p: any) =>
                patch({
                  ...data,
                  items: {
                    ...data.items,
                    [key]: {
                      unit: row.unit,
                      currency: "UAH",
                      wastePercent: 0,
                      priceMinor: 0,
                      ...item,
                      ...p,
                    },
                  },
                });
              return (
                <tr key={key} className="border-t border-white/10">
                  <td className="py-2">{row.name}</td>
                  <td>{row.unit}</td>
                  <td>
                    <input
                      aria-label={"Тариф: " + row.name}
                      type="number"
                      className="w-28 rounded bg-white/10 p-2"
                      min="0"
                      step="0.01"
                      placeholder="Потрібна ціна"
                      value={item ? item.priceMinor / 100 : ""}
                      onChange={(e) => {
                        if (e.target.value === "") {
                          const items = { ...data.items };
                          delete items[key];
                          patch({ ...data, items });
                        } else
                          update({
                            priceMinor: Math.round(
                              Number(e.target.value) * 100,
                            ),
                          });
                      }}
                    />
                  </td>
                  <td>
                    <select
                      className="rounded bg-slate-800 p-2"
                      value={item?.currency || "UAH"}
                      onChange={(e) => update({ currency: e.target.value })}
                    >
                      {["UAH", "USD", "EUR"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={300}
                      className="w-20 rounded bg-white/10 p-2"
                      value={item?.wastePercent ?? 0}
                      onChange={(e) =>
                        update({ wastePercent: Number(e.target.value) })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {profiles.map(([id, label]) => (
        <details key={id} className="mt-4 rounded border border-white/10 p-3">
          <summary>{label} · правила ціни й нормативи часу</summary>
          <label className="mt-3 block">
            Режим податку
            <select
              className="ml-2 rounded bg-slate-800 p-2"
              value={data.profiles[id].taxMode || "single_turnover_5"}
              onChange={(e) =>
                patch({
                  ...data,
                  profiles: {
                    ...data.profiles,
                    [id]: { ...data.profiles[id], taxMode: e.target.value },
                  },
                })
              }
            >
              <option value="single_turnover_5">З обороту</option>
              <option value="profit_tax_18">З прибутку</option>
              <option value="custom">Інший відсоток з прибутку</option>
            </select>
          </label>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["markupPercent", "Націнка, %", 1],
              ["taxPercent", "Податок, %", 1],
              ["overheadMinor", "Накладні на виріб, грн", 100],
              ["packagingMinor", "Упаковка, грн", 100],
              ["rawDeliveryMinor", "Доставка сировини, грн", 100],
            ].map(([k, name, scale]) => (
              <label key={String(k)}>
                {name}
                <input
                  className="block rounded bg-white/10 p-2"
                  type="number"
                  min={0}
                  step="0.01"
                  value={data.profiles[id][k] / Number(scale)}
                  onChange={(e) =>
                    patch({
                      ...data,
                      profiles: {
                        ...data.profiles,
                        [id]: {
                          ...data.profiles[id],
                          [k]: Number(e.target.value) * Number(scale),
                        },
                      },
                    })
                  }
                />
              </label>
            ))}
            {[
              ["labor:assembly", "Складання, год"],
              ["labor:design", "Підготовка, год"],
              ["operation:cnc", "ЧПУ, год"],
              ["operation:engraving", "Гравіювання, год"],
              ["labor:engineering", "Інженерна підготовка, год"],
            ].map(([key, name]) => (
              <label key={key}>
                {name}
                <input
                  className="block rounded bg-white/10 p-2"
                  type="number"
                  min={0}
                  step="0.1"
                  value={data.profiles[id].quantities[key] ?? ""}
                  onChange={(e) => {
                    const quantities = { ...data.profiles[id].quantities };
                    if (e.target.value === "") delete quantities[key];
                    else quantities[key] = Number(e.target.value);
                    patch({
                      ...data,
                      profiles: {
                        ...data.profiles,
                        [id]: { ...data.profiles[id], quantities },
                      },
                    });
                  }}
                />
              </label>
            ))}
          </div>
        </details>
      ))}
      <button
        type="button"
        disabled={busy}
        className="mt-4 rounded-xl border border-cyan-400 px-4 py-3"
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/admin/constructor-products/tariffs", {
                method: "PUT",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ expectedVersion: state.version, data }),
              }),
              v = await r.json();
            if (!r.ok) throw Error(v.error);
            setState({ ...state, version: v.version, data: v.data });
            setError(
              "Тарифи збережено. Відкрийте товар і перераховуйте ціну перед публікацією.",
            );
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Зберегти версію тарифів
      </button>
      <p role="status" className="mt-3 text-sm">
        {error}
      </p>
    </section>
  );
}

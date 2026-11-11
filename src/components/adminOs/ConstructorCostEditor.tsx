import React, { useState } from "react";
import type { FurnitureProduct } from "./furnitureProduct";
export function ConstructorCostEditor({
  product,
  change,
}: {
  product: FurnitureProduct;
  change: (p: FurnitureProduct) => void;
}) {
  const c = product.constructorSource!,
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    money = (n: number) =>
      (n / 100).toLocaleString("uk-UA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }) + " ₴";
  const patch = (group: "quantities" | "commercial", key: string, value: any) =>
    change({
      ...product,
      constructorSource: { ...c, [group]: { ...c[group], [key]: value } },
    });
  return (
    <section
      className="my-5 rounded-2xl border border-amber-500/40 bg-amber-950/10 p-5"
      aria-label="Калькуляція конструктора"
    >
      <h2 className="text-lg font-bold">
        Створено в конструкторі Fusion Lab Studio
      </h2>
      <p className="text-sm opacity-70">
        Версія конфігурації {c.revision} · тарифи {c.tariffVersion}.
        Собівартість і виробничі файли бачить лише власник.
      </p>
      <div className="my-4 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Матеріал / операція</th>
              <th>Кількість</th>
              <th>Од.</th>
              <th>Вартість</th>
            </tr>
          </thead>
          <tbody>
            {c.quote.lines.map((r: any) => (
              <tr key={r.key} className="border-t border-current/10">
                <td className="py-2">
                  {r.name}
                  {!r.tariff && r.quantity !== 0 && (
                    <small className="block text-amber-500">
                      Потрібен тариф у калькуляторі витрат
                    </small>
                  )}
                </td>
                <td>
                  {c.bom.find((b) => b.key === r.key)?.quantity === null ? (
                    <input
                      aria-label={"Кількість: " + r.name}
                      className="w-24 rounded bg-white/10 p-2"
                      type="number"
                      min={0}
                      step="0.1"
                      value={c.quantities[r.key] ?? r.quantity ?? ""}
                      onChange={(e) => {
                        const quantities = { ...c.quantities };
                        if (e.target.value === "") delete quantities[r.key];
                        else quantities[r.key] = Number(e.target.value);
                        change({
                          ...product,
                          constructorSource: { ...c, quantities },
                        });
                      }}
                    />
                  ) : (
                    <span>
                      {Number(r.quantity).toLocaleString("uk-UA", {
                        maximumFractionDigits: 3,
                      })}
                    </span>
                  )}
                </td>
                <td>{r.unit}</td>
                <td>{r.tariff ? money(r.amountMinor) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="my-3 block">
        Режим податку
        <select
          className="ml-2 rounded bg-white/10 p-2"
          value={
            c.commercial.taxMode ??
            c.quote.settings.taxMode ??
            "single_turnover_5"
          }
          onChange={(e) => patch("commercial", "taxMode", e.target.value)}
        >
          <option value="single_turnover_5">З обороту</option>
          <option value="profit_tax_18">З прибутку</option>
          <option value="custom">Інший відсоток з прибутку</option>
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["markupPercent", "Націнка, %", 1],
          ["taxPercent", "Податок, %", 1],
          ["overheadMinor", "Накладні, грн", 100],
          ["packagingMinor", "Упаковка, грн", 100],
          ["rawDeliveryMinor", "Доставка сировини, грн", 100],
          ["adjustmentMinor", "Корекція ціни, грн", 100],
        ].map(([k, label, scale]) => (
          <label className="text-sm" key={String(k)}>
            {label}
            <input
              className="block w-full rounded bg-white/10 p-2"
              type="number"
              step="0.01"
              value={
                (c.commercial[k] ?? c.quote.settings[k] ?? 0) / Number(scale)
              }
              onChange={(e) =>
                patch(
                  "commercial",
                  String(k),
                  Number(e.target.value) * Number(scale),
                )
              }
            />
          </label>
        ))}
      </div>
      <label className="mt-3 block text-sm">
        Причина ручної корекції
        <input
          className="block w-full rounded bg-white/10 p-2"
          value={c.commercial.reason ?? c.quote.settings.reason ?? ""}
          onChange={(e) => patch("commercial", "reason", e.target.value)}
        />
      </label>
      <p className="my-3">
        Собівартість: <b>{money(c.quote.costMinor)}</b> · Продажна ціна:{" "}
        <b>{money(c.quote.sellingMinor)}</b>. Доставка готового виробу
        оплачується окремо.
      </p>
      {c.quote.issues.map((i: string) => (
        <p key={i} className="text-sm text-amber-500">
          {i}
        </p>
      ))}
      <div className="mt-3 flex flex-wrap gap-3">
        <button
          disabled={busy}
          type="button"
          className="rounded-xl border p-3"
          onClick={async () => {
            setBusy(true);
            try {
              const r = await fetch("/api/admin/furniture-products", {
                  method: "POST",
                  credentials: "same-origin",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ product }),
                }),
                b = await r.json();
              if (!r.ok) throw Error(b.error);
              change(b.product);
              setMessage(
                "Калькуляцію перераховано. Ціну замінено результатом розрахунку.",
              );
            } catch (e: any) {
              setMessage(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Перерахувати та зберегти
        </button>
        <button
          type="button"
          className="rounded-xl border p-3"
          onClick={async () => {
            try {
              const r = await fetch(
                  "/api/admin/constructor-products/" + c.id + "/files",
                ),
                file = await r.json();
              if (!r.ok) throw Error(file.error);
              const bytes = Uint8Array.from(atob(file.base64), (v) =>
                  v.charCodeAt(0),
                ),
                url = URL.createObjectURL(
                  new Blob([bytes], { type: file.type }),
                ),
                a = document.createElement("a");
              a.href = url;
              a.download = file.filename;
              a.click();
              setTimeout(() => URL.revokeObjectURL(url), 60000);
            } catch (e: any) {
              setMessage(e.message);
            }
          }}
        >
          Проєкт і SVG для ЧПУ ↓
        </button>
      </div>
      <p role="status" className="mt-2 text-sm">
        {message}
      </p>
    </section>
  );
}

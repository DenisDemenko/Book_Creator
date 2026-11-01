import React, { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../utils/basePath";

export function SlabInventoryPanel({ inventoryOnly = false }: { inventoryOnly?: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const receive = async (e: MessageEvent) => {
      if (
        e.origin !== location.origin ||
        e.source !== frame.current?.contentWindow
      )
        return;
      const m = e.data;
      if (m?.type !== "slab:request" || typeof m.id !== "string") return;
      const target = e.source as Window;
      try {
        const suffix =
          m.path === "/tables/state"
            ? "/state"
            : String(m.path).replace(/^\/tables\/admin/, "");
        const allowed =
          /^(GET \/state|POST \/(slabs|leg-designs|leg-plates)|DELETE \/(slabs|leg-designs|leg-plates)\/[a-zA-Z0-9-]+|PATCH \/(leg-designs|leg-plates)\/[a-zA-Z0-9-]+)$/.test(
            `${m.method} ${suffix}`,
          ) || (!inventoryOnly && /^(GET \/production|POST \/resin-textures|PUT \/(costs|leg-settings)|PATCH \/resin-textures\/[a-zA-Z0-9-]+|DELETE \/resin-textures\/[a-zA-Z0-9-]+|PATCH \/production\/[a-zA-Z0-9-]+)$/.test(
            `${m.method} ${suffix}`,
          ));
        if (!allowed)
          throw new Error(
            "У Студії доступні склад, витрати та виробництво. Конструктор покупця відкривається у маркетплейсі.",
          );
        const r = await fetch("/api/admin/slab-tables" + suffix, {
          method: m.method,
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: m.body ? JSON.stringify(m.body) : undefined,
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Помилка мосту.");
        target.postMessage(
          { type: "slab:response", id: m.id, result: data },
          location.origin,
        );
      } catch (error) {
        target.postMessage(
          {
            type: "slab:response",
            id: m.id,
            error:
              error instanceof Error
                ? error.message
                : "Не вдалося виконати дію.",
          },
          location.origin,
        );
      }
    };
    window.addEventListener("message", receive);
    setReady(true);
    return () => window.removeEventListener("message", receive);
  }, [inventoryOnly]);
  return (
    <section className="os-slab-inventory">
      <p className="mb-3 text-sm text-[rgba(181,217,253,.75)]">
        {inventoryOnly
          ? "Спільний склад слебів: фото, реальні розміри та перевірені векторні контури."
          : "Склад слебів і текстури смоли (можна завантажувати, перейменовувати та замінювати зображення). У вкладці «Виробництво» — замовлення покупців за етапами оплати: у кошику, передоплата 50% отримана, оплачено 100%. Після передоплати 50% натисніть «Прийняти в роботу»; залишок 50% покупець сплачує, коли стіл виготовлено, до відправлення. Тарифи публікуються з «Управління цінами»."}
      </p>
      {ready ? (
        <iframe
          ref={frame}
          title="Слеби та виробництво столів"
          src={`${API_BASE}/slab-studio/index.html?mode=${inventoryOnly ? 'inventory' : 'admin'}&host=studio`}
          className="os-slab-inventory-frame"
        />
      ) : (
        <p>Завантаження…</p>
      )}
    </section>
  );
}

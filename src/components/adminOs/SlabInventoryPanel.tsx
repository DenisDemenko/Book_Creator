import React, { useEffect, useRef, useState } from "react";
import { API_BASE } from "../../utils/basePath";

export function SlabInventoryPanel() {
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
          /^(GET \/(state|production)|POST \/slabs|PUT \/costs|DELETE \/slabs\/[a-zA-Z0-9-]+|PATCH \/production\/[a-zA-Z0-9-]+)$/.test(
            `${m.method} ${suffix}`,
          );
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
  }, []);
  return (
    <section>
      <p className="mb-3 text-sm text-slate-400">
        Склад слебів та оплачені передзамовлення Fusion Lab. Ціни публікуються з
        «Управління цінами». Ключ мосту залишається на сервері.
      </p>
      {ready ? (
        <iframe
          ref={frame}
          title="Слеби та виробництво столів"
          src={`${API_BASE}/slab-studio/index.html?mode=admin&host=studio`}
          style={{
            width: "100%",
            height: "85vh",
            minHeight: 700,
            border: 0,
            borderRadius: 16,
          }}
        />
      ) : (
        <p>Завантаження…</p>
      )}
    </section>
  );
}

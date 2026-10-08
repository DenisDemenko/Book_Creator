import { useState } from "react";
import type { CreativeProject } from "../../server/core/creative/projects";
export function CreativeOrderBinding({
  project,
  onSynced,
}: {
  project: CreativeProject;
  onSynced: () => Promise<void>;
}) {
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  if (!project.orderId) return null;
  return (
    <section className="space-y-3 rounded border border-slate-700 p-3">
      <h2 className="font-bold">Замовлення і вибір фахівця</h2>
      <a
        className="underline"
        href={`https://www.fusionlab.in.ua/creative-orders/${encodeURIComponent(project.orderId)}`}
      >
        Переглянути замовлення та порівняти заявки
      </a>
      <p>
        Статус проєкту: {project.status}.{" "}
        {project.specialistName && `Обрано: ${project.specialistName}.`}
      </p>
      <p>
        Після вибору виконавця у Marketplace синхронізуйте цей проєкт. Доступ до
        книги, ролі та запрошення надаються окремо; синхронізація їх не змінює.
      </p>
      <label className="block">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Підтверджую синхронізацію обраного фахівця і статусу
      </label>
      <button
        className="rounded border p-2 disabled:opacity-40"
        disabled={busy || !confirmed}
        onClick={() => {
          setBusy(true);
          setError("");
          setNotice("");
          void (async () => {
            const r = await fetch(
              `/api/creative/projects/${encodeURIComponent(project.id)}/order-sync`,
              {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ confirmed: true }),
              },
            );
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            await onSynced();
            setConfirmed(false);
            setNotice(
              data.waitingForStudioLogin
                ? "Вибір збережено. Фахівцю потрібно вперше увійти у Студію; після цього повторіть синхронізацію для прив’язки локального акаунта."
                : "Синхронізовано. Доступ до книги не змінено.",
            );
          })()
            .catch((e) => setError(e.message))
            .finally(() => setBusy(false));
        }}
      >
        Синхронізувати вибір
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import type { LabyrinthDefinition } from "../../../shared/labyrinth";
import {
  MECHANIC_KINDS,
  MECHANIC_LIBRARY,
  type MechanicKind,
} from "../../../shared/labyrinthMechanics";
import { gs } from "../graphStudio/gsApi";
const field =
  "w-full min-w-0 rounded border border-slate-600 bg-slate-950 p-2 text-sm";
export function MechanicLibrary({
  base,
  definition: d,
  onDraft,
  onWorking,
}: {
  base: string;
  definition: LabyrinthDefinition;
  onDraft: (definition: LabyrinthDefinition, eventId: string) => void;
  onWorking: (busy: boolean) => void;
}) {
  const [kind, setKind] = useState<MechanicKind>("bridge_block"),
    [bridgeId, setBridgeId] = useState(""),
    [responseId, setResponseId] = useState(""),
    [preparation, setPreparation] = useState(2),
    [duration, setDuration] = useState(4),
    [cooldown, setCooldown] = useState(3),
    [damage, setDamage] = useState(2),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const bridges = d.edges.filter(
    (e) => e.kind === "bridge" && e.overNodeIds.length,
  );
  const bridge = bridges.find((e) => e.id === bridgeId) ?? bridges[0];
  const responses = d.nodes.filter((n) =>
    kind === "false_route" ? n.id === bridge?.from : n.level === "lower",
  );
  const response = responses.find((n) => n.id === responseId) ?? responses[0];
  const spec = MECHANIC_LIBRARY[kind];
  const gated = ["bridge_block", "drawbridge", "barrier"].includes(kind);
  async function add() {
    if (!bridge || !response || busy) return;
    setBusy(true);
    onWorking(true);
    setNotice("");
    try {
      const result = await gs<{
        definition: LabyrinthDefinition;
        eventId: string;
      }>("POST", `${base}/mechanics/preview`, {
        definition: d,
        binding: {
          id: `mechanic-${crypto.randomUUID().slice(0, 8)}`,
          kind,
          bridgeId: bridge.id,
          responseNodeId: response.id,
          preparation,
          duration,
          cooldown,
          damage,
        },
      });
      if (!active.current) return;
      onDraft(result.definition, result.eventId);
      setNotice(
        "Механіку додано до чернетки. Перевірте й збережіть нову версію карти; прогін не запускається автоматично.",
      );
    } catch (e) {
      if (active.current)
        setNotice(
          e instanceof Error ? e.message : "Не вдалося додати механіку.",
        );
    } finally {
      if (active.current) {
        setBusy(false);
        onWorking(false);
      }
    }
  }
  return (
    <section
      className="space-y-3 rounded-xl border border-amber-600/50 p-3"
      data-mechanic-library
    >
      <h3 className="font-semibold">Бібліотека механік · 8 шаблонів</h3>
      <p className="text-sm">
        {spec.description} Додавання змінює лише чернетку. Перед активацією
        рушій перевіряє час, ресурси та всі заплановані небезпеки.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Механіка з бібліотеки
          <select
            className={field}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as MechanicKind);
              setNotice("");
            }}
          >
            {MECHANIC_KINDS.map((id) => (
              <option key={id} value={id}>
                {MECHANIC_LIBRARY[id].title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Міст механіки
          <select
            className={field}
            value={bridge?.id ?? ""}
            onChange={(e) => setBridgeId(e.target.value)}
          >
            {!bridges.length && (
              <option value="">Додайте міст і нижні вузли під ним</option>
            )}
            {bridges.map((e) => (
              <option key={e.id} value={e.id}>
                {d.nodes.find((n) => n.id === e.from)?.title} →{" "}
                {d.nodes.find((n) => n.id === e.to)?.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Місце відповіді
          <select
            className={field}
            value={response?.id ?? ""}
            onChange={(e) => setResponseId(e.target.value)}
          >
            {!responses.length && (
              <option value="">Немає відповідного місця</option>
            )}
            {responses.map((n) => (
              <option key={n.id} value={n.id}>
                {n.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Шкода за крок
          <input
            className={field}
            type="number"
            min={0}
            max={100}
            step={1}
            disabled={gated}
            value={damage}
            onChange={(e) => setDamage(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["Підготовка механіки", preparation, setPreparation, 1, 20],
            ["Тривалість механіки", duration, setDuration, 1, 20],
            ["Пауза механіки", cooldown, setCooldown, 0, 100],
          ] as const
        ).map(([label, value, update, min, max]) => (
          <label key={label}>
            {label}
            <input
              className={field}
              type="number"
              min={min}
              max={max}
              step={1}
              value={value}
              onChange={(e) => update(Number(e.target.value))}
            />
          </label>
        ))}
      </div>
      <p className="text-xs">
        Попередження: {spec.warning} Відповідь: {spec.response}. Уламки й
        обстріл не діють на вузли з укриттям; газ/вода охоплюють і їх. Для
        газу/води шкода наростає на 1 за кожен активний крок.
      </p>
      <button
        type="button"
        className="rounded border border-amber-600 px-3 py-2 disabled:opacity-40"
        disabled={busy || !bridge || !response}
        onClick={() => void add()}
      >
        Додати механіку до чернетки
      </button>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

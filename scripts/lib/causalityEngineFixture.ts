import { semanticFixture } from "./semanticChangeFixture";
import { syncBookToCore } from "../../server/core/sync";
import type { CoreRepository } from "../../server/core/types";
import { reconcileParagraphIds } from "../../src/utils/paragraphIds";
import type { JevAdapter } from "../../server/ai/adapters/jev";
export async function causalityFixture(repo: CoreRepository) {
  const f = await semanticFixture(repo);
  const scene = (id: string, text: string, order: number) => {
    const p = reconcileParagraphIds({ sectionId: id, content: text });
    return {
      id,
      content: text,
      title: id,
      order,
      paragraphIds: p.ids,
      paragraphHashes: p.hashes,
    };
  };
  (f.stored.book as any).chapters[0].sections = [
    scene("prior", "[/event:Схований лист] Лист сховали.", 0),
    scene("goal", "[/goal:Знайти лист] Герой прагне знайти лист.", 1),
    scene("state", "[/character-state:Тривога] Герой тривожиться.", 2),
    scene("decision", "[/decision:Шукати лист] Герой вирішив шукати лист.", 3),
    scene("effect", "[/event:Пошуки] Герой розпочав пошуки листа.", 4),
    scene("future", "[/event:Знахідка] Герой знайшов лист.", 5),
  ];
  await syncBookToCore(repo, f.stored);
  const entities = await repo.listEntities(f.stored.id);
  const named = (name: string) => {
    const e = entities.find((x) => x.name === name);
    if (!e) throw new Error(name);
    return e;
  };
  const effect = named("Пошуки"),
    cause = named("Шукати лист");
  const control = {
    selected: cause.id,
    confidence: 0.99,
    probability: 0.9,
    down: false,
    fallback: false,
    calls: [] as string[],
    states: [] as Record<string, unknown>[],
    onAsk: null as (() => Promise<void>) | null,
  };
  const jev: JevAdapter = {
    name: "jev",
    evaluate: async () => {
      throw new Error("unused");
    },
    askState: async (state, questions) => {
      const q = questions[0];
      control.calls.push(q.kind);
      control.states.push(state);
      await control.onAsk?.();
      if (control.down) throw new Error("controlled unavailable");
      return {
        model: "controlled-jev",
        answers: {
          [q.id]:
            q.kind === "choice"
              ? { choice: control.selected, confidence: control.confidence }
              : {
                  probability: control.probability,
                  confidence: control.confidence,
                },
        },
        usage: { input_tokens: 10, output_tokens: 0 },
        latency_ms: 1,
      };
    },
  };
  f.deps.services.jev = async () => (control.fallback ? null : jev);
  f.deps.services.generate = async ({ user }) => {
    if (!control.fallback) throw new Error("controlled fallback unavailable");
    return {
      text: JSON.stringify({
        answers: {
          choice: { choice: control.selected },
          noul: { probability: control.probability },
        },
      }),
      modelId: "controlled-deepseek",
      engine: "deepseek",
      inputTokens: 8,
      outputTokens: 2,
      costUsd: 0.001,
    };
  };
  return { ...f, effect, cause, named, control };
}

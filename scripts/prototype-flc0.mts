/**
 * Прототип FLC етапу 0 (Т1.6): прогін одного повного циклу retrieval →
 * профіль → Jev Choice/Score → LLM → чернетка на тестовій книзі й замір часу
 * та вартості — для звіту `docs/tz/FLC0_prototype_report.md`.
 *
 * Запуск: npm run prototype:flc0
 *   TYPESAFE_API_KEY=… — справжній Jev (інакше підставний);
 *   DEEPSEEK_API_KEY=… — справжня LLM для чернетки (інакше підставна).
 * Книга — у пам'яті (жодної бази не потрібно).
 */
import { MemoryCoreRepository } from '../server/core/memoryRepository.ts';
import { syncBookToCore } from '../server/core/sync.ts';
import { reconcileParagraphIds } from '../src/utils/paragraphIds.ts';
import { PROFILE_FACT } from '../server/core/characterProfile.ts';
import { runFlcCycle } from '../server/core/flc/cycle.ts';
import { HttpJevAdapter, jevState, LlmFallbackJevAdapter, MockJevAdapter, JEV_MODEL, type LlmJson } from '../server/core/flc/jev.ts';

const RUNS = Number(process.env.FLC_RUNS || 5);
const repo = new MemoryCoreRepository();
const P = 'flc0';
const sec = (id: string, content: string) => {
  const r = reconcileParagraphIds({ sectionId: id, content });
  return { id, title: id, order: 0, content, paragraphIds: r.ids, paragraphHashes: r.hashes };
};
const ch1 = Array.from({ length: 20 }, (_, i) =>
  i % 4 === 0 ? `[/character:Олена] [/emotion:страх] Олена знову згадала річку (${i}).` : i % 4 === 1 ? `[/character:Марко] Марко питав, де вона була (${i}).` : `Ніч над містом тягнулась повільно (${i}).`,
);
const ch2 = ['[/character:Олена] [/emotion:рішучість] Олена вирішила сказати правду.', '[/character:Олена] [/character:Марко] Вони говорили до ранку.'];
await syncBookToCore(repo, {
  id: P,
  ownerId: 'u',
  title: 'Прототип',
  book: {
    id: P,
    title: 'Прототип',
    characters: [{ id: 'c-o', name: 'Олена', role: 'protagonist', biography: 'Виросла біля річки; боїться води після загибелі брата.' }, { id: 'c-m', name: 'Марко' }],
    chapters: [
      { id: 'ch1', title: 'Ніч', order: 0, sections: [sec('s1', ch1.join('\n\n'))] },
      { id: 'ch2', title: 'Ранок', order: 1, sections: [sec('s2', ch2.join('\n\n'))] },
    ],
  },
});
const olena = (await repo.resolveAlias(P, 'character', 'Олена'))!;
const [p0] = (await repo.listParagraphs(P, 's1')).map((p) => p.id);
const f = await repo.addFinding({ projectId: P, entityId: olena, kind: PROFILE_FACT, payload: { field: 'fear', statement: 'Олена боїться води.' }, sourceParagraphIds: [p0], createdBy: 'ai:AI-2' });
await repo.setFindingStatus(P, f.id, 'confirmed', 'user:u');
await repo.createRelation({ projectId: P, type: 'opposes', fromId: (await repo.resolveAlias(P, 'character', 'Марко'))!, toId: olena, evidence: [p0], status: 'confirmed', createdBy: 'user:u' });

const deepseek = process.env.DEEPSEEK_API_KEY?.trim();
const llm: LlmJson = deepseek
  ? async (system, user) => {
      const r = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${deepseek}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.DEEPSEEK_MODEL || 'deepseek-flash', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], response_format: { type: 'json_object' } }),
      });
      const j: any = await r.json();
      if (!r.ok) throw new Error(`DeepSeek ${r.status}: ${j?.error?.message}`);
      return { text: j.choices[0].message.content, modelId: j.model, inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
    }
  : async (_s, u) => ({ text: JSON.stringify({ reply: 'Я була вдома. Чого ти питаєш?', intent: 'ухилитися' }), modelId: 'fake-llm', inputTokens: Math.ceil(u.length / 3), outputTokens: 30 });
const typesafe = process.env.TYPESAFE_API_KEY?.trim();
const jev = typesafe ? new HttpJevAdapter(typesafe, { model: JEV_MODEL }) : new MockJevAdapter();

const rows = [];
for (let i = 0; i < RUNS; i++) {
  const r = await runFlcCycle({ repo, jev, fallback: new LlmFallbackJevAdapter(llm), llm }, { projectId: P, entityId: olena, question: 'Олено, де ти була тієї ночі?', asOfChapter: 1, actorId: 'user:u' });
  rows.push(r);
}
const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const last = rows[rows.length - 1];
const stateChars = JSON.stringify(jevState(last.snapshot)).length;
const report = {
  jev: typesafe ? `TypeSafe ${last.decision.model_version}` : 'підставний (немає TYPESAFE_API_KEY)',
  llm: deepseek ? `DeepSeek ${last.draft.model}` : 'підставна (немає DEEPSEEK_API_KEY)',
  runs: RUNS,
  medianMs: {
    retrieval: med(rows.map((r) => r.timings.retrieval)),
    profile: med(rows.map((r) => r.timings.profile)),
    decision: med(rows.map((r) => r.timings.decision)),
    llm: med(rows.map((r) => r.timings.llm)),
    total: med(rows.map((r) => r.timings.total)),
  },
  jevStateChars: stateChars,
  jevStateTokensEstimate: Math.ceil(stateChars / 3),
  snapshotChars: JSON.stringify(last.snapshot).length,
  cost: last.cost,
  decision: { action: last.decision.selected_action, fear: last.decision.scores.fear_intensity, confidence: last.decision.confidence, source: last.decision.source, fallbackReason: last.fallbackReason },
  draft: last.draft.reply,
  traceEvents: last.trace.length,
  canonChanged: last.canonChanged,
};
console.log(JSON.stringify(report, null, 2));

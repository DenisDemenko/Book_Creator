# Jev AI — existing integration and UX contract

Jev is already implemented in the Studio backend. Do **not** create a second Jev adapter, duplicate decision API, or bypass the existing workflow engine.

## Existing backend layer

The current repository already contains:

- `server/ai/adapters/jev/index.ts` — real TypeSafe/System One adapter, environment/platform key resolution support, typed `choice / score / noul`, normalization and cost calculation;
- `server/core/workflows/engine/jev.ts` — normalized `JevOutcome`, fallback to AI-2 LLM, confidence thresholds, routing, evaluator and decision-bundle behavior;
- Graph Studio Jev workflow nodes: `JEV_CHOICE`, `JEV_SCORE`, `JEV_NOUL`, `JEV_GATE`, `JEV_ROUTER`, `JEV_EVALUATOR`, `JEV_DECISION_BUNDLE`;
- human-review branches and model-consensus/routing rules;
- Jev usage/cost accounting;
- real/live verification and dedicated tests (`test:jev-nodes`, `test:jev-routes`, live Jev runs);
- adaptive Jev director usage in the labyrinth runtime.

The current canonical adapter constants in the repository are server-side and must remain the source of truth. Browser code must not hold Jev API keys or call the provider directly.

## Real normalized outcome used by UX

Story & Experience UX should consume the existing normalized shape rather than inventing a parallel API:

```ts
interface JevWorkflowAnswer {
  kind: 'choice' | 'score' | 'noul';
  selected?: string;
  distribution?: Record<string, number>;
  position?: number;
  levels?: number;
  value?: number;
  probability?: number;
  confidence: number | null;
  corrected?: boolean;
}

interface JevWorkflowOutcome {
  source: 'jev' | 'mock' | 'llm_fallback';
  model: string;
  answers: Record<string, JevWorkflowAnswer>;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  fallbackReason: string | null;
}
```

The UX branch now provides `JevDecisionPanel` for this real outcome shape.

## Story & Experience placements

### Screenplay Studio
Use Jev for typed evaluation signals such as tension/conflict intensity, status classification, routing and human-review flags. The artistic text itself remains the responsibility of the selected Studio model.

### Mafia Story Studio
Use Jev for event priority, severity, trigger status, routing and whether the Game Master should review an outcome.

### Constellation Studio
Use Jev only for neutral process/session-state evaluation and workflow status. Never present Jev output as medical, psychological or therapeutic diagnosis.

### Leela Studio
Use Jev only for neutral route/session workflow state, review-required signals and routing. Do not present spiritual or psychological interpretations as objective diagnosis.

## Aurora attention rule

Aurora is a presentation state, not a model decision.

Correct flow:

`Jev outcome → existing workflow/product rules → review / attention state → Aurora`

`JevDecisionPanel` activates attention styling for fresh results, fallback states, low confidence, or an explicit human-review state supplied by the product/workflow layer.

The backend must never depend on whether an animation is visible or acknowledged.

## Existing AI model selection

The primary generative/chat model is already provided by the Studio multi-provider layer through `/api/chat/models` and `book.preferredAiModelId`. Story & Experience UI must use that live catalog rather than a hardcoded provider list.

Jev remains a separate evaluator/decision layer and is not represented as an ordinary chat model.

## UX components in this branch

- `AIProviderSelector` — live `/api/chat/models` catalog;
- `AIWorkspaceToolbar` — model selection by task using real `modelId` values;
- `StoryExperienceAiShell` — shared AI workspace wrapper;
- `JevDecisionPanel` — real normalized Jev workflow outcome;
- `AttentionAurora` — attention animation/state;
- `IntegratedScreenplayView`;
- `IntegratedMafiaView`;
- `IntegratedConstellationView`;
- `IntegratedLeelaView`.

## Do not duplicate

Do not add another:

- Jev provider client;
- Jev API key path;
- retry/timeout policy;
- cost calculator;
- confidence threshold engine;
- fallback LLM path;
- review routing engine;
- model registry.

Use the existing backend/workflow implementation and bind the UX to its result/state.
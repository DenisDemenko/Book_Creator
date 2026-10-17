# Jev AI — existing integration and UX contract

Jev is already implemented in the Studio backend. Do **not** create a second Jev adapter, duplicate decision API, or bypass the existing workflow engine.

## Existing backend layer

The current repository already contains:

- `server/ai/adapters/jev/index.ts` — real TypeSafe/System One adapter, typed `choice / score / noul`, normalization and cost calculation;
- centralized `typesafeJev()` factory in `server.ts` — platform TypeSafe key first, then env key;
- `server/core/workflows/engine/jev.ts` — normalized `JevOutcome`, confidence thresholds, routing, evaluator and decision-bundle behavior;
- `LlmFallbackJevAdapter` — same typed questions through the existing AI-2 fallback path;
- Graph Studio Jev workflow nodes: `JEV_CHOICE`, `JEV_SCORE`, `JEV_NOUL`, `JEV_GATE`, `JEV_ROUTER`, `JEV_EVALUATOR`, `JEV_DECISION_BUNDLE`;
- human-review branches and model-consensus/routing rules;
- Jev usage/cost accounting;
- adaptive Jev usage in existing product workflows;
- protected user-facing route pattern in `/api/maze-final/kitten` (guard/recheck/timeout/idempotency/budget/normalization).

Browser code must never hold Jev API keys or call the provider directly.

## Exact UX bridge added by Story & Experience

The UX branch exports one transport-agnostic callback contract:

```ts
type StoryExperienceJevProfile =
  | 'screenplay_story_state'
  | 'mafia_gm_event'
  | 'constellation_session_status'
  | 'leela_route_status';

interface StoryExperienceJevRequest {
  profile: StoryExperienceJevProfile;
  projectId: string;
  contextId?: string;
  state: Record<string, unknown>;
}

interface StoryExperienceJevResponse {
  outcome: JevWorkflowOutcome;
  review?: JevReviewState;
}

type StoryExperienceJevEvaluator = (
  request: StoryExperienceJevRequest,
) => Promise<StoryExperienceJevResponse>;
```

`ScenarioView` now accepts:

```ts
onEvaluateWithJev?: StoryExperienceJevEvaluator
```

The UI does not know or care whether the technical implementation uses a dedicated Story & Experience facade, an existing workflow binding, or another approved server route. It only invokes the callback and renders loading/error/result states.

## TECH AGENT TASK

Provide a server/client binding that supplies `onEvaluateWithJev(request)` to `ScenarioView`.

Requirements:

1. Reuse the existing `typesafeJev()` factory and existing normalized Jev/fallback infrastructure.
2. Do not call `/api/core/workflow-runs` from ordinary author UX; that route is protected by workflow-control permissions.
3. Do not allow arbitrary client-defined Jev questions. The server chooses the fixed question set from `request.profile`.
4. Recheck the signed-in user's access to `request.projectId` and AI permission before evaluation.
5. Apply existing timeout/retry/fallback/usage/cost rules rather than introducing parallel ones.
6. Return the normalized `JevWorkflowOutcome` shape below plus optional `review` state.
7. For Screenplay, treat `contextId` as the selected scene id. Current UI state includes scene title, summary, conflict, location, intensity and content.
8. Mafia authoritative event/session data should be enriched server-side or from the existing session layer; do not trust UI placeholders as authoritative game state.
9. Constellation profile may evaluate only neutral session/process status. No medical, psychological, therapeutic or diagnostic conclusions.
10. Leela profile may evaluate only route/session workflow status. No objective spiritual or psychological interpretation.
11. Jev output must never mutate canon automatically; human confirmation/product rules remain authoritative.

Suggested facade shape if a dedicated route is needed:

```txt
POST /api/story-experience/jev/evaluate
body: StoryExperienceJevRequest
response: StoryExperienceJevResponse
```

The route name is not part of the UX contract; the callback is. If an existing approved route can satisfy the same contract safely, use it instead.

## Real normalized outcome used by UX

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

## Current UX behavior

`StoryExperienceJevAction` provides the complete visual lifecycle:

- disabled “Оцінити Jev” state when no technical callback is connected;
- loading state;
- error state;
- result state;
- retry/re-evaluate;
- optional human-review action;
- Aurora attention for fresh/review/fallback/low-confidence results.

Screenplay sends the **currently selected scene** through the callback. Mafia, Constellation and Leela currently send safe workspace-level state; their authoritative session state must be enriched by the technical/session layer as those live backends are connected.

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

The backend must never depend on whether an animation is visible or acknowledged.

## Existing AI model selection

The primary generative/chat model is already provided by the Studio multi-provider layer through `/api/chat/models` and `book.preferredAiModelId`. Story & Experience UI must use that live catalog rather than a hardcoded provider list.

Jev remains a separate evaluator/decision layer and is not represented as an ordinary chat model.

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

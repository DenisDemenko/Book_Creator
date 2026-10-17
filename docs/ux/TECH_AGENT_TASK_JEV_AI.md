# TECH AGENT TASK — Jev AI integration contract

UX/UI scope only. No server integration is implemented in this branch.

## Why Jev is included

Jev is not presented as a general chat/generation model. In Story & Experience it is the specialized decision/evaluation layer for structured assessment tasks:

- emotional-state / tension / urgency scoring;
- session-state classification;
- whether an event needs human attention;
- safety / review gating;
- routing to the next workflow or model;
- confidence/probability display for typed decisions.

## Documented external contract

Current public Jev documentation describes:

- endpoint: `POST https://thejevai.com/v1/systemone`;
- model example: `typesafe/jev-1.13`;
- request core: `state`, `model`, `questions`;
- typed question families: `choice`, `score`, `noul`;
- output can include selected values/scores, probabilities, confidence, usage and elapsed time.

API keys must stay server-side.

## Required frontend integration point

The UX components already expose these concepts:

- `AIProviderSelector`
- `AIWorkspaceToolbar`
- `JevEvaluationResultCard`
- `AttentionAurora`

Technical layer should provide a callback/service boundary similar to:

```ts
onEvaluateWithJev({
  contextId,
  state,
  questions,
})
```

Expected normalized response for UI:

```ts
type JevEvaluationResult = {
  questionId: string;
  type: 'choice' | 'score' | 'noul';
  label: string;
  value: string | number | boolean;
  confidence?: number;
  probabilities?: Array<{ label: string; value: number }>;
  requiresHumanReview?: boolean;
};
```

## Recommended Story & Experience placements

### Screenplay Studio
- score tension/intensity;
- classify emotional state;
- flag contradictory or unusually risky scene changes for review;
- route analysis to another AI when task difficulty is high.

### Mafia Story Studio
- classify event urgency;
- score whether the GM should be alerted;
- identify whether a trigger needs manual review;
- route ambiguous outcomes to the Game Master.

### Constellation Studio
- only for neutral session/process state labels and workflow status;
- do not present Jev output as medical, psychological or therapeutic diagnosis;
- use explicit human-review affordances for sensitive states.

### Leela Studio
- classify journal/session workflow state;
- decide whether a host should review a system event;
- do not interpret spiritual/psychological meaning as objective diagnosis.

### Shared live sessions
- connection/session severity;
- attention priority;
- review-required flag;
- model routing.

## Aurora attention rule

When normalized backend result has `requiresHumanReview = true`, UI may activate `AttentionAurora` until the user acknowledges the event. Backend must not depend on animation state.

## Do not implement in UX branch

- API keys;
- direct browser call to Jev;
- authentication;
- retries/timeouts;
- server thresholds;
- final business rules;
- storage of sensitive evaluation history;
- billing/cost tracking.

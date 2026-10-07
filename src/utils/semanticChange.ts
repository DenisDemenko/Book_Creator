/** T5.7 В2: categories shared by classifier, destination API and UI. */
export const SEMANTIC_WORKFLOW = "semantic_change_detector";
export const SEMANTIC_REGISTRY = "semantic_change";
export const SEMANTIC_CATEGORIES = [
  "STYLE_ONLY",
  "CHARACTER_STATE",
  "EVENT",
  "RELATIONSHIP",
  "LOCATION",
  "TIMELINE",
  "FACT",
  "NO_SEMANTIC_CHANGE",
] as const;
export const SEMANTIC_OPTIONS = SEMANTIC_CATEGORIES.filter(
  (c) => c !== "NO_SEMANTIC_CHANGE",
).map((c) => c.toLowerCase());

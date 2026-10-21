/** Shared contract for the administrative agent handoff journal. */
export const HANDOFF_REPOSITORIES = ['DenisDemenko/Book_Creator', 'DenisDemenko/Fusion-Lab-Marketplaes'] as const;
export const HANDOFF_FIELDS = [
  ['agent', 'Агент, що передає'], ['session', 'Сесія, що передає'],
  ['environment', 'Середовище / робоча папка'], ['branch', 'Гілка'],
  ['commit', 'SHA коміту (якщо є)'], ['task', 'Завдання'],
  ['done', 'Зроблено'], ['checks', 'Перевірено та НЕ перевірено'],
  ['remaining', 'Не зроблено і чому'], ['next', 'Наступний крок'],
  ['evidence', 'Стан Git / докази push / незбережені файли'],
] as const;
export type HandoffField = typeof HANDOFF_FIELDS[number][0];
export type HandoffDraft = Record<HandoffField, string> & {
  repository: typeof HANDOFF_REPOSITORIES[number];
};
export interface HandoffEntry extends HandoffDraft {
  id: string; createdAt: string; recordedBy: string;
  acceptedAt: string | null; acceptedBy: string | null;
  receivingAgent: string | null; receivingSession: string | null;
  acceptanceNotes: string | null;
}

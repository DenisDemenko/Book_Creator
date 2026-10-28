export interface Budget {
  title: string;
  justification: string;
  amountMinor: string;
}
export interface StagePlan {
  id: string;
  title: string;
  deliverable: string;
  responsible: string;
  dueAt: string;
  amountMinor: string;
  advanceMinor: string;
}
export interface FundingPlan {
  title: string;
  summary: string;
  objective: string;
  result: string;
  direction: string;
  endsAt: string;
  recipientName: string;
  recipientType: string;
  recipientMandate: string;
  coverImage?: string;
  budget: Budget[];
  milestones: StagePlan[];
}
export interface FundingReport {
  id: string;
  description: string;
  publicSummary: string;
  evidence: string;
  spentMinor: string;
  state: string;
  reviewNote?: string;
}
export interface Payout {
  id: string;
  amountMinor: string;
  kind: string;
  purpose: string;
  status: string;
  bankReference?: string;
  evidence?: string;
}
export interface Stage extends StagePlan {
  sourceId?: string;
  state: string;
  acceptedSpentMinor?: string;
  spentMinor?: string;
  paidOutMinor?: string;
  reports: FundingReport[];
  disbursements?: Payout[];
}
export interface Terms {
  unusedPolicy?: string;
  operatorName: string;
  terms: string;
  refundPolicy: string;
}
export interface Campaign {
  id: string;
  slug: string;
  title: string;
  summary: string;
  direction: string;
  status: string;
  version: number;
  team: { id: string; name: string };
  targetMinor: string;
  teamBudgetMinor: string;
  raisedMinor: string;
  allocatedMinor: string;
  feeMinor: string;
  paidOutMinor: string;
  returnedMinor: string;
  reservedMinor: string;
  spentMinor: string;
  refundedMinor: string;
  refundHoldMinor: string;
  settledGrossMinor: string;
  availableCashMinor: string;
  availableTeamMinor: string;
  endsAt: string;
  coverImage?: string;
  objective: string;
  result: string;
  budget: Budget[];
  milestones: Stage[];
  passportRevision: number;
  snapshotHash: string;
  snapshot?: { content: FundingPlan; passportRevision: number; sha256: string };
  terms: Terms | null;
  acceptingContributions?: boolean;
  reviewReason?: string;
  refunds?: {
    id: string;
    amountMinor: string;
    status: string;
    reason: string;
    bankReference?: string;
  }[];
  ledger?: {
    id: string;
    kind: string;
    createdAt: string;
    entries: { account: string; deltaMinor: string }[];
  }[];
  bankFacts?: {
    id: string;
    kind: string;
    amountMinor: string;
    providerCostMinor: string;
    bankReference: string;
  }[];
}
export interface FundingSettings {
  version: number;
  liveEnabled: boolean;
  operatorName: string;
  terms: string;
  refundPolicy: string;
  settlementGraceMinutes: number;
}
export interface AdminState {
  settings: FundingSettings;
  gatewayConfigured: boolean;
  permissions: string[];
  campaigns: Campaign[];
}
export type FundingRequest = <T>(
  path: string,
  method?: string,
  body?: unknown,
) => Promise<T>;
export function money(value: string | undefined) {
  const n = BigInt(value || "0");
  const sign = n < BigInt(0) ? "-" : "";
  const a = n < BigInt(0) ? -n : n;
  return `${sign}${(a / BigInt(100)).toLocaleString("uk-UA")},${String(a % BigInt(100)).padStart(2, "0")} грн`;
}
export function toMinor(value: string) {
  if (!/^\d+(?:[.,]\d{0,2})?$/.test(value))
    throw Error("Вкажіть суму з точністю до копійки.");
  const [w, c = ""] = value.replace(",", ".").split(".");
  return (BigInt(w) * BigInt(100) + BigInt(c.padEnd(2, "0"))).toString();
}
export function toMajor(value: string) {
  return `${BigInt(value) / BigInt(100)}.${String(BigInt(value) % BigInt(100)).padStart(2, "0")}`;
}
export function status(value: string) {
  return (
    (
      {
        review: "На розгляді",
        active: "Триває збір",
        paused: "Збір призупинено",
        closing: "Звірка внесків",
        funded: "Ціль зібрано · виконання",
        execution_paused: "Виконання призупинено",
        reconciliation: "Потрібна звірка з банком",
        failed: "Ціль не досягнуто · повернення",
        rejected: "Відхилено",
        completed: "Проєкт завершено",
        payout_failed: "Переказ не проведено",
        completed_refunding: "Проєкт виконано · повернення залишку",
        pending: "Очікує внеску",
        paid: "Внесок отримано",
        planned: "Заплановано",
        accepted: "Звіт прийнято",
        submitted: "Звіт на розгляді",
        rework: "Потребує доопрацювання",
        requested: "Запитано",
        approved: "Схвалено · очікує переказу",
        confirmed: "Підтверджено банком",
      } as Record<string, string>
    )[value] || value
  );
}

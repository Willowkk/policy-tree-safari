export type PolicyStatus = "draft" | "ready" | "trial" | "active" | "returned";
export type Locale = "zh" | "en";
export interface Policy {
  id: string;
  name: string;
  rule: string;
  status: PolicyStatus;
  parentId: string | null;
  suggestedParentId: string | null;
  reminderTime: string;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  trialDate?: string;
  returnKind?: "direct" | "dependent";
  returnSourceId?: string;
}
export interface HistoryEvent {
  id: string;
  operationId: string;
  type:
    | "created"
    | "edited"
    | "chosen"
    | "activated"
    | "violated"
    | "dependent_return"
    | "restored"
    | "reflection"
    | "imported";
  policyId: string;
  policyName: string;
  at: string;
  note: string;
  parentId?: string | null;
  day?: string;
}
export interface PolicyState {
  schemaVersion: 1;
  policies: Policy[];
  events: HistoryEvent[];
  settings: { timezone: string; locale: Locale; inventoryReminders: boolean };
  appliedOperationIds: string[];
}
export interface Operation {
  id: string;
  type:
    | "save"
    | "choose"
    | "activate"
    | "violate"
    | "restore"
    | "reflect"
    | "settings"
    | "import"
    | "deleteDraft";
  policyId?: string;
  at: string;
  payload: Record<string, unknown>;
}
export interface StateResponse {
  state: PolicyState;
  revision: number;
  userId: string;
}
export interface PendingOperation {
  operation: Operation;
  error?: string;
  conflict?: boolean;
}

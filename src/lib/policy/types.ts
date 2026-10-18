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
  /** Retained when reading older snapshots; new policies do not store it. */
  createdAt?: string;
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
  before?: string;
  after?: string;
}
export type SeatChain = "main" | "aux";
export interface SacredSeatCase {
  id: string;
  at: string;
  chain: SeatChain;
  generation: number;
  condition: string;
}
export interface SacredSeatRecord {
  id: string;
  at: string;
  /** reserved/started are accepted only as historical records from old previews. */
  type: "completed" | "reserved" | "started" | "reservation_success" | "edited" | "allowed" | "failed";
  chain: SeatChain;
  generation: number;
  task: string;
  note: string;
  before?: string;
  after?: string;
  oldCount?: number;
}
export interface SacredSeat {
  id: string;
  name: string;
  rule: string;
  task: string;
  main: { count: number; generation: number };
  aux: { count: number; generation: number };
  cases: SacredSeatCase[];
  records: SacredSeatRecord[];
}
export interface PolicyState {
  schemaVersion: 1;
  policies: Policy[];
  events: HistoryEvent[];
  seats: SacredSeat[];
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
    | "deleteDraft"
    | "editRule"
    | "seatSave"
    | "seatComplete"
    | "seatAllow"
    | "seatFail";
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

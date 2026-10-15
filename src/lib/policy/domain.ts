import type {
  HistoryEvent,
  Locale,
  Operation,
  Policy,
  PolicyState,
} from "./types";

export class PolicyError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

const statuses = new Set(["draft", "ready", "trial", "active", "returned"]);
const eventTypes = new Set([
  "created",
  "edited",
  "chosen",
  "activated",
  "violated",
  "dependent_return",
  "restored",
  "reflection",
  "imported",
]);
const operationTypes = new Set([
  "save",
  "choose",
  "activate",
  "violate",
  "restore",
  "reflect",
  "settings",
  "import",
  "deleteDraft",
]);

function fail(code: string, message: string): never {
  throw new PolicyError(code, message);
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function string(value: unknown, field: string, max = 20_000): string {
  if (typeof value !== "string" || value.length > max)
    fail("INVALID_DATA", `${field} must be text of at most ${max} characters.`);
  return value;
}
function identifier(value: unknown, field: string, max = 160): string {
  const result = string(value, field, max);
  if (!result.trim()) fail("INVALID_DATA", `${field} is required.`);
  return result;
}
function timestamp(value: unknown, field: string): string {
  const result = string(value, field, 64);
  if (!Number.isFinite(new Date(result).getTime()))
    fail("INVALID_DATA", `${field} is not a valid date.`);
  return result;
}
function parentId(value: unknown, field: string): string | null {
  return value === null || value === undefined
    ? null
    : identifier(value, field);
}
function timezone(value: unknown): string {
  const result = string(value, "timezone", 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: result }).format();
  } catch {
    fail("INVALID_TIMEZONE", "Choose a valid IANA time zone.");
  }
  return result;
}
function reminderTime(value: unknown): string {
  const result = value === undefined ? "" : string(value, "reminderTime", 5);
  if (result && !/^([01]\d|2[0-3]):[0-5]\d$/.test(result))
    fail("INVALID_REMINDER", "Reminder time must use HH:mm.");
  return result;
}
function readyFields(policy: Policy): void {
  if (!policy.name.trim() || !policy.rule.trim())
    fail(
      "RULE_REQUIRED",
      "Add a name and a rule before marking a policy ready.",
    );
}

export function emptyState(locale: Locale = "zh"): PolicyState {
  return {
    schemaVersion: 1,
    policies: [],
    events: [],
    settings: { timezone: "Asia/Shanghai", locale, inventoryReminders: true },
    appliedOperationIds: [],
  };
}

export function dayKey(date: string | Date, zone: string): string {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime()))
    fail("INVALID_DATE", "The date is invalid.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone(zone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}

export function descendants(state: PolicyState, id: string): Policy[] {
  const result: Policy[] = [];
  const visited = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const current = queue.shift();
    for (const policy of state.policies) {
      if (policy.parentId === current && !visited.has(policy.id)) {
        visited.add(policy.id);
        result.push(policy);
        queue.push(policy.id);
      }
    }
  }
  return result;
}

export function getTodayActivation(
  state: PolicyState,
  now = new Date().toISOString(),
): HistoryEvent | undefined {
  const day = dayKey(now, state.settings.timezone);
  return state.events.find(
    (event) => event.type === "activated" && event.day === day,
  );
}

/** Validate and copy snapshots before using either network or backup data. */
export function validateState(input: unknown): PolicyState {
  if (
    !record(input) ||
    input.schemaVersion !== 1 ||
    !Array.isArray(input.policies) ||
    !Array.isArray(input.events) ||
    !Array.isArray(input.appliedOperationIds) ||
    !record(input.settings)
  )
    fail("INVALID_SNAPSHOT", "This is not a supported Policy Tree backup.");
  if (
    input.policies.length > 10_000 ||
    input.events.length > 50_000 ||
    input.appliedOperationIds.length > 100_000
  )
    fail("DATA_LIMIT", "This snapshot is too large.");
  const settings = input.settings;
  if (
    typeof settings.locale !== "string" ||
    !["zh", "en"].includes(settings.locale) ||
    typeof settings.inventoryReminders !== "boolean"
  )
    fail("INVALID_DATA", "The settings are invalid.");
  const state: PolicyState = {
    schemaVersion: 1,
    policies: input.policies.map((raw: unknown) => {
      if (!record(raw) || typeof raw.status !== "string" || !statuses.has(raw.status))
        fail("INVALID_DATA", "A policy has an invalid status.");
      const policy: Policy = {
        id: identifier(raw.id, "policy.id"),
        name: string(raw.name, "policy.name", 160),
        rule: string(raw.rule, "policy.rule"),
        status: raw.status as Policy["status"],
        parentId: parentId(raw.parentId, "parentId"),
        suggestedParentId: parentId(raw.suggestedParentId, "suggestedParentId"),
        reminderTime: reminderTime(raw.reminderTime),
        createdAt: timestamp(raw.createdAt, "createdAt"),
        updatedAt: timestamp(raw.updatedAt, "updatedAt"),
      };
      if (raw.activatedAt !== undefined)
        policy.activatedAt = timestamp(raw.activatedAt, "activatedAt");
      if (raw.trialDate !== undefined) {
        const value = string(raw.trialDate, "trialDate", 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
          fail("INVALID_DATA", "trialDate is invalid.");
        policy.trialDate = value;
      }
      if (raw.returnKind !== undefined) {
        if (
          typeof raw.returnKind !== "string" ||
          !["direct", "dependent"].includes(raw.returnKind)
        )
          fail("INVALID_DATA", "returnKind is invalid.");
        policy.returnKind = raw.returnKind as Policy["returnKind"];
      }
      if (raw.returnSourceId !== undefined)
        policy.returnSourceId = identifier(
          raw.returnSourceId,
          "returnSourceId",
        );
      if (policy.status !== "draft") readyFields(policy);
      return policy;
    }),
    events: input.events.map((raw: unknown) => {
      if (!record(raw) || typeof raw.type !== "string" || !eventTypes.has(raw.type))
        fail("INVALID_DATA", "A history event has an invalid type.");
      const event: HistoryEvent = {
        id: identifier(raw.id, "event.id", 512),
        operationId: identifier(raw.operationId, "event.operationId"),
        type: raw.type as HistoryEvent["type"],
        policyId: identifier(raw.policyId, "event.policyId"),
        policyName: string(raw.policyName, "event.policyName", 160),
        at: timestamp(raw.at, "event.at"),
        note: string(raw.note, "event.note"),
      };
      if (raw.parentId !== undefined)
        event.parentId = parentId(raw.parentId, "event.parentId");
      if (raw.day !== undefined) event.day = string(raw.day, "event.day", 10);
      return event;
    }),
    settings: {
      timezone: timezone(settings.timezone),
      locale: settings.locale as Locale,
      inventoryReminders: settings.inventoryReminders,
    },
    appliedOperationIds: input.appliedOperationIds.map((value: unknown) =>
      identifier(value, "operationId"),
    ),
  };
  const ids = new Set<string>();
  for (const policy of state.policies) {
    if (ids.has(policy.id))
      fail("DUPLICATE_POLICY", "Policy IDs must be unique.");
    ids.add(policy.id);
  }
  if (state.policies.filter((policy) => policy.status === "trial").length > 1)
    fail("MULTIPLE_TRIALS", "Only one policy may be tried at a time.");
  for (const policy of state.policies) {
    if (policy.parentId === policy.id || policy.suggestedParentId === policy.id)
      fail("PARENT_CYCLE", "A policy cannot be its own parent.");
    if (policy.parentId && !ids.has(policy.parentId))
      fail("PARENT_MISSING", "A policy parent is missing.");
    if (policy.suggestedParentId && !ids.has(policy.suggestedParentId))
      fail("PARENT_MISSING", "A suggested parent is missing.");
    if (
      policy.status === "active" &&
      policy.parentId &&
      state.policies.find((item) => item.id === policy.parentId)?.status !==
        "active"
    )
      fail("PARENT_INACTIVE", "An active policy must have an active parent.");
    const seen = new Set([policy.id]);
    let ancestor = policy.parentId;
    while (ancestor) {
      if (seen.has(ancestor))
        fail("PARENT_CYCLE", "Policy parents cannot form a cycle.");
      seen.add(ancestor);
      ancestor =
        state.policies.find((item) => item.id === ancestor)?.parentId ?? null;
    }
  }
  const eventIds = new Set<string>();
  const activationDays = new Set<string>();
  for (const event of state.events) {
    if (eventIds.has(event.id))
      fail("DUPLICATE_EVENT", "History event IDs must be unique.");
    eventIds.add(event.id);
    // Deleted drafts intentionally retain their historical creation/edit events.
    if (event.type === "activated") {
      const day = dayKey(event.at, state.settings.timezone);
      if (event.day !== day)
        fail(
          "INVALID_ACTIVATION_DAY",
          "An activation day does not match its timestamp and time zone.",
        );
      if (activationDays.has(day))
        fail(
          "DAILY_LIMIT",
          "A backup cannot add more than one activation on the same day.",
        );
      activationDays.add(day);
    }
  }
  for (const policy of state.policies.filter(
    (item) => item.status === "active",
  )) {
    if (
      !state.events.some(
        (event) =>
          event.type === "activated" &&
          event.policyId === policy.id &&
          event.at === policy.activatedAt,
      )
    )
      fail(
        "ACTIVATION_HISTORY_REQUIRED",
        "Active policies must retain their activation history.",
      );
  }
  state.appliedOperationIds = [...new Set(state.appliedOperationIds)];
  return state;
}

function operation(input: unknown): Operation {
  if (
    !record(input) ||
    typeof input.type !== "string" ||
    !operationTypes.has(input.type) ||
    !record(input.payload)
  )
    fail("INVALID_OPERATION", "The operation is invalid.");
  return {
    id: identifier(input.id, "operation.id"),
    type: input.type as Operation["type"],
    policyId:
      input.policyId === undefined
        ? undefined
        : identifier(input.policyId, "operation.policyId"),
    at: timestamp(input.at, "operation.at"),
    payload: input.payload,
  };
}

/** Mutations are pure; the API passes its own clock rather than trusting device time. */
export function applyOperation(
  input: PolicyState,
  raw: Operation,
  now = new Date().toISOString(),
): PolicyState {
  const state = validateState(input);
  const op = operation(raw);
  if (state.appliedOperationIds.includes(op.id)) return state;
  const at = new Date(timestamp(now, "now")).toISOString();
  const day = dayKey(at, state.settings.timezone);
  const payload = op.payload;
  const policy = state.policies.find((item) => item.id === op.policyId);
  function requirePolicy(): Policy {
    return policy ?? fail("POLICY_MISSING", "This policy no longer exists.");
  }
  function event(
    type: HistoryEvent["type"],
    item: Policy,
    note = "",
    extra: Partial<HistoryEvent> = {},
  ) {
    state.events.push({
      id: `${op.id}:${type}:${item.id}`,
      operationId: op.id,
      type,
      policyId: item.id,
      policyName: item.name,
      at,
      note,
      ...extra,
    });
  }
  switch (op.type) {
    case "save": {
      const id = op.policyId ?? identifier(payload.id, "policy.id");
      const existing = state.policies.find((item) => item.id === id);
      if (existing && !["draft", "ready"].includes(existing.status))
        fail(
          "POLICY_IMMUTABLE",
          "Active, returned, and trial rules cannot be edited. Restore or switch the policy first.",
        );
      const status = payload.status ?? existing?.status ?? "draft";
      if (status !== "draft" && status !== "ready")
        fail("INVALID_STATUS", "Save a policy as draft or ready.");
      const item: Policy = {
        id,
        name:
          payload.name === undefined
            ? (existing?.name ?? "")
            : string(payload.name, "name", 160).trim(),
        rule:
          payload.rule === undefined
            ? (existing?.rule ?? "")
            : string(payload.rule, "rule").trim(),
        status,
        parentId: null,
        suggestedParentId:
          payload.suggestedParentId === undefined
            ? (existing?.suggestedParentId ?? null)
            : parentId(payload.suggestedParentId, "suggestedParentId"),
        reminderTime:
          payload.reminderTime === undefined
            ? (existing?.reminderTime ?? "")
            : reminderTime(payload.reminderTime),
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      };
      if (status === "ready") readyFields(item);
      if (existing) state.policies[state.policies.indexOf(existing)] = item;
      else state.policies.push(item);
      event(existing ? "edited" : "created", item);
      break;
    }
    case "choose": {
      const item = requirePolicy();
      if (item.status !== "ready")
        fail("NOT_READY", "Choose a policy from the ready library.");
      if (getTodayActivation(state, at))
        fail("DAILY_LIMIT", "Today’s activation has already been used.");
      for (const previous of state.policies.filter(
        (other) => other.status === "trial",
      )) {
        previous.status = "ready";
        delete previous.trialDate;
        previous.updatedAt = at;
      }
      item.status = "trial";
      item.trialDate = day;
      item.updatedAt = at;
      event("chosen", item);
      break;
    }
    case "activate": {
      const item = requirePolicy();
      if (item.status !== "trial")
        fail("NOT_TRIAL", "Choose and try a policy before activating it.");
      if (item.trialDate !== day)
        fail(
          "TRIAL_EXPIRED",
          "This trial belongs to another day. Return it to the library and choose it again.",
        );
      if (getTodayActivation(state, at))
        fail("DAILY_LIMIT", "Only one policy may be activated each day.");
      const targetParent =
        payload.parentId === undefined
          ? item.suggestedParentId
          : parentId(payload.parentId, "parentId");
      if (
        targetParent === item.id ||
        descendants(state, item.id).some((other) => other.id === targetParent)
      )
        fail("PARENT_CYCLE", "A policy cannot be attached beneath itself.");
      if (
        targetParent &&
        state.policies.find((other) => other.id === targetParent)?.status !==
          "active"
      )
        fail(
          "PARENT_INACTIVE",
          "Choose an active parent or attach to the root.",
        );
      item.status = "active";
      item.parentId = targetParent;
      item.suggestedParentId = targetParent;
      item.activatedAt = at;
      item.updatedAt = at;
      delete item.trialDate;
      delete item.returnKind;
      delete item.returnSourceId;
      event("activated", item, "", { day, parentId: targetParent });
      break;
    }
    case "violate": {
      const item = requirePolicy();
      if (item.status !== "active")
        fail("NOT_ACTIVE", "Only active policies can be recorded as violated.");
      const affected = [
        item,
        ...descendants(state, item.id).filter(
          (other) => other.status === "active",
        ),
      ];
      const note =
        payload.note === undefined ? "" : string(payload.note, "note").trim();
      for (const returned of affected) {
        returned.status = "returned";
        returned.returnKind = returned.id === item.id ? "direct" : "dependent";
        returned.returnSourceId = item.id;
        returned.suggestedParentId = returned.parentId;
        returned.updatedAt = at;
        event(
          returned.id === item.id ? "violated" : "dependent_return",
          returned,
          returned.id === item.id ? note : item.name,
          { parentId: returned.parentId },
        );
      }
      break;
    }
    case "restore": {
      const item = requirePolicy();
      if (item.status !== "returned" && item.status !== "trial")
        fail(
          "NOT_RETURNED",
          "Only returned policies or trials can return to the ready library.",
        );
      item.status = "ready";
      item.suggestedParentId = item.parentId ?? item.suggestedParentId;
      item.parentId = null;
      item.updatedAt = at;
      delete item.trialDate;
      delete item.returnKind;
      delete item.returnSourceId;
      event("restored", item);
      break;
    }
    case "reflect": {
      const item = requirePolicy();
      const note = string(payload.note, "note").trim();
      if (!note) fail("NOTE_REQUIRED", "Write a reflection before saving it.");
      event("reflection", item, note);
      break;
    }
    case "settings": {
      if (payload.timezone !== undefined) {
        const zone = timezone(payload.timezone);
        if (
          zone !== state.settings.timezone &&
          state.events.some((item) => item.type === "activated")
        )
          fail(
            "TIMEZONE_LOCKED",
            "The day boundary is fixed after the first activation.",
          );
        state.settings.timezone = zone;
      }
      if (payload.locale !== undefined) {
        if (payload.locale !== "zh" && payload.locale !== "en")
          fail("INVALID_LOCALE", "Choose Chinese or English.");
        state.settings.locale = payload.locale;
      }
      if (payload.inventoryReminders !== undefined) {
        if (typeof payload.inventoryReminders !== "boolean")
          fail("INVALID_DATA", "inventoryReminders must be true or false.");
        state.settings.inventoryReminders = payload.inventoryReminders;
      }
      break;
    }
    case "import": {
      const incoming = validateState(payload.state);
      if (
        incoming.settings.timezone !== state.settings.timezone &&
        incoming.events.some((item) => item.type === "activated")
      )
        fail("IMPORT_TIMEZONE", "The backup uses a different day boundary.");
      // Existing IDs are authoritative. Import never revives returned nodes or erases history.
      const existingPolicies = new Set(state.policies.map((item) => item.id));
      const existingEvents = new Set(state.events.map((item) => item.id));
      state.policies.push(
        ...incoming.policies.filter((item) => !existingPolicies.has(item.id)),
      );
      state.events.push(
        ...incoming.events.filter((item) => !existingEvents.has(item.id)),
      );
      state.appliedOperationIds = [
        ...new Set([
          ...state.appliedOperationIds,
          ...incoming.appliedOperationIds,
        ]),
      ];
      break;
    }
    case "deleteDraft": {
      const item = requirePolicy();
      if (item.status !== "draft")
        fail("NOT_DRAFT", "Only drafts may be deleted.");
      if (
        state.policies.some(
          (other) =>
            other.parentId === item.id || other.suggestedParentId === item.id,
        )
      )
        fail(
          "POLICY_REFERENCED",
          "This draft is referenced by another policy.",
        );
      state.policies = state.policies.filter((other) => other.id !== item.id);
      break;
    }
  }
  state.appliedOperationIds.push(op.id);
  return validateState(state);
}

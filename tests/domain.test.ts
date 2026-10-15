import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  applyOperation,
  dayKey,
  descendants,
  emptyState,
  getTodayActivation,
  PolicyError,
  validateState,
} from "../src/lib/policy/domain";
import type { Operation, PolicyState } from "../src/lib/policy/types";

let sequence = 0;
const D1 = "2026-10-15T08:00:00.000Z";
const D2 = "2026-10-16T08:00:00.000Z";
const D3 = "2026-10-17T08:00:00.000Z";
const D4 = "2026-10-18T08:00:00.000Z";
function op(
  type: Operation["type"],
  policyId?: string,
  payload: Record<string, unknown> = {},
  at = D1,
): Operation {
  return { id: `op-${++sequence}`, type, policyId, payload, at };
}
function save(
  state: PolicyState,
  id: string,
  payload: Record<string, unknown> = {},
  now = D1,
) {
  return applyOperation(
    state,
    op(
      "save",
      id,
      { name: id, rule: `Rule for ${id}`, status: "ready", ...payload },
      now,
    ),
    now,
  );
}
function activate(
  state: PolicyState,
  id: string,
  now: string,
  parentId: string | null = null,
) {
  return applyOperation(
    applyOperation(state, op("choose", id, {}, now), now),
    op("activate", id, { parentId }, now),
    now,
  );
}
function errorCode(code: string) {
  return (error: unknown) =>
    error instanceof PolicyError && error.code === code;
}

test("new state is empty; stock is not seeded or capped at five", () => {
  let state = emptyState("en");
  assert.equal(state.settings.locale, "en");
  assert.equal(state.policies.length, 0);
  for (let index = 0; index < 7; index++) state = save(state, `ready-${index}`);
  assert.equal(
    state.policies.filter((policy) => policy.status === "ready").length,
    7,
  );
});

test("draft auto-save supports partial text; ready requires name and rule", () => {
  const state = save(emptyState(), "draft", {
    name: "",
    rule: "",
    status: "draft",
  });
  assert.equal(state.policies[0].status, "draft");
  const operation = op("save", "draft", { status: "ready" });
  assert.throws(
    () => applyOperation(state, operation, D1),
    errorCode("RULE_REQUIRED"),
  );
  assert.equal(state.events.length, 1);
  assert.equal(state.appliedOperationIds.includes(operation.id), false);
});

test("choosing another policy returns the previous trial to ready", () => {
  let state = save(save(emptyState(), "a"), "b");
  state = applyOperation(state, op("choose", "a"), D1);
  state = applyOperation(state, op("choose", "b"), D1);
  assert.equal(state.policies.find((item) => item.id === "a")?.status, "ready");
  assert.equal(
    state.policies.find((item) => item.id === "a")?.trialDate,
    undefined,
  );
  assert.equal(state.policies.find((item) => item.id === "b")?.status, "trial");
  assert.throws(
    () => applyOperation(state, op("choose", "b"), D1),
    errorCode("NOT_READY"),
  );
});

test("a draft cannot be chosen or directly activated", () => {
  const state = save(emptyState(), "a", { status: "draft" });
  assert.throws(
    () => applyOperation(state, op("choose", "a"), D1),
    errorCode("NOT_READY"),
  );
  assert.throws(
    () => applyOperation(state, op("activate", "a"), D1),
    errorCode("NOT_TRIAL"),
  );
});

test("day boundary uses the configured timezone and server time", () => {
  assert.equal(dayKey("2026-10-15T15:59:59Z", "Asia/Shanghai"), "2026-10-15");
  assert.equal(dayKey("2026-10-15T16:00:00Z", "Asia/Shanghai"), "2026-10-16");
  const state = applyOperation(
    save(emptyState(), "a"),
    op("choose", "a", {}, "2030-01-01T12:00:00Z"),
    D1,
  );
  assert.equal(state.policies[0].trialDate, "2026-10-15");
  const activated = applyOperation(
    state,
    op("activate", "a", {}, "2030-01-01T12:00:00Z"),
    D1,
  );
  assert.equal(activated.events.at(-1)?.at, D1);
  assert.equal(activated.events.at(-1)?.day, "2026-10-15");
});

test("violating today’s new policy does not restore today’s activation allowance", () => {
  let state = activate(save(save(emptyState(), "a"), "b"), "a", D1);
  state = applyOperation(
    state,
    op("violate", "a", { note: "Missed the rule" }),
    D1,
  );
  assert.equal(getTodayActivation(state, D1)?.policyId, "a");
  assert.throws(
    () => applyOperation(state, op("choose", "b"), D1),
    errorCode("DAILY_LIMIT"),
  );
  state = activate(state, "b", D2);
  assert.equal(
    state.policies.find((item) => item.id === "b")?.status,
    "active",
  );
});

test("an expired trial must be returned and explicitly chosen on the new day", () => {
  let state = applyOperation(save(emptyState(), "a"), op("choose", "a"), D1);
  assert.throws(
    () => applyOperation(state, op("activate", "a", {}, D2), D2),
    errorCode("TRIAL_EXPIRED"),
  );
  state = applyOperation(state, op("restore", "a", {}, D2), D2);
  state = activate(state, "a", D2);
  assert.equal(state.policies[0].activatedAt, D2);
});

test("activation requires an active parent", () => {
  let state = save(save(emptyState(), "a"), "b");
  state = applyOperation(state, op("choose", "b"), D1);
  assert.throws(
    () => applyOperation(state, op("activate", "b", { parentId: "a" }), D1),
    errorCode("PARENT_INACTIVE"),
  );
  assert.throws(
    () => applyOperation(state, op("activate", "b", { parentId: "b" }), D1),
    errorCode("PARENT_CYCLE"),
  );
  assert.throws(
    () =>
      applyOperation(state, op("activate", "b", { parentId: "missing" }), D1),
    errorCode("PARENT_INACTIVE"),
  );
});

test("a violation returns all active descendants but preserves ancestors and siblings", () => {
  let state = emptyState();
  for (const id of ["root", "branch", "leaf", "sibling"])
    state = save(state, id);
  state = activate(state, "root", D1);
  state = activate(state, "branch", D2, "root");
  state = activate(state, "leaf", D3, "branch");
  state = activate(state, "sibling", D4, "root");
  assert.deepEqual(
    descendants(state, "root")
      .map((item) => item.id)
      .sort(),
    ["branch", "leaf", "sibling"],
  );
  state = applyOperation(
    state,
    op("violate", "branch", { note: "A direct failure" }),
    D4,
  );
  assert.equal(
    state.policies.find((item) => item.id === "root")?.status,
    "active",
  );
  assert.equal(
    state.policies.find((item) => item.id === "sibling")?.status,
    "active",
  );
  assert.equal(
    state.policies.find((item) => item.id === "branch")?.returnKind,
    "direct",
  );
  assert.equal(
    state.policies.find((item) => item.id === "leaf")?.returnKind,
    "dependent",
  );
  assert.equal(
    state.events.filter((item) => item.type === "violated").length,
    1,
  );
  assert.equal(
    state.events.filter((item) => item.type === "dependent_return").length,
    1,
  );
  assert.equal(
    state.events.filter((item) => item.type === "activated").length,
    4,
  );
});

test("restoring a returned node clears actual parent and retains suggested parent/history", () => {
  let state = activate(save(save(emptyState(), "a"), "b"), "a", D1);
  state = activate(state, "b", D2, "a");
  state = applyOperation(state, op("violate", "b"), D2);
  state = applyOperation(state, op("restore", "b"), D2);
  const child = state.policies.find((item) => item.id === "b")!;
  assert.equal(child.status, "ready");
  assert.equal(child.parentId, null);
  assert.equal(child.suggestedParentId, "a");
  assert.equal(
    state.events.filter((item) => item.type === "activated").length,
    2,
  );
});

test("active rule/parent are immutable, while reflections append history", () => {
  const state = activate(save(emptyState(), "a"), "a", D1);
  assert.throws(
    () => applyOperation(state, op("save", "a", { rule: "Changed" }), D1),
    errorCode("POLICY_IMMUTABLE"),
  );
  const reflected = applyOperation(
    state,
    op("reflect", "a", { note: "Keep this rule concrete." }),
    D1,
  );
  assert.equal(reflected.policies[0].rule, state.policies[0].rule);
  assert.equal(reflected.events.at(-1)?.type, "reflection");
  assert.throws(
    () => applyOperation(state, op("reflect", "a", { note: " " }), D1),
    errorCode("NOTE_REQUIRED"),
  );
});

test("replaying an operation is idempotent and does not mutate its input", () => {
  const initial = emptyState();
  const operation = op("save", "a", {
    name: "A",
    rule: "A rule",
    status: "ready",
  });
  const saved = applyOperation(initial, operation, D1);
  const replay = applyOperation(saved, operation, D2);
  assert.equal(initial.policies.length, 0);
  assert.deepEqual(replay, saved);
});

test("timezone may change before first activation but is fixed afterward", () => {
  let state = applyOperation(
    emptyState(),
    op("settings", undefined, { timezone: "UTC" }),
    D1,
  );
  state = activate(save(state, "a"), "a", D1);
  assert.throws(
    () =>
      applyOperation(
        state,
        op("settings", undefined, { timezone: "Asia/Shanghai" }),
        D1,
      ),
    errorCode("TIMEZONE_LOCKED"),
  );
  state = applyOperation(
    state,
    op("settings", undefined, { locale: "en", inventoryReminders: false }),
    D1,
  );
  assert.equal(state.settings.locale, "en");
  assert.equal(state.settings.inventoryReminders, false);
});

test("snapshot validation rejects cycles, invalid active parents, and missing history", () => {
  const state = save(save(emptyState(), "a"), "b");
  const cyclic = structuredClone(state);
  cyclic.policies[0].parentId = "b";
  cyclic.policies[1].parentId = "a";
  assert.throws(() => validateState(cyclic), errorCode("PARENT_CYCLE"));
  const invalid = structuredClone(state);
  invalid.policies[1].status = "active";
  invalid.policies[1].parentId = "a";
  assert.throws(() => validateState(invalid), errorCode("PARENT_INACTIVE"));
  const missingHistory = structuredClone(state);
  missingHistory.policies[0].status = "active";
  assert.throws(
    () => validateState(missingHistory),
    errorCode("ACTIVATION_HISTORY_REQUIRED"),
  );
});

test("import merges without erasing history or reviving an existing returned policy", () => {
  const oldBackup = activate(save(emptyState(), "a"), "a", D1);
  const current = applyOperation(oldBackup, op("violate", "a"), D1);
  const merged = applyOperation(
    current,
    op("import", undefined, { state: oldBackup }),
    D1,
  );
  assert.equal(merged.policies[0].status, "returned");
  assert.equal(
    merged.events.filter((item) => item.type === "violated").length,
    1,
  );
  assert.equal(getTodayActivation(merged, D1)?.policyId, "a");
  const empty = applyOperation(
    merged,
    op("import", undefined, { state: emptyState() }),
    D1,
  );
  assert.equal(empty.policies.length, 1);
  assert.equal(
    empty.events.filter((item) => item.type === "activated").length,
    1,
  );
});

test("import rejects backups which would duplicate a daily activation", () => {
  const current = activate(save(emptyState(), "a"), "a", D1);
  const incoming = activate(save(emptyState(), "b"), "b", D1);
  assert.throws(
    () =>
      applyOperation(current, op("import", undefined, { state: incoming }), D1),
    errorCode("DAILY_LIMIT"),
  );
});

test("a backup of an unconfirmed trial preserves the trial without consuming a daily activation", () => {
  const backup = applyOperation(save(emptyState(), "a"), op("choose", "a"), D1);
  let restored = applyOperation(
    emptyState(),
    op("import", undefined, { state: backup }),
    D1,
  );
  assert.equal(restored.policies[0].status, "trial");
  assert.equal(getTodayActivation(restored, D1), undefined);
  restored = applyOperation(restored, op("restore", "a", {}, D2), D2);
  restored = activate(restored, "a", D2);
  assert.equal(getTodayActivation(restored, D2)?.policyId, "a");
});

test("deleteDraft retains history and rejects deletion of ready policies", () => {
  let state = save(save(emptyState(), "draft", { status: "draft" }), "ready");
  assert.throws(
    () => applyOperation(state, op("deleteDraft", "ready"), D1),
    errorCode("NOT_DRAFT"),
  );
  state = applyOperation(state, op("deleteDraft", "draft"), D1);
  assert.equal(state.policies.length, 1);
  assert.ok(state.events.some((item) => item.policyId === "draft"));
  assert.doesNotThrow(() => validateState(state));
});

test("invalid snapshots, operations, and oversized values are rejected", () => {
  assert.throws(() => validateState({}), errorCode("INVALID_SNAPSHOT"));
  assert.throws(
    () =>
      applyOperation(
        emptyState(),
        { ...op("settings"), type: "unknown" } as unknown as Operation,
        D1,
      ),
    errorCode("INVALID_OPERATION"),
  );
  assert.throws(
    () => save(emptyState(), "a", { name: "a".repeat(161) }),
    errorCode("INVALID_DATA"),
  );
  assert.throws(
    () => save(emptyState(), "a", { reminderTime: "25:00" }),
    errorCode("INVALID_REMINDER"),
  );
});

test("backup enum fields reject arrays and objects instead of coercing them into valid words", () => {
  const state = save(emptyState(), "a");
  const cases: Array<{
    word: string;
    snapshot: (value: unknown) => unknown;
  }> = [
    { word: "zh", snapshot: (value) => ({ ...state, settings: { ...state.settings, locale: value } }) },
    { word: "ready", snapshot: (value) => ({ ...state, policies: [{ ...state.policies[0], status: value }] }) },
    { word: "created", snapshot: (value) => ({ ...state, events: [{ ...state.events[0], type: value }] }) },
    { word: "direct", snapshot: (value) => ({ ...state, policies: [{ ...state.policies[0], returnKind: value }] }) },
  ];
  for (const entry of cases) {
    // Single-element arrays also occur in ordinary JSON and stringify to the valid word.
    for (const value of [[entry.word], { toString: () => entry.word }, { value: entry.word }]) {
      assert.throws(() => validateState(entry.snapshot(value)), errorCode("INVALID_DATA"));
    }
  }
  assert.deepEqual(validateState(state), state);
});

test("a non-string operation type is rejected without recording a successful no-op", () => {
  const state = save(emptyState(), "a");
  const before = structuredClone(state);
  for (const type of [["save"], { toString: () => "save" }, { value: "save" }]) {
    const operation = {
      ...op("save", "b", { name: "b", rule: "Rule b", status: "ready" }),
      type,
    } as unknown as Operation;
    assert.throws(() => applyOperation(state, operation, D1), errorCode("INVALID_OPERATION"));
    assert.equal(state.appliedOperationIds.includes(operation.id), false);
  }
  assert.deepEqual(state, before);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOperation, emptyState, PolicyError, validateState } from "../src/lib/policy/domain";
import { currentSeatCases } from "../src/lib/policy/sacred-seats";
import type { Operation, PolicyState } from "../src/lib/policy/types";

const at = "2026-10-18T10:00:00.000Z";
let seq = 0;
function run(state: PolicyState, type: Operation["type"], seat = "desk", payload: Record<string, unknown> = {}) {
  return applyOperation(state, { id: `seat-op-${++seq}`, type, policyId: seat, at, payload }, at);
}
function create() { return run(emptyState(), "seatSave", "desk", { name: "书桌", rule: "坐下后只做当前任务" }); }
const error = (code: string) => (cause: unknown) => cause instanceof PolicyError && cause.code === code;

test("new seats are empty and creation does not seed demonstration counts", () => {
  const state = create();
  assert.deepEqual(state.seats[0], { id: "desk", name: "书桌", rule: "坐下后只做当前任务", task: "", main: { count: 0, generation: 1 }, aux: { count: 0, generation: 1 }, cases: [], records: [] });
  assert.equal(state.events.length, 0);
  assert.deepEqual(validateState(state), state);
});

test("manual completions are repeatable per day and independent across chains and seats", () => {
  let state = run(create(), "seatSave", "yoga", { name: "瑜伽垫", rule: "认真练习" });
  state = run(state, "seatComplete", "desk", { chain: "main", task: "读书" });
  state = run(state, "seatComplete", "desk", { chain: "main", task: "写作" });
  state = run(state, "seatComplete", "desk", { chain: "aux", task: "按时开始" });
  state = run(state, "seatComplete", "yoga", { chain: "main", task: "" });
  assert.equal(state.seats[0].main.count, 2);
  assert.equal(state.seats[0].aux.count, 1);
  assert.equal(state.seats[1].main.count, 1);
  assert.equal(state.seats[1].aux.count, 0);
  assert.equal(state.seats[0].task, "按时开始");
  assert.equal(state.seats[0].records[0].type, "reservation_success");
  assert.equal(state.seats[0].records[1].task, "写作");
  assert.equal(state.events.filter(item => item.type === "activated").length, 0);
});

test("reservation failure clears that chain only, retains history, and starts a new generation", () => {
  let state = create();
  for (const chain of ["main", "aux"]) state = run(state, "seatComplete", "desk", { chain, task: "任务" });
  state = run(state, "seatAllow", "desk", { chain: "aux", condition: "临时急事" });
  const failed = run(state, "seatFail", "desk", { chain: "aux", condition: "忘记开始", expectedCount: 1, expectedGeneration: 1 });
  assert.deepEqual(failed.seats[0].aux, { count: 0, generation: 2 });
  assert.deepEqual(failed.seats[0].main, { count: 1, generation: 1 });
  assert.equal(failed.seats[0].records[0].oldCount, 1);
  assert.equal(failed.seats[0].records[0].generation, 1);
  assert.equal(failed.seats[0].cases.length, 1);
  assert.equal(currentSeatCases(failed.seats[0], "aux").length, 0);
  assert.equal(state.seats[0].aux.count, 1);
  const restarted = run(failed, "seatComplete", "desk", { chain: "aux", task: "" });
  assert.equal(restarted.seats[0].aux.count, 1);
  assert.equal(restarted.seats[0].records[0].generation, 2);
});

test("current precedents prevent contradictory failure only within their own chain and generation", () => {
  let state = create();
  state = run(state, "seatAllow", "desk", { chain: "main", condition: "必要电话" });
  assert.throws(() => run(state, "seatFail", "desk", { chain: "main", condition: "必要电话" }), error("PRECEDENT_ALLOWED"));
  const duplicate = run(state, "seatAllow", "desk", { chain: "main", condition: "必要电话" });
  assert.equal(duplicate.seats[0].cases.length, 1);
  assert.equal(duplicate.seats[0].records.length, 2);
  state = run(state, "seatFail", "desk", { chain: "aux", condition: "必要电话" });
  assert.equal(state.seats[0].main.generation, 1);
  state = run(state, "seatFail", "desk", { chain: "main", condition: "刷短视频" });
  assert.doesNotThrow(() => run(state, "seatFail", "desk", { chain: "main", condition: "必要电话" }));
});

test("edits keep counts and cases, log exact versions, and reject stale drafts", () => {
  let state = run(create(), "seatComplete", "desk", { chain: "main", task: "读书" });
  const before = state.seats[0];
  state = run(state, "seatSave", "desk", { name: "工作桌", rule: "坐下后认真工作", expectedName: before.name, expectedRule: before.rule });
  assert.equal(state.seats[0].main.count, 1);
  assert.equal(state.seats[0].task, "读书");
  assert.equal(state.seats[0].records[0].before, "书桌\n坐下后只做当前任务");
  assert.equal(state.seats[0].records[0].after, "工作桌\n坐下后认真工作");
  assert.throws(() => run(state, "seatSave", "desk", { name: before.name, rule: "旧草稿", expectedRule: before.rule }), error("EDIT_CONFLICT"));
  const updated = run(state, "seatComplete", "desk", { chain: "main", task: "写作" });
  assert.throws(() => run(updated, "seatFail", "desk", { chain: "main", condition: "未完成", expectedCount: 1, expectedGeneration: 1 }), error("EDIT_CONFLICT"));
});

test("seat operations are idempotent and invalid data cannot mutate the input", () => {
  const original = create();
  const op: Operation = { id: "same-completion", type: "seatComplete", policyId: "desk", at, payload: { chain: "main", task: "读书" } };
  const completed = applyOperation(original, op, at);
  assert.deepEqual(applyOperation(completed, op, at), completed);
  assert.equal(original.seats[0].main.count, 0);
  assert.throws(() => run(original, "seatComplete", "desk", { chain: ["main"], task: "" }), error("INVALID_CHAIN"));
  assert.throws(() => run(original, "seatFail", "missing", { chain: "main", condition: "失败" }), error("SEAT_MISSING"));
  const invalid = structuredClone(original);
  invalid.seats[0].main.count = -1;
  assert.throws(() => validateState(invalid), error("INVALID_DATA"));
  const future = structuredClone(original);
  future.seats[0].cases.push({ id: "bad", at, chain: "main", generation: 2, condition: "未来判例" });
  assert.throws(() => validateState(future), error("INVALID_SEAT"));
});

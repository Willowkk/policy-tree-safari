import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseBackup, serializeBackup } from "../src/lib/policy/backup";
import { applyOperation, emptyState, getTodayActivation, PolicyError } from "../src/lib/policy/domain";
import { hasMeaningfulPolicyEdit, visiblePolicyHistory } from "../src/lib/policy/history-visibility";
import type { HistoryEvent, Operation, PolicyState } from "../src/lib/policy/types";

const NOW = "2026-10-18T09:11:00.000Z";
function event(type: HistoryEvent["type"], id: string, fields: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    id, operationId: `operation-${id}`, type,
    policyId: "practice", policyName: "午后阅读", at: NOW, note: "",
    ...fields,
  };
}

test("legacy operation noise is hidden while meaningful milestones keep their order", () => {
  const events = [
    event("created", "created"),
    event("edited", "old-edit-1"),
    event("edited", "old-edit-2"),
    event("chosen", "chosen-1"),
    event("restored", "restored"),
    event("chosen", "chosen-2"),
    event("activated", "activated"),
    event("violated", "violated", { note: "晚饭后忘记了" }),
    event("dependent_return", "dependent-return"),
    event("reflection", "reflection", { note: "明天把手机放远一点" }),
    event("imported", "imported"),
  ];
  const snapshot = JSON.stringify(events);
  events.forEach(Object.freeze);
  Object.freeze(events);

  const visible = visiblePolicyHistory(events);
  assert.deepEqual(visible.map(item => item.id), ["activated", "violated", "dependent-return", "reflection"]);
  assert.equal(visible[0], events[6]);
  assert.equal(JSON.stringify(events), snapshot);
});

test("edits need a readable note or actual text differences; empty and whitespace-only edits are hidden", () => {
  const cases: Array<[Partial<HistoryEvent>, boolean]> = [
    [{}, false],
    [{ note: " \n\t " }, false],
    [{ before: "原规则", after: "原规则" }, false],
    [{ before: " 原规则\n", after: "原规则 " }, false],
    [{ before: " \n", after: "\t" }, false],
    [{ before: "原规则", after: "新规则" }, true],
    [{ after: "补充的规则" }, true],
    [{ before: "删去的规则" }, true],
    [{ note: "改为晚饭后执行" }, true],
  ];
  const events = cases.map(([fields], index) => event("edited", `edit-${index}`, fields));
  cases.forEach(([, expected], index) => assert.equal(hasMeaningfulPolicyEdit(events[index]), expected));
  assert.equal(hasMeaningfulPolicyEdit(event("chosen", "with-note", { note: "操作备注" })), false);
  assert.deepEqual(visiblePolicyHistory(events), events.filter((_, index) => cases[index][1]));
});

test("display filtering preserves full JSON backups and the consumed daily activation allowance", () => {
  let sequence = 0;
  function apply(state: PolicyState, type: Operation["type"], payload: Record<string, unknown> = {}): PolicyState {
    return applyOperation(state, { id: `operation-${++sequence}`, type, policyId: "practice", at: NOW, payload }, NOW);
  }
  let state = apply(emptyState(), "save", { name: "午后阅读", rule: "午饭后阅读纸质书十分钟。", status: "ready" });
  state = apply(state, "choose");
  state = apply(state, "activate", { parentId: null });
  state = apply(state, "violate", { note: "今天未遵守" });
  state = apply(state, "restore");
  state.events.unshift(event("created", "legacy-created"), event("edited", "legacy-edit"));
  const snapshot = JSON.stringify(state);

  const visible = visiblePolicyHistory(state.events);
  assert.deepEqual(visible.map(item => item.type), ["activated", "violated"]);
  assert.equal(JSON.stringify(state), snapshot);
  const restored = parseBackup(serializeBackup(state, NOW));
  assert.deepEqual(restored, state);
  assert.equal(restored.events.length, 6);
  assert.equal(getTodayActivation(restored, NOW)?.policyId, "practice");
  assert.throws(() => apply(restored, "choose"), error => error instanceof PolicyError && error.code === "DAILY_LIMIT");
});

import { dayKey, emptyState, PolicyError, validateState } from "./domain";
import { validateSacredSeats } from "./sacred-seats";
import type { HistoryEvent, Locale, Policy, PolicyState } from "./types";

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export function checkBackupSize(bytes: number, locale: Locale = "zh"): void {
  if (bytes > MAX_BACKUP_BYTES) {
    throw new Error(locale === "zh" ? "备份文件需小于 20 MB" : "Backup must be smaller than 20 MB");
  }
}

export function serializeBackup(state: PolicyState, at = new Date().toISOString()): string {
  const content = JSON.stringify({
    format: "policy-tree-backup",
    version: "0.4.0",
    exportedAt: at,
    state: validateState(state),
  }, null, 2);
  // Do not create a file that this version cannot read back.
  checkBackupSize(new TextEncoder().encode(content).byteLength, state.settings.locale);
  return content;
}

export function parseBackup(content: string, locale: Locale = "zh"): PolicyState {
  checkBackupSize(new TextEncoder().encode(content).byteLength, locale);
  const parsed: unknown = JSON.parse(content);
  const input = isObject(parsed) && parsed.format === "policy-tree-preview"
    ? migratePreviewBackup(parsed, locale)
    : isObject(parsed) && "state" in parsed ? parsed.state : parsed;
  const state = validateState(input);
  // Import the saved state only. Never execute a legacy backup's queued requests.
  return { ...state, policies: state.policies.map(policy => ({ ...policy, reminderTime: "" })) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Convert only previews that satisfy the same formal tree and daily-limit checks. */
function migratePreviewBackup(input: Record<string, unknown>, locale: Locale): PolicyState {
  const invalid = (): never => { throw new PolicyError("INVALID_SNAPSHOT", locale === "zh" ? "HTML 草稿备份格式无效。" : "The HTML preview backup is invalid."); };
  function text(value: unknown, max = 20_000): string {
    if (typeof value !== "string" || !value.trim() || value.length > max) return invalid();
    return value;
  }
  function date(value: unknown): string {
    const result = text(value, 64);
    if (!Number.isFinite(Date.parse(result))) return invalid();
    return result;
  }
  function fields(value: unknown) {
    if (!isObject(value)) return invalid();
    return { name: text(value.name, 160), rule: text(value.rule) };
  }
  // Stable IDs make importing the same preview twice an idempotent merge.
  function hash(value: string): string {
    let result = 2166136261;
    for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
    return (result >>> 0).toString(36);
  }
  if (input.version !== 1 || !Array.isArray(input.tree) || !Array.isArray(input.candidates) || input.candidates.length > 1_000 || !isObject(input.today)) return invalid();
  const at = date(input.exportedAt);
  const state = emptyState(locale);
  let count = 0;
  const paths = new Map<string, Policy>();
  function node(value: unknown, parentId: string | null, path: number[]): void {
    if (!isObject(value) || path.length > 17 || ++count > 500) return invalid();
    const content = fields(value);
    const activatedAt = date(value.activatedAt);
    const id = `preview-tree-${path.join("-")}-${hash(content.name + activatedAt)}`;
    const policy: Policy = { id, ...content, status: "active", parentId, suggestedParentId: parentId, reminderTime: "", updatedAt: activatedAt, activatedAt };
    state.policies.push(policy);
    paths.set(path.join("/"), policy);
    state.events.push({ id: `${id}:activated`, operationId: `${id}:activation`, type: "activated", policyId: id, policyName: policy.name, at: activatedAt, note: "", day: dayKey(activatedAt, state.settings.timezone), parentId });
    if (value.changes !== undefined) {
      if (!Array.isArray(value.changes) || value.changes.length > 1_000) return invalid();
      for (const change of value.changes) {
        if (!isObject(change)) return invalid();
        const eventAt = date(change.at), before = text(change.before), after = text(change.after);
        const eventId = `${id}:edit:${hash(eventAt + before + after)}`;
        const event: HistoryEvent = { id: eventId, operationId: eventId, type: "edited", policyId: id, policyName: policy.name, at: eventAt, note: "", before, after };
        state.events.push(event);
        if (Date.parse(eventAt) > Date.parse(policy.updatedAt)) policy.updatedAt = eventAt;
      }
    }
    if (value.children !== undefined) {
      if (!Array.isArray(value.children)) return invalid();
      value.children.forEach((child, index) => node(child, id, [...path, index]));
    }
  }
  input.tree.forEach((value, index) => node(value, null, [index]));
  input.candidates.forEach((value, index) => {
    const content = fields(value);
    state.policies.push({ id: `preview-ready-${index}-${hash(content.name + content.rule)}`, ...content, status: "ready", parentId: null, suggestedParentId: null, reminderTime: "", updatedAt: at });
  });
  const current = fields(input.today.policy);
  const path = input.today.activatedPath;
  if (path === null) {
    // Preview policies have no IDs. Export metadata must not turn the same
    // unconfirmed policy into a second trial when a later backup is merged.
    state.policies.push({ id: `preview-trial-${hash(current.name + "\u0000" + current.rule)}`, ...current, status: "trial", parentId: null, suggestedParentId: null, reminderTime: "", updatedAt: at, trialDate: dayKey(at, state.settings.timezone) });
  } else {
    if (!Array.isArray(path) || path.length < 1 || path.length > 17 || path.some(value => !Number.isSafeInteger(value) || value < 0)) return invalid();
    const policy = paths.get(path.join("/"));
    if (!policy || policy.name !== current.name || policy.rule !== current.rule) invalid();
  }
  state.seats = input.seats !== undefined
    ? validateSacredSeats(input.seats)
    : input.seat !== undefined && isObject(input.seat)
      ? validateSacredSeats([{ ...input.seat, id: input.seat.id ?? "legacy-seat" }])
      : [];
  try {
    return validateState(state);
  } catch (cause) {
    if (cause instanceof PolicyError && cause.code === "DAILY_LIMIT") {
      throw new PolicyError("DAILY_LIMIT", locale === "zh"
        ? "草稿中存在同一天点亮多个节点，无法按正式版的每日一次规则导入。请保留原备份；点亮日期未被修改。"
        : "This preview activates multiple policies on one day and cannot be imported under the one-per-day rule. Keep the original backup; activation dates have not been changed.");
    }
    throw cause;
  }
}

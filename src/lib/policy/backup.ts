import { validateState } from "./domain";
import type { Locale, PolicyState } from "./types";

export const MAX_BACKUP_BYTES = 20 * 1024 * 1024;

export function checkBackupSize(bytes: number, locale: Locale = "zh"): void {
  if (bytes > MAX_BACKUP_BYTES) {
    throw new Error(locale === "zh" ? "备份文件需小于 20 MB" : "Backup must be smaller than 20 MB");
  }
}

export function serializeBackup(state: PolicyState, at = new Date().toISOString()): string {
  const content = JSON.stringify({
    format: "policy-tree-backup",
    version: "0.3.0",
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
  const input = parsed && typeof parsed === "object" && "state" in parsed ? parsed.state : parsed;
  const state = validateState(input);
  // Import the saved state only. Never execute a legacy backup's queued requests.
  return { ...state, policies: state.policies.map(policy => ({ ...policy, reminderTime: "" })) };
}

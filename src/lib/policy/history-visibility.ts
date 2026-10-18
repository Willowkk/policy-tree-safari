import type { HistoryEvent } from "./types";

export function hasMeaningfulPolicyEdit(event: HistoryEvent): boolean {
  if (event.type !== "edited") return false;
  if (event.note.trim()) return true;
  const before = event.before?.trim() ?? "";
  const after = event.after?.trim() ?? "";
  return (before !== "" || after !== "") && before !== after;
}

/** Select display entries without changing the saved history or its order. */
export function visiblePolicyHistory(events: HistoryEvent[]): HistoryEvent[] {
  return events.filter(event =>
    event.type === "activated" ||
    event.type === "violated" ||
    event.type === "dependent_return" ||
    event.type === "reflection" ||
    hasMeaningfulPolicyEdit(event),
  );
}

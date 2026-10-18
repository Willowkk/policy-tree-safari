import { PolicyError } from "./errors";
import type { Operation, SacredSeat, SacredSeatRecord, SeatChain } from "./types";

const MAX_COUNT = 1_000_000;
const recordTypes = new Set(["completed", "reserved", "started", "reservation_success", "edited", "allowed", "failed"]);

function fail(code: string, message: string): never {
  throw new PolicyError(code, message);
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, field: string, max = 20_000, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()))
    fail("INVALID_DATA", `${field} must contain text of at most ${max} characters.`);
  return value;
}
function date(value: unknown): string {
  const result = text(value, "seat.at", 64);
  if (!Number.isFinite(Date.parse(result))) fail("INVALID_DATA", "The seat record date is invalid.");
  return result;
}
function integer(value: unknown, field: string, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > MAX_COUNT)
    fail("INVALID_DATA", `${field} is invalid.`);
  return value;
}
function chain(value: unknown): SeatChain {
  if (value !== "main" && value !== "aux") fail("INVALID_CHAIN", "Choose the main or reservation chain.");
  return value;
}

/** Reads the manual-record model; older preview timing fields are deliberately omitted. */
export function validateSacredSeat(input: unknown): SacredSeat {
  if (!object(input) || !object(input.main) || !object(input.aux) || !Array.isArray(input.cases) || !Array.isArray(input.records))
    fail("INVALID_SEAT", "This sacred seat is invalid.");
  if (input.cases.length > 2_000 || input.records.length > 10_000)
    fail("DATA_LIMIT", "This seat has too many records.");
  const state: SacredSeat = {
    id: text(input.id, "seat.id", 160),
    name: text(input.name, "seat.name", 100),
    rule: text(input.rule, "seat.rule"),
    task: text(input.task, "seat.task", 20_000, true),
    main: { count: integer(input.main.count, "main.count"), generation: integer(input.main.generation, "main.generation", 1) },
    aux: { count: integer(input.aux.count, "aux.count"), generation: integer(input.aux.generation, "aux.generation", 1) },
    cases: [],
    records: [],
  };
  const caseIds = new Set<string>();
  state.cases = input.cases.map((raw: unknown) => {
    if (!object(raw)) fail("INVALID_SEAT", "A seat precedent is invalid.");
    const id = text(raw.id, "case.id", 512);
    const itemChain = chain(raw.chain);
    const generation = integer(raw.generation, "case.generation", 1);
    if (caseIds.has(id)) fail("DUPLICATE_EVENT", "Precedent IDs must be unique within a seat.");
    if (generation > state[itemChain].generation) fail("INVALID_SEAT", "A precedent belongs to a future chain.");
    caseIds.add(id);
    return { id, at: date(raw.at), chain: itemChain, generation, condition: text(raw.condition, "case.condition") };
  });
  const recordIds = new Set<string>();
  state.records = input.records.map((raw: unknown) => {
    if (!object(raw) || typeof raw.type !== "string" || !recordTypes.has(raw.type))
      fail("INVALID_SEAT", "A seat history record is invalid.");
    const id = text(raw.id, "seatRecord.id", 512);
    const itemChain = chain(raw.chain);
    const generation = integer(raw.generation, "record.generation", 1);
    if (recordIds.has(id)) fail("DUPLICATE_EVENT", "Record IDs must be unique within a seat.");
    if (generation > state[itemChain].generation) fail("INVALID_SEAT", "A record belongs to a future chain.");
    recordIds.add(id);
    const result: SacredSeatRecord = {
      id, at: date(raw.at), type: raw.type as SacredSeatRecord["type"], chain: itemChain, generation,
      task: text(raw.task, "record.task", 20_000, true), note: text(raw.note, "record.note", 20_000, true),
    };
    if (raw.before !== undefined) result.before = text(raw.before, "record.before", 40_200);
    if (raw.after !== undefined) result.after = text(raw.after, "record.after", 40_200);
    if (raw.oldCount !== undefined) result.oldCount = integer(raw.oldCount, "record.oldCount");
    return result;
  });
  return state;
}

export function validateSacredSeats(input: unknown): SacredSeat[] {
  // schemaVersion 1 snapshots made before sacred seats have no seats property.
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 100) fail("DATA_LIMIT", "A snapshot may contain at most 100 seats.");
  const result = input.map(validateSacredSeat);
  if (new Set(result.map(item => item.id)).size !== result.length)
    fail("DUPLICATE_SEAT", "Sacred seat IDs must be unique.");
  return result;
}

export function currentSeatCases(seat: SacredSeat, target: SeatChain) {
  return seat.cases.filter(item => item.chain === target && item.generation === seat[target].generation);
}

/** Called within applyOperation's pure mutation and final snapshot validation. */
export function applySeatOperation(seats: SacredSeat[], op: Operation, at: string): void {
  const payload = op.payload;
  const id = text(op.policyId, "seat.id", 160);
  let seat = seats.find(item => item.id === id);
  if (op.type === "seatSave") {
    const name = text(payload.name, "seat.name", 100).trim();
    const rule = text(payload.rule, "seat.rule").trim();
    if (!seat) {
      if (payload.expectedRule !== undefined || payload.expectedName !== undefined)
        fail("SEAT_MISSING", "This sacred seat no longer exists.");
      if (seats.length >= 100) fail("DATA_LIMIT", "You may create at most 100 seats.");
      seats.push({ id, name, rule, task: "", main: { count: 0, generation: 1 }, aux: { count: 0, generation: 1 }, cases: [], records: [] });
      return;
    }
    if ((payload.expectedRule !== undefined && text(payload.expectedRule, "expectedRule") !== seat.rule) ||
      (payload.expectedName !== undefined && text(payload.expectedName, "expectedName", 100) !== seat.name))
      fail("EDIT_CONFLICT", "This seat changed in another tab. Reopen it before editing.");
    const before = `${seat.name}\n${seat.rule}`;
    const after = `${name}\n${rule}`;
    if (before === after) return;
    seat.name = name;
    seat.rule = rule;
    seat.records.unshift({ id: op.id, at, type: "edited", chain: "main", generation: seat.main.generation, task: "", note: "修改启动规则", before, after });
    return;
  }
  if (!seat) fail("SEAT_MISSING", "This sacred seat no longer exists.");
  const target = chain(payload.chain);
  function log(type: SacredSeatRecord["type"], note: string, extra: Partial<SacredSeatRecord> = {}) {
    seat!.records.unshift({ id: op.id, at, type, chain: target, generation: seat![target].generation, task: "", note, ...extra });
  }
  if (op.type === "seatComplete") {
    const task = text(payload.task, "task", 20_000, true).trim();
    if (seat[target].count >= MAX_COUNT) fail("DATA_LIMIT", "This chain has reached its maximum count.");
    seat.task = task;
    seat[target].count++;
    log(target === "main" ? "completed" : "reservation_success", `${target === "main" ? "主链" : "预约链"} ${seat[target].count}`, { task });
    return;
  }
  const condition = text(payload.condition, "condition").trim();
  const precedent = currentSeatCases(seat, target).find(item => item.condition.trim() === condition);
  if (op.type === "seatAllow") {
    if (!precedent) seat.cases.unshift({ id: `${op.id}-case`, at, chain: target, generation: seat[target].generation, condition });
    log("allowed", condition);
    return;
  }
  if (op.type !== "seatFail") fail("INVALID_OPERATION", "The seat operation is invalid.");
  if ((payload.expectedCount !== undefined && integer(payload.expectedCount, "expectedCount") !== seat[target].count) ||
    (payload.expectedGeneration !== undefined && integer(payload.expectedGeneration, "expectedGeneration", 1) !== seat[target].generation))
    fail("EDIT_CONFLICT", "This chain changed in another tab. Review it before recording a failure.");
  if (precedent) fail("PRECEDENT_ALLOWED", "This situation already has an allowed precedent in the current chain.");
  if (seat[target].generation >= MAX_COUNT) fail("DATA_LIMIT", "This chain has reached its maximum generation.");
  log("failed", condition, { oldCount: seat[target].count });
  seat[target].count = 0;
  seat[target].generation++;
}

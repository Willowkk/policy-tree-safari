import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_STORAGE_KEY,
  LocalPolicyStore,
} from "../src/lib/policy/local-store";
import type { StorageLike, StoreLocks } from "../src/lib/policy/local-store";
import { validateState } from "../src/lib/policy/domain";

const DAY_ONE = "2026-10-15T08:00:00.000Z";
const DAY_TWO = "2026-10-16T08:00:00.000Z";
const DAY_THREE = "2026-10-17T08:00:00.000Z";
let sequence = 0;

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  failRead = false;
  failWrite = false;
  writes = 0;
  getItem(key: string): string | null {
    if (this.failRead) throw new Error("blocked");
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error("quota");
    this.writes += 1;
    this.values.set(key, value);
  }
}

class SerialLocks implements StoreLocks {
  names: string[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T> {
    this.names.push(name);
    const task = this.queue.then(callback);
    this.queue = task.catch(() => undefined);
    return task;
  }
}

function setup(storage = new MemoryStorage(), locks?: StoreLocks) {
  let now = DAY_ONE;
  const store = new LocalPolicyStore({
    storage,
    locks,
    now: () => now,
    id: () => `local-operation-${++sequence}`,
  });
  store.reload();
  return { store, storage, setDay: (day: string) => { now = day; } };
}

async function save(store: LocalPolicyStore, id: string) {
  return store.submit("save", id, { name: id, rule: `Rule ${id}`, status: "ready" });
}

async function activate(store: LocalPolicyStore, id: string, parentId: string | null = null) {
  assert.equal(await store.submit("choose", id), true);
  assert.equal(await store.submit("activate", id, { parentId }), true);
}

test("a new tree loads without a login, network, or destructive initialization write", async () => {
  const { store, storage } = setup();
  assert.equal(store.getSnapshot().ready, true);
  assert.equal(store.getSnapshot().lastSaved, null);
  assert.equal(storage.writes, 0);
  assert.equal(await save(store, "first"), true);
  const reloaded = setup(storage).store;
  assert.equal(reloaded.getSnapshot().state.policies[0].name, "first");
  assert.equal(reloaded.getSnapshot().lastSaved, DAY_ONE);
});

test("activation takes effect locally immediately and the daily allowance survives reload", async () => {
  const { store, storage } = setup();
  await save(store, "first");
  await save(store, "second");
  await activate(store, "first");
  assert.equal(store.getSnapshot().state.policies[0].status, "active");
  assert.equal(store.getSnapshot().state.events.filter((event) => event.type === "activated").length, 1);
  const reloaded = setup(storage);
  assert.equal(await reloaded.store.submit("choose", "second"), false);
  assert.match(reloaded.store.getSnapshot().error ?? "", /activation/);
  reloaded.setDay(DAY_TWO);
  await activate(reloaded.store, "second");
  assert.equal(reloaded.store.getSnapshot().state.events.filter((event) => event.type === "activated").length, 2);
});

test("a violation returns dependent descendants and preserves activation history and reflection", async () => {
  const { store, storage, setDay } = setup();
  await save(store, "parent");
  await save(store, "child");
  await save(store, "sibling");
  await activate(store, "parent");
  setDay(DAY_TWO);
  await activate(store, "child", "parent");
  setDay(DAY_THREE);
  await activate(store, "sibling");
  assert.equal(await store.submit("violate", "parent", { note: "Too ambitious" }), true);
  assert.equal(await store.submit("reflect", "parent", { note: "Make the rule smaller" }), true);
  const state = setup(storage).store.getSnapshot().state;
  assert.equal(state.policies.find((policy) => policy.id === "parent")?.status, "returned");
  assert.equal(state.policies.find((policy) => policy.id === "child")?.status, "returned");
  assert.equal(state.policies.find((policy) => policy.id === "sibling")?.status, "active");
  assert.equal(state.events.filter((event) => event.type === "activated").length, 3);
  assert.ok(state.events.some((event) => event.type === "violated" && event.note === "Too ambitious"));
  assert.ok(state.events.some((event) => event.type === "reflection" && event.note === "Make the rule smaller"));
});

test("malformed or invalid stored snapshots are never overwritten", async () => {
  for (const raw of ["{broken", JSON.stringify({ format: "policy-tree-local", version: 1, revision: 1, savedAt: DAY_ONE, state: {} })]) {
    const storage = new MemoryStorage();
    storage.values.set(LOCAL_STORAGE_KEY, raw);
    const { store } = setup(storage);
    assert.equal(store.getSnapshot().storageError, "corrupt");
    assert.equal(await save(store, "replacement"), false);
    assert.equal(storage.values.get(LOCAL_STORAGE_KEY), raw);
    assert.equal(storage.writes, 0);
  }
});

test("write failure does not show unsaved changes and keeps valid memory data exportable", async () => {
  const { store, storage } = setup();
  await save(store, "saved");
  const before = store.getSnapshot();
  const raw = storage.values.get(LOCAL_STORAGE_KEY);
  storage.failWrite = true;
  assert.equal(await save(store, "unsaved"), false);
  assert.equal(store.getSnapshot().state, before.state);
  assert.equal(store.getSnapshot().lastSaved, before.lastSaved);
  assert.equal(store.getSnapshot().storageError, "write-failed");
  assert.equal(storage.values.get(LOCAL_STORAGE_KEY), raw);
  assert.equal(validateState(JSON.parse(JSON.stringify(store.getSnapshot().state))).policies.length, 1);
  storage.failWrite = false;
  assert.equal(await save(store, "retried"), true);
  assert.equal(store.getSnapshot().storageError, null);
});

test("read failure or later corruption preserves the last valid memory snapshot", async () => {
  const { store, storage } = setup();
  await save(store, "saved");
  const valid = store.getSnapshot().state;
  storage.failRead = true;
  store.reload();
  assert.equal(store.getSnapshot().state, valid);
  assert.equal(await save(store, "blocked"), false);
  assert.equal(store.getSnapshot().storageError, "unavailable");
  storage.failRead = false;
  storage.values.set(LOCAL_STORAGE_KEY, "{damaged");
  store.reload();
  assert.equal(store.getSnapshot().state, valid);
  assert.equal(await save(store, "blocked"), false);
  assert.equal(storage.values.get(LOCAL_STORAGE_KEY), "{damaged");
});

test("an externally removed record preserves the current tree and blocks silent replacement", async () => {
  const { store, storage } = setup();
  await save(store, "saved");
  const valid = store.getSnapshot().state;
  storage.values.delete(LOCAL_STORAGE_KEY);
  store.reload();
  assert.equal(store.getSnapshot().storageError, "removed");
  assert.equal(store.getSnapshot().state, valid);
  assert.equal(await save(store, "replacement"), false);
  assert.equal(storage.values.has(LOCAL_STORAGE_KEY), false);
});

test("mutations reread another tab's changes inside Web Locks instead of replacing stale state", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const a = setup(storage, locks).store;
  const b = setup(storage, locks).store;
  assert.equal(await save(a, "from-a"), true);
  assert.equal(b.getSnapshot().state.policies.length, 0);
  assert.equal(await save(b, "from-b"), true);
  assert.deepEqual(b.getSnapshot().state.policies.map((policy) => policy.id), ["from-a", "from-b"]);
  a.reload();
  assert.deepEqual(a.getSnapshot().state.policies.map((policy) => policy.id), ["from-a", "from-b"]);
  assert.deepEqual(locks.names, [LOCAL_STORAGE_KEY, LOCAL_STORAGE_KEY]);
});

test("concurrent tabs serialize activation with Web Locks and accept only one request", async () => {
  const storage = new MemoryStorage();
  const locks = new SerialLocks();
  const a = setup(storage, locks).store;
  await save(a, "trial");
  assert.equal(await a.submit("choose", "trial"), true);
  const b = setup(storage, locks).store;
  const results = await Promise.all([a.submit("activate", "trial"), b.submit("activate", "trial")]);
  assert.equal(results.filter(Boolean).length, 1);
  const state = setup(storage).store.getSnapshot().state;
  assert.equal(state.events.filter((event) => event.type === "activated").length, 1);
  assert.equal(state.policies[0].status, "active");
  assert.equal(locks.names.length, 4);
});

test("one store serializes rapid operations even when Web Locks are unavailable", async () => {
  const { store, storage } = setup();
  assert.deepEqual(await Promise.all([save(store, "a"), save(store, "b"), save(store, "c")]), [true, true, true]);
  assert.deepEqual(setup(storage).store.getSnapshot().state.policies.map((policy) => policy.id), ["a", "b", "c"]);
});

test("a rejected domain operation leaves both persisted and displayed data unchanged", async () => {
  const { store, storage } = setup();
  await save(store, "ready");
  const state = store.getSnapshot().state;
  const raw = storage.values.get(LOCAL_STORAGE_KEY);
  assert.equal(await store.submit("activate", "ready"), false);
  assert.equal(store.getSnapshot().state, state);
  assert.equal(storage.values.get(LOCAL_STORAGE_KEY), raw);
  assert.match(store.getSnapshot().error ?? "", /Choose and try/);
});

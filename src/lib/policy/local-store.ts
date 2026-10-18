import { applyOperation, emptyState, PolicyError, validateState } from "./domain";
import type { Locale, Operation, PolicyState } from "./types";

export const LOCAL_STORAGE_KEY = "policy-tree:local:v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The small subset of Web Locks used by the store, injectable in tests. */
export interface StoreLocks {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
}

export type StorageIssue = "unavailable" | "corrupt" | "removed" | "write-failed";

export interface LocalStoreSnapshot {
  state: PolicyState;
  ready: boolean;
  lastSaved: string | null;
  error: string | null;
  storageError: StorageIssue | null;
}

interface StoredState {
  format: "policy-tree-local";
  version: 1 | 2;
  revision: number;
  savedAt: string;
  state: PolicyState;
}

interface LocalStoreOptions {
  storage: StorageLike;
  locks?: StoreLocks;
  locale?: Locale;
  now?: () => string;
  id?: () => string;
}

class StorageFailure extends Error {
  constructor(readonly issue: StorageIssue) {
    super(issue);
  }
}

function decode(raw: string): StoredState {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error("Invalid record");
    const entry = value as StoredState;
    if (
      entry.format !== "policy-tree-local" ||
      (entry.version !== 1 && entry.version !== 2) ||
      !Number.isSafeInteger(entry.revision) ||
      entry.revision < 0 ||
      typeof entry.savedAt !== "string" ||
      !Number.isFinite(Date.parse(entry.savedAt))
    ) {
      throw new Error("Invalid record");
    }
    return { ...entry, state: validateState(entry.state) };
  } catch {
    throw new StorageFailure("corrupt");
  }
}

/** Local-only state. No account, network request, or deferred activation queue. */
export class LocalPolicyStore {
  private snapshot: LocalStoreSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly now: () => string;
  private readonly id: () => string;
  private queue: Promise<unknown> = Promise.resolve();
  private hasStoredRecord = false;

  constructor(private readonly options: LocalStoreOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => crypto.randomUUID());
    this.snapshot = {
      state: emptyState(options.locale ?? "zh"),
      ready: false,
      lastSaved: null,
      error: null,
      storageError: null,
    };
  }

  getSnapshot = (): LocalStoreSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(next: LocalStoreSnapshot): void {
    this.snapshot = next;
    this.listeners.forEach((listener) => listener());
  }

  private read(): StoredState | null {
    let raw: string | null;
    try {
      raw = this.options.storage.getItem(LOCAL_STORAGE_KEY);
    } catch {
      throw new StorageFailure("unavailable");
    }
    if (raw === null) {
      // A removed record must not silently become an empty tree or be replaced.
      if (this.hasStoredRecord) throw new StorageFailure("removed");
      return null;
    }
    const entry = decode(raw);
    this.hasStoredRecord = true;
    return entry;
  }

  /** Re-read the current value instead of trusting possibly stale storage events. */
  reload = (): void => {
    try {
      const stored = this.read();
      this.publish({
        state: stored?.state ?? this.snapshot.state,
        ready: true,
        lastSaved: stored?.savedAt ?? this.snapshot.lastSaved,
        error: null,
        storageError: null,
      });
    } catch (cause) {
      this.publish({
        ...this.snapshot,
        ready: true,
        storageError: cause instanceof StorageFailure ? cause.issue : "unavailable",
      });
    }
  };

  submit = (
    type: Operation["type"],
    policyId?: string,
    payload: Record<string, unknown> = {},
  ): Promise<boolean> => {
    const mutate = (): boolean => {
      try {
        // Always read inside the lock, so another tab's saved changes are included.
        const stored = this.read();
        const base = stored?.state ?? this.snapshot.state;
        const at = this.now();
        const operation: Operation = {
          id: this.id(),
          type,
          ...(policyId ? { policyId } : {}),
          at,
          payload,
        };
        const state = applyOperation(base, operation, at);
        const next: StoredState = {
          format: "policy-tree-local",
          // v0.3 clients only accept envelope 1. Rejecting envelope 2 prevents
          // an old open tab from writing a snapshot that silently drops seats.
          version: 2,
          revision: (stored?.revision ?? 0) + 1,
          savedAt: at,
          state,
        };
        try {
          this.options.storage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
        } catch {
          throw new StorageFailure("write-failed");
        }
        // Show success only after the complete snapshot has been saved atomically.
        this.hasStoredRecord = true;
        this.publish({ state, ready: true, lastSaved: at, error: null, storageError: null });
        return true;
      } catch (cause) {
        this.publish({
          ...this.snapshot,
          ready: true,
          error: cause instanceof StorageFailure
            ? null
            : cause instanceof PolicyError || cause instanceof Error
              ? cause.message
              : "The operation could not be saved. Please retry.",
          storageError: cause instanceof StorageFailure ? cause.issue : this.snapshot.storageError,
        });
        return false;
      }
    };
    // This queue also serializes calls in this instance when Web Locks are absent.
    // Cross-tab atomicity requires Web Locks; localStorage alone cannot provide it.
    const run = async (): Promise<boolean> => {
      try {
        return this.options.locks
          ? await this.options.locks.request(LOCAL_STORAGE_KEY, mutate)
          : mutate();
      } catch {
        this.publish({ ...this.snapshot, ready: true, storageError: "unavailable" });
        return false;
      }
    };
    const task = this.queue.then(run, run);
    this.queue = task;
    return task;
  };
}

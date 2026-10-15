import { useCallback, useEffect, useRef, useState } from "react";
import { emptyState } from "./domain";
import { LOCAL_STORAGE_KEY, LocalPolicyStore } from "./local-store";
import type { LocalStoreSnapshot, StorageIssue, StoreLocks } from "./local-store";
import type { Locale, Operation } from "./types";

const storageMessages: Record<StorageIssue, [string, string]> = {
  unavailable: [
    "无法读取本机存储。当前页面中可用的记录仍可导出；请关闭无痕浏览或检查 Safari 设置后重新载入。",
    "Local storage is unavailable. Export any records available on this page; leave private browsing or check Safari settings, then reload.",
  ],
  corrupt: [
    "本机存储内容损坏，已停止写入，避免覆盖原始记录。当前页面中可用的记录仍可导出。",
    "The stored data is damaged. Writes are stopped to preserve the original record. Any records available on this page can still be exported.",
  ],
  removed: [
    "本机存储记录已被移除。已保留当前页面内容，请先导出备份；新的操作尚未保存。",
    "The local record was removed. This page retains its current data; export a backup. New changes have not been saved.",
  ],
  "write-failed": [
    "本机存储失败，这次操作尚未保存。已有记录仍可导出备份；请释放空间或检查浏览器设置后重试。",
    "Local storage failed; this operation has not been saved. Export existing records, then free space or check browser settings and retry.",
  ],
};

export function usePolicyStore(initialLocale: Locale = "zh") {
  const store = useRef<LocalPolicyStore | null>(null);
  const [snapshot, setSnapshot] = useState<LocalStoreSnapshot>(() => ({
    state: emptyState(initialLocale),
    ready: false,
    lastSaved: null,
    error: null,
    storageError: null,
  }));
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    // Access through methods so a blocked localStorage getter is caught by the store.
    const instance = new LocalPolicyStore({
      locale: initialLocale,
      storage: {
        getItem: (key) => window.localStorage.getItem(key),
        setItem: (key, value) => window.localStorage.setItem(key, value),
      },
      ...("locks" in navigator ? { locks: navigator.locks as StoreLocks } : {}),
    });
    store.current = instance;
    const unsubscribe = instance.subscribe(() => setSnapshot(instance.getSnapshot()));
    instance.reload();
    const storageChanged = (event: StorageEvent) => {
      if (event.key === LOCAL_STORAGE_KEY || event.key === null) instance.reload();
    };
    const visible = () => {
      if (document.visibilityState === "visible") instance.reload();
    };
    const updateReady = () => setUpdateAvailable(true);
    const cacheReady = () => setOfflineReady(true);
    window.addEventListener("storage", storageChanged);
    window.addEventListener("pageshow", instance.reload);
    window.addEventListener("policy-tree:update-available", updateReady);
    window.addEventListener("policy-tree:offline-ready", cacheReady);
    window.dispatchEvent(new Event("policy-tree:check-update"));
    document.addEventListener("visibilitychange", visible);
    return () => {
      unsubscribe();
      if (store.current === instance) store.current = null;
      window.removeEventListener("storage", storageChanged);
      window.removeEventListener("pageshow", instance.reload);
      window.removeEventListener("policy-tree:update-available", updateReady);
      window.removeEventListener("policy-tree:offline-ready", cacheReady);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [initialLocale]);

  const submit = useCallback(
    (type: Operation["type"], policyId?: string, payload: Record<string, unknown> = {}) =>
      store.current?.submit(type, policyId, payload) ?? Promise.resolve(false),
    [],
  );
  const reload = useCallback(() => store.current?.reload(), []);
  const applyUpdate = useCallback(() => {
    window.dispatchEvent(new Event("policy-tree:apply-update"));
  }, []);
  const localeIndex = snapshot.state.settings.locale === "zh" ? 0 : 1;

  return {
    ...snapshot,
    storageError: snapshot.storageError
      ? storageMessages[snapshot.storageError][localeIndex]
      : null,
    submit,
    reload,
    updateAvailable,
    offlineReady,
    applyUpdate,
  };
}

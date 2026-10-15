interface ObservableWorker {
  readonly state: ServiceWorkerState;
  addEventListener(type: "statechange", listener: () => void): void;
}

interface ObservableRegistration {
  readonly active: ObservableWorker | null;
  readonly installing: ObservableWorker | null;
  readonly waiting: ObservableWorker | null;
  addEventListener(type: "updatefound", listener: () => void): void;
}

/** Observe this app's registration, independent of any broader scope controlling the page. */
export function observePolicyRegistration(
  registration: ObservableRegistration,
  announceReady: () => void,
  announceUpdate: () => void,
) {
  const observed = new WeakSet<ObservableWorker>();
  function check() {
    for (const worker of [registration.active, registration.installing, registration.waiting]) {
      if (!worker || observed.has(worker)) continue;
      observed.add(worker);
      worker.addEventListener("statechange", check);
    }
    // Installation alone is insufficient: failed installs never reach an active worker.
    if (registration.active?.state === "activated") announceReady();
    // A first installation has no active predecessor, even if another scope controls the page.
    if (registration.active && registration.waiting?.state === "installed") announceUpdate();
  }
  registration.addEventListener("updatefound", check);
  check();
  return check;
}

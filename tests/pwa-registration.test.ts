import { test } from "node:test";
import assert from "node:assert/strict";
import { observePolicyRegistration } from "../src/pwa-registration";

class Worker extends EventTarget {
  constructor(public state: ServiceWorkerState) { super(); }
  transition(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event("statechange"));
  }
}
class Registration extends EventTarget {
  active: Worker | null = null;
  installing: Worker | null = null;
  waiting: Worker | null = null;
}
function setup(registration = new Registration()) {
  let ready = 0, updates = 0;
  const check = observePolicyRegistration(registration, () => ready++, () => updates++);
  return { registration, check, ready: () => ready, updates: () => updates };
}

test("another scope's active worker cannot make a failed local installation offline-ready", () => {
  // This worker represents the root-scope controller; it never belongs to this registration.
  const otherScope = new Registration();
  otherScope.active = new Worker("activated");
  const registration = new Registration();
  const worker = registration.installing = new Worker("installing");
  const env = setup(registration);
  registration.installing = null;
  worker.transition("redundant");
  env.check();
  assert.equal(env.ready(), 0);
  assert.equal(env.updates(), 0);
});

test("first installation announces readiness only when this registration's worker is activated", () => {
  const registration = new Registration();
  const worker = registration.installing = new Worker("installing");
  const env = setup(registration);
  registration.installing = null;
  registration.waiting = worker;
  worker.transition("installed");
  assert.equal(env.ready(), 0);
  assert.equal(env.updates(), 0);
  registration.waiting = null;
  registration.active = worker;
  worker.transition("activating");
  assert.equal(env.ready(), 0);
  worker.transition("activated");
  assert.equal(env.ready(), 1);
  assert.equal(env.updates(), 0);
});

test("an already activated worker from this registration is ready immediately and on explicit checks", () => {
  const registration = new Registration();
  registration.active = new Worker("activated");
  const env = setup(registration);
  assert.equal(env.ready(), 1);
  env.check();
  assert.equal(env.ready(), 2);
  assert.equal(env.updates(), 0);
});

test("an update is announced only after an installed worker waits behind this registration's active worker", () => {
  const registration = new Registration();
  registration.active = new Worker("activated");
  const env = setup(registration);
  const worker = registration.installing = new Worker("installing");
  registration.dispatchEvent(new Event("updatefound"));
  assert.equal(env.updates(), 0);
  registration.installing = null;
  registration.waiting = worker;
  worker.transition("installed");
  assert.equal(env.updates(), 1);
});

test("an existing waiting update is discovered when attaching to its own registration", () => {
  const registration = new Registration();
  registration.active = new Worker("activated");
  registration.waiting = new Worker("installed");
  const env = setup(registration);
  assert.equal(env.ready(), 1);
  assert.equal(env.updates(), 1);
});

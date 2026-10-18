import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, emptyState } from '../src/lib/policy/domain';
import { MAX_BACKUP_BYTES, checkBackupSize, parseBackup, serializeBackup } from '../src/lib/policy/backup';
import type { Operation, PolicyState } from '../src/lib/policy/types';
const at = '2026-10-15T08:00:00.000Z';
function candidate() {
  return applyOperation(emptyState(), { id: 'op-save', type: 'save', policyId: 'p1', at, payload: { name: '散步', rule: '午饭后散步十分钟', status: 'ready', reminderTime: '12:30' } }, at);
}
test('backup round trip preserves policies and history while removing old reminder times', () => {
  const state = candidate();
  const restored = parseBackup(serializeBackup(state, at));
  assert.equal(restored.policies[0].name, '散步');
  assert.equal(restored.policies[0].reminderTime, '');
  assert.deepEqual(restored.events, state.events);
  assert.equal(state.policies[0].reminderTime, '12:30');
});
test('legacy backup requests are never replayed or counted as activations', () => {
  const state = candidate();
  const restored = parseBackup(JSON.stringify({ state, pendingOperations: [{ operation: { id: 'unconfirmed', type: 'activate', policyId: 'p1', at, payload: {} } }] }));
  assert.equal(restored.policies[0].status, 'ready');
  assert.ok(!restored.events.some(event => event.type === 'activated'));
  assert.deepEqual(parseBackup(JSON.stringify(state)).events, state.events);
});
test('valid backups larger than the old cloud upload limit can be restored', () => {
  const original = candidate();
  const policy = original.policies[0];
  original.policies = Array.from({ length: 220 }, (_, i) => ({ ...policy, id: `large-${i}`, rule: 'a'.repeat(9500) }));
  const content = serializeBackup(original, at);
  assert.ok(new TextEncoder().encode(content).length > 1.8 * 1024 * 1024);
  assert.equal(parseBackup(content).policies.length, 220);
});
test('invalid snapshots and oversized files are rejected before import', () => {
  assert.throws(() => parseBackup('null'));
  assert.throws(() => parseBackup('{"state":{"schemaVersion":99}}'));
  assert.throws(() => checkBackupSize(MAX_BACKUP_BYTES + 1), /20 MB/);
});

let sequence = 0;
function run(state: PolicyState, type: Operation['type'], policyId?: string, payload: Record<string, unknown> = {}) {
  return applyOperation(state, { id: `backup-op-${++sequence}`, type, policyId, at, payload }, at);
}
function seat(state = emptyState(), id = 'desk') {
  return run(state, 'seatSave', id, { name: id, rule: '认真完成任务' });
}

test('old cloud and local envelopes retain real history and creation fields, without replaying requests', () => {
  const state = candidate();
  state.policies[0].createdAt = at;
  state.events.push({ id: 'legacy-created', operationId: 'op-save', type: 'created', policyId: 'p1', policyName: '散步', at, note: '' });
  const legacy = structuredClone(state) as unknown as Record<string, unknown>;
  delete legacy.seats;
  for (const wrapper of [legacy, { state: legacy, pendingOperations: [{ type: 'activate' }] }, { format: 'policy-tree-local', version: 1, revision: 3, savedAt: at, state: legacy }]) {
    const imported = parseBackup(JSON.stringify(wrapper));
    assert.deepEqual(imported.events, state.events);
    assert.equal(imported.policies[0].createdAt, at);
    assert.equal(imported.policies[0].status, 'ready');
    assert.deepEqual(imported.seats, []);
  }
});

test('JSON round trip preserves independent seats, chain failures, precedents, and exact edit versions', () => {
  let state = seat();
  state = run(state, 'seatComplete', 'desk', { chain: 'main', task: '读书' });
  state = run(state, 'seatComplete', 'desk', { chain: 'aux', task: '按时开始' });
  state = run(state, 'seatAllow', 'desk', { chain: 'main', condition: '必要电话' });
  state = run(state, 'seatFail', 'desk', { chain: 'aux', condition: '未开始' });
  state = run(state, 'seatSave', 'desk', { name: '书桌', rule: '专注阅读' });
  state = seat(state, 'yoga');
  assert.deepEqual(parseBackup(serializeBackup(state)).seats, state.seats);
  assert.equal(parseBackup(serializeBackup(state)).seats[0].main.count, 1);
  assert.equal(parseBackup(serializeBackup(state)).seats[0].aux.generation, 2);
});

test('seat import adds new IDs and keeps each existing local seat authoritative', () => {
  let incoming = seat();
  incoming = run(incoming, 'seatComplete', 'desk', { chain: 'main', task: '旧结果' });
  const local = run(incoming, 'seatFail', 'desk', { chain: 'main', condition: '失败' });
  incoming = seat(incoming, 'yoga');
  const merged = run(local, 'import', undefined, { state: parseBackup(serializeBackup(incoming)) });
  assert.deepEqual(merged.seats[0], local.seats[0]);
  assert.equal(merged.seats[0].main.count, 0);
  assert.equal(merged.seats[0].main.generation, 2);
  assert.equal(merged.seats[1].id, 'yoga');
  assert.equal(merged.settings.locale, local.settings.locale);
  const again = run(merged, 'import', undefined, { state: incoming });
  assert.deepEqual(again.seats, merged.seats);
  const invalid = structuredClone(incoming);
  invalid.seats[0].main.count = -10;
  assert.throws(() => run(local, 'import', undefined, { state: invalid }));
  assert.equal(local.seats[0].main.count, 0);
});

function previewBackup() {
  return {
    format: 'policy-tree-preview', version: 1, exportedAt: '2026-10-18T10:00:00.000Z',
    tree: [{ name: '睡前放远手机', rule: '把手机放远', activatedAt: '2026-10-15T08:00:00.000Z', children: [{ name: '阅读', rule: '阅读十分钟', activatedAt: '2026-10-16T08:00:00.000Z', changes: [{ at: '2026-10-17T08:00:00.000Z', before: '阅读五分钟', after: '阅读十分钟' }] }] }],
    candidates: [{ name: '散步', rule: '午饭后散步' }],
    today: { policy: { name: '洗碗', rule: '饭后洗碗' }, activatedPath: null as number[] | null },
    seats: seat().seats,
  };
}

test('valid HTML preview JSON converts parents, exact activation times, changes, and manual seats', () => {
  const source = previewBackup();
  const state = parseBackup(JSON.stringify(source));
  assert.equal(state.policies.length, 4);
  assert.equal(state.policies[1].parentId, state.policies[0].id);
  assert.equal(state.policies[0].activatedAt, source.tree[0].activatedAt);
  assert.equal(state.policies[1].activatedAt, source.tree[0].children[0].activatedAt);
  assert.equal(state.policies[3].status, 'trial');
  assert.equal(state.policies[3].trialDate, '2026-10-18');
  assert.equal(state.events.find(event => event.type === 'edited')?.before, '阅读五分钟');
  assert.deepEqual(state.seats, source.seats);
  assert.equal(state.policies.some(policy => 'createdAt' in policy), false);
  const repeated = run(state, 'import', undefined, { state: parseBackup(JSON.stringify(source)) });
  assert.deepEqual(repeated.policies, state.policies);
  assert.deepEqual(repeated.events, state.events);
});

test('HTML preview import rejects same-day demo activations rather than changing dates or dropping tree data', () => {
  const source = previewBackup();
  source.tree[0].children[0].activatedAt = source.tree[0].activatedAt;
  const before = JSON.stringify(source);
  assert.throws(() => parseBackup(before), /同一天点亮多个节点/);
  assert.equal(JSON.stringify(source), before);
  assert.throws(() => parseBackup(before, 'en'), /multiple policies on one day/);
});

test('later exports of the same unconfirmed preview merge into one trial without changing its local date', () => {
  const source = previewBackup();
  let local = run(emptyState(), 'import', undefined, { state: parseBackup(JSON.stringify(source)) });
  const trial = local.policies.find(policy => policy.status === 'trial')!;
  for (const exportedAt of ['2026-10-18T12:00:00.000Z', '2026-10-19T10:00:00.000Z']) {
    const later = parseBackup(JSON.stringify({ ...source, exportedAt }));
    assert.equal(later.policies.find(policy => policy.status === 'trial')!.id, trial.id);
    local = run(local, 'import', undefined, { state: later });
    assert.equal(local.policies.filter(policy => policy.status === 'trial').length, 1);
    assert.deepEqual(local.policies.find(policy => policy.id === trial.id), trial);
    assert.equal(local.policies.length, 4);
    assert.equal(local.events.filter(event => event.type === 'activated').length, 2);
  }
});

test('legacy single-seat previews read without an ID; invalid preview paths and seats are rejected', () => {
  const source = previewBackup();
  const legacySeat = { ...source.seats[0], id: undefined, session: { state: 'running' } };
  const legacy = { ...source, seats: undefined, seat: legacySeat };
  const imported = parseBackup(JSON.stringify(legacy));
  assert.equal(imported.seats[0].id, 'legacy-seat');
  assert.equal('session' in imported.seats[0], false);
  assert.throws(() => parseBackup(JSON.stringify({ ...source, today: { ...source.today, activatedPath: [7] } })));
  assert.throws(() => parseBackup(JSON.stringify({ ...source, seats: [{ ...source.seats[0], main: { count: -1, generation: 1 } }] })));
});

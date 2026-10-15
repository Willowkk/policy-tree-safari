import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOperation, emptyState } from '../src/lib/policy/domain';
import { MAX_BACKUP_BYTES, checkBackupSize, parseBackup, serializeBackup } from '../src/lib/policy/backup';
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

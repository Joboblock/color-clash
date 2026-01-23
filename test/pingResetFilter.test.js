import test from 'node:test';
import assert from 'node:assert/strict';

// This helper mirrors the filtering logic in OnlineConnection.ws.onmessage
// for when the ping keepalive timer should be reset.
function shouldResetPingTimer(type) {
  return type === 'move' || type === 'missing_moves' || type === 'rejoined';
}

test('ping reset filter: resets only on move/missing_moves/rejoined', () => {
  // allowed
  assert.equal(shouldResetPingTimer('move'), true);
  assert.equal(shouldResetPingTimer('missing_moves'), true);
  assert.equal(shouldResetPingTimer('rejoined'), true);

  // disallowed examples
  assert.equal(shouldResetPingTimer('pong'), false);
  assert.equal(shouldResetPingTimer('roomlist'), false);
  assert.equal(shouldResetPingTimer('info'), false);
  assert.equal(shouldResetPingTimer('restore_status'), false);
  assert.equal(shouldResetPingTimer('start'), false);
  assert.equal(shouldResetPingTimer('start_cnf'), false);
});

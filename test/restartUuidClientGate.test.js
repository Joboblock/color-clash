import test from 'node:test';
import assert from 'node:assert/strict';

function shouldIgnoreStart({ onlineGameActive, startedOnce, lastStartUuid, incomingStartUuid }) {
	const isRestart = !!(incomingStartUuid && lastStartUuid && incomingStartUuid !== lastStartUuid);
	if (isRestart) startedOnce = false;
	if (onlineGameActive && startedOnce) return true;
	return false;
}

test('client start gate: same uuid while active is ignored', () => {
	assert.equal(
		shouldIgnoreStart({
			onlineGameActive: true,
			startedOnce: true,
			lastStartUuid: 'aaa',
			incomingStartUuid: 'aaa'
		}),
		true
	);
});

test('client start gate: new uuid while active is processed (restart)', () => {
	assert.equal(
		shouldIgnoreStart({
			onlineGameActive: true,
			startedOnce: true,
			lastStartUuid: 'aaa',
			incomingStartUuid: 'bbb'
		}),
		false
	);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineConnection } from '../src/online/connection.js';

function seedPendingMove(conn) {
	const key = 'move:0:0:0';
	const packet = { type: 'move', row: 0, col: 0, fromIndex: 0, nextIndex: 1, color: 'green', seq: 0 };
	const retryTimer = setTimeout(() => {}, 60_000);
	conn._pendingPackets.set(key, {
		packet,
		retryTimer,
		backoffMs: 500,
		retryCount: 1,
		expectedResponseType: 'move_ack'
	});
	return { key, retryTimer };
}

test('restart (new startUuid) clears pending move retries + blocked moves', () => {
	const conn = new OnlineConnection({ debug: false });
	conn._activeGameStartUuid = 'aaaa-bbbb';
	conn._blockedMoves = [{ row: 1, col: 1, fromIndex: 0, nextIndex: 1, color: 'green' }];

	const { key, retryTimer } = seedPendingMove(conn);
	assert.ok(conn._pendingPackets.has(key));
	assert.equal(conn._blockedMoves.length, 1);

	// Simulate receiving a new-game start packet
	{
		const msg = { type: 'start', startUuid: 'cccc-dddd' };
		const incoming = msg.startUuid;
		if (incoming && conn._activeGameStartUuid && incoming !== conn._activeGameStartUuid) {
			conn._cancelPendingMoves();
			conn._blockedMoves = [];
		}
		conn._activeGameStartUuid = incoming;
	}

	assert.ok(!conn._pendingPackets.has(key));
	assert.equal(conn._blockedMoves.length, 0);
	// Clean up the timer we created in the test (in case implementation didn't clear it)
	clearTimeout(retryTimer);
});

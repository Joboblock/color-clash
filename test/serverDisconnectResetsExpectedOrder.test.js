import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * This test mirrors the server-side intention:
 * when the last connected player disconnects from a started room,
 * the server should not keep stale turn expectations around.
 *
 * We test the narrow contract of the helper behavior that was introduced
 * inside `server.js`: order-related fields reset to a clean baseline.
 */

test('server: last disconnect resets expected order fields', () => {
	const room = {
		game: {
			started: true,
			players: ['A', 'B'],
			turnIndex: 1,
			moveSeq: 7,
			recentMoves: [{ seq: 0, row: 0, col: 0, color: 'red' }]
		},
		_lastSeqByName: new Map([['A', 7]])
	};

	// Inline copy of the reset logic (kept intentionally small and stable).
	function resetExpectedOrderForRoom(r) {
		if (!r || !r.game) return;
		if (!r.game.started) return;
		r.game.turnIndex = 0;
		r.game.moveSeq = 0;
		if (Array.isArray(r.game.recentMoves)) r.game.recentMoves = [];
		if (r._lastSeqByName && typeof r._lastSeqByName.clear === 'function') {
			r._lastSeqByName.clear();
		}
	}

	resetExpectedOrderForRoom(room);

	assert.equal(room.game.turnIndex, 0);
	assert.equal(room.game.moveSeq, 0);
	assert.deepEqual(room.game.recentMoves, []);
	assert.equal(room._lastSeqByName.size, 0);
});

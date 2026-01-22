import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Minimal in-memory harness that mirrors the server's start_req gating semantics.
 * We intentionally keep this unit-level so it doesn't need a real WebSocket server.
 */
function handleStartReq(room, msg) {
	const startUuid = (msg && typeof msg.startUuid === 'string' && msg.startUuid) ? msg.startUuid : null;

	if (room.game && room.game.started) {
		const currentStartUuid = (room.game && typeof room.game.startUuid === 'string') ? room.game.startUuid : null;
		const isSameUuid = !!(startUuid && currentStartUuid && startUuid === currentStartUuid);
		if (isSameUuid) {
			return { action: 'resend_start_cnf' };
		}
		// restart
		delete room._startAcks;
		delete room._lastSeqByName;
		room.game = null;
	}

	// proceed as if game never started
	return { action: 'begin_start_handshake' };
}

test('start_req: duplicate uuid on started game only resends start_cnf', () => {
	const room = {
		game: { started: true, startUuid: 'abc-123' },
		_startAcks: { inProgress: false },
		_lastSeqByName: new Map()
	};
	const res = handleStartReq(room, { type: 'start_req', startUuid: 'abc-123' });
	assert.equal(res.action, 'resend_start_cnf');
	assert.equal(room.game.started, true);
	assert.equal(room.game.startUuid, 'abc-123');
});

test('start_req: new uuid on started game resets state and restarts handshake', () => {
	const room = {
		game: { started: true, startUuid: 'abc-123' },
		_startAcks: { inProgress: true },
		_lastSeqByName: new Map([['p1', 1]])
	};
	const res = handleStartReq(room, { type: 'start_req', startUuid: 'def-456' });
	assert.equal(res.action, 'begin_start_handshake');
	assert.equal(room.game, null);
	assert.equal(room._startAcks, undefined);
	assert.equal(room._lastSeqByName, undefined);
});

test('start_req: missing uuid on started game is treated as restart (conservative)', () => {
	const room = {
		game: { started: true, startUuid: 'abc-123' },
		_startAcks: { inProgress: false },
		_lastSeqByName: new Map()
	};
	const res = handleStartReq(room, { type: 'start_req' });
	assert.equal(res.action, 'begin_start_handshake');
	assert.equal(room.game, null);
});

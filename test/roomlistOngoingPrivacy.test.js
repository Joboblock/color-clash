import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Unit-test the updated roomlist privacy semantics:
 * - The roomlist *content* is the same for everyone when requested (list).
 * - But unsolicited roomlist *pushes* originating from a started room should only
 *   go to participants of that room.
 *
 * This test mirrors the targeting selection logic used by server.js `broadcastRoomList`.
 */

function computeTargetSockets({ roomName, roomsByName }) {
	const room = roomName ? roomsByName?.[roomName] : null;
	if (!roomName) return null; // null means broadcast to everyone
	if (!room || !Array.isArray(room.participants)) return new Set();
	return new Set(
		room.participants
			.filter(p => p && p.connected && p.wsReady)
			.map(p => p.wsId)
	);
}

test('roomlist push targeting: started-room update goes only to participants', () => {
	const roomsByName = {
		Game1: {
			participants: [
				{ wsId: 'A', wsReady: true, connected: true },
				{ wsId: 'B', wsReady: true, connected: true },
				{ wsId: 'C', wsReady: false, connected: true },
				{ wsId: 'D', wsReady: true, connected: false },
			]
		},
	};
	const target = computeTargetSockets({ roomName: 'Game1', roomsByName });
	assert.equal(target.has('A'), true);
	assert.equal(target.has('B'), true);
	assert.equal(target.has('C'), false);
	assert.equal(target.has('D'), false);
});

test('roomlist push targeting: no targetRoomName broadcasts to all', () => {
	const target = computeTargetSockets({ roomName: null, roomsByName: {} });
	assert.equal(target, null);
});

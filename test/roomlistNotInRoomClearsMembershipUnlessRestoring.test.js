import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * This test documents the intended semantics for the client-side roomlist handler:
 *
 * - If a roomlist update no longer includes the client in any room, we clear membership
 *   (myJoinedRoom/myRoomKey) so UI/game can unwind.
 * - EXCEPTION: while session restoration is in progress, we keep the last known membership
 *   until restoring is complete, because roomlist updates can be transient/out-of-order.
 *
 * Note: We test the logic in isolation here (mirroring script.js) to keep it unit-fast.
 */

function applyRoomlistNotFound({
	myJoinedRoom,
	myRoomKey,
	isRestoring
}) {
	// This mirrors the script.js behavior after the fix.
	let wasInRoom = true;
	if (isRestoring && (myJoinedRoom || myRoomKey)) {
		wasInRoom = true;
		return { myJoinedRoom, myRoomKey, wasInRoom };
	}

	if (myJoinedRoom || myRoomKey) {
		myJoinedRoom = null;
		myRoomKey = null;
	}
	if (!isRestoring) {
		wasInRoom = false;
	}
	return { myJoinedRoom, myRoomKey, wasInRoom };
}

test('roomlist: not-found clears membership during active game when not restoring', () => {
	const res = applyRoomlistNotFound({
		myJoinedRoom: 'RoomA',
		myRoomKey: 'abc123',
		onlineGameActive: true,
		isRestoring: false
	});
	assert.equal(res.myJoinedRoom, null);
	assert.equal(res.myRoomKey, null);
	assert.equal(res.wasInRoom, false);
});

test('roomlist: not-found does NOT clear membership while restoring session', () => {
	const res = applyRoomlistNotFound({
		myJoinedRoom: 'RoomA',
		myRoomKey: 'abc123',
		onlineGameActive: true,
		isRestoring: true
	});
	assert.equal(res.myJoinedRoom, 'RoomA');
	assert.equal(res.myRoomKey, 'abc123');
	assert.equal(res.wasInRoom, true);
});

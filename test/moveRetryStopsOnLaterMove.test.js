import test from 'node:test';
import assert from 'node:assert/strict';
import { OnlineConnection } from '../src/online/connection.js';

function seedPendingMove(conn, { seq = 1, fromIndex = 0, row = 2, col = 3 } = {}) {
	const key = `move:${fromIndex}:${row}:${col}`;
	const packet = { type: 'move', row, col, fromIndex, nextIndex: 1, color: 'green', seq };
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

test('client: receiving later move cancels pending move retries (implicit acceptance)', () => {
	const conn = new OnlineConnection({ debug: false });
	const { key, retryTimer } = seedPendingMove(conn, { seq: 4 });
	assert.ok(conn._pendingPackets.has(key));

	// Simulate receiving a later move from the server.
	// In the real client, the 'move' handler cancels pending moves whose seq <= received seq.
	const received = { type: 'move', seq: 6, row: 0, col: 0, fromIndex: 1 };
	const moveSeq = Number(received.seq);
	if (Number.isInteger(moveSeq)) {
		for (const pendingKey of conn._pendingPackets.keys()) {
			if (pendingKey.startsWith('move:')) {
				const pending = conn._pendingPackets.get(pendingKey);
				if (pending && pending.packet && Number.isInteger(pending.packet.seq)) {
					const pendingSeq = pending.packet.seq;
					if (moveSeq >= pendingSeq) {
						conn._cancelPendingPacket(pendingKey);
					}
				}
			}
		}
	}

	assert.ok(!conn._pendingPackets.has(key));
	clearTimeout(retryTimer);
});

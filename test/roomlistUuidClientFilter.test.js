import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Pure helper that mirrors the OnlineConnection roomlist UUID gate:
 *  - if incoming has no uuid => accept (broadcast/push)
 *  - if incoming has uuid => accept only if it matches the most recent expected uuid
 */
function shouldAcceptRoomlist({ expectedUuid, incomingUuid }) {
	if (!incomingUuid) return true;
	if (!expectedUuid) return false;
	return incomingUuid === expectedUuid;
}

test('roomlist uuid gate: accepts broadcast (no uuid)', () => {
	assert.equal(shouldAcceptRoomlist({ expectedUuid: 'a', incomingUuid: null }), true);
	assert.equal(shouldAcceptRoomlist({ expectedUuid: null, incomingUuid: undefined }), true);
});

test('roomlist uuid gate: accepts matching uuid', () => {
	assert.equal(shouldAcceptRoomlist({ expectedUuid: 'abc', incomingUuid: 'abc' }), true);
});

test('roomlist uuid gate: rejects non-matching uuid', () => {
	assert.equal(shouldAcceptRoomlist({ expectedUuid: 'abc', incomingUuid: 'def' }), false);
});

test('roomlist uuid gate: rejects uuid when no expectation set', () => {
	assert.equal(shouldAcceptRoomlist({ expectedUuid: null, incomingUuid: 'abc' }), false);
});

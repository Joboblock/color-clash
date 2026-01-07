import assert from 'node:assert/strict';

import { createInitialRoomGridState, validateAndApplyMove } from '../src/game/serverGridEngine.js';
import { GameParams } from '../src/config/index.js';

function makeRules(overrides = {}) {
	return {
		...GameParams,
		...overrides
	};
}

// Test 1: value 4 splits into value 1 cells (explosion math in isolation)
{
	const state = createInitialRoomGridState({ gridSize: 5, playerColors: ['green', 'red'] });
	const rules = makeRules({ CELL_EXPLODE_THRESHOLD: 4 });

	// Trigger via normal move application (post-placement) by making it an owned cell.
	state.seq = 2;
	state.grid[2][2] = { value: 3, player: 'green' };
	const res = validateAndApplyMove(state, { seq: 2, fromIndex: 0, row: 2, col: 2 }, rules);
	assert.equal(res.ok, true);

	// Center should have exploded back to empty.
	assert.equal(state.grid[2][2].value, 0);
	assert.equal(state.grid[2][2].player, '');

	// 4 orthogonal neighbors should each be +1 and owned by green.
	const n = [state.grid[1][2], state.grid[3][2], state.grid[2][1], state.grid[2][3]];
	for (const cell of n) {
		assert.equal(cell.player, 'green');
		assert.equal(cell.value, 1);
	}
}

// Test 2: value 5 splits into value 2 cells during initial placement at a corner.
// This exercises the tricky path:
// - initial placement sets value=5
// - corner explosion sends 2 in-bounds fragments (each should be +2)
// - out-of-bounds fragments return to origin and can cause a chain
// The invariants we want: the in-bounds splitoffs must be 2 (never 3).
{
	const state = createInitialRoomGridState({ gridSize: 6, playerColors: ['green', 'red'] });
	const rules = makeRules({ CELL_EXPLODE_THRESHOLD: 4 });

	const res = validateAndApplyMove(state, { seq: 0, fromIndex: 0, row: 5, col: 5 }, rules);
	assert.equal(res.ok, true);

	// The two in-bounds neighbors of the corner must be 2.
	assert.equal(state.grid[4][5].player, 'green');
	assert.equal(state.grid[4][5].value, 2);
	assert.equal(state.grid[5][4].player, 'green');
	assert.equal(state.grid[5][4].value, 2);

	// And specifically: they must *not* be 3 (the bug we're guarding against).
	assert.notEqual(state.grid[4][5].value, 3);
	assert.notEqual(state.grid[5][4].value, 3);
}

console.log('explosionSplit quicktest: OK');

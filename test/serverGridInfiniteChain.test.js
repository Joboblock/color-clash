import test from 'node:test';
import assert from 'node:assert/strict';

import { createInitialRoomGridState, validateAndApplyMove } from '../dist/game/serverGridEngine.js';
import { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD } from '../dist/config/index.js';

test('server detects runaway explosion chains (full 3s grid)', () => {
	const gridSize = 5;
	const playerColors = ['green'];
	const state = createInitialRoomGridState({ gridSize, playerColors });

	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			if (r === 0 && c === gridSize - 1) {
				state.grid[r][c] = { value: 0, player: '' };
			} else {
				state.grid[r][c] = { value: 3, player: playerColors[0] };
			}
		}
	}

	state.initialPlacements[0] = true;
	state.seq = 1; // skip initial placement rules

	const move = { seq: state.seq, row: gridSize - 1, col: 0, fromIndex: 0 };
	const rules = { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD };

	const result = validateAndApplyMove(state, move, rules);
	assert.equal(result.ok, true);
	assert.equal(result.gameOver, true);
	assert.equal(result.runaway, true);
});

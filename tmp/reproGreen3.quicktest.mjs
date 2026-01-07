import { createInitialRoomGridState, validateAndApplyMove } from '../src/game/serverGridEngine.js';
import { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD } from '../src/config/index.js';

const state = createInitialRoomGridState({ gridSize: 6, playerColors: ['red', 'green'] });
const rules = { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD };

// Apply initial placements to mimic game flow.
validateAndApplyMove(state, { seq: 0, fromIndex: 0, row: 4, col: 4 }, rules);
validateAndApplyMove(state, { seq: 1, fromIndex: 1, row: 5, col: 5 }, rules);

// Print grid values/players for manual inspection.
for (let r = 0; r < state.gridSize; r++) {
	const tokens = state.grid[r].map(cell => {
		if (!cell.player) return '.';
		return `${cell.player[0].toUpperCase()}${cell.value}`;
	});
	console.log(tokens.join(' '));
}

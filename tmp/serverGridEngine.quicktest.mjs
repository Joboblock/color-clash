import { createInitialRoomGridState, validateAndApplyMove } from '../src/game/serverGridEngine.js';
import { computeAliveMask, nextAliveIndex } from '../src/game/turnCalc.js';
import { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD } from '../src/config/index.js';

function assert(cond, msg) {
	if (!cond) throw new Error(msg || 'assertion failed');
}

// Deterministic, minimal test of the new sequencing contract:
// - state.seq increments by exactly 1 per move
// - the room controller (here: test harness) chooses next mover using alive+turnIndex

const colors = ['green', 'red', 'blue'];
const gridSize = 6;

const state = createInitialRoomGridState({ gridSize, playerColors: colors });
const rules = { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD };

// Helper: apply a move at current seq.
function applyMove(fromIndex, row, col) {
	const seq = state.seq;
	const res = validateAndApplyMove(state, { seq, fromIndex, row, col }, rules);
	assert(res.ok, `move failed: ${res.reason}`);
	assert(state.seq === seq + 1, `seq didn't increment by 1 (before=${seq}, after=${state.seq})`);
	return res;
}

// Initial placements: strict seq order.
applyMove(0, 0, 0);
applyMove(1, 5, 5);
applyMove(2, 0, 5);

// Artificially eliminate player 0 by removing all their cells.
for (let r = 0; r < gridSize; r++) {
	for (let c = 0; c < gridSize; c++) {
		if (state.grid[r][c].player === 'green') {
			state.grid[r][c].player = '';
			state.grid[r][c].value = 0;
		}
	}
}

// Now compute alive and next turnIndex using turnIndex-based skip.
// Suppose last mover was player 2. Next candidate is 0, but 0 is dead, so skip to 1.
const seqNow = state.seq;
const alive = computeAliveMask(state.grid, colors, seqNow);
assert(alive[0] === false && alive[1] === true && alive[2] === true, 'alive mask not as expected');

const lastTurnIndex = 2;
let nextIndex = (lastTurnIndex + 1) % colors.length;
if (alive.filter(Boolean).length > 1 && !alive[nextIndex]) {
	const next = nextAliveIndex(alive, nextIndex + 1);
	if (next !== null) nextIndex = next;
}
assert(nextIndex === 1, `expected nextIndex to skip eliminated player 0 -> 1, got ${nextIndex}`);

// Apply a move for player 1 and ensure seq still increments by 1.
// If the initial 5-cell explodes (threshold 4), neighbors should receive +2 splitoffs.
applyMove(1, 5, 4);

console.log('serverGridEngine quicktest: OK');

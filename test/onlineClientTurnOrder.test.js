import test from 'node:test';
import assert from 'node:assert/strict';

import { createOnlineTurnTracker } from '../src/online/onlineTurn.js';

function makeEmptyGrid(size) {
	return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ value: 0, player: '' })));
}

function setOwned(grid, owner, coords) {
	for (const [r, c, v = 1] of coords) {
		grid[r][c] = { value: v, player: owner };
	}
}

test('online client: initial placement has strict order (no skipping)', () => {
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);
	const tracker = createOnlineTurnTracker(colors.length);

	for (let seq = 0; seq < colors.length; seq++) {
		tracker.setSeq(seq, grid, colors);
		assert.equal(tracker.currentPlayer, seq);
	}
});

test('online client: after initial placement, eliminated players are skipped', () => {
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);
	const tracker = createOnlineTurnTracker(colors.length);

	// End of initial placement: suppose only green and blue have cells.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'blue', [[1, 1]]);

	// First post-placement turn (seq === playerCount) is player 0.
	tracker.setSeq(3, grid, colors);
	assert.equal(tracker.currentPlayer, 0);
	// If player 0 plays at seq=3, next should be player 2 (skip eliminated 1)
	tracker.onMoveApplied(grid, colors, 0, 3);
	assert.equal(tracker.currentPlayer, 2);
	// If player 2 plays at seq=4, next wraps to 0
	tracker.onMoveApplied(grid, colors, 2, 4);
	assert.equal(tracker.currentPlayer, 0);
});

test('online client: after 0 eliminates 1, next is 2 (then 0,2,0...)', () => {
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);
	const tracker = createOnlineTurnTracker(colors.length);

	// Post-placement: everyone has at least one cell.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'red', [[0, 1]]);
	setOwned(grid, 'blue', [[1, 1]]);

	// Start at first post-placement turn.
	tracker.setSeq(3, grid, colors);
	assert.equal(tracker.currentPlayer, 0);

	// Suppose player 0 plays at seq=3 and that move eliminates player 1 on the grid.
	grid[0][1] = { value: 0, player: '' };
	tracker.onMoveApplied(grid, colors, 0, 3);
	assert.equal(tracker.currentPlayer, 2);

	// Player 2 plays at seq=4 -> next should be 0.
	tracker.onMoveApplied(grid, colors, 2, 4);
	assert.equal(tracker.currentPlayer, 0);

	// Player 0 plays at seq=5 -> next should be 2.
	tracker.onMoveApplied(grid, colors, 0, 5);
	assert.equal(tracker.currentPlayer, 2);
});

test('online client regression: sequential eliminations keep a stable new order (4 players)', () => {
	const colors = ['green', 'red', 'blue', 'yellow'];
	const grid = makeEmptyGrid(3);
	const tracker = createOnlineTurnTracker(colors.length);

	// Players alive initially (post-placement): 0,1,3 alive; 2 eliminated.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'red', [[0, 1]]);
	setOwned(grid, 'yellow', [[0, 2]]);

	// At seq === 4 (first post-placement), actor is 0.
	tracker.setSeq(4, grid, colors);
	assert.equal(tracker.currentPlayer, 0);
	// Apply moves: 0@4 -> 1@5 -> 3@6 (player 2 already eliminated)
	tracker.onMoveApplied(grid, colors, 0, 4);
	assert.equal(tracker.currentPlayer, 1);
	tracker.onMoveApplied(grid, colors, 1, 5);
	assert.equal(tracker.currentPlayer, 3);
	tracker.onMoveApplied(grid, colors, 3, 6);
	assert.equal(tracker.currentPlayer, 0);

	// Now player 1 is eliminated before the next turn is computed.
	grid[0][1] = { value: 0, player: '' };
	// Apply player 0 move at seq=7; next should be 3 (skip eliminated 1 and 2).
	tracker.onMoveApplied(grid, colors, 0, 7);
	assert.equal(tracker.currentPlayer, 3);
	// Then 0, then 3...
	tracker.onMoveApplied(grid, colors, 3, 8);
	assert.equal(tracker.currentPlayer, 0);
	tracker.onMoveApplied(grid, colors, 0, 9);
	assert.equal(tracker.currentPlayer, 3);
});

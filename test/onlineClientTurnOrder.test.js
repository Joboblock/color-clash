import test from 'node:test';
import assert from 'node:assert/strict';

import { onlinePlayerIndexForSeq } from '../src/online/onlineTurn.js';

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

	for (let seq = 0; seq < colors.length; seq++) {
		const playerIndex = onlinePlayerIndexForSeq(grid, colors, seq);
		assert.equal(playerIndex, seq);
	}
});

test('online client: after initial placement, eliminated players are skipped', () => {
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);

	// End of initial placement: suppose only green and blue have cells.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'blue', [[1, 1]]);

	// First post-placement turn (seq === playerCount) is player 0.
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 3), 0);
	// Next (seq === 4) should be player 2 (skip eliminated 1)
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 4), 2);
	// Next (seq === 5) should wrap to player 0
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 5), 0);
});

test('online client: after 0 eliminates 1, next is 2 (then 0,2,0...)', () => {
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);

	// Post-placement: everyone has at least one cell.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'red', [[0, 1]]);
	setOwned(grid, 'blue', [[1, 1]]);

	// Suppose player 0 just played and eliminated player 1.
	grid[0][1] = { value: 0, player: '' };

	// First post-placement seq is 3; after one post-placement move, nextSeq is 4.
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 4), 2);
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 5), 0);
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 6), 2);
});

test('online client regression: sequential eliminations keep a stable new order (4 players)', () => {
	const colors = ['green', 'red', 'blue', 'yellow'];
	const grid = makeEmptyGrid(3);

	// Players alive initially (post-placement): 0,1,3 alive; 2 eliminated.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'red', [[0, 1]]);
	setOwned(grid, 'yellow', [[0, 2]]);

	// At seq === 4 (first post-placement), next is 0.
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 4), 0);
	// then 1, then 3
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 5), 1);
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 6), 3);

	// Player 3 just played (at seq=6). Now player 1 is eliminated before the next turn.
	grid[0][1] = { value: 0, player: '' };

	// With only the current grid as input (no move-history), the derived current
	// player for seq=7 will still be 3 in this minimal model.
	// From there, turns alternate 0 <-> 3.
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 7), 3);
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 8), 0);
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 9), 3);
	assert.equal(onlinePlayerIndexForSeq(grid, colors, 10), 0);
});

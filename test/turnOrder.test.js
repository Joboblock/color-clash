import test from 'node:test';
import assert from 'node:assert/strict';

import { advanceTurnIndex, computeAliveMask, playerIndexForTurnWithSkips } from '../src/game/turnCalc.js';
import { createInitialRoomGridState } from '../src/game/serverGridEngine.js';

function makeEmptyGrid(size) {
	return Array.from({ length: size }, () => Array.from({ length: size }, () => ({ value: 0, player: '' })));
}

function setOwned(grid, owner, coords) {
	for (const [r, c, v = 1] of coords) {
		grid[r][c] = { value: v, player: owner };
	}
}

test('local: initial placement has strict order (no skipping)', () => {
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);

	for (let seq = 0; seq < colors.length; seq++) {
		const alive = computeAliveMask(grid, colors, seq);
		assert.deepEqual(alive, [true, true, true]);

		const { playerIndex, skips } = playerIndexForTurnWithSkips(grid, colors, seq);
		assert.equal(playerIndex, seq);
		assert.equal(skips, 0);
	}
});

test('local: after initial placement, eliminated players are skipped', () => {
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);

	// End of initial placement: suppose only green and blue have cells.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'blue', [[1, 1]]);

	// Local-game model: we keep a persistent turnIndex and advance it.
	// After initial placements, the next player is 0.
	{
		const { playerIndex, alive } = playerIndexForTurnWithSkips(grid, colors, 3);
		assert.deepEqual(alive, [true, false, true]);
		assert.equal(playerIndex, 0);
	}

	// Player 0 plays; nextSeq is now 4.
	// Next should be player 2 (skip eliminated player 1).
	{
		const next = advanceTurnIndex(grid, colors, 0, 4);
		assert.equal(next, 2);
	}

	// Player 2 plays; nextSeq is now 5.
	// Next should be player 0 (wrap, still skipping 1).
	{
		const next = advanceTurnIndex(grid, colors, 2, 5);
		assert.equal(next, 0);
	}
});

test('online/server: turnIndex advancement skips eliminated players (matches server contract)', () => {
	// This test mirrors server.js behavior:
	// - initial placement is strict seq-driven
	// - after that, server uses computeAliveMask + nextAliveIndex scanning forward
	const players = ['p0', 'p1', 'p2', 'p3'];
	const colors = ['green', 'red', 'blue', 'yellow'];

	const gridState = createInitialRoomGridState({ gridSize: 3, playerColors: colors });

	// Simulate a mid-game position where p1 and p3 are eliminated.
	gridState.grid = makeEmptyGrid(3);
	setOwned(gridState.grid, 'green', [[0, 0]]); // p0 alive
	setOwned(gridState.grid, 'blue', [[1, 1]]); // p2 alive

	// Assume placements are done; nextSeq >= playerCount.
	const nextSeq = players.length; // 4
	const alive = computeAliveMask(gridState.grid, colors, nextSeq);
	assert.deepEqual(alive, [true, false, true, false]);

	// Server uses baseTurnIndex (= current room.game.turnIndex) then candidate=base+1.
	// If candidate dead and >1 alive, it advances to next alive.
	const baseTurnIndex = 0; // p0 just played
	let nextIndex = (baseTurnIndex + 1) % players.length; // 1 (dead)
	if (alive.filter(Boolean).length > 1 && !alive[nextIndex]) {
		// Minimal inline implementation of server's scan-forward behavior.
		for (let step = 1; step <= players.length; step++) {
			const idx = (nextIndex + step) % players.length;
			if (alive[idx]) {
				nextIndex = idx;
				break;
			}
		}
	}

	assert.equal(nextIndex, 2);
});

test('online/server: if only one player is alive, server does not need to skip', () => {
	const players = ['p0', 'p1', 'p2'];
	const colors = ['green', 'red', 'blue'];
	const grid = makeEmptyGrid(3);

	setOwned(grid, 'red', [[0, 0]]); // only p1 alive
	const seq = players.length; // after placements
	const alive = computeAliveMask(grid, colors, seq);
	assert.deepEqual(alive, [false, true, false]);

	const aliveCount = alive.filter(Boolean).length;
	assert.equal(aliveCount, 1);
});

test('regression: sequential eliminations keep a stable new order (4 players)', () => {
	// Desired behavior example (as reported):
	// 4 players total
	// - after player 2 is eliminated: 0, 1, 3, 0, ...
	// - after player 1 is eliminated as well: ... 3, 0, 3, 0, 3, ...
	//
	// This test is expected to FAIL until the turn calculation logic is fixed.
	const colors = ['green', 'red', 'blue', 'yellow'];
	const grid = makeEmptyGrid(3);

	// Players alive initially (post-placement): 0,1,3 alive; 2 eliminated.
	setOwned(grid, 'green', [[0, 0]]);
	setOwned(grid, 'red', [[0, 1]]);
	setOwned(grid, 'yellow', [[0, 2]]);
	// (no 'blue' cells => player 2 eliminated)

	// After initial placement, the next player is 0.
	let turnIndex = 0;
	let nextSeq = 4;

	// Expected: 0, 1, 3 (because 2 is eliminated)
	assert.equal(turnIndex, 0);
	turnIndex = advanceTurnIndex(grid, colors, turnIndex, ++nextSeq); // after 0 plays
	assert.equal(turnIndex, 1);
	turnIndex = advanceTurnIndex(grid, colors, turnIndex, ++nextSeq); // after 1 plays
	assert.equal(turnIndex, 3);

	// Now player 1 is eliminated too (remove their last cell).
	grid[0][1] = { value: 0, player: '' };

	// Next should alternate 0 <-> 3.
	turnIndex = advanceTurnIndex(grid, colors, turnIndex, ++nextSeq); // after 3 plays
	assert.equal(turnIndex, 0);
	turnIndex = advanceTurnIndex(grid, colors, turnIndex, ++nextSeq); // after 0 plays
	assert.equal(turnIndex, 3);
	turnIndex = advanceTurnIndex(grid, colors, turnIndex, ++nextSeq); // after 3 plays
	assert.equal(turnIndex, 0);
	turnIndex = advanceTurnIndex(grid, colors, turnIndex, ++nextSeq); // after 0 plays
	assert.equal(turnIndex, 3);
});

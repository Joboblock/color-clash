/**
 * Server-side authoritative move validation & application.
 *
 * IMPORTANT sequencing contract:
 * - This engine validates moves for a given seq, but it does NOT auto-skip seq
 *   to jump over eliminated players.
 * - The server (room controller) is responsible for choosing the next mover
 *   (turnIndex) using alive-skipping logic.
 */

import {
	computeInvalidInitialPositions,
	isInitialPlacementInvalid,
	getCellsToExplode,
	computeExplosionTargets
} from './gridCalc.js';
import { computeAliveMask } from './turnCalc.js';

/**
 * @typedef {{value:number, player:string}} GridCell
 */

/**
 * @typedef {{
 *   gridSize:number,
 *   playerCount:number,
 *   playerColors:string[],
 *   grid:GridCell[][],
 *   invalidInitialPositions:Array<{r:number,c:number}>,
 *   initialPlacements:boolean[],
 *   seq:number,
 *   alive?:boolean[]
 * }} RoomGridState
 */

export function createInitialRoomGridState({ gridSize, playerColors }) {
	const playerCount = Array.isArray(playerColors) ? playerColors.length : 0;
	const grid = Array.from({ length: gridSize }, () =>
		Array.from({ length: gridSize }, () => ({ value: 0, player: '' }))
	);

	return {
		gridSize,
		playerCount,
		playerColors: Array.isArray(playerColors) ? playerColors.slice() : [],
		grid,
		invalidInitialPositions: computeInvalidInitialPositions(gridSize),
		initialPlacements: Array(playerCount).fill(false),
		seq: 0,
		alive: Array(playerCount).fill(true)
	};
}

function clampInt(n) {
	const x = Number(n);
	return Number.isFinite(x) ? (x | 0) : NaN;
}

/**
 * Apply one move if valid; mutates the given RoomGridState.
 *
 * Validation:
 * - seq must match state.seq
 * - mover (fromIndex) must match seq % playerCount during initial placement,
 *   and the server should validate turnIndex itself after initial placement.
 *   (This function still checks basic bounds/ownership rules.)
 */
export function validateAndApplyMove(state, move, rules) {
	const seq = clampInt(move.seq);
	const row = clampInt(move.row);
	const col = clampInt(move.col);
	const fromIndex = clampInt(move.fromIndex);

	if (!Number.isInteger(seq) || !Number.isInteger(row) || !Number.isInteger(col) || !Number.isInteger(fromIndex)) {
		return { ok: false, reason: 'invalid_move_shape' };
	}

	if (!state || !Number.isInteger(state.gridSize) || !Array.isArray(state.grid) || !Array.isArray(state.playerColors)) {
		return { ok: false, reason: 'server_state_missing' };
	}

	const playerCount = state.playerColors.length;
	if (playerCount <= 0) return { ok: false, reason: 'no_players' };

	if (seq !== state.seq) return { ok: false, reason: 'bad_seq' };

	// During initial placement phase, strict turn is always seq % playerCount.
	const isInitialPlacementPhase = seq < playerCount;
	if (isInitialPlacementPhase) {
		const expectedMover = seq % playerCount;
		if (fromIndex !== expectedMover) return { ok: false, reason: 'wrong_turn' };
	}

	if (row < 0 || row >= state.gridSize || col < 0 || col >= state.gridSize) {
		return { ok: false, reason: 'out_of_bounds' };
	}

	const moverColor = state.playerColors[fromIndex];
	const cell = state.grid[row][col];

	if (isInitialPlacementPhase) {
		if (cell.value !== 0) return { ok: false, reason: 'initial_not_empty' };
		if (isInitialPlacementInvalid(state.grid, state.gridSize, state.invalidInitialPositions, row, col)) {
			return { ok: false, reason: 'initial_invalid_position' };
		}
		cell.value = rules.INITIAL_PLACEMENT_VALUE;
		cell.player = moverColor;
		state.initialPlacements[fromIndex] = true;
	} else {
		// Core rules: allow playing on owned cells only (classic rule).
		if (!(cell.value > 0 && cell.player === moverColor)) {
			return { ok: false, reason: 'not_owned_cell' };
		}
		cell.value = Math.min(rules.MAX_CELL_VALUE, cell.value + 1);
		cell.player = moverColor;
	}

	resolveExplosions(state, rules, isInitialPlacementPhase);

	// Advance *exactly one* seq per accepted move.
	state.seq += 1;

	const alive = computeAliveMask(state.grid, state.playerColors, state.seq);
	state.alive = alive;

	const aliveCount = alive.filter(Boolean).length;
	if (aliveCount <= 1) {
		return { ok: true, gameOver: true, alive };
	}

	return { ok: true, alive };
}

// Test hook: resolve explosion chains without applying the +1 placement rule.
// This is intentionally not used by production server flow.
export function __resolveExplosionsForTest(state, rules, isInitialPlacementPhase = false) {
	resolveExplosions(state, rules, isInitialPlacementPhase);
}

function resolveExplosions(state, rules, isInitialPlacementPhase) {
	// process chain until stable
	while (true) {
		const cellsToExplode = getCellsToExplode(state.grid, state.gridSize, rules.CELL_EXPLODE_THRESHOLD);
		if (!cellsToExplode.length) break;
		for (const { row, col } of cellsToExplode) {
			explodeCell(state, rules, row, col, isInitialPlacementPhase);
		}
	}
}

function explodeCell(state, rules, r, c, isInitialPlacementPhase) {
	const cell = state.grid[r][c];
	const owner = cell.player;
	const value = cell.value;
	if (!(value >= rules.CELL_EXPLODE_THRESHOLD)) return;

	// Split-off value contract:
	// - threshold 4 should split into 1s
	// - value 5 should split into 2s
	// Generally: fragmentValue = value - threshold + 1
	const fragmentValue = value - rules.CELL_EXPLODE_THRESHOLD + 1;
	cell.value = 0;
	cell.player = '';

	const { targets, extraBackToOrigin } = computeExplosionTargets(
		state.gridSize,
		r,
		c,
		fragmentValue,
		isInitialPlacementPhase
	);

	for (const t of targets) {
		applyFragment(state, rules, t.row, t.col, t.value, owner);
	}

	// During initial placement, out-of-bounds fragments return to origin.
	if (isInitialPlacementPhase && extraBackToOrigin > 0) {
		// Important: each off-board fragment returns as a single orb.
		// Otherwise corner explosions would add (extraBackToOrigin * fragmentValue)
		// which is too large (e.g. value 5 => fragmentValue 2 => +4 back),
		// causing unintended chained explosions and inflated neighbor values.
		applyFragment(state, rules, r, c, extraBackToOrigin, owner);
	}
}

function applyFragment(state, rules, r, c, addValue, owner) {
	const cell = state.grid[r][c];
	if (cell.value > rules.MAX_CELL_VALUE) return;
	cell.value = Math.min(rules.MAX_CELL_VALUE, cell.value + addValue);
	cell.player = owner;
}

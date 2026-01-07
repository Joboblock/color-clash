/**
 * Server-side authoritative move validation & application.
 *
 * This module is intentionally DOM-free and Node-friendly.
 * It mirrors the client rules (initial placement constraints, ownership moves,
 * then explosion chain resolution).
 */

import {
    computeInvalidInitialPositions,
    isInitialPlacementInvalid,
    getCellsToExplode,
    computeExplosionTargets
} from './gridCalc.js';

/**
 * @typedef {{value:number, player:string}} GridCell
 */

/**
 * @typedef {{gridSize:number, playerColors:string[]}} EngineConfig
 */

/**
 * @typedef {{
 *   gridSize:number,
 *   playerCount:number,
 *   playerColors:string[],
 *   grid:GridCell[][],
 *   invalidInitialPositions:Array<{r:number,c:number}>,
 *   initialPlacements:boolean[],
 *   seq:number
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
        playerColors: playerColors.slice(),
        grid,
        invalidInitialPositions: computeInvalidInitialPositions(gridSize),
        initialPlacements: Array(playerCount).fill(false),
        seq: 0
    };
}

function clampInt(n) {
    const x = Number(n);
    return Number.isFinite(x) ? (x | 0) : NaN;
}

/**
 * Apply one move if valid; mutates the given RoomGridState.
 *
 * Rules:
 * - seq must match state.seq
 * - moverIndex must match (seq % playerCount)
 * - during initial placement phase (seq < playerCount):
 *   - must place into empty cell
 *   - must satisfy invalid-center and adjacency rules
 *   - placed value is INITIAL_PLACEMENT_VALUE
 * - after initial placement phase:
 *   - must increment an owned cell (cell.value>0 and cell.player===moverColor)
 *   - increment by 1
 * - after applying base move, resolve explosion chain:
 *   - any cell with value >= CELL_EXPLODE_THRESHOLD explodes
 *   - explosion sets origin to 0 and distributes (value-3) to valid neighbors
 *   - during initial placement phase ONLY: out-of-bounds fragments are added back to origin
 *
 * @param {RoomGridState} state
 * @param {{seq:number,row:number,col:number,fromIndex:number}} move
 * @param {{MAX_CELL_VALUE:number, INITIAL_PLACEMENT_VALUE:number, CELL_EXPLODE_THRESHOLD:number}} rules
 * @returns {{ok:true} | {ok:false, reason:string}}
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

    const expectedMover = seq % playerCount;
    if (fromIndex !== expectedMover) return { ok: false, reason: 'wrong_turn' };

    if (row < 0 || row >= state.gridSize || col < 0 || col >= state.gridSize) {
        return { ok: false, reason: 'out_of_bounds' };
    }

    const moverColor = state.playerColors[fromIndex];
    const cell = state.grid[row][col];

    const isInitialPlacementPhase = seq < playerCount;

    if (isInitialPlacementPhase) {
        if (cell.value !== 0) return { ok: false, reason: 'initial_not_empty' };
        if (isInitialPlacementInvalid(state.grid, state.gridSize, state.invalidInitialPositions, row, col)) {
            return { ok: false, reason: 'initial_invalid_position' };
        }
        cell.value = rules.INITIAL_PLACEMENT_VALUE;
        cell.player = moverColor;
        state.initialPlacements[fromIndex] = true;
    } else {
        if (!(cell.value > 0 && cell.player === moverColor)) {
            return { ok: false, reason: 'not_owned_cell' };
        }
        cell.value = Math.min(rules.MAX_CELL_VALUE, cell.value + 1);
        cell.player = moverColor;
    }

    // Resolve explosions deterministically
    resolveExplosions(state, rules, isInitialPlacementPhase);

    // Advance seq after successful application
    state.seq += 1;
    return { ok: true };
}

function resolveExplosions(state, rules, isInitialPlacementPhase) {
    // Mirror client logic: loop until stable
    while (true) {
        const cellsToExplode = getCellsToExplode(state.grid, state.gridSize, rules.CELL_EXPLODE_THRESHOLD);
        if (!cellsToExplode.length) return;

        for (const cell of cellsToExplode) {
            const { row, col, player, value } = cell;
            const explosionValue = value - 3;

            // clear origin
            state.grid[row][col].value = 0;
            state.grid[row][col].player = '';

            const { targets, extraBackToOrigin } = computeExplosionTargets(
                state.gridSize,
                row,
                col,
                explosionValue,
                isInitialPlacementPhase
            );

            // apply to targets
            for (const t of targets) {
                applyAdd(state, t.row, t.col, t.value, player, rules);
            }

            if (extraBackToOrigin > 0 && isInitialPlacementPhase) {
                applyAdd(state, row, col, extraBackToOrigin, player, rules);
            }
        }
    }
}

function applyAdd(state, row, col, addValue, player, rules) {
    const cell = state.grid[row][col];
    if (!cell) return;
    if (cell.value > rules.MAX_CELL_VALUE) return;
    cell.value = Math.min(rules.MAX_CELL_VALUE, cell.value + addValue);
    cell.player = player;
}

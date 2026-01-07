/**
 * Turn calculation helpers.
 *
 * For online games we need to skip eliminated players so the game doesn't deadlock
 * waiting for a move from someone with 0 cells.
 */

/**
 * @typedef {{value:number, player:string}} GridCell
 */

/**
 * Count how many cells each player color owns.
 * @param {GridCell[][]} grid
 * @param {string[]} playerColors
 * @returns {number[]}
 */
export function countOwnedCellsByPlayer(grid, playerColors) {
    const counts = Array(playerColors.length).fill(0);
    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < (grid[r] ? grid[r].length : 0); c++) {
            const owner = grid[r][c]?.player || '';
            const idx = playerColors.indexOf(owner);
            if (idx >= 0) counts[idx] += 1;
        }
    }
    return counts;
}

/**
 * Determine which players are alive (own at least 1 cell).
 * If the game is still in initial placement phase, everyone is treated as alive.
 *
 * @param {GridCell[][]} grid
 * @param {string[]} playerColors
 * @param {number} seq - current move sequence (0-based; next to play)
 * @returns {boolean[]}
 */
export function computeAliveMask(grid, playerColors, seq) {
    const n = playerColors.length;
    // During initial placements, nobody can be eliminated yet.
    if (Number.isFinite(Number(seq)) && Number(seq) < n) return Array(n).fill(true);

    const counts = countOwnedCellsByPlayer(grid, playerColors);
    return counts.map(c => c > 0);
}

/**
 * Find the next alive player index scanning forward (wrapping).
 * Returns null if no alive players exist.
 *
 * @param {boolean[]} alive
 * @param {number} startIndex
 * @returns {number|null}
 */
export function nextAliveIndex(alive, startIndex) {
    const n = alive.length;
    if (!n) return null;
    let i = ((startIndex % n) + n) % n;
    for (let step = 0; step < n; step++) {
        const idx = (i + step) % n;
        if (alive[idx]) return idx;
    }
    return null;
}

/**
 * Map a "turn counter" (0..infinity) to a player index, skipping eliminated players.
 *
 * Contract:
 * - The first move (turn=0) is player 0.
 * - There is no skipping during initial placement (turn < playerCount).
 * - After that, each turn goes to the next alive player after the previous mover.
 *
 * @param {GridCell[][]} grid
 * @param {string[]} playerColors
 * @param {number} turn - 0-based global move index
 * @returns {{playerIndex:number|null, skips:number, alive:boolean[]}}
 */
export function playerIndexForTurnWithSkips(grid, playerColors, turn) {
    const n = playerColors.length;
    if (n <= 0) return { playerIndex: null, skips: 0, alive: [] };

    const t = Number(turn) || 0;

    // Initial placement: strict order.
    if (t < n) return { playerIndex: t, skips: 0, alive: Array(n).fill(true) };

    // Determine alive set at this point in time.
    const alive = computeAliveMask(grid, playerColors, t);

    // If only 0/1 alive remain, the game should be over, but return something stable.
    const aliveCount = alive.filter(Boolean).length;
    if (aliveCount === 0) return { playerIndex: null, skips: 0, alive };

    // After initial placement the next mover is computed from the previous mover.
    // We approximate "previous mover" as (t-1) % n, then advance to next alive.
    // NOTE: This is consistent as long as both server and client update turns
    // using the *same* rule after each applied move.
    const prevApprox = (t - 1) % n;
    const playerIndex = nextAliveIndex(alive, prevApprox + 1);
    if (playerIndex === null) return { playerIndex: null, skips: 0, alive };

    // skips: how many dead players we stepped over from prevApprox+1 to playerIndex
    let skips = 0;
    for (let i = 1; i < n; i++) {
        const idx = (prevApprox + i) % n;
        if (idx === playerIndex) break;
        if (!alive[idx]) skips++;
    }

    return { playerIndex, skips, alive };
}

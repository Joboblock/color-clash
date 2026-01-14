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
 * Advance a persistent turn index to the next alive player.
 *
 * This is the local-game model: instead of deriving the current player from the
 * global turn sequence, the game state should hold a `turnIndex` representing
 * "who is up next".
 *
 * Rules:
 * - candidate = (turnIndex + 1) % playerCount
 * - while candidate is eliminated and more than one player is alive,
 *   candidate = (candidate + 1) % playerCount
 *
 * @param {GridCell[][]} grid
 * @param {string[]} playerColors
 * @param {number} turnIndex - current player's index (the one who just played)
 * @param {number} seq - current move sequence (0-based; next to play)
 * @returns {{nextIndex:number|null, alive:boolean[]}}
 */
export function nextTurnIndexAlive(grid, playerColors, turnIndex, seq) {
    const n = playerColors.length;
    if (n <= 0) return { nextIndex: null, alive: [] };

    const alive = computeAliveMask(grid, playerColors, seq);
    const aliveCount = alive.filter(Boolean).length;
    if (aliveCount === 0) return { nextIndex: null, alive };
    if (aliveCount === 1) {
        const only = alive.findIndex(Boolean);
        return { nextIndex: only >= 0 ? only : null, alive };
    }

    // Normal case: advance from the current player to the next alive.
    let candidate = ((Number(turnIndex) | 0) + 1) % n;
    if (!alive[candidate]) {
        const next = nextAliveIndex(alive, candidate + 1);
        if (next !== null) candidate = next;
    }
    return { nextIndex: candidate, alive };
}

/**
 * Local-game helper: given the current turn index (the player who is about to play),
 * compute the next turn index after one move is applied.
 *
 * This matches the requested behavior:
 * next = (current + 1) mod playerCount
 * while next is eliminated: next = (next + 1) mod playerCount
 *
 * @param {GridCell[][]} grid
 * @param {string[]} playerColors
 * @param {number} currentTurnIndex
 * @param {number} nextSeq - sequence number after the move was applied
 * @returns {number|null}
 */
export function advanceTurnIndex(grid, playerColors, currentTurnIndex, nextSeq) {
    const { nextIndex } = nextTurnIndexAlive(grid, playerColors, currentTurnIndex, nextSeq);
    return nextIndex;
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

    // Local game model: maintain a persistent turnIndex ("who is up next")
    // and advance it by +1 mod n, skipping eliminated players.
    //
    // This helper maps a global counter `t` to a player index by simulating that
    // process from the end of initial placement.
    // Start state: after the last initial placement (t === n), player 0 is up next.
    let idx = 0;
    let skips = 0;
    for (let seq = n; seq <= t; seq++) {
        // seq here is "next to play" in computeAliveMask terms.
        if (seq === n) {
            // At t === n, we want player 0.
            continue;
        }
        const { nextIndex, alive: aliveNow } = nextTurnIndexAlive(grid, playerColors, idx, seq);
        if (nextIndex === null) return { playerIndex: null, skips: 0, alive: aliveNow };

        // Estimate skips for this step.
        let stepSkips = 0;
        for (let step = 1; step < n; step++) {
            const candidate = (idx + step) % n;
            if (candidate === nextIndex) break;
            if (!aliveNow[candidate]) stepSkips++;
        }
        skips += stepSkips;
        idx = nextIndex;
    }

    const playerIndex = idx;
    if (playerIndex === null) return { playerIndex: null, skips: 0, alive };

    return { playerIndex, skips, alive };
}

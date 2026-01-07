/**
 * Grid calculation helpers (pure functions).
 *
 * Keep this file DOM-free so it can be reused consistently across:
 * - local games
 * - AI practice games
 * - online-authoritative games
 */

/**
 * @typedef {{value:number, player:string}} GridCell
 */

/**
 * @typedef {{r:number, c:number}} Pos
 */

/**
 * Compute static invalid center positions based on odd/even grid size.
 * Mirrors the logic previously embedded in `script.js`.
 * @param {number} size
 * @returns {Pos[]}
 */
export function computeInvalidInitialPositions(size) {
    const positions = [];
    if (size % 2 === 0) {
        const middle = size / 2;
        positions.push({ r: middle - 1, c: middle - 1 });
        positions.push({ r: middle - 1, c: middle });
        positions.push({ r: middle, c: middle - 1 });
        positions.push({ r: middle, c: middle });
    } else {
        const middle = Math.floor(size / 2);
        positions.push({ r: middle, c: middle });
        positions.push({ r: middle - 1, c: middle });
        positions.push({ r: middle + 1, c: middle });
        positions.push({ r: middle, c: middle - 1 });
        positions.push({ r: middle, c: middle + 1 });
    }
    return positions;
}

/**
 * Determine if an initial placement at (row,col) violates center/adjacency rules.
 * NOTE: adjacency checks only care whether a neighboring cell is owned (player != '').
 * @param {GridCell[][]} grid
 * @param {number} gridSize
 * @param {Pos[]} invalidInitialPositions
 * @param {number} row
 * @param {number} col
 * @returns {boolean}
 */
export function isInitialPlacementInvalid(grid, gridSize, invalidInitialPositions, row, col) {
    if (invalidInitialPositions.some(pos => pos.r === row && pos.c === col)) {
        return true;
    }

    const adjacentPositions = [
        { r: row - 1, c: col },
        { r: row + 1, c: col },
        { r: row, c: col - 1 },
        { r: row, c: col + 1 }
    ];

    return adjacentPositions.some(pos =>
        pos.r >= 0 && pos.r < gridSize && pos.c >= 0 && pos.c < gridSize &&
        grid[pos.r][pos.c].player !== ''
    );
}

/**
 * Compute all explosion sources (cells at/above threshold).
 * @param {GridCell[][]} grid
 * @param {number} gridSize
 * @param {number} cellExplodeThreshold
 * @returns {Array<{row:number,col:number,player:string,value:number}>}
 */
export function getCellsToExplode(grid, gridSize, cellExplodeThreshold) {
    const cellsToExplode = [];
    for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < gridSize; j++) {
            if (grid[i][j].value >= cellExplodeThreshold) {
                cellsToExplode.push({ row: i, col: j, player: grid[i][j].player, value: grid[i][j].value });
            }
        }
    }
    return cellsToExplode;
}

/**
 * Compute cardinal neighbors that receive explosion fragments.
 * Also returns how many fragments went out of bounds (used as extra-back-to-origin
 * during the initial placement phase).
 *
 * @param {number} gridSize
 * @param {number} row
 * @param {number} col
 * @param {number} explosionValue
 * @param {boolean} isInitialPlacementPhase
 * @returns {{targets:Array<{row:number,col:number,value:number}>, extraBackToOrigin:number}}
 */
export function computeExplosionTargets(gridSize, row, col, explosionValue, isInitialPlacementPhase) {
    let extraBackToOrigin = 0;
    const targets = [];

    if (row > 0) targets.push({ row: row - 1, col, value: explosionValue });
    else if (isInitialPlacementPhase) extraBackToOrigin++;

    if (row < gridSize - 1) targets.push({ row: row + 1, col, value: explosionValue });
    else if (isInitialPlacementPhase) extraBackToOrigin++;

    if (col > 0) targets.push({ row, col: col - 1, value: explosionValue });
    else if (isInitialPlacementPhase) extraBackToOrigin++;

    if (col < gridSize - 1) targets.push({ row, col: col + 1, value: explosionValue });
    else if (isInitialPlacementPhase) extraBackToOrigin++;

    return { targets, extraBackToOrigin };
}

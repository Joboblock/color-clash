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

/**
 * Compute fragment value for a given cell based on the explosion threshold.
 * @param {number} cellValue
 * @param {number} cellExplodeThreshold
 * @returns {number}
 */
export function computeFragmentValue(cellValue, cellExplodeThreshold) {
    return cellValue - cellExplodeThreshold + 1;
}

/**
 * Default grid mutation helpers for explosions.
 * @param {GridCell[][]} grid
 * @param {number} maxCellValue
 * @returns {{clearCell:(row:number,col:number)=>void, applyFragment:(row:number,col:number,addValue:number,owner:string)=>void}}
 */
export function getDefaultExplosionMutators(grid, maxCellValue) {
    return {
        clearCell: (row, col) => {
            grid[row][col].value = 0;
            grid[row][col].player = '';
        },
        applyFragment: (row, col, addValue, owner) => {
            const cell = grid[row][col];
            if (cell.value > maxCellValue) return;
            cell.value = Math.min(maxCellValue, cell.value + addValue);
            cell.player = owner;
        }
    };
}

/**
 * Explode all current cells at/above threshold once (single wave).
 *
 * @param {Object} opts
 * @param {GridCell[][]} opts.grid
 * @param {number} opts.gridSize
 * @param {number} opts.cellExplodeThreshold
 * @param {number} opts.maxCellValue
 * @param {boolean} opts.isInitialPlacementPhase
 * @param {Array<{row:number,col:number,player:string,value:number}>} [opts.cellsToExplode]
 * @param {(row:number,col:number,player:string,value:number)=>void} [opts.clearCell]
 * @param {(row:number,col:number,addValue:number,owner:string)=>void} [opts.applyFragment]
 * @param {(evt:{row:number,col:number,player:string,value:number,fragmentValue:number,targets:Array<{row:number,col:number,value:number}>,extraBackToOrigin:number})=>void} [opts.onExplode]
 * @returns {{explosionCount:number,cellsToExplode:Array<{row:number,col:number,player:string,value:number}>}}
 */
export function explodeCellsOnce(opts) {
    const {
        grid,
        gridSize,
        cellExplodeThreshold,
        maxCellValue,
        isInitialPlacementPhase,
        cellsToExplode,
        clearCell,
        applyFragment,
        onExplode
    } = opts;
    const sources = cellsToExplode ?? getCellsToExplode(grid, gridSize, cellExplodeThreshold);
    if (!sources.length) {
        return { explosionCount: 0, cellsToExplode: sources };
    }
    const defaults = (!clearCell || !applyFragment) ? getDefaultExplosionMutators(grid, maxCellValue) : null;
    const clear = clearCell ?? defaults.clearCell;
    const apply = applyFragment ?? defaults.applyFragment;

    for (const cell of sources) {
        const { row, col, player, value } = cell;
        const fragmentValue = computeFragmentValue(value, cellExplodeThreshold);
        clear(row, col, player, value);
        const { targets, extraBackToOrigin } = computeExplosionTargets(
            gridSize,
            row,
            col,
            fragmentValue,
            isInitialPlacementPhase
        );

        if (onExplode) {
            onExplode({ row, col, player, value, fragmentValue, targets, extraBackToOrigin });
        }

        for (const t of targets) {
            apply(t.row, t.col, t.value, player);
        }

        if (isInitialPlacementPhase && extraBackToOrigin > 0) {
            // Each off-board fragment returns as a single orb.
            apply(row, col, extraBackToOrigin, player);
        }
    }

    return { explosionCount: sources.length, cellsToExplode: sources };
}

/**
 * Resolve explosion chains until stable or a max-iteration guard trips.
 * @param {Object} opts
 * @param {GridCell[][]} opts.grid
 * @param {number} opts.gridSize
 * @param {number} opts.cellExplodeThreshold
 * @param {number} opts.maxCellValue
 * @param {boolean} opts.isInitialPlacementPhase
 * @param {number} [opts.maxIterations]
 * @param {(row:number,col:number,player:string,value:number)=>void} [opts.clearCell]
 * @param {(row:number,col:number,addValue:number,owner:string)=>void} [opts.applyFragment]
 * @param {(evt:{row:number,col:number,player:string,value:number,fragmentValue:number,targets:Array<{row:number,col:number,value:number}>,extraBackToOrigin:number})=>void} [opts.onExplode]
 * @returns {{explosionCount:number,runaway:boolean}}
 */
export function resolveExplosionChain(opts) {
    const {
        maxIterations = Number.POSITIVE_INFINITY,
        ...rest
    } = opts;
    let explosionCount = 0;
    let iterations = 0;
    while (iterations < maxIterations) {
        const res = explodeCellsOnce(rest);
        if (!res.explosionCount) {
            return { explosionCount, runaway: false };
        }
        explosionCount += res.explosionCount;
        iterations += 1;
    }
    return { explosionCount, runaway: true };
}

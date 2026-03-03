/**
 * AI Engine module for Color Clash.
 *
 * Public API:
 *   computeAIMove(state, config)
 *
 *   state: {
 *     grid: Array<Array<{value:number,player:string}>>,
 *     initialPlacements: boolean[],
 *     playerIndex: number,            // AI player making a move
 *     playerCount: number,
 *     gridSize: number,
 *     activeColors: () => string[],   // returns color list (game palette)
 *     invalidInitialPositions: Array<{r:number,c:number}>
 *   }
 *
 *   config: {
 *     maxCellValue: number,
 *     initialPlacementValue: number,
 *     aiStrength: number,             // plies to search
 *     cellExplodeThreshold: number,   // near-explosion threshold (value - 1 used)
 *     gridSize: number,               // redundancy for convenience
 *     debug?: boolean
 *   }
 *
 * Returns: {
 *   chosen: { r:number, c:number, isInitial:boolean, srcVal:number } | null,
 *   requireAdvanceTurn: boolean,      // true if AI should advance turn (no move)
 *   scheduleGameEnd: boolean,         // true if game end should be scheduled
 *   debugInfo?: {
 *     ordered:Array<DebugEntry>,
 *     chosen?:DebugChosen,
 *     depthCounts?: Array<{depth:number,count:number,pruned:number}>
 *   }
 * }
 *
 * No side-effects: caller applies move or advances turn.
 */

import { resolveExplosionChain } from '../game/gridCalc.js';

/** @typedef {{r:number,c:number,isInitial:boolean,srcVal:number,sortKey:number}} Candidate */
/** @typedef {{r:number,c:number,isInitial:boolean,srcVal:number,explosions:number,immediateGain:number,resultGrid:any,resultInitial:boolean[],runaway:boolean,searchScore?:number,winPlies?:number,atk?:number,def?:number,netResult?:number,finalGrid?:any}} Evaluated */

/**
 * Deep-copy a simulated grid structure to avoid mutation across branches.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - the grid to copy.
 * @param {number} gridSize - size (width/height) of the grid.
 * @returns {Array<Array<{value:number,player:string}>>} same-shaped deep copy of simGrid.
 */
function deepCloneGrid(simGrid, gridSize) {
	const out = new Array(gridSize);
	for (let r = 0; r < gridSize; r++) {
		out[r] = new Array(gridSize);
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			out[r][c] = { value: cell.value, player: cell.player };
		}
	}
	return out;
}

/**
 * Evaluate a grid by summing values of cells owned by a given player.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - the grid to evaluate.
 * @param {number} playerIndex - player index.
 * @returns {number} total owned cell value of given player.
 */
function totalOwnedOnGrid(simGrid, playerIndex, activeColors, gridSize) {
	const color = activeColors()[playerIndex];
	let total = 0;
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			if (simGrid[r][c].player === color) total += simGrid[r][c].value;
		}
	}
	return total;
}

/**
 * Evaluate a grid by summing values of all opponent cells (combined opponents).
 * @param {Array<Array<{value:number,player:string}>>} simGrid - the grid to evaluate.
 * @param {number} playerIndex - focus player index.
 * @returns {number} total owned cell value of opponents.
 */
function totalOwnedByOpponents(simGrid, playerIndex, activeColors, gridSize) {
	const focusColor = activeColors()[playerIndex];
	let total = 0;
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			if (cell.player && cell.player !== focusColor) total += cell.value;
		}
	}
	return total;
}

/**
 * Run explosion propagation on a simulated grid until stable or runaway detected.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
 * @param {boolean[]} simInitialPlacements - initial placement flags.
 * @returns {{grid: Array<Array<{value:number,player:string}>>, explosionCount: number, runaway: boolean}} updated grid, number of explosions, runaway flag.
 */

function simulateExplosions(simGrid, simInitialPlacements, gridSize, maxCellValue, cellExplodeThreshold, maxExplosionsToAssumeLoop) {
	const isInitialPlacementPhase = !simInitialPlacements.every(v => v);
	const res = resolveExplosionChain({
		grid: simGrid,
		gridSize,
		cellExplodeThreshold,
		maxCellValue,
		isInitialPlacementPhase,
		maxIterations: maxExplosionsToAssumeLoop
	});
	return { grid: simGrid, explosionCount: res.explosionCount, runaway: res.runaway };
}

/**
 * Validate simulated initial placement using current size and simulated occupancy.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
 * @param {number} row - cell row.
 * @param {number} col - cell column.
 * @returns {boolean} true if invalid due to center or adjacency.
 */
function isInitialPlacementInvalidOnSim(simGrid, row, col, invalidInitialPositions, gridSize) {
	if (invalidInitialPositions.some(pos => pos.r === row && pos.c === col)) return true;
	const adj = [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]];
	return adj.some(([r, c]) => r >= 0 && r < gridSize && c >= 0 && c < gridSize && simGrid[r][c].player !== '');
}

/**
 * Generate legal moves (initial or increment) for a player on a sim grid.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
 * @param {boolean[]} simInitialPlacements - initial placement flags.
 * @param {number} playerIndex - player index.
 * @returns {Array<{r:number,c:number,isInitial:boolean,srcVal:number,sortKey:number}>} candidate moves annotated for ordering.
 */
function generateCandidatesOnSim(simGrid, simInitialPlacements, playerIndex, gridSize, activeColors, invalidInitialPositions) {
	const candidates = [];
	if (!simInitialPlacements[playerIndex]) {
		for (let r = 0; r < gridSize; r++) {
			for (let c = 0; c < gridSize; c++) {
				if (simGrid[r][c].value === 0 && !isInitialPlacementInvalidOnSim(simGrid, r, c, invalidInitialPositions, gridSize)) {
					candidates.push({ r, c, isInitial: true, srcVal: 0, sortKey: 0 });
				}
			}
		}
	} else {
		const color = activeColors()[playerIndex];
		for (let r = 0; r < gridSize; r++) {
			for (let c = 0; c < gridSize; c++) {
				if (simGrid[r][c].player === color) {
					const key = Math.max(0, Math.min(3, simGrid[r][c].value));
					candidates.push({ r, c, isInitial: false, srcVal: simGrid[r][c].value, sortKey: key });
				}
			}
		}
	}
	return candidates;
}

/**
 * Coalition helper: union of all non-focus players' legal moves, each tagged with owner.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
 * @param {boolean[]} simInitialPlacements - initial placement flags per player.
 * @param {number} focusPlayerIndex - player index for whom coalition is formed.
 * @returns {Array<{r:number,c:number,isInitial:boolean,srcVal:number,sortKey:number,owner:number}>} candidates.
 */
function generateCoalitionCandidatesOnSim(simGrid, simInitialPlacements, focusPlayerIndex, playerCount, gridSize, activeColors, invalidInitialPositions) {
	const out = [];
	for (let idx = 0; idx < playerCount; idx++) {
		if (idx === focusPlayerIndex) continue;
		const moves = generateCandidatesOnSim(simGrid, simInitialPlacements, idx, gridSize, activeColors, invalidInitialPositions);
		for (const m of moves) out.push({ ...m, owner: idx });
	}
	return out;
}

function computeAtkDefForGrid(simGrid, gridSize, activeColors, cellExplodeThreshold, playerIndex) {
	const aiColor = activeColors()[playerIndex];
	const nearVal = cellExplodeThreshold - 1;
	let def = 0;
	let atk = 0;
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			if (cell.player === aiColor) {
				if (cell.value === nearVal) def++;
				const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
				for (const [ar, ac] of adj) {
					if (ar < 0 || ar >= gridSize || ac < 0 || ac >= gridSize) continue;
					const adjCell = simGrid[ar][ac];
					if (adjCell.player && adjCell.player !== aiColor && cell.value > adjCell.value) atk++;
				}
			}
		}
	}
	return { atk, def };
}

function computeAtkDefForOpponents(simGrid, gridSize, activeColors, cellExplodeThreshold, playerIndex) {
	const focusColor = activeColors()[playerIndex];
	const nearVal = cellExplodeThreshold - 1;
	let def = 0;
	let atk = 0;
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			if (!cell.player || cell.player === focusColor) continue;
			if (cell.value === nearVal) def++;
			const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
			for (const [ar, ac] of adj) {
				if (ar < 0 || ar >= gridSize || ac < 0 || ac >= gridSize) continue;
				const adjCell = simGrid[ar][ac];
				if (adjCell.player === focusColor && cell.value > adjCell.value) atk++;
			}
		}
	}
	return { atk, def };
}

/**
 * Score a position for a player using gain + 1/2 atk + 1/5 def,
 * minus the combined opponents' score using the same formula.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
 * @param {number} playerIndex - player index.
 * @param {Object} opts
 * @param {number} opts.gridSize
 * @param {() => string[]} opts.activeColors
 * @param {number} opts.cellExplodeThreshold
 * @param {number} [opts.baseTotal]
 * @param {number} [opts.baseEnemyTotal]
 * @returns {{score:number,gain:number,atk:number,def:number,enemyGain:number,enemyAtk:number,enemyDef:number}}
 */
function evaluatePosition(simGrid, playerIndex, opts) {
	const { gridSize, activeColors, cellExplodeThreshold, baseTotal = 0, baseEnemyTotal = 0 } = opts;
	const total = totalOwnedOnGrid(simGrid, playerIndex, activeColors, gridSize);
	const gain = total - baseTotal;
	const enemyTotal = totalOwnedByOpponents(simGrid, playerIndex, activeColors, gridSize);
	const enemyGain = enemyTotal - baseEnemyTotal;
	const { atk, def } = computeAtkDefForGrid(simGrid, gridSize, activeColors, cellExplodeThreshold, playerIndex);
	const enemyAtkDef = computeAtkDefForOpponents(simGrid, gridSize, activeColors, cellExplodeThreshold, playerIndex);
	const ownScore = gain + (0.6 * atk) + (0.2 * def);
	const enemyScore = enemyGain + (0.6 * enemyAtkDef.atk) + (0.2 * enemyAtkDef.def);
	const score = ownScore - enemyScore;
	return { score, gain, atk, def, enemyGain, enemyAtk: enemyAtkDef.atk, enemyDef: enemyAtkDef.def };
}

function detectTerminalOutcome(simGridInput, simInitialPlacementsInput, focusPlayerIndex, gridSize, activeColors) {
	// Avoid terminal mis-detection during initial placement phase
	const inInitialPlacementPhase = !simInitialPlacementsInput.every(v => v);
	if (inInitialPlacementPhase) return null;
	let hasAny = false; let activePlayers = 0; let soleIdx = -1;
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const owner = simGridInput[r][c].player;
			if (owner !== '') {
				hasAny = true;
				const idx = activeColors().indexOf(owner);
				if (idx !== -1) {
					if (soleIdx === -1) { soleIdx = idx; activePlayers = 1; }
					else if (idx !== soleIdx) { activePlayers = 2; r = gridSize; break; }
				}
			}
		}
	}
	if (hasAny && activePlayers === 1) {
		return { value: (soleIdx === focusPlayerIndex) ? Infinity : -Infinity, stepsToInfinity: 1 };
	}
	return null;
}

function getAdjacentCoords(row, col, gridSize) {
	return [
		[row - 1, col],
		[row + 1, col],
		[row, col - 1],
		[row, col + 1]
	].filter(([r, c]) => r >= 0 && r < gridSize && c >= 0 && c < gridSize);
}

function collectNoisyCells(simGrid, gridSize, cellExplodeThreshold) {
	const nearVal = cellExplodeThreshold - 1;
	const noisy = new Set();
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			if (!cell.player || cell.value !== nearVal) continue;
			for (const [ar, ac] of getAdjacentCoords(r, c, gridSize)) {
				const adjCell = simGrid[ar][ac];
				if (!adjCell.player || adjCell.value !== nearVal) continue;
				if (adjCell.player !== cell.player) {
					noisy.add(`${r},${c}`);
					noisy.add(`${ar},${ac}`);
				}
			}
		}
	}
	return noisy;
}

export function getNoisyCells(grid, gridSize, cellExplodeThreshold) {
	const noisy = collectNoisyCells(grid, gridSize, cellExplodeThreshold);
	return Array.from(noisy).map(key => {
		const [r, c] = key.split(',').map(v => parseInt(v, 10));
		return { r, c };
	});
}

function generateNoisyCandidatesOnSim(simGrid, simInitialPlacements, playerIndex, gridSize, activeColors, invalidInitialPositions, noisyCells) {
	if (!noisyCells || noisyCells.size === 0) return [];
	const all = generateCandidatesOnSim(simGrid, simInitialPlacements, playerIndex, gridSize, activeColors, invalidInitialPositions);
	return all.filter(c => noisyCells.has(`${c.r},${c.c}`));
}

function generateNoisyCoalitionCandidatesOnSim(simGrid, simInitialPlacements, focusPlayerIndex, playerCount, gridSize, activeColors, invalidInitialPositions, noisyCells) {
	const out = [];
	for (let idx = 0; idx < playerCount; idx++) {
		if (idx === focusPlayerIndex) continue;
		const moves = generateNoisyCandidatesOnSim(simGrid, simInitialPlacements, idx, gridSize, activeColors, invalidInitialPositions, noisyCells);
		for (const m of moves) out.push({ ...m, owner: idx });
	}
	return out;
}

function quiescenceEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, depth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts) {
	const { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, cellExplodeThreshold, baseTotal, baseEnemyTotal, quiescenceTracker } = opts;
	if (quiescenceTracker && typeof quiescenceTracker.count === 'number') quiescenceTracker.count += 1;
	const terminal = detectTerminalOutcome(simGridInput, simInitialPlacementsInput, focusPlayerIndex, gridSize, activeColors);
	if (terminal) {
		return { value: terminal.value, runaway: true, stepsToInfinity: terminal.stepsToInfinity, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
	}
	const noisyCells = collectNoisyCells(simGridInput, gridSize, cellExplodeThreshold);
	if (depth === 0 || noisyCells.size === 0) {
		const evalRes = evaluatePosition(simGridInput, focusPlayerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal, baseEnemyTotal });
		return { value: evalRes.score, runaway: false, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
	}
	const simGrid = deepCloneGrid(simGridInput, gridSize);
	const simInitial = simInitialPlacementsInput.slice();
	const isFocusTurn = (moverIndex === focusPlayerIndex);
	let candidates;
	if (isFocusTurn) {
		candidates = generateNoisyCandidatesOnSim(simGrid, simInitial, focusPlayerIndex, gridSize, activeColors, invalidInitialPositions, noisyCells).map(c => ({ ...c, owner: focusPlayerIndex }));
	} else {
		candidates = generateNoisyCoalitionCandidatesOnSim(simGrid, simInitial, focusPlayerIndex, playerCount, gridSize, activeColors, invalidInitialPositions, noisyCells);
	}
	if (!candidates.length) {
		const evalRes = evaluatePosition(simGridInput, focusPlayerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal, baseEnemyTotal });
		return { value: evalRes.score, runaway: false, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
	}
	const evaluated = [];
	const maxExplosionsToAssumeLoop = gridSize * 3;
	for (const cand of candidates) {
		const applied = applyMoveAndSim(simGrid, simInitial, cand.owner, cand.r, cand.c, cand.isInitial, gridSize, maxCellValue, initialPlacementValue, activeColors, cellExplodeThreshold, maxExplosionsToAssumeLoop);
		const evalRes = evaluatePosition(applied.grid, focusPlayerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal, baseEnemyTotal });
		if (applied.runaway) {
			const runawayVal = (cand.owner === focusPlayerIndex) ? Infinity : -Infinity;
			evaluated.push({ cand, owner: cand.owner, value: runawayVal, resultGrid: applied.grid, simInitial: applied.simInitial });
		} else {
			evaluated.push({ cand, owner: cand.owner, value: evalRes.score, resultGrid: applied.grid, simInitial: applied.simInitial });
		}
	}
	evaluated.sort((a, b) => isFocusTurn ? (b.value - a.value) : (a.value - b.value));
	const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
	let bestValue = isFocusTurn ? -Infinity : Infinity; let bestSteps; let bestGrid = simGridInput; let branchCount = 0; let prunedCount = 0;
	const prefersSteps = (value, candidateSteps) => {
		if (typeof candidateSteps !== 'number') return false;
		if (value === Infinity) return isFocusTurn ? (bestSteps === undefined || candidateSteps < bestSteps) : (bestSteps === undefined || candidateSteps > bestSteps);
		if (value === -Infinity) return isFocusTurn ? (bestSteps === undefined || candidateSteps > bestSteps) : (bestSteps === undefined || candidateSteps < bestSteps);
		return false;
	};
	for (let i = 0; i < evaluated.length; i++) {
		const entry = evaluated[i];
		if (entry.value === Infinity || entry.value === -Infinity) {
			prunedCount += Math.max(0, evaluated.length - (i + 1));
			return { value: isFocusTurn ? Infinity : -Infinity, runaway: true, stepsToInfinity: 1, bestGrid: entry.resultGrid, branchCount: 1, prunedCount };
		}
		const child = quiescenceEvaluate(entry.resultGrid, entry.simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
		branchCount += typeof child.branchCount === 'number' ? child.branchCount : 1;
		prunedCount += typeof child.prunedCount === 'number' ? child.prunedCount : 0;
		const value = child.value; const childSteps = typeof child.stepsToInfinity === 'number' ? child.stepsToInfinity + 1 : undefined;
		if (isFocusTurn) {
			if (value > bestValue || (value === bestValue && (value === Infinity || value === -Infinity) && prefersSteps(value, childSteps))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
			}
			alpha = Math.max(alpha, bestValue);
			if (alpha >= beta) {
				prunedCount += Math.max(0, evaluated.length - (i + 1));
				break;
			}
		} else {
			if (value < bestValue || (value === bestValue && (value === Infinity || value === -Infinity) && prefersSteps(value, childSteps))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
			}
			beta = Math.min(beta, bestValue);
			if (beta <= alpha) {
				prunedCount += Math.max(0, evaluated.length - (i + 1));
				break;
			}
		}
	}
	const isInf = (bestValue === Infinity || bestValue === -Infinity);
	return { value: bestValue, runaway: isInf, stepsToInfinity: isInf ? bestSteps : undefined, bestGrid, branchCount, prunedCount };
}

/**
 * Apply a move on a cloned grid (initial or increment) and simulate explosions.
 * @param {Array<Array<{value:number,player:string}>>} simGridInput - input simulated grid.
 * @param {boolean[]} simInitialPlacementsInput - initial placement flags.
 * @param {number} moverIndex - player making the move.
 * @param {number} moveR - move row.
 * @param {number} moveC - move column.
 * @param {boolean} isInitialMove - whether it's an initial placement.
 * @returns {{grid: Array<Array<{value:number,player:string}>>, explosionCount: number, runaway: boolean, simInitial: boolean[]}} post-move state.
 */
function applyMoveAndSim(simGridInput, simInitialPlacementsInput, moverIndex, moveR, moveC, isInitialMove, gridSize, maxCellValue, initialPlacementValue, activeColors, cellExplodeThreshold, maxExplosionsToAssumeLoop) {
	const simGrid = deepCloneGrid(simGridInput, gridSize);
	const simInitial = simInitialPlacementsInput.slice();
	if (isInitialMove) simInitial[moverIndex] = true;
	if (isInitialMove) {
		simGrid[moveR][moveC].value = initialPlacementValue;
		simGrid[moveR][moveC].player = activeColors()[moverIndex];
	} else {
		const prev = simGrid[moveR][moveC].value;
		simGrid[moveR][moveC].value = Math.min(maxCellValue, prev + 1);
		simGrid[moveR][moveC].player = activeColors()[moverIndex];
	}
	const result = simulateExplosions(simGrid, simInitial, gridSize, maxCellValue, cellExplodeThreshold, maxExplosionsToAssumeLoop);
	return { grid: result.grid, explosionCount: result.explosionCount, runaway: result.runaway, simInitial };
}

/**
 * Count total nodes explored for a given search depth (used to fit a budget).
 * @param {Array<Array<{value:number,player:string}>>} simGridInput
 * @param {boolean[]} simInitialPlacementsInput
 * @param {number} moverIndex
 * @param {number} depth
 * @param {number} focusPlayerIndex
 * @param {Object} opts
 * @returns {number}
 */

/**
 * Evaluate future plies using minimax with alpha-beta pruning for a focus player.
 * @param {Array<Array<{value:number,player:string}>>} simGridInput - simulated grid.
 * @param {boolean[]} simInitialPlacementsInput - initial placement flags.
 * @param {number} moverIndex - current mover.
 * @param {number} depth - search depth.
 * @param {number} alpha - alpha value.
 * @param {number} beta - beta value.
 * @param {number} maximizingPlayerIndex - maximizing player.
 * @param {number} focusPlayerIndex - player to evaluate for.
 * @returns {{value:number, runaway:boolean, stepsToInfinity?:number, bestGrid:Array<Array<{value:number,player:string}>>, branchCount:number, prunedCount:number}} evaluation score for focus player and plies to +/-Infinity if detected.
 */
function minimaxEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, depth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts) {
	const { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, cellExplodeThreshold, baseTotal, baseEnemyTotal, quiescenceDepth } = opts;
	const terminal = detectTerminalOutcome(simGridInput, simInitialPlacementsInput, focusPlayerIndex, gridSize, activeColors);
	if (terminal) {
		return { value: terminal.value, runaway: true, stepsToInfinity: terminal.stepsToInfinity, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
	}
	if (depth === 0) {
		if (quiescenceDepth > 0 && collectNoisyCells(simGridInput, gridSize, cellExplodeThreshold).size > 0) {
			return quiescenceEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, quiescenceDepth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
		}
		const evalRes = evaluatePosition(simGridInput, focusPlayerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal, baseEnemyTotal });
		return { value: evalRes.score, runaway: false, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
	}
	const simGrid = deepCloneGrid(simGridInput, gridSize);
	const simInitial = simInitialPlacementsInput.slice();
	const isFocusTurn = (moverIndex === focusPlayerIndex);
	let candidates;
	if (isFocusTurn) {
		candidates = generateCandidatesOnSim(simGrid, simInitial, focusPlayerIndex, gridSize, activeColors, invalidInitialPositions).map(c => ({ ...c, owner: focusPlayerIndex }));
	} else {
		candidates = generateCoalitionCandidatesOnSim(simGrid, simInitial, focusPlayerIndex, playerCount, gridSize, activeColors, invalidInitialPositions);
	}
	if (!candidates.length) {
		const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
		return minimaxEvaluate(simGrid, simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
	}
	const evaluated = [];
	const maxExplosionsToAssumeLoop = gridSize * 3;
	for (const cand of candidates) {
		const applied = applyMoveAndSim(simGrid, simInitial, cand.owner, cand.r, cand.c, cand.isInitial, gridSize, maxCellValue, initialPlacementValue, activeColors, cellExplodeThreshold, maxExplosionsToAssumeLoop);
		const evalRes = evaluatePosition(applied.grid, focusPlayerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal, baseEnemyTotal });
		if (applied.runaway) {
			const runawayVal = (cand.owner === focusPlayerIndex) ? Infinity : -Infinity;
			evaluated.push({ cand, owner: cand.owner, value: runawayVal, resultGrid: applied.grid, simInitial: applied.simInitial });
		} else {
			evaluated.push({ cand, owner: cand.owner, value: evalRes.score, resultGrid: applied.grid, simInitial: applied.simInitial });
		}
	}
	evaluated.sort((a, b) => isFocusTurn ? (b.value - a.value) : (a.value - b.value));
	const topCandidates = evaluated;
	const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
	let bestValue = isFocusTurn ? -Infinity : Infinity; let bestSteps; let bestGrid = simGridInput; let branchCount = 0; let prunedCount = 0;
	const prefersSteps = (value, candidateSteps) => {
		if (typeof candidateSteps !== 'number') return false;
		if (value === Infinity) return isFocusTurn ? (bestSteps === undefined || candidateSteps < bestSteps) : (bestSteps === undefined || candidateSteps > bestSteps);
		if (value === -Infinity) return isFocusTurn ? (bestSteps === undefined || candidateSteps > bestSteps) : (bestSteps === undefined || candidateSteps < bestSteps);
		return false;
	};
	for (let i = 0; i < topCandidates.length; i++) {
		const entry = topCandidates[i];
		if (entry.value === Infinity || entry.value === -Infinity) {
			prunedCount += Math.max(0, topCandidates.length - (i + 1));
			return { value: isFocusTurn ? Infinity : -Infinity, runaway: true, stepsToInfinity: 1, bestGrid: entry.resultGrid, branchCount: 1, prunedCount };
		}
		const child = minimaxEvaluate(entry.resultGrid, entry.simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
		branchCount += typeof child.branchCount === 'number' ? child.branchCount : 1;
		prunedCount += typeof child.prunedCount === 'number' ? child.prunedCount : 0;
		const value = child.value; const childSteps = typeof child.stepsToInfinity === 'number' ? child.stepsToInfinity + 1 : undefined;
		if (isFocusTurn) {
			if (value > bestValue || (value === bestValue && (value === Infinity || value === -Infinity) && prefersSteps(value, childSteps))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
			}
			alpha = Math.max(alpha, bestValue);
			if (alpha >= beta) {
				prunedCount += Math.max(0, topCandidates.length - (i + 1));
				break;
			}
		} else {
			if (value < bestValue || (value === bestValue && (value === Infinity || value === -Infinity) && prefersSteps(value, childSteps))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
			}
			beta = Math.min(beta, bestValue);
			if (beta <= alpha) {
				prunedCount += Math.max(0, topCandidates.length - (i + 1));
				break;
			}
		}
	}
	const isInf = (bestValue === Infinity || bestValue === -Infinity);
	return { value: bestValue, runaway: isInf, stepsToInfinity: isInf ? bestSteps : undefined, bestGrid, branchCount, prunedCount };
}

/**
 * Compute the AI's next move given the current game state and configuration.
 * Pure function: does not mutate the provided state objects; all simulations
 * are performed on deep clones. The caller is responsible for applying the
 * returned move (if any) to the live game grid and advancing turns / ending
 * the game.
 *
 * Selection process (high level):
 * 1. Generate all legal candidate moves for the AI player (initial placement
 *    or increment of an owned cell).
	 * 2. For each candidate, simulate the move plus chained explosions and record:
	 *    - Position score (gain + 1/2 atk + 1/5 def).
	 *    - Explosion count (for debugging / heuristic flavor).
	 *    - Runaway flag (detected explosion loop exceeding a bounded iteration).
	 * 3. Order candidates by position score (higher is better).
 * 4. For each candidate, perform a minimax search (depth = aiStrength-1) where
 *    coalition opponents attempt to minimize the AI's advantage. Alpha‑beta
 *    pruning trims branches early.
 * 5. If any branch yields a forced win (Infinity gain), choose the fastest
 *    (fewest plies to win). Otherwise, rank by composite netResult with
 *    tie‑breaks (attack potential > defense potential).
 *
 * Edge cases:
 * - No legal candidates: requireAdvanceTurn=true; if still in initial
 *   placement phase scheduleGameEnd=true (AI failed to place at all).
 * - Runaway explosion simulations: treated as immediate Infinity (if owned
 *   by AI) or -Infinity (if owned by opponents) to bias selection without
 *   spending further depth.
 *
 * @param {Object} state - Snapshot of the current game state.
 * @param {Array<Array<{value:number,player:string}>>} state.grid - Live grid (NOT mutated).
 * @param {boolean[]} state.initialPlacements - Per-player initial placement flags.
 * @param {number} state.playerIndex - Index of the AI player making a decision.
 * @param {number} state.playerCount - Number of players in the game.
 * @param {number} state.gridSize - Square dimension of the grid.
 * @param {() => string[]} state.activeColors - Provider for ordered color palette.
 * @param {Array<{r:number,c:number}>} state.invalidInitialPositions - Disallowed initial placement cells.
 *
 * @param {Object} config - AI configuration and tuning parameters.
 * @param {number} config.maxCellValue - Upper cap for cell values (prevents runaway growth).
 * @param {number} config.initialPlacementValue - Value assigned on an initial placement.
 * @param {number} config.aiStrength - Total search depth (plies) including root.
 * @param {number} config.cellExplodeThreshold - Threshold at/above which a cell explodes (used for heuristics).
 * @param {number} [config.quiescenceDepth=4] - Extra noisy-only plies searched at leaf nodes.
 * @param {boolean} [config.debug] - If true, attaches ordered candidate metadata for external UI/debug panels.
 * @param {boolean} [config.benchmark] - If true, attaches timing breakdowns for move computation.
 *
 * Returns: {
 *   chosen: { r:number, c:number, isInitial:boolean, srcVal:number } | null,
 *   requireAdvanceTurn: boolean,      // true if AI should advance turn (no move)
 *   scheduleGameEnd: boolean,         // true if game end should be scheduled
 *   debugInfo?: { ordered:Array<DebugEntry>, chosen?:DebugChosen },
 *   benchmarkInfo?: {
 *     candidateGenMs?:number,
 *     simulateMs?:number,
 *     searchMs?:number,
 *     finalizeMs?:number,
 *     selectMs?:number,
 *     totalMs?:number,
 *     candidates?:number,
 *     evaluated?:number,
 *     depth?:number,
 *     branches?:number
 *   }
 * }
 * }} Result object: either a chosen move or flags instructing caller to advance/end.
 */
function buildBenchmarkInfo(bench, meta = {}) {
 if (!bench || !bench.marks) return meta;
 const { marks } = bench;
 const diff = (a, b) => (typeof marks[a] === 'number' && typeof marks[b] === 'number') ? (marks[b] - marks[a]) : undefined;
 return {
  ...meta,
  candidateGenMs: diff('start', 'candidates'),
  simulateMs: diff('candidates', 'simulate'),
  searchMs: diff('simulate', 'search'),
  finalizeMs: diff('search', 'finalize'),
  selectMs: diff('finalize', 'select'),
  totalMs: diff('start', 'end')
 };
}

export function computeAIMove(state, config) {
	const { grid, initialPlacements, playerIndex, playerCount, gridSize, activeColors, invalidInitialPositions } = state;
	const { maxCellValue, initialPlacementValue, aiStrength, cellExplodeThreshold, debug, benchmark, quiescenceDepth: configQuiescenceDepth } = config;
	// Default quiescence depth is half the AI strength, rounded up. If a config value
	// is supplied, cap it to this limit to avoid excessive noisy-only search.
	const quiescenceLimit = Math.max(0, Math.ceil((typeof aiStrength === 'number' && aiStrength > 0) ? (aiStrength / 2) : 1));
	let quiescenceDepth = quiescenceLimit;
	if (typeof configQuiescenceDepth === 'number' && !Number.isNaN(configQuiescenceDepth)) {
		// ensure integer >= 0 and not larger than limit
		const supplied = Math.max(0, Math.floor(configQuiescenceDepth));
		quiescenceDepth = Math.min(supplied, quiescenceLimit);
	}
	const maxExplosionsToAssumeLoop = gridSize * 3;
	const computationBudget = Math.pow(5, aiStrength);
	const now = (typeof performance !== 'undefined' && performance.now) ? () => performance.now() : () => Date.now();
	const bench = benchmark ? { marks: {} } : null;
	const mark = (label) => { if (bench) bench.marks[label] = now(); };
	mark('start');

	const startTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
	const candidates = generateCandidatesOnSim(grid, initialPlacements, playerIndex, gridSize, activeColors, invalidInitialPositions);
	mark('candidates');
	if (!candidates.length) {
		mark('end');
		const benchmarkInfo = benchmark ? buildBenchmarkInfo(bench, { candidates: 0, evaluated: 0, depth: 0, branches: 0 }) : undefined;
		return {
			chosen: null,
			requireAdvanceTurn: true,
			scheduleGameEnd: !initialPlacements[playerIndex],
			...(benchmarkInfo ? { benchmarkInfo } : {})
		};
	}
	const evaluated = [];
	const beforeTotal = totalOwnedOnGrid(grid, playerIndex, activeColors, gridSize);
	const beforeEnemyTotal = totalOwnedByOpponents(grid, playerIndex, activeColors, gridSize);
	for (const cand of candidates) {
		const res = applyMoveAndSim(grid, initialPlacements, playerIndex, cand.r, cand.c, cand.isInitial, gridSize, maxCellValue, initialPlacementValue, activeColors, cellExplodeThreshold, maxExplosionsToAssumeLoop);
		const evalRes = evaluatePosition(res.grid, playerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal: beforeTotal, baseEnemyTotal: beforeEnemyTotal });
		evaluated.push({
			r: cand.r,
			c: cand.c,
			isInitial: cand.isInitial,
			srcVal: cand.srcVal,
			immediateGain: (res.runaway ? Infinity : evalRes.gain),
			explosions: res.explosionCount,
			atk: evalRes.atk,
			def: evalRes.def,
			resultGrid: res.grid,
			resultInitial: res.simInitial,
			runaway: res.runaway
		});
	}
	mark('simulate');
	const allCandidates = evaluated.slice();
	const quiescenceTracker = { count: 0 };
	const depthOpts = { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, cellExplodeThreshold, baseTotal: beforeTotal, baseEnemyTotal: beforeEnemyTotal, quiescenceDepth, quiescenceTracker };
	let effectiveDepth = 1;
	let totalBranches = 0;
	const depthCounts = [];
	let depthCap = Number.POSITIVE_INFINITY;
	for (let depth = 1; totalBranches < computationBudget && depth <= depthCap; depth++) {
		totalBranches = 0;
		let totalPruned = 0;
		for (const cand of allCandidates) {
			if (cand.runaway) {
				cand.searchScore = (cand.immediateGain === Infinity) ? Infinity : -Infinity;
				if (cand.searchScore === Infinity) cand.winPlies = 1;
				cand.finalGrid = cand.resultGrid;
				cand.branchCount = 1;
				cand.prunedCount = 0;
			} else {
				const nextMover = -1;
				const evalRes = minimaxEvaluate(cand.resultGrid, cand.resultInitial, nextMover, Math.max(0, depth - 1), -Infinity, Infinity, playerIndex, playerIndex, depthOpts);
				cand.searchScore = evalRes.value;
				if ((evalRes.value === Infinity || evalRes.value === -Infinity) && typeof evalRes.stepsToInfinity === 'number') {
					cand.winPlies = evalRes.stepsToInfinity;
				}
				cand.finalGrid = evalRes.bestGrid || cand.resultGrid;
				cand.branchCount = evalRes.branchCount;
				cand.prunedCount = evalRes.prunedCount;
			}
			totalBranches += (typeof cand.branchCount === 'number' ? cand.branchCount : 1);
			totalPruned += (typeof cand.prunedCount === 'number' ? cand.prunedCount : 0);
		}
		depthCounts.push({ depth, count: totalBranches, pruned: totalPruned });
		effectiveDepth = depth;
		const winPlies = allCandidates
			.filter(c => c.searchScore === Infinity && typeof c.winPlies === 'number')
			.map(c => c.winPlies);
		const hasForcedWin = winPlies.length > 0;
		const hasForcedLoss = allCandidates.length > 0 && allCandidates.every(c => c.searchScore === -Infinity && typeof c.winPlies === 'number');
		if (hasForcedWin || hasForcedLoss) {
			const lossPlies = hasForcedLoss ? allCandidates.map(c => c.winPlies).filter(v => typeof v === 'number') : [];
			const allPlies = hasForcedWin ? winPlies.concat(lossPlies) : lossPlies;
			if (allPlies.length) {
				const minWinPlies = Math.min(...allPlies);
				depthCap = Math.max(1, minWinPlies - 2);
			}
		}
	}
	mark('search');
	for (const cand of allCandidates) {
		if (cand.runaway && cand.searchScore === Infinity) {
			cand.def = undefined;
			cand.atk = undefined;
			cand.netResult = (typeof cand.searchScore === 'number' ? cand.searchScore : cand.immediateGain);
			continue;
		}
		const rg = cand.finalGrid || cand.resultGrid;
		const evalRes = evaluatePosition(rg, playerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal: beforeTotal, baseEnemyTotal: beforeEnemyTotal });
		cand.def = evalRes.def;
		cand.atk = evalRes.atk;
		cand.netResult = (typeof cand.searchScore === 'number' ? cand.searchScore : cand.immediateGain);
	}
	mark('finalize');
	const winning = allCandidates.filter(c => c.searchScore === Infinity);
	let chosen;
	if (winning.length) {
		const minPlies = Math.min(...winning.map(c => (typeof c.winPlies === 'number' ? c.winPlies : Number.POSITIVE_INFINITY)));
		const fastest = winning.filter(c => (typeof c.winPlies === 'number' ? c.winPlies : Number.POSITIVE_INFINITY) === minPlies);
		chosen = fastest.length ? fastest[Math.floor(Math.random() * fastest.length)] : winning[0];
	} else {
		allCandidates.sort((a, b) => (b.netResult - a.netResult));
		const bestNet = allCandidates[0] ? allCandidates[0].netResult : -Infinity;
		const bestByNet = allCandidates.filter(t => t.netResult === bestNet);
		let bestMoves = bestByNet.length ? bestByNet : [];
		if (!bestMoves || !bestMoves.length) bestMoves = allCandidates.length ? [allCandidates[0]] : [];
		chosen = bestMoves.length ? bestMoves[Math.floor(Math.random() * bestMoves.length)] : null;
	}
	mark('select');
	const result = {
		chosen: chosen ? { r: chosen.r, c: chosen.c, isInitial: chosen.isInitial, srcVal: chosen.srcVal } : null,
		requireAdvanceTurn: !chosen,
		scheduleGameEnd: !chosen && !initialPlacements[playerIndex]
	};
	mark('end');
	if (benchmark) {
		result.benchmarkInfo = buildBenchmarkInfo(bench, {
			candidates: candidates.length,
			evaluated: allCandidates.length,
			depth: effectiveDepth,
			branches: totalBranches
		});
	}
	if (debug) {
		try {
			console.log('[AI debug] budget', {
				aiStrength,
				computationBudget,
				effectiveDepth,
				totalBranches,
				depthCounts
			});
		} catch { /* ignore */ }
		let ordered = allCandidates.slice();
		if (winning.length) {
			ordered = ordered.slice().sort((a, b) => {
				if (a.searchScore === Infinity && b.searchScore === Infinity) {
					const aPlies = typeof a.winPlies === 'number' ? a.winPlies : Number.POSITIVE_INFINITY;
					const bPlies = typeof b.winPlies === 'number' ? b.winPlies : Number.POSITIVE_INFINITY;
					return aPlies - bPlies;
				}
				if (a.searchScore === Infinity) return -1;
				if (b.searchScore === Infinity) return 1;
				return (b.netResult - a.netResult);
			});
		} else {
			ordered = ordered.slice().sort((a, b) => (b.netResult - a.netResult));
		}
		if (chosen) {
			const chosenIdx = ordered.findIndex(c => c.r === chosen.r && c.c === chosen.c && c.isInitial === chosen.isInitial);
			if (chosenIdx > 0) {
				const [chosenEntry] = ordered.splice(chosenIdx, 1);
				ordered.unshift(chosenEntry);
			}
		}
		const steps = (chosen && chosen.searchScore === Infinity && typeof chosen.winPlies === 'number') ? chosen.winPlies : effectiveDepth;
		const branches = totalBranches;
		const endTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
		const elapsedMs = endTime - startTime;
		const stepsPerSec = (typeof branches === 'number' && elapsedMs > 0) ? (branches / (elapsedMs / 1000)) : undefined;
		const currentAtkDef = computeAtkDefForGrid(grid, gridSize, activeColors, cellExplodeThreshold, playerIndex);
		result.debugInfo = {
			chosen: chosen ? {
				r: chosen.r, c: chosen.c, src: chosen.srcVal, expl: chosen.explosions, gain: chosen.searchScore, atk: chosen.atk, def: chosen.def, winPlies: chosen.winPlies
			} : null,
			ordered: ordered.map(c => ({ r: c.r, c: c.c, src: c.srcVal, expl: c.explosions, gain: c.searchScore, atk: c.atk, def: c.def, winPlies: c.winPlies })),
			steps,
			branches,
			quiescenceNodes: quiescenceTracker.count,
			depthCounts,
			elapsedMs,
			stepsPerSec,
			currentAtk: currentAtkDef.atk,
			currentDef: currentAtkDef.def
		};
	}
	return result;
}


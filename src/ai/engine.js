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
/** @typedef {{r:number,c:number,isInitial:boolean,srcVal:number,explosions:number,immediateGain:number,resultGrid:any,resultInitial:boolean[],runaway:boolean,searchScore?:number,linePlies?:number,atk?:number,def?:number,netResult?:number,finalGrid?:any}} Evaluated */

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
		return { value: (soleIdx === focusPlayerIndex) ? Infinity : -Infinity, linePlies: 1 };
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

function findNearValChains(simGrid, gridSize, cellExplodeThreshold) {
	const nearVal = cellExplodeThreshold - 1;
	const visited = new Set();
	const chains = [];
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			if (!cell.player || cell.value !== nearVal) continue;
			const key = `${r},${c}`;
			if (visited.has(key)) continue;
			const owners = new Set();
			const stack = [[r, c]];
			const members = [];
			const memberSet = new Set();
			visited.add(key);
			while (stack.length) {
				const [cr, cc] = stack.pop();
				const current = simGrid[cr][cc];
				members.push({ r: cr, c: cc });
				memberSet.add(`${cr},${cc}`);
				if (current.player) owners.add(current.player);
				for (const [ar, ac] of getAdjacentCoords(cr, cc, gridSize)) {
					const adj = simGrid[ar][ac];
					if (!adj.player || adj.value !== nearVal) continue;
					const adjKey = `${ar},${ac}`;
					if (visited.has(adjKey)) continue;
					visited.add(adjKey);
					stack.push([ar, ac]);
				}
			}
			let hasTwoByTwo = false;
			for (const member of members) {
				const r0 = member.r;
				const c0 = member.c;
				if (
					memberSet.has(`${r0 + 1},${c0}`)
					&& memberSet.has(`${r0},${c0 + 1}`)
					&& memberSet.has(`${r0 + 1},${c0 + 1}`)
				) {
					hasTwoByTwo = true;
					break;
				}
			}
			chains.push({ owners, members, hasTwoByTwo });
		}
	}
	return chains;
}

function combineNearValChains(simGrid, gridSize, cellExplodeThreshold, chains) {
	if (!chains.length) return chains;
	const nearVal = cellExplodeThreshold - 1;
	const parent = chains.map((_, idx) => idx);
	const find = (x) => {
		let cur = x;
		while (parent[cur] !== cur) cur = parent[cur];
		let root = cur;
		cur = x;
		while (parent[cur] !== cur) {
			const next = parent[cur];
			parent[cur] = root;
			cur = next;
		}
		return root;
	};
	const union = (a, b) => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) parent[rb] = ra;
	};
	const chainByCell = new Map();
	chains.forEach((chain, idx) => {
		for (const member of chain.members) {
			chainByCell.set(`${member.r},${member.c}`, idx);
		}
	});
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			if (!cell.player || cell.value >= nearVal) continue;
			const requiredAdj = cellExplodeThreshold - cell.value;
			if (requiredAdj < 2) continue;
			const counts = new Map();
			const adjacentChains = new Set();
			for (const [ar, ac] of getAdjacentCoords(r, c, gridSize)) {
				const chainIdx = chainByCell.get(`${ar},${ac}`);
				if (typeof chainIdx !== 'number') continue;
				adjacentChains.add(chainIdx);
				counts.set(chainIdx, (counts.get(chainIdx) || 0) + 1);
			}
			if (adjacentChains.size <= 1) continue;
			for (const [chainIdx, count] of counts.entries()) {
				const bonus = chains[chainIdx]?.hasTwoByTwo ? 1 : 0;
				if ((count + bonus) < requiredAdj) continue;
				for (const otherIdx of adjacentChains) {
					if (otherIdx !== chainIdx) union(chainIdx, otherIdx);
				}
			}
		}
	}
	const combined = new Map();
	chains.forEach((chain, idx) => {
		const root = find(idx);
		if (!combined.has(root)) {
			combined.set(root, { owners: new Set(), members: [] });
		}
		const target = combined.get(root);
		for (const owner of chain.owners) target.owners.add(owner);
		for (const member of chain.members) target.members.push(member);
	});
	return Array.from(combined.values());
}

function collectNoisyCells(simGrid, gridSize, cellExplodeThreshold) {
	const noisy = new Set();
	const baseChains = findNearValChains(simGrid, gridSize, cellExplodeThreshold);
	const chains = combineNearValChains(simGrid, gridSize, cellExplodeThreshold, baseChains);
	for (const chain of chains) {
		if (chain.owners.size <= 1) continue;
		for (const member of chain.members) {
			noisy.add(`${member.r},${member.c}`);
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

/**
 * Comparator for final/root candidate ordering.
 *
 * Primary key: higher `netResult` first.
 * Tie-break: for equal positive `netResult`, shorter `linePlies` first;
 * for equal negative `netResult`, longer `linePlies` first.
 *
 * @param {Evaluated} a - first candidate.
 * @param {Evaluated} b - second candidate.
 * @returns {number} sort comparator value compatible with Array.prototype.sort.
 */
function compareCandidatesByNetAndLinePlies(a, b) {
	const netDiff = (b.netResult - a.netResult);
	if (netDiff !== 0 && !Number.isNaN(netDiff)) return netDiff;
	if (a.netResult > 0) return (a.linePlies - b.linePlies);
	if (a.netResult < 0) return (b.linePlies - a.linePlies);
	return 0;
}

function prefersChainLengthForValue(value, candidateSteps, bestSteps) {
	if (typeof candidateSteps !== 'number') return false;
	if (value > 0) return (bestSteps === undefined || candidateSteps < bestSteps);
	if (value < 0) return (bestSteps === undefined || candidateSteps > bestSteps);
	return false;
}

function quiescenceEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, depth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts) {
	const { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, cellExplodeThreshold, baseTotal, baseEnemyTotal, quiescenceTracker } = opts;
	if (opts && typeof opts.nodeVisited === 'function') {
		// notify outer progress tracker that we've entered a node (transient increment)
		try { opts.nodeVisited(1, depth); } catch { /* ignore progress errors */ }
	}
	if (quiescenceTracker && typeof quiescenceTracker.count === 'number') quiescenceTracker.count += 1;
	const terminal = detectTerminalOutcome(simGridInput, simInitialPlacementsInput, focusPlayerIndex, gridSize, activeColors);
	if (terminal) {
		return { value: terminal.value, runaway: true, linePlies: terminal.linePlies, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
	}
	const noisyCells = collectNoisyCells(simGridInput, gridSize, cellExplodeThreshold);
	if (depth === 0 || noisyCells.size === 0) {
		const evalRes = evaluatePosition(simGridInput, focusPlayerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal, baseEnemyTotal });
		return { value: evalRes.score, runaway: false, linePlies: 0, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
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
		return { value: evalRes.score, runaway: false, linePlies: 0, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
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
	let bestValue = isFocusTurn ? -Infinity : Infinity; let bestLinePlies; let bestGrid = simGridInput; let branchCount = 0; let prunedCount = 0;
	for (let i = 0; i < evaluated.length; i++) {
		const entry = evaluated[i];
		if (entry.value === Infinity || entry.value === -Infinity) {
			prunedCount += Math.max(0, evaluated.length - (i + 1));
			const immediateValue = isFocusTurn ? Infinity : -Infinity;
			return { value: immediateValue, runaway: true, linePlies: 1, bestGrid: entry.resultGrid, branchCount: 1, prunedCount };
		}
		const child = quiescenceEvaluate(entry.resultGrid, entry.simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
		branchCount += typeof child.branchCount === 'number' ? child.branchCount : 1;
		prunedCount += typeof child.prunedCount === 'number' ? child.prunedCount : 0;
		const value = child.value;
		const childLinePlies = (typeof child.linePlies === 'number') ? (child.linePlies + 1) : undefined;
		const tieBySign = (value === bestValue) && prefersChainLengthForValue(value, childLinePlies, bestLinePlies);
		if (isFocusTurn) {
			if (value > bestValue || tieBySign) {
				bestValue = value; bestLinePlies = childLinePlies; bestGrid = child.bestGrid || entry.resultGrid;
			}
			alpha = Math.max(alpha, bestValue);
			if (alpha >= beta) {
				prunedCount += Math.max(0, evaluated.length - (i + 1));
				break;
			}
		} else {
			if (value < bestValue || tieBySign) {
				bestValue = value; bestLinePlies = childLinePlies; bestGrid = child.bestGrid || entry.resultGrid;
			}
			beta = Math.min(beta, bestValue);
			if (beta <= alpha) {
				prunedCount += Math.max(0, evaluated.length - (i + 1));
				break;
			}
		}
	}
	const isInf = (bestValue === Infinity || bestValue === -Infinity);
	return {
		value: bestValue,
		runaway: isInf,
		linePlies: (typeof bestLinePlies === 'number') ? bestLinePlies : 0,
		bestGrid,
		branchCount,
		prunedCount
	};
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
 * @returns {{value:number, runaway:boolean, linePlies:number, bestGrid:Array<Array<{value:number,player:string}>>, branchCount:number, prunedCount:number}} evaluation score for focus player and line plies used for tie-breaks.
 */
function minimaxEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, depth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts) {
	const { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, cellExplodeThreshold, baseTotal, baseEnemyTotal, quiescenceDepth } = opts;
	if (opts && typeof opts.nodeVisited === 'function') {
		try { opts.nodeVisited(1, depth); } catch { /* ignore progress errors */ }
	}
	const terminal = detectTerminalOutcome(simGridInput, simInitialPlacementsInput, focusPlayerIndex, gridSize, activeColors);
	if (terminal) {
		return { value: terminal.value, runaway: true, linePlies: terminal.linePlies, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
	}
	if (depth === 0) {
		if (quiescenceDepth > 0 && collectNoisyCells(simGridInput, gridSize, cellExplodeThreshold).size > 0) {
			return quiescenceEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, quiescenceDepth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
		}
		const evalRes = evaluatePosition(simGridInput, focusPlayerIndex, { gridSize, activeColors, cellExplodeThreshold, baseTotal, baseEnemyTotal });
		return { value: evalRes.score, runaway: false, linePlies: 0, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
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
	let bestValue = isFocusTurn ? -Infinity : Infinity; let bestLinePlies; let bestGrid = simGridInput; let branchCount = 0; let prunedCount = 0;
	for (let i = 0; i < topCandidates.length; i++) {
		const entry = topCandidates[i];
		if (entry.value === Infinity || entry.value === -Infinity) {
			prunedCount += Math.max(0, topCandidates.length - (i + 1));
			const immediateValue = isFocusTurn ? Infinity : -Infinity;
			return { value: immediateValue, runaway: true, linePlies: 1, bestGrid: entry.resultGrid, branchCount: 1, prunedCount };
		}
		const child = minimaxEvaluate(entry.resultGrid, entry.simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
		branchCount += typeof child.branchCount === 'number' ? child.branchCount : 1;
		prunedCount += typeof child.prunedCount === 'number' ? child.prunedCount : 0;
		const value = child.value;
		const childLinePlies = (typeof child.linePlies === 'number') ? (child.linePlies + 1) : undefined;
		const tieBySign = (value === bestValue) && prefersChainLengthForValue(value, childLinePlies, bestLinePlies);
		if (isFocusTurn) {
			if (value > bestValue || tieBySign) {
				bestValue = value; bestLinePlies = childLinePlies; bestGrid = child.bestGrid || entry.resultGrid;
			}
			alpha = Math.max(alpha, bestValue);
			if (alpha >= beta) {
				prunedCount += Math.max(0, topCandidates.length - (i + 1));
				break;
			}
		} else {
			if (value < bestValue || tieBySign) {
				bestValue = value; bestLinePlies = childLinePlies; bestGrid = child.bestGrid || entry.resultGrid;
			}
			beta = Math.min(beta, bestValue);
			if (beta <= alpha) {
				prunedCount += Math.max(0, topCandidates.length - (i + 1));
				break;
			}
		}
	}
	const isInf = (bestValue === Infinity || bestValue === -Infinity);
	return {
		value: bestValue,
		runaway: isInf,
		linePlies: (typeof bestLinePlies === 'number') ? bestLinePlies : 0,
		bestGrid,
		branchCount,
		prunedCount
	};
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
	const { maxCellValue, initialPlacementValue, aiStrength, cellExplodeThreshold, debug, benchmark, quiescenceDepth: configQuiescenceDepth, onProgress } = config;
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
	let cumulativeBranches = 0;
	let transientBranches = 0; // nodes seen inside a long-running candidate (not yet added to cumulativeBranches)
	let lastEmittedPercent = -1;
	let lastProgressValue = 0;
	// Linear progress tracking over 2x budget to smooth overshoot reporting.
	let budgetExceededDepth = null;
	const progressCtx = { prevDepthCumulative: 0, currentDepthTotal: 0 };
	const reportProgress = (depth, force = false, done = false) => {
		if (typeof onProgress !== 'function') return;
		const budget = Math.max(1, computationBudget || 1);
		const effectiveEvaluated = cumulativeBranches + transientBranches;
		let progress;
		if (done) {
			progress = 1;
		} else {
			// Map 0..(2*budget) linearly to 0..1
			progress = Math.min(1, effectiveEvaluated / (2 * budget));
		}
		// Prevent regressions when transientBranches resets between candidates.
		progress = Math.max(lastProgressValue, progress);
		lastProgressValue = progress;
		const percent = Math.floor(progress * 100);
		if (!done && percent <= lastEmittedPercent && !force) return;
		if (done) {
			lastEmittedPercent = 100;
		} else if (percent > lastEmittedPercent) {
			lastEmittedPercent = percent;
		}
		// record last emitted percent (used above) - effectiveEvaluated tracked via transient/cumulative vars
		try {
			/*console.debug('[AI progress]', {
				depth,
				percent,
				evaluated: effectiveEvaluated,
				budget,
				progress: Math.min(1, Math.max(0, progress)),
				prevDepthCumulative: progressCtx.prevDepthCumulative,
				currentDepthTotal: progressCtx.currentDepthTotal,
			});*/
		} catch { /* ignore debug logging issues */ }
		onProgress({
			evaluated: effectiveEvaluated,
			budget,
			depth,
			progress: Math.min(1, Math.max(0, progress)),
			done
		});
	};
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
	const depthOpts = { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, cellExplodeThreshold, baseTotal: beforeTotal, baseEnemyTotal: beforeEnemyTotal, quiescenceDepth, quiescenceTracker,
		// called by inner search nodes to report transient progress
		nodeVisited: (count = 1, d) => { try { transientBranches += (typeof count === 'number' ? count : 1); reportProgress(d); } catch { /* ignore */ } }
	};
	let effectiveDepth = 1;
	let depthBranches = 0;
	const depthCounts = [];
	let depthCap = Number.POSITIVE_INFINITY;
	for (let depth = 1; cumulativeBranches < computationBudget && depth <= depthCap; depth++) {
		progressCtx.prevDepthCumulative = cumulativeBranches;
		progressCtx.currentDepthTotal = 0;
		depthBranches = 0;
		let totalPruned = 0;
		let candidatesProcessed = 0;
		for (const cand of allCandidates) {
			if (cand.runaway) {
				cand.searchScore = (cand.immediateGain === Infinity) ? Infinity : -Infinity;
				cand.linePlies = 1;
				cand.finalGrid = cand.resultGrid;
				cand.branchCount = 1;
				cand.prunedCount = 0;
			} else {
				// reset transient counter for this candidate's search
				transientBranches = 0;
				const nextMover = -1;
				const evalRes = minimaxEvaluate(cand.resultGrid, cand.resultInitial, nextMover, Math.max(0, depth - 1), -Infinity, Infinity, playerIndex, playerIndex, depthOpts);
				cand.searchScore = evalRes.value;
				if (typeof evalRes.linePlies === 'number') cand.linePlies = evalRes.linePlies;
				cand.finalGrid = evalRes.bestGrid || cand.resultGrid;
				cand.branchCount = evalRes.branchCount;
				cand.prunedCount = evalRes.prunedCount;
			}
			const branchCount = (typeof cand.branchCount === 'number' ? cand.branchCount : 1);
			depthBranches += branchCount;
			cumulativeBranches += branchCount;
			// clear any transient nodes we counted for this candidate now that we've accounted for the full branchCount
			transientBranches = 0;
			totalPruned += (typeof cand.prunedCount === 'number' ? cand.prunedCount : 0);
			candidatesProcessed++;
			// Estimate total nodes at this depth for overshoot progress
			if (candidatesProcessed > 0 && candidatesProcessed < allCandidates.length) {
				progressCtx.currentDepthTotal = Math.round(depthBranches * allCandidates.length / candidatesProcessed);
			} else {
				progressCtx.currentDepthTotal = depthBranches;
			}
			reportProgress(depth);
			if (cumulativeBranches >= computationBudget) {
				budgetExceededDepth = depth;
				break;
			}
		}
		depthCounts.push({ depth, count: depthBranches, pruned: totalPruned });
		effectiveDepth = depth;
		reportProgress(depth, true);
		if (budgetExceededDepth === depth) break;
		const winPlies = allCandidates
			.filter(c => c.searchScore === Infinity && typeof c.linePlies === 'number')
			.map(c => c.linePlies);
		const hasForcedWin = winPlies.length > 0;
		const hasForcedLoss = allCandidates.length > 0 && allCandidates.every(c => c.searchScore === -Infinity && typeof c.linePlies === 'number');
		if (hasForcedWin || hasForcedLoss) {
			const lossPlies = hasForcedLoss ? allCandidates.map(c => c.linePlies).filter(v => typeof v === 'number') : [];
			const allPlies = hasForcedWin ? winPlies.concat(lossPlies) : lossPlies;
			if (allPlies.length) {
				const minWinPlies = Math.min(...allPlies);
				depthCap = Math.max(1, minWinPlies - 2);
			}
		}
	}
	reportProgress(effectiveDepth, true, true);
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
		const minPlies = Math.min(...winning.map(c => (typeof c.linePlies === 'number' ? c.linePlies : Number.POSITIVE_INFINITY)));
		const fastest = winning.filter(c => (typeof c.linePlies === 'number' ? c.linePlies : Number.POSITIVE_INFINITY) === minPlies);
		chosen = fastest.length ? fastest[Math.floor(Math.random() * fastest.length)] : winning[0];
	} else {
		allCandidates.sort(compareCandidatesByNetAndLinePlies);
		const bestNet = allCandidates[0] ? allCandidates[0].netResult : -Infinity;
		const bestByNet = allCandidates.filter(t => t.netResult === bestNet);
		let bestMoves = bestByNet.length ? bestByNet : [];
		if (bestMoves.length > 1 && bestNet > 0) {
			const minPlies = Math.min(...bestMoves.map(m => (typeof m.linePlies === 'number' ? m.linePlies : Number.POSITIVE_INFINITY)));
			bestMoves = bestMoves.filter(m => (typeof m.linePlies === 'number' ? m.linePlies : Number.POSITIVE_INFINITY) === minPlies);
		} else if (bestMoves.length > 1 && bestNet < 0) {
			const maxPlies = Math.max(...bestMoves.map(m => (typeof m.linePlies === 'number' ? m.linePlies : Number.NEGATIVE_INFINITY)));
			bestMoves = bestMoves.filter(m => (typeof m.linePlies === 'number' ? m.linePlies : Number.NEGATIVE_INFINITY) === maxPlies);
		}
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
			branches: cumulativeBranches
		});
	}
	if (debug) {
		try {
			console.log('[AI debug] budget', {
				aiStrength,
				computationBudget,
				effectiveDepth,
				depthBranches,
				cumulativeBranches,
				depthCounts
			});
		} catch { /* ignore */ }
		let ordered = allCandidates.slice().sort(compareCandidatesByNetAndLinePlies);
		if (chosen) {
			const chosenIdx = ordered.findIndex(c => c.r === chosen.r && c.c === chosen.c && c.isInitial === chosen.isInitial);
			if (chosenIdx > 0) {
				const [chosenEntry] = ordered.splice(chosenIdx, 1);
				ordered.unshift(chosenEntry);
			}
		}
		const steps = (chosen && chosen.searchScore === Infinity && typeof chosen.linePlies === 'number') ? chosen.linePlies : effectiveDepth;
		const branches = cumulativeBranches;
		const endTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
		const elapsedMs = endTime - startTime;
		const stepsPerSec = (typeof branches === 'number' && elapsedMs > 0) ? (branches / (elapsedMs / 1000)) : undefined;
		const currentAtkDef = computeAtkDefForGrid(grid, gridSize, activeColors, cellExplodeThreshold, playerIndex);
		result.debugInfo = {
			chosen: chosen ? {
				r: chosen.r, c: chosen.c, src: chosen.srcVal, expl: chosen.explosions, gain: chosen.searchScore, atk: chosen.atk, def: chosen.def, linePlies: chosen.linePlies
			} : null,
			ordered: ordered.map(c => ({ r: c.r, c: c.c, src: c.srcVal, expl: c.explosions, gain: c.searchScore, atk: c.atk, def: c.def, linePlies: c.linePlies })),
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


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

/** @typedef {{r:number,c:number,isInitial:boolean,srcVal:number,sortKey:number}} Candidate */
/** @typedef {{r:number,c:number,isInitial:boolean,srcVal:number,explosions:number,immediateGain:number,resultGrid:any,resultInitial:boolean[],runaway:boolean,searchScore?:number,winPlies?:number,atk?:number,def?:number,netResult?:number,finalGrid?:any}} Evaluated */

/**
 * Build Zobrist hashing tables for a given grid size and palette.
 * @param {number} gridSize
 * @param {number} playerCount
 * @param {number} maxCellValue
 */
function buildZobristTable(gridSize, playerCount, maxCellValue) {
	const seed = 0xC0FFEE;
	let t = seed >>> 0;
	const next32 = () => {
		t += 0x6D2B79F5;
		let x = t;
		x = Math.imul(x ^ (x >>> 15), x | 1);
		x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
		return (x ^ (x >>> 14)) >>> 0;
	};
	const next64 = () => (BigInt(next32()) << 32n) ^ BigInt(next32());
	const ownerCount = playerCount + 1; // +1 for empty
	const cellHash = new Array(gridSize);
	for (let r = 0; r < gridSize; r++) {
		cellHash[r] = new Array(gridSize);
		for (let c = 0; c < gridSize; c++) {
			cellHash[r][c] = new Array(ownerCount);
			for (let o = 0; o < ownerCount; o++) {
				cellHash[r][c][o] = new Array(maxCellValue + 1);
				for (let v = 0; v <= maxCellValue; v++) {
					cellHash[r][c][o][v] = next64();
				}
			}
		}
	}
	const placementHash = new Array(playerCount);
	for (let i = 0; i < playerCount; i++) placementHash[i] = next64();
	const moverHash = new Array(playerCount + 1);
	for (let i = 0; i < moverHash.length; i++) moverHash[i] = next64();
	return { cellHash, placementHash, moverHash };
}

/**
 * Compute a Zobrist hash for a simulated game state.
 * @param {Array<Array<{value:number,player:string}>>} simGrid
 * @param {boolean[]} simInitialPlacements
 * @param {number} moverIndex
 * @param {Map<string, number>} colorIndexMap
 * @param {number} gridSize
 * @param {number} maxCellValue
 * @param {{cellHash: BigInt[][][][], placementHash: BigInt[], moverHash: BigInt[]}} zobrist
 * @returns {bigint}
 */
function computeZobristHash(simGrid, simInitialPlacements, moverIndex, colorIndexMap, gridSize, maxCellValue, zobrist) {
	let hash = 0n;
	const emptyOwner = colorIndexMap.size; // empty is last index
	for (let r = 0; r < gridSize; r++) {
		for (let c = 0; c < gridSize; c++) {
			const cell = simGrid[r][c];
			const owner = cell.player ? (colorIndexMap.get(cell.player) ?? emptyOwner) : emptyOwner;
			const value = Math.max(0, Math.min(maxCellValue, cell.value));
			hash ^= zobrist.cellHash[r][c][owner][value];
		}
	}
	for (let i = 0; i < simInitialPlacements.length; i++) {
		if (simInitialPlacements[i]) hash ^= zobrist.placementHash[i];
	}
	const moverIdx = moverIndex + 1; // -1 maps to 0
	hash ^= zobrist.moverHash[Math.max(0, Math.min(zobrist.moverHash.length - 1, moverIdx))];
	return hash;
}

function clampIndex(value, max) {
	if (value < 0) return 0;
	if (value > max) return max;
	return value;
}

function updateMoverHash(hash, prevMoverIndex, nextMoverIndex, zobrist) {
	const maxIdx = zobrist.moverHash.length - 1;
	const prevIdx = clampIndex(prevMoverIndex + 1, maxIdx);
	const nextIdx = clampIndex(nextMoverIndex + 1, maxIdx);
	return hash ^ zobrist.moverHash[prevIdx] ^ zobrist.moverHash[nextIdx];
}

function updateCellHash(hash, r, c, prevOwner, prevValue, nextOwner, nextValue, zobrist) {
	if (prevOwner === nextOwner && prevValue === nextValue) return hash;
	return hash ^ zobrist.cellHash[r][c][prevOwner][prevValue] ^ zobrist.cellHash[r][c][nextOwner][nextValue];
}

function simulateExplosionsWithHash(simGrid, simInitialPlacements, gridSize, maxCellValue, maxExplosionsToAssumeLoop, hash, zobrist, colorIndexMap) {
	let explosionCount = 0;
	let iteration = 0;
	const emptyOwner = colorIndexMap.size;
	const getOwner = (player) => (player ? (colorIndexMap.get(player) ?? emptyOwner) : emptyOwner);
	while (true) {
		iteration++;
		if (iteration > maxExplosionsToAssumeLoop) {
			return { grid: simGrid, explosionCount, runaway: true, hash };
		}
		const cellsToExplode = [];
		for (let i = 0; i < gridSize; i++) {
			for (let j = 0; j < gridSize; j++) {
				if (simGrid[i][j].value >= 4) {
					cellsToExplode.push({ row: i, col: j, player: simGrid[i][j].player, value: simGrid[i][j].value });
				}
			}
		}
		if (!cellsToExplode.length) break;
		explosionCount += cellsToExplode.length;
		for (const cell of cellsToExplode) {
			const { row, col, player, value } = cell;
			const explosionValue = value - 3;
			const prevOwner = getOwner(simGrid[row][col].player);
			hash = updateCellHash(hash, row, col, prevOwner, simGrid[row][col].value, prevOwner, 0, zobrist);
			simGrid[row][col].value = 0;
			const isInitialPlacementPhase = !simInitialPlacements.every(v => v);
			let extraBackToOrigin = 0;
			const targets = [];
			if (row > 0) targets.push({ r: row - 1, c: col }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			if (row < gridSize - 1) targets.push({ r: row + 1, c: col }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			if (col > 0) targets.push({ r: row, c: col - 1 }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			if (col < gridSize - 1) targets.push({ r: row, c: col + 1 }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			for (const t of targets) {
				const prevCell = simGrid[t.r][t.c];
				const prevVal = prevCell.value;
				const nextVal = Math.min(maxCellValue, prevVal + explosionValue);
				const prevOwnerIdx = getOwner(prevCell.player);
				const nextOwnerIdx = getOwner(player);
				hash = updateCellHash(hash, t.r, t.c, prevOwnerIdx, prevVal, nextOwnerIdx, nextVal, zobrist);
				prevCell.value = nextVal;
				prevCell.player = player;
			}
			if (extraBackToOrigin && isInitialPlacementPhase) {
				const prevCell = simGrid[row][col];
				const prevVal = prevCell.value;
				const nextVal = Math.min(maxCellValue, prevVal + extraBackToOrigin);
				const prevOwnerIdx = getOwner(prevCell.player);
				const nextOwnerIdx = getOwner(player);
				hash = updateCellHash(hash, row, col, prevOwnerIdx, prevVal, nextOwnerIdx, nextVal, zobrist);
				prevCell.value = nextVal;
				prevCell.player = player;
			}
		}
	}
	return { grid: simGrid, explosionCount, runaway: false, hash };
}

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

function applyMoveAndSimWithHash(simGridInput, simInitialPlacementsInput, moverIndex, moveR, moveC, isInitialMove, gridSize, maxCellValue, initialPlacementValue, activeColors, maxExplosionsToAssumeLoop, hash, zobrist, colorIndexMap) {
	const simGrid = deepCloneGrid(simGridInput, gridSize);
	const simInitial = simInitialPlacementsInput.slice();
	const emptyOwner = colorIndexMap.size;
	const getOwner = (player) => (player ? (colorIndexMap.get(player) ?? emptyOwner) : emptyOwner);
	let nextHash = hash;
	if (isInitialMove && !simInitial[moverIndex]) {
		simInitial[moverIndex] = true;
		nextHash ^= zobrist.placementHash[moverIndex];
	}
	const prevCell = simGrid[moveR][moveC];
	const prevOwner = getOwner(prevCell.player);
	if (isInitialMove) {
		const nextOwner = getOwner(activeColors()[moverIndex]);
		nextHash = updateCellHash(nextHash, moveR, moveC, prevOwner, prevCell.value, nextOwner, initialPlacementValue, zobrist);
		prevCell.value = initialPlacementValue;
		prevCell.player = activeColors()[moverIndex];
	} else {
		const nextOwner = getOwner(activeColors()[moverIndex]);
		const nextVal = Math.min(maxCellValue, prevCell.value + 1);
		nextHash = updateCellHash(nextHash, moveR, moveC, prevOwner, prevCell.value, nextOwner, nextVal, zobrist);
		prevCell.value = nextVal;
		prevCell.player = activeColors()[moverIndex];
	}
	const result = simulateExplosionsWithHash(simGrid, simInitial, gridSize, maxCellValue, maxExplosionsToAssumeLoop, nextHash, zobrist, colorIndexMap);
	return { grid: result.grid, explosionCount: result.explosionCount, runaway: result.runaway, simInitial, hash: result.hash };
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
function minimaxEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, depth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts, stateHash) {
	const { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, transpositionTable, transpositionStats, colorIndexMap, zobrist } = opts;
	let transpositionKey;
	let preferredMove;
	if (transpositionTable && colorIndexMap && zobrist) {
		transpositionKey = stateHash ?? computeZobristHash(simGridInput, simInitialPlacementsInput, moverIndex, colorIndexMap, gridSize, maxCellValue, zobrist);
		const cached = transpositionTable.get(transpositionKey);
		if (cached && typeof cached.depth === 'number' && cached.depth >= depth && cached.move) {
			if (transpositionStats) transpositionStats.hits++;
			preferredMove = cached.move;
		}
	}
	// Avoid terminal mis-detection during initial placement phase
	const inInitialPlacementPhase = !simInitialPlacementsInput.every(v => v);
	if (!inInitialPlacementPhase) {
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
			if (soleIdx === focusPlayerIndex) return { value: Infinity, runaway: true, stepsToInfinity: 1, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
			return { value: -Infinity, runaway: true, stepsToInfinity: 1, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
		}
	}
	if (depth === 0) {
		const value = totalOwnedOnGrid(simGridInput, focusPlayerIndex, activeColors, gridSize);
		return { value, runaway: false, bestGrid: simGridInput, branchCount: 1, prunedCount: 0 };
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
	if (preferredMove) {
		const filtered = candidates.filter(c => c.r === preferredMove.r && c.c === preferredMove.c && c.isInitial === preferredMove.isInitial && c.owner === preferredMove.owner);
		if (filtered.length) candidates = filtered;
	}
	if (!candidates.length) {
		const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
		const nextHash = (typeof transpositionKey === 'bigint' && zobrist) ? updateMoverHash(transpositionKey, moverIndex, nextMover, zobrist) : undefined;
		const res = minimaxEvaluate(simGrid, simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts, nextHash);
		return res;
	}
	const evaluated = [];
	const maxExplosionsToAssumeLoop = gridSize * 3;
	for (const cand of candidates) {
		const baseHash = (typeof transpositionKey === 'bigint') ? transpositionKey : computeZobristHash(simGrid, simInitial, moverIndex, colorIndexMap, gridSize, maxCellValue, zobrist);
		const applied = applyMoveAndSimWithHash(simGrid, simInitial, cand.owner, cand.r, cand.c, cand.isInitial, gridSize, maxCellValue, initialPlacementValue, activeColors, maxExplosionsToAssumeLoop, baseHash, zobrist, colorIndexMap);
		const val = totalOwnedOnGrid(applied.grid, focusPlayerIndex, activeColors, gridSize);
		if (applied.runaway) {
			const runawayVal = (cand.owner === focusPlayerIndex) ? Infinity : -Infinity;
			const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
			const resultHash = updateMoverHash(applied.hash, moverIndex, nextMover, zobrist);
			evaluated.push({ cand, owner: cand.owner, value: runawayVal, resultGrid: applied.grid, simInitial: applied.simInitial, hash: resultHash });
		} else {
			const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
			const resultHash = updateMoverHash(applied.hash, moverIndex, nextMover, zobrist);
			evaluated.push({ cand, owner: cand.owner, value: val, resultGrid: applied.grid, simInitial: applied.simInitial, hash: resultHash });
		}
	}
	evaluated.sort((a, b) => isFocusTurn ? (b.value - a.value) : (a.value - b.value));
	const topCandidates = evaluated;
	const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
	let bestValue = isFocusTurn ? -Infinity : Infinity; let bestSteps; let bestGrid = simGridInput; let branchCount = 0; let prunedCount = 0; let bestMove;
	for (let i = 0; i < topCandidates.length; i++) {
		const entry = topCandidates[i];
		if (entry.value === Infinity) {
			prunedCount += Math.max(0, topCandidates.length - (i + 1));
			if (transpositionTable && typeof transpositionKey === 'bigint') {
				transpositionTable.set(transpositionKey, { depth, move: { r: entry.cand.r, c: entry.cand.c, isInitial: entry.cand.isInitial, owner: entry.cand.owner } });
				if (transpositionStats) transpositionStats.stores++;
			}
			return { value: isFocusTurn ? Infinity : -Infinity, runaway: true, stepsToInfinity: 1, bestGrid: entry.resultGrid, branchCount: 1, prunedCount };
		}
		if (entry.value === -Infinity) {
			prunedCount += Math.max(0, topCandidates.length - (i + 1));
			if (transpositionTable && typeof transpositionKey === 'bigint') {
				transpositionTable.set(transpositionKey, { depth, move: { r: entry.cand.r, c: entry.cand.c, isInitial: entry.cand.isInitial, owner: entry.cand.owner } });
				if (transpositionStats) transpositionStats.stores++;
			}
			return { value: isFocusTurn ? Infinity : -Infinity, runaway: true, stepsToInfinity: 1, bestGrid: entry.resultGrid, branchCount: 1, prunedCount };
		}
		const child = minimaxEvaluate(entry.resultGrid, entry.simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts, entry.hash);
		branchCount += typeof child.branchCount === 'number' ? child.branchCount : 1;
		prunedCount += typeof child.prunedCount === 'number' ? child.prunedCount : 0;
		const value = child.value; const childSteps = typeof child.stepsToInfinity === 'number' ? child.stepsToInfinity + 1 : undefined;
		if (isFocusTurn) {
			if (value > bestValue || (value === bestValue && value === Infinity && (bestSteps === undefined || (childSteps < bestSteps)))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
				bestMove = entry.cand;
			}
			alpha = Math.max(alpha, bestValue);
			if (alpha >= beta) {
				prunedCount += Math.max(0, topCandidates.length - (i + 1));
				break;
			}
		} else {
			if (value < bestValue || (value === bestValue && value === Infinity && (bestSteps === undefined || (childSteps > bestSteps)))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
				bestMove = entry.cand;
			}
			beta = Math.min(beta, bestValue);
			if (beta <= alpha) {
				prunedCount += Math.max(0, topCandidates.length - (i + 1));
				break;
			}
		}
	}
	const isInf = (bestValue === Infinity || bestValue === -Infinity);
	if (transpositionTable && typeof transpositionKey === 'bigint' && bestMove) {
		transpositionTable.set(transpositionKey, { depth, move: { r: bestMove.r, c: bestMove.c, isInitial: bestMove.isInitial, owner: bestMove.owner } });
		if (transpositionStats) transpositionStats.stores++;
	}
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
 *    - Immediate material gain (difference in total owned value).
 *    - Explosion count (for tie‑breaking / heuristic flavor).
 *    - Runaway flag (detected explosion loop exceeding a bounded iteration).
 * 3. Order candidates by (immediateGain DESC, atk DESC, def DESC).
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
 *     branches?:number,
 *     transpositionHits?:number,
 *     transpositionStores?:number
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
	const { maxCellValue, initialPlacementValue, aiStrength, cellExplodeThreshold, debug, benchmark } = config;
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
	const colors = activeColors();
	const colorIndexMap = new Map(colors.map((color, idx) => [color, idx]));
	const transpositionTable = new Map();
	const transpositionStats = { hits: 0, stores: 0 };
	const zobrist = buildZobristTable(gridSize, colors.length, maxCellValue);
	const rootHash = computeZobristHash(grid, initialPlacements, playerIndex, colorIndexMap, gridSize, maxCellValue, zobrist);
	const beforeTotal = totalOwnedOnGrid(grid, playerIndex, activeColors, gridSize);
	for (const cand of candidates) {
		const res = applyMoveAndSimWithHash(grid, initialPlacements, playerIndex, cand.r, cand.c, cand.isInitial, gridSize, maxCellValue, initialPlacementValue, activeColors, maxExplosionsToAssumeLoop, rootHash, zobrist, colorIndexMap);
		const atkDef = computeAtkDefForGrid(res.grid, gridSize, activeColors, cellExplodeThreshold, playerIndex);
		const nextMover = -1;
		const resultHash = updateMoverHash(res.hash, playerIndex, nextMover, zobrist);
		evaluated.push({
			r: cand.r,
			c: cand.c,
			isInitial: cand.isInitial,
			srcVal: cand.srcVal,
			immediateGain: (res.runaway ? Infinity : (totalOwnedOnGrid(res.grid, playerIndex, activeColors, gridSize) - beforeTotal)),
			explosions: res.explosionCount,
			atk: atkDef.atk,
			def: atkDef.def,
			resultGrid: res.grid,
			resultInitial: res.simInitial,
			runaway: res.runaway,
			hash: resultHash
		});
	}
	mark('simulate');
	const allCandidates = evaluated.slice();
	const depthOpts = { gridSize, activeColors, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount, transpositionTable, transpositionStats, colorIndexMap, zobrist };
	let effectiveDepth = 1;
	let totalBranches = 0;
	const depthCounts = [];
	for (let depth = 1; totalBranches < computationBudget; depth++) {
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
				const evalRes = minimaxEvaluate(cand.resultGrid, cand.resultInitial, nextMover, Math.max(0, depth - 1), -Infinity, Infinity, playerIndex, playerIndex, depthOpts, cand.hash);
				const before = totalOwnedOnGrid(grid, playerIndex, activeColors, gridSize);
				cand.searchScore = (evalRes.value === Infinity || evalRes.value === -Infinity) ? evalRes.value : (evalRes.value - before);
				if (evalRes.value === Infinity && typeof evalRes.stepsToInfinity === 'number') cand.winPlies = evalRes.stepsToInfinity;
				cand.finalGrid = evalRes.bestGrid || cand.resultGrid;
				cand.branchCount = evalRes.branchCount;
				cand.prunedCount = evalRes.prunedCount;
			}
			totalBranches += (typeof cand.branchCount === 'number' ? cand.branchCount : 1);
			totalPruned += (typeof cand.prunedCount === 'number' ? cand.prunedCount : 0);
		}
		depthCounts.push({ depth, count: totalBranches, pruned: totalPruned });
		effectiveDepth = depth;
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
		const atkDef = computeAtkDefForGrid(rg, gridSize, activeColors, cellExplodeThreshold, playerIndex);
		cand.def = atkDef.def;
		cand.atk = atkDef.atk;
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
		allCandidates.sort((a, b) => (b.netResult - a.netResult) || (b.atk - a.atk) || (b.def - a.def));
		const bestNet = allCandidates[0] ? allCandidates[0].netResult : -Infinity;
		const bestByNet = allCandidates.filter(t => t.netResult === bestNet);
		let bestMoves;
		if (bestByNet.length === 1) bestMoves = bestByNet; else {
			const maxAtk = Math.max(...bestByNet.map(t => (typeof t.atk === 'number' ? t.atk : -Infinity)));
			const byAtk = bestByNet.filter(t => (typeof t.atk === 'number' ? t.atk : -Infinity) === maxAtk);
			if (byAtk.length === 1) bestMoves = byAtk; else {
				const maxDef = Math.max(...byAtk.map(t => (typeof t.def === 'number' ? t.def : -Infinity)));
				bestMoves = byAtk.filter(t => (typeof t.def === 'number' ? t.def : -Infinity) === maxDef);
			}
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
			branches: totalBranches,
			transpositionHits: transpositionStats.hits,
			transpositionStores: transpositionStats.stores
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
				return (b.netResult - a.netResult) || (b.atk - a.atk) || (b.def - a.def);
			});
		} else {
			ordered = ordered.slice().sort((a, b) => (b.netResult - a.netResult) || (b.atk - a.atk) || (b.def - a.def));
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
			depthCounts,
			elapsedMs,
			stepsPerSec,
			currentAtk: currentAtkDef.atk,
			currentDef: currentAtkDef.def
		};
	}
	return result;
}


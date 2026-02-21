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
 *     dataRespectK: number,           // branch factor limit
 *     aiDepth: number,                // plies to search
 *     cellExplodeThreshold: number,   // near-explosion threshold (value - 1 used)
 *     gridSize: number,               // redundancy for convenience
 *     debug?: boolean
 *   }
 *
 * Returns: {
 *   chosen: { r:number, c:number, isInitial:boolean, srcVal:number } | null,
 *   requireAdvanceTurn: boolean,      // true if AI should advance turn (no move)
 *   scheduleGameEnd: boolean,         // true if game end should be scheduled
 *   debugInfo?: { ordered:Array<DebugEntry>, topK:number, chosen?:DebugChosen }
 * }
 *
 * No side-effects: caller applies move or advances turn.
 */

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
 * Run explosion propagation on a simulated grid until stable or runaway detected.
 * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
 * @param {boolean[]} simInitialPlacements - initial placement flags.
 * @returns {{grid: Array<Array<{value:number,player:string}>>, explosionCount: number, runaway: boolean}} updated grid, number of explosions, runaway flag.
 */
function simulateExplosions(simGrid, simInitialPlacements, gridSize, maxCellValue, maxExplosionsToAssumeLoop) {
	let explosionCount = 0;
	let iteration = 0;
	while (true) {
		iteration++;
		if (iteration > maxExplosionsToAssumeLoop) {
			return { grid: simGrid, explosionCount, runaway: true };
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
			simGrid[row][col].value = 0;
			const isInitialPlacementPhase = !simInitialPlacements.every(v => v);
			let extraBackToOrigin = 0;
			const targets = [];
			if (row > 0) targets.push({ r: row - 1, c: col }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			if (row < gridSize - 1) targets.push({ r: row + 1, c: col }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			if (col > 0) targets.push({ r: row, c: col - 1 }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			if (col < gridSize - 1) targets.push({ r: row, c: col + 1 }); else if (isInitialPlacementPhase) extraBackToOrigin++;
			for (const t of targets) {
				const prev = simGrid[t.r][t.c].value;
				simGrid[t.r][t.c].value = Math.min(maxCellValue, prev + explosionValue);
				simGrid[t.r][t.c].player = player;
			}
			if (extraBackToOrigin && isInitialPlacementPhase) {
				const prev = simGrid[row][col].value;
				simGrid[row][col].value = Math.min(maxCellValue, prev + extraBackToOrigin);
				simGrid[row][col].player = player;
			}
		}
	}
	return { grid: simGrid, explosionCount, runaway: false };
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
function applyMoveAndSim(simGridInput, simInitialPlacementsInput, moverIndex, moveR, moveC, isInitialMove, gridSize, maxCellValue, initialPlacementValue, activeColors, maxExplosionsToAssumeLoop) {
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
	const result = simulateExplosions(simGrid, simInitial, gridSize, maxCellValue, maxExplosionsToAssumeLoop);
	return { grid: result.grid, explosionCount: result.explosionCount, runaway: result.runaway, simInitial };
}

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
 * @returns {{value:number, runaway:boolean, stepsToInfinity?:number, bestGrid:Array<Array<{value:number,player:string}>>}} evaluation score for focus player and plies to +/-Infinity if detected.
 */
function minimaxEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, depth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts) {
	const { gridSize, activeColors, dataRespectK, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount } = opts;
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
			if (soleIdx === focusPlayerIndex) return { value: Infinity, runaway: true, stepsToInfinity: 0, bestGrid: simGridInput };
			return { value: -Infinity, runaway: true, stepsToInfinity: 0, bestGrid: simGridInput };
		}
	}
	if (depth === 0) {
		return { value: totalOwnedOnGrid(simGridInput, focusPlayerIndex, activeColors, gridSize), runaway: false, bestGrid: simGridInput };
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
		const applied = applyMoveAndSim(simGrid, simInitial, cand.owner, cand.r, cand.c, cand.isInitial, gridSize, maxCellValue, initialPlacementValue, activeColors, maxExplosionsToAssumeLoop);
		const val = totalOwnedOnGrid(applied.grid, focusPlayerIndex, activeColors, gridSize);
		if (applied.runaway) {
			const runawayVal = (cand.owner === focusPlayerIndex) ? Infinity : -Infinity;
			evaluated.push({ cand, owner: cand.owner, value: runawayVal, resultGrid: applied.grid, simInitial: applied.simInitial });
		} else {
			evaluated.push({ cand, owner: cand.owner, value: val, resultGrid: applied.grid, simInitial: applied.simInitial });
		}
	}
	evaluated.sort((a, b) => isFocusTurn ? (b.value - a.value) : (a.value - b.value));
	const topCandidates = evaluated.slice(0, Math.min(dataRespectK, evaluated.length));
	const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
	let bestValue = isFocusTurn ? -Infinity : Infinity; let bestSteps; let bestGrid = simGridInput;
	for (const entry of topCandidates) {
		if (entry.value === Infinity) return { value: isFocusTurn ? Infinity : -Infinity, runaway: true, stepsToInfinity: 1, bestGrid: entry.resultGrid };
		if (entry.value === -Infinity) return { value: isFocusTurn ? Infinity : -Infinity, runaway: true, stepsToInfinity: 1, bestGrid: entry.resultGrid };
		const child = minimaxEvaluate(entry.resultGrid, entry.simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex, opts);
		const value = child.value; const childSteps = typeof child.stepsToInfinity === 'number' ? child.stepsToInfinity + 1 : undefined;
		if (isFocusTurn) {
			if (value > bestValue || (value === bestValue && value === Infinity && (bestSteps === undefined || (childSteps < bestSteps)))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
			}
			alpha = Math.max(alpha, bestValue);
			if (alpha >= beta) break;
		} else {
			if (value < bestValue || (value === bestValue && value === Infinity && (bestSteps === undefined || (childSteps > bestSteps)))) {
				bestValue = value; bestSteps = childSteps; bestGrid = child.bestGrid || entry.resultGrid;
			}
			beta = Math.min(beta, bestValue);
			if (beta <= alpha) break;
		}
	}
	const isInf = (bestValue === Infinity || bestValue === -Infinity);
	return { value: bestValue, runaway: isInf, stepsToInfinity: isInf ? bestSteps : undefined, bestGrid };
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
 * 3. Order candidates by (immediateGain DESC, explosions DESC) and keep the
 *    top K (dataRespectK) for deeper search.
 * 4. For each of the top K, perform a minimax search (depth = aiDepth-1) where
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
 * @param {number} config.dataRespectK - Branch factor (top K candidates retained for deep search).
 * @param {number} config.aiDepth - Total search depth (plies) including root.
 * @param {number} config.cellExplodeThreshold - Threshold at/above which a cell explodes (used for heuristics).
 * @param {boolean} [config.debug] - If true, attaches ordered candidate metadata for external UI/debug panels.
 *
 * @returns {{
 *   chosen: {r:number,c:number,isInitial:boolean,srcVal:number} | null,
 *   requireAdvanceTurn: boolean,
 *   scheduleGameEnd: boolean,
 *   debugInfo?: {
 *     chosen: {r:number,c:number,src:number,expl:number,gain:number,atk?:number,def?:number,winPlies?:number} | null,
 *     ordered: Array<{r:number,c:number,src:number,expl:number,gain:number,atk?:number,def?:number,winPlies?:number}>,
 *     topK: number
 *   }
 * }} Result object: either a chosen move or flags instructing caller to advance/end.
 */
export function computeAIMove(state, config) {
	const { grid, initialPlacements, playerIndex, playerCount, gridSize, activeColors, invalidInitialPositions } = state;
	const { maxCellValue, initialPlacementValue, dataRespectK, aiDepth, cellExplodeThreshold, debug } = config;
	const maxExplosionsToAssumeLoop = gridSize * 3;

	const candidates = generateCandidatesOnSim(grid, initialPlacements, playerIndex, gridSize, activeColors, invalidInitialPositions);
	if (!candidates.length) {
		return { chosen: null, requireAdvanceTurn: true, scheduleGameEnd: !initialPlacements[playerIndex] };
	}
	const evaluated = [];
	for (const cand of candidates) {
		const res = applyMoveAndSim(grid, initialPlacements, playerIndex, cand.r, cand.c, cand.isInitial, gridSize, maxCellValue, initialPlacementValue, activeColors, maxExplosionsToAssumeLoop);
		evaluated.push({
			r: cand.r,
			c: cand.c,
			isInitial: cand.isInitial,
			srcVal: cand.srcVal,
			immediateGain: (res.runaway ? Infinity : (totalOwnedOnGrid(res.grid, playerIndex, activeColors, gridSize) - totalOwnedOnGrid(grid, playerIndex, activeColors, gridSize))),
			explosions: res.explosionCount,
			resultGrid: res.grid,
			resultInitial: res.simInitial,
			runaway: res.runaway
		});
	}
	evaluated.sort((a, b) => b.immediateGain - a.immediateGain || b.explosions - a.explosions);
	const topK = evaluated.slice(0, Math.min(dataRespectK, evaluated.length));
	for (const cand of topK) {
		if (cand.runaway) {
			cand.searchScore = (cand.immediateGain === Infinity) ? Infinity : -Infinity;
			if (cand.searchScore === Infinity) cand.winPlies = 1;
			cand.finalGrid = cand.resultGrid;
		} else {
			const nextMover = -1;
			const evalRes = minimaxEvaluate(cand.resultGrid, cand.resultInitial, nextMover, aiDepth - 1, -Infinity, Infinity, playerIndex, playerIndex, {
				gridSize, activeColors, dataRespectK, maxCellValue, initialPlacementValue, invalidInitialPositions, playerCount
			});
			const before = totalOwnedOnGrid(grid, playerIndex, activeColors, gridSize);
			cand.searchScore = (evalRes.value === Infinity || evalRes.value === -Infinity) ? evalRes.value : (evalRes.value - before);
			if (evalRes.value === Infinity && typeof evalRes.stepsToInfinity === 'number') cand.winPlies = evalRes.stepsToInfinity;
			cand.finalGrid = evalRes.bestGrid || cand.resultGrid;
		}
	}
	for (const cand of topK) {
		const rg = cand.finalGrid || cand.resultGrid; const aiColor = activeColors()[playerIndex]; const nearVal = cellExplodeThreshold - 1; let def = 0, atk = 0;
		const playerColor = activeColors()[0]; // assume humanPlayer === 0
		for (let r = 0; r < gridSize; r++) {
			for (let c = 0; c < gridSize; c++) {
				const cell = rg[r][c];
				if (cell.player === aiColor) {
					if (cell.value === nearVal) def++;
					const adj = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
					for (const [ar, ac] of adj) {
						if (ar < 0 || ar >= gridSize || ac < 0 || ac >= gridSize) continue;
						const adjCell = rg[ar][ac];
						if (adjCell.player === playerColor && cell.value > adjCell.value) atk++;
					}
				}
			}
		}
		cand.def = def; cand.atk = atk; cand.netResult = (typeof cand.searchScore === 'number' ? cand.searchScore : cand.immediateGain);
	}
	const winning = topK.filter(c => c.searchScore === Infinity);
	let chosen;
	if (winning.length) {
		const minPlies = Math.min(...winning.map(c => (typeof c.winPlies === 'number' ? c.winPlies : Number.POSITIVE_INFINITY)));
		const fastest = winning.filter(c => (typeof c.winPlies === 'number' ? c.winPlies : Number.POSITIVE_INFINITY) === minPlies);
		chosen = fastest.length ? fastest[Math.floor(Math.random() * fastest.length)] : winning[0];
	} else {
		topK.sort((a, b) => (b.netResult - a.netResult) || (b.atk - a.atk) || (b.def - a.def));
		const bestNet = topK[0] ? topK[0].netResult : -Infinity;
		const bestByNet = topK.filter(t => t.netResult === bestNet);
		let bestMoves;
		if (bestByNet.length === 1) bestMoves = bestByNet; else {
			const maxAtk = Math.max(...bestByNet.map(t => (typeof t.atk === 'number' ? t.atk : -Infinity)));
			const byAtk = bestByNet.filter(t => (typeof t.atk === 'number' ? t.atk : -Infinity) === maxAtk);
			if (byAtk.length === 1) bestMoves = byAtk; else {
				const maxDef = Math.max(...byAtk.map(t => (typeof t.def === 'number' ? t.def : -Infinity)));
				bestMoves = byAtk.filter(t => (typeof t.def === 'number' ? t.def : -Infinity) === maxDef);
			}
		}
		if (!bestMoves || !bestMoves.length) bestMoves = topK.length ? [topK[0]] : [];
		chosen = bestMoves.length ? bestMoves[Math.floor(Math.random() * bestMoves.length)] : null;
	}
	const result = {
		chosen: chosen ? { r: chosen.r, c: chosen.c, isInitial: chosen.isInitial, srcVal: chosen.srcVal } : null,
		requireAdvanceTurn: !chosen,
		scheduleGameEnd: !chosen && !initialPlacements[playerIndex]
	};
	if (debug) {
		let ordered = topK.slice();
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
		const steps = (chosen && chosen.searchScore === Infinity && typeof chosen.winPlies === 'number') ? chosen.winPlies : aiDepth;
		result.debugInfo = {
			chosen: chosen ? {
				r: chosen.r, c: chosen.c, src: chosen.srcVal, expl: chosen.explosions, gain: chosen.searchScore, atk: chosen.atk, def: chosen.def, winPlies: chosen.winPlies
			} : null,
			ordered: ordered.map(c => ({ r: c.r, c: c.c, src: c.srcVal, expl: c.explosions, gain: c.searchScore, atk: c.atk, def: c.def, winPlies: c.winPlies })),
			steps,
			topK: topK.length
		};
	}
	return result;
}


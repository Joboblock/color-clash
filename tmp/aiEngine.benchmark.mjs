import { performance } from 'node:perf_hooks';
import { computeAIMove } from '../src/ai/engine.js';
import { computeInvalidInitialPositions } from '../src/game/gridCalc.js';
import { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD } from '../src/config/index.js';

const rng = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

const createGrid = (size, colors, density = 0.35) => {
	const grid = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ value: 0, player: '' })));
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			if (Math.random() > density) continue;
			grid[r][c].player = colors[rng(0, colors.length - 1)];
			grid[r][c].value = rng(1, 3);
		}
	}
	return grid;
};

const ensureOwnedCell = (grid, size, color) => {
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			if (grid[r][c].player === color) return;
		}
	}
	const r = rng(0, size - 1);
	const c = rng(0, size - 1);
	grid[r][c].player = color;
	grid[r][c].value = 1;
};

const summarize = (values) => {
	const total = values.reduce((sum, v) => sum + v, 0);
	const avg = values.length ? total / values.length : 0;
	const min = values.length ? Math.min(...values) : 0;
	const max = values.length ? Math.max(...values) : 0;
	return { avg, min, max };
};

const runCase = ({ name, gridSize, aiStrength, initialPlacement, prePlacedMoves = [] }) => {
	const colors = ['green', 'red', 'blue', 'yellow'];
	const playerIndex = 0;
	const invalidInitialPositions = computeInvalidInitialPositions(gridSize);
	const iterations = 20;
	const totals = {
		candidateGenMs: [],
		simulateMs: [],
		searchMs: [],
		finalizeMs: [],
		selectMs: [],
		totalMs: []
	};
	const allTimes = [];

	for (let i = 0; i < iterations; i++) {
		const grid = createGrid(gridSize, colors);
		for (const move of prePlacedMoves) {
			if (!grid[move.row] || !grid[move.row][move.col]) continue;
			grid[move.row][move.col].player = move.player;
			grid[move.row][move.col].value = move.value ?? 1;
		}
		ensureOwnedCell(grid, gridSize, colors[playerIndex]);
		const initialPlacements = colors.map((_, idx) => initialPlacement ? true : idx !== playerIndex);
		const state = {
			grid,
			initialPlacements,
			playerIndex,
			playerCount: colors.length,
			gridSize,
			activeColors: () => colors,
			invalidInitialPositions
		};
		const config = {
			maxCellValue: MAX_CELL_VALUE,
			initialPlacementValue: INITIAL_PLACEMENT_VALUE,
			aiStrength,
			cellExplodeThreshold: CELL_EXPLODE_THRESHOLD,
			benchmark: true
		};
		const t0 = performance.now();
		const result = computeAIMove(state, config);
		const t1 = performance.now();
		allTimes.push(t1 - t0);
		if (!result.benchmarkInfo) continue;
		for (const key of Object.keys(totals)) {
			if (typeof result.benchmarkInfo[key] === 'number') {
				totals[key].push(result.benchmarkInfo[key]);
			}
		}
	}

	console.log(`\nCase: ${name}`);
	console.log(`Grid ${gridSize}x${gridSize}, aiStrength=${aiStrength}, initialPlacement=${initialPlacement}`);
	for (const [key, values] of Object.entries(totals)) {
		const stats = summarize(values);
		console.log(`  ${key}: avg=${stats.avg.toFixed(2)}ms min=${stats.min.toFixed(2)}ms max=${stats.max.toFixed(2)}ms`);
	}
	const overall = summarize(allTimes);
	console.log(`  wallClockMs: avg=${overall.avg.toFixed(2)}ms min=${overall.min.toFixed(2)}ms max=${overall.max.toFixed(2)}ms`);
};

runCase({ name: 'Midgame', gridSize: 6, aiStrength: 6, initialPlacement: true });
runCase({
	name: 'Initial placement',
	gridSize: 5,
	aiStrength: 5,
	initialPlacement: false,
	prePlacedMoves: [{ row: 3, col: 1, player: 'green', value: 1 }]
});

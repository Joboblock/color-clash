import test from 'node:test';
import assert from 'node:assert/strict';

import { getNoisyCells } from '../src/ai/engine.js';

const threshold = 4;
const gridSize = 5;

const asKeySet = (cells) => new Set(cells.map(({ r, c }) => `${r},${c}`));
const expectNoisy = (grid, expectedKeys) => {
	const actual = asKeySet(getNoisyCells(grid, gridSize, threshold));
	const expected = new Set(expectedKeys.map(([r, c]) => `${r},${c}`));
	assert.deepEqual(actual, expected);
};

test('noisy cells: adjacent nearVal chains case', () => {
	const grid = [
		[
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 1, player: 'red' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 2, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[0, 1],
		[1, 1],
		[2, 1]
	]);
});

test('noisy cells: chain adjacency via nearVal-1', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 0, player: '' },
			{ value: 1, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 2, player: 'green' },
			{ value: 3, player: 'red' },
			{ value: 2, player: 'red' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 2, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[2, 1],
		[3, 1],
		[3, 2],
		[3, 0],
		[2, 3]
	]);
});

test('noisy cells: diagonal chain pressure', () => {
	const grid = [
		[
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' },
			{ value: 2, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 2, player: 'red' },
			{ value: 1, player: 'red' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 2, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[0, 1],
		[1, 0],
		[2, 0],
		[2, 1]
	]);
});

test('noisy cells: mixed chain pressure', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 1, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 2, player: 'green' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[2, 0],
		[2, 1],
		[2, 2],
		[3, 1],
		[3, 3],
		[3, 4],
		[4, 2],
		[4, 3]
	]);
});

test('noisy cells: isolated nearVal should be quiet', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 2, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 1, player: 'green' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 0, player: '' },
			{ value: 1, player: 'green' },
			{ value: 2, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 2, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 2, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, []);
});

test('noisy cells: mixed opposing chains with red pressure', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 2, player: 'red' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' },
			{ value: 2, player: 'red' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 2, player: 'green' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 1, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[2, 0],
		[2, 1],
		[3, 0],
		[3, 1],
		[4, 1],
		[3, 3],
		[1, 2],
		[2, 3]
	]);
});

test('noisy cells: dense mixed chains', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 1, player: 'red' },
			{ value: 0, player: '' },
			{ value: 1, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 2, player: 'red' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 1, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 1, player: 'red' },
			{ value: 1, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[2, 0],
		[3, 0],
		[3, 1],
		[3, 2],
		[4, 1],
		[4, 2],
		[2, 2],
		[1, 1]
	]);
});

test('noisy cells: quiet mixed cluster should be silent', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 1, player: 'red' },
			{ value: 1, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 2, player: 'red' },
			{ value: 0, player: '' },
			{ value: 1, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 2, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, []);
});

test('noisy cells: quiet mixed cluster', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 2, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 2, player: 'red' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 1, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 2, player: 'green' },
			{ value: 2, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 1, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, []);
});

test('noisy cells: quiet split chains', () => {
	const grid = [
		[
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 2, player: 'red' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 1, player: 'red' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 1, player: 'green' },
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 2, player: 'green' },
			{ value: 1, player: 'red' }
		],
		[
			{ value: 0, player: '' },
			{ value: 1, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, []);
});

test('noisy cells: red mass vs green block', () => {
	const grid = [
		[
			{ value: 1, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 1, player: 'red' },
			{ value: 1, player: 'red' },
			{ value: 1, player: 'red' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 1, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 0, player: '' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[3, 0],
		[3, 1],
		[3, 2],
		[4, 0],
		[4, 1],
		[2, 3]
	]);
});

test('noisy cells: green block with red top row', () => {
	const grid = [
		[
			{ value: 1, player: 'red' },
			{ value: 2, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 3, player: 'red' },
			{ value: 0, player: '' }
		],
		[
			{ value: 0, player: '' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'red' }
		],
		[
			{ value: 3, player: 'green' },
			{ value: 2, player: 'green' },
			{ value: 2, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 2, player: 'green' }
		],
		[
			{ value: 2, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 0, player: '' },
			{ value: 1, player: 'green' }
		],
		[
			{ value: 2, player: 'green' },
			{ value: 2, player: 'green' },
			{ value: 3, player: 'green' },
			{ value: 1, player: 'green' },
			{ value: 0, player: '' }
		]
	];

	expectNoisy(grid, [
		[0, 2],
		[0, 3],
		[1, 1],
		[1, 2],
		[1, 3],
		[2, 0],
		[1, 4],
		[3, 1],
		[3, 2],
		[4, 2]
	]);
});

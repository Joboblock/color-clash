function createEmptyGrid(size) {
	return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function setCell(grid, row, col, value) {
	if (!grid[row] || typeof grid[row][col] === 'undefined') return;
	grid[row][col] = value;
}

function setCellIfNull(grid, row, col, value) {
	if (!grid[row] || typeof grid[row][col] === 'undefined') return;
	if (grid[row][col] !== null) return;
	grid[row][col] = value;
}

function drawTimingPatterns(grid) {
	const size = grid.length;
	for (let i = 0; i < size; i++) {
		const value = i % 2 === 0;
		setCell(grid, 6, i, value);
		setCell(grid, i, 6, value);
	}
}

function drawFinderPattern(grid, top, left, { separatorTop, separatorLeft }) {
	const patternTop = top + (separatorTop ? 1 : 0);
	const patternLeft = left + (separatorLeft ? 1 : 0);

	for (let r = 0; r < 7; r++) {
		for (let c = 0; c < 7; c++) {
			const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
			const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
			const value = isOuter || isInner;
			setCell(grid, patternTop + r, patternLeft + c, value);
		}
	}

	const sepRow = separatorTop ? top : top + 7;
	const sepCol = separatorLeft ? left : left + 7;
	for (let i = 0; i < 8; i++) {
		setCell(grid, sepRow, left + i, false);
		setCell(grid, top + i, sepCol, false);
	}
}

function drawAlignmentPattern(grid, centerRow, centerCol) {
	const top = centerRow - 2;
	const left = centerCol - 2;
	for (let r = 0; r < 5; r++) {
		for (let c = 0; c < 5; c++) {
			const isOuter = r === 0 || r === 4 || c === 0 || c === 4;
			const isCenter = r === 2 && c === 2;
			const value = isOuter || isCenter;
			setCell(grid, top + r, left + c, value);
		}
	}
}

function getAlignmentCenters(version, size) {
	if (!Number.isInteger(version) || version <= 1) return [];
	return [6, size - 7];
}

function drawAlignmentPatterns(grid, version) {
	const size = grid.length;
	const centers = getAlignmentCenters(version, size);
	for (const row of centers) {
		for (const col of centers) {
			const inTopLeft = row <= 8 && col <= 8;
			const inTopRight = row <= 8 && col >= size - 9;
			const inBottomLeft = row >= size - 9 && col <= 8;
			if (inTopLeft || inTopRight || inBottomLeft) continue;
			drawAlignmentPattern(grid, row, col);
		}
	}
}

function drawDummyFormatBits(grid) {
	const size = grid.length;
	const topLeftCoords = [
		[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
		[7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
	];

	const topRightCoords = [];
	for (let c = size - 8; c < size; c++) {
		topRightCoords.push([8, c]);
	}

	const bottomLeftCoords = [];
	for (let r = size - 8; r < size; r++) {
		bottomLeftCoords.push([r, 8]);
	}

	[...topLeftCoords, ...topRightCoords, ...bottomLeftCoords].forEach(([r, c]) => {
		setCellIfNull(grid, r, c, false);
	});
}

export function buildFixedPattern({ version, size } = {}) {
	const finalSize = Number.isInteger(size) ? size : (Number.isInteger(version) ? 21 + 4 * (version - 1) : 21);
	const grid = createEmptyGrid(finalSize);

	drawTimingPatterns(grid);

	drawFinderPattern(grid, 0, 0, { separatorTop: false, separatorLeft: false });
	drawFinderPattern(grid, 0, finalSize - 8, { separatorTop: false, separatorLeft: true });
	drawFinderPattern(grid, finalSize - 8, 0, { separatorTop: true, separatorLeft: false });

	drawAlignmentPatterns(grid, Number.isInteger(version) ? version : 1);
	drawDummyFormatBits(grid);

	return grid;
}

export function patternToLogLines(grid) {
	return grid.map((row) => row.map((cell) => {
		if (cell === null) return '.';
		return cell ? '#' : '0';
	}).join(''));
}

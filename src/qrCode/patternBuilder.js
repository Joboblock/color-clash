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

const ALIGNMENT_CENTER_TABLE = [
	null,
	[],
	[6, 18],
	[6, 22],
	[6, 26],
	[6, 30],
	[6, 34],
	[6, 22, 38],
	[6, 24, 42],
	[6, 26, 46],
	[6, 28, 50],
	[6, 30, 54],
	[6, 32, 58],
	[6, 34, 62],
	[6, 26, 46, 66],
	[6, 26, 48, 70],
	[6, 26, 50, 74],
	[6, 30, 54, 78],
	[6, 30, 56, 82],
	[6, 30, 58, 86],
	[6, 34, 62, 90],
	[6, 28, 50, 72, 94],
	[6, 26, 50, 74, 98],
	[6, 30, 54, 78, 102],
	[6, 28, 54, 80, 106],
	[6, 32, 58, 84, 110],
	[6, 30, 58, 86, 114],
	[6, 34, 62, 90, 118],
	[6, 26, 50, 74, 98, 122],
	[6, 30, 54, 78, 102, 126],
	[6, 26, 52, 78, 104, 130],
	[6, 30, 56, 82, 108, 134],
	[6, 34, 60, 86, 112, 138],
	[6, 30, 58, 86, 114, 142],
	[6, 34, 62, 90, 118, 146],
	[6, 30, 54, 78, 102, 126, 150],
	[6, 24, 50, 76, 102, 128, 154],
	[6, 28, 54, 80, 106, 132, 158],
	[6, 32, 58, 84, 110, 136, 162],
	[6, 26, 54, 82, 110, 138, 166],
	[6, 30, 58, 86, 114, 142, 170]
];

function getAlignmentCenters(version) {
	if (!Number.isInteger(version) || version <= 1) return [];
	return ALIGNMENT_CENTER_TABLE[version] ?? [];
}

function drawAlignmentPatterns(grid, version) {
	const size = grid.length;
	const centers = getAlignmentCenters(version);
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

const FORMAT_ECL_BITS = {
	L: 1,
	M: 0,
	Q: 3,
	H: 2
};

export function computeFormatBits(eccLevel = 'L', maskId = 0) {
	const eclBits = FORMAT_ECL_BITS[eccLevel] ?? 1;
	const formatInfo = ((eclBits & 0x3) << 3) | (maskId & 0x7);
	let data = formatInfo << 10;
	const generator = 0x537;
	for (let i = 14; i >= 10; i--) {
		if ((data >> i) & 1) {
			data ^= generator << (i - 10);
		}
	}
	const remainder = data & 0x3ff;
	const bitsValue = ((formatInfo << 10) | remainder) ^ 0x5412;
	const bits = [];
	for (let i = 14; i >= 0; i--) {
		bits.push(((bitsValue >> i) & 1) === 1);
	}
	return bits;
}

function drawFormatBits(grid, eccLevel, maskId) {
	const size = grid.length;
	const bits = computeFormatBits(eccLevel, maskId);
	const topLeftCoords = [
		[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
		[7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
	];

	const topRightCoords = [];
	for (let c = size - 1; c >= size - 8; c--) {
		topRightCoords.push([8, c]);
	}

	const bottomLeftCoords = [];
	for (let r = size - 7; r < size; r++) {
		bottomLeftCoords.push([r, 8]);
	}

	topLeftCoords.forEach(([r, c], idx) => {
		setCell(grid, r, c, bits[idx]);
	});
	for (let i = 0; i < topRightCoords.length; i++) {
		const [r, c] = topRightCoords[i];
		setCell(grid, r, c, bits[14 - i]);
	}
	for (let i = 0; i < bottomLeftCoords.length; i++) {
		const [r, c] = bottomLeftCoords[i];
		setCell(grid, r, c, bits[6 - i]);
	}

	setCellIfNull(grid, size - 8, 8, true);
}

function computeVersionBits(version) {
	if (!Number.isInteger(version) || version < 7) return null;
	const versionBits = version & 0x3f;
	let data = versionBits << 12;
	const generator = 0x1f25;
	for (let i = 17; i >= 12; i--) {
		if ((data >> i) & 1) {
			data ^= generator << (i - 12);
		}
	}
	const remainder = data & 0xfff;
	const bitsValue = (versionBits << 12) | remainder;
	const bits = [];
	for (let i = 17; i >= 0; i--) {
		bits.push(((bitsValue >> i) & 1) === 1);
	}
	return bits;
}

function drawVersionBits(grid, version) {
	const size = grid.length;
	const bits = computeVersionBits(version);
	if (!bits) return;
	let index = 0;
	for (let r = 0; r < 6; r++) {
		for (let c = 0; c < 3; c++) {
			const value = bits[17 - index];
			setCell(grid, r, size - 11 + c, value);
			setCell(grid, size - 11 + c, r, value);
			index += 1;
		}
	}
}

export function buildFixedPattern({ version, size, eccLevel = 'L', maskId = 2 } = {}) {
	const finalSize = Number.isInteger(size) ? size : (Number.isInteger(version) ? 21 + 4 * (version - 1) : 21);
	const grid = createEmptyGrid(finalSize);

	drawTimingPatterns(grid);

	drawFinderPattern(grid, 0, 0, { separatorTop: false, separatorLeft: false });
	drawFinderPattern(grid, 0, finalSize - 8, { separatorTop: false, separatorLeft: true });
	drawFinderPattern(grid, finalSize - 8, 0, { separatorTop: true, separatorLeft: false });

	drawAlignmentPatterns(grid, Number.isInteger(version) ? version : 1);
	drawFormatBits(grid, eccLevel, maskId);
	drawVersionBits(grid, Number.isInteger(version) ? version : 1);

	return grid;
}

export function patternToLogLines(grid) {
	return grid.map((row) => row.map((cell) => {
		if (cell === null) return '.';
		return cell ? '#' : '0';
	}).join(''));
}

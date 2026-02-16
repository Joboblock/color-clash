function maskCondition(maskId, row, col) {
	switch (maskId) {
		case 2:
			return col % 3 === 0;
		default:
			return false;
	}
}

export function applyMaskPattern(grid, reservedGrid, maskId) {
	if (!Array.isArray(grid) || !Array.isArray(reservedGrid)) {
		return grid;
	}

	const size = grid.length;
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < size; c++) {
			if (reservedGrid[r]?.[c] !== null) continue;
			if (grid[r]?.[c] === null) continue;
			if (maskCondition(maskId, r, c)) {
				grid[r][c] = !grid[r][c];
			}
		}
	}

	return grid;
}

export function placeDataBits(grid, bitStream) {
    if (!Array.isArray(grid) || typeof bitStream !== 'string') {
        return { grid, usedBits: 0, remainingBits: bitStream };
    }

    const size = grid.length;
    let bitIndex = 0;

    let pairIndex = 0;
    for (let col = size - 1; col > 0; col -= 2) {
        if (col === 6) col -= 1;
        const isUpward = pairIndex % 2 === 0;
        pairIndex += 1;
        const rowStart = isUpward ? size - 1 : 0;
        const rowEnd = isUpward ? -1 : size;
        const rowStep = isUpward ? -1 : 1;

        for (let row = rowStart; row !== rowEnd; row += rowStep) {
            for (let offset = 0; offset < 2; offset++) {
                const c = col - offset;
                if (c < 0) continue;
                if (grid[row][c] !== null) continue;
                if (bitIndex >= bitStream.length) {
                    return { grid, usedBits: bitIndex, remainingBits: '' };
                }
                grid[row][c] = bitStream[bitIndex] === '1';
                bitIndex += 1;
            }
        }
    }

    return { grid, usedBits: bitIndex, remainingBits: bitStream.slice(bitIndex) };
}

export function fillNullModules(grid, fillValue = false) {
    if (!Array.isArray(grid)) return grid;
    for (let r = 0; r < grid.length; r++) {
        for (let c = 0; c < grid[r].length; c++) {
            if (grid[r][c] === null) {
                grid[r][c] = fillValue;
            }
        }
    }
    return grid;
}

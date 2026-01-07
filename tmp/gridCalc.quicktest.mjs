import assert from 'node:assert/strict';
import {
    computeInvalidInitialPositions,
    isInitialPlacementInvalid,
    computeExplosionTargets,
    getCellsToExplode
} from '../src/game/gridCalc.js';

const mkGrid = (size) => Array.from({ length: size }, () => Array.from({ length: size }, () => ({ value: 0, player: '' })));

// computeInvalidInitialPositions
{
    const even = computeInvalidInitialPositions(4);
    assert.equal(even.length, 4);
    assert.ok(even.some(p => p.r === 1 && p.c === 1));
    assert.ok(even.some(p => p.r === 2 && p.c === 2));

    const odd = computeInvalidInitialPositions(5);
    assert.equal(odd.length, 5);
    assert.ok(odd.some(p => p.r === 2 && p.c === 2));
}

// isInitialPlacementInvalid: adjacency
{
    const size = 5;
    const grid = mkGrid(size);
    const invalidCenters = computeInvalidInitialPositions(size);

    // center is invalid
    assert.equal(isInitialPlacementInvalid(grid, size, invalidCenters, 2, 2), true);

    // empty non-center is valid
    assert.equal(isInitialPlacementInvalid(grid, size, invalidCenters, 0, 0), false);

    // adjacency makes it invalid
    grid[0][1].player = 'red';
    assert.equal(isInitialPlacementInvalid(grid, size, invalidCenters, 0, 0), true);
}

// computeExplosionTargets
{
    // corner: initial placement -> extra back to origin
    const r = computeExplosionTargets(3, 0, 0, 2, true);
    assert.equal(r.targets.length, 2); // down + right
    assert.equal(r.extraBackToOrigin, 2); // up + left out of bounds

    // corner: not initial placement -> no extra back
    const r2 = computeExplosionTargets(3, 0, 0, 2, false);
    assert.equal(r2.targets.length, 2);
    assert.equal(r2.extraBackToOrigin, 0);
}

// getCellsToExplode
{
    const size = 3;
    const grid = mkGrid(size);
    grid[1][1].value = 3;
    grid[1][1].player = 'blue';
    const expl = getCellsToExplode(grid, size, 3);
    assert.deepEqual(expl, [{ row: 1, col: 1, player: 'blue', value: 3 }]);
}

console.log('gridCalc quicktest: OK');

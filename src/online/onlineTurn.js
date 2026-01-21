/**
 * Online client turn helpers.
 *
 * The server is authoritative, but clients still need a deterministic way to
 * decide whose turn it is for input gating and UI.
 *
 * Contract (matches server.js + local model):
 * - During initial placement (seq < playerCount): currentPlayer = seq % playerCount
 * - After that: maintain a persistent turnIndex which advances via advanceTurnIndex,
 *   skipping eliminated players based on the current grid.
 */

import { advanceTurnIndex } from '../game/turnCalc.js';

/**
 * @typedef {{value:number, player:string}} GridCell
 */

/**
 * Compute which player index should act at a given online sequence number.
 *
 * This is intentionally pure so it can be unit-tested.
 * It reconstructs the persistent-turnIndex process from the end of initial placement.
 *
 * Rules:
 * - At seq === playerCount (first post-placement turn), player 0 is up next.
 * - For each subsequent seq, advance from the previous mover using advanceTurnIndex.
 *
 * @param {GridCell[][]} grid
 * @param {string[]} playerColors
 * @param {number} seq - 0-based move sequence number ("next to play")
 * @returns {number|null}
 */
export function onlinePlayerIndexForSeq(grid, playerColors, seq) {
	const n = Array.isArray(playerColors) ? playerColors.length : 0;
	const s = Number(seq) || 0;
	if (n <= 0) return null;
	if (s < n) return s % n;

	// Persistent turnIndex model:
	// - At seq === n (first post-placement move), player 0 is up next.
	// - For each subsequent seq, the player to act is the previous player advanced
	//   via advanceTurnIndex().
	let turnIndex = 0;
	if (s === n) return turnIndex;

	// We want to compute the actor for seq=s.
	// Iterate seq values (next-to-play) from n+1..s and advance from the previous actor.
	for (let currentSeq = n + 1; currentSeq <= s; currentSeq++) {
		const next = advanceTurnIndex(grid, playerColors, turnIndex, currentSeq);
		if (next === null) return null;
		turnIndex = next;
	}
	return turnIndex;
}

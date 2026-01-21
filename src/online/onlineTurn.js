/**
 * Online client turn helpers.
 *
 * The server is authoritative, but clients still need a deterministic way to
 * decide whose turn it is for input gating and UI.
 *
 * IMPORTANT:
 * We intentionally do NOT "replay" turn history from seq==playerCount using the
 * current grid, because eliminations would retroactively affect earlier steps
 * and shift the order incorrectly.
 *
 * Instead we mirror the local game: keep a persistent turnIndex and advance it
 * exactly once per applied move using advanceTurnIndex() on the current grid.
 */

import { advanceTurnIndex, computeAliveMask } from '../game/turnCalc.js';

function _turnDebugEnabled() {
	return true;
}

function _turnDebug(event, payload) {
	if (!_turnDebugEnabled()) return;
	try {
		// Keep logs compact and grep-friendly.
		console.info(`[OnlineTurn] ${event}`, payload);
	} catch {
		/* ignore */
	}
}

/**
 * @typedef {{value:number, player:string}} GridCell
 */

/**
 * Create a stateful online-turn tracker.
 *
 * Contract (matches local + server):
 * - During initial placement (seq < playerCount): actor = seq % playerCount
 * - First post-placement turn (seq === playerCount): actor = 0
 * - After that: advance persistent turnIndex once per applied move via advanceTurnIndex.
 *
 * @param {number} playerCount
 */
export function createOnlineTurnTracker(playerCount) {
	const n = Number(playerCount) || 0;
	let seq = 0; // next-to-play seq
	let turnIndex = 0; // actor for current post-placement seq

	function actorForSeq(s) {
		const x = Number(s) || 0;
		if (n <= 0) return null;
		if (x < n) return x % n;
		if (x === n) return 0;
		return turnIndex;
	}

	return {
		get playerCount() { return n; },
		get seq() { return seq; },
		get turnIndex() { return turnIndex; },
		get currentPlayer() { return actorForSeq(seq); },

		/**
		 * Align tracker to an externally known next-to-play seq.
		 * For post-placement seq>n, we keep the current turnIndex (cannot safely reconstruct).
		 * @param {number} nextSeq
		 * @param {GridCell[][]} [grid]
		 * @param {string[]} [colors]
		 */
		setSeq(nextSeq, grid, colors) {
			if (n <= 0) return null;
			seq = Number(nextSeq) || 0;
			if (seq < n) {
				const actor = seq % n;
				_turnDebug('setSeq.initial', { seq, actor });
				return actor;
			}
			if (seq === n) {
				turnIndex = 0;
				_turnDebug('setSeq.post_first', { seq, actor: 0 });
				return 0;
			}
			_turnDebug('setSeq.post_keep', { seq, actor: turnIndex });
			try {
				if (_turnDebugEnabled() && grid && colors) {
					const alive = computeAliveMask(grid, colors, seq);
					_turnDebug('alive', { seq, alive });
				}
			} catch { /* ignore */ }
			return turnIndex;
		},

		/**
		 * Notify tracker that a move at sequence `appliedSeq` was applied by `appliedByIndex`.
		 * This advances state for the next seq (appliedSeq+1) using the current grid.
		 * @param {GridCell[][]} grid
		 * @param {string[]} colors
		 * @param {number} appliedByIndex
		 * @param {number} appliedSeq
		 */
		onMoveApplied(grid, colors, appliedByIndex, appliedSeq) {
			if (n <= 0) return null;
			const by = Number(appliedByIndex) || 0;
			const applied = Number(appliedSeq) || 0;
			const nextSeq = applied + 1;
			seq = nextSeq;

			if (nextSeq < n) {
				const actor = nextSeq % n;
				_turnDebug('applied.initial', { appliedSeq: applied, by, nextSeq, actor });
				return actor;
			}

			if (nextSeq === n) {
				turnIndex = 0;
				_turnDebug('applied.transition_to_post', { appliedSeq: applied, by, nextSeq, actor: 0 });
				return 0;
			}

			let alive = null;
			try { alive = _turnDebugEnabled() ? computeAliveMask(grid, colors, nextSeq) : null; } catch { /* ignore */ }
			const nextIndex = advanceTurnIndex(grid, colors, by, nextSeq);
			_turnDebug('applied.advance', { appliedSeq: applied, by, nextSeq, nextIndex, alive });
			if (nextIndex === null) return null;
			turnIndex = nextIndex;
			return nextIndex;
		}
	};
}

/**
 * Backwards-compat wrapper (deprecated): historically the UI asked "who acts at seq?".
 * This function now only supports initial placement and the post-placement boundary.
 * For seq>playerCount it returns 0 and logs (debug) because safe reconstruction
 * requires state.
 */
export function onlinePlayerIndexForSeq(_grid, playerColors, seq) {
	const n = Array.isArray(playerColors) ? playerColors.length : 0;
	const s = Number(seq) || 0;
	if (n <= 0) return null;
	if (s < n) return s % n;
	if (s === n) return 0;
	_turnDebug('deprecated_seq_query', { seq: s, playerCount: n });
	return 0;
}

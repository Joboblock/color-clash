import { computeAIMove } from './engine.js';

self.addEventListener('message', (ev) => {
    const { requestId, state, config } = ev.data || {};
    if (!state || typeof requestId !== 'number') return;
    try {
        const colors = Array.isArray(state.colors) ? state.colors : [];
        const activeColors = () => colors;
        const result = computeAIMove({
            grid: state.grid,
            initialPlacements: state.initialPlacements,
            playerIndex: state.playerIndex,
            playerCount: state.playerCount,
            gridSize: state.gridSize,
            activeColors,
            invalidInitialPositions: state.invalidInitialPositions
        }, config);
        self.postMessage({ requestId, result });
    } catch (err) {
        const message = err && err.message ? err.message : String(err);
        self.postMessage({ requestId, error: message });
    }
});

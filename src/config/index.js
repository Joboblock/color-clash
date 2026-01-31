/**
 * Central configuration module.
 * Ordered sections:
 * 1. Game Parameters
 * 2. Other / UI Parameters
 * 3. Online / Network Parameters
 *
 * Each group exports a frozen object plus named re-exports for convenience.
 * Extend by adding new keys; keep values primitive / serializable for ease of tuning.
 */

// 1. Game Parameters --------------------------------------------------------
export const GameParams = Object.freeze({
    PLAYER_NAME_LENGTH: 12,          // base name length (suffix may extend shown length)
    MAX_CELL_VALUE: 5,               // cap value for a cell (dots)
    INITIAL_PLACEMENT_VALUE: 5,      // starting value when placing first orb
    CELL_EXPLODE_THRESHOLD: 4,       // value at which cell explodes and distributes
    DELAY_EXPLOSION_MS: 500,         // delay between chained explosion waves
    DELAY_ANIMATION_MS: 300,         // animation duration for cell value transitions
    DELAY_GAME_END_MS: 2000,         // pause before showing game end state
    PERFORMANCE_MODE_CUTOFF: 16      // amount of explosions to switch to performance mode
});

// Named exports (for selective import convenience)
export const {
    PLAYER_NAME_LENGTH,
    MAX_CELL_VALUE,
    INITIAL_PLACEMENT_VALUE,
    CELL_EXPLODE_THRESHOLD,
    DELAY_EXPLOSION_MS,
    DELAY_ANIMATION_MS,
    DELAY_GAME_END_MS,
    PERFORMANCE_MODE_CUTOFF
} = GameParams;

// 2. Other / UI Parameters --------------------------------------------------
export const UIParams = Object.freeze({
    DOUBLE_TAP_THRESHOLD_MS: 300,    // mobile double-tap window for fullscreen toggle
    STARTING_COLOR_KEY: 'green',     // initial starting color cycler key
    HOST_DEFAULT_GRID_OFFSET: 3      // default grid size offset (players + offset)
});

export const { DOUBLE_TAP_THRESHOLD_MS, STARTING_COLOR_KEY, HOST_DEFAULT_GRID_OFFSET } = UIParams;

// 3. Online / Network Parameters -------------------------------------------
export const OnlineParams = Object.freeze({
    WS_INITIAL_BACKOFF_MS: 500,      // initial reconnect backoff
    WS_MAX_BACKOFF_MS: 10000,         // cap for exponential backoff
    SHOW_CONN_BANNER_ONLY_IN_ONLINE: true, // gating flag for connection banner visibility
    // Debug/network simulation knobs (set to 0 to disable)
    // Apply in both client and server to simulate unreliable networks during development.
    PACKET_DROP_RATE: 0.250,           // probability to drop a packet outright
    PACKET_DELAY_RATE: 0.250,          // probability to delay a packet
    PACKET_DELAY_MIN_MS: 150,          // min artificial delay when delaying packets
    PACKET_DELAY_MAX_MS: 500,         // max artificial delay when delaying packets
    PACKET_DISCONNECT_RATE: 0.025,     // probability to force a disconnect on a move packet (debug)
    // Back-compat aliases (prefer PACKET_DROP_RATE / PACKET_DELAY_RATE going forward)
    WS_PROD_BASE_URL: 'wss://color-clash-192172087961.europe-west1.run.app/ws' // production service endpoint
});

export const {
    WS_INITIAL_BACKOFF_MS,
    WS_MAX_BACKOFF_MS,
    SHOW_CONN_BANNER_ONLY_IN_ONLINE,
    PACKET_DROP_RATE,
    PACKET_DELAY_RATE,
    PACKET_DELAY_MIN_MS,
    PACKET_DELAY_MAX_MS,
    PACKET_DISCONNECT_RATE,
    WS_PROD_BASE_URL
} = OnlineParams;

// Consolidated default export (optional usage)
export default {
    GameParams,
    UIParams,
    OnlineParams
};

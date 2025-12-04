// Edge circles component - displays player indicators around the game board
import { mixTowardGray } from '../utils/generalUtils.js';
import { innerCircleColors, playerColors, activeColors } from '../game/palette.js';

/**
 * Determine whether to restrict edge circles to 'side' (top/bottom) or 'top' (left/right) edges
 * based on viewport aspect ratio.
 * @returns {'side' | 'top'} Restriction type for edge circle layout.
 */
export function getRestrictionType() {
    const vw = window.innerWidth || document.documentElement.clientWidth || 1;
    const vh = window.innerHeight || document.documentElement.clientHeight || 1;
    return vw < vh ? 'side' : 'top';
}

/**
 * Compute edge circle size considering viewport, grid, and caps.
 * @returns {number} Circle diameter in pixels.
 */
export function computeEdgeCircleSize() {
    const vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);

    // Base: just under 1/3 of shorter side, minus margin, hard-capped
    const base = Math.floor(Math.min(vw, vh) / 3 - 16);
    const hardCap = 160;
    let size = Math.max(22, Math.min(base, hardCap));

    // Additional restriction: diameter <= (larger screen dim - matching grid dim - 16px)
    try {
        const gridEl = document.querySelector('.grid');
        if (gridEl) {
            const rect = gridEl.getBoundingClientRect();
            const useWidth = vw >= vh; // pick the larger screen dimension
            const screenDim = useWidth ? vw : vh;
            const gridDim = useWidth ? rect.width : rect.height;
            const spare = Math.max(0, Math.floor(screenDim - gridDim));
            // 16px safety margin to avoid touching grid
            const gridCap = Math.max(0, spare - 16);
            size = Math.max(22, Math.min(size, gridCap));
        }
    } catch { /* ignore measure issues */ }

    return size;
}

/**
 * Compute positional CSS classes for player edge circles based on `count` and viewport restriction.
 * @param {number} count - Number of players (circles).
 * @param {'side' | 'top'} restrict - Layout restriction type.
 * @returns {string[]} Array of CSS positional class names.
 */
export function computeEdgePositions(count, restrict) {
    if (count <= 0) return [];
    // Clockwise orders starting from bottom-left corner
    const orderSide = [
        'pos-corner-bl',
        'pos-bottom-mid1', 'pos-bottom-center', 'pos-bottom-mid2',
        'pos-corner-br',
        'pos-corner-tr',
        'pos-top-mid2', 'pos-top-center', 'pos-top-mid1',
        'pos-corner-tl'
    ];
    const orderTop = [
        'pos-corner-bl',
        'pos-left-mid2', 'pos-left-center', 'pos-left-mid1',
        'pos-corner-tl',
        'pos-corner-tr',
        'pos-right-mid1', 'pos-right-center', 'pos-right-mid2',
        'pos-corner-br'
    ];
    const corners = ['pos-corner-bl', 'pos-corner-br', 'pos-corner-tr', 'pos-corner-tl']; // clockwise BL→BR→TR→TL

    // Build the set of allowed positions for this player count and restriction
    let allowed = new Set();
    if (count === 2) {
        allowed = new Set(restrict === 'side'
            ? ['pos-bottom-center', 'pos-top-center']
            : ['pos-left-center', 'pos-right-center']
        );
    } else if (count === 3) {
        allowed = new Set(corners.slice(0, 3));
    } else if (count === 4) {
        allowed = new Set(corners);
    } else if (count === 5) {
        allowed = new Set([
            ...corners,
            ...(restrict === 'side' ? ['pos-bottom-center'] : ['pos-left-center'])
        ]);
    } else if (count === 6) {
        allowed = new Set([
            ...corners,
            ...(restrict === 'side' ? ['pos-bottom-center', 'pos-top-center'] : ['pos-left-center', 'pos-right-center'])
        ]);
    } else if (count === 7) {
        allowed = new Set([
            ...corners,
            ...(restrict === 'side'
                ? ['pos-bottom-center', 'pos-top-mid1', 'pos-top-mid2']
                : ['pos-right-center', 'pos-left-mid1', 'pos-left-mid2']
            )
        ]);
    } else {
        // 8 or more
        allowed = new Set([
            ...corners,
            ...(restrict === 'side'
                ? ['pos-bottom-mid1', 'pos-bottom-mid2', 'pos-top-mid1', 'pos-top-mid2']
                : ['pos-left-mid1', 'pos-left-mid2', 'pos-right-mid1', 'pos-right-mid2']
            )
        ]);
    }

    const order = (restrict === 'side') ? orderSide : orderTop;
    const out = [];
    for (const pos of order) {
        if (allowed.has(pos)) out.push(pos);
        if (out.length >= count) break;
    }
    return out;
}

/**
 * Create and render edge circles for all players. Removes any existing container first.
 * @param {number} [playerCount] - Optional player count; falls back to active colors length.
 * @param {object} [state] - Optional state object.
 * @param {number} [state.currentPlayer=0] - Zero-based index of the active player.
 * @param {boolean} [state.onlineGameActive=false] - Whether an online game is active.
 * @param {number} [state.myOnlineIndex] - Local player index during online play.
 * @param {boolean} [state.practiceMode=false] - Whether practice mode is active.
 * @param {number} [state.humanPlayer] - Human player index in practice mode.
 * @param {string[]|null} [state.gameColors] - Current game's color array (player-selected colors).
 * @returns {void}
 */
export function createEdgeCircles(playerCount, state = {}) {
    const {
        currentPlayer = 0,
        onlineGameActive = false,
        myOnlineIndex,
        practiceMode = false,
        humanPlayer,
        gameColors = null
    } = state || {};
    // Remove old container
    const old = document.getElementById('edgeCirclesContainer');
    if (old && old.parentNode) old.parentNode.removeChild(old);

    // Do not show when any menu overlay is visible
    const anyMenuVisible = [document.getElementById('firstMenu'), document.getElementById('mainMenu'), document.getElementById('onlineMenu')]
        .some(m => m && !m.classList.contains('hidden'));
    if (anyMenuVisible) return;

    const container = document.createElement('div');
    container.id = 'edgeCirclesContainer';
    container.className = 'edge-circles-container';
    container.setAttribute('data-restrict', getRestrictionType());

    // Use color palette for 8 circles
    const colorHex = (key) => {
        try { return innerCircleColors[key] || '#fff'; } catch { return '#fff'; }
    };
    // Determine number of players (use activeColors when available)
    const ac = (typeof activeColors === 'function') ? activeColors(gameColors) : playerColors;
    const count = Math.min(ac.length || 0, Math.max(2, (typeof playerCount === 'number' ? playerCount : ac.length || 2)));
    const restrict = getRestrictionType();

    const positions = computeEdgePositions(count, restrict);
    positions.forEach((posClass, idx) => {
        const d = document.createElement('div');
        d.className = 'edge-circle ' + posClass;
        d.dataset.playerIndex = String(idx);
        const key = ac[idx % ac.length];
        const base = colorHex(key);
        d.style.setProperty('--circle-color', base);
        // Dim inactive circle color: mix original toward black (grayscale 0) by 25%
        d.style.setProperty('--circle-color-dim', mixTowardGray(base, 0, 0.25));
        container.appendChild(d);
    });
    document.body.appendChild(container);
    // Set circle size variable using viewport and grid dimensions
    document.documentElement.style.setProperty('--edge-circle-size', computeEdgeCircleSize() + 'px');
    // Initialize active/inactive states on the next frame so CSS transitions run from opacity:0
    requestAnimationFrame(() => {
        try {
            updateEdgeCirclesActive(currentPlayer, onlineGameActive, myOnlineIndex, practiceMode, humanPlayer, gameColors);
        } catch { /* ignore */ }
    });
}

/**
 * Reflect active player on edge circles (full size/opacity for active; smaller/faded for others).
 * Also dims the page background when it's not the local player's turn.
 * @param {number} [currentPlayer=0] - Zero-based index of the active player.
 * @param {boolean} [onlineGameActive=false] - Whether an online game is active.
 * @param {number} [myOnlineIndex] - Local player index in online mode.
 * @param {boolean} [practiceMode=false] - Whether practice mode is active.
 * @param {number} [humanPlayer] - Human player index in practice mode.
 * @param {string[]|null} [gameColors=null] - Current game's color array (player-selected colors).
 * @returns {void}
 */
export function updateEdgeCirclesActive(currentPlayer = 0, onlineGameActive = false, myOnlineIndex, practiceMode = false, humanPlayer, gameColors = null) {
    const container = document.getElementById('edgeCirclesContainer');
    if (!container) return;
    const circles = Array.from(container.querySelectorAll('.edge-circle'));
    if (!circles.length) return;
    const activeIdx = Math.max(0, Math.min(circles.length - 1, currentPlayer || 0));
    circles.forEach((el, idx) => {
        el.classList.toggle('is-active', idx === activeIdx);
        el.classList.toggle('is-inactive', idx !== activeIdx);
    });

    // Also dim the page background toward black when it's not the local player's turn
    try {
        const ac = (typeof activeColors === 'function') ? activeColors(gameColors) : playerColors;
        const key = ac[activeIdx % ac.length];
        const baseBody = getComputedStyle(document.documentElement).getPropertyValue(`--body-${key}`).trim();
        const notMyTurn = (() => {
            if (onlineGameActive) {
                return typeof myOnlineIndex === 'number' ? (currentPlayer !== myOnlineIndex) : true;
            }
            if (practiceMode) {
                const hp = (typeof humanPlayer === 'number') ? humanPlayer : 0;
                return currentPlayer !== hp;
            }
            // Local hotseat: always "my" turn (no dimming)
            return false;
        })();
        if (notMyTurn) {
            document.body.style.backgroundColor = mixTowardGray(baseBody || '#000', 128, 0.66);
        } else {
            // Clear inline style so the class-based background applies
            document.body.style.backgroundColor = '';
        }
    } catch { /* no-op */ }
}

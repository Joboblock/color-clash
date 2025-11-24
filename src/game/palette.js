// Palette and color selection logic extracted from script.js
import { mixTowardGray, hexToRgb } from '../utils/generalUtils.js';

// Inner circle strong colors (match CSS classes .inner-circle.*)
export const innerCircleColors = {
    red: '#d55f5f',
    orange: '#d5a35f',
    yellow: '#d5d35f',
    green: '#a3d55f',
    cyan: '#5fd5d3',
    blue: '#5f95d5',
    purple: '#8f5fd5',
    magenta: '#d35fd3'
};

// Ordered player color keys (cycled from startingColorIndex)
export const playerColors = ['green', 'red', 'blue', 'yellow', 'magenta', 'cyan', 'orange', 'purple'];

let startingColorIndex = playerColors.indexOf('green');
if (startingColorIndex < 0) startingColorIndex = 0;

/**
 * Get the current starting color index within `playerColors`.
 * @returns {number} Zero-based index referencing the first color for palette rotation.
 */
export function getStartingColorIndex() { return startingColorIndex; }

/**
 * Set the starting color index used when generating selected colors.
 * Values outside the valid range [0..playerColors.length-1] are ignored.
 * @param {number} idx - Proposed zero-based starting color index.
 * @returns {void}
 */
export function setStartingColorIndex(idx) {
    if (Number.isInteger(idx) && idx >= 0 && idx < playerColors.length) {
        startingColorIndex = idx;
    }
}

// Active palette (gameColors overrides full list)
/**
 * Resolve the active color array, preferring a game-specific palette when provided.
 * @param {string[]|null|undefined} gameColors - Optional game palette; falls back to full `playerColors` if empty.
 * @returns {string[]} The array of color keys currently active.
 */
export function activeColors(gameColors) {
    return (gameColors && gameColors.length) ? gameColors : playerColors;
}

/**
 * Compute the starting player index based on the current cycler color in the active palette.
 * @returns {number} index into activeColors().
 */
export function computeStartPlayerIndex(gameColors) {
    const ac = activeColors(gameColors);
    const selectedKey = playerColors[startingColorIndex];
    const idx = ac.indexOf(selectedKey);
    return idx >= 0 ? idx : 0;
}

/**
 * Generate `count` amount of colors starting at the currently selected color
 * @param {number} count - Number of colors to include.
 * @returns {string[]} Array of colors capped at `count` (clamped to available colors).
 */
export function computeSelectedColors(count) {
    const n = playerColors.length;
    const c = Math.max(1, Math.min(count, n));
    const arr = [];
    for (let i = 0; i < c; i++) arr.push(playerColors[(startingColorIndex + i) % n]);
    return arr;
}

/**
 * Apply CSS variables based on innerCircleColors: sets properties for inner, cell, and body colors.
 * @param {HTMLElement} [root=document.documentElement] - Root element on which to set CSS variables.
 * @returns {void}
 */
export function applyPaletteCssVariables(root = document.documentElement) {
    Object.entries(innerCircleColors).forEach(([key, hex]) => {
        root.style.setProperty(`--inner-${key}`, hex);
        const pastel = mixTowardGray(hex, 255, 0.5);
        root.style.setProperty(`--cell-${key}`, pastel);
        const dark = (c) => Math.max(0, Math.min(255, Math.round(c * 0.88)));
        const { r, g, b } = hexToRgb(hex);
        root.style.setProperty(`--body-${key}`, `rgb(${dark(r)}, ${dark(g)}, ${dark(b)})`);
    });
}

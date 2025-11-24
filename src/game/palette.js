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

export function getStartingColorIndex() { return startingColorIndex; }
export function setStartingColorIndex(idx) {
    if (Number.isInteger(idx) && idx >= 0 && idx < playerColors.length) {
        startingColorIndex = idx;
    }
}

// Active palette (gameColors overrides full list)
export function activeColors(gameColors) {
    return (gameColors && gameColors.length) ? gameColors : playerColors;
}

export function computeStartPlayerIndex(gameColors) {
    const ac = activeColors(gameColors);
    const selectedKey = playerColors[startingColorIndex];
    const idx = ac.indexOf(selectedKey);
    return idx >= 0 ? idx : 0;
}

export function computeSelectedColors(count) {
    const n = playerColors.length;
    const c = Math.max(1, Math.min(count, n));
    const arr = [];
    for (let i = 0; i < c; i++) arr.push(playerColors[(startingColorIndex + i) % n]);
    return arr;
}

// Apply CSS variables based on innerCircleColors
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

// General utility functions extracted from script.js
// Color helpers -----------------------------------------------------------
export function mixTowardGray(color, gray = 128, factor = 0.5) {
    if (typeof gray !== 'number' || isNaN(gray)) gray = 128;
    gray = Math.max(0, Math.min(255, Math.round(gray)));
    if (typeof factor !== 'number' || isNaN(factor)) factor = 0.5;
    factor = Math.max(0, Math.min(1, factor));
    const { r, g, b } = cssColorToRgb(color);
    const mix = (c) => Math.round((1 - factor) * c + factor * gray);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function cssColorToRgb(color) {
    if (!color || typeof color !== 'string') return { r: 0, g: 0, b: 0 };
    const c = color.trim();
    if (c.startsWith('#')) return hexToRgb(c);
    const m = c.match(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
    if (m) {
        const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
        const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
        const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
        return { r, g, b };
    }
    return { r: 0, g: 0, b: 0 };
}

export function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const bigint = parseInt(full, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

// URL helpers
export function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

// Grid / game sizing helpers 
export function recommendedGridSize(p) {
    if (p <= 2) return 3;
    if (p <= 4) return 4; // 3-4 players
    if (p === 5) return 5;
    return 6; // 6-8 players
}

export function defaultGridSizeForPlayers(p) {
    return Math.max(3, (parseInt(p, 10) || 0) + 3);
}

export function clampPlayers(n, maxPlayers) {
    const v = Math.max(2, Math.min(maxPlayers, Math.floor(n) || 2));
    return v;
}

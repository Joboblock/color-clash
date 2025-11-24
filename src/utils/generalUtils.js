import { PLAYER_NAME_LENGTH } from '../config/index.js';

// Color helpers -----------------------------------------------------------
/**
 * Blend a given color toward a grayscale target producing a pastel/dimmed variant.
 * @param {string} color - Source CSS color (#hex or rgb/rgba string).
 * @param {number} [gray=128] - Target grayscale channel (0=black..255=white).
 * @param {number} [factor=0.5] - Blend factor (0 returns original color, 1 returns full gray).
 * @returns {string} CSS rgb() string of the blended color.
 */
export function mixTowardGray(color, gray = 128, factor = 0.5) {
    if (typeof gray !== 'number' || isNaN(gray)) gray = 128;
    gray = Math.max(0, Math.min(255, Math.round(gray)));
    if (typeof factor !== 'number' || isNaN(factor)) factor = 0.5;
    factor = Math.max(0, Math.min(1, factor));
    const { r, g, b } = cssColorToRgb(color);
    const mix = (c) => Math.round((1 - factor) * c + factor * gray);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * Parse a CSS color string (#hex, rgb(), rgba()) into numeric RGB channels.
 * @param {string} color - CSS color input.
 * @returns {{r:number,g:number,b:number}} Object with channel integers 0..255.
 */
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

/**
 * Convert a hex color (#rgb or #rrggbb) to discrete RGB channels.
 * @param {string} hex - Hexadecimal color string with or without leading '#'.
 * @returns {{r:number,g:number,b:number}} RGB components.
 */
export function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const bigint = parseInt(full, 16);
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

// URL helpers -------------------------------------------------------------
/**
 * Retrieve a query parameter value from current window.location.search.
 * @param {string} param - Parameter key.
 * @returns {string|null} Value if present, else null.
 */
export function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

// Grid / game sizing helpers ---------------------------------------------
/**
 * Provide a recommended minimum grid size for a given player count.
 * The players can't fit into a smaller grid, but could still not fit into the recommended one.
 * @param {number} p - Player count.
 * @returns {number} Recommended grid dimension.
 */
export function recommendedGridSize(p) {
    if (p <= 2) return 3;
    if (p <= 4) return 4;
    if (p === 5) return 5;
    return 6; // 6-8 players
}

/**
 * Compute a default grid size for auto-selection based on player count.
 * @param {number} playerCount - Player count.
 * @returns {number} Default grid dimension (playerCount + 3).
 */
export function defaultGridSizeForPlayers(playerCount) {
    return Math.max(3, (parseInt(playerCount, 10) || 0) + 3);
}

/**
 * Clamp a numeric player count to valid limits [2..maxPlayers].
 * @param {number} n - Desired player count.
 * @param {number} maxPlayers - Upper bound (typically available colors length).
 * @returns {number} Clamped player count >=2.
 */
export function clampPlayers(n, maxPlayers) {
    const v = Math.max(2, Math.min(maxPlayers, Math.floor(n) || 2));
    return v;
}

// Name utilities ----------------------------------------------------------
/**
 * Sanitize a raw player name by replacing whitespace, stripping invalid chars and truncating.
 * Allowed chars: A-Z a-z 0-9 _.
 * @param {string} raw - Raw input string.
 * @returns {string} Sanitized name (may be empty).
 */
export function sanitizeName(raw) {
    if (typeof raw !== 'string') return '';
    let s = raw.replace(/\s/g, '_');
    s = s.replace(/[^A-Za-z0-9_]/g, '');
    if (s.length > PLAYER_NAME_LENGTH) s = s.slice(0, PLAYER_NAME_LENGTH);
    return s;
}

/**
 * Reflect validity state on an input element (invalid when 0 < length < 3).
 * Adds/removes 'invalid' class and aria-invalid attribute.
 * @param {HTMLInputElement} inputEl - Target input element.
 * @param {string} val - Current value.
 * @returns {void}
 */
export function reflectValidity(inputEl, val) {
    if (!inputEl) return;
    const tooShort = val.length > 0 && val.length < 3;
    if (tooShort) {
        inputEl.classList.add('invalid');
        inputEl.setAttribute('aria-invalid', 'true');
    } else {
        inputEl.classList.remove('invalid');
        inputEl.removeAttribute('aria-invalid');
    }
}

// Tips helpers ------------------------------------------------------------
/**
 * Build weighted tips list with optional mobile variants.
 * @param {boolean|null} [isMobile=null] - Override mobile detection; null triggers heuristic.
 * @returns {Array<{text:string,weight?:number,html?:boolean}>} Tips list.
 */
export function getDeviceTips(isMobile = null) {
    const mobile = (isMobile !== null) ? !!isMobile : (typeof navigator !== 'undefined' && (
        (navigator.userAgentData && navigator.userAgentData.mobile === true) ||
        (typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer:coarse)').matches) ||
        (navigator.maxTouchPoints > 1)
    ));
    const tips = [
        { text: 'Tip: You can also set <code>?players=\u003Cn\u003E&size=\u003Cn\u003E</code> in the URL.', weight: 1, html: true },
        { text: 'Tip: Grid size defaults to a recommended value but can be adjusted manually.', weight: 2 },
        { text: 'Tip: Use Practice mode to observe AI behavior and learn strategies.', weight: 1 },
        { text: 'Tip: <a href="https://joboblock.github.io" target="_blank">joboblock.github.io</a> redirects to this game.', weight: 2, html: true },
        { text: 'Tip: Give this project a <a href="https://github.com/Joboblock/color-clash" target="_blank">Star</a> to support development!', weight: 2, html: true },
        { text: 'Tip: This is a rare message.', weight: 0.1 },
        { text: 'Tip: Praise the Raute, embrace the Raute!', weight: 0.1 }
    ];
    if (mobile) tips.push({ text: 'Tip: Double-tap outside the grid to toggle fullscreen on mobile.', weight: 3 });
    else tips.push({ text: 'Tip: Use WASD or Arrow keys to move between menu controls and grid cells.', weight: 2 });
    return tips;
}

/**
 * Select one entry from a weighted list using linear scan.
 * @param {Array<{text:string,weight?:number,html?:boolean}>} list - Source weighted tips.
 * @returns {{text:string,weight?:number,html?:boolean}} Selected tip object.
 */
export function pickWeightedTip(list) {
    let total = 0;
    for (const t of list) total += (typeof t.weight === 'number' ? t.weight : 1);
    let roll = Math.random() * total;
    for (const t of list) {
        roll -= (typeof t.weight === 'number' ? t.weight : 1);
        if (roll <= 0) return t;
    }
    return list[list.length - 1];
}

export default {
    mixTowardGray,
    cssColorToRgb,
    hexToRgb,
    getQueryParam,
    recommendedGridSize,
    defaultGridSizeForPlayers,
    clampPlayers,
    sanitizeName,
    reflectValidity,
    getDeviceTips,
    pickWeightedTip
};
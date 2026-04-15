import {
    MIN_PLAYER_NAME_LENGTH,
    MAX_PLAYER_NAME_LENGTH,
    PLAYER_NAME
} from '../config/index.js';
import { getMenuParam } from '../pages/navigation.js';

type Rgb = { r: number; g: number; b: number };

export type Tip = {
    text: string;
    weight: number;
};

export const MENU_TYPES = ['first', 'local', 'online', 'host', 'practice'] as const;

export type MenuType = (typeof MENU_TYPES)[number];

/**
 * Runtime type guard for menu identifiers.
 * @param {unknown} value
 * @returns {value is MenuType}
 */
export function isMenuType(value: unknown): value is MenuType {
    return typeof value === 'string' && (MENU_TYPES as readonly string[]).includes(value);
}

// Color helpers -----------------------------------------------------------
/**
 * Blend a given color toward a grayscale target producing a pastel/dimmed variant.
 * @param {string} color - Source CSS color (#hex or rgb/rgba string).
 * @param {number} [gray=128] - Target grayscale channel (0=black..255=white).
 * @param {number} [factor=0.5] - Blend factor (0 returns original color, 1 returns full gray).
 * @returns {string} CSS rgb() string of the blended color.
 */
export function mixTowardGray(color: string, gray: number = 128, factor: number = 0.5): string {
    if (typeof gray !== 'number' || Number.isNaN(gray)) gray = 128;
    gray = Math.max(0, Math.min(255, Math.round(gray)));
    if (typeof factor !== 'number' || Number.isNaN(factor)) factor = 0.5;
    factor = Math.max(0, Math.min(1, factor));
    const { r, g, b } = cssColorToRgb(color);
    const mix = (c: number) => Math.round((1 - factor) * c + factor * gray);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/**
 * Parse a CSS color string (#hex, rgb(), rgba()) into numeric RGB channels.
 * @param {string} color - CSS color input.
 * @returns {{r:number,g:number,b:number}} Object with channel integers 0..255.
 */
export function cssColorToRgb(color: string): Rgb {
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
export function hexToRgb(hex: string): Rgb {
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
export function getQueryParam(param: string): string | null {
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
export function recommendedGridSize(p: number): number {
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
export function defaultGridSizeForPlayers(playerCount: number | string): number {
    return Math.max(3, (parseInt(String(playerCount), 10) || 0) + 3);
}

/**
 * Clamp a numeric player count to valid limits [2..maxPlayers].
 * @param {number} n - Desired player count.
 * @param {number} maxPlayers - Upper bound (typically available colors length).
 * @returns {number} Clamped player count >=2.
 */
export function clampPlayers(n: number, maxPlayers: number): number {
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
export function sanitizeName(raw: string): string {
    if (typeof raw !== 'string') return '';
    let s = raw.replace(/\s/g, '_');
    s = s.replace(/[^A-Za-z0-9_]/g, '');
    if (s.length > MAX_PLAYER_NAME_LENGTH) s = s.slice(0, MAX_PLAYER_NAME_LENGTH);
    return s;
}

/**
 * Decide whether a sanitized player name is eligible to be persisted/sent as an identity.
 * Purpose: keep client-side storage and server identity behavior aligned so short/long
 * placeholders are treated as "no name" rather than becoming semi-valid player identities.
 * @param {string} val - Candidate sanitized name.
 * @returns {boolean} True when length is inside configured min/max bounds.
 */
export function isNameLengthValid(val: string): boolean {
    if (typeof val !== 'string') return false;
    return val.length >= MIN_PLAYER_NAME_LENGTH && val.length <= MAX_PLAYER_NAME_LENGTH;
}

/**
 * Reflect the "accepted as player identity" policy in the input UI.
 * Purpose: communicate whether the current text will actually be used as the
 * player's name (persisted and sent), while allowing empty input to stay neutral
 * because empty is treated as unnamed fallback state.
 * @param {HTMLInputElement|null} inputEl - Input to decorate with validity state.
 * @param {string} val - Current input value (ideally sanitized).
 * @returns {void}
 */
export function checkNameLengthValidity(inputEl: HTMLInputElement | null, val: string): void {
    if (!inputEl) return;
    const validLength = val.length === 0 || isNameLengthValid(val);
    if (validLength) {
        inputEl.classList.remove('invalid');
        inputEl.removeAttribute('aria-invalid');
    }
    else {
        inputEl.classList.add('invalid');
        inputEl.setAttribute('aria-invalid', 'true');
    }
}

/**
 * Read the client's desired player name from the online name input or localStorage,
 * sanitize it, enforce length policy, and return a final name string.
 * Order of preference: input field value (if present) -> localStorage.
 * If the sanitized value fails `isNameLengthValid`, returns 'Player'.
 * @param {HTMLInputElement|null} [inputEl] - Input to read value from.
 * @returns {string}
 */
export function getClientName(inputEl?: HTMLInputElement | null): string {
    try {
        const inputVal = inputEl?.value;
        const stored = localStorage.getItem(PLAYER_NAME);
        const raw = inputVal || stored;
        const cleaned = sanitizeName(raw || '');
        return isNameLengthValid(cleaned) ? cleaned : 'Player';
    } catch {
        return 'Anomaly';
    }
}

// Device helpers ----------------------------------------------------------
/**
 * Broad mobile detection using feature hints (coarse pointer, touch points, UA hints).
 * @returns {boolean} True if device is likely mobile/touch-centric.
 */
export function isMobileDevice(): boolean {
    if (typeof navigator !== 'undefined') {
        const uaDataMobile = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
        if (typeof uaDataMobile === 'boolean' && uaDataMobile) return true;
        if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) return true;
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        try {
            if (window.matchMedia('(pointer: coarse)').matches) return true;
        } catch (e) { /* ignore */ void e; }
    }

    return false;
}

// Tips helpers ------------------------------------------------------------
/**
 * Build weighted tips list with optional mobile variants.
 * @returns {Array<{text:string,weight:number}>} Tips list.
 */
export function getContextTips(): Tip[] {
    const mobile: boolean = isMobileDevice();
    const menu: MenuType = getMenuParam() || MENU_TYPES[0];
    const tips: Tip[] = [
        { text: 'Tip: Grid size defaults to a recommended value but can be adjusted manually.', weight: 1 },
        { text: 'Tip: <a href="https://joboblock.github.io" target="_blank">joboblock.github.io</a> redirects to this game.', weight: 2 },
        { text: 'Tip: Give this project a <a href="https://github.com/Joboblock/color-clash" target="_blank">Star</a> to support development!', weight: 2 },
        { text: 'Tip: This is a rare message.', weight: 0.1 },
        { text: 'Tip: Praise the Raute, embrace the Raute!', weight: 0.1 }
    ];

    // Menu-specific tips
    if (menu === 'local') {
        tips.push({ text: 'Tip: You can also set <code>?players=&lt;n&gt;&size=&lt;n&gt;</code> in the URL.', weight: 1 });
    }
    if (menu === 'practice') {
        tips.push({ text: 'Tip: You can exceed the ai strength limit by changing <code>?ai_strength=&lt;n&gt;</code> in the URL.', weight: 2 });
    } else {
        tips.push({ text: 'Tip: Use Practice mode to observe AI behavior and learn strategies.', weight: 1 });
    }

    if (mobile) tips.push({ text: 'Tip: Double-tap outside the grid to toggle fullscreen on mobile.', weight: 3 });
    else tips.push({ text: 'Tip: Use WASD or Arrow keys to move between menu controls and grid cells.', weight: 2 });
    return tips;
}

/**
 * Select one entry from a weighted list using linear scan.
 * @param {Array<{text:string,weight:number}>} list - Source weighted tips.
 * @returns {{text:string,weight:number}} Selected tip object.
 */
export function pickWeightedTip(list: Tip[]): Tip {
    let total = 0;
    for (const t of list) total += t.weight;
    let roll = Math.random() * total;
    for (const t of list) {
        roll -= t.weight;
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
    isNameLengthValid,
    getClientName,
    reflectValidity: checkNameLengthValidity,
    isMobileDevice,
    getContextTips,
    pickWeightedTip
};
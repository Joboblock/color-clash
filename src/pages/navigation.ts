// TODO: Finish port
// Menu navigation and URL routing logic
import { isMenuType, MENU_TYPES, type MenuType } from '../utils/generalUtils.js';

type AiStrengthTile = {
    setStrength: (strength: number) => void;
    onStartingColorChanged?: () => void;
};

type PageRegistry = {
    get: (id: string) => { components?: { aiStrengthTile?: AiStrengthTile } } | undefined;
};

type NavigationContext = {
    showMenuFor: (menu: MenuType) => void;
    updateRandomTip: () => void;
    clampPlayers: (n: number, maxPlayers: number) => number;
    computeSelectedColors: (playerCount: number) => string[];
    recreateGrid: (size: number, playerCount: number) => void;
    createEdgeCircles: () => void;
    exitFullscreenIfPossible: () => void | Promise<void>;
    setHidden: (el: HTMLElement | null, hidden: boolean) => void;
    pageRegistry: PageRegistry;
    playerColors: string[];
    playerBoxSlider?: HTMLElement | null;
    menuColorCycle?: HTMLElement | null;
    startBtn?: HTMLElement | null;
    setPracticeMode?: (enabled: boolean) => void;
    setAiStrength?: (strength: number) => void;
    setGameColors?: (colors: string[]) => void;
    getMyJoinedRoom?: () => string | null;
    getRoomKeyForRoom?: (roomName: string) => string | null;
};

/**
 * In-memory stack tracking menu navigation for back button behavior.
 */
export const menuHistoryStack: MenuType[] = [];

/**
 * Get the current menu parameter from the URL query string.
 * @returns Menu key ('first', 'local', 'online', 'host', 'practice') or `null` if missing/invalid.
 */
export function getMenuParam(): MenuType | null {
    try {
        const val = (new URLSearchParams(window.location.search)).get('menu');
        if (!val) return null;
        if (val === 'true') return 'first'; // backward compat
        return isMenuType(val) ? val : null;
    } catch { return null; }
}

/**
 * Set the menu parameter in the URL, updating history stack.
 * Removes game-only params (players, size, ai_strength) to keep URLs clean in menu states.
 * @param menuKey - Menu identifier to set in URL.
 * @param push - If `true`, pushes a new history entry; otherwise replaces current.
 */
export function setMenuParam(menuKey: MenuType, push: boolean = true): void {
    if (!isMenuType(menuKey)) return;
    const params = new URLSearchParams(window.location.search);
    params.set('menu', menuKey);
    // In any menu state, remove game-only params (players, size, ai_strength) so URL stays clean.
    if (menuKey !== null) {
        params.delete('players');
        params.delete('size');
        params.delete('ai_strength');
    }
    // Preserve room key param if present while navigating menus
    const existingKey = (new URLSearchParams(window.location.search)).get('key');
    if (existingKey) params.set('key', existingKey);
    else params.delete('key');
    const url = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
    if (push) {
        window.history.pushState({ menu: menuKey }, '', url);
        menuHistoryStack.push(menuKey);
    } else {
        window.history.replaceState({ menu: menuKey }, '', url);
        if (menuHistoryStack.length) menuHistoryStack[menuHistoryStack.length - 1] = menuKey; else menuHistoryStack.push(menuKey);
    }
}

/**
 * Update the URL with a room key parameter (for online games).
 * @param key - Room key to set in URL.
 */
export function updateUrlRoomKey(key: string): void {
    try {
        if (typeof key !== 'string' || !key.trim()) {
            removeUrlRoomKey();
            return;
        }
        const params = new URLSearchParams(window.location.search);
        params.set('key', key);
        const url = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
        // Replace current entry only (do NOT create a new history entry).
        // Keep existing history state untouched so this cannot affect menu/back behavior.
        window.history.replaceState(window.history.state, '', url);
    } catch { /* ignore */ }
}

/**
 * Remove the room key parameter from the URL.
 */
export function removeUrlRoomKey(): void {
    try {
        const params = new URLSearchParams(window.location.search);
        params.delete('key');
        const url = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
        // Replace current entry only (do NOT create a new history entry).
        window.history.replaceState(window.history.state, '', url);
    } catch { /* ignore */ }
}

/**
 * Remove the menu parameter from the URL (used when game starts).
 */
export function removeMenuParam(): void {
    try {
        const params = new URLSearchParams(window.location.search);
        params.delete('menu');
        const url = params.toString()
            ? `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`
            : `${window.location.pathname}${window.location.hash || ''}`;
        window.history.replaceState({ ...(window.history.state || {}) }, '', url);
    } catch { /* ignore */ }
}

/**
 * Ensure the current history entry has a state and initialize the in-memory stack.
 */
export function ensureHistoryStateInitialized(): void {
    try {
        const current = getMenuParam() || MENU_TYPES[0];
        if (!window.history.state || typeof window.history.state.menu === 'undefined') {
            window.history.replaceState({ menu: current }, '', window.location.href);
        }
        if (!menuHistoryStack.length) menuHistoryStack.push(current);
    } catch { /* ignore */ }
}

/**
 * Sync menu/game UI from current URL state (back/forward navigation handler).
 * Requires external context for game functions (showMenuFor, recreateGrid, etc).
 */
export function applyStateFromUrl(ctx: NavigationContext): void {
    // Intentionally do NOT sync room membership into the URL from here.
    // Room keys are updated by online join/rejoin events, and must not affect browser history.

    const params = new URLSearchParams(window.location.search);
    const typed = getMenuParam();
    const hasPS = params.has('players') || params.has('size');
    if (typed || !hasPS) {
        // Show the requested or default menu
        ctx.showMenuFor(typed || MENU_TYPES[0]);
        try { ctx.updateRandomTip(); } catch { /* ignore */ }
        // Reflect AI strength to UI if present
        const ad = parseInt(params.get('ai_strength') || '', 10);
        if (!Number.isNaN(ad) && ad >= 1) {
            try {
                const aiStrengthTile = ctx.pageRegistry.get('main')?.components?.aiStrengthTile;
                if (aiStrengthTile) {
                    aiStrengthTile.setStrength(Math.max(1, Math.min(5, ad)));
                    if (aiStrengthTile.onStartingColorChanged) aiStrengthTile.onStartingColorChanged();
                }
            } catch { /* ignore */ }
        }
        try { (ctx.playerBoxSlider || ctx.menuColorCycle || ctx.startBtn)?.focus?.(); } catch { /* ignore */ }
        //ctx.exitFullscreenIfPossible();
        return;
    }

    const p = ctx.clampPlayers(parseInt(params.get('players') || '', 10) || 2, ctx.playerColors.length);
    let s = parseInt(params.get('size') || '', 10);
    if (!Number.isInteger(s)) s = Math.max(3, 3 + p);
    const firstMenu = document.getElementById('firstMenu');
    const mainMenu = document.getElementById('mainMenu');
    const onlineMenu = document.getElementById('onlineMenu');
    ctx.setHidden(firstMenu, true);
    ctx.setHidden(mainMenu, true);
    if (onlineMenu) ctx.setHidden(onlineMenu, true);
    // Enable practice mode if any AI-related parameter exists in the URL
    if (ctx.setPracticeMode) {
        ctx.setPracticeMode(params.has('ai_strength'));
    }
    const ad = parseInt(params.get('ai_strength') || '', 10);
    if (!Number.isNaN(ad) && ad >= 1) {
        try {
            if (ctx.setAiStrength) ctx.setAiStrength(Math.max(1, ad));
        } catch { /* ignore */ }
    }
    if (ctx.setGameColors) {
        ctx.setGameColors(ctx.computeSelectedColors(p));
    }
    ctx.recreateGrid(Math.max(3, s), p);
    ctx.createEdgeCircles();
}
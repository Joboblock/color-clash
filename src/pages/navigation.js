// Menu navigation and URL routing logic

/**
 * In-memory stack tracking menu navigation for back button behavior.
 * @type {string[]}
 */
export let menuHistoryStack = [];

/**
 * Get the current menu parameter from the URL query string.
 * @returns {string | null} Menu key ('first', 'local', 'online', 'host', 'practice') or `null` if missing/invalid.
 */
export function getMenuParam() {
    try {
        const val = (new URLSearchParams(window.location.search)).get('menu');
        if (!val) return null;
        if (val === 'true') return 'first'; // backward compat
        const allowed = ['first', 'local', 'online', 'host', 'practice'];
        return allowed.includes(val) ? val : null;
    } catch { return null; }
}

/**
 * Set the menu parameter in the URL, updating history stack.
 * Removes game-only params (players, size, ai_depth) to keep URLs clean in menu states.
 * @param {string} menuKey - Menu identifier to set in URL.
 * @param {boolean} [push=true] - If `true`, pushes a new history entry; otherwise replaces current.
 * @returns {void}
 */
export function setMenuParam(menuKey, push = true) {
    const params = new URLSearchParams(window.location.search);
    params.set('menu', menuKey);
    // In any menu state, remove game-only params (players, size, ai_depth) so URL stays clean.
    if (menuKey !== null) {
        params.delete('players');
        params.delete('size');
        params.delete('ai_depth');
    }
    // Preserve room key param if present while navigating menus
    const existingKey = (new URLSearchParams(window.location.search)).get('key');
    if (existingKey) params.set('key', existingKey);
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
 * @param {string} key - Room key to set in URL.
 * @returns {void}
 */
export function updateUrlRoomKey(key) {
    try {
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
 * @returns {void}
 */
export function removeUrlRoomKey() {
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
 * @returns {void}
 */
export function removeMenuParam() {
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
 * @returns {void}
 */
export function ensureHistoryStateInitialized() {
    try {
        const current = getMenuParam() || 'first';
        if (!window.history.state || typeof window.history.state.menu === 'undefined') {
            window.history.replaceState({ menu: current }, '', window.location.href);
        }
        if (!menuHistoryStack.length) menuHistoryStack.push(current);
    } catch { /* ignore */ }
}

/**
 * Sync menu/game UI from current URL state (back/forward navigation handler).
 * Requires external context for game functions (showMenuFor, recreateGrid, etc).
 * @param {object} ctx - Context object with references to game state and functions.
 * @param {Function} ctx.showMenuFor - Function to display a specific menu.
 * @param {Function} ctx.updateRandomTip - Function to update tip display.
 * @param {Function} ctx.clampPlayers - Function to clamp player count.
 * @param {Function} ctx.computeSelectedColors - Function to compute color array.
 * @param {Function} ctx.recreateGrid - Function to recreate the game grid.
 * @param {Function} ctx.createEdgeCircles - Function to create edge circles.
 * @param {Function} ctx.exitFullscreenIfPossible - Function to exit fullscreen.
 * @param {Function} ctx.setHidden - Function to hide/show elements.
 * @param {object} ctx.pageRegistry - Registry of page components.
 * @param {string[]} ctx.playerColors - Array of player color keys.
 * @param {Function} [ctx.getMyJoinedRoom] - Function to get the currently joined room.
 * @param {Function} [ctx.getRoomKeyForRoom] - Function to get the room key for a given room.
 * @returns {void}
 */
export function applyStateFromUrl(ctx) {
    // Intentionally do NOT sync room membership into the URL from here.
    // Room keys are updated by online join/rejoin events, and must not affect browser history.

    const params = new URLSearchParams(window.location.search);
    const typed = getMenuParam();
    const hasPS = params.has('players') || params.has('size');
    if (typed || !hasPS) {
        // Show the requested or default menu
        ctx.showMenuFor(typed || 'first');
        try { ctx.updateRandomTip(); } catch { /* ignore */ }
        // Reflect AI strength to UI if present
        const ad = parseInt(params.get('ai_depth') || '', 10);
        if (!Number.isNaN(ad) && ad >= 1) {
            try {
                const aiStrengthTile = ctx.pageRegistry.get('main')?.components?.aiStrengthTile;
                aiStrengthTile && aiStrengthTile.setStrength(Math.max(1, Math.min(5, ad)));
                aiStrengthTile && aiStrengthTile.onStartingColorChanged && aiStrengthTile.onStartingColorChanged();
            } catch { /* ignore */ }
        }
        try { (ctx.playerBoxSlider || ctx.menuColorCycle || ctx.startBtn)?.focus(); } catch { /* ignore */ }
        ctx.exitFullscreenIfPossible();
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
        ctx.setPracticeMode(params.has('ai_depth') || params.has('ai_k'));
    }
    const ad = parseInt(params.get('ai_depth') || '', 10);
    if (!Number.isNaN(ad) && ad >= 1) {
        try {
            if (ctx.setAiDepth) ctx.setAiDepth(Math.max(1, ad));
        } catch { /* ignore */ }
    }
    if (ctx.setGameColors) {
        ctx.setGameColors(ctx.computeSelectedColors(p));
    }
    ctx.recreateGrid(Math.max(3, s), p);
    ctx.createEdgeCircles();
}

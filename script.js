import { OnlineConnection } from './src/online/connection.js';
// Page modules & registry (menu modularization). Component imports moved into page modules.
import { pageRegistry } from './src/pages/registry.js';
import { firstPage } from './src/pages/first.js';
import { onlinePage } from './src/pages/online.js';
import { mainPage } from './src/pages/main.js';

// General utilities (merged)
import { sanitizeName, getQueryParam, recommendedGridSize, defaultGridSizeForPlayers, clampPlayers, getDeviceTips, pickWeightedTip } from './src/utils/generalUtils.js';
import { playerColors, getStartingColorIndex, setStartingColorIndex, computeSelectedColors, computeStartPlayerIndex, activeColors as paletteActiveColors, applyPaletteCssVariables } from './src/game/palette.js';
import { computeAIMove } from './src/ai/engine.js';
import { PLAYER_NAME_LENGTH, MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD, DELAY_EXPLOSION_MS, DELAY_ANIMATION_MS, DELAY_GAME_END_MS, PERFORMANCE_MODE_CUTOFF, DOUBLE_TAP_THRESHOLD_MS, WS_INITIAL_BACKOFF_MS, WS_MAX_BACKOFF_MS } from './src/config/index.js';
// Edge circles component
import { createEdgeCircles, updateEdgeCirclesActive, getRestrictionType, computeEdgeCircleSize } from './src/components/edgeCircles.js';
// Navigation and routing
import { menuHistoryStack, getMenuParam, setMenuParam, updateUrlRoomKey, removeUrlRoomKey, ensureHistoryStateInitialized, applyStateFromUrl } from './src/pages/navigation.js';

// PLAYER_NAME_LENGTH now imported from nameUtils.js
document.addEventListener('DOMContentLoaded', () => {
    // Shared name sanitization and validity functions (top-level)
    // On load, if grid is visible and no menu is open, show edge circles
    setTimeout(() => {
        const gridEl = document.querySelector('.grid');
        const menus = [document.getElementById('firstMenu'), document.getElementById('mainMenu'), document.getElementById('onlineMenu')];
        const anyMenuVisible = menus.some(m => m && !m.classList.contains('hidden'));
        if (gridEl && gridEl.offsetParent !== null && !anyMenuVisible) {
            // Get player count from URL to ensure correct number of edge circles on reload
            const urlPlayerCount = parseInt(getQueryParam('players')) || 2;
            try { createEdgeCircles(urlPlayerCount, getEdgeCircleState()); } catch { /* ignore */ }
        }
    }, 0);
    // sanitizeName & reflectValidity now provided by nameUtils module (imported above)
    function showModalError(html) {
        let modal = document.getElementById('modalError');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modalError';
            modal.style.position = 'fixed';
            modal.style.left = '0';
            modal.style.top = '0';
            modal.style.width = '100vw';
            modal.style.height = '100vh';
            modal.style.background = 'rgba(0,0,0,0.5)';
            modal.style.display = 'flex';
            modal.style.alignItems = 'center';
            modal.style.justifyContent = 'center';
            modal.style.zIndex = '9999';
            modal.innerHTML = '<div style="background:#fff;padding:24px 32px;border-radius:10px;max-width:90vw;box-shadow:0 4px 24px rgba(0,0,0,0.18);font-size:1.1em;text-align:center;">' + html + '</div>';
            document.body.appendChild(modal);

            // Close modal on any pointerdown or Space/Enter keydown
            const closeModal = () => {
                if (modal) modal.remove();
                window.removeEventListener('pointerdown', closeModal, true);
                window.removeEventListener('keydown', keyHandler, true);
            };
            const keyHandler = (ev) => {
                // Always close on Space, Enter, or Escape, regardless of focus
                if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'Escape' || ev.key === 'Esc') {
                    ev.preventDefault();
                    ev.stopImmediatePropagation();
                    closeModal();
                }
            };
            setTimeout(() => {
                window.addEventListener('pointerdown', closeModal, true);
                window.addEventListener('keydown', keyHandler, true);
            }, 0);
        }
    }

    // --- Online connection (extracted to OnlineConnection module) ---
    // hostedRoom removed (legacy variable no longer needed after OnlineConnection extraction)
    let hostedDesiredGridSize = null; // Desired grid size chosen in Host menu
    // OnlineRoomList now initialized inside onlinePage module.
    // Online bottom action button in online menu
    const hostCustomGameBtnRef = document.getElementById('hostCustomGameBtn');
    // Track last applied server move sequence to avoid duplicates
    let lastAppliedSeq = 0;

    // Connection banner helpers stay in UI layer; OnlineConnection just emits events.

    // Only show the connection banner while user is in Online/Host menus
    function isOnlineMenusOpen() {
        try {
            // Show connection banner in both online and host menus
            const params = new URLSearchParams(window.location.search);
            const menu = params.get('menu');
            return menu === 'online' || menu === 'host';
        } catch {
            return false;
        }
    }

    function showConnBanner(message, kind = 'info') {
        // Respect UI context: suppress banner unless Online/Host menus are visible
        if (!isOnlineMenusOpen()) return;
        let bar = document.getElementById('connStatus');
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'connStatus';
            bar.style.position = 'fixed';
            bar.style.left = '0';
            bar.style.top = '0';
            bar.style.width = '100%';
            bar.style.zIndex = '10000';
            bar.style.padding = '8px 12px';
            bar.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial';
            bar.style.fontSize = '14px';
            bar.style.textAlign = 'center';
            bar.style.boxShadow = '0 2px 10px rgba(0,0,0,0.15)';
            document.body.appendChild(bar);
        }
        bar.textContent = message || '';
        bar.style.background = (kind === 'error') ? '#b00020' : (kind === 'ok' ? '#146c43' : '#8a8d91');
        bar.style.color = '#fff';
        bar.style.display = message ? 'block' : 'none';
    }

    function hideConnBanner() {
        const bar = document.getElementById('connStatus');
        if (bar) bar.style.display = 'none';
    }

    // Instantiate extracted connection
    const onlineConnection = new OnlineConnection({
        initialBackoffMs: WS_INITIAL_BACKOFF_MS,
        maxBackoffMs: WS_MAX_BACKOFF_MS,
        debug: false
    });
    onlineConnection.on('reconnect_scheduled', () => {
        showConnBanner('Reconnecting…', 'info');
    });
    onlineConnection.on('open', () => { hideConnBanner(); });
    onlineConnection.on('hosted', (msg) => {
        myJoinedRoom = msg.room;
        myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
        myRoomCurrentPlayers = 1;
        if (typeof msg.player === 'string' && msg.player) myPlayerName = msg.player;
        // Menu transition logic (same as before)
        const onlineMenu = document.getElementById('onlineMenu');
        const mainMenu = document.getElementById('mainMenu');
        let deferredRoomKey = null;
        if (onlineMenu && mainMenu) {
            mainMenu.classList.add('hidden');
            mainMenu.setAttribute('aria-hidden', 'true');
            onlineMenu.classList.remove('hidden');
            onlineMenu.setAttribute('aria-hidden', 'false');
            try { mainMenu.dataset.openedBy = ''; } catch { /* ignore */ }
        }
        if (msg.roomKey) {
            const params = new URLSearchParams(window.location.search);
            const currentMenu = params.get('menu');
            if (currentMenu === 'host') {
                deferredRoomKey = msg.roomKey;
                const popHandler = () => { updateUrlRoomKey(deferredRoomKey); window.removeEventListener('popstate', popHandler, true); };
                window.addEventListener('popstate', popHandler, true);
            } else { updateUrlRoomKey(msg.roomKey); }
        }
        updateStartButtonState();
    });
    onlineConnection.on('roomlist', (rooms) => {
        Object.entries(rooms || {}).forEach(([roomName, info]) => {
            if (info && Array.isArray(info.players)) {
                const names = info.players.map(p => p.name).join(', ');
                console.debug(`[RoomList] Room: ${roomName} | Players: ${names} (${info.currentPlayers}/${info.maxPlayers})`);
            } else {
                console.debug(`[RoomList] Room: ${roomName} | Players: ? (${info.currentPlayers}/${info.maxPlayers})`);
            }
        });
        const rlView = pageRegistry.get('online')?.components?.roomListView;
        try { rlView && rlView.render(rooms); } catch { /* ignore */ }
        updateStartButtonState(rooms);
    });
    onlineConnection.on('started', (msg) => {
        try {
            lastAppliedSeq = 0;
            onlineGameActive = true;
            onlinePlayers = Array.isArray(msg.players) ? msg.players.slice() : [];
            myOnlineIndex = onlinePlayers.indexOf(myPlayerName || '');
            const p = Math.max(2, Math.min(playerColors.length, onlinePlayers.length || 2));
            const s = Number.isInteger(msg.gridSize) ? Math.max(3, Math.min(16, parseInt(msg.gridSize, 10))) : recommendedGridSize(p);
            if (msg.colors && Array.isArray(msg.colors) && msg.colors.length >= p) {
                gameColors = msg.colors.slice(0, p);
            } else {
                gameColors = playerColors.slice(0, p);
            }
            playerCount = p;
            gridSize = s;
            document.documentElement.style.setProperty('--grid-size', gridSize);
            const firstMenu = document.getElementById('firstMenu');
            const mainMenu = document.getElementById('mainMenu');
            const onlineMenu = document.getElementById('onlineMenu');
            if (firstMenu) setHidden(firstMenu, true);
            if (mainMenu) setHidden(mainMenu, true);
            if (onlineMenu) setHidden(onlineMenu, true);
            practiceMode = false;
            recreateGrid(s, p);
            currentPlayer = 0;
            document.body.className = activeColors()[currentPlayer];
            updateGrid();
            try { createEdgeCircles(p, getEdgeCircleState()); } catch { /* ignore */ }
        } catch (err) { console.error('[Online] Failed to start online game', err); }
    });
    onlineConnection.on('request_preferred_colors', () => {
    try { const color = playerColors[getStartingColorIndex()] || 'green'; onlineConnection.sendPreferredColor(color); } catch (e) { console.warn('[Online] Failed preferred_color', e); }
    });
    onlineConnection.on('joined', (msg) => {
        myJoinedRoom = msg.room;
        if (msg.roomKey) updateUrlRoomKey(msg.roomKey);
        if (typeof msg.player === 'string' && msg.player) myPlayerName = msg.player;
        myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
        if (Array.isArray(msg.players)) { myRoomCurrentPlayers = msg.players.length; myRoomPlayers = msg.players; }
        try {
            if (Number.isInteger(msg.gridSize)) {
                const s = Math.max(3, Math.min(16, parseInt(msg.gridSize, 10)));
                menuGridSizeVal = s;
                try {
                    const gridSizeTile = pageRegistry.get('main')?.components?.gridSizeTile;
                    gridSizeTile && gridSizeTile.setSize(s, 'network', { silent: true, bump: false });
                } catch { /* ignore */ }
                if (s !== gridSize) recreateGrid(s, playerCount);
            }
        } catch { /* ignore */ }
        updateStartButtonState();
    });
    onlineConnection.on('left', (msg) => {
        if (!msg.room || msg.room === myJoinedRoom) myJoinedRoom = null;
        myRoomMaxPlayers = null; myRoomCurrentPlayers = 0; myRoomPlayers = [];
        removeUrlRoomKey();
        updateStartButtonState();
    });
    onlineConnection.on('roomupdate', (msg) => {
        if (msg.room && msg.room === myJoinedRoom && Array.isArray(msg.players)) {
            myRoomCurrentPlayers = msg.players.length; myRoomPlayers = msg.players; updateStartButtonState();
        }
    });
    onlineConnection.on('move', (msg) => {
        try {
            if (!onlineGameActive) return;
            if (msg.room && msg.room !== myJoinedRoom) return;
            const seq = Number(msg.seq);
            if (Number.isInteger(seq) && seq <= lastAppliedSeq) return;
            const r = Number(msg.row), c = Number(msg.col); const fromIdx = Number(msg.fromIndex);
            if (!Number.isInteger(r) || !Number.isInteger(c)) return;
            if (fromIdx === myOnlineIndex) { if (Number.isInteger(seq)) lastAppliedSeq = Math.max(lastAppliedSeq, seq); return; }
            if (Number.isInteger(seq)) lastAppliedSeq = Math.max(lastAppliedSeq, seq);
            const applyNow = () => { currentPlayer = Math.max(0, Math.min(playerCount - 1, fromIdx)); handleClick(r, c); };
            if (isProcessing) {
                const startTs = Date.now();
                const tryApply = () => {
                    if (!onlineGameActive) return;
                    if (!isProcessing) { applyNow(); return; }
                    if (Date.now() - startTs > 4000) { console.warn('[Online] Dropping deferred move after timeout'); return; }
                    setTimeout(tryApply, 100);
                };
                tryApply();
            } else { applyNow(); }
        } catch (err) { console.error('[Online] Error applying remote move', err); }
    });
    onlineConnection.on('rejoined', (msg) => {
        myJoinedRoom = msg.room || myJoinedRoom;
        if (msg.roomKey) updateUrlRoomKey(msg.roomKey);
        if (Array.isArray(msg.players)) { myRoomPlayers = msg.players; myRoomCurrentPlayers = msg.players.length; }
        myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
        try {
            const missed = Array.isArray(msg.recentMoves) ? msg.recentMoves.slice() : [];
            if (missed.length) {
                missed.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
                let idx = 0; const applyNext = () => {
                    if (idx >= missed.length) { updateStartButtonState(); return; }
                    const m = missed[idx]; const r = Number(m.row), c = Number(m.col), fromIdx = Number(m.fromIndex); const seq = Number(m.seq);
                    if (Number.isInteger(seq) && seq <= lastAppliedSeq) { idx++; applyNext(); return; }
                    if (!Number.isInteger(r) || !Number.isInteger(c) || !Number.isInteger(fromIdx)) { idx++; applyNext(); return; }
                    const doApply = () => { if (!onlineGameActive) { idx++; applyNext(); return; } currentPlayer = Math.max(0, Math.min(playerCount - 1, fromIdx)); handleClick(r, c); if (Number.isInteger(seq)) lastAppliedSeq = Math.max(lastAppliedSeq, seq); idx++; setTimeout(applyNext, 0); };
                    if (isProcessing) { setTimeout(applyNext, 100); } else { doApply(); }
                }; applyNext();
            }
        } catch (e) { console.warn('[Online] Failed to apply catch-up moves', e); }
        updateStartButtonState();
    });
    onlineConnection.on('error', (msg) => {
        console.debug('[Error]', msg.error);
        alert(msg.error);
        try {
            const err = String(msg.error || '');
            if (err.includes('Room not found') || err.includes('already started') || err.includes('full')) removeUrlRoomKey();
        } catch { /* ignore */ }
    });

    let myJoinedRoom = null; // track the room this tab is in
    let myRoomMaxPlayers = null; // capacity of the room I'm in
    let myRoomCurrentPlayers = 0; // current players in my room
    let myRoomPlayers = []; // last known players (first is host)
    let myPlayerName = null; // this client's player name used to join/host

    /**
     * Toggle the online bottom button between "Host Custom" and "Start Game" depending on room state.
     * Enabled when I'm in a full room (current >= max), disabled if not full; otherwise shows Host Custom.
     * @param {Record<string, {currentPlayers:number, maxPlayers:number}>} [rooms]
     */
    function updateStartButtonState(rooms) {
        const btn = document.getElementById('hostCustomGameBtn');
        if (!btn) return;
        // Refresh known room stats from latest rooms list
        if (rooms && myJoinedRoom && rooms[myJoinedRoom]) {
            const info = rooms[myJoinedRoom];
            if (Number.isFinite(info.maxPlayers)) myRoomMaxPlayers = info.maxPlayers;
            if (Number.isFinite(info.currentPlayers)) myRoomCurrentPlayers = info.currentPlayers;
            if (Array.isArray(info.players)) myRoomPlayers = info.players;
        }
        const inRoom = !!myJoinedRoom;
        const isFull = inRoom && Number.isFinite(myRoomMaxPlayers) && myRoomCurrentPlayers >= myRoomMaxPlayers;
        // Determine host name: prefer roomlist hostName, else first player in myRoomPlayers
        let hostName = null;
        if (rooms && myJoinedRoom && rooms[myJoinedRoom] && rooms[myJoinedRoom].hostName) {
            hostName = rooms[myJoinedRoom].hostName;
        } else if (Array.isArray(myRoomPlayers) && myRoomPlayers[0] && myRoomPlayers[0].name) {
            hostName = myRoomPlayers[0].name;
        }
        const amHost = inRoom && myPlayerName && hostName && (myPlayerName === hostName);
        if (!inRoom) {
            // Not in a room: show Host Custom (enabled)
            btn.textContent = 'Host Custom';
            btn.disabled = false;
            btn.classList.remove('start-mode');
            btn.removeAttribute('aria-disabled');
            btn.title = '';
        } else if (amHost) {
            // I'm the host: show Start Game; enabled iff room is full
            btn.textContent = 'Start Game';
            btn.disabled = !isFull;
            btn.classList.add('start-mode');
            btn.setAttribute('aria-disabled', isFull ? 'false' : 'true');
            btn.title = isFull ? '' : 'Waiting for players to join';
        } else {
            // I'm not the host: show Host Custom but disabled
            btn.textContent = 'Host Custom';
            btn.disabled = true;
            btn.classList.remove('start-mode');
            btn.setAttribute('aria-disabled', 'true');
            btn.title = 'Only the host can start the game';
        }
    }

    // updateRoomList removed: replaced by OnlineRoomList component (roomListView.render)

    function hostRoom() {
        const name = onlinePlayerNameInput.value.trim() || 'Player';
        function sendHost() {
            try {
                let debugPlayerName = sanitizeName((localStorage.getItem('playerName') || onlinePlayerNameInput.value || 'Player'));
                myPlayerName = debugPlayerName;
                const selectedPlayers = Math.max(2, Math.min(playerColors.length, Math.floor(menuPlayerCount || 2)));
                const desiredGrid = Number.isInteger(menuGridSizeVal) ? Math.max(3, Math.min(16, menuGridSizeVal)) : Math.max(3, selectedPlayers + 3);
                hostedDesiredGridSize = desiredGrid;
                onlineConnection.host({ roomName: name, maxPlayers: selectedPlayers, gridSize: desiredGrid, debugName: debugPlayerName });
            } catch (err) {
                console.error('[Host] Error hosting room:', err);
                if (err && err.stack) console.error(err.stack);
            }
        }
        onlineConnection.ensureConnected();
        if (onlineConnection.isConnected()) sendHost(); else onlineConnection.on('open', sendHost);
    }

    // Expose to onlinePage via context (used there)
    window.joinRoom = function joinRoom(roomName) {
        console.debug('[Join] Joining room:', roomName);
        // For debug: send player name, but do not use for logic
        let debugPlayerName = sanitizeName((localStorage.getItem('playerName') || onlinePlayerNameInput?.value || 'Player'));
        // Check for duplicate names in the room list
        let rooms = window.lastRoomList || {};
        let takenNames = [];
        if (rooms[roomName] && Array.isArray(rooms[roomName].players)) {
            takenNames = rooms[roomName].players.map(p => p.name);
        }
        let baseName = debugPlayerName.slice(0, PLAYER_NAME_LENGTH);
        let suffix = 2; // reserve 13th char for a single-digit suffix starting at 2
        let candidate = baseName;
        while (takenNames.includes(candidate) && suffix <= 9) {
            candidate = baseName.slice(0, PLAYER_NAME_LENGTH) + String(suffix);
            suffix++;
        }
        if (takenNames.includes(candidate)) {
            showModalError('All name variants are taken in this room. Please choose a different name.');
            return;
        }
        debugPlayerName = candidate;
        myPlayerName = debugPlayerName;

        // Ensure connection and send once open
        const doJoin = () => { onlineConnection.join(roomName, debugPlayerName); };
        onlineConnection.ensureConnected();
        if (onlineConnection.isConnected()) doJoin(); else { showConnBanner('Connecting to server…', 'info'); onlineConnection.on('open', doJoin); }
    }

    // Expose to onlinePage via context (used there)
    window.leaveRoom = function leaveRoom(roomName) {
        console.debug('[Leave] Leaving room:', roomName);
        const doLeave = () => { onlineConnection.leave(roomName); };
        onlineConnection.ensureConnected();
        if (onlineConnection.isConnected()) doLeave(); else { showConnBanner('Connecting to server…', 'info'); onlineConnection.on('open', doLeave); }
        // Remove key from URL when leaving
        removeUrlRoomKey();
    }

    // Wire Host Custom / Start Game button behavior in the online menu
    if (hostCustomGameBtnRef) {
        hostCustomGameBtnRef.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            // If we're in Start Game mode and enabled, trigger online start (stub)
            if (btn.classList && btn.classList.contains('start-mode') && !btn.disabled) {
                // Host starts the online game
                const startPayload = { type: 'start' };
                if (Number.isInteger(hostedDesiredGridSize)) startPayload.gridSize = hostedDesiredGridSize;
                onlineConnection.ensureConnected();
                if (onlineConnection.isConnected()) { onlineConnection.start(hostedDesiredGridSize); }
                else { showConnBanner('Connecting to server…', 'info'); onlineConnection.on('open', () => onlineConnection.start(hostedDesiredGridSize)); }
                return;
            }
            // Otherwise behave as Host Custom -> navigate to host menu
            navigateToMenu('host');
        });
    }

    onlineConnection.connect();

    // Clean up: leave room when page is refreshing, closing, or navigating away
    window.addEventListener('beforeunload', () => {
        if (myJoinedRoom && onlineConnection.isConnected()) {
            // Use sendBeacon for reliable cleanup during unload
            try {
                onlineConnection.leave(myJoinedRoom);
            } catch (e) {
                console.debug('[Cleanup] Failed to leave room on unload:', e);
            }
        }
    });

    // Auto-join flow: if ?key= present and not already in a room, attempt join_by_key
    (function attemptAutoJoinByKey() {
        try {
            const params = new URLSearchParams(window.location.search);
            const key = params.get('key');
            if (key && !myJoinedRoom) {
                // Ensure WS is open then send
                const sendJoinKey = () => { onlineConnection.joinByKey(key, (localStorage.getItem('playerName') || 'Player')); };
                if (onlineConnection.isConnected()) sendJoinKey(); else onlineConnection.on('open', sendJoinKey);
                // Navigate to online menu for visibility
                navigateToMenu('online');
            }
        } catch { /* ignore */ }
    })();

    // Declare name input fields before sync function
    const onlinePlayerNameInput = document.getElementById('onlinePlayerName');
    // PlayerNameFields component will handle synchronization between inputs later once both elements are known
    const gridElement = document.querySelector('.grid');
    // Online game state and guards
    let onlineGameActive = false;
    let onlinePlayers = [];
    let myOnlineIndex = -1;
    /** @type {{row:number,col:number}|null} */

    /**
     * Delegated grid click handler. Uses event.target.closest('.cell') to
     * resolve the clicked cell and routes to handleClick(row, col).
     * @param {MouseEvent|PointerEvent} ev - the click/pointer event.
     * @returns {void}
     */
    function onGridClick(ev) {
        const el = ev.target.closest('.cell');
        if (!el || !gridElement.contains(el)) return;
        const row = parseInt(el.dataset.row, 10);
        const col = parseInt(el.dataset.col, 10);
        if (Number.isInteger(row) && Number.isInteger(col)) {
            // In online mode, only the active player may act and only valid moves can be sent
            if (onlineGameActive) {
                if (isProcessing) return; // Prevent sending moves while processing
                if (currentPlayer !== myOnlineIndex) return;
                if (!isValidLocalMove(row, col, myOnlineIndex)) return;
                // Only act when connected; avoid local desync while offline
                if (!onlineConnection.isConnected()) {
                    showConnBanner('You are offline. Reconnecting…', 'error');
                    onlineConnection.ensureConnected();
                    return;
                }
                // Send move to server and rely on echo for other clients; apply locally for responsiveness
                onlineConnection.sendMove({ row, col, fromIndex: myOnlineIndex, nextIndex: (myOnlineIndex + 1) % playerCount, color: activeColors()[myOnlineIndex] });
                handleClick(row, col);
                return;
            }
            // Local / Practice mode: proceed as usual
            handleClick(row, col);
        }
    }
    // Attach once; per-cell listeners are removed.
    gridElement.addEventListener('click', onGridClick, { passive: true });

    let lastTapTime = 0;
    const doubleTapThreshold = DOUBLE_TAP_THRESHOLD_MS;
    /**
     * Handle pointer down and toggle fullscreen on mobile after a double-tap outside the grid.
     * @param {PointerEvent|MouseEvent|TouchEvent} ev - The pointer event.
     * @returns {void}
     */
    function onBodyPointerDown(ev) {
        if (!isMobileDevice()) return;
        // Only active during gameplay (menu hidden)
        if (mainMenu && !mainMenu.classList.contains('hidden')) return;
        // Ignore taps inside the grid
        const target = ev.target;
        if (target && (target === gridElement || target.closest('.grid'))) return;
        const now = Date.now();
        if (now - lastTapTime <= doubleTapThreshold) {
            ev.preventDefault();
            ev.stopPropagation();
            toggleFullscreenMobile();
            lastTapTime = 0; // reset
        } else {
            lastTapTime = now;
        }
    }
    // Use pointer events for broad device support; passive false so we can preventDefault
    document.body.addEventListener('pointerdown', onBodyPointerDown, { passive: false });

    // Detect practice mode via URL param
    const urlParams = new URLSearchParams(window.location.search);
    // Practice mode is enabled if any AI-related parameter is present in the URL
    const isPracticeMode = urlParams.has('ai_depth') || urlParams.has('ai_k');

    /**
     * Broad mobile detection using feature hints (coarse pointer, touch points, UA hints).
     * @returns {boolean} true if device is likely mobile/touch-centric.
     */
    function isMobileDevice() {
        // 1) UA Client Hints (Chromium): navigator.userAgentData?.mobile
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
            if (navigator.userAgentData.mobile) return true;
        }
        // 2) Coarse pointer (touch-centric devices)
        if (typeof window.matchMedia === 'function') {
            try {
                if (window.matchMedia('(pointer: coarse)').matches) return true;
            } catch (e) { /* ignore */ void e; }
        }
        // 3) Multiple touch points (covers iPadOS that reports as Mac)
        if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
            return true;
        }
        return false;
    }

    /**
     * Request fullscreen on mobile devices if possible; ignore failures silently.
     * @returns {Promise<void>} resolves when the request completes or is ignored.
     */
    async function requestFullscreenIfMobile() {
        if (!isMobileDevice()) return;
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || el.mozRequestFullScreen;
        if (typeof req === 'function') {
            try { await req.call(el); } catch (e) { /* no-op */ void e; }
        }
    }

    /**
     * Exit fullscreen mode if supported; ignore failures.
     * @returns {Promise<void>} resolves when exit completes or is ignored.
     */
    async function exitFullscreenIfPossible() {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen || document.mozCancelFullScreen;
        if (typeof exit === 'function') {
            try { await exit.call(document); } catch (e) { /* ignore */ void e; }
        }
    }

    /**
     * Check current fullscreen state.
     * @returns {boolean} true if any element is fullscreen.
     */
    function isFullscreenActive() {
        return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || document.mozFullScreenElement);
    }

    /**
     * Toggle fullscreen on mobile devices only.
     * @returns {Promise<void>} resolves after attempting to toggle.
     */
    async function toggleFullscreenMobile() {
        if (!isMobileDevice()) return;
        if (isFullscreenActive()) {
            await exitFullscreenIfPossible();
        } else {
            await requestFullscreenIfMobile();
        }
    }

    // Palette now provided by palette module
    let gameColors = null; // null until a game is started
    const activeColors = () => paletteActiveColors(gameColors);

    // Get and cap player count at the number of available colors
    let playerCount = parseInt(getQueryParam('players')) || 2;
    playerCount = Math.min(playerCount, playerColors.length);  // Cap at available colors

    // recommendedGridSize & defaultGridSizeForPlayers moved to utilities.js

    // Get grid size from URL or recommended schedule
    let gridSize = parseInt(getQueryParam('size'));
    if (!Number.isInteger(gridSize)) gridSize = defaultGridSizeForPlayers(playerCount);

    // Game Parameters
    const maxCellValue = MAX_CELL_VALUE;
    const initialPlacementValue = INITIAL_PLACEMENT_VALUE;
    const cellExplodeThreshold = CELL_EXPLODE_THRESHOLD;
    const delayExplosion = DELAY_EXPLOSION_MS;
    const delayAnimation = DELAY_ANIMATION_MS;
    const delayGameEnd = DELAY_GAME_END_MS;
    const performanceModeCutoff = PERFORMANCE_MODE_CUTOFF;

    document.documentElement.style.setProperty('--delay-explosion', `${delayExplosion}ms`);
    document.documentElement.style.setProperty('--delay-animation', `${delayAnimation}ms`);
    document.documentElement.style.setProperty('--grid-size', gridSize);

    // getQueryParam moved to utilities.js


    //#region Menu Logic
    const menuHint = document.querySelector('.menu-hint');
    // removed hidden native range input; visual slider maintains menuPlayerCount
    let menuPlayerCount = playerCount; // current selection from visual slider

    // Grid size display only (input removed)
    // gridValueEl kept for legacy access; mainPage handles display
    window.gridValueEl = document.getElementById('gridValue');
    let menuGridSizeVal = 0; // set after initial clamps
    const startBtn = document.getElementById('startBtn');
    const practiceBtn = document.getElementById('practiceBtn');
    const menuColorCycle = document.getElementById('menuColorCycle');
    // playerNameInput now handled via PlayerNameFields component (fetched at instantiation)
    const gridDecBtn = document.getElementById('gridDec');
    const gridIncBtn = document.getElementById('gridInc');
    // gridSizeTile / aiStrengthTile now provided by mainPage.components

    // Decide initial menu visibility using typed menu values
    const initialParams = new URLSearchParams(window.location.search);
    const hasPlayersOrSize = initialParams.has('players') || initialParams.has('size');

    const firstMenu = document.getElementById('firstMenu');
    const mainMenu = document.getElementById('mainMenu');
    const localGameBtn = document.getElementById('localGameBtn');
    const onlineGameBtn = document.getElementById('onlineGameBtn');
    const practiceMainBtn = document.getElementById('practiceMainBtn');

    // --- Helpers ---
    const setHidden = (el, hidden) => {
        if (!el) return;
        el.classList.toggle('hidden', !!hidden);
        el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
        // If we're hiding Online/Host menus, make sure to hide any connection banner
        if (hidden) {
            const id = el.id || '';
            const isOnline = id === 'onlineMenu';
            const isHostMenu = id === 'mainMenu' && (el.dataset.mode === 'host' || el.dataset.openedBy === 'host');
            if (isOnline || isHostMenu) hideConnBanner();
        }
    };

    // New: typed menu param helpers (first|local|online|host|practice)
    // Lightweight in-app stack of menu states to avoid timeout fallbacks
    // Navigation functions now imported from src/pages/navigation.js

    // Modular menu display now delegated to PageRegistry & page modules.
    function showMenuFor(menuKey) {
        let targetId = menuKey;
        let subMode = null;
        if (['local', 'host', 'practice'].includes(menuKey)) {
            targetId = 'main';
            subMode = menuKey; // main page handles sub-mode selection
        }
        pageRegistry.open(targetId, {
            subMode,
            onlineConnection,
            updateStartButtonState,
            showConnBanner,
            hideConnBanner,
            setMainMenuMode,
            // aiStrengthTile provided via mainPage components
            playerColors,
            startingColorIndex: getStartingColorIndex(),
            leaveRoom: (roomName) => window.leaveRoom(roomName),
            getMyJoinedRoom: () => myJoinedRoom,
            removeUrlRoomKey
        });
    }

    function navigateToMenu(menuKey) {
        // If navigating to online or host, ensure WS is (re)connecting
        if (menuKey === 'online' || menuKey === 'host') onlineConnection.ensureConnected();
        setMenuParam(menuKey, true);
        showMenuFor(menuKey);
    }

    // --- Main behaviour preserved, but simplified ---
    /**
     * Set main menu mode: 'local', 'host', or 'practice'.
     * Adjusts header, button visibility, and player name input.
     * @param {'local'|'host'|'practice'} mode
     */
    function setMainMenuMode(mode) {
        const mainMenu = document.getElementById('mainMenu');
        const header = mainMenu ? mainMenu.querySelector('.game-header-panel') : null;
        const startBtn = document.getElementById('startBtn');
        const playerNameInput = document.getElementById('playerName');
        if (!mainMenu) return;
        // Persist mode for later checks (e.g., connection banner gating)
        try { mainMenu.dataset.mode = String(mode); } catch { /* ignore */ }
        if (header) {
            if (mode === 'practice') header.textContent = 'Practice Mode';
            else if (mode === 'host') header.textContent = 'Host Game';
            else header.textContent = 'Local Game';
        }
        if (startBtn) {
            startBtn.style.display = '';
            if (mode === 'practice') startBtn.textContent = 'Practice';
            else if (mode === 'host') startBtn.textContent = 'Host';
            else startBtn.textContent = 'Start';
        }
        if (playerNameInput) playerNameInput.style.display = (mode === 'host') ? '' : 'none';
        const aiStrengthTile = document.getElementById('aiStrengthTile');
        if (aiStrengthTile) aiStrengthTile.style.display = (mode === 'practice') ? '' : 'none';
    }
    // Register and init page modules (after setMainMenuMode is defined so context functions exist)
    pageRegistry.register([firstPage, onlinePage, mainPage]);
    try {
        pageRegistry.initAll({
            onlineConnection,
            updateStartButtonState,
            showConnBanner,
            hideConnBanner,
            setMainMenuMode,
            // component palette & state
            playerColors,
            startingColorIndex: getStartingColorIndex(),
            recommendedGridSize,
            defaultGridSizeForPlayers,
            recreateGrid,
            getPlayerColors: () => playerColors,
            getStartingColorIndex: () => getStartingColorIndex(),
            setStartingColorIndex: (idx) => { setStartingColorIndex(Math.max(0, Math.min(playerColors.length - 1, idx | 0))); },
            onMenuPlayerCountChanged,
            clampPlayers: (n) => Math.max(2, Math.min(playerColors.length, Math.floor(n) || 2)),
            getMenuPlayerCount: () => menuPlayerCount,
            setMenuPlayerCount: (n) => { menuPlayerCount = Math.max(2, Math.min(playerColors.length, Math.floor(n) || 2)); },
            getMenuGridSizeVal: () => menuGridSizeVal,
            setMenuGridSizeVal: (v) => { menuGridSizeVal = v; },
            delayAnimation,
            showMenuFor,
            setMenuParam,
            // online menu direct actions (re-added after modularization)
            hostRoom,
            joinRoom: (roomName) => window.joinRoom(roomName),
            leaveRoom: (roomName) => window.leaveRoom(roomName),
            getMyJoinedRoom: () => myJoinedRoom,
            getPlayerName: () => myPlayerName,
            menuHistoryStack
        });
    } catch { /* ignore */ }
    // Initial routing based on typed menu param
    const typedMenu = getMenuParam();
    if (!typedMenu && hasPlayersOrSize) {
        // Explicit game state: ensure all menus hidden
        setHidden(firstMenu, true);
        setHidden(mainMenu, true);
        const onlineMenu = document.getElementById('onlineMenu');
        if (onlineMenu) setHidden(onlineMenu, true);
    } else {
        // If no menu param, default to first and replace URL so refresh/back is stable
        const menuToShow = typedMenu || 'first';
        if (!typedMenu) setMenuParam(menuToShow, false);
        showMenuFor(menuToShow);

        // Non-fatal: preserve previous side-effects
        try { updateRandomTip(); } catch { /* ignore */ }
        try { pageRegistry.get('main')?.components?.aiStrengthTile?.updatePreview(); } catch { /* ignore */ }
    }

    // Initialize history.state and our stack to the current menu once
    ensureHistoryStateInitialized();

    // Attach menu button listeners once (even if we started in-game)
    if (!document.body.dataset.menuInited) {
        document.body.dataset.menuInited = '1';
        // Local
        localGameBtn?.addEventListener('click', () => navigateToMenu('local'));
        // Online (guard connection)
        const onlineMenuEl = document.getElementById('onlineMenu');
        if (onlineGameBtn && onlineMenuEl) {
            onlineGameBtn.addEventListener('click', () => {
                // Always try to (re)connect when opening the online menu
                onlineConnection.ensureConnected();
                if (!onlineConnection.isConnected()) {
                    showConnBanner('Reconnecting…', 'info');
                }
                navigateToMenu('online');
            });
        }
        // Practice
        practiceMainBtn?.addEventListener('click', () => navigateToMenu('practice'));
    }

    // Build visual player box slider
    const playerBoxSlider = document.getElementById('playerBoxSlider');
    console.debug('[PlayerBoxSlider] element lookup:', playerBoxSlider ? '#playerBoxSlider found' : 'not found');

    // Ensure CSS variables for colors are set on :root BEFORE building boxes
    applyPaletteCssVariables();

    // Start with URL or defaults
    menuPlayerCount = clampPlayers(playerCount, playerColors.length);
    updateSizeBoundsForPlayers(menuPlayerCount);

    // Handle browser navigation to toggle between menu and game instead of leaving the app
    window.addEventListener('popstate', handleStateFromUrl);
    // Keep our in-memory stack aligned with the browser history on back/forward
    window.addEventListener('popstate', (ev) => {
        try {
            const stateMenu = (ev && ev.state && ev.state.menu) ? ev.state.menu : getMenuParam() || 'first';
            if (menuHistoryStack.length) menuHistoryStack.pop();
            menuHistoryStack.push(stateMenu);
        } catch { /* ignore */ }
    });

    // Utility: check if any menu overlay is open
    function isAnyMenuOpen() {
        const menus = [mainMenu, firstMenu, document.getElementById('onlineMenu')];
        return menus.some(m => m && !m.classList.contains('hidden'));
    }

    // Angle-based menu focus navigation
    function menuAngleFocusNav(e) {
        // Handle +/- shortcut for grid size when grid size buttons are visible
        if ((e.key === '+' || e.key === '=' || e.key === '-') && gridDecBtn && gridIncBtn && gridDecBtn.offsetParent !== null && gridIncBtn.offsetParent !== null) {
            if (e.key === '+' || e.key === '=') {
                e.preventDefault();
                gridIncBtn.click();
                return true;
            } else if (e.key === '-') {
                e.preventDefault();
                gridDecBtn.click();
                return true;
            }
        }

        if (!isAnyMenuOpen()) return false;
        let mappedKey = e.key;
        if (mappedKey === 'w' || mappedKey === 'W') mappedKey = 'ArrowUp';
        else if (mappedKey === 'a' || mappedKey === 'A') mappedKey = 'ArrowLeft';
        else if (mappedKey === 's' || mappedKey === 'S') mappedKey = 'ArrowDown';
        else if (mappedKey === 'd' || mappedKey === 'D') mappedKey = 'ArrowRight';
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(mappedKey)) return false;
        const menus = [mainMenu, firstMenu, document.getElementById('onlineMenu')];
        const openMenu = menus.find(m => m && !m.classList.contains('hidden'));
        if (!openMenu) return false;
        const focusableSelector = 'button,[role="button"],[role="slider"],a[href],input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(openMenu.querySelectorAll(focusableSelector)).filter(el => {
            if (!(el instanceof HTMLElement)) return false;
            // Exclude elements inside the tips area
            if (menuHint && menuHint.contains(el)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
        });
        if (focusables.length === 0) return false;
        const focused = document.activeElement;
        if (!focused || !openMenu.contains(focused)) {
            e.preventDefault();
            focusables[0].focus();
            return true;
        }
        // Prevent left/right navigation from moving focus when slider is focused
        if ((mappedKey === 'ArrowLeft' || mappedKey === 'ArrowRight') && focused === playerBoxSlider) {
            console.debug('[PlayerBoxSlider] focus guard: intercept left/right while slider focused');
            return false;
        }
        const curRect = focused.getBoundingClientRect();
        // For up/down/left/right, use center and left/right midpoints for origin
        const centerX = curRect.left + curRect.width / 2;
        const centerY = curRect.top + curRect.height / 2;
        const originPoints = [
            [centerX, centerY],
            [curRect.left, centerY],
            [curRect.right, centerY]
        ];
        let candidates = [];
        let minAngle = Math.PI / 2;
        for (const el of focusables) {
            if (el === focused) continue;
            const r = el.getBoundingClientRect();
            // For each origin point, move target point towards it horizontally (up/down) or vertically (left/right)
            let tCenterX = r.left + r.width / 2;
            let tCenterY = r.top + r.height / 2;
            for (const [ox, oy] of originPoints) {
                let tX = tCenterX;
                let tY = tCenterY;
                if (mappedKey === 'ArrowUp' || mappedKey === 'ArrowDown') {
                    // Move horizontally from target center towards this origin point
                    const dx = ox - tCenterX;
                    const maxMove = Math.min(Math.abs(dx), r.width / 2);
                    tX = tCenterX + Math.sign(dx) * maxMove;
                } else if (mappedKey === 'ArrowLeft' || mappedKey === 'ArrowRight') {
                    // Move vertically from target center towards this origin point
                    const dy = oy - tCenterY;
                    const maxMove = Math.min(Math.abs(dy), r.height / 2);
                    tY = tCenterY + Math.sign(dy) * maxMove;
                }
                const tx = tX, ty = tY;
                const dx = tx - ox;
                const dy = ty - oy;
                let match = false;
                if (mappedKey === 'ArrowLeft' && dx < 0) match = true;
                if (mappedKey === 'ArrowRight' && dx > 0) match = true;
                if (mappedKey === 'ArrowUp' && dy < 0) match = true;
                if (mappedKey === 'ArrowDown' && dy > 0) match = true;
                if (!match) continue;
                const len = Math.sqrt(dx * dx + dy * dy);
                const dir = mappedKey === 'ArrowLeft' ? [-1, 0] : mappedKey === 'ArrowRight' ? [1, 0] : mappedKey === 'ArrowUp' ? [0, -1] : [0, 1];
                const dot = (dx / len) * dir[0] + (dy / len) * dir[1];
                const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
                if (angle < minAngle) minAngle = angle;
                candidates.push({ el, angle, len, ox, oy, tx, ty });
            }
        }

        // Prefer closest element among those within 5° of the minimum angle
        const angleThreshold = minAngle + (5 * Math.PI / 180);
        let best = null;
        let bestDist = Infinity;
        for (const c of candidates) {
            if (c.angle <= angleThreshold) {
                if (c.len < bestDist) {
                    best = c.el;
                    bestDist = c.len;
                }
            }
        }
        if (best) {
            e.preventDefault();
            best.focus();
            return true;
        }
        return false;
    }

    // Global keydown handler for menu navigation (angle-based)
    document.addEventListener('keydown', (e) => {
        if (!isAnyMenuOpen()) return;
        // Prevent WASD navigation mapping when an editable element is focused
        const ae = document.activeElement;
        const tag = ae && ae.tagName && ae.tagName.toLowerCase();
        const isEditable = !!(ae && (tag === 'input' || tag === 'textarea' || ae.isContentEditable));
        const lower = (k) => (typeof k === 'string' ? k.toLowerCase() : k);
        const isWasd = ['w', 'a', 's', 'd'].includes(lower(e.key));
        if (isEditable && isWasd) {
            // Let the character be inserted into the field
            return;
        }
        // Only handle navigation keys for menus
        if (menuAngleFocusNav(e)) return;
        // Optionally: handle Enter/Space for menu button activation
        const openMenus = [mainMenu, firstMenu, document.getElementById('onlineMenu')].filter(m => m && !m.classList.contains('hidden'));
        if (!openMenus.length) return;
        const openMenu = openMenus[0];
        const focusableSelector = 'button,[role="button"],[role="slider"],a[href],input:not([type="hidden"]),select,textarea,[tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(openMenu.querySelectorAll(focusableSelector)).filter(el => {
            if (!(el instanceof HTMLElement)) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true';
        });
        if (focusables.length === 0) return;
        const focused = document.activeElement;
        if ((e.key === 'Enter' || e.key === ' ') && focused && openMenu.contains(focused)) {
            // Allow Space to pass (converts to _ in input)
            const tag = focused.tagName && focused.tagName.toLowerCase();
            const editable = (tag === 'input' || tag === 'textarea' || focused.isContentEditable);
            if (editable && e.key === ' ') {
                return;
            }
            e.preventDefault();
            focused.click && focused.click();
            return;
        }
    });

    startBtn.addEventListener('click', async () => {
        // Determine current menu mode from button text
        const mode = startBtn.textContent.toLowerCase();
        const p = clampPlayers(menuPlayerCount, playerColors.length);
        let s = Number.isInteger(menuGridSizeVal) ? menuGridSizeVal : 3;

        if (mode === 'start') {
            await requestFullscreenIfMobile();
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.delete('practice');
            params.set('players', String(p));
            params.set('size', String(s));
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.pushState({ mode: 'play', players: p, size: s }, '', newUrl);
            gameColors = computeSelectedColors(p);
            if (mainMenu) mainMenu.classList.add('hidden');
            practiceMode = false;
            recreateGrid(s, p);
            createEdgeCircles(p, getEdgeCircleState());
        } else if (mode === 'host') {
            // Host the room when clicking the start button in host mode
            hostRoom();
        }
        // Host menu: if in host mode, clicking the Host button should also allow back navigation to online menu
        if (mode === 'host' && mainMenu && mainMenu.dataset.mode === 'host') {
            window.history.back();
        }
        else if (mode === 'practice') {
            await requestFullscreenIfMobile();
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.set('players', String(p));
            params.set('size', String(s));
            try {
                const aiStrengthTile = pageRegistry.get('main')?.components?.aiStrengthTile;
                if (aiStrengthTile) params.set('ai_depth', String(aiStrengthTile.getStrength()));
            } catch { /* ignore */ }
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.pushState({ mode: 'ai', players: p, size: s }, '', newUrl);
            gameColors = computeSelectedColors(p);
            if (mainMenu) mainMenu.classList.add('hidden');
            practiceMode = true;
            try {
                const aiStrengthTile = pageRegistry.get('main')?.components?.aiStrengthTile;
                aiDepth = Math.max(1, parseInt(String(aiStrengthTile ? aiStrengthTile.getStrength() : 1), 10));
            } catch { /* ignore */ }
            recreateGrid(s, p);
            createEdgeCircles(p, getEdgeCircleState());
        }
    });

    // Practice button handler
    if (practiceBtn) {
        practiceBtn.textContent = 'Practice';
        practiceBtn.id = 'practiceBtn';
        practiceBtn.setAttribute('aria-label', 'Practice');

        practiceBtn.addEventListener('click', async () => {
            const p = clampPlayers(menuPlayerCount, playerColors.length);
            let s = Number.isInteger(menuGridSizeVal) ? menuGridSizeVal : 3;

            // Enter fullscreen on mobile from the same user gesture
            await requestFullscreenIfMobile();

            // Update URL without reloading (reflect AI settings)
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.set('players', String(p));
            params.set('size', String(s));
            // Set AI strength parameter from the preview value (1..5)
            try {
                const aiStrengthTile = pageRegistry.get('main')?.components?.aiStrengthTile;
                if (aiStrengthTile) params.set('ai_depth', String(aiStrengthTile.getStrength()));
            } catch { /* ignore */ }
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            // push a new history entry so Back returns to the menu instead of previous/blank
            window.history.pushState({ mode: 'ai', players: p, size: s }, '', newUrl);

            // Set the active game palette from the UI selection
            gameColors = computeSelectedColors(p);

            // Hide menu and start practice mode immediately
            if (mainMenu) mainMenu.classList.add('hidden');
            practiceMode = true;
            // Apply the chosen AI depth immediately for this session
            try {
                const aiStrengthTile = pageRegistry.get('main')?.components?.aiStrengthTile;
                aiDepth = Math.max(1, parseInt(String(aiStrengthTile ? aiStrengthTile.getStrength() : 1), 10));
            } catch { /* ignore */ }
            recreateGrid(s, p);
        });
    }
    //#endregion

    // Edge circles overlay: 4 corner dots plus 2+2 on the non-restricting sides

    // Edge circles functions now imported from src/components/edgeCircles.js

    // Only need to update the restriction type on resize
    window.addEventListener('resize', () => {
        const container = document.getElementById('edgeCirclesContainer');
        const newRestrict = getRestrictionType();
        if (container) {
            const oldRestrict = container.getAttribute('data-restrict');
            if (oldRestrict !== newRestrict) {
                // Rebuild layout when switching between side/top to update positional classes
                try { container.remove(); } catch { /* ignore */ }
                createEdgeCircles(playerCount, getEdgeCircleState());
                return; // createEdgeCircles sets size var as well
            } else {
                container.setAttribute('data-restrict', newRestrict);
            }
        } else {
            // If no container exists but grid is visible and no menus, create it
            const anyMenuVisible = [document.getElementById('firstMenu'), document.getElementById('mainMenu'), document.getElementById('onlineMenu')]
                .some(m => m && !m.classList.contains('hidden'));
            const gridEl = document.querySelector('.grid');
            if (gridEl && gridEl.offsetParent !== null && !anyMenuVisible) {
                createEdgeCircles(playerCount, getEdgeCircleState());
                return;
            }
        }
        // Also update circle size variable
        document.documentElement.style.setProperty('--edge-circle-size', computeEdgeCircleSize() + 'px');
    }, { passive: true });


    //#region Menu Functions
    /**
     * Wrapper for applyStateFromUrl that provides local context.
     * @returns {void}
     */
    function handleStateFromUrl() {
        applyStateFromUrl({
            showMenuFor,
            updateRandomTip,
            clampPlayers,
            computeSelectedColors,
            recreateGrid,
            createEdgeCircles: () => createEdgeCircles(playerCount, getEdgeCircleState()),
            exitFullscreenIfPossible,
            setHidden,
            pageRegistry,
            playerColors,
            playerBoxSlider,
            menuColorCycle,
            startBtn,
            setPracticeMode: (val) => { practiceMode = val; },
            setAiDepth: (val) => { aiDepth = val; },
            setGameColors: (val) => { gameColors = val; }
        });
    }

    /**
     * Pick a random entry from a weighted list of tips.
     * @param {Array<{text:string, weight?:number, html?:boolean}>} list - candidate tips.
     * @returns {{text:string, weight?:number, html?:boolean}} chosen tip.
     */

    /**
     * Update the menu hint with a randomly picked weighted tip.
     * @returns {void}
     */
    function updateRandomTip() {
        if (!menuHint) return;
        const tip = pickWeightedTip(getDeviceTips());
        if (tip && tip.html) menuHint.innerHTML = tip.text; else menuHint.textContent = tip ? tip.text : '';
    }

    // computeStartPlayerIndex moved to palette.js (use dynamic gameColors)
    const computeStartPlayerIndexProxy = () => computeStartPlayerIndex(gameColors);


    /**
     * Update the AI preview tile to show the next color after the current starting color.
     * Includes inner-circle coloring and a single centered value dot.
     * @returns {void}
     */
    // Legacy AI preview logic removed; handled by AIStrengthTile component.

    /**
     * Compute the active game palette starting from cycler color, for given player count.
     * @param {number} count - number of players/colors to include.
     * @returns {string[]} ordered color keys.
     */
    // computeSelectedColors moved to palette.js

    /**
     * Generic mix of a hex color toward a grayscale target value.
     * Replaces mixWithWhite and mixWithBlack.
     * @param {string} hex - source color (#rgb or #rrggbb).
     * @param {number} [gray=128] - grayscale target channel 0..255 (0=black, 255=white).
     * @param {number} [factor=0.5] - blend factor 0..1 (0 = original, 1 = fully gray).
     * @returns {string} css rgb(r,g,b) color string.
     */
    // mixTowardGray moved to utilities.js

    /**
     * Parse a CSS color string (#hex or rgb/rgba) into RGB channels.
     * @param {string} color - CSS color string.
     * @returns {{r:number,g:number,b:number}}
     */
    // cssColorToRgb moved to utilities.js

    /**
     * Convert hex color string (#rgb or #rrggbb) to RGB components.
     * @param {string} hex - color in hex form.
     * @returns {{r:number,g:number,b:number}} RGB channels 0..255.
     */
    // hexToRgb moved to utilities.js

    /**
     * Update grid-size input to match the recommended size for a player count.
     * @param {number} pCount - selected player count.
     * @returns {void} sets menuGridSize.value.
     */
    function updateSizeBoundsForPlayers(pCount) {
        const minForPlayers = recommendedGridSize(pCount);
        if (!Number.isInteger(menuGridSizeVal) || menuGridSizeVal < minForPlayers) {
            menuGridSizeVal = minForPlayers;
        }
        try {
            const gridSizeTile = pageRegistry.get('main')?.components?.gridSizeTile;
            gridSizeTile && gridSizeTile.applyPlayerCountBounds({ silent: true });
        } catch { /* ignore */ }
    }

    /**
     * Central handler when menu player count changes; syncs size, UI, and grid.
     * @param {number} newCount - selected player count.
     * @returns {void} may recreate the grid to reflect new settings.
     */
    // onMenuPlayerCountChanged used by mainPage slider via ctx; keep for backward compatibility.
    function onMenuPlayerCountChanged(newCount) {
    const minForPlayers = recommendedGridSize(newCount);
    const desired = defaultGridSizeForPlayers(newCount);
        const newGridSize = Math.max(minForPlayers, desired);
        if (newGridSize !== menuGridSizeVal) {
            menuPlayerCount = newCount;
            menuGridSizeVal = newGridSize;
            try {
                const gridSizeTile = pageRegistry.get('main')?.components?.gridSizeTile;
                gridSizeTile && gridSizeTile.setSize(newGridSize, 'playerCount');
            } catch { /* ignore */ }
            recreateGrid(menuGridSizeVal, newCount);
            try {
                const slider = pageRegistry.get('main')?.components?.slider;
                slider && slider.setCount(newCount, { silent: true });
            } catch { /* ignore */ }
        }
    }
    //#endregion


    //#region Actual Game Logic
    let grid = [];
    let isProcessing = false;
    let performanceMode = false;
    // Start with the first selected color (index 0) instead of a random player
    let currentPlayer = computeStartPlayerIndexProxy();
    let initialPlacements = Array(playerCount).fill(false);
    // Track last focused cell per player: { [playerIndex]: {row, col} }
    let playerLastFocus = Array(playerCount).fill(null);
    let gameWon = false;
    let invalidInitialPositions = [];
    let menuShownAfterWin = false; // guard to avoid repeated menu reopen scheduling
    let explosionTimerId = null;   // track explosion timeout for cancellation

    /**
     * Stop any scheduled explosion processing loop and clear processing flags.
     * @returns {void}
     */
    function stopExplosionLoop() {
        if (explosionTimerId !== null) {
            try { clearTimeout(explosionTimerId); } catch (e) { /* ignore */ void e; }
            explosionTimerId = null;
        }
        isProcessing = false;
    }

    /**
     * Centralized game-end scheduling used by win condition and invalid-initial cases.
     * @returns {void}
     */
    function scheduleGameEnd() {
        if (gameWon) return;
        gameWon = true;
        if (menuShownAfterWin) return; // schedule only once
        menuShownAfterWin = true;
        setTimeout(() => {
            if (!gameWon) return;
            stopExplosionLoop();
            clearCellFocus();
            const targetMenu = onlineGameActive ? 'online' : (practiceMode ? 'practice' : 'local');
            setMenuParam(targetMenu, false);
            showMenuFor(targetMenu);
            exitFullscreenIfPossible();
        }, delayGameEnd);
    }

    /**
     * Quick scan to determine if the given player has any valid initial placement.
     * @param {number} playerIndex
     * @returns {boolean}
     */
    function playerHasValidInitialPlacement(playerIndex) {
        if (initialPlacements[playerIndex]) return true; // already placed
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                if (grid[r][c].value === 0 && !isInitialPlacementInvalid(r, c)) return true;
            }
        }
        return false;
    }

    // Practice mode globals
    let practiceMode = isPracticeMode;
    const humanPlayer = 0; // first selected color is player index 0

    function getEdgeCircleState() {
        return {
            currentPlayer,
            onlineGameActive,
            myOnlineIndex,
            practiceMode,
            humanPlayer
        };
    }

    // Set gameColors based on initial playerCount (needed for edge circles to display correct count)
    if (hasPlayersOrSize) {
        gameColors = computeSelectedColors(playerCount);
    }

    // create initial grid
    recreateGrid(gridSize, playerCount);
    // Initialize AI preview after initial color application
    try { pageRegistry.get('main')?.components?.aiStrengthTile?.updatePreview(); } catch { /* ignore */ }

    // Keyboard navigation for game grid
    document.addEventListener('keydown', (e) => {
        // Block grid navigation if ANY menu is open
        if (isAnyMenuOpen()) return;
        const gridEl = document.querySelector('.grid');
        if (!gridEl) return;
        const key = e.key;
        // Move mapping first
        let mappedKey = key;
        if (mappedKey === 'w' || mappedKey === 'W') mappedKey = 'ArrowUp';
        else if (mappedKey === 'a' || mappedKey === 'A') mappedKey = 'ArrowLeft';
        else if (mappedKey === 's' || mappedKey === 'S') mappedKey = 'ArrowDown';
        else if (mappedKey === 'd' || mappedKey === 'D') mappedKey = 'ArrowRight';

        // Now filter based on mapped key
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(mappedKey)) return;

        // Get all cells
        const cells = Array.from(gridEl.querySelectorAll('.cell[tabindex="0"]'));
        if (!cells.length) return;
        // Helper: get cell at row,col
        const getCell = (row, col) => gridEl.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        // Helper: is cell owned by current player?
        const isOwnCell = (cell) => {
            if (!cell) return false;
            // Initial placement: allow all cells
            if (Array.isArray(initialPlacements) && initialPlacements.includes(false)) return true;
            // Otherwise, check cell class for current player color
            const colorKey = activeColors()[currentPlayer];
            return cell.classList.contains(colorKey);
        };
        // Find currently focused cell
        let focused = document.activeElement;
        // If nothing is focused or not a .cell, fallback to center/any own cell
        if (!focused || !focused.classList.contains('cell')) {
            const size = Math.sqrt(cells.length);
            const mid = Math.floor(size / 2);
            let center = getCell(mid, mid);
            if (!isOwnCell(center)) {
                center = cells.find(isOwnCell);
            }
            if (center) {
                e.preventDefault();
                center.focus();
            }
            return;
        }
        // If focused cell is not owned by player, allow arrow navigation to nearest own cell in that direction
        const row = parseInt(focused.dataset.row, 10);
        const col = parseInt(focused.dataset.col, 10);
        let target = null;
        // Direction vectors
        const dirMap = {
            'ArrowLeft': { vx: -1, vy: 0 },
            'ArrowRight': { vx: 1, vy: 0 },
            'ArrowUp': { vx: 0, vy: -1 },
            'ArrowDown': { vx: 0, vy: 1 }
        };
        const { vx, vy } = dirMap[mappedKey];
        // Always pick the own cell with the smallest angle (<90°), tiebreaker by distance
        let minAngle = Math.PI / 2; // 90°
        let minDist = Infinity;
        let bestCell = null;
        for (const cell of cells) {
            if (!isOwnCell(cell)) continue;
            const r2 = parseInt(cell.dataset.row, 10);
            const c2 = parseInt(cell.dataset.col, 10);
            const dx = c2 - col;
            const dy = r2 - row;
            if (dx === 0 && dy === 0) continue;
            // Normalize
            const len = Math.sqrt(dx * dx + dy * dy);
            const dot = (dx / len) * vx + (dy / len) * vy;
            const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (angle < minAngle || (Math.abs(angle - minAngle) < 1e-6 && len < minDist)) {
                minAngle = angle;
                minDist = len;
                bestCell = cell;
            }
        }
        if (bestCell) {
            target = bestCell;
        }
        if (target) {
            e.preventDefault();
            target.focus();
        }
    });

    // Add Enter/Space key activation for focused .cell elements in game mode
    document.addEventListener('keydown', (e) => {
        if (isAnyMenuOpen()) return;
        const gridEl = document.querySelector('.grid');
        if (!gridEl) return;
        const key = e.key;
        if (!(key === 'Enter' || key === ' ')) return;
        const focused = document.activeElement;
        if (!focused || !focused.classList.contains('cell')) return;
        const row = parseInt(focused.dataset.row, 10);
        const col = parseInt(focused.dataset.col, 10);
        // Prevent keyboard activation if AI is processing or it's not the human player's turn
        if (typeof isProcessing !== 'undefined' && isProcessing) return;
        if (onlineGameActive) {
            if (currentPlayer !== myOnlineIndex) return;
            if (!isValidLocalMove(row, col, myOnlineIndex)) return;
            // Only act when connected; avoid local desync while offline
            if (!onlineConnection.isConnected()) {
                showConnBanner('You are offline. Reconnecting…', 'error');
                onlineConnection.ensureConnected();
                return;
            }
            e.preventDefault();
            onlineConnection.sendMove({ row, col, fromIndex: myOnlineIndex, nextIndex: (myOnlineIndex + 1) % playerCount, color: activeColors()[myOnlineIndex] });
            handleClick(row, col);
            return;
        }
        if (typeof practiceMode !== 'undefined' && practiceMode && typeof currentPlayer !== 'undefined' && typeof humanPlayer !== 'undefined' && currentPlayer !== humanPlayer) return;
        if (Number.isInteger(row) && Number.isInteger(col)) {
            e.preventDefault();
            handleClick(row, col);
        }
    });
    //#endregion


    //#region Game Logic Functions
    /**
     * Rebuild the grid and reset game state for a given size and player count.
     * @param {number} newSize - grid dimension.
     * @param {number} newPlayerCount - number of players.
     * @returns {void} updates DOM grid, CSS vars, and game state.
     */
    function recreateGrid(newSize = gridSize, newPlayerCount = playerCount) {
        // update globals
        gridSize = newSize;
        playerCount = newPlayerCount;

        // update CSS variable for grid size; layout handled by CSS
        document.documentElement.style.setProperty('--grid-size', gridSize);
        // gridElement.style.gridTemplateColumns is NOT set here; CSS uses --grid-size

        // clear previous DOM cells
        while (gridElement.firstChild) gridElement.removeChild(gridElement.firstChild);

        // reset game state arrays according to new sizes
        grid = [];
        initialPlacements = Array(playerCount).fill(false);
        gameWon = false;
        menuShownAfterWin = false;
        stopExplosionLoop();
        isProcessing = false;
        performanceMode = false;
        // When creating a new level, start with the selected cycler color within the active palette
        currentPlayer = computeStartPlayerIndex();

        // recompute invalid initial positions for new size
        invalidInitialPositions = computeInvalidInitialPositions(gridSize);

        // build new cells (no per-cell listeners; delegation handles clicks)
        for (let i = 0; i < gridSize; i++) {
            grid[i] = [];
            for (let j = 0; j < gridSize; j++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = i;
                cell.dataset.col = j;
                cell.tabIndex = 0; // Make cell focusable for keyboard navigation
                grid[i][j] = { value: 0, player: '' };
                gridElement.appendChild(cell);
            }
        }

        // highlight invalid positions with new layout
        highlightInvalidInitialPositions();
        document.body.className = activeColors()[currentPlayer];
        // Sync active circle emphasis after grid rebuild
        try { updateEdgeCirclesActive(currentPlayer, onlineGameActive, myOnlineIndex, practiceMode, humanPlayer); } catch { /* ignore */ }

        // Reflect actual grid size in display value while menu is present
        menuGridSizeVal = Math.max(3, newSize);
        try {
            const gridSizeTile = pageRegistry.get('main')?.components?.gridSizeTile;
            gridSizeTile && gridSizeTile.setSize(menuGridSizeVal, 'gridRebuild', { silent: true, bump: false });
        } catch { /* ignore */ }

        // Ensure the visual player boxes reflect new player count via component
        try {
            const slider = pageRegistry.get('main')?.components?.slider;
            slider && slider.setCount(clampPlayers(playerCount, playerColors.length), { silent: true });
        } catch { /* ignore */ }

        // If practice mode is enabled, force human to be first color and
        // set the current player to the human (so they control the first color)
        if (practiceMode) {
            // Ensure humanPlayer index is valid for current playerCount
            // (humanPlayer is 0 by design; defensive check)
            currentPlayer = Math.min(humanPlayer, playerCount - 1);
            document.body.className = activeColors()[currentPlayer];
            updateGrid();
            // Trigger AI if the first randomly chosen currentPlayer isn't the human
            maybeTriggerAIMove();
        }
    }

    /**
     * Handle a user/AI click to place or increment a cell and schedule explosions.
     * @param {number} row - cell row.
     * @param {number} col - cell column.
     * @returns {void}
     */
    function handleClick(row, col) {
        if (isProcessing || gameWon) return;

        // Debug log for every move
        console.debug('[Move]', {
            player: activeColors()[currentPlayer],
            playerIndex: currentPlayer,
            row,
            col,
            online: onlineGameActive
        });

        const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        // Save last focused cell for current player
        playerLastFocus[currentPlayer] = { row, col };
        const cellColor = getPlayerColor(row, col);

        if (!initialPlacements[currentPlayer]) {
            if (isInitialPlacementInvalid(row, col)) return;

            if (grid[row][col].value === 0) {
                grid[row][col].value = initialPlacementValue;
                grid[row][col].player = activeColors()[currentPlayer];

                cell.classList.add(activeColors()[currentPlayer]);
                updateCell(row, col, 0, grid[row][col].player, true);
                updateGrid();
                highlightInvalidInitialPositions();
                isProcessing = true;
                // Delay explosion processing and update the initial placement flag afterward
                setTimeout(() => {
                    processExplosions();
                    initialPlacements[currentPlayer] = true;
                }, delayExplosion);
                return;
            }

        } else {
            if (grid[row][col].value > 0 && cellColor === activeColors()[currentPlayer]) {
                grid[row][col].value++;
                updateCell(row, col, 0, grid[row][col].player, true);

                if (grid[row][col].value >= cellExplodeThreshold) {
                    isProcessing = true;
                    setTimeout(processExplosions, delayExplosion); //DELAY Explosions
                } else {
                    switchPlayer();
                }
            }
        }
    }

    /**
     * Animate inner-circle fragments moving to neighboring cells during an explosion.
     * @param {Element} cell - origin DOM cell.
     * @param {Array<{row:number,col:number,value:number}>} targetCells - neighboring cells to receive fragments.
     * @param {string} player - color key.
     * @param {number} explosionValue - fragment value.
     * @returns {void} creates temporary DOM elements for animation.
     */
    function animateInnerCircles(cell, targetCells, player, explosionValue) {

        targetCells.forEach(target => {
            const innerCircle = document.createElement('div');
            innerCircle.className = `inner-circle ${player}`;
            cell.appendChild(innerCircle);
            updateValueCircles(innerCircle, explosionValue, false);

            const targetCell = document.querySelector(`.cell[data-row="${target.row}"][data-col="${target.col}"]`);
            const targetRect = targetCell.getBoundingClientRect();
            const cellRect = cell.getBoundingClientRect();
            const deltaX = targetRect.left - cellRect.left;
            const deltaY = targetRect.top - cellRect.top;

            // Use requestAnimationFrame for the movement
            requestAnimationFrame(() => {
                innerCircle.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
                innerCircle.classList.add('fade-out');
            });

            // Remove the innerCircle after the animation
            setTimeout(() => {
                innerCircle.remove();
            }, delayAnimation);
        });
    }

    /**
     * Process all cells at/above threshold, propagate values, and chain until stable.
     * @returns {void} updates grid state, schedules chained processing.
     */
    function processExplosions() {
        // If the menu is visible, stop looping (prevents background chains while in menu)
        if (mainMenu && !mainMenu.classList.contains('hidden')) {
            stopExplosionLoop();
            return;
        }
        let cellsToExplode = [];

        // Identify cells that need to explode
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (grid[i][j].value >= cellExplodeThreshold) {
                    cellsToExplode.push({ row: i, col: j, player: grid[i][j].player, value: grid[i][j].value });
                }
            }
        }

        // If no cells need to explode, end processing
        if (cellsToExplode.length === 0) {
            isProcessing = false;
            if (initialPlacements.every(placement => placement)) {
                checkWinCondition();
            }
            if (!gameWon) switchPlayer();
            return;
        }

        if (cellsToExplode.length >= performanceModeCutoff) {
            performanceMode = true;
        } else {
            performanceMode = false;
        }

        // Process each explosion
        cellsToExplode.forEach(cell => {
            const { row, col, player, value } = cell;
            const explosionValue = value - 3;
            grid[row][col].value = 0;
            updateCell(row, col, 0, '', true);

            let extraBackToOrigin = 0; // To track how many split-offs go out of bounds
            const targetCells = [];

            // Determine if this explosion is from an initial placement
            const isInitialPlacement = !initialPlacements.every(placement => placement);

            // Check all four directions
            if (row > 0) {
                targetCells.push({ row: row - 1, col, value: explosionValue });
            } else if (isInitialPlacement) {
                extraBackToOrigin++;  // Out of bounds (top)
            }

            if (row < gridSize - 1) {
                targetCells.push({ row: row + 1, col, value: explosionValue });
            } else if (isInitialPlacement) {
                extraBackToOrigin++;  // Out of bounds (bottom)
            }

            if (col > 0) {
                targetCells.push({ row, col: col - 1, value: explosionValue });
            } else if (isInitialPlacement) {
                extraBackToOrigin++;  // Out of bounds (left)
            }

            if (col < gridSize - 1) {
                targetCells.push({ row, col: col + 1, value: explosionValue });
            } else if (isInitialPlacement) {
                extraBackToOrigin++;  // Out of bounds (right)
            }

            // Animate valid explosions
            animateInnerCircles(document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`), targetCells, player, explosionValue);

            // Update grid for valid explosion targets
            targetCells.forEach(({ row, col, value }) => {
                updateCell(row, col, value, player, true);
            });

            // Add out-of-bounds split-offs back to origin cell during initial placements
            if (extraBackToOrigin > 0 && isInitialPlacement) {
                updateCell(row, col, extraBackToOrigin, player, true);
            }
        });

        updateGrid();

        explosionTimerId = setTimeout(() => {
            // Stop if the menu is visible
            if (mainMenu && !mainMenu.classList.contains('hidden')) {
                stopExplosionLoop();
                return;
            }
            if (initialPlacements.every(placement => placement)) {
                checkWinCondition();
            }
            processExplosions();
        }, delayExplosion);  // DELAY for chained explosions
    }

    /**
     * Apply value and ownership to a cell, then update its visuals.
     * @param {number} row - cell row.
     * @param {number} col - cell column.
     * @param {number} explosionValue - value to add.
     * @param {string} player - owner color key.
     * @param {boolean} causedByExplosion - for FX.
     * @returns {void} mutates grid cell and updates DOM.
     */
    function updateCell(row, col, explosionValue = 0, player = grid[row][col].player, causedByExplosion = false) {
        if (grid[row][col].value <= maxCellValue) {
            grid[row][col].value = Math.min(maxCellValue, grid[row][col].value + explosionValue);
            grid[row][col].player = player;
            const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
            const innerCircle = updateInnerCircle(cell, player, causedByExplosion);
            updateValueCircles(innerCircle, grid[row][col].value, causedByExplosion);
        }
    }

    /**
     * Refresh DOM for all cells based on current grid state and turn phase.
     * @returns {void} updates classes and value-circle visuals.
     */
    function updateGrid() {
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const cell = document.querySelector(`.cell[data-row="${i}"][data-col="${j}"]`);
                updateInnerCircle(cell, grid[i][j].player);
                updateValueCircles(cell.querySelector('.inner-circle'), grid[i][j].value);
                if (grid[i][j].player === activeColors()[currentPlayer]) {
                    cell.className = `cell ${grid[i][j].player}`;
                } else if (grid[i][j].player) {
                    cell.className = `cell inactive ${grid[i][j].player}`;
                } else {
                    cell.className = 'cell';
                }
            }
        }
        if (!initialPlacements.every(placement => placement)) {
            highlightInvalidInitialPositions();
        } else {
            clearInvalidHighlights();
        }
    }

    /**
     * Ensure the cell has an inner-circle element and set its owner color class.
     * @param {Element} cell - DOM cell.
     * @param {string} player - owner color key.
     * @returns {Element} the inner-circle DOM element.
     */
    function updateInnerCircle(cell, player) {
        let innerCircle = cell.querySelector('.inner-circle');
        if (!innerCircle) {
            innerCircle = document.createElement('div');
            innerCircle.className = 'inner-circle';
            cell.appendChild(innerCircle);
        }

        innerCircle.className = `inner-circle ${player}`;
        return innerCircle;
    }

    /**
     * Update or create inner value-circle elements based on the cell's value.
     * Uses a single RAF to coordinate transitions and removes surplus dots.
     * @param {Element} innerCircle - inner-circle element to populate.
     * @param {number} value - number of dots to display (0..maxCellValue).
     * @param {boolean} causedByExplosion - whether triggered by explosion.
     * @returns {void}
     */
    function updateValueCircles(innerCircle, value, causedByExplosion) {
        if (performanceMode) {
            innerCircle.querySelectorAll('.value-circle').forEach(circle => circle.remove());
            return;
        }

        // Layout reads: do these once
        const cellSize = innerCircle.parentElement.offsetWidth;
        const innerWidth = innerCircle.clientWidth; // actual rendered width of inner circle
        // .value-circle CSS sets width: 20% of the innerCircle, so compute the element width:
        const valueCircleWidth = innerWidth * 0.20;

        const radius =
            (cellSize / 6) *
            (value === 1 ? 0
                : value === 2 ? 1
                    : value === 3 ? 2 / Math.sqrt(3)
                        : Math.sqrt(2));
        const angleStep = 360 / Math.max(value, 1);

        const existingCircles = Array.from(innerCircle.querySelectorAll('.value-circle'));
        // Cancel any pending removals from previous updates to avoid races
        for (const c of existingCircles) {
            if (c._removalTimer) {
                try { clearTimeout(c._removalTimer); } catch { /* ignore */ }
                c._removalTimer = null;
            }
        }
        const existingCount = existingCircles.length;

        // Special case: AI strength preview should always "spawn" from center
        // so reuse of existing circles shouldn't animate from their previous positions.
        // Reset existing circles to centered, invisible state as starting point.
        const isAIPreview = !!innerCircle.closest('#aiStrengthTile');
        if (isAIPreview) {
            for (const c of existingCircles) {
                c.style.setProperty('--tx', 0);
                c.style.setProperty('--ty', 0);
                c.style.opacity = '0';
            }
        }

        if (causedByExplosion) {
            innerCircle.style.transform = 'scale(1.05)';
            setTimeout(() => innerCircle.style.transform = '', delayAnimation); //DELAY schmol innerCircle
        }

        // Collect elements we created so we can set final state for all of them in one RAF
        const newElements = [];
        for (let i = 0; i < value; i++) {
            // Rotate specific configurations for better aesthetics:
            // 3 → +30°, 4 → +45°, 5 → +72° (one full step for a pentagon)
            const angle = angleStep * i + (value === 3 ? 30 : value === 4 ? 45 : value === 5 ? 72 : 0);
            const x = radius * Math.cos((angle * Math.PI) / 180);
            const y = radius * Math.sin((angle * Math.PI) / 180);

            let valueCircle;
            const isNew = i >= existingCount;

            if (!isNew) {
                valueCircle = existingCircles[i];
                // If this circle was previously scheduled for removal, cancel it now
                if (valueCircle._removalTimer) {
                    try { clearTimeout(valueCircle._removalTimer); } catch { /* ignore */ }
                    valueCircle._removalTimer = null;
                }
                // For existing elements, we update in the batch below (no double RAF per element)
                newElements.push({ el: valueCircle, x, y });
            } else {
                valueCircle = document.createElement('div');
                valueCircle.className = 'value-circle';
                // initial state: centered inside innerCircle and invisible
                valueCircle.style.setProperty('--tx', 0);
                valueCircle.style.setProperty('--ty', 0);
                valueCircle.style.opacity = '0';
                innerCircle.appendChild(valueCircle);
                newElements.push({ el: valueCircle, x, y, newlyCreated: true });
            }
        }

        // Remove any surplus circles (fade out then remove)
        for (let i = value; i < existingCount; i++) {
            const valueCircle = existingCircles[i];
            valueCircle.style.opacity = '0';
            // Schedule removal but keep a handle so we can cancel if reused before timeout
            const tid = setTimeout(() => {
                try { valueCircle.remove(); } catch { /* ignore */ }
                valueCircle._removalTimer = null;
            }, delayAnimation);
            valueCircle._removalTimer = tid;
        }

        // One RAF to trigger all transitions together
        requestAnimationFrame(() => {
            // Optionally one more RAF can be used on extremely picky browsers, but usually one is enough.
            for (const item of newElements) {
                const { el, x, y } = item;
                // compute percent relative to the *element's own width*, as translate(%) uses the element box
                // element width = valueCircleWidth
                const xPercent = (x / valueCircleWidth) * 100;
                const yPercent = (y / valueCircleWidth) * 100;
                // set CSS vars -> CSS transform uses them; transition runs
                el.style.setProperty('--tx', xPercent);
                el.style.setProperty('--ty', yPercent);
                el.style.opacity = '1';
            }
        });
    }

    // Provide updateValueCircles to AI strength tile after its definition (late injection)
    try { pageRegistry.get('main')?.components?.aiStrengthTile?.setValueRenderer(updateValueCircles); } catch { /* ignore */ }

    /**
     * Advance to the next active player and update body color; trigger AI in practice mode.
     * @returns {void} updates currentPlayer and grid visuals.
     */
    function switchPlayer() {
        // const prevIndex = currentPlayer; // unused after instant send


        let tried = 0;
        while (tried < playerCount) {
            currentPlayer = (currentPlayer + 1) % playerCount;
            // During initial-placement phase: if this player cannot place at all, end game
            if (!initialPlacements[currentPlayer] && !playerHasValidInitialPlacement(currentPlayer)) {
                scheduleGameEnd();
                return;
            }
            // Accept this player if they either have cells (normal phase) or are still placing
            if (!initialPlacements[currentPlayer] || hasCells(currentPlayer) || !initialPlacements.every(p => p)) break;
            tried++;
        }

        document.body.className = activeColors()[currentPlayer];
        // Update edge circle emphasis for new active player
        try { updateEdgeCirclesActive(currentPlayer, onlineGameActive, myOnlineIndex, practiceMode, humanPlayer); } catch { /* ignore */ }
        clearCellFocus();
        updateGrid();
        // Restore focus to last focused cell for this player, if any
        restorePlayerFocus();
        // If in practice mode, possibly trigger AI move for non-human players
        maybeTriggerAIMove();
        // ...existing code...
        // Online: sending move is now handled instantly in click/keyboard handler
        // ...existing code...
    }

    /**
     * Restore focus to the last cell focused by the current player, if any.
     */
    function restorePlayerFocus() {
        // Only restore focus for human player (practiceMode: currentPlayer === humanPlayer)
        if (typeof practiceMode !== 'undefined' && practiceMode && typeof currentPlayer !== 'undefined' && typeof humanPlayer !== 'undefined' && currentPlayer !== humanPlayer) return;
        const pos = playerLastFocus[currentPlayer];
        if (pos) {
            const cell = document.querySelector(`.cell[data-row="${pos.row}"][data-col="${pos.col}"]`);
            if (cell) cell.focus();
        }
    }

    /**
     * Clears focus from any grid cell (for accessibility: after turn ends).
     */
    function clearCellFocus() {
        const focused = document.activeElement;
        if (focused && focused.classList.contains('cell')) {
            focused.blur();
        }
    }

    /**
     * Check if the player owns at least one visible cell on the board.
     * @param {number} playerIndex - index within playerColors.
     * @returns {boolean} true if any cell has the player's class.
     */
    function hasCells(playerIndex) {
        return Array.from(document.querySelectorAll('.cell'))
            .some(cell => cell.classList.contains(activeColors()[playerIndex]));
    }

    /**
     * Get the current owning color of a grid cell.
     * @param {number} row - cell row.
     * @param {number} col - cell column.
     * @returns {string} owner color key or '' for none.
     */
    function getPlayerColor(row, col) {
        return grid[row][col].player;
    }

    /**
     * Determine if a move is valid for the given player under current rules.
     * - During that player's initial placement phase: must be an empty cell and not violate placement rules.
     * - Otherwise: must be a cell owned by that player (increment).
     * @param {number} row
     * @param {number} col
     * @param {number} playerIndex
     * @returns {boolean}
     */
    function isValidLocalMove(row, col, playerIndex) {
        if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
        if (!Array.isArray(initialPlacements) || playerIndex < 0 || playerIndex >= playerCount) return false;
        // Initial placement for this player
        if (!initialPlacements[playerIndex]) {
            return grid[row][col].value === 0 && !isInitialPlacementInvalid(row, col);
        }
        // Regular move: must click own cell
        return grid[row][col].value > 0 && getPlayerColor(row, col) === activeColors()[playerIndex];
    }

    /**
     * Validate if an initial placement at (row,col) violates center/adjacency rules.
     * @param {number} row - cell row.
     * @param {number} col - cell column.
     * @returns {boolean} true if placement is invalid.
     */
    function isInitialPlacementInvalid(row, col) {
        if (invalidInitialPositions.some(pos => pos.r === row && pos.c === col)) {
            return true;
        }

        const adjacentPositions = [
            { r: row - 1, c: col },
            { r: row + 1, c: col },
            { r: row, c: col - 1 },
            { r: row, c: col + 1 }
        ];

        return adjacentPositions.some(pos =>
            pos.r >= 0 && pos.r < gridSize && pos.c >= 0 && pos.c < gridSize &&
            grid[pos.r][pos.c].player !== ''
        );
    }

    /**
     * Compute static invalid center positions based on odd/even grid size.
     * @param {number} size - grid dimension.
     * @returns {Array<{r:number,c:number}>} disallowed initial placement cells.
     */
    function computeInvalidInitialPositions(size) {
        const positions = [];
        if (size % 2 === 0) {
            const middle = size / 2;
            positions.push({ r: middle - 1, c: middle - 1 });
            positions.push({ r: middle - 1, c: middle });
            positions.push({ r: middle, c: middle - 1 });
            positions.push({ r: middle, c: middle });
        } else {
            const middle = Math.floor(size / 2);
            positions.push({ r: middle, c: middle });
            positions.push({ r: middle - 1, c: middle });
            positions.push({ r: middle + 1, c: middle });
            positions.push({ r: middle, c: middle - 1 });
            positions.push({ r: middle, c: middle + 1 });
        }
        return positions;
    }

    /**
     * Highlight cells that are invalid for initial placement in the current phase.
     * @returns {void} toggles .invalid on affected cells.
     */
    function highlightInvalidInitialPositions() {
        clearInvalidHighlights();

        invalidInitialPositions.forEach(pos => {
            const cell = document.querySelector(`.cell[data-row="${pos.r}"][data-col="${pos.c}"]`);
            cell.classList.add('invalid');
        });

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (initialPlacements.some(placement => placement) && isInitialPlacementInvalid(i, j)) {
                    const cell = document.querySelector(`.cell[data-row="${i}"][data-col="${j}"]`);
                    cell.classList.add('invalid');
                }
            }
        }
    }

    /**
     * Remove all invalid placement highlighting from the grid.
     * @returns {void}
     */
    function clearInvalidHighlights() {
        document.querySelectorAll('.cell.invalid').forEach(cell => {
            cell.classList.remove('invalid');
        });
    }

    /**
     * Determine if the game is won (only one player with any cells) and open menu after a delay.
     * @returns {void}
     */
    function checkWinCondition() {
        const playerCells = Array(playerCount).fill(0);
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const playerColor = grid[i][j].player;
                const playerIndex = activeColors().indexOf(playerColor);
                if (playerIndex >= 0) {
                    playerCells[playerIndex]++;
                }
            }
        }

        const activePlayers = playerCells.filter(count => count > 0).length;
        if (activePlayers === 1) scheduleGameEnd();
    }
    //#endregion


    //#region Practice / AI helpers (dataRespect + debug)
    // AI parameters (core logic now in src/ai/engine.js)
    const aiDebug = true;
    const dataRespectK = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_k')) || 25);
    let aiDepth = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_depth')) || 4);


    /**
     * In practice mode, trigger AI move if it's currently an AI player's turn.
     * @returns {void} may schedule aiMakeMoveFor with a short delay.
     */
    function maybeTriggerAIMove() {
        if (!practiceMode || gameWon || isProcessing || currentPlayer === humanPlayer) return;
        if (mainMenu && !mainMenu.classList.contains('hidden')) return;
        setTimeout(() => {
            if (isProcessing || gameWon || currentPlayer === humanPlayer) return;
            if (mainMenu && !mainMenu.classList.contains('hidden')) return;
            aiMakeMoveFor(currentPlayer);
        }, 350);
    }

    function ensureAIDebugStyles() {
        if (document.getElementById('aiDebugStyles')) return;
        const style = document.createElement('style');
        style.id = 'aiDebugStyles';
        style.textContent = `
            .ai-highlight { outline: 4px solid rgba(255,235,59,0.95) !important; box-shadow: 0 0 18px rgba(255,235,59,0.6); z-index:50; }
            #aiDebugPanel { position:fixed; right:12px; bottom:12px; background:rgba(18,18,18,0.88); color:#eaeaea; padding:10px 12px; font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial; font-size:13px; border-radius:8px; box-shadow:0 6px 18px rgba(0,0,0,0.45); max-width:420px; z-index:1000; }
            #aiDebugPanel h4 { margin:0 0 6px 0; font-size:13px; }
            #aiDebugPanel pre { margin:6px 0 0 0; white-space:pre-wrap; font-family:monospace; font-size:12px; max-height:240px; overflow:auto; }
        `;
        document.head.appendChild(style);
    }

    function clearAIDebugUI() {
        const existing = document.getElementById('aiDebugPanel');
        if (existing) existing.remove();
        document.querySelectorAll('.ai-highlight').forEach(el => el.classList.remove('ai-highlight'));
    }

    function showAIDebugPanelWithResponse(info) {
        ensureAIDebugStyles();
        const existing = document.getElementById('aiDebugPanel');
        if (existing) existing.remove();
        const panel = document.createElement('div'); panel.id = 'aiDebugPanel';
        const title = document.createElement('h4'); title.textContent = `AI dataRespect — player ${currentPlayer} (${activeColors()[currentPlayer]})`; panel.appendChild(title);
        const summary = document.createElement('div'); summary.innerHTML = `<strong>chosen gain:</strong> ${info.chosen ? info.chosen.gain : '—'} &nbsp; <strong>expl:</strong> ${info.chosen ? info.chosen.expl : '—'}`; panel.appendChild(summary);
        const listTitle = document.createElement('div'); listTitle.style.marginTop = '8px'; listTitle.innerHTML = `<em>candidates (top ${info.topK}) ordered by AI gain:</em>`; panel.appendChild(listTitle);
        const pre = document.createElement('pre'); pre.textContent = info.ordered.map((e, i) => `${i + 1}. (${e.r},${e.c}) src:${e.src} expl:${e.expl} gain:${e.gain} atk:${e.atk} def:${e.def}`).join('\n'); panel.appendChild(pre);
        document.body.appendChild(panel);
    }

    function aiMakeMoveFor(playerIndex) {
        if (isProcessing || gameWon) return;
        const result = computeAIMove({
            grid,
            initialPlacements,
            playerIndex,
            playerCount,
            gridSize,
            activeColors,
            invalidInitialPositions
        }, {
            maxCellValue,
            initialPlacementValue,
            dataRespectK,
            aiDepth,
            cellExplodeThreshold,
            debug: aiDebug
        });
        if (result.scheduleGameEnd) { scheduleGameEnd(); return; }
        if (result.requireAdvanceTurn) { if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true; switchPlayer(); return; }
        const move = result.chosen;
        if (aiDebug && result.debugInfo) {
            clearAIDebugUI();
            if (move) {
                const aiCell = document.querySelector(`.cell[data-row="${move.r}"][data-col="${move.c}"]`);
                if (aiCell) aiCell.classList.add('ai-highlight');
            }
            showAIDebugPanelWithResponse(result.debugInfo);
            if (move) {
                const onUserConfirm = (ev) => {
                    if (ev.type === 'click' || (ev.type === 'keydown' && (ev.key === 'Enter' || ev.key === ' '))) {
                        ev.stopPropagation(); ev.preventDefault();
                        document.removeEventListener('click', onUserConfirm, true);
                        document.removeEventListener('keydown', onUserConfirm, true);
                        clearAIDebugUI();
                        handleClick(move.r, move.c);
                    }
                };
                document.addEventListener('click', onUserConfirm, true);
                document.addEventListener('keydown', onUserConfirm, true);
                return;
            }
        }
        if (move) handleClick(move.r, move.c); else { if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true; switchPlayer(); }
    }

    //#endregion
});

import { OnlineConnection } from './src/online/connection.js';
// Page modules & registry (menu modularization). Component imports moved into page modules.
import { pageRegistry } from './src/pages/registry.js';
import { firstPage } from './src/pages/first.js';
import { onlinePage } from './src/pages/online.js';
import { mainPage } from './src/pages/main.js';

// General utilities (merged)
import { sanitizeName, getQueryParam, recommendedGridSize, defaultGridSizeForPlayers, clampPlayers, getDeviceTips, pickWeightedTip } from './src/utils/generalUtils.js';
import { computeInvalidInitialPositions as calcInvalidInitialPositions, isInitialPlacementInvalid as calcIsInitialPlacementInvalid, getCellsToExplode as calcGetCellsToExplode, computeExplosionTargets as calcComputeExplosionTargets } from './src/game/gridCalc.js';
import { playerColors, getStartingColorIndex, setStartingColorIndex, computeSelectedColors, computeStartPlayerIndex, activeColors as paletteActiveColors, applyPaletteCssVariables } from './src/game/palette.js';
import { advanceTurnIndex } from './src/game/turnCalc.js';
import { createOnlineTurnTracker } from './src/online/onlineTurn.js';
import { computeAIMove } from './src/ai/engine.js';
import { PLAYER_NAME_LENGTH, MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD, DELAY_EXPLOSION_MS, DELAY_ANIMATION_MS, DELAY_GAME_END_MS, PERFORMANCE_MODE_CUTOFF, DOUBLE_TAP_THRESHOLD_MS, WS_INITIAL_BACKOFF_MS, WS_MAX_BACKOFF_MS } from './src/config/index.js';
// Edge circles component
import { createEdgeCircles, updateEdgeCirclesActive, getRestrictionType, computeEdgeCircleSize } from './src/components/edgeCircles.js';
// Navigation and routing
import { menuHistoryStack, getMenuParam, setMenuParam, updateUrlRoomKey, removeUrlRoomKey, ensureHistoryStateInitialized, applyStateFromUrl } from './src/pages/navigation.js';
import { APP_VERSION } from './src/version.js';

// PLAYER_NAME_LENGTH now imported from nameUtils.js
document.addEventListener('DOMContentLoaded', () => {
    let serverVersion = null;

    function initVersionOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'versionInfoTag';
        overlay.setAttribute('role', 'status');
        const versionLine = document.createElement('div');
        overlay.append(versionLine);
        document.body.appendChild(overlay);
        return { versionLine };
    }

    function formatVersionTag() {
        if (!serverVersion) {
            return `c: ${APP_VERSION}`;
        }
        if (serverVersion === APP_VERSION) {
            return `c+s: ${APP_VERSION}`;
        }
        return `c: ${APP_VERSION}; s: ${serverVersion}`;
    }

    function renderVersionOverlay(state) {
        const summary = formatVersionTag();
        state.versionLine.textContent = summary;
    }

    function handleServerInfoPayload(payload) {
        if (payload && typeof payload.version === 'string' && payload.version.trim()) {
            serverVersion = payload.version.trim();
        }
        renderVersionOverlay(versionOverlayState);
    }

    const versionOverlayState = initVersionOverlay();
    function updateVersionOverlayVisibility() {
        const menus = [document.getElementById('firstMenu'), document.getElementById('mainMenu'), document.getElementById('onlineMenu')];
        const anyMenuVisible = menus.some(m => m && !m.classList.contains('hidden'));
        const overlay = document.getElementById('versionInfoTag');
        if (overlay) {
            overlay.style.display = anyMenuVisible ? 'block' : 'none';
        }
    }
    renderVersionOverlay(versionOverlayState);
    updateVersionOverlayVisibility();
    // Observe menu visibility changes
    const menuIds = ['firstMenu', 'mainMenu', 'onlineMenu'];
    const observer = new MutationObserver(updateVersionOverlayVisibility);
    for (const id of menuIds) {
        const el = document.getElementById(id);
        if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    }

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
    // Track if we're waiting for an echo after sending our own move
    let pendingEchoSeq = null;
    console.log('[Init] lastAppliedSeq initialized to', lastAppliedSeq);

    // Expose lastAppliedSeq for OnlineConnection ping(seq) catch-up.
    // OnlineConnection reads window.lastAppliedSeq; keep it synced.
    window.lastAppliedSeq = lastAppliedSeq;

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
        // Respect UI context: suppress banner unless Online/Host menus are visible or restoring session during game
        const isRestoringDuringGame = kind === 'error' && message.includes('Restoring Session');
        if (!isOnlineMenusOpen() && !isRestoringDuringGame) return;
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

    // Register page modules BEFORE setting up connection handlers
    // This ensures pageRegistry.get() calls in event handlers don't fail
    pageRegistry.register([firstPage, onlinePage, mainPage]);

    // Instantiate extracted connection
    const onlineConnection = new OnlineConnection({
        initialBackoffMs: WS_INITIAL_BACKOFF_MS,
        maxBackoffMs: WS_MAX_BACKOFF_MS
    });
    onlineConnection.on('reconnect_scheduled', () => {
        showConnBanner('Reconnecting…', 'info');
    });
    onlineConnection.on('open', () => { hideConnBanner(); });
    onlineConnection.on('packet_retry_started', () => {
        showConnBanner('Retrying connection…', 'info');
    });
    onlineConnection.on('packet_confirmed', () => {
        // Only hide banner if no other packets are being retried
        if (!onlineConnection.hasRetryingPackets()) {
            hideConnBanner();
        }
    });
    onlineConnection.on('info', handleServerInfoPayload);
    onlineConnection.on('restoring_session', ({ restoring }) => {
        if (restoring) {
            showConnBanner('Restoring Session…', 'error');
        } else {
            hideConnBanner();
        }
    });
    onlineConnection.on('roomlist', (rooms) => {
        // Store for access by connection retry logic
        window.lastRoomList = rooms;
        // If any room entry contains player info matching us, treat as confirmation of join/host
        let foundSelf = false;
        Object.entries(rooms || {}).forEach(([roomName, info]) => {
            // Check if this room contains our player info (matches current name or we don't have a name yet)
            if (info && typeof info.player === 'string' && (info.player === myPlayerName || myPlayerName === null)) {
                // Update our player name from the server (important for join_by_key where we don't know our final name)
                myPlayerName = info.player;
                myJoinedRoom = roomName;
                // If we switch rooms without ever hitting the "not in any room" state,
                // make sure the per-room start suppression does not carry over.
                try {
                    const prevRoomKey = myRoomKey || null;
                    const nextRoomKey = info.roomKey || null;
                    if (prevRoomKey && nextRoomKey && prevRoomKey !== nextRoomKey) {
                        window._onlineStartedOnceByRoomKey = window._onlineStartedOnceByRoomKey || Object.create(null);
                        delete window._onlineStartedOnceByRoomKey[prevRoomKey];
                    }
                } catch { /* ignore */ }
                myRoomKey = info.roomKey || null;
                myRoomMaxPlayers = Number.isFinite(info.maxPlayers) ? info.maxPlayers : myRoomMaxPlayers;
                if (Array.isArray(info.players)) { myRoomPlayers = info.players.slice(); myRoomCurrentPlayers = info.players.length; }
                // Update window references
                window.myJoinedRoom = myJoinedRoom;
                window.myRoomMaxPlayers = myRoomMaxPlayers;
                window.myRoomCurrentPlayers = myRoomCurrentPlayers;
                window.myRoomPlayers = myRoomPlayers;
                window.myPlayerName = myPlayerName;
                if (info.roomKey) updateUrlRoomKey(info.roomKey);
                // If grid size provided (lobby background), sync the UI tile and grid
                try {
                    if (Number.isInteger(info.gridSize)) {
                        const s = Math.max(3, Math.min(16, parseInt(info.gridSize, 10)));
                        menuGridSizeVal = s;
                        try {
                            const gridSizeTile = pageRegistry.get('main')?.components?.gridSizeTile;
                            gridSizeTile && gridSizeTile.setSize(s, 'network', { silent: true, bump: false });
                        } catch { /* ignore */ }
                        // Don't recreate the grid mid-game.
                        // Roomlist updates can arrive while we're already in a started room.
                        if (!onlineGameActive && s !== gridSize) recreateGrid(s, playerCount);
                    }
                } catch { /* ignore */ }
                foundSelf = true;
            }

        });
        if (foundSelf) {
            // Store session info for reconnection when we're in a room
            if (myJoinedRoom && myRoomKey && myPlayerName) {
                onlineConnection.storeSessionInfo({ roomKey: myRoomKey, playerName: myPlayerName });
            }
            // Navigate to online menu when transitioning into a room (from none).
            // Important: joining/hosting should NOT create an extra browser history entry.
            // We still want the UI to switch to the online menu, just without pushState.
            if (!window._wasInRoom && myJoinedRoom) {
                try { setMenuParam('online', false); } catch { /* ignore */ }
                try { showMenuFor('online'); } catch { /* ignore */ }
            }
            window._wasInRoom = true;
        } else {
            // Client is no longer in any room (according to this roomlist).
            // IMPORTANT: During session restoration, roomlist packets can be transient/out-of-order
            // (and uuid-gated on the client). Clearing membership here would incorrectly bump the UI
            // back to the Online menu while we're still restoring.
            const isRestoring = (() => {
                try { return !!(onlineConnection && typeof onlineConnection.isRestoringSession === 'function' && onlineConnection.isRestoringSession()); } catch { return false; }
            })();
            if (isRestoring && (myJoinedRoom || myRoomKey)) {
                // Keep the last known membership until restoration completes.
                // If restoration fails, OnlineConnection should flip restoring=false and/or we will
                // soon receive a stable roomlist that does not include us.
                window._wasInRoom = true;
            } else if (myJoinedRoom || myRoomKey) {
                // Leaving a room should not cause future rooms to ignore their first 'start'.
                try {
                    if (typeof window !== 'undefined') {
                        window._onlineStartedOnceByRoomKey = window._onlineStartedOnceByRoomKey || Object.create(null);
                        if (myRoomKey) delete window._onlineStartedOnceByRoomKey[myRoomKey];
                    }
                } catch { /* ignore */ }
                myJoinedRoom = null;
                myRoomKey = null;
                myRoomMaxPlayers = null;
                myRoomCurrentPlayers = 0;
                myRoomPlayers = [];
                window.myJoinedRoom = myJoinedRoom;
                window.myRoomMaxPlayers = myRoomMaxPlayers;
                window.myRoomCurrentPlayers = myRoomCurrentPlayers;
                window.myRoomPlayers = myRoomPlayers;
                removeUrlRoomKey();
            }
            if (!isRestoring) {
                window._wasInRoom = false;
            }
        }
        const rlView = pageRegistry.get('online')?.components?.roomListView;
        try { rlView && rlView.render(rooms); } catch { /* ignore */ }
        updateStartButtonState(rooms);
    });
    onlineConnection.on('color', () => {
        // All clients (host and non-host): server requesting color_ans with our color preference
        console.log('[Color Request] Server requesting color preference');
        if (!clientFullyInitialized) return;

        // Send our color preference and wait for start/start_cnf
        try {
            const color = playerColors[getStartingColorIndex()] || 'green';
            onlineConnection.sendColorAns(color);
            console.log('[Color] Sent color_ans, waiting for start confirmation...');
        } catch { /* ignore */ }
    });

    // Handler for non-host clients receiving 'start' with assigned colors
    onlineConnection.on('start', (msg) => {
        // Non-host receives assigned colors from server - this is when we start the game
        console.log('[Start] Server sent start with colors:', msg.colors);
        if (!clientFullyInitialized) return;

        // Only ignore duplicate 'start' messages if they belong to the SAME room/game instance.
        // A different startUuid signals a restart and must be processed even if we're already active.
        try {
            const currentRoomKey = myRoomKey || null;
            window._onlineStartedOnceByRoomKey = window._onlineStartedOnceByRoomKey || Object.create(null);
            window._onlineStartUuidByRoomKey = window._onlineStartUuidByRoomKey || Object.create(null);
            let startedOnce = currentRoomKey && window._onlineStartedOnceByRoomKey[currentRoomKey];

            const incomingStartUuid = (msg && typeof msg.startUuid === 'string' && msg.startUuid) ? msg.startUuid : null;
            const lastStartUuid = currentRoomKey ? (window._onlineStartUuidByRoomKey[currentRoomKey] || null) : null;
            const isRestart = !!(incomingStartUuid && lastStartUuid && incomingStartUuid !== lastStartUuid);

            if (isRestart) {
                console.log('[Start] 🔁 Detected restart (new startUuid), resetting per-room started gate', {
                    roomKey: currentRoomKey,
                    from: String(lastStartUuid).slice(0, 8),
                    to: String(incomingStartUuid).slice(0, 8)
                });
                if (currentRoomKey) window._onlineStartedOnceByRoomKey[currentRoomKey] = false;
                startedOnce = false;
            }

            if (onlineGameActive && startedOnce) {
                // Already in a started instance of this room. Don't reset/recreate anything; just re-ack for server retry logic.
                console.log('[Start] Already started in this room, ignoring start and resending start_ack', { roomKey: currentRoomKey });
                onlineConnection.sendStartAck();
                return;
            }

            // Mark room as started as soon as we decide to process the start message.
            if (currentRoomKey) {
                window._onlineStartedOnceByRoomKey[currentRoomKey] = true;
                if (incomingStartUuid) window._onlineStartUuidByRoomKey[currentRoomKey] = incomingStartUuid;
            }
        } catch { /* ignore */ }

        try {
            // Initialize game state for non-host clients
            lastAppliedSeq = 0;
            pendingEchoSeq = null;
            window.lastAppliedSeq = lastAppliedSeq;
            onlineTurnSeq = 0;
            onlineGameActive = true;
            onlinePlayers = Array.isArray(msg.players) ? msg.players.slice() : [];
            myOnlineIndex = onlinePlayers.indexOf(myPlayerName || '');
            console.log(`[Colors] myPlayerName="${myPlayerName}", onlinePlayers=`, onlinePlayers, `myOnlineIndex=${myOnlineIndex}`);

            const p = Math.max(2, Math.min(playerColors.length, onlinePlayers.length || 2));
            // Get gridSize from msg (server always sends it in colors packet)
            const s = Number.isInteger(msg.gridSize)
                ? Math.max(3, Math.min(16, parseInt(msg.gridSize, 10)))
                : recommendedGridSize(p);

            // Use server-provided colors
            if (msg.colors && Array.isArray(msg.colors) && msg.colors.length >= p) {
                gameColors = msg.colors.slice(0, p);
            } else {
                gameColors = playerColors.slice(0, p);
            }

            playerCount = p;
            gridSize = s;
            document.documentElement.style.setProperty('--grid-size', gridSize);

            // Hide menus and start game UI
            const firstMenu = document.getElementById('firstMenu');
            const mainMenu = document.getElementById('mainMenu');
            const onlineMenu = document.getElementById('onlineMenu');
            if (firstMenu) setHidden(firstMenu, true);
            if (mainMenu) setHidden(mainMenu, true);
            if (onlineMenu) setHidden(onlineMenu, true);

            practiceMode = false;
            recreateGrid(s, p);
            // At game start, render the turn UI immediately so everyone agrees it's player 0 first.
            _setOnlineTurnFromSeq();
            updateGrid();
            try { createEdgeCircles(p, getEdgeCircleState()); } catch { /* ignore */ }

            // Remove menu parameter from URL when game starts (push history like local/practice)
            try {
                const params = new URLSearchParams(window.location.search);
                params.delete('menu');
                const newUrl = params.toString()
                    ? `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`
                    : `${window.location.pathname}${window.location.hash || ''}`;
                window.history.pushState({ ...(window.history.state || {}), mode: 'online' }, '', newUrl);
            } catch {
                window.history.pushState({ ...(window.history.state || {}), mode: 'online' }, '', window.location.pathname + window.location.hash);
            }

            // Enable session restoration during active game
            onlineConnection.setGameActive();

            console.log(`[Start] Game started for non-host`);

            // Non-host sends acknowledgment
            onlineConnection.sendStartAck();
        } catch (err) {
            console.error('[Start] Failed to start game:', err);
        }
    });

    // Handler for host receiving 'start_cnf' as final confirmation
    onlineConnection.on('start_cnf', (msg) => {
        // Host receives final confirmation with assigned colors
        console.log('[Start Cnf] Server sent start confirmation with colors:', msg.colors);
        if (!clientFullyInitialized) return;

        // Only ignore duplicate 'start_cnf' messages if they belong to the SAME room/game instance.
        // A different startUuid signals a restart and must be processed even if we're already active.
        try {
            const currentRoomKey = myRoomKey || null;
            window._onlineStartedOnceByRoomKey = window._onlineStartedOnceByRoomKey || Object.create(null);
            window._onlineStartUuidByRoomKey = window._onlineStartUuidByRoomKey || Object.create(null);
            let startedOnce = currentRoomKey && window._onlineStartedOnceByRoomKey[currentRoomKey];

            const incomingStartUuid = (msg && typeof msg.startUuid === 'string' && msg.startUuid) ? msg.startUuid : null;
            const lastStartUuid = currentRoomKey ? (window._onlineStartUuidByRoomKey[currentRoomKey] || null) : null;
            const isRestart = !!(incomingStartUuid && lastStartUuid && incomingStartUuid !== lastStartUuid);

            if (isRestart) {
                console.log('[Start Cnf] 🔁 Detected restart (new startUuid), resetting per-room started gate', {
                    roomKey: currentRoomKey,
                    from: String(lastStartUuid).slice(0, 8),
                    to: String(incomingStartUuid).slice(0, 8)
                });
                if (currentRoomKey) window._onlineStartedOnceByRoomKey[currentRoomKey] = false;
                startedOnce = false;
            }

            if (onlineGameActive && startedOnce) {
                // If start_cnf is replayed (packet loss/retry), don't recreate/reset mid-game.
                console.log('[Start Cnf] Already started in this room, ignoring duplicate start_cnf', { roomKey: currentRoomKey });
                return;
            }

            // Mark room as started as soon as we decide to process the start confirmation.
            if (currentRoomKey) {
                window._onlineStartedOnceByRoomKey[currentRoomKey] = true;
                if (incomingStartUuid) window._onlineStartUuidByRoomKey[currentRoomKey] = incomingStartUuid;
            }
        } catch { /* ignore */ }

        try {
            // Initialize game state for host
            lastAppliedSeq = 0;
            pendingEchoSeq = null;
            window.lastAppliedSeq = lastAppliedSeq;
            onlineTurnSeq = 0;
            onlineGameActive = true;
            onlinePlayers = Array.isArray(msg.players) ? msg.players.slice() : [];
            myOnlineIndex = onlinePlayers.indexOf(myPlayerName || '');
            console.log(`[Start Cnf] myPlayerName="${myPlayerName}", onlinePlayers=`, onlinePlayers, `myOnlineIndex=${myOnlineIndex}`);

            const p = Math.max(2, Math.min(playerColors.length, onlinePlayers.length || 2));
            // Get gridSize from msg (server always sends it)
            const s = Number.isInteger(msg.gridSize)
                ? Math.max(3, Math.min(16, parseInt(msg.gridSize, 10)))
                : recommendedGridSize(p);

            // Use server-provided colors
            if (msg.colors && Array.isArray(msg.colors) && msg.colors.length >= p) {
                gameColors = msg.colors.slice(0, p);
            } else {
                gameColors = playerColors.slice(0, p);
            }

            playerCount = p;
            gridSize = s;
            document.documentElement.style.setProperty('--grid-size', gridSize);

            // Hide menus and start game UI
            const firstMenu = document.getElementById('firstMenu');
            const mainMenu = document.getElementById('mainMenu');
            const onlineMenu = document.getElementById('onlineMenu');
            if (firstMenu) setHidden(firstMenu, true);
            if (mainMenu) setHidden(mainMenu, true);
            if (onlineMenu) setHidden(onlineMenu, true);

            practiceMode = false;
            recreateGrid(s, p);
            // At game start, render the turn UI immediately so everyone agrees it's player 0 first.
            _setOnlineTurnFromSeq();
            updateGrid();
            try { createEdgeCircles(p, getEdgeCircleState()); } catch { /* ignore */ }

            // Remove menu parameter from URL when game starts (push history like local/practice)
            try {
                const params = new URLSearchParams(window.location.search);
                params.delete('menu');
                const newUrl = params.toString()
                    ? `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`
                    : `${window.location.pathname}${window.location.hash || ''}`;
                window.history.pushState({ ...(window.history.state || {}), mode: 'online' }, '', newUrl);
            } catch {
                window.history.pushState({ ...(window.history.state || {}), mode: 'online' }, '', window.location.pathname + window.location.hash);
            }

            // Enable session restoration during active game
            onlineConnection.setGameActive();

            console.log(`[Start Cnf] Game started for host`);
        } catch (err) {
            console.error('[Start Cnf] Failed to start game:', err);
        }
    });
    // Ordered move buffer: store out-of-order or deferred moves by sequence
    const pendingMoves = new Map(); // seq -> { r, c }

    // Online turn sequencing (client-maintained).
    // This is the local single source of truth for whose turn it is in online games.
    // It advances when we apply a move (ours or others') and is used for input gating.
    let onlineTurnSeq = 0; // next move sequence to be played/applied locally

    // Online turn state: persistent index of the player whose turn it is.
    // During initial placement, strict seq-driven order is used.
    // After initial placement, this advances via advanceTurnIndex() (skip eliminated players).
    let onlineTurnIndex = 0;
    let onlineTurnTracker = null;
    // Defer online turn advancement until explosion processing finalizes eliminations.
    // When a move is applied in online mode, we stash who played + which seq.
    // processExplosions() flushes this once the chain ends.
    let _pendingOnlineApplied = null; // { by:number, seq:number }
    function _scheduleOnlineTurnAdvance(by, seq) {
        if (!onlineGameActive) return;
        if (!Number.isInteger(Number(seq))) return;
        _pendingOnlineApplied = { by: Number(by) || 0, seq: Number(seq) || 0 };
        // If nothing is processing, advance immediately.
        if (!isProcessing) {
            try { _flushOnlineTurnAdvance(); } catch { /* ignore */ }
        }
    }
    function _flushOnlineTurnAdvance() {
        if (!onlineGameActive) return;
        if (!_pendingOnlineApplied) return;
        if (isProcessing) return;
        const { by, seq } = _pendingOnlineApplied;
        _pendingOnlineApplied = null;
        try {
            const n = _stableOnlineCount();
            if (!onlineTurnTracker || onlineTurnTracker.playerCount !== n) {
                onlineTurnTracker = createOnlineTurnTracker(n);
            }
            onlineTurnTracker.onMoveApplied(grid, activeColors(), by, seq);
        } catch { /* ignore */ }
    }

    // In online mode, avoid updating the "whose turn" UI mid-explosion-chain.
    // Instead, schedule a refresh to run once processing finishes.
    let _pendingOnlineTurnUiRefresh = false;
    function scheduleOnlineTurnUiRefresh() {
        if (!onlineGameActive) return;
        _pendingOnlineTurnUiRefresh = true;
    }
    function flushOnlineTurnUiRefresh() {
        if (!_pendingOnlineTurnUiRefresh) return;
        _pendingOnlineTurnUiRefresh = false;
        try { _setOnlineTurnFromSeq(); } catch { /* ignore */ }
    }

    function _stableOnlineCount() {
        return (onlineGameActive && Array.isArray(onlinePlayers) && onlinePlayers.length)
            ? onlinePlayers.length
            : (Array.isArray(gameColors) && gameColors.length)
                ? gameColors.length
                : (Number(playerCount) || 0);
    }

    function _setOnlineTurnFromSeq() {
        if (!onlineGameActive) return;
        const n = _stableOnlineCount();
        if (!n) return;
        const seq = Number(onlineTurnSeq) || 0;
        if (!onlineTurnTracker || onlineTurnTracker.playerCount !== n) {
            onlineTurnTracker = createOnlineTurnTracker(n);
        }
        // Align tracker to our next-to-play seq. For seq>playerCount it keeps internal state.
        onlineTurnTracker.setSeq(seq, (typeof grid !== 'undefined' ? grid : null), activeColors());

        // Tracker answers "who acts next" without replaying history.
        onlineTurnIndex = onlineTurnTracker.currentPlayer;

        const prevPlayer = currentPlayer;
        currentPlayer = onlineTurnIndex;
        if (!isProcessing && prevPlayer !== currentPlayer) {
            saveFocusForPlayer(prevPlayer);
        }
        const _turnColor = activeColors()[currentPlayer];
        document.body.className = _turnColor;
        try { updateEdgeCirclesActive(currentPlayer, onlineGameActive, myOnlineIndex, practiceMode, humanPlayer, gameColors); } catch { /* ignore */ }
        // Keep cell highlighting in sync with the current turn.
        // (Online mode doesn't use advanceSeqTurn(), so we refresh here.)
        try { updateGrid(); } catch { /* ignore */ }

        // Dev-only: helps confirm turn->color mapping when debugging online desync/visual issues.
        try {
            if (typeof window !== 'undefined' && window?.__CC_DEBUG_TURNS) {
                console.debug('[Online Turn]', { onlineTurnSeq, currentPlayer, turnColor: _turnColor, myOnlineIndex, lastAppliedSeq });
            }
        } catch { /* ignore */ }
    }

    // When applying server/catch-up moves we want better diagnostics.
    // This is set just-in-time before calling handleClick() for online moves.
    let _applyingOnlineSeq = null;

    /**
     * Determine if the game is still in the initial placement phase.
     * Rule: if the move sequence is higher than the online player count, initial placements have ended.
     * NOTE: playerCount may be derived from UI/config and can drift; onlinePlayers length is the stable value.
     * @param {number} seq
     * @returns {boolean}
     */
    function _isInitialPlacementPhaseForSeq(seq) {
        const s = Number(seq);
        const stableCount = (onlineGameActive && Array.isArray(onlinePlayers) && onlinePlayers.length)
            ? onlinePlayers.length
            : (Array.isArray(gameColors) && gameColors.length)
                ? gameColors.length
                : (Number(playerCount) || 0);
        // Unified 0-based seq: initial placement is seq 0..(players-1)
        return Number.isFinite(s) ? s < stableCount : true;
    }
    function tryApplyBufferedMoves() {
        // Apply any contiguous moves starting from lastAppliedSeq
        let appliedCount = 0;
        while (onlineGameActive) {
            // lastAppliedSeq is the next sequence number we still need to apply.
            const nextSeq = (Number(lastAppliedSeq) || 0);
            const m = pendingMoves.get(nextSeq);
            if (!m) break;
            // Apply this buffered move
            const { r, c } = m;
            console.log(`[Buffer] Draining seq ${nextSeq} at (${r},${c}) (myOnlineIndex=${myOnlineIndex}), lastAppliedSeq before=${lastAppliedSeq}`);
            // Moves no longer include fromIndex/nextIndex; derive currentPlayer from our local seq pointer.
            onlineTurnSeq = nextSeq;
            // During buffered application we may enter processing; keep UI updates consistent.
            if (isProcessing) scheduleOnlineTurnUiRefresh();
            else _setOnlineTurnFromSeq();
            // Apply with seq context and seq-based placement-phase forcing.
            const prevSeq = _applyingOnlineSeq;
            _applyingOnlineSeq = nextSeq;
            let prevInitialFlag = null;
            const isInitialPhase = _isInitialPlacementPhaseForSeq(nextSeq);
            if (Array.isArray(initialPlacements)) {
                prevInitialFlag = initialPlacements[currentPlayer];
                // Force correct phase for server-authoritative application.
                // - During initial placements (seq <= stable player count): force flag false so handleClick uses placement rules.
                // - After that: force flag true so handleClick uses ownership/increment rules.
                initialPlacements[currentPlayer] = isInitialPhase ? false : true;
            }
            const applied = handleClick(r, c);
            if (Array.isArray(initialPlacements) && prevInitialFlag !== null) initialPlacements[currentPlayer] = prevInitialFlag;
            _applyingOnlineSeq = prevSeq;
            console.log(`[Buffer] handleClick returned ${applied} for seq=${nextSeq}`);
            if (applied) {
                lastAppliedSeq = nextSeq + 1;
                window.lastAppliedSeq = lastAppliedSeq;
                onlineTurnSeq = lastAppliedSeq;
                // Advance online turn model once per applied move AFTER explosions finalize.
                try { _scheduleOnlineTurnAdvance(currentPlayer, nextSeq); } catch { /* ignore */ }
                if (isProcessing) scheduleOnlineTurnUiRefresh();
                else _setOnlineTurnFromSeq();
                console.log(`[Buffer] Updated lastAppliedSeq to ${lastAppliedSeq}`);
                pendingMoves.delete(nextSeq);
                appliedCount++;
            } else {
                console.warn(`[Buffer] Failed to apply seq ${nextSeq}, stopping drain (myOnlineIndex=${myOnlineIndex})`);
                break;
            }
        }
        // If we applied moves without triggering processing, ensure the turn UI is refreshed now.
        // When processing is active, the refresh is intentionally deferred and will flush at chain end.
        if (appliedCount > 0 && !isProcessing) {
            flushOnlineTurnUiRefresh();
        }
        if (appliedCount > 0) {
            console.log(`[Buffer] Drained ${appliedCount} buffered move(s). Remaining: ${pendingMoves.size} (myOnlineIndex=${myOnlineIndex})`);
        }
    }

    onlineConnection.on('move', (msg) => {
        try {
            console.log(`[Move Handler] Received move:`, msg, `onlineGameActive=${onlineGameActive}, myJoinedRoom=${myJoinedRoom}, lastAppliedSeq=${lastAppliedSeq}, myOnlineIndex=${myOnlineIndex}`);
            if (!onlineGameActive) {
                console.warn(`[Move Handler] Game not active, ignoring move (myOnlineIndex=${myOnlineIndex})`);
                return;
            }
            if (msg.room && msg.room !== myJoinedRoom) {
                console.warn(`[Move Handler] Wrong room: received ${msg.room}, in ${myJoinedRoom} (myOnlineIndex=${myOnlineIndex})`);
                return;
            }
            const seq = Number(msg.seq);
            const r = Number(msg.row), c = Number(msg.col);
            if (!Number.isInteger(r) || !Number.isInteger(c)) {
                console.warn(`[Move Handler] Invalid coordinates (myOnlineIndex=${myOnlineIndex})`);
                return;
            }

            // For other players' moves: only apply when in-order; otherwise store
            if (!Number.isInteger(seq)) {
                console.warn(`[Move] Received move without sequence number. Ignoring. (myOnlineIndex=${myOnlineIndex})`);
                return;
            }

            // Handle implicit echo confirmation: if we sent a move but haven't received our echo,
            // and we receive the opponent's next move, treat it as if our echo arrived
            if (pendingEchoSeq !== null && seq >= pendingEchoSeq + 1) {
                console.log(`[Implicit Echo] Received move seq=${seq} while waiting for echo seq=${pendingEchoSeq}. Confirming our move implicitly. (myOnlineIndex=${myOnlineIndex})`);
                // Our move was accepted by the server (otherwise opponent couldn't have moved next)
                // No need to apply locally again - we already did that when we sent it
                pendingEchoSeq = null;

                // If game has ended, now we can safely mark it inactive since move is confirmed
                if (gameWon) {
                    onlineConnection.setGameInactive();
                }

                // Now proceed to apply the opponent's move normally
            }

            const expectedNext = (Number(lastAppliedSeq) || 0);
            if (seq === expectedNext) {
                // Apply immediately, or buffer if UI is currently processing
                const doApply = () => {
                    console.log(`[Move] Applying seq ${seq} at (${r},${c}) (myOnlineIndex=${myOnlineIndex}), lastAppliedSeq before=${lastAppliedSeq}`);
                    // Moves no longer include fromIndex/nextIndex; derive currentPlayer from local seq pointer.
                    onlineTurnSeq = seq;
                    if (isProcessing) scheduleOnlineTurnUiRefresh();
                    else _setOnlineTurnFromSeq();
                    const prevSeq = _applyingOnlineSeq;
                    _applyingOnlineSeq = seq;
                    let prevInitialFlag = null;
                    const isInitialPhase = _isInitialPlacementPhaseForSeq(seq);
                    if (Array.isArray(initialPlacements)) {
                        prevInitialFlag = initialPlacements[currentPlayer];
                        initialPlacements[currentPlayer] = isInitialPhase ? false : true;
                    }
                    const applied = handleClick(r, c);
                    if (Array.isArray(initialPlacements) && prevInitialFlag !== null) initialPlacements[currentPlayer] = prevInitialFlag;
                    _applyingOnlineSeq = prevSeq;
                    console.log(`[Move] handleClick returned ${applied} for seq=${seq}`);
                    if (applied) {
                        lastAppliedSeq = seq + 1;
                        window.lastAppliedSeq = lastAppliedSeq;
                        onlineTurnSeq = lastAppliedSeq;
                        // Advance online turn model once per applied move AFTER explosions finalize.
                        try { _scheduleOnlineTurnAdvance(currentPlayer, seq + 1); } catch { /* ignore */ }
                        // Defer UI/turn indicator update until any processing ends.
                        scheduleOnlineTurnUiRefresh();
                        // If this move didn't trigger processing, flush immediately so "who's next" updates.
                        // (During chains, processExplosions() will flush when the chain ends.)
                        if (!isProcessing) flushOnlineTurnUiRefresh();
                        console.log(`[Move] Updated lastAppliedSeq to ${lastAppliedSeq}`);
                        // After applying, try to drain any subsequent buffered moves in order
                        tryApplyBufferedMoves();
                    } else {
                        console.warn(`[Move] Failed to apply seq ${seq}, buffering to retry after processing (myOnlineIndex=${myOnlineIndex})`);
                        // Buffer the move to retry after current processing completes
                        pendingMoves.set(seq, { r, c });
                    }
                };
                if (isProcessing) {
                    console.log(`[Move] Seq ${seq} is next but UI processing. Buffering. (myOnlineIndex=${myOnlineIndex})`);
                    // Buffer this exact-next move and it will be applied when processing finishes
                    pendingMoves.set(seq, { r, c });
                    // No timeout: deterministic ordered application
                } else {
                    doApply();
                }
            } else if (seq > expectedNext) {
                console.warn(`[Move] Future move seq ${seq}, expected ${expectedNext}. Buffering. (pending: ${Array.from(pendingMoves.keys()).sort((a, b) => a - b).join(', ')}) (myOnlineIndex=${myOnlineIndex})`);
                // Future move: store and wait for earlier moves
                pendingMoves.set(seq, { r, c });
            }
        } catch (err) {
            console.error('[Move] Error handling move:', err);
        }
    });

    // Catch-up packet: server noticed we're behind (via ping) and returns the missing move list.
    onlineConnection.on('missing_moves', (msg) => {
        try {
            if (!onlineGameActive) return;
            const moves = Array.isArray(msg.moves) ? msg.moves : [];
            if (moves.length === 0) return;

            console.warn(`[Catch-up] Received ${moves.length} missing move(s) from server (fromSeq=${msg.fromSeq}, serverSeq=${msg.serverSeq}). lastAppliedSeq=${lastAppliedSeq}`);
            // If we're already ahead (e.g., we rejoined and caught up), ignore this stale catch-up payload.
            // This can happen because pings were sent with an older seq and delayed/retried.
            const serverSeq = Number(msg.serverSeq);
            if (Number.isInteger(serverSeq) && (Number(lastAppliedSeq) || 0) >= serverSeq) {
                console.log(`[Catch-up] Ignoring stale missing_moves: already at lastAppliedSeq=${lastAppliedSeq} >= serverSeq=${serverSeq}`);
                return;
            }
            applyCatchUpMoves(moves, 'missing_moves');
        } catch (err) {
            console.error('[Catch-up] Error applying missing moves:', err);
        }
    });

    /**
     * Treat any catch-up move payload (missing_moves.recovered slice OR rejoined.recentMoves)
     * identically: buffer by seq (>= lastAppliedSeq) and then drain in-order.
     *
     * `lastAppliedSeq` is the next seq we still need to apply.
     * @param {Array<{seq:number,row:number,col:number}>} moves
     * @param {string} source
     */
    function applyCatchUpMoves(moves, source) {
        if (!onlineGameActive) return;
        const list = Array.isArray(moves) ? moves : [];
        if (list.length === 0) return;

        // Preserve the important invariant: we never advance lastAppliedSeq by skipping.
        // Buffering + tryApplyBufferedMoves() ensures ordered, contiguous application.
        for (const m of list) {
            if (!m || !Number.isInteger(m.seq)) continue;
            const seq = Number(m.seq);
            if (seq < (Number(lastAppliedSeq) || 0)) continue;
            const r = Number(m.row);
            const c = Number(m.col);
            if (!Number.isInteger(r) || !Number.isInteger(c)) continue;
            pendingMoves.set(seq, { r, c });
        }
        if (list.length) {
            console.log(`[Catch-up] Buffered ${list.length} move(s) from ${source}. lastAppliedSeq=${lastAppliedSeq}`);
        }
        tryApplyBufferedMoves();
    }
    onlineConnection.on('move_ack', (msg) => {
        try {
            console.log(`[Move Ack] Received move confirmation:`, msg, `onlineGameActive=${onlineGameActive}, lastAppliedSeq=${lastAppliedSeq}, myOnlineIndex=${myOnlineIndex}`);
            if (!onlineGameActive) {
                console.warn(`[Move Ack] Game not active, ignoring ack (myOnlineIndex=${myOnlineIndex})`);
                return;
            }
            const seq = Number(msg.seq);

            // move_ack no longer includes fromIndex; treat it as an ack for our currently pending echo.
            // If it doesn't match, we ignore it.
            if (pendingEchoSeq !== null && Number.isInteger(seq) && seq !== pendingEchoSeq) {
                console.warn(`[Move Ack] Received ack for unexpected seq: seq=${seq}, pendingEchoSeq=${pendingEchoSeq} (myOnlineIndex=${myOnlineIndex})`);
                return;
            }

            if (Number.isInteger(seq)) {
                console.log(`[Move Ack] Received echo for seq=${seq}, current lastAppliedSeq=${lastAppliedSeq}, pendingEchoSeq=${pendingEchoSeq}, myOnlineIndex=${myOnlineIndex}`);
                const expectedNextSeq = (Number(seq) || 0) + 1;
                if ((Number(lastAppliedSeq) || 0) <= expectedNextSeq && (pendingEchoSeq === null || pendingEchoSeq === seq)) {
                    // Our local apply already happened; ack confirms server committed it.
                    // Ensure our 'next seq to apply' is at least seq+1.
                    if ((Number(lastAppliedSeq) || 0) < expectedNextSeq) lastAppliedSeq = expectedNextSeq;
                    onlineTurnSeq = lastAppliedSeq;
                    if (isProcessing) scheduleOnlineTurnUiRefresh();
                    else _setOnlineTurnFromSeq();
                    console.log(`[Move Ack] Seq ${seq} confirmed (own move, myOnlineIndex=${myOnlineIndex}). lastAppliedSeq now=${lastAppliedSeq}`);
                    pendingEchoSeq = null; // Clear pending echo

                    // Keep window.lastAppliedSeq in sync (used by ping).
                    window.lastAppliedSeq = lastAppliedSeq;

                    // If game has ended, now we can safely mark it inactive since move is confirmed
                    if (gameWon) {
                        onlineConnection.setGameInactive();
                    }

                    // Echo confirms our local apply; try drain any buffered moves
                    tryApplyBufferedMoves();
                } else if (seq + 1 < lastAppliedSeq) {
                    console.warn(`[Move Ack] Old echo seq ${seq}, already at ${lastAppliedSeq}. Ignoring. (myOnlineIndex=${myOnlineIndex})`);
                } else {
                    // seq > lastAppliedSeq - should not happen in normal flow
                    console.warn(`[Move Ack] Future echo seq ${seq}, currently at ${lastAppliedSeq}. Server ahead? (myOnlineIndex=${myOnlineIndex})`);
                }
            }
        } catch (err) {
            console.error('[Move Ack] Error handling move ack:', err);
        }
    });
    onlineConnection.on('rejoined', (msg) => {
        myJoinedRoom = msg.room || myJoinedRoom;
        myRoomKey = msg.roomKey || myRoomKey;
        if (msg.roomKey) updateUrlRoomKey(msg.roomKey);
        if (Array.isArray(msg.players)) { myRoomPlayers = msg.players; myRoomCurrentPlayers = msg.players.length; }
        myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
        // Clear pending echo on rejoin - we'll get the full state from server
        pendingEchoSeq = null;

        // Handle rejoin catch-up moves the same way as ping-based missing_moves.
        // (Server semantics: recentMoves is a slice of moves with seq >= clientNextSeq.)
        try { applyCatchUpMoves(msg.recentMoves, 'rejoined'); } catch { /* ignore */ }

        // Ensure our local turn pointer matches our catch-up position.
        onlineTurnSeq = Number(lastAppliedSeq) || 0;
        if (isProcessing) scheduleOnlineTurnUiRefresh();
        else _setOnlineTurnFromSeq();
        updateStartButtonState();
    });
    onlineConnection.on('error', (msg) => {
        alert(msg.error);
        try {
            const err = String(msg.error || '');
            if (err.includes('Room not found') || err.includes('already started') || err.includes('full')) removeUrlRoomKey();
        } catch { /* ignore */ }
    });

    // Server-side authoritative validation failure.
    // This indicates a real mismatch between client and server state.
    onlineConnection.on('desync', (msg) => {
        try {
            const detail = (msg && typeof msg === 'object')
                ? `\nReason: ${msg.reason || 'unknown'}\nExpected seq: ${msg.expectedSeq}\nReceived seq: ${msg.receivedSeq}`
                : '';
            alert(`Desync detected. The server rejected a move as invalid.${detail}`);
        } catch {
            alert('Desync detected. The server rejected a move as invalid.');
        }
        // Stop trying to restore/continue this game session.
        try { onlineConnection.setGameInactive(); } catch { /* ignore */ }
        // Bring the player back to the online menu.
        try {
            gameWon = true;
            stopExplosionLoop();
            clearCellFocus();
            setMenuParam('online', false);
            showMenuFor('online');
            // Keep fullscreen when navigating back into menus.
        } catch { /* ignore */ }
    });

    let myJoinedRoom = null; // track the room this tab is in
    let myRoomKey = null; // track the room key for the joined room
    let myRoomMaxPlayers = null; // capacity of the room I'm in
    let myRoomCurrentPlayers = 0; // current players in my room
    let myRoomPlayers = []; // last known players (first is host)
    let myPlayerName = null; // this client's player name used to join/host

    // Expose to window for connection retry logic
    window.myJoinedRoom = myJoinedRoom;
    window.myRoomMaxPlayers = myRoomMaxPlayers;
    window.myRoomCurrentPlayers = myRoomCurrentPlayers;
    window.myRoomPlayers = myRoomPlayers;
    window.myPlayerName = myPlayerName;

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

        // If we have an active online game but the online menu is open, show a "Rejoin Game" button.
        // This resumes the existing in-memory grid state without recreating/resetting anything.
        try {
            const params = new URLSearchParams(window.location.search);
            const menu = params.get('menu');
            const inOnlineMenu = menu === 'online';
            if (inOnlineMenu && onlineGameActive && !gameWon) {
                btn.textContent = 'Rejoin Game';
                btn.disabled = false;
                btn.classList.add('rejoin-mode');
                btn.classList.remove('start-mode');
                btn.removeAttribute('aria-disabled');
                btn.title = 'Return to the active game';
                return;
            }
            btn.classList.remove('rejoin-mode');
        } catch { /* ignore */ }
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
        if (!clientFullyInitialized) return;
        const name = onlinePlayerNameInput.value.trim() || 'Player';
        function sendHost() {
            try {
                let debugPlayerName = sanitizeName((localStorage.getItem('playerName') || onlinePlayerNameInput.value || 'Player'));
                myPlayerName = debugPlayerName;
                const selectedPlayers = Math.max(2, Math.min(playerColors.length, Math.floor(menuPlayerCount || 2)));
                const desiredGrid = Number.isInteger(menuGridSizeVal) ? Math.max(3, Math.min(16, menuGridSizeVal)) : Math.max(3, selectedPlayers + 3);
                hostedDesiredGridSize = desiredGrid;
                onlineConnection.host({ roomName: name, maxPlayers: selectedPlayers, gridSize: desiredGrid, debugName: debugPlayerName });
            } catch { /* ignore */ }
        }
        const sendHostOnce = () => { sendHost(); onlineConnection.off('open', sendHostOnce); };
        onlineConnection.ensureConnected();
        if (onlineConnection.isConnected()) sendHost(); else onlineConnection.on('open', sendHostOnce);
    }

    // Expose to onlinePage via context (used there)
    window.joinRoom = function joinRoom(roomName) {
        if (!clientFullyInitialized) return;
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
        const doJoinOnce = () => { doJoin(); onlineConnection.off('open', doJoinOnce); };
        onlineConnection.ensureConnected();
        if (onlineConnection.isConnected()) doJoin(); else { showConnBanner('Connecting to server…', 'info'); onlineConnection.on('open', doJoinOnce); }
    }

    // Expose to onlinePage via context (used there)
    window.leaveRoom = function leaveRoom(roomName) {
        if (!clientFullyInitialized) return;
        // Explicit user-triggered leave should include roomKey for server-side validation.
        // We'll prefer the roomKey stored in the roomlist entry for our current room.
        const doLeave = () => {
            try {
                const rooms = window.lastRoomList || {};
                const key = rooms && roomName && rooms[roomName] && rooms[roomName].roomKey ? rooms[roomName].roomKey : null;
                if (key && typeof onlineConnection.leaveByKey === 'function') {
                    onlineConnection.leaveByKey({ roomName, roomKey: key });
                    return;
                }
            } catch { /* ignore */ }
            // Fallback to legacy leave if key is not available.
            onlineConnection.leave(roomName);
        };
        const doLeaveOnce = () => { doLeave(); onlineConnection.off('open', doLeaveOnce); };
        onlineConnection.ensureConnected();
        if (onlineConnection.isConnected()) doLeave(); else { showConnBanner('Connecting to server…', 'info'); onlineConnection.on('open', doLeaveOnce); }
        // Defer URL key removal until server confirms via roomlist update.
    }

    // Wire Host Custom / Start Game button behavior in the online menu
    if (hostCustomGameBtnRef) {
        hostCustomGameBtnRef.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            // If we're in Rejoin Game mode, just close menus and resume the existing game UI.
            if (btn.classList && btn.classList.contains('rejoin-mode') && !btn.disabled) {
                try {
                    // Hide menus but do NOT recreate/reset the grid.
                    const firstMenu = document.getElementById('firstMenu');
                    const mainMenu = document.getElementById('mainMenu');
                    const onlineMenu = document.getElementById('onlineMenu');
                    if (firstMenu) setHidden(firstMenu, true);
                    if (mainMenu) setHidden(mainMenu, true);
                    if (onlineMenu) setHidden(onlineMenu, true);

                    // Create a history entry for returning to the game.
                    // Other menu transitions call `setMenuParam(..., true)` which pushes a state;
                    // our previous implementation used `removeMenuParam()` which only replaces
                    // the current entry, so Back had nothing to return to.
                    try {
                        // Preserve existing query params (especially `key`) but remove only `menu`.
                        const params = new URLSearchParams(window.location.search);
                        params.delete('menu');
                        const newUrl = params.toString()
                            ? `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`
                            : `${window.location.pathname}${window.location.hash || ''}`;
                        window.history.pushState({ ...(window.history.state || {}), menu: null }, '', newUrl);
                    } catch {
                        window.history.pushState({ ...(window.history.state || {}), menu: null }, '', window.location.pathname + window.location.hash);
                    }
                    updateGrid();
                    try { updateEdgeCirclesActive(currentPlayer, onlineGameActive, myOnlineIndex, practiceMode, humanPlayer, gameColors); } catch { /* ignore */ }
                    // Prompt server catch-up immediately after rejoin.
                    try {
                        const sendRejoinPing = () => {
                            if (onlineConnection && typeof onlineConnection.sendPingNow === 'function') {
                                onlineConnection.sendPingNow();
                            }
                        };
                        const sendRejoinPingOnce = () => {
                            sendRejoinPing();
                            onlineConnection.off('open', sendRejoinPingOnce);
                        };
                        onlineConnection.ensureConnected();
                        if (onlineConnection.isConnected()) sendRejoinPing();
                        else onlineConnection.on('open', sendRejoinPingOnce);
                    } catch { /* ignore */ }
                } catch { /* ignore */ }
                return;
            }
            // If we're in Start Game mode and enabled, trigger online start (stub)
            if (btn.classList && btn.classList.contains('start-mode') && !btn.disabled) {
                if (!clientFullyInitialized) return;
                // Host starts the online game
                const startPayload = { type: 'start' };
                if (Number.isInteger(hostedDesiredGridSize)) startPayload.gridSize = hostedDesiredGridSize;
                const startGame = () => { onlineConnection.start(hostedDesiredGridSize); };
                const startGameOnce = () => { startGame(); onlineConnection.off('open', startGameOnce); };
                onlineConnection.ensureConnected();
                if (onlineConnection.isConnected()) { startGame(); }
                else { showConnBanner('Connecting to server…', 'info'); onlineConnection.on('open', startGameOnce); }
                return;
            }
            // Otherwise behave as Host Custom -> navigate to host menu
            navigateToMenu('host');
        });
    }

    // Track client initialization state
    let clientFullyInitialized = false;

    // Connection is menu-scoped:
    // - only connect while user is in the online/host menus
    // - disconnect when leaving them

    // Clean up: leave room when page is refreshing, closing, or navigating away
    window.addEventListener('beforeunload', () => {
        if (myJoinedRoom && onlineConnection.isConnected()) {
            // Use sendBeacon for reliable cleanup during unload
            try {
                onlineConnection.leave(myJoinedRoom);
            } catch { /* ignore */ }
        }
    });

    // Auto-join flow: if ?key= present and not already in a room, attempt join_by_key
    // Deferred until after page initialization
    let pendingAutoJoinKey = null;
    (function detectAutoJoinByKey() {
        try {
            const params = new URLSearchParams(window.location.search);
            const key = params.get('key');
            if (key && !myJoinedRoom) {
                pendingAutoJoinKey = key;
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
     * Centralized handler for online move attempts.
     * This ensures consistent sequence tracking regardless of input method (click/keyboard).
     * @param {number} row - Grid row
     * @param {number} col - Grid column
     * @param {string} source - Input source for logging ('click', 'keyboard', etc.)
     * @returns {void}
     */
    function handleOnlineMove(row, col, source = 'unknown') {
        if (!clientFullyInitialized) {
            return;
        }
        if (isProcessing) {
            return; // Prevent sending moves while processing
        }
        _setOnlineTurnFromSeq();
        if (currentPlayer !== myOnlineIndex) {
            return;
        }
        const valid = isValidLocalMove(row, col, myOnlineIndex);
        if (!valid) {
            return;
        }

        // Only act when connected; avoid local desync while offline
        if (!onlineConnection.isConnected()) {
            console.log(`[Online Move/${source}] blocked:offline`, { row, col, currentPlayer, myOnlineIndex, onlineTurnSeq, lastAppliedSeq });
            showConnBanner('You are offline. Reconnecting…', 'error');
            onlineConnection.ensureConnected();
            return;
        }

        console.log(`[Online Move/${source}] attempting`, {
            row,
            col,
            myOnlineIndex,
            currentPlayer,
            onlineTurnSeq,
            lastAppliedSeq,
            pendingEchoSeq,
            initialPlacements: Array.isArray(initialPlacements) ? initialPlacements.slice() : initialPlacements
        });

        // Apply move locally first (set seq context so handleClick logs include it)
        const prevSeqCtx = _applyingOnlineSeq;
        _applyingOnlineSeq = Number(onlineTurnSeq) || 0;
        const moveApplied = handleClick(row, col);
        _applyingOnlineSeq = prevSeqCtx;
        console.log(`[Online Move/${source}] handleClick returned ${moveApplied}, lastAppliedSeq before increment: ${lastAppliedSeq}`);

        if (moveApplied) {
            // Sequencing model is 0-based and server expects seq === lastAppliedSeq (the next move to play).
            const seqToSend = Number(onlineTurnSeq) || 0;
            pendingEchoSeq = seqToSend;
            console.log(`[Online Move/${source}] Applied; sending seq=${seqToSend}, waiting for echo (myOnlineIndex=${myOnlineIndex})`);
            // Advance online turn model once per applied move AFTER explosions finalize.
            try { _scheduleOnlineTurnAdvance(myOnlineIndex, seqToSend + 1); } catch { /* ignore */ }
            // Advance our local notion of turn immediately.
            // If the server rejects the move, catch-up/echo will correct us.
            onlineTurnSeq = seqToSend + 1;
            lastAppliedSeq = onlineTurnSeq;
            window.lastAppliedSeq = lastAppliedSeq;
            // UI/turn indicator update will happen once processing finishes.
            scheduleOnlineTurnUiRefresh();

            onlineConnection.sendMove({
                row,
                col,
                seq: seqToSend
            });
            console.log(`[Online Move/${source}] sendMove called`, { row, col, seq: seqToSend });
        } else {
            console.log(`[Online Move/${source}] handleClick rejected`, { row, col, myOnlineIndex, currentPlayer, onlineTurnSeq, lastAppliedSeq });
        }
    }

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
            // In online mode, use centralized handler
            if (onlineGameActive) {
                handleOnlineMove(row, col, 'click');
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
        // If a descendant is focused, blur it before hiding to avoid `aria-hidden` warnings.
        if (hidden) {
            const active = document.activeElement;
            if (active && el.contains(active)) active.blur?.();
        }
        el.classList.toggle('hidden', !!hidden);
        // Use `inert` so that hidden menus can't retain or receive focus.
        // Keep `aria-hidden` in sync for assistive technologies.
        el.toggleAttribute('inert', !!hidden);
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
        // If the user opens a menu mid-chain, ensure we leave performance mode.
        // Guarded because performanceMode is declared later in the file.
        try {
            if (typeof performanceMode !== 'undefined') performanceMode = false;
        } catch { /* ignore */ }

        try { pageRegistry.get('first')?.components?.qrCodeButton?.hideOverlay?.(); } catch { /* ignore */ }

        let targetId = menuKey;
        let subMode = null;
        if (['local', 'host', 'practice'].includes(menuKey)) {
            targetId = 'main';
            subMode = menuKey; // main page handles sub-mode selection
        }

        // When switching from Online -> Host, onlinePage.hide() will run.
        // We do NOT want that transition to send an implicit leave.
        const activeMenu = getMenuParam() || 'first';
        const isOnlineToHost = activeMenu === 'online' && menuKey === 'host';
        pageRegistry.open(targetId, {
            subMode,
            onlineConnection,
            updateStartButtonState,
            showConnBanner,
            hideConnBanner,
            setMainMenuMode,
            menuHistoryStack,
            // aiStrengthTile provided via mainPage components
            playerColors,
            startingColorIndex: getStartingColorIndex(),
            leaveRoom: isOnlineToHost ? null : (roomName) => window.leaveRoom(roomName),
            getMyJoinedRoom: isOnlineToHost ? null : (() => myJoinedRoom),
            removeUrlRoomKey: isOnlineToHost ? null : removeUrlRoomKey
        });
    }

    function navigateToMenu(menuKey) {
        // If navigating to online or host, ensure WS is (re)connecting.
        // If leaving online/host menus entirely, close the connection.
        const activeMenu = getMenuParam() || 'first';
        const leavingOnlineScope = (activeMenu === 'online' || activeMenu === 'host') && !(menuKey === 'online' || menuKey === 'host');
        if (leavingOnlineScope) {
            try { hideConnBanner(); } catch { /* ignore */ }

            // Send a normal leave message before closing the socket so the server
            // handles this like an explicit player leave (menu exit).
            try {
                if (myJoinedRoom && typeof window.leaveRoom === 'function') {
                    window.leaveRoom(myJoinedRoom);
                } else if (onlineConnection && typeof onlineConnection.leave === 'function') {
                    // If we don't know the room name, the server may infer current room from session.
                    onlineConnection.leave();
                }
            } catch { /* ignore */ }
            try { onlineConnection.disconnect({ suppressReconnect: true }); } catch { /* ignore */ }
        }
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
    // Initialize page modules (registration already done earlier before connection handlers)
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
            getRoomKeyForRoom: (roomName) => (roomName === myJoinedRoom) ? myRoomKey : null,
            getPlayerName: () => myPlayerName,
            menuHistoryStack
        });
    } catch { /* ignore */ }

    // Mark client as fully initialized
    clientFullyInitialized = true;

    // Process pending auto-join if any
    if (pendingAutoJoinKey) {
        const key = pendingAutoJoinKey;
        pendingAutoJoinKey = null;
        const sendJoinKey = () => {
            onlineConnection.joinByKey(key, (localStorage.getItem('playerName') || 'Player'));
            // Remove this handler after it's called once to prevent re-joining on reconnect
            onlineConnection.off('open', sendJoinKey);
        };
        if (onlineConnection.isConnected()) sendJoinKey(); else onlineConnection.on('open', sendJoinKey);
        // Navigate to online menu for visibility
        navigateToMenu('online');
    }
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
        let minAngle = Math.PI * (70 / 180); // 70°
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
            requestFullscreenIfMobile();
        } else if (mode === 'host') {
            // Host the room when clicking the start button in host mode
            hostRoom();
        }
        // Host menu: return to the online menu without dropping the room key from the URL.
        if (mode === 'host' && mainMenu && mainMenu.dataset.mode === 'host') {
            try { onlineConnection.ensureConnected(); } catch { /* ignore */ }
            try { setMenuParam('online', false); } catch { /* ignore */ }
            try { showMenuFor('online'); } catch { /* ignore */ }
        }
        else if (mode === 'practice') {
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
            requestFullscreenIfMobile();
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
            // Enter fullscreen on mobile after hiding menu and setting up game
            requestFullscreenIfMobile();
        });
    }
    //#endregion

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
            setHidden,
            pageRegistry,
            playerColors,
            playerBoxSlider,
            menuColorCycle,
            startBtn,
            setPracticeMode: (val) => { practiceMode = val; },
            setAiDepth: (val) => { aiDepth = val; },
            setGameColors: (val) => { gameColors = val; },
            getMyJoinedRoom: () => myJoinedRoom,
            getRoomKeyForRoom: (roomName) => (roomName === myJoinedRoom) ? myRoomKey : null,
            getGameColors: () => gameColors
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
    // Unified sequencing for local/practice games (0-based per game).
    // In online games, lastAppliedSeq plays the role of "next seq to apply".
    let localMoveSeq = 0;
    // Start with the first selected color (index 0) instead of a random player
    let currentPlayer = computeStartPlayerIndexProxy();
    // Local/practice turn state: persistent index of the player whose turn it is.
    // During initial placement, we keep strict seq-driven order.
    // After initial placement, we advance via turnCalc.advanceTurnIndex() to skip eliminated players.
    let localTurnIndex = 0;
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

        // Only disable session restoration if there's no pending move confirmation
        // This ensures the winning move gets confirmed by the server before stopping
        if (pendingEchoSeq === null) {
            onlineConnection.setGameInactive();
        }

        if (menuShownAfterWin) return; // schedule only once
        menuShownAfterWin = true;
        setTimeout(() => {
            if (!gameWon) return;
            stopExplosionLoop();
            clearCellFocus();
            const targetMenu = onlineGameActive ? 'online' : (practiceMode ? 'practice' : 'local');
            // If the previous menu entry matches the target menu, reuse it by stepping back
            // instead of creating a duplicate history entry.
            try {
                const lastMenu = menuHistoryStack.length ? menuHistoryStack[menuHistoryStack.length - 1] : null;
                const inGameState = !getMenuParam();
                if (inGameState && lastMenu === targetMenu) {
                    window.history.back();
                    return;
                }
            } catch { /* ignore */ }
            setMenuParam(targetMenu, false);
            showMenuFor(targetMenu);
            // Keep fullscreen when navigating back into menus.
        }, delayGameEnd);
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
            humanPlayer,
            gameColors
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

    function getFocusPlayerIndex() {
        if (onlineGameActive && Number.isInteger(myOnlineIndex) && myOnlineIndex >= 0) return myOnlineIndex;
        if (practiceMode && typeof humanPlayer !== 'undefined') return humanPlayer;
        return currentPlayer;
    }

    function saveFocusForPlayer(playerIndex) {
        if (onlineGameActive || (typeof practiceMode !== 'undefined' && practiceMode)) return;
        if (!Number.isInteger(playerIndex) || playerIndex < 0) return;
        const focused = document.activeElement;
        if (!focused || !focused.classList.contains('cell')) return;
        const row = parseInt(focused.dataset.row, 10);
        const col = parseInt(focused.dataset.col, 10);
        if (!Number.isInteger(row) || !Number.isInteger(col)) return;
        playerLastFocus[playerIndex] = { row, col };
    }

    function isLocalFocusTurn() {
        if (onlineGameActive && Number.isInteger(myOnlineIndex) && myOnlineIndex >= 0) return currentPlayer === myOnlineIndex;
        if (practiceMode && typeof humanPlayer !== 'undefined') return currentPlayer === humanPlayer;
        return true;
    }

    function isInitialPlacementPhaseForFocus() {
        if (onlineGameActive) {
            const n = Array.isArray(onlinePlayers) ? onlinePlayers.length : playerCount;
            const seq = Number(onlineTurnSeq);
            return Number.isFinite(seq) && seq < n;
        }
        if (Array.isArray(initialPlacements)) return initialPlacements.includes(false);
        return false;
    }

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
        const focusPlayerIndex = getFocusPlayerIndex();
        const allowAllCells = isInitialPlacementPhaseForFocus() && isLocalFocusTurn();
        // Helper: is cell owned by focus player?
        const isOwnCell = (cell) => {
            if (!cell) return false;
            // Initial placement: allow all cells only when it's the local player's turn
            if (allowAllCells) return true;
            if (!Number.isInteger(focusPlayerIndex) || focusPlayerIndex < 0) return false;
            // Otherwise, check cell class for focus player color
            const colorKey = activeColors()[focusPlayerIndex];
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
        // Always pick the own cell with the smallest angle (<minAngle°), tiebreaker by distance
        let minAngle = Math.PI * (70 / 180); // 70°
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
            e.preventDefault();
            handleOnlineMove(row, col, 'keyboard');
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
        localMoveSeq = 0;
        localTurnIndex = 0;
        gameWon = false;
        menuShownAfterWin = false;
        stopExplosionLoop();
        isProcessing = false;
        performanceMode = false;
        // Turn selection:
        // - Local / practice: strictly seq-driven (seq % players)
        // - Online: currentPlayer will be driven by received moves/handlers.
        if (!onlineGameActive) {
            // Initial placement starts at player 0.
            currentPlayer = playerCount > 0 ? 0 : 0;
        } else {
            currentPlayer = computeStartPlayerIndex(gameColors);
        }

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
        const menuOpen = (typeof isAnyMenuOpen === 'function') ? isAnyMenuOpen() : false;
        if (!menuOpen) {
            document.body.className = activeColors()[currentPlayer];
        }
        // Sync active circle emphasis after grid rebuild
        try { updateEdgeCirclesActive(currentPlayer, onlineGameActive, myOnlineIndex, practiceMode, humanPlayer, gameColors); } catch { /* ignore */ }

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
            if (!menuOpen) {
                document.body.className = activeColors()[currentPlayer];
            }
            updateGrid();
            // Trigger AI if the first randomly chosen currentPlayer isn't the human
            maybeTriggerAIMove();
        }
    }

    /**
     * Advance local/practice turn using the unified seq model.
     * (Online turns are controlled by server sequencing and are not advanced here.)
     */
    function advanceSeqTurn() {
        if (onlineGameActive) return;
        const prevPlayer = currentPlayer;
        const prevSeq = Number(localMoveSeq) || 0;
        const nextSeq = prevSeq + 1;
        localMoveSeq = nextSeq;

        if (playerCount <= 0) {
            currentPlayer = 0;
        } else if (nextSeq < playerCount) {
            // Initial placement: strict order.
            localTurnIndex = nextSeq % playerCount;
            currentPlayer = localTurnIndex;
        } else {
            // After initial placement: persistent turnIndex with elimination skipping.
            // `currentPlayer` just played; advance to the next alive player.
            const nextIndex = advanceTurnIndex(grid, activeColors(), currentPlayer, nextSeq);
            localTurnIndex = (nextIndex === null) ? currentPlayer : nextIndex;
            currentPlayer = localTurnIndex;
        }
        if (!isProcessing && prevPlayer !== currentPlayer) {
            saveFocusForPlayer(prevPlayer);
        }
        document.body.className = activeColors()[currentPlayer];
        try { updateEdgeCirclesActive(currentPlayer, onlineGameActive, myOnlineIndex, practiceMode, humanPlayer, gameColors); } catch { /* ignore */ }
        if (!onlineGameActive && !(typeof practiceMode !== 'undefined' && practiceMode)) clearCellFocus();
        updateGrid();
        restorePlayerFocus();
        maybeTriggerAIMove();
    }

    /**
     * Handle a user/AI click to place or increment a cell and schedule explosions.
     * @param {number} row - cell row.
     * @param {number} col - cell column.
     * @returns {void}
     */
    function handleClick(row, col) {
        // Debug helper (only logs for online games to reduce noise)
        const _logReject = (reason, extra = {}) => {
            try {
                if (!onlineGameActive) return;
                let cellState = null;
                try {
                    const g = (grid && grid[row] && grid[row][col]) ? grid[row][col] : null;
                    if (g) cellState = { value: g.value, player: g.player };
                } catch { /* ignore */ }
                console.warn('[handleClick reject]', {
                    reason,
                    seq: (typeof _applyingOnlineSeq === 'number' || typeof _applyingOnlineSeq === 'string') ? _applyingOnlineSeq : null,
                    row,
                    col,
                    currentPlayer,
                    currentPlayerColor: (activeColors && typeof activeColors === 'function') ? activeColors()[currentPlayer] : undefined,
                    onlineGameActive,
                    myOnlineIndex,
                    isProcessing,
                    gameWon,
                    initialPlacements: Array.isArray(initialPlacements) ? initialPlacements.slice() : initialPlacements,
                    cellState,
                    ...extra
                });
                // This reject can happen for authoritative online moves that arrive while
                // animations/explosions are processing, so don't treat it as fatal.
                if (reason !== 'isProcessing_or_gameWon') {
                    alert('Fatal Error: Desync. This should not happen');
                }
            } catch { /* ignore */ }
        };

        if (isProcessing || gameWon) {
            _logReject('isProcessing_or_gameWon');
            return false;
        }

        const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        const cellColor = getPlayerColor(row, col);

        // Phase selection:
        // - Local/practice: use per-player initialPlacements[] flags.
        // - Online: phase is driven solely by the unified seq model.
        const _onlineSeq = (typeof _applyingOnlineSeq === 'number' || typeof _applyingOnlineSeq === 'string')
            ? Number(_applyingOnlineSeq)
            : null;
        const _onlinePlayersCount = Array.isArray(onlinePlayers) ? onlinePlayers.length : playerCount;
        const _isInitialPlacementPhaseNow = onlineGameActive
            ? (_onlineSeq !== null && Number.isFinite(_onlineSeq) && _onlineSeq < _onlinePlayersCount)
            : !initialPlacements[currentPlayer];

        if (_isInitialPlacementPhaseNow) {
            if (isInitialPlacementInvalid(row, col)) {
                _logReject('initialPlacementInvalid');
                return false;
            }

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
                    // Keep local/practice semantics (and any UI that relies on these flags)
                    // but don't let them drive online phase decisions.
                    initialPlacements[currentPlayer] = true;
                    // Re-highlight after the placement flag flips, so adjacency rules reflect the latest board state.
                    try { highlightInvalidInitialPositions(); } catch { /* ignore */ }
                }, delayExplosion);
                return true;
            }

            _logReject('initialPlacement_cellNotEmpty', { existingValue: grid[row][col].value, existingPlayer: grid[row][col].player });

        } else {
            if (grid[row][col].value > 0 && cellColor === activeColors()[currentPlayer]) {
                grid[row][col].value++;
                updateCell(row, col, 0, grid[row][col].player, true);

                if (grid[row][col].value >= cellExplodeThreshold) {
                    isProcessing = true;
                    setTimeout(processExplosions, delayExplosion);
                } else {
                    advanceSeqTurn();
                }
                return true;
            }

            _logReject('nonInitialPlacement_invalidCellOrOwnership', {
                cellValue: grid[row][col].value,
                cellColor,
                expectedColor: activeColors()[currentPlayer]
            });
        }
        return false;
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
        const cellsToExplode = calcGetCellsToExplode(grid, gridSize, cellExplodeThreshold);

        // If no cells need to explode, end processing
        if (cellsToExplode.length === 0) {
            isProcessing = false;
            // Online: now that eliminations are final, advance the turn model for the move we just applied.
            if (onlineGameActive) {
                _flushOnlineTurnAdvance();
            }
            if (initialPlacements.every(placement => placement)) {
                checkWinCondition();
            }
            if (!gameWon) advanceSeqTurn();
            // In online mode, update turn UI only after processing (and any eliminations) are finalized.
            if (onlineGameActive) {
                flushOnlineTurnUiRefresh();
            }
            // Process any buffered online moves that were waiting for UI to finish
            if (onlineGameActive && typeof tryApplyBufferedMoves === 'function') {
                tryApplyBufferedMoves();
            }
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

            // Determine if this explosion is from an initial placement
            const isInitialPlacement = !initialPlacements.every(placement => placement);
            const { targets: targetCells, extraBackToOrigin } = calcComputeExplosionTargets(
                gridSize,
                row,
                col,
                explosionValue,
                isInitialPlacement
            );

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
                // Visual turn highlight: the ACTIVE cells are those owned by the *current player's color*.
                // NOTE: grid[i][j].player stores the owning color key (e.g. 'red'),
                // while activeColors()[currentPlayer] is the color key of the player whose turn it is.
                // The previous comparison mistakenly compared owner -> currentColor in the wrong direction,
                // causing only the first player's cells to be treated as active.
                if (grid[i][j].player && grid[i][j].player === activeColors()[currentPlayer]) {
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

        // Ensure transitions reliably restart even when reusing existing circles.
        // We explicitly reset existing circles to the "start" state (centered, opacity 0)
        // before applying the final positions in the next animation frame.
        for (const c of existingCircles) {
            c.style.setProperty('--tx', 0);
            c.style.setProperty('--ty', 0);
            c.style.opacity = '0';
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

        // Force the browser to commit the "start" state before we apply final positions/opacity.
        // This prevents style batching from skipping transitions when updates happen repeatedly.
        if (newElements.length) {
            void innerCircle.offsetWidth;
        }

        // One RAF to trigger all transitions together.
        requestAnimationFrame(() => {
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
     * Restore focus to the last cell focused by the current player, if any.
     */
    function restorePlayerFocus() {
        if (onlineGameActive || (typeof practiceMode !== 'undefined' && practiceMode)) return;
        const focusPlayerIndex = getFocusPlayerIndex();
        if (!Number.isInteger(focusPlayerIndex) || focusPlayerIndex < 0) return;
        const pos = playerLastFocus[focusPlayerIndex];
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

        // Online flow: initial placement phase is seq-driven, not per-player flag-driven.
        // Otherwise we can incorrectly block valid placements when our local flags drift.
        const isOnline = !!onlineGameActive;
        const stableOnlineCount = isOnline && Array.isArray(onlinePlayers) && onlinePlayers.length
            ? onlinePlayers.length
            : (Number(playerCount) || 0);

        const isOnlineInitialPhase = isOnline
            ? (Number.isFinite(Number(onlineTurnSeq)) && stableOnlineCount > 0 ? Number(onlineTurnSeq) < stableOnlineCount : true)
            : false;

        const cellValue = grid[row][col].value;
        const cellOwner = getPlayerColor(row, col);
        const invalidByPlacementRules = isInitialPlacementInvalid(row, col);
        const isOwnCell = cellValue > 0 && cellOwner === activeColors()[playerIndex];

        if (isOnline) {
            if (isOnlineInitialPhase) {
                return cellValue === 0 && !invalidByPlacementRules;
            }
            return isOwnCell;
        }

        // Local / practice flow: initial placement is per-player flag-driven.
        if (!initialPlacements[playerIndex]) {
            return cellValue === 0 && !invalidByPlacementRules;
        }
        return isOwnCell;
    }

    /**
     * Validate if an initial placement at (row,col) violates center/adjacency rules.
     * @param {number} row - cell row.
     * @param {number} col - cell column.
     * @returns {boolean} true if placement is invalid.
     */
    function isInitialPlacementInvalid(row, col) {
        return calcIsInitialPlacementInvalid(grid, gridSize, invalidInitialPositions, row, col);
    }

    /**
     * Compute static invalid center positions based on odd/even grid size.
     * @param {number} size - grid dimension.
     * @returns {Array<{r:number,c:number}>} disallowed initial placement cells.
     */
    function computeInvalidInitialPositions(size) {
        return calcInvalidInitialPositions(size);
    }

    /**
     * Highlight cells that are invalid for initial placement in the current phase.
     * @returns {void} toggles .invalid on affected cells.
     */
    function highlightInvalidInitialPositions() {
        clearInvalidHighlights();

        // Only show any invalid placement highlights during the initial placement phase.
        // - Online: phase is seq-driven.
        // - Local/practice: phase is driven by initialPlacements flags.
        const stableOnlineCount = (onlineGameActive && Array.isArray(onlinePlayers) && onlinePlayers.length)
            ? onlinePlayers.length
            : (Number(playerCount) || 0);
        const inInitialPlacementPhase = onlineGameActive
            ? ((Number(onlineTurnSeq) || 0) < stableOnlineCount)
            : (Array.isArray(initialPlacements) && initialPlacements.some(p => !p));

        if (!inInitialPlacementPhase) return;

        // Static center invalids (initial placement only)
        invalidInitialPositions.forEach(pos => {
            const cell = document.querySelector(`.cell[data-row="${pos.r}"][data-col="${pos.c}"]`);
            cell.classList.add('invalid');
        });

        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if (isInitialPlacementInvalid(i, j)) {
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
        if (isAnyMenuOpen && isAnyMenuOpen()) return;
        setTimeout(() => {
            if (isProcessing || gameWon || currentPlayer === humanPlayer) return;
            if (isAnyMenuOpen && isAnyMenuOpen()) return;
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
        if (result.requireAdvanceTurn) { if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true; advanceSeqTurn(); return; }
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
        if (move) handleClick(move.r, move.c); else { if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true; advanceSeqTurn(); }
    }

    //#endregion
});

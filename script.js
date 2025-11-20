import { PlayerBoxSlider } from './src/components/playerBoxSlider.js';
import { ColorCycler } from './src/components/colorCycler.js';
import { GridSizeTile } from './src/components/gridSizeTile.js';
import { MenuCloseButton } from './src/components/menuCloseButton.js';
import { PlayerNameFields } from './src/components/playerNameFields.js';
import { sanitizeName } from './src/utils/nameUtils.js';
import { AIStrengthTile } from './src/components/aiStrengthTile.js';
import { computeAIMove } from './src/ai/engine.js';
import { PLAYER_NAME_LENGTH, MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD, DELAY_EXPLOSION_MS, DELAY_ANIMATION_MS, DELAY_GAME_END_MS, PERFORMANCE_MODE_CUTOFF, DOUBLE_TAP_THRESHOLD_MS, WS_INITIAL_BACKOFF_MS, WS_MAX_BACKOFF_MS } from './src/config/index.js'; // some imported constants applied later

// PLAYER_NAME_LENGTH now imported from nameUtils.js
document.addEventListener('DOMContentLoaded', () => {
    // Shared name sanitization and validity functions (top-level)
    // On load, if grid is visible and no menu is open, show edge circles
    setTimeout(() => {
        const gridEl = document.querySelector('.grid');
        const menus = [document.getElementById('firstMenu'), document.getElementById('mainMenu'), document.getElementById('onlineMenu')];
        const anyMenuVisible = menus.some(m => m && !m.classList.contains('hidden'));
        if (gridEl && gridEl.offsetParent !== null && !anyMenuVisible) {
            try { createEdgeCircles(); } catch { /* ignore */ }
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

    // Multiplayer room logic
    let ws;
    let wsConnected = false; // reflects stable connection state
    let wsBackoffMs = WS_INITIAL_BACKOFF_MS;   // exponential backoff starting delay
    let wsReconnectTimer = null;
    /* eslint-disable-next-line no-unused-vars */
    let wsEverOpened = false; // used to know if we should try to rejoin
    let hostedRoom = null;
    // Desired grid size chosen in Host menu; null means use server default (playerCount+3)
    let hostedDesiredGridSize = null;
    const roomListElement = document.getElementById('roomList');
    // Online bottom action button in online menu
    const hostCustomGameBtnRef = document.getElementById('hostCustomGameBtn');
    // Track last applied server move sequence to avoid duplicates
    let lastAppliedSeq = 0;

    function getConfiguredWebSocketUrl() {
        try {
            const params = new URLSearchParams(window.location.search);
            const override = params.get('ws') || params.get('ws_base');
            if (override) return override;
            const meta = document.querySelector('meta[name="ws-base"]');
            if (meta && meta.content) return meta.content;
            if (typeof window.__WS_BASE_URL === 'string' && window.__WS_BASE_URL) {
                return window.__WS_BASE_URL;
            }
            // If running from GitHub Pages (different origin), default to Cloud Run URL
            if ((window.location.host || '').endsWith('github.io')) {
                return 'wss://color-clash-192172087961.europe-west4.run.app/ws';
            }
            // Same-origin default
            const isSecure = window.location.protocol === 'https:';
            const proto = isSecure ? 'wss' : 'ws';
            const host = window.location.host || 'localhost:8080';
            return `${proto}://${host}/ws`;
        } catch {
            return 'ws://localhost:8080/ws';
        }
    }

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

    /* eslint-disable-next-line no-unused-vars */
    function scheduleReconnect() {
        if (wsReconnectTimer) return;
    const delay = Math.min(wsBackoffMs, WS_MAX_BACKOFF_MS);
        //console.debug(`[WebSocket] Scheduling reconnect in ${delay}ms`);
        showConnBanner('Reconnecting…', 'info');
        wsReconnectTimer = setTimeout(() => {
            wsReconnectTimer = null;
            try { connectWebSocket(); } catch { /* ignore */ }
            // increase backoff for next attempt
            wsBackoffMs = Math.min(wsBackoffMs * 2, WS_MAX_BACKOFF_MS);
        }, delay);
    }

    function connectWebSocket() {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
        const wsUrl = getConfiguredWebSocketUrl();
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
            //console.debug('[WebSocket] Connected, requesting room list');
            wsConnected = true;
            wsEverOpened = true;
            wsBackoffMs = WS_INITIAL_BACKOFF_MS;
            hideConnBanner();
            if (wsReconnectTimer) { try { clearTimeout(wsReconnectTimer); } catch { /* noop */ } wsReconnectTimer = null; }
            ws.send(JSON.stringify({ type: 'list' }));
            // Attempt a seamless rejoin if we were in a room before
            try {
                if (myJoinedRoom && myPlayerName) {
                    ws.send(JSON.stringify({ type: 'reconnect', roomName: myJoinedRoom, debugName: myPlayerName }));
                }
            } catch { /* ignore */ }
        };
        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (msg.type === 'hosted') {
                hostedRoom = msg.room;
                myJoinedRoom = msg.room;
                myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
                myRoomCurrentPlayers = 1; // host is the first participant
                if (typeof msg.player === 'string' && msg.player) {
                    myPlayerName = msg.player;
                }
                console.debug(`[Host] Room hosted: ${hostedRoom}`);
                // On successful hosting, return to Online game menu
                const onlineMenu = document.getElementById('onlineMenu');
                const mainMenu = document.getElementById('mainMenu');
                let deferredRoomKey = null;
                if (onlineMenu && mainMenu) {
                    // hide mainMenu (Host Game menu)
                    mainMenu.classList.add('hidden');
                    mainMenu.setAttribute('aria-hidden', 'true');
                    // show onlineMenu
                    onlineMenu.classList.remove('hidden');
                    onlineMenu.setAttribute('aria-hidden', 'false');
                    // clear marker
                    try { mainMenu.dataset.openedBy = ''; } catch { /* ignore */ }
                }
                // If the host menu was open, and the menu stack indicates a back navigation will occur, defer updating the key until after popstate
                if (msg.roomKey) {
                    // If the previous menu was 'host', and we are now in 'online', defer updateUrlRoomKey
                    const params = new URLSearchParams(window.location.search);
                    const currentMenu = params.get('menu');
                    if (currentMenu === 'host') {
                        // Defer until next popstate
                        deferredRoomKey = msg.roomKey;
                        const popHandler = () => {
                            updateUrlRoomKey(deferredRoomKey);
                            window.removeEventListener('popstate', popHandler, true);
                        };
                        window.addEventListener('popstate', popHandler, true);
                    } else {
                        updateUrlRoomKey(msg.roomKey);
                    }
                }
                updateStartButtonState();
            } else if (msg.type === 'roomlist') {
                // If roomlist includes player names, log them
                Object.entries(msg.rooms || {}).forEach(([roomName, info]) => {
                    if (info && Array.isArray(info.players)) {
                        const names = info.players.map(p => p.name).join(', ');
                        console.debug(`[RoomList] Room: ${roomName} | Players: ${names} (${info.currentPlayers}/${info.maxPlayers})`);
                    } else {
                        console.debug(`[RoomList] Room: ${roomName} | Players: ? (${info.currentPlayers}/${info.maxPlayers})`);
                    }
                });
                updateRoomList(msg.rooms);
                updateStartButtonState(msg.rooms);
            } else if (msg.type === 'started') {
                // Online game start: use provided gridSize if available, else fallback to schedule min by player count
                try {
                    // Reset dedup sequence on new game
                    lastAppliedSeq = 0;
                    console.debug('[Online] Game started:', {
                        players: Array.isArray(msg.players) ? msg.players : [],
                        gridSize: Number.isInteger(msg.gridSize) ? Math.max(3, Math.min(16, parseInt(msg.gridSize, 10))) : recommendedGridSize((Array.isArray(msg.players) ? msg.players.length : 2)),
                        colors: Array.isArray(msg.colors) ? msg.colors : undefined
                    });
                    onlineGameActive = true;
                    onlinePlayers = Array.isArray(msg.players) ? msg.players.slice() : [];
                    myOnlineIndex = onlinePlayers.indexOf(myPlayerName || '');
                    const p = Math.max(2, Math.min(playerColors.length, onlinePlayers.length || 2));
                    const s = Number.isInteger(msg.gridSize) ? Math.max(3, Math.min(16, parseInt(msg.gridSize, 10))) : recommendedGridSize(p);
                    // Use server-assigned colors if provided; fallback to default slice
                    if (msg.colors && Array.isArray(msg.colors) && msg.colors.length >= p) {
                        gameColors = msg.colors.slice(0, p);
                    } else {
                        gameColors = playerColors.slice(0, p);
                    }
                    playerCount = p;
                    gridSize = s;
                    document.documentElement.style.setProperty('--grid-size', gridSize);
                    // Hide any open menu overlays
                    const firstMenu = document.getElementById('firstMenu');
                    const mainMenu = document.getElementById('mainMenu');
                    const onlineMenu = document.getElementById('onlineMenu');
                    if (firstMenu) setHidden(firstMenu, true);
                    if (mainMenu) setHidden(mainMenu, true);
                    if (onlineMenu) setHidden(onlineMenu, true);
                    // Ensure non-train mode and start the grid
                    trainMode = false;
                    recreateGrid(s, p);
                    // Host (index 0) starts
                    currentPlayer = 0;
                    document.body.className = activeColors()[currentPlayer];
                    updateGrid();
                    try { createEdgeCircles(); } catch { /* ignore */ }
                } catch (err) {
                    console.error('[Online] Failed to start online game', err);
                }
            } else if (msg.type === 'request_preferred_colors') {
                // Server requests our current preferred color (from the cycler)
                try {
                    const color = playerColors[startingColorIndex] || 'green';
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ type: 'preferred_color', color }));
                    }
                } catch (e) {
                    console.warn('[Online] Failed to send preferred color', e);
                }
            } else if (msg.type === 'joined') {
                // If joined includes player names, log them
                if (msg.players && Array.isArray(msg.players)) {
                    const names = msg.players.map(p => p.name).join(', ');
                    console.debug(`[Join] Joined room: ${msg.room} | Players: ${names}`);
                } else {
                    console.debug(`[Join] Joined room: ${msg.room}`);
                }
                myJoinedRoom = msg.room;
                if (msg.roomKey) updateUrlRoomKey(msg.roomKey);
                if (typeof msg.player === 'string' && msg.player) {
                    myPlayerName = msg.player;
                }
                // Track my room occupancy and capacity
                myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
                if (Array.isArray(msg.players)) {
                    myRoomCurrentPlayers = msg.players.length;
                    myRoomPlayers = msg.players;
                }
                // If server provided the planned grid size for this room, immediately reflect it in the background grid.
                try {
                    if (Number.isInteger(msg.gridSize)) {
                        const s = Math.max(3, Math.min(16, parseInt(msg.gridSize, 10)));
                        menuGridSizeVal = s;
                        try { gridSizeTile && gridSizeTile.setSize(s, 'network', { silent: true, bump: false }); } catch { /* ignore */ }
                        if (s !== gridSize) recreateGrid(s, playerCount);
                    }
                } catch { /* ignore */ }
                updateStartButtonState();
            } else if (msg.type === 'left') {
                console.debug('[Leave] Left room:', msg.room);
                if (!msg.room || msg.room === myJoinedRoom) myJoinedRoom = null;
                myRoomMaxPlayers = null; myRoomCurrentPlayers = 0; myRoomPlayers = [];
                removeUrlRoomKey();
                updateStartButtonState();
            } else if (msg.type === 'roomupdate') {
                if (msg.players && Array.isArray(msg.players)) {
                    const names = msg.players.map(p => p.name).join(', ');
                    console.debug(`[RoomUpdate] Room: ${msg.room} | Players: ${names}`);
                } else {
                    console.debug(`[RoomUpdate] Room: ${msg.room}`);
                }
                if (msg.room && msg.room === myJoinedRoom && Array.isArray(msg.players)) {
                    myRoomCurrentPlayers = msg.players.length;
                    myRoomPlayers = msg.players;
                    updateStartButtonState();
                }
            } else if (msg.type === 'move') {
                // Apply a remote move (ignore our own echo; queue if processing)
                try {
                    if (!onlineGameActive) return;
                    if (msg.room && msg.room !== myJoinedRoom) return;
                    const seq = Number(msg.seq);
                    if (Number.isInteger(seq)) {
                        if (seq <= lastAppliedSeq) {
                            return; // duplicate or old move; ignore
                        }
                    }
                    const r = Number(msg.row), c = Number(msg.col);
                    const fromIdx = Number(msg.fromIndex);
                    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
                    // If it's our own echoed move, just advance seq and ignore
                    if (fromIdx === myOnlineIndex) {
                        if (Number.isInteger(seq)) lastAppliedSeq = Math.max(lastAppliedSeq, seq);
                        return;
                    }
                    if (Number.isInteger(seq)) lastAppliedSeq = Math.max(lastAppliedSeq, seq);
                    console.debug('[Online] Move received:', {
                        fromPlayer: fromIdx,
                        color: activeColors()[fromIdx],
                        row: r,
                        col: c,
                        room: msg.room
                    });
                    const applyNow = () => {
                        // Suppress re-broadcast while replaying the remote move locally
                        currentPlayer = Math.max(0, Math.min(playerCount - 1, fromIdx));
                        handleClick(r, c);
                    };
                    if (isProcessing) {
                        // If we're mid-explosions, retry until clear (bounded)
                        const startTs = Date.now();
                        const tryApply = () => {
                            if (!onlineGameActive) return; // room closed
                            if (!isProcessing) { applyNow(); return; }
                            if (Date.now() - startTs > 4000) { console.warn('[Online] Dropping deferred move after timeout'); return; }
                            setTimeout(tryApply, 100);
                        };
                        tryApply();
                    } else {
                        applyNow();
                    }
                } catch (err) {
                    console.error('[Online] Error applying remote move', err);
                    // ...existing code...
                }
            } else if (msg.type === 'rejoined') {
                console.debug('[Online] Rejoined room:', msg.room);
                myJoinedRoom = msg.room || myJoinedRoom;
                if (msg.roomKey) updateUrlRoomKey(msg.roomKey);
                if (Array.isArray(msg.players)) {
                    myRoomPlayers = msg.players;
                    myRoomCurrentPlayers = msg.players.length;
                }
                myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
                // If server provides recent missed moves, apply them in order
                try {
                    const missed = Array.isArray(msg.recentMoves) ? msg.recentMoves.slice() : [];
                    if (missed.length) {
                        // Ensure chronological order by sequence if present
                        missed.sort((a, b) => (Number(a.seq) || 0) - (Number(b.seq) || 0));
                        let idx = 0;
                        const applyNext = () => {
                            if (idx >= missed.length) { updateStartButtonState(); return; }
                            const m = missed[idx];
                            const r = Number(m.row), c = Number(m.col), fromIdx = Number(m.fromIndex);
                            const seq = Number(m.seq);
                            if (Number.isInteger(seq) && seq <= lastAppliedSeq) { idx++; applyNext(); return; }
                            if (!Number.isInteger(r) || !Number.isInteger(c) || !Number.isInteger(fromIdx)) { idx++; applyNext(); return; }
                            const doApply = () => {
                                if (!onlineGameActive) { // if somehow not active, skip safe
                                    idx++; applyNext(); return;
                                }
                                currentPlayer = Math.max(0, Math.min(playerCount - 1, fromIdx));
                                handleClick(r, c);
                                if (Number.isInteger(seq)) lastAppliedSeq = Math.max(lastAppliedSeq, seq);
                                idx++;
                                // allow UI/explosions to process next tick
                                setTimeout(applyNext, 0);
                            };
                            if (isProcessing) {
                                setTimeout(applyNext, 100);
                            } else {
                                doApply();
                            }
                        };
                        applyNext();
                    }
                } catch (e) { console.warn('[Online] Failed to apply catch-up moves', e); }
                updateStartButtonState();
            } else if (msg.type === 'error') {
                console.debug('[Error]', msg.error);
                alert(msg.error);
                // If we failed to join by key, remove stale key from URL
                try {
                    const err = String(msg.error || '');
                    if (err.includes('Room not found') || err.includes('already started') || err.includes('full')) {
                        removeUrlRoomKey();
                    }
                } catch { /* ignore */ }
            }
        };
        /*ws.onerror = () => {
            console.warn('[WebSocket] Error');
        };
        ws.onclose = () => {
            console.debug('[WebSocket] Closed');
            wsConnected = false;
            // Show banner if we had connected before (avoid showing at initial load offline)
            if (wsEverOpened) showConnBanner('Connection lost. Reconnecting…', 'error');
            scheduleReconnect();
        };*/
    }

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

    function updateRoomList(rooms) {
        window.lastRoomList = rooms;
        roomListElement.innerHTML = '';
        const entries = Object.entries(rooms || {});
        // Partition: my room, joinable, full
        const my = [];
        const joinable = [];
        const full = [];
        for (const [roomName, infoRaw] of entries) {
            const info = infoRaw || {};
            const currentPlayers = Number.isFinite(info.currentPlayers) ? info.currentPlayers : 0;
            const maxPlayers = Number.isFinite(info.maxPlayers) ? info.maxPlayers : 2;
            if (roomName === myJoinedRoom) my.push([roomName, info]);
            else if (currentPlayers < maxPlayers) joinable.push([roomName, info]);
            else full.push([roomName, info]);
        }
        const ordered = [...my, ...joinable, ...full];
        if (ordered.length === 0) {
            // Show placeholder empty room
            const li = document.createElement('li');
            li.className = 'room-list-item';
            const btn = document.createElement('button');
            btn.classList.add('room-btn');
            btn.textContent = 'Host';
            btn.onclick = () => {
                // Host a game with maxPlayers = 2
                const debugPlayerName = (localStorage.getItem('playerName') || onlinePlayerNameInput?.value || 'Player').trim();
                ws.send(JSON.stringify({ type: 'host', roomName: debugPlayerName, maxPlayers: 2, debugName: debugPlayerName }));
            };
            const nameSpan = document.createElement('span');
            nameSpan.className = 'room-name';
            nameSpan.textContent = 'Empty Game';
            const countSpan = document.createElement('span');
            countSpan.className = 'room-player-count';
            countSpan.textContent = '(0/2)';
            li.appendChild(btn);
            li.appendChild(nameSpan);
            li.appendChild(countSpan);
            roomListElement.appendChild(li);
        } else {
            ordered.forEach(([roomName, info]) => {
                const currentPlayers = Number.isFinite(info.currentPlayers) ? info.currentPlayers : 0;
                const maxPlayers = Number.isFinite(info.maxPlayers) ? info.maxPlayers : 2;
                const li = document.createElement('li');
                li.className = 'room-list-item';
                const btn = document.createElement('button');
                const isMine = roomName === myJoinedRoom;
                const isFull = currentPlayers >= maxPlayers;
                btn.classList.add('room-btn');
                if (isMine) {
                    btn.classList.add('leave');
                    btn.textContent = 'Leave';
                    btn.onclick = () => leaveRoom(roomName);
                } else if (isFull) {
                    btn.classList.add('full');
                    btn.textContent = 'Full';
                    btn.disabled = true;
                } else {
                    btn.textContent = 'Join';
                    btn.onclick = () => joinRoom(roomName);
                }
                const nameSpan = document.createElement('span');
                nameSpan.className = 'room-name';
                nameSpan.textContent = `${roomName}'s Game`;
                const countSpan = document.createElement('span');
                countSpan.className = 'room-player-count';
                countSpan.textContent = `(${currentPlayers}/${maxPlayers})`;
                li.appendChild(btn);
                li.appendChild(nameSpan);
                li.appendChild(countSpan);
                roomListElement.appendChild(li);
            });
        }
    }

    function hostRoom() {
        const name = onlinePlayerNameInput.value.trim() || 'Player';
        function sendHost() {
            try {
                let debugPlayerName = sanitizeName((localStorage.getItem('playerName') || onlinePlayerNameInput.value || 'Player'));
                myPlayerName = debugPlayerName;
                const selectedPlayers = Math.max(2, Math.min(playerColors.length, Math.floor(menuPlayerCount || 2)));
                const desiredGrid = Number.isInteger(menuGridSizeVal) ? Math.max(3, Math.min(16, menuGridSizeVal)) : Math.max(3, selectedPlayers + 3);
                hostedDesiredGridSize = desiredGrid;
                ws.send(JSON.stringify({ type: 'host', roomName: name, maxPlayers: selectedPlayers, gridSize: desiredGrid, debugName: debugPlayerName }));
            } catch (err) {
                console.error('[Host] Error hosting room:', err);
                if (err && err.stack) console.error(err.stack);
            }
        }
        connectWebSocket();
        if (ws.readyState === WebSocket.OPEN) {
            sendHost();
        } else {
            ws.addEventListener('open', sendHost, { once: true });
        }
    }

    function joinRoom(roomName) {
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
        const doJoin = () => {
            try { ws.send(JSON.stringify({ type: 'join', roomName: roomName, debugName: debugPlayerName })); } catch { /* ignore */ }
        };
        connectWebSocket();
        if (ws && ws.readyState === WebSocket.OPEN) {
            doJoin();
        } else {
            showConnBanner('Connecting to server…', 'info');
            ws?.addEventListener('open', doJoin, { once: true });
        }
    }

    function leaveRoom(roomName) {
        console.debug('[Leave] Leaving room:', roomName);
        const doLeave = () => {
            try { ws.send(JSON.stringify({ type: 'leave', roomName: roomName })); } catch { /* ignore */ }
        };
        connectWebSocket();
        if (ws && ws.readyState === WebSocket.OPEN) {
            doLeave();
        } else {
            showConnBanner('Connecting to server…', 'info');
            ws?.addEventListener('open', doLeave, { once: true });
        }
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
                connectWebSocket();
                if (ws && ws.readyState === WebSocket.OPEN) {
                    try { ws.send(JSON.stringify(startPayload)); } catch { /* ignore */ }
                } else {
                    showConnBanner('Connecting to server…', 'info');
                    ws?.addEventListener('open', () => {
                        try { ws.send(JSON.stringify(startPayload)); } catch { /* ignore */ }
                    }, { once: true });
                }
                return;
            }
            // Otherwise behave as Host Custom -> navigate to host menu
            navigateToMenu('host');
        });
    }

    connectWebSocket();
    // Auto-join flow: if ?key= present and not already in a room, attempt join_by_key
    (function attemptAutoJoinByKey() {
        try {
            const params = new URLSearchParams(window.location.search);
            const key = params.get('key');
            if (key && !myJoinedRoom) {
                // Ensure WS is open then send
                const sendJoinKey = () => {
                    try { ws.send(JSON.stringify({ type: 'join_by_key', roomKey: key, debugName: (localStorage.getItem('playerName') || 'Player') })); } catch { /* ignore */ }
                };
                if (ws && ws.readyState === WebSocket.OPEN) {
                    sendJoinKey();
                } else {
                    ws.addEventListener('open', sendJoinKey, { once: true });
                }
                // Navigate to online menu for visibility
                navigateToMenu('online');
            }
        } catch { /* ignore */ }
    })();
    // ...existing code...
    // Declare name input fields before sync function
    const onlinePlayerNameInput = document.getElementById('onlinePlayerName');
    // PlayerNameFields component will handle synchronization between inputs later once both elements are known
    const gridElement = document.querySelector('.grid');
    // Online game state and guards
    let onlineGameActive = false;
    let onlinePlayers = [];
    let myOnlineIndex = -1;
    // let suppressNetworkSend = false; // unused after instant send
    /** @type {{row:number,col:number}|null} */
    // let pendingMove = null; // unused after instant send

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
                if (!ws || ws.readyState !== WebSocket.OPEN || !wsConnected) {
                    showConnBanner('You are offline. Reconnecting…', 'error');
                    connectWebSocket();
                    return;
                }
                // Send move to server and rely on echo for other clients; apply locally for responsiveness
                ws.send(JSON.stringify({
                    type: 'move',
                    row,
                    col,
                    fromIndex: myOnlineIndex,
                    nextIndex: (myOnlineIndex + 1) % playerCount,
                    color: activeColors()[myOnlineIndex]
                }));
                handleClick(row, col);
                return;
            }
            // Local / train mode: proceed as usual
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

    // Detect train mode via URL param
    const urlParams = new URLSearchParams(window.location.search);
    // Train mode is enabled if any AI-related parameter is present in the URL
    const isTrainMode = urlParams.has('ai_depth') || urlParams.has('ai_k');

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

    // Define available player colors
    // Start at green, move 5 colors forwards per step (Most contrasting colors)
    const playerColors = ['green', 'red', 'blue', 'yellow', 'magenta', 'cyan', 'orange', 'purple'];
    let startingColorIndex = playerColors.indexOf('green');
    if (startingColorIndex < 0) startingColorIndex = 0;
    let gameColors = null; // null until a game is started
    /**
     * Get the current active color palette (game palette if set, otherwise full list).
     * @returns {string[]} array of player color keys.
     */
    function activeColors() {
        return (gameColors && gameColors.length) ? gameColors : playerColors;
    }

    // Get and cap player count at the number of available colors
    let playerCount = parseInt(getQueryParam('players')) || 2;
    playerCount = Math.min(playerCount, playerColors.length);  // Cap at available colors

    // New recommended grid size schedule (custom minimal bounds)
    // Assumption for unspecified counts (6,7): use 6 (same as 8).
    function recommendedGridSize(p) {
        if (p <= 2) return 3;
        if (p <= 4) return 4; // covers 3-4
        if (p === 5) return 5;
        return 6; // 6-8 players
    }

    // Default grid size when auto-selecting via player slider changes
    // Keep legacy behavior: desired = Math.max(3, p + 3)
    function defaultGridSizeForPlayers(p) {
        return Math.max(3, (parseInt(p, 10) || 0) + 3);
    }

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

    /**
     * Fetch a query parameter value from the current page URL.
     * @param {string} param - the query key to retrieve.
     * @returns {string|null} the parameter value or null if missing.
     */
    function getQueryParam(param) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    }


    //#region Menu Logic
    const menuHint = document.querySelector('.menu-hint');
    // removed hidden native range input; visual slider maintains menuPlayerCount
    let menuPlayerCount = playerCount; // current selection from visual slider

    // Grid size display only (input removed)
    const gridValueEl = document.getElementById('gridValue');
    let menuGridSizeVal = 0; // set after initial clamps
    const startBtn = document.getElementById('startBtn');
    const trainBtn = document.getElementById('trainBtn');
    const menuColorCycle = document.getElementById('menuColorCycle');
    // playerNameInput now handled via PlayerNameFields component (fetched at instantiation)
    const gridDecBtn = document.getElementById('gridDec');
    const gridIncBtn = document.getElementById('gridInc');
    // GridSizeTile component (ESM) replacing legacy reflect/adjust functions
    let gridSizeTile = null;
    try {
        gridSizeTile = new GridSizeTile({
            decButtonEl: gridDecBtn,
            incButtonEl: gridIncBtn,
            valueEl: gridValueEl,
            getPlayerCount: () => menuPlayerCount,
            getRecommendedSize: (p) => recommendedGridSize(p),
            getGameGridSize: () => gridSize,
            initialSize: Number.isInteger(menuGridSizeVal) ? menuGridSizeVal : recommendedGridSize(menuPlayerCount),
            onSizeChange: (newSize, reason) => {
                menuGridSizeVal = newSize; // keep legacy variable for transitional code paths
                if (newSize !== gridSize) {
                    try { recreateGrid(newSize, playerCount); } catch { /* ignore */ }
                }
                console.debug('[GridSizeTile] onSizeChange ->', newSize, `(reason=${reason})`);
            }
        });
    } catch (e) { console.debug('[GridSizeTile] init failed', e); }
    const aiPreviewCell = document.getElementById('aiPreviewCell');
    let aiStrengthTile = null;
    try {
        aiStrengthTile = new AIStrengthTile({
            previewCellEl: aiPreviewCell,
            getPlayerColors: () => playerColors,
            getStartingColorIndex: () => startingColorIndex,
            initialStrength: (() => {
                const params = new URLSearchParams(window.location.search);
                const ad = parseInt(params.get('ai_depth') || '', 10);
                return (!Number.isNaN(ad) && ad >= 1) ? Math.max(1, Math.min(5, ad)) : 1;
            })(),
            onStrengthChange: (val) => {
                try {
                    const params = new URLSearchParams(window.location.search);
                    if (getMenuParam() === 'train') {
                        params.set('ai_depth', String(val));
                        const url = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
                        window.history.replaceState({ ...(window.history.state||{}), ai_depth: val }, '', url);
                    }
                } catch { /* ignore */ }
            },
            updateValueCircles: undefined // will inject later once function is defined
        });
        // console.debug('[AIStrengthTile] component initialized');
    } catch (e) { console.debug('[AIStrengthTile] init failed', e); }

    // Decide initial menu visibility using typed menu values
    const initialParams = new URLSearchParams(window.location.search);
    const hasPlayersOrSize = initialParams.has('players') || initialParams.has('size');

    const firstMenu = document.getElementById('firstMenu');
    const mainMenu = document.getElementById('mainMenu');
    const localGameBtn = document.getElementById('localGameBtn');
    const onlineGameBtn = document.getElementById('onlineGameBtn');
    const trainMainBtn = document.getElementById('trainMainBtn');

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

    // New: typed menu param helpers (first|local|online|host|train)
    // Lightweight in-app stack of menu states to avoid timeout fallbacks
    let menuHistoryStack = [];
    function getMenuParam() {
        try {
            const val = (new URLSearchParams(window.location.search)).get('menu');
            if (!val) return null;
            if (val === 'true') return 'first'; // backward compat
            const allowed = ['first', 'local', 'online', 'host', 'train'];
            return allowed.includes(val) ? val : null;
        } catch { return null; }
    }

    function setMenuParam(menuKey, push = true) {
        const params = new URLSearchParams(window.location.search);
        params.set('menu', menuKey);
        // While in explicit menu, drop transient game-only params so refresh is clean
        // Keep ai_depth if returning to train menu so the UI can reflect it
        if (menuKey !== null) {
            params.delete('players');
            params.delete('size');
        }
        // Preserve room key param if present while navigating menus
        const existingKey = (new URLSearchParams(window.location.search)).get('key');
        if (existingKey) params.set('key', existingKey);
        const url = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
        if (push) {
            window.history.pushState({ menu: menuKey }, '', url);
            // keep our in-memory stack in sync
            menuHistoryStack.push(menuKey);
        } else {
            window.history.replaceState({ menu: menuKey }, '', url);
            if (menuHistoryStack.length) menuHistoryStack[menuHistoryStack.length - 1] = menuKey; else menuHistoryStack.push(menuKey);
        }
    }

    // Helpers to manage ?key param
    function updateUrlRoomKey(key) {
        try {
            const params = new URLSearchParams(window.location.search);
            params.set('key', key);
            const url = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.replaceState({ ...(window.history.state || {}), menu: getMenuParam() || 'first' }, '', url);
        } catch { /* ignore */ }
    }
    function removeUrlRoomKey() {
        try {
            const params = new URLSearchParams(window.location.search);
            params.delete('key');
            const url = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.replaceState({ ...(window.history.state || {}), menu: getMenuParam() || 'first' }, '', url);
        } catch { /* ignore */ }
    }

    // Ensure the current entry has a state and initialize our in-memory stack
    function ensureHistoryStateInitialized() {
        try {
            const current = getMenuParam() || 'first';
            if (!window.history.state || typeof window.history.state.menu === 'undefined') {
                window.history.replaceState({ menu: current }, '', window.location.href);
            }
            if (!menuHistoryStack.length) menuHistoryStack.push(current);
        } catch { /* ignore */ }
    }

    function showMenuFor(menuKey) {
        const onlineMenu = document.getElementById('onlineMenu');
        // Default hide all
        setHidden(firstMenu, true);
        setHidden(mainMenu, true);
        if (onlineMenu) setHidden(onlineMenu, true);
        // Clear host marker unless entering host
        if (mainMenu) {
            try { delete mainMenu.dataset.openedBy; } catch { /* ignore */ }
        }
        switch (menuKey) {
            case 'first':
                setHidden(firstMenu, false);
                break;
            case 'local':
                setHidden(mainMenu, false);
                setMainMenuMode('local');
                break;
            case 'online':
                if (onlineMenu) setHidden(onlineMenu, false);
                // reflect any online state on button
                updateStartButtonState();
                // Always show a reconnecting banner by default when opening the Online menu;
                // it will be hidden automatically once a connection is established (on ws.onopen)
                if (!ws || ws.readyState !== WebSocket.OPEN || !wsConnected) {
                    showConnBanner('Reconnecting…', 'info');
                } else {
                    hideConnBanner();
                }
                break;
            case 'host':
                setHidden(mainMenu, false);
                setMainMenuMode('host');
                if (mainMenu) mainMenu.dataset.openedBy = 'host';
                break;
            case 'train':
                setHidden(mainMenu, false);
                setMainMenuMode('train');
                break;
            default:
                // Fallback to first
                setHidden(firstMenu, false);
        }
        // When showing any menu overlay, ensure background color mirrors cycler
        try {
            const colorKey = playerColors[startingColorIndex] || 'green';
            document.body.className = colorKey;
        } catch { /* ignore */ }
        // Update AI preview if train menu is shown
        if (menuKey === 'train') {
            try { aiStrengthTile && aiStrengthTile.updatePreview(); } catch { /* ignore */ }
        }
    }

    function navigateToMenu(menuKey) {
        // If navigating to online or host, ensure WS is (re)connecting
        if (menuKey === 'online' || menuKey === 'host') connectWebSocket();
        setMenuParam(menuKey, true);
        showMenuFor(menuKey);
    }

    // --- Main behaviour preserved, but simplified ---
    /**
     * Set main menu mode: 'local', 'host', or 'train'.
     * Adjusts header, button visibility, and player name input.
     * @param {'local'|'host'|'train'} mode
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
            if (mode === 'train') header.textContent = 'Train Mode';
            else if (mode === 'host') header.textContent = 'Host Game';
            else header.textContent = 'Local Game';
        }
        if (startBtn) {
            startBtn.style.display = '';
            if (mode === 'train') startBtn.textContent = 'Train';
            else if (mode === 'host') startBtn.textContent = 'Host';
            else startBtn.textContent = 'Start';
        }
        if (playerNameInput) playerNameInput.style.display = (mode === 'host') ? '' : 'none';
        const aiStrengthTile = document.getElementById('aiStrengthTile');
        if (aiStrengthTile) aiStrengthTile.style.display = (mode === 'train') ? '' : 'none';
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
    try { aiStrengthTile && aiStrengthTile.updatePreview(); } catch { /* ignore */ }
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
                connectWebSocket();
                if (!ws || ws.readyState !== WebSocket.OPEN) {
                    showConnBanner('Reconnecting…', 'info');
                }
                navigateToMenu('online');
            });
        }
        // Train
        trainMainBtn?.addEventListener('click', () => navigateToMenu('train'));
    }

    // Close button logic now handled by MenuCloseButton component
    const menuTopRightBtn = document.getElementById('menuTopRightBtn');
    const onlineTopRightBtn = document.getElementById('onlineTopRightBtn');
    // Replace direct listeners with MenuCloseButton component
    try {
        new MenuCloseButton({
            buttons: [menuTopRightBtn, onlineTopRightBtn],
            getCurrentMenu: () => new URLSearchParams(window.location.search).get('menu'),
            navigateToMenu: (target) => showMenuFor(target),
            setMenuParam: (menu, push) => setMenuParam(menu, push),
            menuHistoryStack
        });
    } catch (e) { console.debug('[MenuCloseButton] init failed', e); }
    // --- Main Menu Logic ---

    // Helper to toggle Train Mode UI state in mainMenu

    // Initialize unified player name fields component once both elements are available
    try {
        new PlayerNameFields({
            localInputEl: document.getElementById('playerName'),
            onlineInputEl: onlinePlayerNameInput,
            onNameChange: (name) => {
                console.debug('[PlayerNameFields] name changed ->', name);
            }
        });
        console.debug('[PlayerNameFields] component initialized');
    } catch (e) { console.debug('[PlayerNameFields] init failed', e); }

    // set dynamic bounds
    const maxPlayers = playerColors.length;

    // Build visual player box slider
    const playerBoxSlider = document.getElementById('playerBoxSlider');
    console.debug('[PlayerBoxSlider] element lookup:', playerBoxSlider ? '#playerBoxSlider found' : 'not found');
    // inner container that holds the clickable boxes (may be same as slider if wrapper missing)
    // PlayerBoxSlider manages its own internal cells container
    // inner-circle color map (match styles.css .inner-circle.* colors)
    const innerCircleColors = {
        red: '#d55f5f',
        orange: '#d5a35f',
        yellow: '#d5d35f',
        green: '#a3d55f',
        cyan: '#5fd5d3',
        blue: '#5f95d5',
        purple: '#8f5fd5',
        magenta: '#d35fd3'
    };

    // Weighted tips list (some with HTML)
    function getDeviceTips() {
        const mobile = isMobileDevice();
        const tips = [
            { text: 'Tip: You can also set <code>?players=&lt;n&gt;&amp;size=&lt;n&gt;</code> in the URL.', weight: 1, html: true },
            { text: 'Tip: Grid size defaults to a recommended value but can be adjusted manually.', weight: 2 },
            { text: 'Tip: Use Train mode to observe AI behavior and learn effective strategies.', weight: 1 },
            { text: 'Tip: <a href="https://joboblock.github.io" target="_blank">joboblock.github.io</a> redirects to this game.', weight: 2, html: true },
            { text: 'Tip: Give this project a <a href="https://github.com/Joboblock/color-clash" target="_blank">Star</a>, to support its development!', weight: 2, html: true },
            { text: 'Tip: This is a rare message.', weight: 0.1 },
            { text: 'Tip: Praise the Raute, embrace the Raute!', weight: 0.1 }
        ];
        if (mobile) {
            tips.push({ text: 'Tip: Double-tap outside the grid to toggle fullscreen on mobile devices.', weight: 3 });
        } else {
            tips.push({ text: 'Tip: Use WASD or Arrow keys to move between menu controls and grid cells.', weight: 2 });
        }
        return tips;
    }

    // Ensure CSS variables for colors are set on :root BEFORE building boxes
    Object.entries(innerCircleColors).forEach(([key, hex]) => {
        // inner circle strong color (hex)
        document.documentElement.style.setProperty(`--inner-${key}`, hex);
        // cell color: pastel mix toward white (opaque), use 50% white by default
        // Pastel cell color: mix original toward white (grayscale 255) by 50%
        const pastel = mixTowardGray(hex, 255, 0.5);
        document.documentElement.style.setProperty(`--cell-${key}`, pastel);
        // body color: slightly darker by multiplying channels
        const dark = (c) => Math.max(0, Math.min(255, Math.round(c * 0.88)));
        const { r: rr, g: gg, b: bb } = hexToRgb(hex);
        document.documentElement.style.setProperty(`--body-${key}`, `rgb(${dark(rr)}, ${dark(gg)}, ${dark(bb)})`);
    });

    // Starting color cycler: init to green and initialize player box slider component (ESM)
    const SliderCtor = PlayerBoxSlider;
    console.debug('[PlayerBoxSlider][ESM] import ok:', { selected: SliderCtor?.name || 'anonymous' });
    const slider = SliderCtor
        ? new SliderCtor({
            rootEl: playerBoxSlider,
            maxPlayers,
            minPlayers: 2,
            initialCount: clampPlayers(playerCount),
            delayAnimation,
            getPlayerColors: () => playerColors,
            getStartingColorIndex: () => startingColorIndex,
            onCountChange: (newCount) => {
                console.debug('[PlayerBoxSlider] onCountChange ->', newCount);
                onMenuPlayerCountChanged(newCount);
            }
        })
        : null;
    if (!SliderCtor) {
        console.debug('[PlayerBoxSlider][ESM] import missing; instantiate skipped');
    } else {
        console.debug('[PlayerBoxSlider] instance created:', !!slider);
    }

    // highlight using initial URL or default (without triggering grid rebuild)
    const initialPlayersToShow = clampPlayers(playerCount);
    if (slider) {
        slider.setCount(initialPlayersToShow, { silent: true });
        console.debug('[PlayerBoxSlider] initial setCount(silent):', initialPlayersToShow);
    }

    // Start with URL or defaults
    menuPlayerCount = clampPlayers(playerCount);
    updateSizeBoundsForPlayers(menuPlayerCount);

    // Initialize color cycler component for main and online menus (ESM)
    const onlineMenuColorCycle = document.getElementById('onlineMenuColorCycle');
    console.debug('[ColorCycler][ESM] import ok:', { selected: ColorCycler?.name || 'anonymous' });
    const colorCycler = ColorCycler
        ? new ColorCycler({
            mainEl: menuColorCycle,
            onlineEl: onlineMenuColorCycle,
            getColors: () => playerColors,
            getIndex: () => startingColorIndex,
            setIndex: (idx) => { startingColorIndex = Math.max(0, Math.min(playerColors.length - 1, idx|0)); },
            isMenuOpen: () => {
                const m1 = mainMenu && !mainMenu.classList.contains('hidden');
                const om = document.getElementById('onlineMenu');
                const m2 = om && !om.classList.contains('hidden');
                return !!(m1 || m2);
            },
            onChange: (idx, reason) => {
                console.debug('[ColorCycler] onChange ->', idx, `(reason=${reason})`);
                // Suppress initial animation triggered at construction to prevent first-load preview shift
                if (reason !== 'init') {
                    try { slider && slider.previewShiftLeftThenSnap(() => slider.updateColorsForIndex(idx)); } catch { /* ignore */ }
                } else {
                    // Just apply colors without animation on initial load
                    try { slider && slider.updateColorsForIndex(idx); } catch { /* ignore */ }
                }
                try { aiStrengthTile && aiStrengthTile.updatePreview(); } catch { /* ignore */ }
            }
        })
        : null;
    if (!ColorCycler) {
        console.debug('[ColorCycler][ESM] import missing; instantiate skipped');
    } else {
        console.debug('[ColorCycler] instance created:', !!colorCycler);
    }
    // Ensure initial slider colors and AI preview are in sync
    try {
        if (slider) {
            console.debug('[PlayerBoxSlider] updateColors (initial sync)');
            slider.updateColors();
        }
    } catch { /* ignore */ }
    try { aiStrengthTile && aiStrengthTile.updatePreview(); } catch { /* ignore */ }

    // Handle browser navigation to toggle between menu and game instead of leaving the app
    window.addEventListener('popstate', applyStateFromUrl);
    // Keep our in-memory stack aligned with the browser history on back/forward
    window.addEventListener('popstate', (ev) => {
        try {
            const stateMenu = (ev && ev.state && ev.state.menu) ? ev.state.menu : getMenuParam() || 'first';
            if (menuHistoryStack.length) menuHistoryStack.pop();
            menuHistoryStack.push(stateMenu);
        } catch { /* ignore */ }
    });

    // Stepper buttons for grid size now handled by GridSizeTile component
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

    // Replace menu navigation handler
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
            e.preventDefault();
            focused.click && focused.click();
            return;
        }
    });

    startBtn.addEventListener('click', async () => {
        // Determine current menu mode from button text
        const mode = startBtn.textContent.toLowerCase();
        const p = clampPlayers(menuPlayerCount);
        let s = Number.isInteger(menuGridSizeVal) ? menuGridSizeVal : 3;

        if (mode === 'start') {
            await requestFullscreenIfMobile();
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.delete('train');
            params.set('players', String(p));
            params.set('size', String(s));
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.pushState({ mode: 'play', players: p, size: s }, '', newUrl);
            gameColors = computeSelectedColors(p);
            if (mainMenu) mainMenu.classList.add('hidden');
            trainMode = false;
            recreateGrid(s, p);
            createEdgeCircles();
        } else if (mode === 'host') {
            // Host the room when clicking the start button in host mode
            hostRoom();
        }
        // Host menu: if in host mode, clicking the Host button should also allow back navigation to online menu
        if (mode === 'host' && mainMenu && mainMenu.dataset.mode === 'host') {
            window.history.back();
        }
        else if (mode === 'train') {
            await requestFullscreenIfMobile();
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.set('players', String(p));
            params.set('size', String(s));
            if (aiStrengthTile) params.set('ai_depth', String(aiStrengthTile.getStrength()));
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.pushState({ mode: 'ai', players: p, size: s }, '', newUrl);
            gameColors = computeSelectedColors(p);
            if (mainMenu) mainMenu.classList.add('hidden');
            trainMode = true;
            try { aiDepth = Math.max(1, parseInt(String(aiStrengthTile ? aiStrengthTile.getStrength() : 1), 10)); } catch { /* ignore */ }
            recreateGrid(s, p);
            createEdgeCircles();
        }
    });

    // Train button handler
    if (trainBtn) {
        trainBtn.textContent = 'Train';
        trainBtn.id = 'trainBtn';
        trainBtn.setAttribute('aria-label', 'Train');

        trainBtn.addEventListener('click', async () => {
            const p = clampPlayers(menuPlayerCount);
            let s = Number.isInteger(menuGridSizeVal) ? menuGridSizeVal : 3;

            // Enter fullscreen on mobile from the same user gesture
            await requestFullscreenIfMobile();

            // Update URL without reloading (reflect AI settings)
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.set('players', String(p));
            params.set('size', String(s));
            // Set AI strength parameter from the preview value (1..5)
            if (aiStrengthTile) params.set('ai_depth', String(aiStrengthTile.getStrength()));
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            // push a new history entry so Back returns to the menu instead of previous/blank
            window.history.pushState({ mode: 'ai', players: p, size: s }, '', newUrl);

            // Set the active game palette from the UI selection
            gameColors = computeSelectedColors(p);

            // Hide menu and start train mode immediately
            if (mainMenu) mainMenu.classList.add('hidden');
            trainMode = true;
            // Apply the chosen AI depth immediately for this session
            try { aiDepth = Math.max(1, parseInt(String(aiStrengthTile ? aiStrengthTile.getStrength() : 1), 10)); } catch { /* ignore */ }
            recreateGrid(s, p);
        });
    }
    //#endregion

    // Edge circles overlay: 4 corner dots plus 2+2 on the non-restricting sides

    function getRestrictionType() {
        const vw = window.innerWidth || document.documentElement.clientWidth || 1;
        const vh = window.innerHeight || document.documentElement.clientHeight || 1;
        return vw < vh ? 'side' : 'top';
    }

    function createEdgeCircles() {
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
        const ac = (typeof activeColors === 'function') ? activeColors() : playerColors;
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
        requestAnimationFrame(() => { try { updateEdgeCirclesActive(); } catch { /* ignore */ } });
    }

    // Only need to update the restriction type on resize
    window.addEventListener('resize', () => {
        const container = document.getElementById('edgeCirclesContainer');
        const newRestrict = getRestrictionType();
        if (container) {
            const oldRestrict = container.getAttribute('data-restrict');
            if (oldRestrict !== newRestrict) {
                // Rebuild layout when switching between side/top to update positional classes
                try { container.remove(); } catch { /* ignore */ }
                createEdgeCircles();
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
                createEdgeCircles();
                return;
            }
        }
        // Also update circle size variable
        document.documentElement.style.setProperty('--edge-circle-size', computeEdgeCircleSize() + 'px');
    }, { passive: true });

    // Compute edge circle size considering viewport, grid, and caps
    function computeEdgeCircleSize() {
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

    // Compute positional classes for player edge circles based on count and restriction
    function computeEdgePositions(count, restrict) {
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

    // Reflect active player on edge circles (full size/opacity for active; smaller/faded for others)
    function updateEdgeCirclesActive() {
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
            const ac = (typeof activeColors === 'function') ? activeColors() : playerColors;
            const key = ac[activeIdx % ac.length];
            const baseBody = getComputedStyle(document.documentElement).getPropertyValue(`--body-${key}`).trim();
            const notMyTurn = (() => {
                if (typeof onlineGameActive !== 'undefined' && onlineGameActive) {
                    return typeof myOnlineIndex === 'number' ? (currentPlayer !== myOnlineIndex) : true;
                }
                if (typeof trainMode !== 'undefined' && trainMode) {
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


    //#region Menu Functions
    /**
     * Sync menu/game UI from current URL state (back/forward navigation handler).
     * @returns {void}
     */
    function applyStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const typed = getMenuParam();
        const hasPS = params.has('players') || params.has('size');
        if (typed || !hasPS) {
            // Show the requested or default menu
            showMenuFor(typed || 'first');
            try { updateRandomTip(); } catch { /* ignore */ }
            // Reflect AI strength to UI if present
            const ad = parseInt(params.get('ai_depth') || '', 10);
            if (!Number.isNaN(ad) && ad >= 1) {
                try { aiStrengthTile && aiStrengthTile.setStrength(Math.max(1, Math.min(5, ad))); } catch { /* ignore */ }
                try { aiStrengthTile && aiStrengthTile.onStartingColorChanged(); } catch { /* ignore */ }
            }
            try { (playerBoxSlider || menuColorCycle || startBtn)?.focus(); } catch { /* ignore */ }
            exitFullscreenIfPossible();
            return;
        }

        const p = clampPlayers(parseInt(params.get('players') || '', 10) || 2);
        let s = parseInt(params.get('size') || '', 10);
        if (!Number.isInteger(s)) s = Math.max(3, 3 + p);
        setHidden(firstMenu, true);
        setHidden(mainMenu, true);
        const onlineMenu = document.getElementById('onlineMenu');
        if (onlineMenu) setHidden(onlineMenu, true);
        // Enable train mode if any AI-related parameter exists in the URL
        trainMode = params.has('ai_depth') || params.has('ai_k');
        const ad = parseInt(params.get('ai_depth') || '', 10);
        if (!Number.isNaN(ad) && ad >= 1) {
            try { aiDepth = Math.max(1, ad); } catch { /* ignore */ }
        }
        gameColors = computeSelectedColors(p);
        recreateGrid(Math.max(3, s), p);
        createEdgeCircles();
    }

    /**
     * Pick a random entry from a weighted list of tips.
     * @param {Array<{text:string, weight?:number, html?:boolean}>} list - candidate tips.
     * @returns {{text:string, weight?:number, html?:boolean}} chosen tip.
     */
    function pickWeightedTip(list) {
        let total = 0;
        for (const t of list) total += (typeof t.weight === 'number' ? t.weight : 1);
        let roll = Math.random() * total;
        for (const t of list) {
            roll -= (typeof t.weight === 'number' ? t.weight : 1);
            if (roll <= 0) return t;
        }
        return list[list.length - 1];
    }

    /**
     * Update the menu hint with a randomly picked weighted tip.
     * @returns {void}
     */
    function updateRandomTip() {
        if (!menuHint) return;
        const tip = pickWeightedTip(getDeviceTips());
        if (tip && tip.html) menuHint.innerHTML = tip.text; else menuHint.textContent = tip ? tip.text : '';
    }

    // Helpers tied to player color selection and UI reflection

    /**
     * Compute the starting player index based on the current cycler color in the active palette.
     * @returns {number} index into activeColors().
     */
    function computeStartPlayerIndex() {
        const ac = activeColors();
        const selectedKey = playerColors[startingColorIndex];
        const idx = ac.indexOf(selectedKey);
        return idx >= 0 ? idx : 0;
    }


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
    function computeSelectedColors(count) {
        const n = playerColors.length;
        const c = Math.max(1, Math.min(count, n));
        const arr = [];
        for (let i = 0; i < c; i++) arr.push(playerColors[(startingColorIndex + i) % n]);
        return arr;
    }

    /**
     * Generic mix of a hex color toward a grayscale target value.
     * Replaces mixWithWhite and mixWithBlack.
     * @param {string} hex - source color (#rgb or #rrggbb).
     * @param {number} [gray=128] - grayscale target channel 0..255 (0=black, 255=white).
     * @param {number} [factor=0.5] - blend factor 0..1 (0 = original, 1 = fully gray).
     * @returns {string} css rgb(r,g,b) color string.
     */
    function mixTowardGray(color, gray = 128, factor = 0.5) {
        // Clamp inputs
        if (typeof gray !== 'number' || isNaN(gray)) gray = 128;
        gray = Math.max(0, Math.min(255, Math.round(gray)));
        if (typeof factor !== 'number' || isNaN(factor)) factor = 0.5;
        factor = Math.max(0, Math.min(1, factor));
        const { r, g, b } = cssColorToRgb(color);
        const mix = (c) => Math.round((1 - factor) * c + factor * gray);
        return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
    }

    /**
     * Parse a CSS color string (#hex or rgb/rgba) into RGB channels.
     * @param {string} color - CSS color string.
     * @returns {{r:number,g:number,b:number}}
     */
    function cssColorToRgb(color) {
        if (!color || typeof color !== 'string') return { r: 0, g: 0, b: 0 };
        const c = color.trim();
        if (c.startsWith('#')) return hexToRgb(c);
        // rgb or rgba
        const m = c.match(/rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i);
        if (m) {
            const r = Math.max(0, Math.min(255, parseInt(m[1], 10)));
            const g = Math.max(0, Math.min(255, parseInt(m[2], 10)));
            const b = Math.max(0, Math.min(255, parseInt(m[3], 10)));
            return { r, g, b };
        }
        // Fallback
        return { r: 0, g: 0, b: 0 };
    }

    /**
     * Convert hex color string (#rgb or #rrggbb) to RGB components.
     * @param {string} hex - color in hex form.
     * @returns {{r:number,g:number,b:number}} RGB channels 0..255.
     */
    function hexToRgb(hex) {
        const h = hex.replace('#', '');
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        const bigint = parseInt(full, 16);
        return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    }

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
        try { gridSizeTile && gridSizeTile.applyPlayerCountBounds({ silent: true }); } catch { /* ignore */ }
    }

    // Sync functions
    /**
     * Clamp a numeric player count to valid limits [2..maxPlayers].
     * @param {number} n - requested player count.
     * @returns {number} clamped integer within bounds.
     */
    function clampPlayers(n) {
        const v = Math.max(2, Math.min(maxPlayers, Math.floor(n) || 2));
        return v;
    }

    /**
     * Central handler when menu player count changes; syncs size, UI, and grid.
     * @param {number} newCount - selected player count.
     * @returns {void} may recreate the grid to reflect new settings.
     */
    function onMenuPlayerCountChanged(newCount) {
        const minForPlayers = recommendedGridSize(newCount);
        const desired = defaultGridSizeForPlayers(newCount);
        const newGridSize = Math.max(minForPlayers, desired);
        if (newGridSize !== menuGridSizeVal) {
            menuPlayerCount = newCount;
            menuGridSizeVal = newGridSize;
            try { gridSizeTile && gridSizeTile.setSize(newGridSize, 'playerCount'); } catch { /* ignore */ }
            recreateGrid(menuGridSizeVal, newCount);
            try { slider && slider.setCount(newCount, { silent: true }); } catch { /* ignore */ }
        }
    }
    //#endregion


    //#region Actual Game Logic
    let grid = [];
    let isProcessing = false;
    let performanceMode = false;
    // Start with the first selected color (index 0) instead of a random player
    let currentPlayer = computeStartPlayerIndex();
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
            const targetMenu = onlineGameActive ? 'online' : (trainMode ? 'train' : 'local');
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

    // Train mode globals
    let trainMode = isTrainMode;
    const humanPlayer = 0; // first selected color is player index 0

    // create initial grid
    recreateGrid(gridSize, playerCount);
    // Initialize AI preview after initial color application
    try { aiStrengthTile && aiStrengthTile.updatePreview(); } catch { /* ignore */ }

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
            if (!ws || ws.readyState !== WebSocket.OPEN || !wsConnected) {
                showConnBanner('You are offline. Reconnecting…', 'error');
                connectWebSocket();
                return;
            }
            e.preventDefault();
            ws.send(JSON.stringify({
                type: 'move',
                row,
                col,
                fromIndex: myOnlineIndex,
                nextIndex: (myOnlineIndex + 1) % playerCount,
                color: activeColors()[myOnlineIndex]
            }));
            handleClick(row, col);
            return;
        }
        if (typeof trainMode !== 'undefined' && trainMode && typeof currentPlayer !== 'undefined' && typeof humanPlayer !== 'undefined' && currentPlayer !== humanPlayer) return;
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
        try { updateEdgeCirclesActive(); } catch { /* ignore */ }

        // Reflect actual grid size in display value while menu is present
    menuGridSizeVal = Math.max(3, newSize);
    try { gridSizeTile && gridSizeTile.setSize(menuGridSizeVal, 'gridRebuild', { silent: true, bump: false }); } catch { /* ignore */ }

        // Ensure the visual player boxes reflect new player count via component
        try { slider && slider.setCount(clampPlayers(playerCount), { silent: true }); } catch { /* ignore */ }

        // If train mode is enabled, force human to be first color and
        // set the current player to the human (so they control the first color)
        if (trainMode) {
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
    try { aiStrengthTile && aiStrengthTile.setValueRenderer(updateValueCircles); } catch { /* ignore */ }

    /**
     * Advance to the next active player and update body color; trigger AI in train mode.
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
        try { updateEdgeCirclesActive(); } catch { /* ignore */ }
        clearCellFocus();
        updateGrid();
        // Restore focus to last focused cell for this player, if any
        restorePlayerFocus();
        // If in train mode, possibly trigger AI move for non-human players
        maybeTriggerAIMove();
        // ...existing code...
        // Online: sending move is now handled instantly in click/keyboard handler
        // ...existing code...
    }

    /**
     * Restore focus to the last cell focused by the current player, if any.
     */
    function restorePlayerFocus() {
        // Only restore focus for human player (trainMode: currentPlayer === humanPlayer)
        if (typeof trainMode !== 'undefined' && trainMode && typeof currentPlayer !== 'undefined' && typeof humanPlayer !== 'undefined' && currentPlayer !== humanPlayer) return;
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


    //#region Training / AI helpers (dataRespect + debug)
    // AI parameters (core logic now in src/ai/engine.js)
    const aiDebug = true;
    const dataRespectK = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_k')) || 25);
    let aiDepth = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_depth')) || 4);


    /**
     * In train mode, trigger AI move if it's currently an AI player's turn.
     * @returns {void} may schedule aiMakeMoveFor with a short delay.
     */
    function maybeTriggerAIMove() {
        if (!trainMode || gameWon || isProcessing || currentPlayer === humanPlayer) return;
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
        const panel = document.createElement('div'); panel.id='aiDebugPanel';
        const title = document.createElement('h4'); title.textContent = `AI dataRespect — player ${currentPlayer} (${activeColors()[currentPlayer]})`; panel.appendChild(title);
        const summary = document.createElement('div'); summary.innerHTML = `<strong>chosen gain:</strong> ${info.chosen ? info.chosen.gain : '—'} &nbsp; <strong>expl:</strong> ${info.chosen ? info.chosen.expl : '—'}`; panel.appendChild(summary);
        const listTitle = document.createElement('div'); listTitle.style.marginTop='8px'; listTitle.innerHTML = `<em>candidates (top ${info.topK}) ordered by AI gain:</em>`; panel.appendChild(listTitle);
        const pre = document.createElement('pre'); pre.textContent = info.ordered.map((e,i)=>`${i+1}. (${e.r},${e.c}) src:${e.src} expl:${e.expl} gain:${e.gain} atk:${e.atk} def:${e.def}`).join('\n'); panel.appendChild(pre);
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

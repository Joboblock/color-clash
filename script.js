document.addEventListener('DOMContentLoaded', () => {
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
            modal.innerHTML = '<div style="background:#fff;padding:24px 32px;border-radius:10px;max-width:90vw;box-shadow:0 4px 24px rgba(0,0,0,0.18);font-size:1.1em;text-align:center;">' + html + '<br><br><button id="modalErrorClose" style="margin-top:12px;padding:8px 18px;font-size:1em;">Close</button></div>';
            document.body.appendChild(modal);
            modal.querySelector('#modalErrorClose').onclick = () => {
                modal.remove();
            };
        }
    }

    // Multiplayer room logic
    let ws;
    let hostedRoom = null;
    const roomListElement = document.getElementById('roomList');
    // Online bottom action button in online menu
    const hostCustomGameBtnRef = document.getElementById('hostCustomGameBtn');

    function connectWebSocket() {
        if (ws && ws.readyState === WebSocket.OPEN) return;
        ws = new WebSocket('ws://localhost:3000');
        ws.onopen = () => {
            console.debug('[WebSocket] Connected, requesting room list');
            ws.send(JSON.stringify({ type: 'list' }));
        };
        ws.onmessage = (event) => {
            let msg;
            try { msg = JSON.parse(event.data); } catch { return; }
            if (msg.type === 'hosted') {
                hostedRoom = msg.room;
                myJoinedRoom = msg.room;
                myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
                myRoomCurrentPlayers = 1; // host is the first participant
                console.debug(`[Host] Room hosted: ${hostedRoom}`);
                // On successful hosting, return to Online game menu
                const onlineMenu = document.getElementById('onlineMenu');
                const mainMenu = document.getElementById('mainMenu');
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
            } else if (msg.type === 'joined') {
                // If joined includes player names, log them
                if (msg.players && Array.isArray(msg.players)) {
                    const names = msg.players.map(p => p.name).join(', ');
                    console.debug(`[Join] Joined room: ${msg.room} | Players: ${names}`);
                } else {
                    console.debug(`[Join] Joined room: ${msg.room}`);
                }
                myJoinedRoom = msg.room;
                // Track my room occupancy and capacity
                myRoomMaxPlayers = Number.isFinite(msg.maxPlayers) ? msg.maxPlayers : myRoomMaxPlayers;
                if (Array.isArray(msg.players)) myRoomCurrentPlayers = msg.players.length;
                updateStartButtonState();
            } else if (msg.type === 'left') {
                console.debug('[Leave] Left room:', msg.room);
                if (!msg.room || msg.room === myJoinedRoom) myJoinedRoom = null;
                myRoomMaxPlayers = null; myRoomCurrentPlayers = 0;
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
                    updateStartButtonState();
                }
            } else if (msg.type === 'error') {
                console.debug('[Error]', msg.error);
                alert(msg.error);
            }
        };
    }

    let myJoinedRoom = null; // track the room this tab is in
    let myRoomMaxPlayers = null; // capacity of the room I'm in
    let myRoomCurrentPlayers = 0; // current players in my room

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
        }
        const inRoom = !!myJoinedRoom;
        const isFull = inRoom && Number.isFinite(myRoomMaxPlayers) && myRoomCurrentPlayers >= myRoomMaxPlayers;
        if (inRoom) {
            btn.textContent = 'Start Game';
            btn.disabled = !isFull;
            btn.classList.add('start-mode');
            btn.setAttribute('aria-disabled', isFull ? 'false' : 'true');
        } else {
            btn.textContent = 'Host Custom';
            btn.disabled = false;
            btn.classList.remove('start-mode');
            btn.removeAttribute('aria-disabled');
        }
    }

    function updateRoomList(rooms) {
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
        const name = onlinePlayerNameInput.value.trim() || 'Room_' + Math.floor(Math.random()*1000);
        function sendHost() {
            try {
                console.debug('[Host] Hosting room:', name);
                // For debug: send player name, but do not use for logic
                const debugPlayerName = (localStorage.getItem('playerName') || onlinePlayerNameInput.value || 'Player').trim();
                // Send selected player count for maxPlayers
                const selectedPlayers = Math.max(2, Math.min(playerColors.length, Math.floor(menuPlayerCount || 2)));
                ws.send(JSON.stringify({ type: 'host', roomName: name, maxPlayers: selectedPlayers, debugName: debugPlayerName }));
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
        connectWebSocket();
        console.debug('[Join] Joining room:', roomName);
        // For debug: send player name, but do not use for logic
        const debugPlayerName = (localStorage.getItem('playerName') || onlinePlayerNameInput?.value || 'Player').trim();
    ws.send(JSON.stringify({ type: 'join', roomName: roomName, debugName: debugPlayerName }));
    }

    function leaveRoom(roomName) {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        console.debug('[Leave] Leaving room:', roomName);
    ws.send(JSON.stringify({ type: 'leave', roomName: roomName }));
    }

    // Wire Host Custom / Start Game button behavior in the online menu
    if (hostCustomGameBtnRef) {
        hostCustomGameBtnRef.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            // If we're in Start Game mode and enabled, trigger online start (stub)
            if (btn.classList && btn.classList.contains('start-mode') && !btn.disabled) {
                // Placeholder: starting an online game would be implemented here
                console.debug('[Online] Start Game clicked for room:', myJoinedRoom);
                // TODO: send a start signal or transition to gameplay view when implemented
                return;
            }
            // Otherwise behave as Host Custom -> open mainMenu in host mode
            const onlineMenu = document.getElementById('onlineMenu');
            const mainMenu = document.getElementById('mainMenu');
            if (onlineMenu && mainMenu) {
                setHidden(onlineMenu, true);
                setHidden(mainMenu, false);
                setMainMenuMode('host');
                // Mark mainMenu as opened by host for close logic
                mainMenu.dataset.openedBy = 'host';
            }
        });
    }

    connectWebSocket();
    // ...existing code...
    // Declare name input fields before sync function
    const onlinePlayerNameInput = document.getElementById('onlinePlayerName');
    // Utility: synchronize all player name fields
    function syncPlayerNameFields(newName) {
        const name = window.sanitizeName(newName || '');
        if (playerNameInput) {
            playerNameInput.value = name;
            window.reflectValidity(playerNameInput, name);
        }
        if (onlinePlayerNameInput) {
            onlinePlayerNameInput.value = name;
            window.reflectValidity(onlinePlayerNameInput, name);
        }
        // Add more fields here if needed
    }
    const gridElement = document.querySelector('.grid');
    
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
            handleClick(row, col);
        }
    }
    // Attach once; per-cell listeners are removed.
    gridElement.addEventListener('click', onGridClick, { passive: true });

    let lastTapTime = 0;
    const doubleTapThreshold = 300; // ms
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

    // Get grid size from URL
    let gridSize = parseInt(getQueryParam('size')) || (3 + playerCount);

    // Game Parameters
    const maxCellValue = 5;
    const initialPlacementValue = 5;
    const cellExplodeThreshold = 4;
    const delayExplosion = 500;
    const delayAnimation = 300;
    const delayGameEnd = 2000;
    const performanceModeCutoff = 16;

    document.documentElement.style.setProperty('--delay-explosion', `${delayExplosion}ms`);
    document.documentElement.style.setProperty('--delay-animation', `${delayAnimation}ms`);
    // Global lock to block the color cycler while slider animations run
    let sliderAnimLocks = 0;
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


//#region Menu Stuff
    const menuHint = document.querySelector('.menu-hint');
    // removed hidden native range input; visual slider maintains menuPlayerCount
    let menuPlayerCount = playerCount; // current selection from visual slider

    // Grid size display only (input removed)
    const gridValueEl = document.getElementById('gridValue');
    let menuGridSizeVal = 0; // set after initial clamps
    const startBtn = document.getElementById('startBtn');
    const trainBtn = document.getElementById('trainBtn');
    const menuColorCycle = document.getElementById('menuColorCycle');
    const playerNameInput = document.getElementById('playerName');
    const gridDecBtn = document.getElementById('gridDec');
    const gridIncBtn = document.getElementById('gridInc');
    const aiPreviewCell = document.getElementById('aiPreviewCell');

    // Initialize AI preview value from URL (?ai_depth=) if present, else 1; clamp to 1..5 for UI
    let aiPreviewValue = 1;
    {
        const params = new URLSearchParams(window.location.search);
        const ad = parseInt(params.get('ai_depth') || '', 10);
        if (!Number.isNaN(ad) && ad >= 1) aiPreviewValue = Math.max(1, Math.min(5, ad));
    }

    // Decide initial menu visibility: only open menu if no players/size params OR menu param is present
    const initialParams = new URLSearchParams(window.location.search);
    const hasPlayersOrSize = initialParams.has('players') || initialParams.has('size');
    const isMenu = initialParams.has('menu');

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
    };

    const replaceUrlWithParams = (params) => {
        const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
        window.history.replaceState(null, '', newUrl);
    };

    const ensureMenuParamIfNeeded = (force = false) => {
        const params = new URLSearchParams(window.location.search);
        const hasParams = params.has('players') || params.has('size');
        if (force || (!params.has('menu') && !hasParams)) {
            params.set('menu', 'true');
            replaceUrlWithParams(params);
            return true;
        }
        return false;
    };

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
        if (header) {
            if (mode === 'train') header.textContent = 'Train Mode';
            else if (mode === 'host') header.textContent = 'Online Game';
            else header.textContent = 'Color Clash';
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
    if (hasPlayersOrSize && !isMenu) {
        // hide menu when explicit game params provided (and not in menu mode)
        setHidden(firstMenu, true);
        setHidden(mainMenu, true);
    } else {
        // Open / make menu available
        if (mainMenu) setHidden(mainMenu, false);

        // Non-fatal: call these if available (preserves original side-effects)
        if (typeof updateRandomTip === 'function') try { updateRandomTip(); } catch { /* empty */ }
        if (typeof updateAIPreview === 'function') try { updateAIPreview(); } catch { /* empty */ }

        // Ensure ?menu=true is present when the script decides to open menu
        if (!isMenu) ensureMenuParamIfNeeded(true);

        // --- Main Menu Logic (firstMenu exists => two-step menu flow) ---
        if (firstMenu && localGameBtn && mainMenu) {
            // Hide mainMenu initially (firstMenu is the starting UI)
            setHidden(mainMenu, true);

            // Ensure ?menu=true is present if no parameters (match previous behaviour)
            const urlParams = new URLSearchParams(window.location.search);
            const hasParams = urlParams.has('players') || urlParams.has('size');
            let showMenu = urlParams.get('menu') === 'true';
            if (!hasParams && !showMenu) {
                urlParams.set('menu', 'true');
                replaceUrlWithParams(urlParams);
                showMenu = true;
            }

            setHidden(firstMenu, !showMenu);

            // Attach event listeners once (idempotent guard)
            if (!document.body.dataset.menuInited) {
                document.body.dataset.menuInited = '1';

                // Show mainMenu for Local Game (hide name input)
                localGameBtn.addEventListener('click', () => {
                    setHidden(firstMenu, true);
                    setHidden(mainMenu, false);
                    setMainMenuMode('local');
                });

                // Show onlineMenu for Online Game
                const onlineMenu = document.getElementById('onlineMenu');
                if (onlineGameBtn && onlineMenu && mainMenu) {
                        onlineGameBtn.addEventListener('click', (e) => {
                            if (!ws || ws.readyState !== WebSocket.OPEN) {
                                e.preventDefault();
                                showModalError('Cannot connect to server. There is currently no multiplayer server.<br>If you want one, support the project by <a href="https://github.com/Joboblock/color-clash" target="_blank" rel="noopener">giving it a star on GitHub</a>.');
                                return;
                            }
                            setHidden(firstMenu, true);
                            setHidden(mainMenu, true);
                            setHidden(onlineMenu, false);
                            // Reflect current room status on the action button
                            updateStartButtonState();
                        });
                }

                // Host Custom/Start Game button is handled globally; no per-init binding here
                // Train Mode button logic
                trainMainBtn.addEventListener('click', () => {
                    setHidden(firstMenu, true);
                    setHidden(mainMenu, false);
                    setMainMenuMode('train');
                });
            }
        } else {
            // If firstMenu is absent, ensure mainMenu visibility (fall back)
            setHidden(mainMenu, false);
        }
    }

    // Combined top-right close button logic for local and online menus
    function handleMenuClose(menuId) {
        const menu = document.getElementById(menuId);
        const firstMenu = document.getElementById('firstMenu');
        const onlineMenu = document.getElementById('onlineMenu');
    setMainMenuMode('local'); // Always restore default UI when closing mainMenu
        // Exception: if mainMenu was opened by hostGameBtn, redirect to onlineMenu
        if (menuId === 'mainMenu' && menu && onlineMenu && menu.dataset.openedBy === 'host') {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
            onlineMenu.classList.remove('hidden');
            onlineMenu.setAttribute('aria-hidden', 'false');
            menu.dataset.openedBy = '';
            return;
        }
        // Default: always redirect to firstMenu
        if (menu && firstMenu) {
            menu.classList.add('hidden');
            menu.setAttribute('aria-hidden', 'true');
            firstMenu.classList.remove('hidden');
            firstMenu.setAttribute('aria-hidden', 'false');
        }
    }
    const menuTopRightBtn = document.getElementById('menuTopRightBtn');
    if (menuTopRightBtn) {
        menuTopRightBtn.addEventListener('click', () => handleMenuClose('mainMenu'));
    }
    const onlineTopRightBtn = document.getElementById('onlineTopRightBtn');
    if (onlineTopRightBtn) {
        onlineTopRightBtn.addEventListener('click', () => handleMenuClose('onlineMenu'));
    }
    // --- Main Menu Logic ---

    // Helper to toggle Train Mode UI state in mainMenu

    // Sanitize player name: replace spaces with underscores, remove non-alphanumerics, limit to 16
    if (playerNameInput) {
        try { playerNameInput.maxLength = 16; } catch { /* ignore */ }
        // Shared name sanitization and validity functions
        window.sanitizeName = (raw) => {
            if (typeof raw !== 'string') return '';
            let s = raw.replace(/\s+/g, '_');
            s = s.replace(/[^A-Za-z0-9_]/g, '');
            if (s.length > 16) s = s.slice(0, 16);
            return s;
        };
        window.reflectValidity = (inputEl, val) => {
            const tooShort = val.length > 0 && val.length < 3;
            if (tooShort) {
                inputEl.classList.add('invalid');
                inputEl.setAttribute('aria-invalid', 'true');
                inputEl.title = 'Enter 3–16 letters or numbers (spaces become _)';
            } else {
                inputEl.classList.remove('invalid');
                inputEl.removeAttribute('aria-invalid');
                inputEl.removeAttribute('title');
            }
        };
        // Load player name from localStorage if available
        const savedName = localStorage.getItem('playerName');
        if (savedName) {
            syncPlayerNameFields(savedName);
        } else {
            syncPlayerNameFields(playerNameInput.value || '');
        }
        const handleSanitize = (e) => {
            const v = e.target.value;
            const cleaned = window.sanitizeName(v);
            if (v !== cleaned) {
                const pos = Math.min(cleaned.length, 16);
                e.target.value = cleaned;
                try { e.target.setSelectionRange(pos, pos); } catch { /* ignore */ }
            }
            window.reflectValidity(e.target, e.target.value);
            // Save player name to localStorage and sync all fields
            localStorage.setItem('playerName', e.target.value);
            syncPlayerNameFields(e.target.value);
        };
        playerNameInput.addEventListener('input', handleSanitize);
        playerNameInput.addEventListener('blur', handleSanitize);
        playerNameInput.addEventListener('change', handleSanitize);
        playerNameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                playerNameInput.blur();
            }
        });
    }

// Online menu name input restrictions (reuse shared logic)
if (onlinePlayerNameInput) {
    try { onlinePlayerNameInput.maxLength = 16; } catch { /* ignore */ }
    // Load player name from localStorage if available
    const savedName = localStorage.getItem('playerName');
    if (savedName) {
        syncPlayerNameFields(savedName);
    } else {
        syncPlayerNameFields(onlinePlayerNameInput.value || '');
    }
    const handleSanitize = (e) => {
        const v = e.target.value;
        const cleaned = window.sanitizeName(v);
        if (v !== cleaned) {
            const pos = Math.min(cleaned.length, 16);
            e.target.value = cleaned;
            try { e.target.setSelectionRange(pos, pos); } catch { /* ignore */ }
        }
        window.reflectValidity(e.target, e.target.value);
        // Save player name to localStorage and sync all fields
        localStorage.setItem('playerName', e.target.value);
        syncPlayerNameFields(e.target.value);
    };
    onlinePlayerNameInput.addEventListener('input', handleSanitize);
    onlinePlayerNameInput.addEventListener('blur', handleSanitize);
    onlinePlayerNameInput.addEventListener('change', handleSanitize);
    onlinePlayerNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            onlinePlayerNameInput.blur();
        }
    });
}

    // set dynamic bounds
    const maxPlayers = playerColors.length;

    // Build visual player box slider
    const playerBoxSlider = document.getElementById('playerBoxSlider');
    // inner container that holds the clickable boxes (may be same as slider if wrapper missing)
    let sliderCells = playerBoxSlider ? (playerBoxSlider.querySelector('.slider-cells') || playerBoxSlider) : null;
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
    
    // Cache for computed shadows used by the slider animation
    let sliderShadowCache = null; // { inactive: string, active: string }
    // Track the currently running slider preview animation to allow instant finalize on re-trigger
    let currentSliderPreview = null; // { finalizeNow: () => void, finished: boolean }

    // Ensure CSS variables for colors are set on :root BEFORE building boxes
    Object.entries(innerCircleColors).forEach(([key, hex]) => {
        // inner circle strong color (hex)
        document.documentElement.style.setProperty(`--inner-${key}`, hex);
        // cell color: pastel mix toward white (opaque), use 50% white by default
        const pastel = mixWithWhite(hex, 0.5);
        document.documentElement.style.setProperty(`--cell-${key}`, pastel);
        // body color: slightly darker by multiplying channels
        const dark = (c) => Math.max(0, Math.min(255, Math.round(c * 0.88)));
        const { r: rr, g: gg, b: bb } = hexToRgb(hex);
        document.documentElement.style.setProperty(`--body-${key}`, `rgb(${dark(rr)}, ${dark(gg)}, ${dark(bb)})`);
    });

    // Starting color cycler: init to green and cycle through playerColors on click

    buildPlayerBoxes();
    // Make the player slider keyboard-accessible
    if (playerBoxSlider) {
        playerBoxSlider.setAttribute('role', 'slider');
        playerBoxSlider.setAttribute('aria-label', 'Player Count');
        playerBoxSlider.setAttribute('aria-valuemin', '2');
        playerBoxSlider.setAttribute('aria-valuemax', String(maxPlayers));
        if (!playerBoxSlider.hasAttribute('tabindex')) playerBoxSlider.tabIndex = 0;

        // Arrow/Home/End keys adjust the player count when the slider itself is focused
        playerBoxSlider.addEventListener('keydown', (e) => {
            const key = e.key;
            let handled = false;
            let newCount = menuPlayerCount;
            if (key === 'ArrowLeft' || key === 'a' || key === 'A') {
                newCount = clampPlayers(menuPlayerCount - 1); handled = true;
            }
            else if (key === 'ArrowRight' || key === 'd' || key === 'D') {
                newCount = clampPlayers(menuPlayerCount + 1); handled = true;
            }
            else if (key === 'Home') { newCount = 2; handled = true; }
            else if (key === 'End') { newCount = maxPlayers; handled = true; }
            if (handled) {
                e.preventDefault();
                onMenuPlayerCountChanged(newCount);
            }
        });
    }
    // highlight using initial URL or default
    const initialPlayersToShow = clampPlayers(playerCount);
    highlightPlayerBoxes(initialPlayersToShow);

    // Start with URL or defaults
    menuPlayerCount = clampPlayers(playerCount);
    updateSizeBoundsForPlayers(menuPlayerCount);

    // startingColorIndex declared earlier so it's available to builders below

    // No global dynamic style needed; element-scoped CSS vars control colors

    // Initialize and bind
    applyMenuColorBox(playerColors[startingColorIndex]);
    // Ensure the first box color matches the cycler initially
    updatePlayerBoxColors();
    // Set initial background to match current cycler while menu is open
    setMenuBodyColor();
    if (menuColorCycle) {
        menuColorCycle.tabIndex = 0; // focusable for accessibility
        // Load saved color cycler index from localStorage if available
        const savedColorIndex = localStorage.getItem('colorCyclerIndex');
        if (savedColorIndex !== null && !isNaN(savedColorIndex)) {
            startingColorIndex = Math.max(0, Math.min(playerColors.length - 1, parseInt(savedColorIndex, 10)));
            applyMenuColorBox(playerColors[startingColorIndex]);
            updatePlayerBoxColors();
            setMenuBodyColor();
        }
        menuColorCycle.addEventListener('click', () => {
            // Advance color and animate slider shift; if a previous animation is in-flight,
            // it will be finalized and a fresh animation will start.
            cycleStartingColor();
            const idx = startingColorIndex; // capture the intended mapping index for this animation
            previewShiftLeftThenSnap(() => applyPlayerBoxColorsForIndex(idx));
            updateAIPreview();
            // Save color cycler index to localStorage
            localStorage.setItem('colorCyclerIndex', startingColorIndex);
        });
    }

    // Online menu color cycler functionality (reuse main cycler logic)
    const onlineMenuColorCycle = document.getElementById('onlineMenuColorCycle');
    if (onlineMenuColorCycle) {
        onlineMenuColorCycle.tabIndex = 0;
        // Load saved color cycler index from localStorage if available
        const savedColorIndex = localStorage.getItem('colorCyclerIndex');
        if (savedColorIndex !== null && !isNaN(savedColorIndex)) {
            startingColorIndex = Math.max(0, Math.min(playerColors.length - 1, parseInt(savedColorIndex, 10)));
            applyMenuColorBox(playerColors[startingColorIndex]);
            updatePlayerBoxColors();
        } else {
            applyMenuColorBox(playerColors[startingColorIndex]);
        }
        const onlineMenu = document.getElementById('onlineMenu');
        onlineMenuColorCycle.addEventListener('click', () => {
            cycleStartingColor();
            const idx = startingColorIndex;
            previewShiftLeftThenSnap(() => applyPlayerBoxColorsForIndex(idx));
            updateAIPreview();
            // Save color cycler index to localStorage
            localStorage.setItem('colorCyclerIndex', startingColorIndex);
            // Change background color for online menu
            if (onlineMenu && !onlineMenu.classList.contains('hidden')) {
                const colorKey = playerColors[startingColorIndex] || 'green';
                document.body.className = colorKey;
            }
        });
    }

    // Handle browser navigation to toggle between menu and game instead of leaving the app
    window.addEventListener('popstate', applyStateFromUrl);

    // Make the visual box slider draggable like a real slider
    let isDragging = false;

    playerBoxSlider.addEventListener('pointerdown', (e) => {
        // Ignore pointer events that originate on the color cycler
        const target = e.target.closest('.menu-color-box');
        if (target) return;
        isDragging = true;
        playerBoxSlider.setPointerCapture(e.pointerId);
        setPlayerCountFromPointer(e.clientX);
    });

    playerBoxSlider.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        setPlayerCountFromPointer(e.clientX);
    });

    playerBoxSlider.addEventListener('pointerup', (e) => {
        isDragging = false;
    try { playerBoxSlider.releasePointerCapture(e.pointerId); } catch (e2) { /* empty */ void e2; }
    });

    // Also handle pointercancel/leave
    playerBoxSlider.addEventListener('pointercancel', () => { isDragging = false; });
    playerBoxSlider.addEventListener('pointerleave', (e) => { if (isDragging) setPlayerCountFromPointer(e.clientX); });

    // Input removed: no key handlers required

    // Stepper buttons for grid size
    function setAriaDisabledButton(btn, disabled) {
        if (!btn) return;
        // Always keep native disabled off so element stays focusable
        try { btn.disabled = false; } catch { /* ignore */ }
        if (disabled) {
            btn.setAttribute('aria-disabled', 'true');
        } else {
            btn.removeAttribute('aria-disabled');
        }
    }
    function reflectGridSizeDisplay() {
        if (gridValueEl) {
            gridValueEl.textContent = String(menuGridSizeVal);
        }
        // Keep buttons focusable but mark non-interactive via aria-disabled
        setAriaDisabledButton(gridDecBtn, menuGridSizeVal <= 3);
        setAriaDisabledButton(gridIncBtn, menuGridSizeVal >= 16);
    }

    function bumpValueAnimation() {
        if (!gridValueEl) return;
        gridValueEl.classList.remove('bump');
        // force reflow to restart animation
    void gridValueEl.offsetWidth;
        gridValueEl.classList.add('bump');
    }

    function adjustGridSize(delta) {
        let v = Number.isInteger(menuGridSizeVal) ? menuGridSizeVal : (3 + menuPlayerCount);
        v = Math.max(3, Math.min(16, v + delta));
        menuGridSizeVal = v;
        reflectGridSizeDisplay();
        bumpValueAnimation();
        if (v !== gridSize) recreateGrid(v, playerCount);
    }
    if (gridDecBtn) gridDecBtn.addEventListener('click', (e) => {
        if (gridDecBtn.getAttribute('aria-disabled') === 'true') { e.preventDefault(); e.stopPropagation(); return; }
        adjustGridSize(-1);
    });
    if (gridIncBtn) gridIncBtn.addEventListener('click', (e) => {
        if (gridIncBtn.getAttribute('aria-disabled') === 'true') { e.preventDefault(); e.stopPropagation(); return; }
        adjustGridSize(1);
    });

    // Make +/- controls operable via keyboard even if not native buttons
    function makeAccessibleButton(el) {
        if (!el) return;
        const isButton = el.tagName && el.tagName.toLowerCase() === 'button';
        if (!isButton) {
            el.setAttribute('role', 'button');
            if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
        }
    }
    makeAccessibleButton(gridDecBtn);
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
                const len = Math.sqrt(dx*dx + dy*dy);
                const dir = mappedKey === 'ArrowLeft' ? [-1,0] : mappedKey === 'ArrowRight' ? [1,0] : mappedKey === 'ArrowUp' ? [0,-1] : [0,1];
                const dot = (dx/len)*dir[0] + (dy/len)*dir[1];
                const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
                if (angle < minAngle) minAngle = angle;
                candidates.push({el, angle, len, ox, oy, tx, ty});
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
        } else if (mode === 'host') {
            // Host the room when clicking the start button in host mode
            hostRoom();
        } else if (mode === 'train') {
            await requestFullscreenIfMobile();
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.set('players', String(p));
            params.set('size', String(s));
            params.set('ai_depth', String(aiPreviewValue));
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.pushState({ mode: 'ai', players: p, size: s }, '', newUrl);
            gameColors = computeSelectedColors(p);
            if (mainMenu) mainMenu.classList.add('hidden');
            trainMode = true;
            try { aiDepth = Math.max(1, parseInt(String(aiPreviewValue), 10)); } catch { /* ignore */ }
            recreateGrid(s, p);
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
            params.set('ai_depth', String(aiPreviewValue));
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            // push a new history entry so Back returns to the menu instead of previous/blank
            window.history.pushState({ mode: 'ai', players: p, size: s }, '', newUrl);

            // Set the active game palette from the UI selection
            gameColors = computeSelectedColors(p);

            // Hide menu and start train mode immediately
            if (mainMenu) mainMenu.classList.add('hidden');
            trainMode = true;
            // Apply the chosen AI depth immediately for this session
            try { aiDepth = Math.max(1, parseInt(String(aiPreviewValue), 10)); } catch { /* ignore */ }
            recreateGrid(s, p);
        });
    }
//#endregion


//#region Menu Functions
    /**
     * Sync menu/game UI from current URL state (back/forward navigation handler).
     * @returns {void}
     */
    function applyStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const hasPS = params.has('players') || params.has('size');
        const showMenu = params.has('menu') || !hasPS;
        if (showMenu) {
    if (mainMenu) mainMenu.classList.remove('hidden');
            updateRandomTip();
            // When returning to the menu, reflect current chosen color on the background
            setMenuBodyColor();
            // Sync AI preview to URL parameter when showing menu
            const ad = parseInt(params.get('ai_depth') || '', 10);
            if (!Number.isNaN(ad) && ad >= 1) {
                aiPreviewValue = Math.max(1, Math.min(5, ad));
                updateAIPreview();
            }
            // Move keyboard focus to the slider for easy keyboard navigation
            try { (playerBoxSlider || menuColorCycle || startBtn)?.focus(); } catch { /* ignore */ }
            exitFullscreenIfPossible();
            return;
        }

        const p = clampPlayers(parseInt(params.get('players') || '', 10) || 2);
        let s = parseInt(params.get('size') || '', 10);
        if (!Number.isInteger(s)) s = Math.max(3, 3 + p);
    if (mainMenu) mainMenu.classList.add('hidden');
    // Enable train mode if any AI-related parameter exists in the URL
    trainMode = params.has('ai_depth') || params.has('ai_k');
        // Update AI depth from URL if provided
        const ad = parseInt(params.get('ai_depth') || '', 10);
        if (!Number.isNaN(ad) && ad >= 1) {
            try { aiDepth = Math.max(1, ad); } catch { /* ignore */ }
        }
        // Derive the active game palette from current cycler selection and requested player count
        gameColors = computeSelectedColors(p);
        recreateGrid(Math.max(3, s), p);
    }
    // Note: color cycler remains active during slider animations; no lock/disable needed.
    /**
     * Acquire a temporary animation lock for the slider and auto-release later.
     * @param {number} durationMs - expected animation duration in ms.
     * @returns {() => void} call to release early/explicitly.
     */
    function beginSliderAnimation(durationMs) {
        sliderAnimLocks++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            sliderAnimLocks = Math.max(0, sliderAnimLocks - 1);
        };
        if (durationMs && durationMs > 0) setTimeout(release, durationMs + 32);
        return release;
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

    // --- FLIP helpers for player slider boxes ---
    /**
     * Measure bounding client rects for a list of elements.
     * @param {Element[]} els - elements to measure.
     * @returns {DOMRect[]} list of rects.
     */
    function measureRects(els) {
        return els.map(el => el.getBoundingClientRect());
    }

    /**
     * Get computed background-color strings for elements.
     * @param {Element[]} els - elements to inspect.
     * @returns {string[]} CSS color strings.
     */
    function measureBackgroundColors(els) {
        return els.map(el => getComputedStyle(el).backgroundColor);
    }

    /**
     * Compute and cache the inactive/active box-shadow styles used by slider boxes.
     * @returns {{inactive:string, active:string}} cached shadow values.
     */
    function getSliderShadows() {
        if (sliderShadowCache) return sliderShadowCache;
        try {
            const probeContainer = document.createElement('div');
            probeContainer.className = 'player-box-slider';
            Object.assign(probeContainer.style, {
                position: 'fixed',
                left: '-10000px',
                top: '0',
                width: '0',
                height: '0',
                overflow: 'hidden'
            });
            const probe = document.createElement('div');
            probe.className = 'box';
            probe.style.width = '40px';
            probe.style.height = '40px';
            probeContainer.appendChild(probe);
            document.body.appendChild(probeContainer);

            const csInactive = getComputedStyle(probe).boxShadow;
            probe.classList.add('active');
            const csActive = getComputedStyle(probe).boxShadow;

            document.body.removeChild(probeContainer);
            sliderShadowCache = { inactive: csInactive, active: csActive };
            return sliderShadowCache;
        } catch (e) { void e;
            sliderShadowCache = { inactive: '0 4px 10px rgba(0,0,0,0.12)', active: '0 8px 20px rgba(0,0,0,0.18)' };
            return sliderShadowCache;
        }
    }

    /**
     * Infer the color key of a slider box from its inline CSS vars.
     * @param {HTMLElement} box - slider box element.
     * @returns {string|null} color key like 'green' or null on failure.
     */
    function extractColorKeyFromBox(box) {
        const innerVar = box.style.getPropertyValue('--box-inner');
        const cellVar = box.style.getPropertyValue('--box-cell');
        const from = innerVar || cellVar || '';
        const mInner = /--inner-([a-z]+)/i.exec(from);
        if (mInner && mInner[1]) return mInner[1].toLowerCase();
        const mCell = /--cell-([a-z]+)/i.exec(from);
        if (mCell && mCell[1]) return mCell[1].toLowerCase();
        return null;
    }

    /**
     * Perform a FLIP-like preview animation shifting boxes left, then snap and run mutateFn.
     * @param {() => void} mutateFn - called after animation to apply final state.
     * @returns {void}
     */
    function previewShiftLeftThenSnap(mutateFn) {
        // If a previous preview animation is running, snap it to end-state immediately
        // then proceed to start a new animation for this trigger.
        if (currentSliderPreview && typeof currentSliderPreview.finalizeNow === 'function' && !currentSliderPreview.finished) {
            try { currentSliderPreview.finalizeNow(); } catch { /* ignore */ }
        }

        const container = sliderCells || playerBoxSlider;
    if (!container) { mutateFn && mutateFn(); return; }
        const els = Array.from(container.querySelectorAll('.box'));
    if (els.length === 0) { mutateFn && mutateFn(); return; }

        const releaseLock = beginSliderAnimation(delayAnimation);

        const rects = measureRects(els);
        const colors = measureBackgroundColors(els);
        const animations = [];

        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            try { el.getAnimations().forEach(a => a.cancel()); } catch (e) { /* ignore */ void e; }
            const hasActive = el.classList.contains('active');
            const baseline = hasActive ? ' translateY(-18%) scale(1.06)' : '';
            const baseTransform = baseline ? baseline : 'none';

            if (i === 0) {
                const outBase = delayAnimation * 0.4;
                const outDur = outBase * 0.5;
                const inDur = delayAnimation - outDur;
                const fadeOut = el.animate(
                    [ { transform: baseTransform, opacity: 1 }, { transform: baseTransform, opacity: 0 } ],
                    { duration: outDur, easing: 'linear', fill: 'forwards' }
                );

                const n = els.length;
                const src0 = rects[0];
                const dstR = rects[n - 1];
                const srcCx = src0.left + src0.width / 2;
                const srcCy = src0.top + src0.height / 2;
                const rightCx = dstR.left + dstR.width / 2;
                const rightCy = dstR.top + dstR.height / 2;
                const startDx = (rightCx + dstR.width) - srcCx;
                const startDy = rightCy - srcCy;
                const endDx = rightCx - srcCx;
                const endDy = rightCy - srcCy;
                const sx = dstR.width / (src0.width || 1);
                const sy = dstR.height / (src0.height || 1);

                const slideIn = el.animate(
                    [
                        { transform: `translate(${startDx}px, ${startDy}px) scale(${sx}, ${sy})${baseline}`, opacity: 0 },
                        { transform: `translate(${endDx}px, ${endDy}px) scale(${sx}, ${sy})${baseline}`, opacity: 1 }
                    ],
                    { duration: inDur, delay: outDur, easing: 'cubic-bezier(0.05, 0.5, 0.5, 1)', fill: 'forwards' }
                );
                animations.push(fadeOut, slideIn);
                continue;
            }

            const src = rects[i];
            const dst = rects[i - 1];
            const srcCx = src.left + src.width / 2;
            const srcCy = src.top + src.height / 2;
            const dstCx = dst.left + dst.width / 2;
            const dstCy = dst.top + dst.height / 2;
            const dx = dstCx - srcCx;
            const dy = dstCy - srcCy;
            const sx = dst.width / (src.width || 1);
            const sy = dst.height / (src.height || 1);

            const anim = el.animate(
                [
                    { transform: baseTransform },
                    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})${baseline}` }
                ],
                { duration: delayAnimation, easing: 'cubic-bezier(0.5, 1, 0.75, 1)', fill: 'forwards' }
            );
            animations.push(anim);
        }

        const n = els.length;
        const rootStyle = getComputedStyle(document.documentElement);
        for (let i = 0; i < n; i++) {
            const el = els[i];
            const fromColor = colors[i];
            const leftIdx = (i - 1 + n) % n;
            const leftIsActive = els[leftIdx].classList.contains('active');
            const key = extractColorKeyFromBox(el);
            if (!key) continue;
            const varName = leftIsActive ? `--inner-${key}` : `--cell-${key}`;
            const toColor = rootStyle.getPropertyValue(varName).trim();
            if (!fromColor || !toColor || fromColor === toColor) continue;
            try {
                el.animate(
                    [ { backgroundColor: fromColor }, { backgroundColor: toColor } ],
                    { duration: delayAnimation, easing: 'ease', fill: 'none' }
                );
            } catch (e) { /* ignore */ void e; }
        }

        const shadows = getSliderShadows();
        for (let i = 0; i < n; i++) {
            const el = els[i];
            const fromShadow = getComputedStyle(el).boxShadow;
            const leftIdx = (i - 1 + n) % n;
            const leftIsActive = els[leftIdx].classList.contains('active');
            const toShadow = leftIsActive ? shadows.active : shadows.inactive;
            if (!fromShadow || !toShadow || fromShadow === toShadow) continue;
            try {
                el.animate(
                    [ { boxShadow: fromShadow }, { boxShadow: toShadow } ],
                    { duration: delayAnimation, easing: 'ease', fill: 'none' }
                );
            } catch (e) { /* ignore */ void e; }
        }

        const instance = { finished: false };

        // Expose a finalize function to instantly finish the current animation cycle
        instance.finalizeNow = () => {
            if (instance.finished) return;
            // Instantly clear any running animations and their transforms
            for (const el of els) {
                try {
                    el.getAnimations().forEach(a => { try { a.cancel(); } catch { /* ignore */ } });
                } catch { /* ignore */ }
            }
            try { mutateFn && mutateFn(); } catch { /* ignore */ }
            try { releaseLock && releaseLock(); } catch { /* ignore */ }
            instance.finished = true;
            if (currentSliderPreview === instance) currentSliderPreview = null;
        };

        currentSliderPreview = instance;

        const done = animations.length ? Promise.allSettled(animations.map(a => a.finished)) : Promise.resolve();
        done.finally(() => {
            if (instance.finished) return; // already finalized by a newer trigger
            for (const el of els) {
                try { el.getAnimations().forEach(a => a.cancel()); } catch (e) { /* ignore */ void e; }
            }
            mutateFn && mutateFn();
            releaseLock();
            instance.finished = true;
            if (currentSliderPreview === instance) currentSliderPreview = null;
        });
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
     * Apply current rotated color mapping to all player boxes via CSS vars.
     * @returns {void}
     */
    function updatePlayerBoxColors() {
        if (!playerBoxSlider) return;
        applyPlayerBoxColorsForIndex(startingColorIndex);
    }

    /**
     * Apply box color CSS vars as if the rotation index were a specific value.
     * @param {number} index - rotation index into playerColors used for mapping.
     * @returns {void}
     */
    function applyPlayerBoxColorsForIndex(index) {
        if (!playerBoxSlider) return;
        const boxes = Array.from((sliderCells || playerBoxSlider).querySelectorAll('.box'));
        const n = playerColors.length;
        boxes.forEach((box, idx) => {
            const colorKey = playerColors[(index + (idx % n) + n) % n];
            box.style.setProperty('--box-inner', `var(--inner-${colorKey})`);
            box.style.setProperty('--box-cell', `var(--cell-${colorKey})`);
        });
    }

    /**
     * Update the color cycler UI element to reflect the provided color key.
     * @param {string} colorKey - selected base color.
     * @returns {void}
     */
    function applyMenuColorBox(colorKey) {
        // Apply color to both main and online cyclers if present
        const cyclers = [
            document.getElementById('menuColorCycle'),
            document.getElementById('onlineMenuColorCycle')
        ].filter(Boolean);
        const outer = getComputedStyle(document.documentElement).getPropertyValue(`--cell-${colorKey}`) || '';
        const inner = getComputedStyle(document.documentElement).getPropertyValue(`--inner-${colorKey}`) || '';
        cyclers.forEach(cycler => {
            cycler.style.setProperty('--menu-outer-color', outer.trim());
            cycler.style.setProperty('--menu-inner-color', inner.trim());
        });
    }

    /**
     * Update the AI preview tile to show the next color after the current starting color.
     * Includes inner-circle coloring and a single centered value dot.
     * @returns {void}
     */
    function updateAIPreview() {
        if (!aiPreviewCell) return;
        const nextColor = playerColors[(startingColorIndex + 1) % playerColors.length];
        // apply cell background color via class
        aiPreviewCell.className = `cell ${nextColor}`;
        // ensure inner-circle exists and colored
        let inner = aiPreviewCell.querySelector('.inner-circle');
        if (!inner) {
            inner = document.createElement('div');
            inner.className = 'inner-circle';
            aiPreviewCell.appendChild(inner);
        }
        inner.className = `inner-circle ${nextColor}`;
        // show current preview value (1..5)
        try { updateValueCircles(inner, aiPreviewValue, false); } catch { /* ignore */ }
    }

    // Allow interacting with the preview cell to cycle its value 1→5 then wrap to 1
    function onAIPreviewClick() {
        aiPreviewValue = (aiPreviewValue % 5) + 1; // 1..5 loop
        const inner = aiPreviewCell && aiPreviewCell.querySelector('.inner-circle');
        if (inner) {
            try { updateValueCircles(inner, aiPreviewValue, false); } catch { /* ignore */ }
        }
    }
    if (aiPreviewCell) {
        aiPreviewCell.setAttribute('role', 'button');
        aiPreviewCell.tabIndex = 0;
        aiPreviewCell.addEventListener('click', onAIPreviewClick);
    }

    /**
     * While the menu is open, tint the page background to the current cycler color.
     * @returns {void}
     */
    function setMenuBodyColor() {
    if (!mainMenu || mainMenu.classList.contains('hidden')) return;
        const colorKey = playerColors[startingColorIndex] || 'green';
        document.body.className = colorKey;
    }

    /**
     * Advance the starting color cycler by one and update dependent UI.
     * @returns {void}
     */
    function cycleStartingColor() {
        startingColorIndex = (startingColorIndex + 1) % playerColors.length;
        applyMenuColorBox(playerColors[startingColorIndex]);
        setMenuBodyColor();
    }

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
     * Mix a hex color with white to produce a pastel RGB color.
     * @param {string} hex - base hex color.
     * @param {number} [factor=0.5] - portion of white (0..1).
     * @returns {string} css rgb(r,g,b) color string.
     */
    function mixWithWhite(hex, factor = 0.5) {
        // factor = portion of white (0..1)
        const { r, g, b } = hexToRgb(hex);
        const mix = (c) => Math.round((1 - factor) * c + factor * 255);
        return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
    }

    /**
     * Build the visual player "box slider" (1..maxPlayers) and attach handlers.
     * @returns {void} updates DOM under #playerBoxSlider.
     */
    function buildPlayerBoxes() {
        // Preserve the color cycler if it's inside the slider
    const cycler = playerBoxSlider.querySelector('#menuColorCycle');
        if (cycler && cycler.parentElement === playerBoxSlider) {
            playerBoxSlider.removeChild(cycler);
        }

    // Remove existing player boxes only
    Array.from((sliderCells || playerBoxSlider).querySelectorAll('.box')).forEach(n => n.remove());

        for (let count = 1; count <= maxPlayers; count++) {
            const box = document.createElement('div');
            box.className = 'box';
            box.dataset.count = String(count); // the player count this box represents
            box.title = `${count} player${count > 1 ? 's' : ''}`;
            const colorKey = playerColors[(startingColorIndex + count - 1) % playerColors.length];
            // set per-box CSS variables pointing to the global color vars
            box.style.setProperty('--box-inner', `var(--inner-${colorKey})`);
            box.style.setProperty('--box-cell', `var(--cell-${colorKey})`);

            box.addEventListener('click', () => {
                // clamp to minimum 2
                const raw = parseInt(box.dataset.count, 10);
                const val = Math.max(2, clampPlayers(raw));
                onMenuPlayerCountChanged(val);
            });

            // Disable native dragging/selection that can interfere with pointer interactions
            box.setAttribute('draggable', 'false');
            box.addEventListener('dragstart', (ev) => ev.preventDefault());

            (sliderCells || playerBoxSlider).appendChild(box);
        }

        // Re-append the cycler; CSS grid places it to row 2, col 1
    if (cycler) playerBoxSlider.appendChild(cycler);
    }

    /**
     * Toggle active state for player boxes up to the selected count and sync UI/state.
     * @param {number} count - selected player count.
     * @returns {void} updates aria attributes, internal selection, and grid if needed.
     */
    function highlightPlayerBoxes(count) {
    (sliderCells || playerBoxSlider).querySelectorAll('.box').forEach((child) => {
            const boxCount = parseInt(child.dataset.count, 10);
            if (boxCount <= count) child.classList.add('active'); else child.classList.remove('active');
        });
        playerBoxSlider.setAttribute('aria-valuenow', String(count));
        // update internal selection
        menuPlayerCount = count;

    // Sizing/alignment handled purely via CSS

        if (count !== playerCount) {
            const desiredSize = Math.max(3, count + 3);
            recreateGrid(desiredSize, count);
        }
    }

    /**
     * Update grid-size input to match the recommended size for a player count.
     * @param {number} pCount - selected player count.
     * @returns {void} sets menuGridSize.value.
     */
    function updateSizeBoundsForPlayers(pCount) {
        const desired = Math.max(3, pCount + 3);
        menuGridSizeVal = desired;
        reflectGridSizeDisplay();
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
     * Validate and normalize the grid size input to [3..16].
     * @returns {void} adjusts input to a valid number.
     */
    // Input removed: grid size is controlled via +/- and reflected in menuGridSizeVal

    /**
     * Map a pointer x-position to the nearest player box and update selection.
     * @param {number} clientX - pointer x-coordinate in viewport space.
     * @returns {void} updates selected player count via onMenuPlayerCountChanged.
     */
    function setPlayerCountFromPointer(clientX) {
    // Only consider player boxes for mapping, skip the color cycler
    const children = Array.from((sliderCells || playerBoxSlider).querySelectorAll('.box'));
        if (children.length === 0) return;
        // find nearest box center to clientX
        let nearest = children[0];
        let nearestDist = Infinity;
        children.forEach(child => {
            const r = child.getBoundingClientRect();
            const center = r.left + r.width / 2;
            const d = Math.abs(clientX - center);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = child;
            }
        });
        // clamp to minimum 2
        const mapped = Math.max(2, clampPlayers(parseInt(nearest.dataset.count, 10)));
        onMenuPlayerCountChanged(mapped);
    }

    /**
     * Central handler when menu player count changes; syncs size, UI, and grid.
     * @param {number} newCount - selected player count.
     * @returns {void} may recreate the grid to reflect new settings.
     */
    function onMenuPlayerCountChanged(newCount) {
        menuPlayerCount = newCount;
        const desiredSize = Math.max(3, newCount + 3);
    // reflect desired size in display state and animate bump when it changes via player slider
    const prevSize = Number.isInteger(menuGridSizeVal) ? menuGridSizeVal : null;
    menuGridSizeVal = desiredSize;
    if (gridValueEl) gridValueEl.textContent = String(desiredSize);
    if (prevSize === null || desiredSize !== prevSize) {
        bumpValueAnimation();
    }
        updateSizeBoundsForPlayers(newCount);
        // Direct slider interaction: immediately reflect active boxes without FLIP animation
        // (keeps original behavior of activating the nearest box and all to its left)
        highlightPlayerBoxes(newCount);

    // Sizing/alignment handled purely via CSS

        if (newCount !== playerCount || desiredSize !== gridSize) {
            recreateGrid(desiredSize, newCount);
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

    // Train mode globals
    let trainMode = isTrainMode;
    const humanPlayer = 0; // first selected color is player index 0

    // create initial grid
    recreateGrid(gridSize, playerCount);
    // Initialize AI preview after initial color application
    updateAIPreview();

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
                'ArrowLeft':  { vx: -1, vy: 0 },
                'ArrowRight': { vx: 1, vy: 0 },
                'ArrowUp':    { vx: 0, vy: -1 },
                'ArrowDown':  { vx: 0, vy: 1 }
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
                const len = Math.sqrt(dx*dx + dy*dy);
                const dot = (dx/len)*vx + (dy/len)*vy;
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

        // Reflect actual grid size in display value while menu is present
        menuGridSizeVal = Math.max(3, newSize);
        reflectGridSizeDisplay();

        // Ensure the visual player boxes reflect new player count
        highlightPlayerBoxes(clampPlayers(playerCount));

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

    /**
     * Advance to the next active player and update body color; trigger AI in train mode.
     * @returns {void} updates currentPlayer and grid visuals.
     */
    function switchPlayer() {
        do {
            currentPlayer = (currentPlayer + 1) % playerCount;
        } while (!hasCells(currentPlayer) && initialPlacements.every(placement => placement));

        document.body.className = activeColors()[currentPlayer];
        clearCellFocus();
        updateGrid();
        // Restore focus to last focused cell for this player, if any
        restorePlayerFocus();
        // If in train mode, possibly trigger AI move for non-human players
        maybeTriggerAIMove();
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
        if (activePlayers === 1) {
            gameWon = true;
            if (menuShownAfterWin) return; // schedule only once
            menuShownAfterWin = true;
            setTimeout(() => {
                if (!gameWon) return;
                // First, stop the chain; then immediately open the menu (no extra delay)
                stopExplosionLoop();
                // Clear focus from any grid cell before showing the menu
                clearCellFocus();
                // Open the menu by adding menu=true to the URL
                const urlParams = new URLSearchParams(window.location.search);
                urlParams.set('menu', 'true');
                const newUrl = `${window.location.pathname}?${urlParams.toString()}${window.location.hash || ''}`;
                // Update the URL without reloading the page
                window.history.replaceState(null, '', newUrl);
                // Show the menu overlay
                if (mainMenu) mainMenu.classList.remove('hidden');
                updateRandomTip();
                // When showing the menu, exit fullscreen to restore browser UI if needed
                exitFullscreenIfPossible();
            }, delayGameEnd); //DELAY Game End
        }
    }
//#endregion


//#region Training / AI helpers (dataRespect + debug)
    // AI debug mode
    const aiDebug = true;
    // Configure dataRespect branching factor K via URL param ai_k, default 3
    const dataRespectK = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_k')) || 25);
    // number of plies (AI-perspective). Example: 3 (AI -> opp -> AI)
    let aiDepth = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_depth')) || 4);
    const maxExplosionsToAssumeLoop = gridSize * 3;


    /**
     * In train mode, trigger AI move if it's currently an AI player's turn.
     * @returns {void} may schedule aiMakeMoveFor with a short delay.
     */
    function maybeTriggerAIMove() {
        if (!trainMode) return;
        if (gameWon || isProcessing) return;
        if (currentPlayer === humanPlayer) return;
        // If the menu is open/visible, do not run AI moves
    if (mainMenu && !mainMenu.classList.contains('hidden')) return;

        setTimeout(() => {
            if (isProcessing || gameWon || currentPlayer === humanPlayer) return;
            if (mainMenu && !mainMenu.classList.contains('hidden')) return;
            aiMakeMoveFor(currentPlayer);
        }, 350);
    }

    /**
     * Deep-copy a simulated grid structure to avoid mutation across branches.
     * @param {Array<Array<{value:number,player:string}>>} simGrid - the grid to copy.
     * @returns {Array<Array<{value:number,player:string}>>} same-shaped deep copy of simGrid.
     */
    function deepCloneGrid(simGrid) {
        const out = [];
        for (let r = 0; r < gridSize; r++) {
            out[r] = [];
            for (let c = 0; c < gridSize; c++) {
                out[r][c] = { value: simGrid[r][c].value, player: simGrid[r][c].player };
            }
        }
        return out;
    }

    /**
     * Evaluate a grid by summing values of cells owned by a given player.
     * @param {Array<Array<{value:number,player:string}>>} simGrid - the grid to evaluate.
     * @param {number} playerIndex - player index.
     * @returns {number} total owned cell value of given player.
     */
    function totalOwnedOnGrid(simGrid, playerIndex) {
        let total = 0;
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                if (simGrid[r][c].player === activeColors()[playerIndex]) total += simGrid[r][c].value;
            }
        }
        return total;
    }

    /**
     * Run explosion propagation on a simulated grid until stable or runaway detected.
     * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
     * @param {boolean[]} simInitialPlacements - initial placement flags.
     * @returns {{grid: Array<Array<{value:number,player:string}>>, explosionCount: number, runaway: boolean}} updated grid, number of explosions, runaway flag.
     */
    function simulateExplosions(simGrid, simInitialPlacements) {
        const maxCellValueLocal = maxCellValue;
        let explosionCount = 0;
        let iteration = 0;

        while (true) {
            iteration++;
            if (iteration > maxExplosionsToAssumeLoop) {
                // runaway detected
                return { grid: simGrid, explosionCount, runaway: true };
            }

            const cellsToExplode = [];
            for (let i = 0; i < gridSize; i++) {
                for (let j = 0; j < gridSize; j++) {
                    if (simGrid[i][j].value >= 4) {
                        cellsToExplode.push({
                            row: i,
                            col: j,
                            player: simGrid[i][j].player,
                            value: simGrid[i][j].value
                        });
                    }
                }
            }

            if (cellsToExplode.length === 0) break;
            explosionCount += cellsToExplode.length;

            for (const cell of cellsToExplode) {
                const { row, col, player, value } = cell;
                const explosionValue = value - 3;
                simGrid[row][col].value = 0;

                const isInitialPlacement = !simInitialPlacements.every(v => v);
                let extraBackToOrigin = 0;
                const targets = [];

                if (row > 0) targets.push({ r: row - 1, c: col });
                else if (isInitialPlacement) extraBackToOrigin++;

                if (row < gridSize - 1) targets.push({ r: row + 1, c: col });
                else if (isInitialPlacement) extraBackToOrigin++;

                if (col > 0) targets.push({ r: row, c: col - 1 });
                else if (isInitialPlacement) extraBackToOrigin++;

                if (col < gridSize - 1) targets.push({ r: row, c: col + 1 });
                else if (isInitialPlacement) extraBackToOrigin++;

                // Apply explosionValue to targets
                for (const t of targets) {
                    const prev = simGrid[t.r][t.c].value;
                    simGrid[t.r][t.c].value = Math.min(maxCellValueLocal, prev + explosionValue);
                    simGrid[t.r][t.c].player = player;
                }

                // edge return fragments during initial-placement phase
                if (extraBackToOrigin > 0 && isInitialPlacement) {
                    const prev = simGrid[row][col].value;
                    simGrid[row][col].value = Math.min(maxCellValueLocal, prev + extraBackToOrigin);
                    simGrid[row][col].player = player;
                }
            }
        }

        return { grid: simGrid, explosionCount, runaway: false };
    }

    /**
     * Validate simulated initial placement using current size and simulated occupancy.
     * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
     * @param {number} row - cell row.
     * @param {number} col - cell column.
     * @returns {boolean} true if invalid due to center or adjacency.
     */
    function isInitialPlacementInvalidOnSim(simGrid, row, col) {
        // respect the global static invalid center positions
        if (invalidInitialPositions.some(pos => pos.r === row && pos.c === col)) {
            return true;
        }

        // adjacency rule: illegal if any adjacent cell is already occupied in the simulated grid
        const adjacentPositions = [
            { r: row - 1, c: col },
            { r: row + 1, c: col },
            { r: row, c: col - 1 },
            { r: row, c: col + 1 }
        ];

        return adjacentPositions.some(pos =>
            pos.r >= 0 && pos.r < gridSize && pos.c >= 0 && pos.c < gridSize &&
            simGrid[pos.r][pos.c].player !== ''
        );
    }

    /**
     * Generate legal moves (initial or increment) for a player on a sim grid.
     * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
     * @param {boolean[]} simInitialPlacements - initial placement flags.
     * @param {number} playerIndex - player index.
     * @returns {Array<{r:number,c:number,isInitial:boolean,srcVal:number,sortKey:number}>} candidate moves annotated for ordering.
     */
    function generateCandidatesOnSim(simGrid, simInitialPlacements, playerIndex) {
        const candidates = [];
        if (!simInitialPlacements[playerIndex]) {
            for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
                    // use simulation-aware invalid check here
                    if (simGrid[r][c].value === 0 && !isInitialPlacementInvalidOnSim(simGrid, r, c)) {
                        candidates.push({ r, c, isInitial: true, srcVal: 0, sortKey: 0 });
                    }
                }
            }
        } else {
            for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
                    if (simGrid[r][c].player === activeColors()[playerIndex]) {
                        const key = Math.max(0, Math.min(3, simGrid[r][c].value));
                        candidates.push({ r, c, isInitial: false, srcVal: simGrid[r][c].value, sortKey: key });
                    }
                }
            }
        }
        return candidates;
    }

    /**
     * Coalition helper: union of all non-focus players' legal moves, each tagged with owner.
     * @param {Array<Array<{value:number,player:string}>>} simGrid - simulated grid.
     * @param {boolean[]} simInitialPlacements - initial placement flags per player.
     * @param {number} focusPlayerIndex - player index for whom coalition is formed.
     * @returns {Array<{r:number,c:number,isInitial:boolean,srcVal:number,sortKey:number,owner:number}>} candidates.
     */
    function generateCoalitionCandidatesOnSim(simGrid, simInitialPlacements, focusPlayerIndex) {
        const out = [];
        for (let idx = 0; idx < playerCount; idx++) {
            if (idx === focusPlayerIndex) continue;
            const moves = generateCandidatesOnSim(simGrid, simInitialPlacements, idx);
            for (const m of moves) out.push({ ...m, owner: idx });
        }
        return out;
    }

    /**
     * Inject debug CSS styles used by AI visualization if not already present.
     * @returns {void}
     */
    function ensureAIDebugStyles() {
        if (document.getElementById('aiDebugStyles')) return;
        const style = document.createElement('style');
        style.id = 'aiDebugStyles';
        style.textContent = `
            .ai-highlight {
                outline: 4px solid rgba(255, 235, 59, 0.95) !important;
                box-shadow: 0 0 18px rgba(255,235,59,0.6);
                z-index: 50;
            }
            #aiDebugPanel {
                position: fixed;
                right: 12px;
                bottom: 12px;
                background: rgba(18,18,18,0.88);
                color: #eaeaea;
                padding: 10px 12px;
                font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
                font-size: 13px;
                border-radius: 8px;
                box-shadow: 0 6px 18px rgba(0,0,0,0.45);
                max-width: 420px;
                z-index: 1000;
            }
            #aiDebugPanel h4 { margin: 0 0 6px 0; font-size: 13px; }
            #aiDebugPanel pre { margin: 6px 0 0 0; white-space: pre-wrap; font-family: monospace; font-size: 12px; max-height: 240px; overflow:auto; }
        `;
        document.head.appendChild(style);
    }

    /**
     * Render an AI debug panel summarizing chosen move and ordered candidates.
     * @param {object} info - contains chosen move and ordered candidates meta.
     * @returns {void} updates/creates a floating panel in the DOM.
     */
    function showAIDebugPanelWithResponse(info) {
        ensureAIDebugStyles();
        const existing = document.getElementById('aiDebugPanel');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'aiDebugPanel';

        const title = document.createElement('h4');
    title.textContent = `AI dataRespect — player ${currentPlayer} (${activeColors()[currentPlayer]})`;
        panel.appendChild(title);

        const summary = document.createElement('div');
        summary.innerHTML = `<strong>chosen gain:</strong> ${info.chosen ? info.chosen.gain : '—'} &nbsp; <strong>expl:</strong> ${info.chosen ? info.chosen.expl : '—'}`;
        panel.appendChild(summary);
        const listTitle = document.createElement('div');
        listTitle.style.marginTop = '8px';
        listTitle.innerHTML = `<em>candidates (top ${info.topK}) ordered by AI gain:</em>`;
        panel.appendChild(listTitle);

        const pre = document.createElement('pre');
        pre.textContent = info.ordered.map((e, idx) => {
            return `${idx + 1}. (${e.r},${e.c}) src:${e.src} ` +
                `expl:${e.expl} gain:${e.gain} ` +
                `atk:${e.atk} def:${e.def}`;
        }).join('\n');
        panel.appendChild(pre);

        document.body.appendChild(panel);
    }

    /**
     * Remove AI debug UI components and any highlighted cells.
     * @returns {void}
     */
    function clearAIDebugUI() {
        const existing = document.getElementById('aiDebugPanel');
        if (existing) existing.remove();
        document.querySelectorAll('.ai-highlight').forEach(el => el.classList.remove('ai-highlight'));

    }

    /**
     * Apply a move on a cloned grid (initial or increment) and simulate explosions.
     * @param {Array<Array<{value:number,player:string}>>} simGridInput - input simulated grid.
     * @param {boolean[]} simInitialPlacementsInput - initial placement flags.
     * @param {number} moverIndex - player making the move.
     * @param {number} moveR - move row.
     * @param {number} moveC - move column.
     * @param {boolean} isInitialMove - whether it's an initial placement.
     * @returns {{grid: Array<Array<{value:number,player:string}>>, explosionCount: number, runaway: boolean, simInitial: boolean[]}} post-move state.
     */
    function applyMoveAndSim(simGridInput, simInitialPlacementsInput, moverIndex, moveR, moveC, isInitialMove) {
        const simGrid = deepCloneGrid(simGridInput);
        const simInitial = simInitialPlacementsInput.slice();

        if (isInitialMove) simInitial[moverIndex] = true;

        if (isInitialMove) {
            simGrid[moveR][moveC].value = initialPlacementValue;
            simGrid[moveR][moveC].player = activeColors()[moverIndex];
        } else {
            const prev = simGrid[moveR][moveC].value;
            simGrid[moveR][moveC].value = Math.min(maxCellValue, prev + 1);
            simGrid[moveR][moveC].player = activeColors()[moverIndex];
        }

        const result = simulateExplosions(simGrid, simInitial);
        return { grid: result.grid, explosionCount: result.explosionCount, runaway: result.runaway, simInitial };
    }

    /**
     * Evaluate future plies using minimax with alpha-beta pruning for a focus player.
     * @param {Array<Array<{value:number,player:string}>>} simGridInput - simulated grid.
     * @param {boolean[]} simInitialPlacementsInput - initial placement flags.
     * @param {number} moverIndex - current mover.
     * @param {number} depth - search depth.
     * @param {number} alpha - alpha value.
     * @param {number} beta - beta value.
     * @param {number} maximizingPlayerIndex - maximizing player.
     * @param {number} focusPlayerIndex - player to evaluate for.
     * @returns {{value:number, runaway:boolean, stepsToInfinity?:number}} evaluation score for focus player and plies to +/-Infinity if detected.
     */
    function minimaxEvaluate(simGridInput, simInitialPlacementsInput, moverIndex, depth, alpha, beta, maximizingPlayerIndex, focusPlayerIndex) {
        // Coalition mode always ON: all non-focus players act as a single minimizing opponent.

        // Terminal checks: detect actual game-over (only one player has any cells)
        // IMPORTANT: Do NOT consider this a terminal state during the initial placement phase,
        // because early in the game the current mover may be the only player with any cells
        // simply due to others not having placed yet. That would falsely yield +/-Infinity.
        const inInitialPlacementPhase = !simInitialPlacementsInput.every(v => v);
        if (!inInitialPlacementPhase) {
            // Count owned cells per player; if exactly one player owns >0 cells, game is over.
            let hasAnyCells = false;
            let activePlayers = 0;
            let solePlayerIdx = -1;
            for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
                    const owner = simGridInput[r][c].player;
                    if (owner !== '') {
                        hasAnyCells = true;
                        const idx = activeColors().indexOf(owner);
                        if (idx !== -1) {
                            if (solePlayerIdx === -1) {
                                solePlayerIdx = idx;
                                activePlayers = 1;
                            } else if (idx !== solePlayerIdx) {
                                activePlayers = 2; // we can early exit once >1
                                r = gridSize; // break outer loops
                                break;
                            }
                        }
                    }
                }
            }
            if (hasAnyCells && activePlayers === 1) {
                // Terminal: if the sole active player is the focus, it's a win, else a loss.
                if (solePlayerIdx === focusPlayerIndex) {
                    return { value: Infinity, runaway: true, stepsToInfinity: 0 };
                } else {
                    return { value: -Infinity, runaway: true, stepsToInfinity: 0 };
                }
            }
        }

        // Depth terminal: evaluate static score if depth exhausted
        if (depth === 0) {
            return { value: totalOwnedOnGrid(simGridInput, focusPlayerIndex), runaway: false };
        }

        const simGrid = deepCloneGrid(simGridInput);
        const simInitial = simInitialPlacementsInput.slice();

        const isFocusTurn = (moverIndex === focusPlayerIndex);

        // Generate candidates: focus player's legal moves, or coalition union of all opponents
        let candidates;
        if (isFocusTurn) {
            candidates = generateCandidatesOnSim(simGrid, simInitial, focusPlayerIndex).map(c => ({ ...c, owner: focusPlayerIndex }));
        } else {
            candidates = generateCoalitionCandidatesOnSim(simGrid, simInitial, focusPlayerIndex);
        }

        // If no legal move: pass turn (toggle sides) and consume a ply
        if (candidates.length === 0) {
            const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
            return minimaxEvaluate(simGrid, simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex);
        }

        // Evaluate immediate outcomes for ordering and branch truncation
        const evaluatedCandidates = [];
        for (const cand of candidates) {
            const owner = cand.owner; // must be a real player index
            const applied = applyMoveAndSim(grid, initialPlacements, owner, cand.r, cand.c, cand.isInitial);
            const val = totalOwnedOnGrid(applied.grid, focusPlayerIndex);

            if (applied.runaway) {
                const runawayVal = (owner === focusPlayerIndex) ? Infinity : -Infinity;
                evaluatedCandidates.push({ cand, owner, value: runawayVal, resultGrid: applied.grid, simInitial: applied.simInitial });
            } else {
                evaluatedCandidates.push({ cand, owner, value: val, resultGrid: applied.grid, simInitial: applied.simInitial });
            }
        }

        // Order: maximizing for focus turn, minimizing for coalition turn
        evaluatedCandidates.sort((a, b) => ( isFocusTurn ? (b.value - a.value) : (a.value - b.value) ));

        // Truncate to top K to limit branching
        const topCandidates = evaluatedCandidates.slice(0, Math.min(dataRespectK, evaluatedCandidates.length));

        const nextMover = isFocusTurn ? -1 : focusPlayerIndex;
        let bestValue = isFocusTurn ? -Infinity : Infinity;
        let bestSteps = undefined;

        for (const entry of topCandidates) {
            // Immediate runaway short-circuit
            if (entry.value === Infinity) {
                if (isFocusTurn) return { value: Infinity, runaway: true, stepsToInfinity: 1 };
                else return { value: -Infinity, runaway: true, stepsToInfinity: 1 };
            }
            if (entry.value === -Infinity) {
                if (!isFocusTurn) return { value: -Infinity, runaway: true, stepsToInfinity: 1 };
                else return { value: Infinity, runaway: true, stepsToInfinity: 1 };
            }

            // Recurse on child node (toggle sides)
            const childEval = minimaxEvaluate(entry.resultGrid, entry.simInitial, nextMover, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex);
            const value = childEval.value;
            const childSteps = typeof childEval.stepsToInfinity === 'number' ? childEval.stepsToInfinity + 1 : undefined;

            if (isFocusTurn) {
                // maximizing: prefer larger value; if both Infinity, prefer fewer steps
                if (value > bestValue || (value === bestValue && value === Infinity && (bestSteps === undefined || (typeof childSteps === 'number' && childSteps < bestSteps)))) {
                    bestValue = value;
                    bestSteps = childSteps;
                }
                alpha = Math.max(alpha, bestValue);
                if (alpha >= beta) break; // beta cut-off
            } else {
                // minimizing: prefer smaller value; if both Infinity (forced), prefer more steps (delay)
                if (value < bestValue || (value === bestValue && value === Infinity && (bestSteps === undefined || (typeof childSteps === 'number' && childSteps > bestSteps)))) {
                    bestValue = value;
                    bestSteps = childSteps;
                }
                beta = Math.min(beta, bestValue);
                if (beta <= alpha) break; // alpha cut-off
            }
        }

        const isInf = (bestValue === Infinity || bestValue === -Infinity);
        return { value: bestValue, runaway: isInf, stepsToInfinity: isInf ? bestSteps : undefined };
    }

    /**
     * Choose and execute an AI move for the given player using heuristic + search.
     *
    * Selection criteria (in order):
    * - If any candidate yields +Infinity (guaranteed win chain OR detected terminal state \(AI captures all opponent cells\)),
    *   ignore atk/def and pick the move with the smallest plies-to-win (fastest finish). If multiple, pick randomly among them.
     * - Otherwise, Main: netResult for each candidate, where netResult uses deep-search `searchScore` if available
     *   (minimax up to `aiDepth`, relative to current total) or falls back to `immediateGain`.
     * - Tiebreaker 1: higher atk (AI cells next to weaker enemy cells).
     * - Tiebreaker 2: higher def (AI cells one away from exploding).
     * - Final: random among exact ties.
     *
    * @param {number} playerIndex - AI player index in activeColors.
     * @returns {void} either performs a move (handleClick) or advances turn.
     */
    function aiMakeMoveFor(playerIndex) {
        if (isProcessing || gameWon) return;

        const candidates = generateCandidatesOnSim(grid, initialPlacements, playerIndex);
        if (candidates.length === 0) {
            if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true;
            switchPlayer();
            return;
        }

        // Evaluate immediate result grids first (as before) to get candidate.resultGrid
        const evaluated = [];
        for (const cand of candidates) {
            const res = applyMoveAndSim(grid, initialPlacements, playerIndex, cand.r, cand.c, cand.isInitial);
            evaluated.push({
                r: cand.r,
                c: cand.c,
                isInitial: cand.isInitial,
                srcVal: cand.srcVal,
                // If simulation runaways are detected for this immediate result, treat as overwhelmingly good for the mover.
                immediateGain: (res.runaway ? Infinity : (totalOwnedOnGrid(res.grid, playerIndex) - totalOwnedOnGrid(grid, playerIndex))),
                explosions: res.explosionCount,
                resultGrid: res.grid,
                resultInitial: res.simInitial,
                runaway: res.runaway
            });
        }

        // Sort and pick topK by immediateGain descending
        evaluated.sort((a, b) => b.immediateGain - a.immediateGain || b.explosions - a.explosions);
        const topK = evaluated.slice(0, Math.min(dataRespectK, evaluated.length));

        // For each topK entry, run minimaxEvaluate to depth aiDepth (this returns absolute totalOwned estimate)
        for (const cand of topK) {
            // If immediate result already runaway, we can set searchScore immediately
            if (cand.runaway) {
                cand.searchScore = (cand.immediateGain === Infinity) ? Infinity : -Infinity;
                if (cand.searchScore === Infinity) cand.winPlies = 1;
            } else {
                // Start recursion with coalition opponent as next mover; use aiDepth as plies
                const nextMover = -1; // coalition pseudo-player
                const depth = aiDepth; // number of plies to look ahead
                const evalRes = minimaxEvaluate(cand.resultGrid, cand.resultInitial, nextMover, depth - 1, -Infinity, Infinity, playerIndex, playerIndex);
                // minimaxEvaluate returns absolute totalOwned for focus; convert to gain relative to current
                const before = totalOwnedOnGrid(grid, playerIndex);
                cand.searchScore = (evalRes.value === Infinity || evalRes.value === -Infinity) ? evalRes.value : (evalRes.value - before);
                if (evalRes.value === Infinity && typeof evalRes.stepsToInfinity === 'number') {
                    cand.winPlies = evalRes.stepsToInfinity;
                }
            }
        }

        // Fast path: if any +Infinity candidate exists, choose the fastest win and skip atk/def tiebreakers
        const winning = topK.filter(c => c.searchScore === Infinity);
        if (winning.length > 0) {
            const minPlies = Math.min(...winning.map(c => (typeof c.winPlies === 'number' ? c.winPlies : Number.POSITIVE_INFINITY)));
            const fastest = winning.filter(c => (typeof c.winPlies === 'number' ? c.winPlies : Number.POSITIVE_INFINITY) === minPlies);
            const chosenFast = fastest.length ? fastest[Math.floor(Math.random() * fastest.length)] : winning[0];

            if (aiDebug) {
                clearAIDebugUI();
                if (chosenFast) {
                    const aiCell = document.querySelector(`.cell[data-row="${chosenFast.r}"][data-col="${chosenFast.c}"]`);
                    if (aiCell) aiCell.classList.add('ai-highlight');
                }
                const info = {
                    chosen: chosenFast ? {
                        r: chosenFast.r,
                        c: chosenFast.c,
                        src: chosenFast.srcVal,
                        expl: chosenFast.explosions,
                        gain: chosenFast.searchScore,
                        atk: chosenFast.atk,
                        def: chosenFast.def,
                        winPlies: chosenFast.winPlies
                    } : null,
                    ordered: winning.map(c => ({ r: c.r, c: c.c, src: c.srcVal, expl: c.explosions, gain: c.searchScore, atk: c.atk, def: c.def, winPlies: c.winPlies })),
                    topK: winning.length
                };
                showAIDebugPanelWithResponse(info);

                if (chosenFast) {
                    const onUserConfirm = (ev) => {
                        // Accept pointerdown or Enter/Space keydown
                        if (ev.type === 'pointerdown' || (ev.type === 'keydown' && (ev.key === 'Enter' || ev.key === ' '))) {
                            ev.stopPropagation();
                            ev.preventDefault();
                            document.removeEventListener('pointerdown', onUserConfirm, true);
                            document.removeEventListener('keydown', onUserConfirm, true);
                            clearAIDebugUI();
                            handleClick(chosenFast.r, chosenFast.c);
                        }
                    };
                    document.addEventListener('pointerdown', onUserConfirm, true);
                    document.addEventListener('keydown', onUserConfirm, true);
                } else {
                    if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true;
                    switchPlayer();
                }
                return;
            }

            if (!chosenFast) {
                if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true;
                switchPlayer();
            } else {
                handleClick(chosenFast.r, chosenFast.c);
            }
            return;
        }

        // Use searchScore in place of immediate gain when computing netResult and ordering
        // Compute atk/def for topK as before on each e.resultGrid
        for (const cand of topK) {
            const rg = cand.resultGrid;
            const aiColor = activeColors()[playerIndex];
            const playerColor = activeColors()[humanPlayer];
            const nearVal = cellExplodeThreshold - 1;
            let def = 0, atk = 0;
            for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
                    const cell = rg[r][c];
                    if (cell.player === aiColor) {
                        if (cell.value === nearVal) def++;
                        const adj = [[r-1,c],[r+1,c],[r,c-1],[r,c+1]];
                        for (const [ar,ac] of adj) {
                            if (ar<0||ar>=gridSize||ac<0||ac>=gridSize) continue;
                            const adjCell = rg[ar][ac];
                            if (adjCell.player === playerColor && cell.value > adjCell.value) atk++;
                        }
                    }
                }
            }
            cand.def = def;
            cand.atk = atk;
            cand.netResult = (typeof cand.searchScore === 'number' ? cand.searchScore : cand.immediateGain) + (typeof cand.worstResponseAIChange === 'number' ? cand.worstResponseAIChange : 0);
        }

        // Continue with the same selection logic as before but prefer searchScore/netResult instead of immediateGain
        topK.sort((a, b) =>
            (b.netResult - a.netResult) ||
            (b.atk - a.atk) ||
            (b.def - a.def)
        );

        // select bestMoves as original logic
        const bestNet = topK[0] ? topK[0].netResult : -Infinity;
        const bestByNet = topK.filter(t => t.netResult === bestNet);
        let bestMoves;
        if (bestByNet.length === 1) {
            bestMoves = bestByNet;
        } else {
            const maxAtk = Math.max(...bestByNet.map(t => (typeof t.atk === 'number' ? t.atk : -Infinity)));
            const byAtk = bestByNet.filter(t => (typeof t.atk === 'number' ? t.atk : -Infinity) === maxAtk);
            if (byAtk.length === 1) {
                bestMoves = byAtk;
            } else {
                const maxDef = Math.max(...byAtk.map(t => (typeof t.def === 'number' ? t.def : -Infinity)));
                bestMoves = byAtk.filter(t => (typeof t.def === 'number' ? t.def : -Infinity) === maxDef);
            }
        }
        if (!bestMoves || bestMoves.length === 0) bestMoves = topK.length ? [topK[0]] : [];

    const chosen = bestMoves.length ? bestMoves[Math.floor(Math.random() * bestMoves.length)] : null;

        if (aiDebug) {
            // reuse existing debug UI code paths: clearAIDebugUI + show highlights + panel info
            clearAIDebugUI();
            if (chosen) {
                const aiCell = document.querySelector(`.cell[data-row="${chosen.r}"][data-col="${chosen.c}"]`);
                if (aiCell) aiCell.classList.add('ai-highlight');
                // no immediate bestResponse available with deep search, keep response highlight removed or estimate via single-step
            }
            const info = {
                chosen: chosen ? {
                    r: chosen.r,                // Placement coordinates
                    c: chosen.c,                // Placement coordinates
                    src: chosen.srcVal,         // Value of chosen Cell
                    expl: chosen.explosions,    // Number of caused Explosions
                    gain: chosen.searchScore,   // Worst net gain from chosen cell
                    atk: chosen.atk,            // Number of strong ai cells next to weak enemy cells
                    def: chosen.def             // Number of ai cells 1 away from exploding
                } : null,
                ordered: topK.map(cand => ({
                    r: cand.r, c: cand.c, src: cand.srcVal, expl: cand.explosions,
                    gain: cand.searchScore, atk: cand.atk, def: cand.def
                })),
                topK: topK.length
            };
            showAIDebugPanelWithResponse(info);

            if (chosen) {
                const onUserConfirm = (ev) => {
                    // Accept pointerdown or Enter/Space keydown
                    if (ev.type === 'pointerdown' || (ev.type === 'keydown' && (ev.key === 'Enter' || ev.key === ' '))) {
                        ev.stopPropagation();
                        ev.preventDefault();
                        document.removeEventListener('pointerdown', onUserConfirm, true);
                        document.removeEventListener('keydown', onUserConfirm, true);
                        clearAIDebugUI();
                        handleClick(chosen.r, chosen.c);
                    }
                };
                document.addEventListener('pointerdown', onUserConfirm, true);
                document.addEventListener('keydown', onUserConfirm, true);
            } else {
                if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true;
                switchPlayer();
            }
            return;
        }

        if (!chosen) {
            if (!initialPlacements[playerIndex]) initialPlacements[playerIndex] = true;
            switchPlayer();
        } else {
            handleClick(chosen.r, chosen.c);
        }
    }

//#endregion
});

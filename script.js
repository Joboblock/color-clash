document.addEventListener('DOMContentLoaded', () => {
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

    // Detect train mode via URL param
    const urlParams = new URLSearchParams(window.location.search);
    const isTrainMode = urlParams.has('train');

    // Broad mobile detection using feature hints (less brittle than UA regex)
    function isMobileDevice() {
        // 1) UA Client Hints (Chromium): navigator.userAgentData?.mobile
        if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
            if (navigator.userAgentData.mobile) return true;
        }
        // 2) Coarse pointer (touch-centric devices)
        if (typeof window.matchMedia === 'function') {
            try {
                if (window.matchMedia('(pointer: coarse)').matches) return true;
            } catch { /* ignore */ }
        }
        // 3) Multiple touch points (covers iPadOS that reports as Mac)
        if (typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
            return true;
        }
        return false;
    }

    // Request fullscreen on mobile devices; ignore failures silently
    async function requestFullscreenIfMobile() {
        if (!isMobileDevice()) return;
        const el = document.documentElement;
        const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen || el.mozRequestFullScreen;
        if (typeof req === 'function') {
            try { await req.call(el); } catch { /* no-op */ }
        }
    }

    async function exitFullscreenIfPossible() {
        const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen || document.mozCancelFullScreen;
        if (typeof exit === 'function') {
            try { await exit.call(document); } catch { /* ignore */ }
        }
    }

    // Define available player colors
    const playerColors = ['red', 'blue', 'yellow', 'green', 'cyan', 'orange', 'purple', 'magenta'];

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
    const performanceModeCutoff = 16;

    document.documentElement.style.setProperty('--delay-explosion', `${delayExplosion}ms`);
    document.documentElement.style.setProperty('--delay-animation', `${delayAnimation}ms`);
    document.documentElement.style.setProperty('--grid-size', gridSize);

    // Function to get URL parameters
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
    const menu = document.getElementById('mainMenu');
    // removed hidden native range input; visual slider maintains menuPlayerCount
    let menuPlayerCount = playerCount; // current selection from visual slider

    const menuGridSize = document.getElementById('menuGridSize');
    const startBtn = document.getElementById('startBtn');
    const trainBtn = document.getElementById('trainBtn');

    // set dynamic bounds
    const maxPlayers = playerColors.length;

    // Build visual player box slider
    const playerBoxSlider = document.getElementById('playerBoxSlider');
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

    buildPlayerBoxes();
    // highlight using initial URL or default
    const initialPlayersToShow = clampPlayers(playerCount);
    highlightPlayerBoxes(initialPlayersToShow);

    // Start with URL or defaults
    menuPlayerCount = clampPlayers(playerCount);
    updateSizeBoundsForPlayers(menuPlayerCount);

    // Decide initial menu visibility: only open menu if no players/size params OR menu param is present
    const initialParams = new URLSearchParams(window.location.search);
    const hasPlayersOrSize = initialParams.has('players') || initialParams.has('size');
    const isMenu = initialParams.has('menu');
    if (hasPlayersOrSize && !isMenu) {
        // hide menu when explicit game params provided (and not in menu mode)
        if (menu) menu.style.display = 'none';
    } else {
        if (menu) menu.style.display = '';
        // Ensure the URL reflects menu state so back-button can navigate in-app
        if (!isMenu) {
            const params = new URLSearchParams(window.location.search);
            params.set('menu', 'true');
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            window.history.replaceState(null, '', newUrl);
        }
    }

    playerBoxSlider.addEventListener('pointerdown', (e) => {
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
        try { playerBoxSlider.releasePointerCapture(e.pointerId); } catch { /* empty */ }
    });

    // Also handle pointercancel/leave
    playerBoxSlider.addEventListener('pointercancel', () => { isDragging = false; });
    playerBoxSlider.addEventListener('pointerleave', (e) => { if (isDragging) setPlayerCountFromPointer(e.clientX); });

    // validate on unfocus or Enter — validate and recreate grid when value changes
    menuGridSize.addEventListener('blur', () => {
        validateGridSize();
        const s = Math.max(3, parseInt(menuGridSize.value, 10) || (3 + menuPlayerCount));
        if (s !== gridSize) recreateGrid(s, playerCount);
    });
    menuGridSize.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            validateGridSize();
            const s = Math.max(3, parseInt(menuGridSize.value, 10) || (3 + menuPlayerCount));
            if (s !== gridSize) recreateGrid(s, playerCount);
            menuGridSize.blur(); // optional: trigger blur to close keyboard on mobile
        }
    });

    startBtn.addEventListener('click', async () => {
        const p = clampPlayers(menuPlayerCount);
        let s = Math.max(3, Math.floor(menuGridSize.value) || 3);
        const minAllowed = 3 + p;
        if (s < minAllowed) s = minAllowed;
        const maxSz = parseInt(menuGridSize.max);
        if (s > maxSz) s = maxSz;

        // Enter fullscreen on mobile from the same user gesture
        await requestFullscreenIfMobile();

        // Update URL without reloading (keep behavior discoverable/shareable)
        const params = new URLSearchParams(window.location.search);
        params.delete('menu');
        params.delete('train');
        params.set('players', String(p));
        params.set('size', String(s));
        const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
        // push a new history entry so Back returns to the menu instead of previous/blank
        window.history.pushState({ mode: 'play', players: p, size: s }, '', newUrl);

        // Hide menu and start a fresh game with the chosen settings
        if (menu) menu.style.display = 'none';
        trainMode = false;
        recreateGrid(s, p);
    });

    // Train button handler
    if (trainBtn) {
        trainBtn.textContent = 'Train';
        trainBtn.id = 'trainBtn';
        trainBtn.setAttribute('aria-label', 'Train');

        trainBtn.addEventListener('click', async () => {
            const p = clampPlayers(menuPlayerCount);
            let s = Math.max(3, Math.floor(menuGridSize.value) || 3);
            const minAllowed = 3 + p;
            if (s < minAllowed) s = minAllowed;
            const maxSz = parseInt(menuGridSize.max);
            if (s > maxSz) s = maxSz;

            // Enter fullscreen on mobile from the same user gesture
            await requestFullscreenIfMobile();

            // Update URL without reloading (reflect train mode)
            const params = new URLSearchParams(window.location.search);
            params.delete('menu');
            params.set('players', String(p));
            params.set('size', String(s));
            params.set('train', 'true');
            const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
            // push a new history entry so Back returns to the menu instead of previous/blank
            window.history.pushState({ mode: 'train', players: p, size: s }, '', newUrl);

            // Hide menu and start train mode immediately
            if (menu) menu.style.display = 'none';
            trainMode = true;
            recreateGrid(s, p);
        });
    }
//#endregion

    // Sync UI with current URL (called on back/forward navigation)
    function applyStateFromUrl() {
        const params = new URLSearchParams(window.location.search);
        const hasPS = params.has('players') || params.has('size');
        const showMenu = params.has('menu') || !hasPS;
        if (showMenu) {
            if (menu) menu.style.display = '';
            exitFullscreenIfPossible();
            return;
        }

        const p = clampPlayers(parseInt(params.get('players') || '', 10) || 2);
        let s = parseInt(params.get('size') || '', 10);
        if (!Number.isInteger(s)) s = Math.max(3, 3 + p);
        const isTrain = params.has('train');
        if (menu) menu.style.display = 'none';
        trainMode = isTrain;
        recreateGrid(Math.max(3, s), p);
    }

    // Handle browser navigation to toggle between menu and game instead of leaving the app
    window.addEventListener('popstate', applyStateFromUrl);


//#region Menu Functions
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

    // cell color: pastel mix toward white (opaque), use 50% white by default
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

    // Build boxes for counts 1..maxPlayers (we'll enforce a minimum selection of 2)
    /**
     * Build the visual player "box slider" (1..maxPlayers) and attach handlers.
     * @returns {void} updates DOM under #playerBoxSlider.
     */
    function buildPlayerBoxes() {
        playerBoxSlider.innerHTML = '';
        for (let count = 1; count <= maxPlayers; count++) {
            const box = document.createElement('div');
            box.className = 'box';
            box.dataset.count = String(count); // the player count this box represents
            box.title = `${count} player${count > 1 ? 's' : ''}`;
            const colorKey = playerColors[(count - 1) % playerColors.length];
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

            playerBoxSlider.appendChild(box);
        }
    }

    /**
     * Toggle active state for player boxes up to the selected count and sync UI/state.
     * @param {number} count - selected player count.
     * @returns {void} updates aria attributes, internal selection, and grid if needed.
     */
    function highlightPlayerBoxes(count) {
        Array.from(playerBoxSlider.children).forEach((child) => {
            const boxCount = parseInt(child.dataset.count, 10);
            if (boxCount <= count) child.classList.add('active'); else child.classList.remove('active');
        });
        playerBoxSlider.setAttribute('aria-valuenow', String(count));
        // update internal selection
        menuPlayerCount = count;

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
        const desired = pCount + 3;
        menuGridSize.value = String(desired);
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
    function validateGridSize() {
        let val = parseInt(menuGridSize.value, 10);
        const minSz = 3;
        const maxSz = 16;

        if (isNaN(val)) val = menuPlayerCount + 3; // reset to default if empty
        if (val < minSz) val = minSz;
        if (val > maxSz) val = maxSz;

        menuGridSize.value = String(val);
    }

    // Make the visual box slider draggable like a real slider
    let isDragging = false;
    /**
     * Map a pointer x-position to the nearest player box and update selection.
     * @param {number} clientX - pointer x-coordinate in viewport space.
     * @returns {void} updates selected player count via onMenuPlayerCountChanged.
     */
    function setPlayerCountFromPointer(clientX) {
        const children = Array.from(playerBoxSlider.children);
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

    // Centralized handler for menu player count changes
    /**
     * Central handler when menu player count changes; syncs size, UI, and grid.
     * @param {number} newCount - selected player count.
     * @returns {void} may recreate the grid to reflect new settings.
     */
    function onMenuPlayerCountChanged(newCount) {
        menuPlayerCount = newCount;
        const desiredSize = Math.max(3, newCount + 3);
        if (menuGridSize) menuGridSize.value = String(desiredSize);
        updateSizeBoundsForPlayers(newCount);
        highlightPlayerBoxes(newCount);

        if (newCount !== playerCount || desiredSize !== gridSize) {
            recreateGrid(desiredSize, newCount);
        }
    }
//#endregion


//#region Actual Game Logic
    let grid = [];
    let isProcessing = false;
    let performanceMode = false;
    let currentPlayer = Math.floor(Math.random() * playerCount);
    let initialPlacements = Array(playerCount).fill(false);
    let gameWon = false;
    let invalidInitialPositions = [];

    // Train mode globals
    let trainMode = isTrainMode;
    const humanPlayer = 0; // first selected color is player index 0

    // create initial grid
    recreateGrid(gridSize, playerCount);
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

        // update CSS variable and layout
        document.documentElement.style.setProperty('--grid-size', gridSize);
        gridElement.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;

        // clear previous DOM cells
        while (gridElement.firstChild) gridElement.removeChild(gridElement.firstChild);

        // reset game state arrays according to new sizes
        grid = [];
        initialPlacements = Array(playerCount).fill(false);
        gameWon = false;
        isProcessing = false;
        performanceMode = false;
        currentPlayer = Math.floor(Math.random() * playerCount);

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
                grid[i][j] = { value: 0, player: '' };
                gridElement.appendChild(cell);
            }
        }

        // highlight invalid positions with new layout
        highlightInvalidInitialPositions();
        document.body.className = playerColors[currentPlayer];

        // If the menu's grid input doesn't match newSize, update it to reflect the actual grid
        if (menuGridSize) {
            menuGridSize.value = String(Math.max(3, newSize));
        }

        // Ensure the visual player boxes reflect new player count
        highlightPlayerBoxes(clampPlayers(playerCount));

        // If train mode is enabled, force human to be first color and
        // set the current player to the human (so they control the first color)
        if (trainMode) {
            // Ensure humanPlayer index is valid for current playerCount
            // (humanPlayer is 0 by design; defensive check)
            // DEBUG: make ai first player
            currentPlayer = Math.min(humanPlayer, playerCount - 1);
            document.body.className = playerColors[currentPlayer];
            updateGrid();
            // Trigger AI if the first randomly chosen currentPlayer isn't the human
            maybeTriggerAIMove();
        }
    }

    /**
     * Handle a user/AI click to place or increment
     * Params: row (number), col (number) – cell coordinates.
     * Returns: void – mutates grid state and schedules explosion processing.
     */
    function handleClick(row, col) {
        if (isProcessing || gameWon) return;

        const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        const cellColor = getPlayerColor(row, col);

        if (!initialPlacements[currentPlayer]) {
            if (isInitialPlacementInvalid(row, col)) return;

            if (grid[row][col].value === 0) {
                grid[row][col].value = initialPlacementValue;
                grid[row][col].player = playerColors[currentPlayer];
                
                cell.classList.add(playerColors[currentPlayer]);
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
            if (grid[row][col].value > 0 && cellColor === playerColors[currentPlayer]) {
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

        setTimeout(() => {
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
                
                if (grid[i][j].player === playerColors[currentPlayer]) {
                    cell.className = `cell ${grid[i][j].player}`;
                } else if (grid[i][j].player) {
                    cell.className = `cell hidden ${grid[i][j].player}`;
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
     * Create/update positioned value-circles within inner-circle to represent cell value.
     * @param {Element} innerCircle - the inner-circle element.
     * @param {number} value - cell value 0..maxCellValue.
     * @param {boolean} causedByExplosion - for animation.
     * @returns {void} animates and positions child dots.
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
        const existingCount = existingCircles.length;

        if (causedByExplosion) {
            innerCircle.style.transform = 'scale(1.05)';
            setTimeout(() => innerCircle.style.transform = '', delayAnimation); //DELAY schmol innerCircle
        }

        // Collect elements we created so we can set final state for all of them in one RAF
        const newElements = [];
        for (let i = 0; i < value; i++) {
            const angle = angleStep * i + (value === 3 ? 30 : value === 4 ? 45 : 0);
            const x = radius * Math.cos((angle * Math.PI) / 180);
            const y = radius * Math.sin((angle * Math.PI) / 180);

            let valueCircle;
            const isNew = i >= existingCount;

            if (!isNew) {
                valueCircle = existingCircles[i];
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
            setTimeout(() => valueCircle.remove(), delayAnimation);
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

        document.body.className = playerColors[currentPlayer];
        updateGrid();

        // If in train mode, possibly trigger AI move for non-human players
        maybeTriggerAIMove();
    }

    /**
     * Check if the player owns at least one visible cell on the board.
     * @param {number} playerIndex - index within playerColors.
     * @returns {boolean} true if any cell has the player's class.
     */
    function hasCells(playerIndex) {
        return Array.from(document.querySelectorAll('.cell'))
            .some(cell => cell.classList.contains(playerColors[playerIndex]));
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
     * Check if only one player still owns cells; if so, end game and reopen menu after delay.
     * @returns {void} sets gameWon and then reopens the menu via URL param.
     */
    function checkWinCondition() {
        const playerCells = Array(playerCount).fill(0);
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                const playerColor = grid[i][j].player;
                const playerIndex = playerColors.indexOf(playerColor);
                if (playerIndex >= 0) {
                    playerCells[playerIndex]++;
                }
            }
        }

        const activePlayers = playerCells.filter(count => count > 0).length;
        if (activePlayers === 1) {
            gameWon = true;
            setTimeout(() => {
                if (!gameWon) return;
                // Instead of restarting, open the menu by adding menu=true to the URL
                const params = new URLSearchParams(window.location.search);
                params.set('menu', 'true');
                const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
                // Update the URL without reloading the page
                window.history.replaceState(null, '', newUrl);
                // Show the menu overlay
                if (menu) menu.style.display = '';
                // When showing the menu, exit fullscreen to restore browser UI if needed
                exitFullscreenIfPossible();
            }, 2000); //DELAY Game End
        }
    }
//#endregion

//#region Training / AI helpers (dataRespect + debug)
    // AI debug mode if URL contains ai_debug=true
    const aiDebug = true;
    // Configure dataRespect branching factor K via URL param ai_k, default 3
    const dataRespectK = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_k')) || 25);
    // number of plies (AI-perspective). Example: 3 (AI -> opp -> AI)
    const aiDepth = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_depth')) || 4);
    const maxExplosionsToAssumeLoop = gridSize * 3;


    // Called after each turn change to possibly run AI moves
    /**
     * In train mode, trigger AI move if it's currently an AI player's turn.
     * @returns {void} may schedule aiMakeMoveFor with a short delay.
     */
    function maybeTriggerAIMove() {
        if (!trainMode) return;
        if (gameWon || isProcessing) return;
        if (currentPlayer === humanPlayer) return;
        // If the menu is open/visible, do not run AI moves
        if (menu && menu.style.display !== 'none') return;

        setTimeout(() => {
            if (isProcessing || gameWon || currentPlayer === humanPlayer) return;
            if (menu && menu.style.display !== 'none') return;
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
                if (simGrid[r][c].player === playerColors[playerIndex]) total += simGrid[r][c].value;
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
                    if (simGrid[r][c].player === playerColors[playerIndex]) {
                        const key = Math.max(0, Math.min(3, simGrid[r][c].value));
                        candidates.push({ r, c, isInitial: false, srcVal: simGrid[r][c].value, sortKey: key });
                    }
                }
            }
        }
        return candidates;
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
        title.textContent = `AI dataRespect — player ${currentPlayer} (${playerColors[currentPlayer]})`;
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
            simGrid[moveR][moveC].player = playerColors[moverIndex];
        } else {
            const prev = simGrid[moveR][moveC].value;
            simGrid[moveR][moveC].value = Math.min(maxCellValue, prev + 1);
            simGrid[moveR][moveC].player = playerColors[moverIndex];
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
                        const idx = playerColors.indexOf(owner);
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

        // Generate candidates for moverIndex
        let candidates = generateCandidatesOnSim(simGrid, simInitial, moverIndex);

        // If no legal move: simulate flagging initialPlacement done for that mover and continue to next player
        if (candidates.length === 0) {
            // If initial placement still pending, mark it done
            if (!simInitial[moverIndex]) simInitial[moverIndex] = true;
            const nextPlayer = (moverIndex + 1) % playerCount;
            return minimaxEvaluate(simGrid, simInitial, nextPlayer, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex);
        }

        // Evaluate immediate gains for each candidate to sort and pick topK
        const evaluatedCandidates = [];
        for (const cand of candidates) {
            const applied = applyMoveAndSim(simGrid, simInitial, moverIndex, cand.r, cand.c, cand.isInitial);
            const val = totalOwnedOnGrid(applied.grid, focusPlayerIndex);

            // runaway handling: encode infinite endpoint values
            if (applied.runaway) {
                const runawayVal = (moverIndex === focusPlayerIndex) ? Infinity : -Infinity;
                evaluatedCandidates.push({ cand, value: runawayVal, resultGrid: applied.grid, simInitial: applied.simInitial });
            } else {
                evaluatedCandidates.push({ cand, value: val, resultGrid: applied.grid, simInitial: applied.simInitial });
            }
        }

        // Sort descending by immediate value when mover is the focusPlayerIndex, otherwise ascending (opponent tries to minimize)
        evaluatedCandidates.sort((a, b) => ( (moverIndex === focusPlayerIndex ? b.value - a.value : a.value - b.value) ));

        // Truncate to top K to limit branching
        const topCandidates = evaluatedCandidates.slice(0, Math.min(dataRespectK, evaluatedCandidates.length));

        const nextPlayer = (moverIndex + 1) % playerCount;
        let bestValue = (moverIndex === focusPlayerIndex) ? -Infinity : Infinity;

        let bestSteps = undefined;
        for (const entry of topCandidates) {
            // If entry produced immediate runaway, short-circuit with stepsToInfinity = 1
            if (entry.value === Infinity) {
                if (moverIndex === focusPlayerIndex) return { value: Infinity, runaway: true, stepsToInfinity: 1 };
                if (moverIndex !== focusPlayerIndex) return { value: -Infinity, runaway: true, stepsToInfinity: 1 };
            }
            if (entry.value === -Infinity) {
                if (moverIndex !== focusPlayerIndex) return { value: -Infinity, runaway: true, stepsToInfinity: 1 };
                if (moverIndex === focusPlayerIndex) return { value: Infinity, runaway: true, stepsToInfinity: 1 };
            }

            // Recurse on child node
            const childEval = minimaxEvaluate(entry.resultGrid, entry.simInitial, nextPlayer, depth - 1, alpha, beta, maximizingPlayerIndex, focusPlayerIndex);

            const value = childEval.value;
            const childSteps = typeof childEval.stepsToInfinity === 'number' ? childEval.stepsToInfinity + 1 : undefined;

            if (moverIndex === focusPlayerIndex) {
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
     * @param {number} playerIndex - AI player index in playerColors.
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
                // Start recursion on next player with depth = aiDepth * 2 - 1 is not necessary; simpler: use aiDepth as plies
                const nextPlayer = (playerIndex + 1) % playerCount;
                const depth = aiDepth; // number of plies to look ahead
                const evalRes = minimaxEvaluate(cand.resultGrid, cand.resultInitial, nextPlayer, depth - 1, -Infinity, Infinity, playerIndex, playerIndex);
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
                    const onUserClick = (ev) => {
                        ev.stopPropagation();
                        ev.preventDefault();
                        document.removeEventListener('pointerdown', onUserClick, true);
                        clearAIDebugUI();
                        handleClick(chosenFast.r, chosenFast.c);
                    };
                    document.addEventListener('pointerdown', onUserClick, true);
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
            const aiColor = playerColors[playerIndex];
            const playerColor = playerColors[humanPlayer];
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
                const onUserClick = (ev) => {
                    ev.stopPropagation();
                    ev.preventDefault();
                    document.removeEventListener('pointerdown', onUserClick, true);
                    clearAIDebugUI();
                    handleClick(chosen.r, chosen.c);
                };
                document.addEventListener('pointerdown', onUserClick, true);
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

document.addEventListener('DOMContentLoaded', () => {
    const gridElement = document.querySelector('.grid');

    // Detect train mode via URL param
    const urlParams = new URLSearchParams(window.location.search);
    const isTrainMode = urlParams.has('train');

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
    const performanceModeCutoff = 8;

    document.documentElement.style.setProperty('--delay-explosion', `${delayExplosion}ms`);
    document.documentElement.style.setProperty('--delay-animation', `${delayAnimation}ms`);
    document.documentElement.style.setProperty('--grid-size', gridSize);

    // Function to get URL parameters
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

    // Decide initial menu visibility: only open menu if no players/size params OR preview param is present
    const initialParams = new URLSearchParams(window.location.search);
    const hasPlayersOrSize = initialParams.has('players') || initialParams.has('size');
    const isPreview = initialParams.has('preview');
    if (hasPlayersOrSize && !isPreview) {
        // hide menu when explicit game params provided (and not in preview mode)
        if (menu) menu.style.display = 'none';
    } else {
        if (menu) menu.style.display = '';
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

    startBtn.addEventListener('click', () => {
        const p = clampPlayers(menuPlayerCount);
        let s = Math.max(3, Math.floor(menuGridSize.value) || 3);
        // enforce relationship: size must be >= 3 + players
        const minAllowed = 3 + p;
        if (s < minAllowed) s = minAllowed;
        // enforce upper bound from number input
        const maxSz = parseInt(menuGridSize.max);
        if (s > maxSz) s = maxSz;
        // set params and reload so existing initialization picks them up
        const params = new URLSearchParams(window.location.search);
        // remove preview when starting
        params.delete('preview');
        params.set('players', String(p));
        params.set('size', String(s));
        window.location.search = params.toString();
    });

    // Preview button is repurposed to "Train"
    if (trainBtn) {
        trainBtn.textContent = 'Train';
        trainBtn.id = 'trainBtn';
        trainBtn.setAttribute('aria-label', 'Train');

        trainBtn.addEventListener('click', () => {
            const p = clampPlayers(menuPlayerCount);
            let s = Math.max(3, Math.floor(menuGridSize.value) || 3);
            const minAllowed = 3 + p;
            if (s < minAllowed) s = minAllowed;
            const maxSz = parseInt(menuGridSize.max);
            if (s > maxSz) s = maxSz;

            const params = new URLSearchParams(window.location.search);
            params.set('players', String(p));
            params.set('size', String(s));
            // set train mode
            params.set('train', 'true');
            window.location.search = params.toString();
        });
    }
//#endregion


//#region Menu Functions
    function hexToRgb(hex) {
        const h = hex.replace('#', '');
        const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
        const bigint = parseInt(full, 16);
        return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    }

    // cell color: pastel mix toward white (opaque), use 50% white by default
    function mixWithWhite(hex, factor = 0.5) {
        // factor = portion of white (0..1)
        const { r, g, b } = hexToRgb(hex);
        const mix = (c) => Math.round((1 - factor) * c + factor * 255);
        return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
    }

    // Build boxes for counts 1..maxPlayers (we'll enforce a minimum selection of 2)
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

    function updateSizeBoundsForPlayers(pCount) {
        const desired = pCount + 3;
        menuGridSize.value = String(desired);
    }

    // Sync functions
    function clampPlayers(n) {
        const v = Math.max(2, Math.min(maxPlayers, Math.floor(n) || 2));
        return v;
    }

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

        // build new cells and attach listeners
        for (let i = 0; i < gridSize; i++) {
            grid[i] = [];
            for (let j = 0; j < gridSize; j++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.row = i;
                cell.dataset.col = j;
                // Use a small wrapper to capture i/j values for event handler
                cell.addEventListener('click', ((r, c) => () => handleClick(r, c))(i, j));
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
            currentPlayer = Math.min(humanPlayer, playerCount - 1);
            document.body.className = playerColors[currentPlayer];
            updateGrid();
            // Trigger AI if the first randomly chosen currentPlayer isn't the human
            maybeTriggerAIMove();
        }
    }

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

    function updateCell(row, col, explosionValue = 0, player = grid[row][col].player, causedByExplosion = false) {
        if (grid[row][col].value <= maxCellValue) {
            grid[row][col].value = Math.min(maxCellValue, grid[row][col].value + explosionValue);
            grid[row][col].player = player;
            const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
            const innerCircle = updateInnerCircle(cell, player, causedByExplosion);
            updateValueCircles(innerCircle, grid[row][col].value, causedByExplosion);
        }
    }

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

    function switchPlayer() {
        do {
            currentPlayer = (currentPlayer + 1) % playerCount;
        } while (!hasCells(currentPlayer) && initialPlacements.every(placement => placement));

        document.body.className = playerColors[currentPlayer];
        updateGrid();

        // If in train mode, possibly trigger AI move for non-human players
        maybeTriggerAIMove();
    }

    function hasCells(playerIndex) {
        return Array.from(document.querySelectorAll('.cell'))
            .some(cell => cell.classList.contains(playerColors[playerIndex]));
    }

    function getPlayerColor(row, col) {
        return grid[row][col].player;
    }

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

    function clearInvalidHighlights() {
        document.querySelectorAll('.cell.invalid').forEach(cell => {
            cell.classList.remove('invalid');
        });
    }

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
                resetGame();
            }, 2000); //DELAY Game End
        }
    }

    function resetGame() {
        grid = [];
        isProcessing = false;
        currentPlayer = Math.floor(Math.random() * playerCount);
        initialPlacements = Array(playerCount).fill(false);
        gameWon = false;

        for (let i = 0; i < gridSize; i++) {
            grid[i] = [];
            for (let j = 0; j < gridSize; j++) {
                grid[i][j] = { value: 0, player: '' };
                const cell = document.querySelector(`.cell[data-row="${i}"][data-col="${j}"]`);
                cell.className = 'cell';
                cell.textContent = '';
                while (cell.firstChild) {
                    cell.removeChild(cell.firstChild);
                }
            }
        }

        highlightInvalidInitialPositions();
        document.body.className = playerColors[currentPlayer];
    }
//#endregion

//#region Training / AI helpers (dataRespect + debug)
    // AI debug mode if URL contains ai_debug=true
    const aiDebug = true;
    // Configure dataRespect branching factor K via URL param ai_k, default 3
    const dataRespectK = Math.max(1, parseInt((new URLSearchParams(window.location.search)).get('ai_k')) || 10);

    // Called after each turn change to possibly run AI moves
    function maybeTriggerAIMove() {
        if (!trainMode) return;
        if (gameWon || isProcessing) return;
        if (currentPlayer === humanPlayer) return;

        setTimeout(() => {
            if (isProcessing || gameWon || currentPlayer === humanPlayer) return;
            aiMakeMoveFor(currentPlayer);
        }, 350);
    }

    // cloneGridForSim() already exists earlier in your script; reuse it

    // helper: clone an already-simulated grid (deep copy)
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

    // helper: compute total owned value for a given player on a provided grid
    function totalOwnedOnGrid(simGrid, playerIndex) {
        let total = 0;
        for (let r = 0; r < gridSize; r++) {
            for (let c = 0; c < gridSize; c++) {
                if (simGrid[r][c].player === playerColors[playerIndex]) total += simGrid[r][c].value;
            }
        }
        return total;
    }

    // Generate legal candidate moves for a player on a given simulated grid & initialPlacements flags
    // returns array of { r, c, isInitial, srcVal, sortKey }
    function generateCandidatesOnSim(simGrid, simInitialPlacements, playerIndex) {
        const candidates = [];
        if (!simInitialPlacements[playerIndex]) {
            for (let r = 0; r < gridSize; r++) {
                for (let c = 0; c < gridSize; c++) {
                    if (simGrid[r][c].value === 0 && !isInitialPlacementInvalid(r, c)) {
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

    // Simulate chained explosions on a copied grid and count explosion events
    // Returns { grid: simGrid, explosionCount: N }
    // Simulate chained explosions on a copied grid and count explosion events
    // Returns { grid: simGrid, explosionCount, runaway: boolean }
    function simulateExplosions(simGrid, simInitialPlacements) {
        const maxCellValueLocal = maxCellValue;
        let explosionCount = 0;
        let iteration = 0;
        const MAX_STEPS = 8; // explosion wave limit

        while (true) {
            iteration++;
            if (iteration > MAX_STEPS) {
                // runaway detected
                return { grid: simGrid, explosionCount, runaway: true };
            }

            const cellsToExplode = [];
            for (let i = 0; i < gridSize; i++) {
                for (let j = 0; j < gridSize; j++) {
                    if (simGrid[i][j].value >= 4) {
                        cellsToExplode.push({
                            row: i, col: j,
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

                // clear origin
                simGrid[row][col].value = 0;

                // Determine whether this explosion occurs during the initial-placement phase
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

                // Apply explosionValue to targets and assign ownership
                for (const t of targets) {
                    const prev = simGrid[t.r][t.c].value;
                    simGrid[t.r][t.c].value = Math.min(maxCellValueLocal, prev + explosionValue);
                    simGrid[t.r][t.c].player = player;
                }

                // out-of-bounds fragments return to origin *only* during initial-placement explosions
                if (extraBackToOrigin > 0 && isInitialPlacement) {
                    const prev = simGrid[row][col].value;
                    simGrid[row][col].value = Math.min(maxCellValueLocal, prev + extraBackToOrigin);
                    simGrid[row][col].player = player;
                }
            }
            // loop again to resolve new >=4 cells
        }

        return { grid: simGrid, explosionCount, runaway: false };
    }

    // Simulate applying a move on a supplied simGrid copy and return { gain, explosions, resultGrid }
    // Adds runaway detection logic — assigns ±Infinity gain accordingly
    function evaluateMoveOnSim(simGridInput, simInitialPlacements, moverIndex, moveR, moveC, isInitialMove, focusPlayerIndex) {
        const simGrid = deepCloneGrid(simGridInput);
        const simInitial = simInitialPlacements.slice();

        // before total for focus player
        const beforeFocus = totalOwnedOnGrid(simGrid, focusPlayerIndex);

        // Apply move
        if (isInitialMove) {
            simGrid[moveR][moveC].value = 5;
            simGrid[moveR][moveC].player = playerColors[moverIndex];
        } else {
            const prev = simGrid[moveR][moveC].value;
            simGrid[moveR][moveC].value = Math.min(maxCellValue, prev + 1);
            simGrid[moveR][moveC].player = playerColors[moverIndex];
        }

        // Run explosions with runaway detection
        const simResult = simulateExplosions(simGrid, simInitial);
        const afterGrid = simResult.grid;
        const explosionCount = simResult.explosionCount;

        // runaway => immediate ±Infinity rating
        if (simResult.runaway) {
            const gain = (moverIndex === focusPlayerIndex) ? Infinity : -Infinity;
            return { gain, explosions: explosionCount, resultGrid: afterGrid };
        }

        // normal evaluation path
        const afterFocus = totalOwnedOnGrid(afterGrid, focusPlayerIndex);
        return {
            gain: afterFocus - beforeFocus,
            explosions: explosionCount,
            resultGrid: afterGrid
        };
    }

    // UI helper: ensure response highlight style exists and show/hide function
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
            .ai-response-highlight {
                outline: 4px solid rgba(255, 100, 100, 0.95) !important;
                box-shadow: 0 0 18px rgba(255,100,100,0.45);
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

    // UI helper: show debug panel containing info and ordered candidate list plus opponent response
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
        summary.innerHTML = `<strong>chosen gain:</strong> ${info.chosen.gain} &nbsp; <strong>explosions:</strong> ${info.chosen.explosions}`;
        panel.appendChild(summary);

        const resp = document.createElement('div');
        resp.style.marginTop = '6px';
        resp.innerHTML = `<strong>predicted worst response:</strong> player ${info.response.playerIndex} (${playerColors[info.response.playerIndex]}) at (${info.response.r},${info.response.c}) -> <strong>AI change:</strong> ${info.response.aiChange} (expl:${info.response.explosions})`;
        panel.appendChild(resp);

        const listTitle = document.createElement('div');
        listTitle.style.marginTop = '8px';
        listTitle.innerHTML = `<em>candidates (top ${info.topK}) ordered by immediate AI gain:</em>`;
        panel.appendChild(listTitle);

        const pre = document.createElement('pre');
        pre.textContent = info.ordered.map((e, idx) => {
            return `${idx + 1}. (${e.r},${e.c}) src:${e.srcVal} gain:${e.gain} expl:${e.explosions} -> worstRespAIChange:${e.worstResponseAIChange}`;
        }).join('\n');
        panel.appendChild(pre);

        document.body.appendChild(panel);
    }

    // UI helper: clear debug panel and highlights
    function clearAIDebugUI() {
        const existing = document.getElementById('aiDebugPanel');
        if (existing) existing.remove();
        document.querySelectorAll('.ai-highlight').forEach(el => el.classList.remove('ai-highlight'));
        document.querySelectorAll('.ai-response-highlight').forEach(el => el.classList.remove('ai-response-highlight'));
    }

    // Main AI with dataRespect against next player
    function aiMakeMoveFor(playerIndex) {
        if (isProcessing || gameWon) return;

        // generate candidates on the real grid
        const candidates = generateCandidatesOnSim(grid, initialPlacements, playerIndex);
        if (candidates.length === 0) {
            // nothing to do
            if (!initialPlacements[playerIndex]) {
                initialPlacements[playerIndex] = true;
            }
            switchPlayer();
            return;
        }

        // Evaluate immediate gain and explosions for every candidate (focus on AI player)
        const evaluated = []; // { r,c,isInitial,srcVal,gain,explosions, resultGrid }
        for (const cand of candidates) {
            const res = evaluateMoveOnSim(grid, initialPlacements, playerIndex, cand.r, cand.c, cand.isInitial, playerIndex);
            evaluated.push({
                r: cand.r,
                c: cand.c,
                isInitial: cand.isInitial,
                srcVal: cand.srcVal,
                gain: res.gain,
                explosions: res.explosions,
                resultGrid: res.resultGrid
            });
        }

        // Sort by immediate gain descending, take top K
        evaluated.sort((a, b) => b.gain - a.gain || b.explosions - a.explosions);
        const topK = evaluated.slice(0, Math.min(dataRespectK, evaluated.length));

        // Determine next player (the one who will move after AI)
        const nextPlayer = (() => {
            let np = playerIndex;
            // find the next player index that would be chosen by switchPlayer() logic
            // simulate the do-while used in switchPlayer(): advance until a player with cells exists OR until all have initial placements
            // Simpler: next in cyclic order
            np = (playerIndex + 1) % playerCount;
            return np;
        })();

        // For each top candidate, evaluate opponent's worst response (the move that produces lowest AI total after the opponent move)
        for (const cand of topK) {
            // AI's grid after candidate
            const gridAfterAI = cand.resultGrid;
            

            // Generate opponent candidates on simulated grid; use current initialPlacements (not flipping AI's flags)
            const oppCandidates = generateCandidatesOnSim(gridAfterAI, initialPlacements, nextPlayer);

            // If opponent has no candidates, then worst response effect = 0
            if (oppCandidates.length === 0) {
                cand.worstResponseAIChange = 0;
                cand.bestResponse = null;
                continue;
            }

            // For each opponent candidate, evaluate AI total change after opponent move
            let worstAIChange = Infinity; // we look for the move that minimizes AI total -> smallest after - aiAfter
            let worstResp = null;

            for (const oc of oppCandidates) {
                const resOpp = evaluateMoveOnSim(gridAfterAI, initialPlacements, nextPlayer, oc.r, oc.c, oc.isInitial, playerIndex);
                // resOpp.gain is change to AI's total (focus player) — note evaluateMoveOnSim was called with focusPlayerIndex = AI index
                // compute ai change relative to aiAfter: resOpp.gain = AI_after_afterOpp - aiAfter
                const aiChange = resOpp.gain;
                if (aiChange < worstAIChange) {
                    worstAIChange = aiChange;
                    worstResp = { r: oc.r, c: oc.c, isInitial: oc.isInitial, explosions: resOpp.explosions, aiChange };
                }
            }

            // store the worst-response effect (negative or zero usually)
            cand.worstResponseAIChange = worstAIChange;
            cand.bestResponse = worstResp;
        }

        // Now compute net_result for each candidate: immediate gain + worstResponseAIChange
        for (const cand of topK) {
            cand.netResult = cand.gain + (typeof cand.worstResponseAIChange === 'number' ? cand.worstResponseAIChange : 0);
        }

        // Choose candidate with maximum netResult; tie-break randomly
        topK.sort((a, b) => b.netResult - a.netResult || b.gain - a.gain || b.explosions - a.explosions);
        let bestNet = topK[0].netResult;
        const bestMoves = topK.filter(t => t.netResult === bestNet);
        const chosen = bestMoves[Math.floor(Math.random() * bestMoves.length)];

        // For debug mode: highlight chosen and its predicted opponent response, show panel
        if (aiDebug) {
            clearAIDebugUI();
            const aiCell = document.querySelector(`.cell[data-row="${chosen.r}"][data-col="${chosen.c}"]`);
            if (aiCell) aiCell.classList.add('ai-highlight');

            // highlight opponent response if exists
            if (chosen.bestResponse) {
                const respCell = document.querySelector(`.cell[data-row="${chosen.bestResponse.r}"][data-col="${chosen.bestResponse.c}"]`);
                if (respCell) respCell.classList.add('ai-response-highlight');
            }

            const info = {
                chosen: { r: chosen.r, c: chosen.c, gain: chosen.gain, explosions: chosen.explosions },
                response: chosen.bestResponse ? {
                    playerIndex: nextPlayer,
                    r: chosen.bestResponse.r,
                    c: chosen.bestResponse.c,
                    explosions: chosen.bestResponse.explosions,
                    aiChange: chosen.bestResponse.aiChange
                } : { playerIndex: nextPlayer, r: null, c: null, explosions: 0, aiChange: 0 },
                ordered: topK.map(e => ({
                    r: e.r, c: e.c, srcVal: e.srcVal, gain: e.gain,
                    explosions: e.explosions, worstResponseAIChange: e.worstResponseAIChange
                })),
                topK: topK.length
            };

            showAIDebugPanelWithResponse(info);

            // Wait for user confirmation click (on any part of the document)
            const onUserClick = (ev) => {
                ev.stopPropagation(); // prevent cell handlers from firing first
                ev.preventDefault();
                document.removeEventListener('pointerdown', onUserClick, true);
                clearAIDebugUI();
                handleClick(chosen.r, chosen.c);
            };

            // capture phase so it runs before anything else
            document.addEventListener('pointerdown', onUserClick, true);
            return;
        }

        // Non-debug: execute chosen move immediately
        handleClick(chosen.r, chosen.c);
    }
//#endregion
});

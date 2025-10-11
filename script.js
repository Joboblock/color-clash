document.addEventListener('DOMContentLoaded', () => {
    const gridElement = document.querySelector('.grid');

    // Define available player colors
    const playerColors = ['red', 'blue', 'yellow', 'green', 'cyan', 'orange', 'purple', 'magenta'];

    // Get and cap player count at the number of available colors
    let playerCount = parseInt(getQueryParam('players')) || 2;
    playerCount = Math.min(playerCount, playerColors.length);  // Cap at available colors

    // Get grid size from URL
    let gridSize = parseInt(getQueryParam('size')) || (3 + playerCount);

    // Game Parameters
    const maxCellValue = 5;
    const delayExplosion = 500;
    const delayAnimation = 300;

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
    const previewBtn = document.getElementById('previewBtn');

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
        try { playerBoxSlider.releasePointerCapture(e.pointerId); } catch (err) {}
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

    // Preview button: add preview=true and players/size to URL then reload
    previewBtn.addEventListener('click', () => {
        const p = clampPlayers(menuPlayerCount);
        let s = Math.max(3, Math.floor(menuGridSize.value) || 3);
        const minAllowed = 3 + p;
        if (s < minAllowed) s = minAllowed;
        const maxSz = parseInt(menuGridSize.max);
        if (s > maxSz) s = maxSz;

        const params = new URLSearchParams(window.location.search);
        params.set('players', String(p));
        params.set('size', String(s));
        params.set('preview', 'true');
        window.location.search = params.toString();
    });
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
    }

    // create initial grid
    recreateGrid(gridSize, playerCount);
//#endregion

//#region Game Logic Functions
    function handleClick(row, col) {
        if (isProcessing || gameWon) return;

        const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
        const cellColor = getPlayerColor(row, col);

        if (!initialPlacements[currentPlayer]) {
            if (isInitialPlacementInvalid(row, col)) return;

            if (grid[row][col].value === 0) {
                grid[row][col].value = 5;
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

                if (grid[row][col].value >= 4) {
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
                if (grid[i][j].value >= 4) {
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

        if (cellsToExplode.length >= 7) {
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
        if (grid[row][col].value < maxCellValue) {
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

    function updateInnerCircle(cell, player, causedByExplosion) {
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
            // Remove any existing value circles when in performance mode
            innerCircle.querySelectorAll('.value-circle').forEach(circle => circle.remove());
            return;
        }

        const cellSize = innerCircle.parentElement.offsetWidth;
        const radius = cellSize / 6 * (value === 1 ? 0 : (value === 2 ? 1 : (value === 3 ? 2 / Math.sqrt(3) : Math.sqrt(2))));
        const angleStep = 360 / value;

        const existingCircles = Array.from(innerCircle.children);
        const existingCount = existingCircles.length;

        if (causedByExplosion) {
            innerCircle.style.transform = 'scale(1.05)';
            setTimeout(() => {
                innerCircle.style.transform = '';
            }, delayAnimation); //DELAY schmol innerCircle
        }

        for (let i = 0; i < value; i++) {
            const angle = angleStep * i + (value == 3 ? 30 : value == 4 ? 45 : 0);
            const x = radius * Math.cos((angle * Math.PI) / 180);
            const y = radius * Math.sin((angle * Math.PI) / 180);

            let valueCircle;

            if (i < existingCount) {
                valueCircle = existingCircles[i];
            } else {
                valueCircle = document.createElement('div');
                valueCircle.className = 'value-circle';
                valueCircle.style.opacity = '0';
                innerCircle.appendChild(valueCircle);
            }

            requestAnimationFrame(() => {
                valueCircle.style.transform = `translate(${x}px, ${y}px)`;
                valueCircle.style.opacity = '1';
            });
        }

        for (let i = value; i < existingCount; i++) {
            const valueCircle = existingCircles[i];
            valueCircle.style.opacity = '0';
            setTimeout(() => {
                valueCircle.remove();
            }, delayAnimation); //Remove exploded valueCircle
        }
    }

    function switchPlayer() {
        do {
            currentPlayer = (currentPlayer + 1) % playerCount;
        } while (!hasCells(currentPlayer) && initialPlacements.every(placement => placement));

        document.body.className = playerColors[currentPlayer];
        updateGrid();
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
});

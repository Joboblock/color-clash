document.addEventListener('DOMContentLoaded', () => {
    const gridElement = document.querySelector('.grid');
    
    // Function to get URL parameters
    function getQueryParam(param) {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(param);
    }

    // Define available player colors
    const playerColors = ['red', 'blue', 'yellow', 'green', 'cyan', 'orange', 'purple', 'magenta'];

    // Get and cap player count at the number of available colors
    let playerCount = parseInt(getQueryParam('players')) || 2;
    playerCount = Math.min(playerCount, playerColors.length);  // Cap at available colors

    // Get grid size from URL
    let gridSize = parseInt(getQueryParam('size')) || (3 + playerCount);

    const maxCellValue = 5;
    const delayExplosion = 500;
    const delayAnimation = 300;
    const delayExplosionUpdate = 100;

    document.documentElement.style.setProperty('--delay-explosion', `${delayExplosion}ms`);
    document.documentElement.style.setProperty('--delay-animation', `${delayAnimation}ms`);
    document.documentElement.style.setProperty('--grid-size', gridSize);
    
    let grid = [];
    let isProcessing = false;
    let performanceMode = false;
    let currentPlayer = Math.floor(Math.random() * playerCount);
    let initialPlacements = Array(playerCount).fill(false);
    let gameWon = false;
    let invalidInitialPositions = [];

    if (gridSize % 2 === 0) {
        const middle = gridSize / 2;
        invalidInitialPositions = [
            { r: middle - 1, c: middle - 1 },
            { r: middle - 1, c: middle },
            { r: middle, c: middle - 1 },
            { r: middle, c: middle }
        ];
    } else {
        const middle = Math.floor(gridSize / 2);
        invalidInitialPositions = [
            { r: middle, c: middle },
            { r: middle - 1, c: middle },
            { r: middle + 1, c: middle },
            { r: middle, c: middle - 1 },
            { r: middle, c: middle + 1 }
        ];
    }

    gridElement.style.gridTemplateColumns = `repeat(${gridSize}, 1fr)`;

    for (let i = 0; i < gridSize; i++) {
        grid[i] = [];
        for (let j = 0; j < gridSize; j++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = i;
            cell.dataset.col = j;
            cell.addEventListener('click', () => handleClick(i, j));
            grid[i][j] = { value: 0, player: '' };
            gridElement.appendChild(cell);
        }
    }

    highlightInvalidInitialPositions();
    document.body.className = playerColors[currentPlayer];

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
        const cellSize = cell.offsetWidth;

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
            const winnerIndex = playerCells.findIndex(count => count > 0);
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
});
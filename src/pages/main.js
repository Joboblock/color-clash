// Main menu page module: owns local/host/practice sub-modes and their UI components.
// Components moved from script.js for modularization.

import { AIStrengthTile } from '../components/aiStrengthTile.js';
import { PlayerBoxSlider } from '../components/playerBoxSlider.js';
import { ColorCycler } from '../components/colorCycler.js';
import { GridSizeTile } from '../components/gridSizeTile.js';
import { PlayerNameFields } from '../components/playerNameFields.js';

export const mainPage = {
    id: 'main',
    selector: '#mainMenu',
    components: {},
    init(ctx = {}) {
        const {
            recommendedGridSize,
            // defaultGridSizeForPlayers, // not needed directly here
            recreateGrid,
            getPlayerColors,
            getStartingColorIndex,
            setStartingColorIndex,
            onMenuPlayerCountChanged,
            clampPlayers,
            getMenuPlayerCount,
            setMenuPlayerCount,
            getMenuGridSizeVal,
            setMenuGridSizeVal,
            delayAnimation,
            // setMainMenuMode passed via ctx; accessed directly in show()
            // updateAIPreview, // not used after refactor
            // activeColors // unused here; game logic retains responsibility
        } = ctx;

        // DOM references
        const gridDecBtn = document.getElementById('gridDec');
        const gridIncBtn = document.getElementById('gridInc');
        const gridValueEl = document.getElementById('gridValue');
        const aiPreviewCell = document.getElementById('aiPreviewCell');
        const playerBoxSliderEl = document.getElementById('playerBoxSlider');
        const menuColorCycle = document.getElementById('menuColorCycle');
        const onlineMenuColorCycle = document.getElementById('onlineMenuColorCycle');
        const localPlayerName = document.getElementById('playerName');
        const onlinePlayerName = document.getElementById('onlinePlayerName');

        // Grid size tile
        let gridSizeTile = null;
        try {
            gridSizeTile = new GridSizeTile({
                decButtonEl: gridDecBtn,
                incButtonEl: gridIncBtn,
                valueEl: gridValueEl,
                getPlayerCount: () => clampPlayers(getMenuPlayerCount()),
                getRecommendedSize: (p) => recommendedGridSize(p),
                getGameGridSize: () => getMenuGridSizeVal(),
                initialSize: recommendedGridSize(getMenuPlayerCount()),
                onSizeChange: (newSize) => {
                    setMenuGridSizeVal(newSize);
                    // Rebuild grid only if different from current logical grid size used by game
                    try { recreateGrid(newSize, clampPlayers(getMenuPlayerCount())); } catch {/* ignore */ }
                }
            });
        } catch {/* ignore */ }

        // AI Strength tile
        let aiStrengthTile = null;
        try {
            aiStrengthTile = new AIStrengthTile({
                previewCellEl: aiPreviewCell,
                getPlayerColors: () => getPlayerColors(),
                getStartingColorIndex: () => getStartingColorIndex(),
                initialStrength: 1,
                onStrengthChange: () => {
                    // practice mode param update handled in script via URL; here we just expose value
                },
                updateValueCircles: undefined
            });
        } catch {/* ignore */ }

        // Player name fields sync
        let playerNameFields = null;
        try {
            playerNameFields = new PlayerNameFields({
                localInputEl: localPlayerName,
                onlineInputEl: onlinePlayerName,
                onNameChange: () => { /* optional hook */ }
            });
        } catch {/* ignore */ }

        // Player box slider
        let slider = null;
        try {
            slider = new PlayerBoxSlider({
                rootEl: playerBoxSliderEl,
                maxPlayers: getPlayerColors().length,
                minPlayers: 2,
                initialCount: clampPlayers(getMenuPlayerCount()),
                delayAnimation: typeof delayAnimation === 'number' ? delayAnimation : 300,
                getPlayerColors: () => getPlayerColors(),
                getStartingColorIndex: () => getStartingColorIndex(),
                onCountChange: (newCount) => {
                    setMenuPlayerCount(clampPlayers(newCount));
                    onMenuPlayerCountChanged(newCount);
                }
            });
            slider.setCount(clampPlayers(getMenuPlayerCount()), { silent: true });
        } catch {/* ignore */ }

        // Color cycler spanning main + online menus
        let colorCycler = null;
        try {
            colorCycler = new ColorCycler({
                mainEl: menuColorCycle,
                onlineEl: onlineMenuColorCycle,
                getColors: () => getPlayerColors(),
                getIndex: () => getStartingColorIndex(),
                setIndex: (idx) => setStartingColorIndex(idx),
                isMenuOpen: () => {
                    // Treat any visible menu as "menu open" so the body tint updates immediately
                    // (first/main/online menus can all be shown depending on navigation).
                    const firstMenu = document.getElementById('firstMenu');
                    const mainMenu = document.getElementById('mainMenu');
                    const onlineMenu = document.getElementById('onlineMenu');
                    return !!((firstMenu && !firstMenu.classList.contains('hidden')) || (mainMenu && !mainMenu.classList.contains('hidden')) || (onlineMenu && !onlineMenu.classList.contains('hidden')));
                },
                onChange: (idx, reason) => {
                    try {
                        if (slider) {
                            if (reason !== 'init' && typeof slider.previewShiftLeftThenSnap === 'function') {
                                slider.previewShiftLeftThenSnap(() => slider.updateColorsForIndex(idx));
                            } else {
                                slider.updateColorsForIndex(idx);
                            }
                        }
                    } catch {/* ignore */ }
                    try { aiStrengthTile && aiStrengthTile.updatePreview(); } catch {/* ignore */ }
                }
            });
            colorCycler && colorCycler.updateColorsForIndex(getStartingColorIndex());
        } catch {/* ignore */ }

        // Store references
        this.components = { gridSizeTile, aiStrengthTile, slider, colorCycler, playerNameFields };
    },
    show(ctx) {
        const { subMode } = ctx || {};
        try { ctx.setMainMenuMode && ctx.setMainMenuMode(subMode || 'local'); } catch {/* ignore */ }
        if (subMode === 'practice') {
            try { this.components.aiStrengthTile && this.components.aiStrengthTile.updatePreview(); } catch {/* ignore */ }
        }
    },
    hide() { /* no-op */ }
};

export default mainPage;
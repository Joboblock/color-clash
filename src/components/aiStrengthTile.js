/**
 * AIStrengthTile component
 * Encapsulates the AI preview cell logic: showing next color after starting color
 * and cycling a strength value (1..5) on click. Provides API to set starting color index
 * and retrieve current strength.
 */
export class AIStrengthTile {
    /**
     * @param {Object} opts
     * @param {HTMLElement|null} opts.previewCellEl - The DOM element representing the AI preview cell.
     * @param {() => string[]} opts.getPlayerColors - Function returning array of all player color keys.
     * @param {() => number} opts.getStartingColorIndex - Function returning current starting color index within player colors.
     * @param {(val:number) => void} [opts.onStrengthChange] - Callback invoked when strength cycles.
     * @param {number} [opts.initialStrength=1] - Initial strength value (1..5).
     */
    constructor({ previewCellEl, getPlayerColors, getStartingColorIndex, onStrengthChange, initialStrength = 1, updateValueCircles, storageKey = 'aiStrength' }) {
        this.previewCellEl = previewCellEl || null;
        this.getPlayerColors = typeof getPlayerColors === 'function' ? getPlayerColors : () => [];
        this.getStartingColorIndex = typeof getStartingColorIndex === 'function' ? getStartingColorIndex : () => 0;
        this.onStrengthChange = typeof onStrengthChange === 'function' ? onStrengthChange : null;
        this.storageKey = typeof storageKey === 'string' && storageKey ? storageKey : 'aiStrength';
        this.strength = this._clampStrength(initialStrength);
        // Restore persisted strength if present
        try {
            const raw = localStorage.getItem(this.storageKey);
            const saved = raw == null ? null : parseInt(String(raw), 10);
            if (Number.isInteger(saved)) this.strength = this._clampStrength(saved);
        } catch { /* ignore */ }
        this.valueRenderer = typeof updateValueCircles === 'function' ? updateValueCircles : null;
        this._boundClick = () => this._cycleStrength();
        this._firstPaintDone = false; // Track whether we've passed an initial paint for animation timing
        this._init();
    }

    _persistStrength() {
        try { localStorage.setItem(this.storageKey, String(this.strength)); } catch { /* ignore */ }
    }

    _clampStrength(v) {
        v = parseInt(v, 10);
        if (isNaN(v) || v < 1) return 1;
        if (v > 5) return 5;
        return v;
    }

    _init() {
        if (!this.previewCellEl) return;
        this.previewCellEl.setAttribute('role', 'button');
        this.previewCellEl.tabIndex = 0;
        this.previewCellEl.addEventListener('click', this._boundClick);
        this.updatePreview();
    }

    /**
     * Update the AI preview tile to show the next color after the current starting color.
     * Includes inner-circle coloring and a single centered value dot.
     * @returns {void}
     */
    updatePreview() {
        if (!this.previewCellEl) return;
        const colors = this.getPlayerColors();
        if (!colors.length) return;
        const startIdx = this.getStartingColorIndex();
        const nextColor = colors[(startIdx + 1) % colors.length];
        this.previewCellEl.className = `cell ${nextColor}`;
        let inner = this.previewCellEl.querySelector('.inner-circle');
        if (!inner) {
            inner = document.createElement('div');
            inner.className = 'inner-circle';
            this.previewCellEl.appendChild(inner);
        }
        inner.className = `inner-circle ${nextColor}`;
        // Render strength as dots (reuse potential global updateValueCircles if present)
        if (typeof this.valueRenderer === 'function') {
            try { this.valueRenderer(inner, this.strength, false); } catch { /* ignore */ }
        } else {
            inner.dataset.value = String(this.strength);
        }
    }

    _cycleStrength() {
        this.strength = (this.strength % 5) + 1;
        this._persistStrength();
        this.updatePreview();
        if (this.onStrengthChange) {
            try { this.onStrengthChange(this.strength); } catch { /* ignore */ }
        }
    }

    /** External setter for strength */
    setStrength(v) {
        const nv = this._clampStrength(v);
        if (nv === this.strength) return;
        this.strength = nv;
        this._persistStrength();
        this.updatePreview();
        if (this.onStrengthChange) {
            try { this.onStrengthChange(this.strength); } catch { /* ignore */ }
        }
    }

    getStrength() {
        return this.strength;
    }

    /** Inject or replace value renderer after construction (e.g., once function is defined). */
    setValueRenderer(fn) {
        if (typeof fn === 'function') {
            this.valueRenderer = fn;
            // Use a single RAF on first injection so the browser commits an initial paint before animating.
            if (!this._firstPaintDone) {
                requestAnimationFrame(() => {
                    this.updatePreview();
                    this._firstPaintDone = true;
                });
            } else {
                this.updatePreview();
            }
        }
    }

    /** Should be called if starting color changes to re-render preview. */
    onStartingColorChanged() {
        this.updatePreview();
    }

    destroy() {
        if (this.previewCellEl) {
            this.previewCellEl.removeEventListener('click', this._boundClick);
        }
    }
}

export default AIStrengthTile;
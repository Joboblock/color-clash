// ES Module: GridSizeTile component
// Responsible for displaying and adjusting the menu grid size with dynamic lower bound
// based on player count. Handles aria-disabled states, value animation, and invokes
// a callback when the size changes.
/**
 * @typedef {Object} GridSizeTileOptions
 * @property {HTMLElement|null} decButtonEl
 * @property {HTMLElement|null} incButtonEl
 * @property {HTMLElement|null} valueEl
 * @property {() => number} getPlayerCount - Returns current player count used for dynamic lower bound.
 * @property {(p:number) => number} getRecommendedSize - Returns recommended grid size for a player count.
 * @property {() => number} getGameGridSize - Returns current active game grid size.
 * @property {(newSize:number, reason:string) => void} onSizeChange - Notification when size changes.
 * @property {number} [initialSize]
 * @property {number} [minSize]
 * @property {number} [maxSize]
 */
export class GridSizeTile {
    /**
     * @param {GridSizeTileOptions} opts
     */
    constructor(opts) {
        this.decBtn = opts.decButtonEl || null;
        this.incBtn = opts.incButtonEl || null;
        this.valueEl = opts.valueEl || null;
        this.getPlayerCount = typeof opts.getPlayerCount === 'function' ? opts.getPlayerCount : () => 2;
        this.getRecommendedSize = typeof opts.getRecommendedSize === 'function' ? opts.getRecommendedSize : (p) => Math.max(3, p + 3);
        this.getGameGridSize = typeof opts.getGameGridSize === 'function' ? opts.getGameGridSize : () => this.size;
        this.onSizeChange = typeof opts.onSizeChange === 'function' ? opts.onSizeChange : () => {};
        this.minSize = Number.isInteger(opts.minSize) ? opts.minSize : 3;
        this.maxSize = Number.isInteger(opts.maxSize) ? opts.maxSize : 16;
        const initialRaw = Number.isInteger(opts.initialSize) ? opts.initialSize : this.getRecommendedSize(this.getPlayerCount());
        this.size = this._clamp(initialRaw);

        this._applyAccessibility();
        this.reflect();
        this._attachEvents();
        
    }

    _applyAccessibility() {
        [this.decBtn, this.incBtn].forEach(btn => {
            if (!btn) return;
            const isButton = btn.tagName && btn.tagName.toLowerCase() === 'button';
            if (!isButton) {
                btn.setAttribute('role', 'button');
                if (!btn.hasAttribute('tabindex')) btn.tabIndex = 0;
            }
        });
    }

    _clamp(v) {
        const minForPlayers = this.getRecommendedSize(this.getPlayerCount());
        return Math.max(minForPlayers, Math.min(this.maxSize, Math.max(this.minSize, Number.isFinite(v) ? v : this.minSize)));
    }

    /** Force UI to reflect current size and button states */
    reflect() {
        if (this.valueEl) {
            this.valueEl.textContent = String(this.size);
        }
        const minForPlayers = this.getRecommendedSize(this.getPlayerCount());
        this._setAriaDisabled(this.decBtn, this.size <= minForPlayers);
        this._setAriaDisabled(this.incBtn, this.size >= this.maxSize);
    }

    _setAriaDisabled(btn, disabled) {
        if (!btn) return;
        try { btn.disabled = false; } catch { /* ignore */ }
        if (disabled) btn.setAttribute('aria-disabled', 'true'); else btn.removeAttribute('aria-disabled');
    }

    /** Small bump animation on the number */
    _bump() {
        if (!this.valueEl) return;
        this.valueEl.classList.remove('bump');
        void this.valueEl.offsetWidth; // restart animation
        this.valueEl.classList.add('bump');
    }

    /** Set size programmatically */
    setSize(v, reason = 'programmatic', { silent = false, bump = true } = {}) {
        const clamped = this._clamp(v);
        const changed = clamped !== this.size;
        if (changed) {
            
            this.size = clamped;
            this.reflect();
            if (bump) this._bump();
            if (!silent) {
                try { this.onSizeChange(clamped, reason); } catch { /* ignore */ }
            }
        } else {
            // Still reflect in case bounds changed
            this.reflect();
        }
        return this.size;
    }

    /** Apply new player count bounds (call after player count changes) */
    applyPlayerCountBounds({ reason = 'playerCount', silent = false } = {}) {
        const clamped = this._clamp(this.size);
        if (clamped !== this.size) {
            
            this.size = clamped;
            this.reflect();
            this._bump();
            if (!silent) {
                try { this.onSizeChange(clamped, reason); } catch { /* ignore */ }
            }
        } else {
            this.reflect();
        }
        return this.size;
    }

    increment() { this.setSize(this.size + 1, 'click'); }
    decrement() { this.setSize(this.size - 1, 'click'); }

    _attachEvents() {
        if (this.decBtn) {
            this.decBtn.addEventListener('click', (e) => {
                if (this.decBtn.getAttribute('aria-disabled') === 'true') { e.preventDefault(); e.stopPropagation(); return; }
                this.decrement();
            });
        }
        if (this.incBtn) {
            this.incBtn.addEventListener('click', (e) => {
                if (this.incBtn.getAttribute('aria-disabled') === 'true') { e.preventDefault(); e.stopPropagation(); return; }
                this.increment();
            });
        }
    }

    getSize() { return this.size; }

    destroy() {
        try { this.decBtn && this.decBtn.replaceWith(this.decBtn.cloneNode(true)); } catch { /* ignore */ }
        try { this.incBtn && this.incBtn.replaceWith(this.incBtn.cloneNode(true)); } catch { /* ignore */ }
    }
}
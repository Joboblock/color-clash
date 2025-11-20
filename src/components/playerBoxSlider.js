(function (global) {
    'use strict';

    function noop() { }

    /**
     * PlayerBoxSlider component controlling the player count slider UI.
     * Handles rendering, ARIA, keyboard, pointer, and color animations.
     * @param {Object} options
     * @param {HTMLElement} options.rootEl - Root element containing the slider (e.g., #playerBoxSlider).
     * @param {number} [options.maxPlayers=8] - Maximum number of players supported.
     * @param {number} [options.minPlayers=2] - Minimum number of players allowed.
     * @param {number} [options.delayAnimation=300] - Animation duration in ms for preview shifts.
     * @param {() => string[]} options.getPlayerColors - Function returning the global list of color keys.
     * @param {() => number} options.getStartingColorIndex - Function returning current color-cycler index.
     * @param {(count:number, reason:'click'|'drag'|'key'|'programmatic') => void} [options.onCountChange] - Callback when the count changes.
     * @param {number} [options.initialCount] - Initial player count selection.
     */
    function PlayerBoxSlider(options) {
        const opts = options || {};
        this.rootEl = opts.rootEl || document.getElementById('playerBoxSlider');
    if (!this.rootEl) throw new Error('PlayerBoxSlider: rootEl not found');
        this.cellsEl = this.rootEl.querySelector('.slider-cells') || this.rootEl;
        this.maxPlayers = Math.max(2, opts.maxPlayers || 8);
        this.minPlayers = Math.max(2, opts.minPlayers || 2);
        this.delayAnimation = typeof opts.delayAnimation === 'number' ? opts.delayAnimation : 300;
        this.getPlayerColors = typeof opts.getPlayerColors === 'function' ? opts.getPlayerColors : function () { return ['green', 'red', 'blue', 'yellow', 'magenta', 'cyan', 'orange', 'purple']; };
        this.getStartingColorIndex = typeof opts.getStartingColorIndex === 'function' ? opts.getStartingColorIndex : function () { return 0; };
        this.onCountChange = typeof opts.onCountChange === 'function' ? opts.onCountChange : noop;

        this._currentPreview = null;
        this._isDragging = false;
        this._count = clamp(this, opts.initialCount != null ? opts.initialCount : this.minPlayers);

        // ARIA setup
        this.rootEl.setAttribute('role', 'slider');
        this.rootEl.setAttribute('aria-label', 'Player Count');
        this.rootEl.setAttribute('aria-valuemin', String(this.minPlayers));
        this.rootEl.setAttribute('aria-valuemax', String(this.maxPlayers));
        if (!this.rootEl.hasAttribute('tabindex')) this.rootEl.tabIndex = 0;

        this._buildBoxes();
        this.setCount(this._count, { silent: true });
        this._attachEvents();
    }

    function clamp(self, n) {
        const v = Math.floor(Number.isFinite(n) ? n : self.minPlayers);
        return Math.max(self.minPlayers, Math.min(self.maxPlayers, v));
    }

    /**
     * Build the visual player "box slider" (1..maxPlayers) and attach handlers.
     * Updates DOM under the component's cells container.
     * @returns {void}
     */
    PlayerBoxSlider.prototype._buildBoxes = function () {
        // Remove old boxes only
        Array.from(this.cellsEl.querySelectorAll('.box')).forEach(n => n.remove());

        const colors = this.getPlayerColors();
        const startIdx = this.getStartingColorIndex();
        const n = Array.isArray(colors) ? colors.length : 0;

        for (let count = 1; count <= this.maxPlayers; count++) {
            const box = document.createElement('div');
            box.className = 'box';
            box.dataset.count = String(count);
            box.title = `${count} player${count > 1 ? 's' : ''}`;
            if (n > 0) {
                const colorKey = colors[(startIdx + count - 1) % n];
                box.style.setProperty('--box-inner', `var(--inner-${colorKey})`);
                box.style.setProperty('--box-cell', `var(--cell-${colorKey})`);
            }
            box.setAttribute('draggable', 'false');
            box.addEventListener('dragstart', (ev) => ev.preventDefault());
            box.addEventListener('click', () => {
                const raw = parseInt(box.dataset.count, 10);
                const next = clamp(this, Math.max(this.minPlayers, raw));
                if (next !== this._count) {
                    this.setCount(next);
                    // Notify outer code that user picked a new count
                    try { this.onCountChange(next, 'click'); } catch (e) { void e; }
                }
            });
            this.cellsEl.appendChild(box);
        }
    };

    /**
     * Attach pointer and keyboard handlers for slider interactions.
     * - Pointer: drag to select nearest box.
     * - Keyboard: Arrow keys, Home/End adjust the count.
     * @returns {void}
     */
    PlayerBoxSlider.prototype._attachEvents = function () {
        const self = this;
        this._onPointerDown = function (e) {
            // Ignore pointer events that originate on the color cycler
            const target = e.target.closest('.menu-color-box');
            if (target) return;
            self._isDragging = true;
            try { self.rootEl.setPointerCapture(e.pointerId); } catch { /* ignore */ }
            self._setCountFromPointer(e.clientX);
        };
        this._onPointerMove = function (e) {
            if (!self._isDragging) return;
            self._setCountFromPointer(e.clientX);
        };
        this._onPointerUp = function (e) {
            self._isDragging = false;
            try { self.rootEl.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        };
        this._onPointerCancel = function () { self._isDragging = false; };
        this._onPointerLeave = function (e) { if (self._isDragging) self._setCountFromPointer(e.clientX); };

        this.rootEl.addEventListener('pointerdown', this._onPointerDown);
        this.rootEl.addEventListener('pointermove', this._onPointerMove);
        this.rootEl.addEventListener('pointerup', this._onPointerUp);
        this.rootEl.addEventListener('pointercancel', this._onPointerCancel);
        this.rootEl.addEventListener('pointerleave', this._onPointerLeave);

        this._onKeyDown = function (e) {
            const key = e.key;
            let handled = false;
            let newCount = self._count;
            if (key === 'ArrowLeft' || key === 'a' || key === 'A') { newCount = clamp(self, self._count - 1); handled = true; }
            else if (key === 'ArrowRight' || key === 'd' || key === 'D') { newCount = clamp(self, self._count + 1); handled = true; }
            else if (key === 'Home') { newCount = self.minPlayers; handled = true; }
            else if (key === 'End') { newCount = self.maxPlayers; handled = true; }
            if (handled) {
                e.preventDefault();
                if (newCount !== self._count) {
                    self.setCount(newCount);
                    try { self.onCountChange(newCount, 'key'); } catch (err) { void err; }
                }
            }
        };
        this.rootEl.addEventListener('keydown', this._onKeyDown);
    };

    /**
     * Map a pointer x-position to the nearest player box and update selection.
     * @param {number} clientX - pointer x-coordinate in viewport space.
     * @returns {void} updates selected player count via setCount and onCountChange.
     */
    PlayerBoxSlider.prototype._setCountFromPointer = function (clientX) {
        const children = Array.from(this.cellsEl.querySelectorAll('.box'));
        if (children.length === 0) return;
        let nearest = children[0];
        let nearestDist = Infinity;
        children.forEach(child => {
            const r = child.getBoundingClientRect();
            const center = r.left + r.width / 2;
            const d = Math.abs(clientX - center);
            if (d < nearestDist) { nearestDist = d; nearest = child; }
        });
        const mapped = clamp(this, Math.max(this.minPlayers, parseInt(nearest.dataset.count, 10)));
        if (mapped !== this._count) {
            this.setCount(mapped);
            try { this.onCountChange(mapped, 'drag'); } catch (e) { void e; }
        }
    };

    /**
     * Set the selected player count and reflect UI highlights and ARIA.
     * @param {number} count - requested player count.
     * @param {{silent?:boolean}} [options] - when silent, suppress onCountChange callback.
     * @returns {void}
     */
    PlayerBoxSlider.prototype.setCount = function (count, options) {
        const opts = options || {};
        const clamped = clamp(this, count);
        this._count = clamped;
        // aria now
        this.rootEl.setAttribute('aria-valuenow', String(clamped));
        // highlight
        const children = this.cellsEl.querySelectorAll('.box');
        children.forEach((child) => {
            const boxCount = parseInt(child.dataset.count, 10);
            if (boxCount <= clamped) child.classList.add('active'); else child.classList.remove('active');
        });
        if (!opts.silent) {
            try { this.onCountChange(clamped, 'programmatic'); } catch (e) { void e; }
        }
    };

    PlayerBoxSlider.prototype.getCount = function () { return this._count; };

    /**
     * Apply current rotated color mapping to all player boxes via CSS vars.
     * Uses the current starting color index.
     * @returns {void}
     */
    PlayerBoxSlider.prototype.updateColors = function () {
        const idx = this.getStartingColorIndex();
        this.updateColorsForIndex(idx);
    };

    /**
     * Apply box color CSS vars as if the rotation index were a specific value.
     * @param {number} index - rotation index into getPlayerColors() used for mapping.
     * @returns {void}
     */
    PlayerBoxSlider.prototype.updateColorsForIndex = function (index) {
        const colors = this.getPlayerColors();
        const n = Array.isArray(colors) ? colors.length : 0;
        const boxes = Array.from(this.cellsEl.querySelectorAll('.box'));
        boxes.forEach((box, idx) => {
            if (n === 0) return;
            const colorKey = colors[(index + (idx % n) + n) % n];
            box.style.setProperty('--box-inner', `var(--inner-${colorKey})`);
            box.style.setProperty('--box-cell', `var(--cell-${colorKey})`);
        });
    };

    // Helpers for preview animation
    /**
     * Measure bounding client rects for a list of elements.
     * @param {Element[]} els - elements to measure.
     * @returns {DOMRect[]} list of rects.
     */
    function measureRects(els) { return els.map(el => el.getBoundingClientRect()); }
    /**
     * Get computed background-color strings for elements.
     * @param {Element[]} els - elements to inspect.
     * @returns {string[]} CSS color strings.
     */
    function measureBackgroundColors(els) { return els.map(el => getComputedStyle(el).backgroundColor); }
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
    PlayerBoxSlider.prototype.previewShiftLeftThenSnap = function (mutateFn) {
        // Cancel a running preview
        if (this._currentPreview && typeof this._currentPreview.finalizeNow === 'function' && !this._currentPreview.finished) {
            try { this._currentPreview.finalizeNow(); } catch { /* ignore */ }
        }
        const container = this.cellsEl;
        if (!container) { mutateFn && mutateFn(); return; }
        const els = Array.from(container.querySelectorAll('.box'));
        if (els.length === 0) { mutateFn && mutateFn(); return; }

        const rects = measureRects(els);
        const colors = measureBackgroundColors(els);
        const animations = [];
        const delayAnimation = this.delayAnimation;

        for (let i = 0; i < els.length; i++) {
            const el = els[i];
            try { el.getAnimations().forEach(a => a.cancel()); } catch (e) { void e; }
            const hasActive = el.classList.contains('active');
            const baseline = hasActive ? ' translateY(-18%) scale(1.06)' : '';
            const baseTransform = baseline ? baseline : 'none';

            if (i === 0) {
                const outBase = delayAnimation * 0.4;
                const outDur = outBase * 0.5;
                const inDur = delayAnimation - outDur;
                const fadeOut = el.animate(
                    [{ transform: baseTransform, opacity: 1 }, { transform: baseTransform, opacity: 0 }],
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
                    [{ backgroundColor: fromColor }, { backgroundColor: toColor }],
                    { duration: delayAnimation, easing: 'ease', fill: 'none' }
                );
            } catch (e) { void e; }
        }

        const instance = { finished: false };
        instance.finalizeNow = () => {
            if (instance.finished) return;
            for (const el of els) {
                try { el.getAnimations().forEach(a => { try { a.cancel(); } catch { /* ignore */ } }); } catch { /* ignore */ }
            }
            try { mutateFn && mutateFn(); } catch { /* ignore */ }
            instance.finished = true;
            if (this._currentPreview === instance) this._currentPreview = null;
        };

        this._currentPreview = instance;

        const done = animations.length ? Promise.allSettled(animations.map(a => a.finished)) : Promise.resolve();
        done.finally(() => {
            if (instance.finished) return;
            for (const el of els) { try { el.getAnimations().forEach(a => a.cancel()); } catch { /* ignore */ } }
            mutateFn && mutateFn();
            instance.finished = true;
            if (this._currentPreview === instance) this._currentPreview = null;
        });
    };

    PlayerBoxSlider.prototype.destroy = function () {
        try {
            this.rootEl.removeEventListener('pointerdown', this._onPointerDown);
            this.rootEl.removeEventListener('pointermove', this._onPointerMove);
            this.rootEl.removeEventListener('pointerup', this._onPointerUp);
            this.rootEl.removeEventListener('pointercancel', this._onPointerCancel);
            this.rootEl.removeEventListener('pointerleave', this._onPointerLeave);
            this.rootEl.removeEventListener('keydown', this._onKeyDown);
        } catch { /* ignore */ }
    };

    // Export new name; keep old alias for backward compatibility (temporary)
    global.PlayerBoxSlider = PlayerBoxSlider;
    global.PlayerSlider = PlayerBoxSlider;
})(window);

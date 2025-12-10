// ES Module version of ColorCycler

/**
 * ColorCycler manages the starting color selection UI across one or two cycler elements.
 * It applies CSS variables to the cycler buttons, persists selection, and can tint the page
 * background while a menu is open. It does not own game logic; callers provide get/set index
 * and can react to changes via onChange.
 *
 * @param {Object} options
 * @param {HTMLElement|string} options.mainEl - Main menu cycler element or its id.
 * @param {HTMLElement|string} [options.onlineEl] - Optional online menu cycler element or its id.
 * @param {() => string[]} options.getColors - Returns available color keys (e.g., ['green', ...]).
 * @param {() => number} options.getIndex - Returns current starting color index (0-based).
 * @param {(idx:number) => void} options.setIndex - Sets current starting color index (0-based).
 * @param {(idx:number, reason:'click'|'init') => void} [options.onChange] - Notified when index changes.
 * @param {() => boolean} [options.isMenuOpen] - If true, body background is tinted on change.
 * @param {string} [options.storageKey='colorCyclerIndex'] - LocalStorage key for persistence.
 */
function ColorCycler(options) {
	const opts = options || {};
	this.mainEl = resolveEl(opts.mainEl);
	this.onlineEl = resolveEl(opts.onlineEl);
	if (!this.mainEl && !this.onlineEl) throw new Error('ColorCycler: no cycler elements provided');
	this.getColors = ensureFn(opts.getColors, () => ['green', 'red', 'blue', 'yellow', 'magenta', 'cyan', 'orange', 'purple']);
	this.getIndex = ensureFn(opts.getIndex, () => 0);
	this.setIndex = ensureFn(opts.setIndex, function () { });
	this.onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
	this.isMenuOpen = typeof opts.isMenuOpen === 'function' ? opts.isMenuOpen : () => false;
	this.storageKey = typeof opts.storageKey === 'string' ? opts.storageKey : 'colorCyclerIndex';

	this._clickHandler = this._onClick.bind(this);

	// Accessibility and initial setup
	[this.mainEl, this.onlineEl].forEach(el => { if (el) { if (!el.hasAttribute('tabindex')) el.tabIndex = 0; } });

	// Load persisted index if present
	const saved = tryParseInt(localStorage.getItem(this.storageKey));
	if (Number.isInteger(saved)) {
		this.setIndex(this._clampIndex(saved));
	}

	// Reflect current state
	this._applyToCyclers();
	this._applyBodyTint();
	if (this.onChange) {
		try { this.onChange(this.getIndex(), 'init'); } catch { /* ignore */ }
	}

	// Wire events
	if (this.mainEl) this.mainEl.addEventListener('click', this._clickHandler);
	if (this.onlineEl) this.onlineEl.addEventListener('click', this._clickHandler);
}

/**
 * Advance the starting color cycler by one and update dependent UI.
 * Handles persistence, body tint, and invokes the onChange callback.
 * Formerly implemented inline (cycleStartingColor + applyMenuColorBox + setMenuBodyColor).
 * @returns {void}
 */
ColorCycler.prototype._onClick = function () {
	const colors = this.getColors();
	if (!colors || !colors.length) return;
	const idx = (this.getIndex() + 1) % colors.length;
	this.setIndex(idx);
	this._applyToCyclers();
	this._applyBodyTint();
	try { localStorage.setItem(this.storageKey, String(idx)); } catch { /* ignore */ }
	if (this.onChange) {
		try { this.onChange(idx, 'click'); } catch { /* ignore */ }
	}
};

/**
 * Update the cycler UI elements to reflect the current selected color.
 * Replaces previous applyMenuColorBox implementation inside script.js.
 * @returns {void}
 */
ColorCycler.prototype._applyToCyclers = function () {
	const colors = this.getColors();
	const idx = this._clampIndex(this.getIndex());
	const key = colors && colors.length ? (colors[idx % colors.length] || 'green') : 'green';
	const outer = getComputedStyle(document.documentElement).getPropertyValue(`--cell-${key}`).trim();
	const inner = getComputedStyle(document.documentElement).getPropertyValue(`--inner-${key}`).trim();
	[this.mainEl, this.onlineEl].forEach(el => {
		if (!el) return;
		el.style.setProperty('--menu-outer-color', outer);
		el.style.setProperty('--menu-inner-color', inner);
	});
};

/**
 * Tint the page background to the current selected color when a menu is open.
 * Mirrors prior setMenuBodyColor logic.
 * @returns {void}
 */
ColorCycler.prototype._applyBodyTint = function () {
	if (!this.isMenuOpen || !this.isMenuOpen()) return;
	const colors = this.getColors();
	const idx = this._clampIndex(this.getIndex());
	const key = colors && colors.length ? (colors[idx % colors.length] || 'green') : 'green';
	document.body.className = key;
};

ColorCycler.prototype._clampIndex = function (n) {
	const colors = this.getColors();
	const max = (colors && colors.length) ? colors.length - 1 : 0;
	let v = parseInt(n, 10);
	if (!Number.isFinite(v) || isNaN(v)) v = 0;
	return Math.max(0, Math.min(max, v));
};

ColorCycler.prototype.destroy = function () {
	try { if (this.mainEl) this.mainEl.removeEventListener('click', this._clickHandler); } catch { /* ignore */ }
	try { if (this.onlineEl) this.onlineEl.removeEventListener('click', this._clickHandler); } catch { /* ignore */ }
};

function resolveEl(elOrId) {
	if (!elOrId) return null;
	if (typeof elOrId === 'string') return document.getElementById(elOrId) || null;
	return elOrId;
}

function ensureFn(fn, fallback) { return (typeof fn === 'function') ? fn : fallback; }
function tryParseInt(s) { try { const n = parseInt(String(s), 10); return Number.isNaN(n) ? null : n; } catch { return null; } }

export { ColorCycler };

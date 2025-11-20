/**
 * PlayerNameFields component
 * Encapsulates synchronization, sanitization, validity reflection and event wiring
 * for the local and online player name input fields. Falls back gracefully if one
 * of the fields is absent.
 */
import { sanitizeName, reflectValidity, PLAYER_NAME_LENGTH } from '../utils/nameUtils.js';

export class PlayerNameFields {
	/**
	 * @param {Object} opts
	 * @param {HTMLInputElement|null} opts.localInputEl - The local game menu name input.
	 * @param {HTMLInputElement|null} opts.onlineInputEl - The online menu name input.
	 * @param {() => void} [opts.onNameChange] - Callback after sanitized name changes.
	 * @param {string} [opts.storageKey] - localStorage key (default 'playerName').
	 */
	constructor({ localInputEl, onlineInputEl, onNameChange, storageKey = 'playerName' }) {
		this.localInputEl = localInputEl || null;
		this.onlineInputEl = onlineInputEl || null;
		this.onNameChange = typeof onNameChange === 'function' ? onNameChange : null;
		this.storageKey = storageKey;
		this.currentName = '';
		this._boundInputHandler = (e) => this._handleSanitize(e);
		this._boundKeyHandler = (e) => this._handleKeydown(e);
		this._init();
	}

	_init() {
		// Load initial name from storage or existing field value precedence: stored > local > online
		const stored = localStorage.getItem(this.storageKey);
		const fallback = this.localInputEl?.value || this.onlineInputEl?.value || 'Player';
		const initial = sanitizeName(stored || fallback);
		this.currentName = initial;
		this._applyToAll(initial);
		this._wire(this.localInputEl);
		this._wire(this.onlineInputEl);
	}

	_wire(el) {
		if (!el) return;
		try { el.maxLength = PLAYER_NAME_LENGTH; } catch { /* ignore */ }
		el.addEventListener('input', this._boundInputHandler);
		el.addEventListener('blur', this._boundInputHandler);
		el.addEventListener('change', this._boundInputHandler);
		el.addEventListener('keydown', this._boundKeyHandler);
	}

	_unwire(el) {
		if (!el) return;
		el.removeEventListener('input', this._boundInputHandler);
		el.removeEventListener('blur', this._boundInputHandler);
		el.removeEventListener('change', this._boundInputHandler);
		el.removeEventListener('keydown', this._boundKeyHandler);
	}

	/** External setter; will sanitize automatically */
	setName(name) {
		const cleaned = sanitizeName(name || '');
		if (cleaned === this.currentName) return;
		this.currentName = cleaned;
		localStorage.setItem(this.storageKey, cleaned);
		this._applyToAll(cleaned);
		if (this.onNameChange) {
			try { this.onNameChange(cleaned); } catch { /* ignore */ }
		}
	}

	getName() {
		return this.currentName;
	}

	_applyToAll(name) {
		if (this.localInputEl) {
			this.localInputEl.value = name;
			reflectValidity(this.localInputEl, name);
		}
		if (this.onlineInputEl) {
			this.onlineInputEl.value = name;
			reflectValidity(this.onlineInputEl, name);
		}
	}

	_handleSanitize(e) {
		const el = e.target;
		const raw = el.value;
		const cleaned = sanitizeName(raw);
		if (raw !== cleaned) {
			const pos = Math.min(cleaned.length, PLAYER_NAME_LENGTH);
			el.value = cleaned;
			try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
		}
		reflectValidity(el, el.value);
		this.setName(el.value); // will sanitize again but cheap
	}

	_handleKeydown(e) {
		if (e.key === 'Enter') {
			// On Enter, commit current sanitized value
			this.setName(e.target.value);
		}
		// Arrow navigation constraints mirroring previous logic
		const el = e.target;
		if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') && el.value === '') {
			// allow default navigation when empty; else prevent bubble for consistency
		} else {
			// no-op placeholder for potential future accessibility tweaks
		}
	}

	destroy() {
		this._unwire(this.localInputEl);
		this._unwire(this.onlineInputEl);
	}
}

export default PlayerNameFields;

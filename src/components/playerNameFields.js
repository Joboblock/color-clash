/**
 * PlayerNameFields component
 * Encapsulates synchronization, sanitization, validity reflection and event wiring
 * for the local and online player name input fields. Falls back gracefully if one
 * of the fields is absent.
 */
import { sanitizeName, checkNameLengthValidity, isNameLengthValid } from '../utils/generalUtils.js';
import { MAX_PLAYER_NAME_LENGTH } from '../config/index.js';

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
		try { el.maxLength = MAX_PLAYER_NAME_LENGTH; } catch { /* ignore */ }
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
	setLocalStorageName(name) {
		const cleaned = sanitizeName(name);
		if (cleaned === this.currentName) return;
		this.currentName = cleaned;
		if (isNameLengthValid(cleaned)) {
			localStorage.setItem(this.storageKey, cleaned);
		} else {
			localStorage.removeItem(this.storageKey);
		}
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
			if (this.localInputEl.value !== name) this.localInputEl.value = name;
			checkNameLengthValidity(this.localInputEl, name);
		}
		if (this.onlineInputEl) {
			if (this.onlineInputEl.value !== name) this.onlineInputEl.value = name;
			checkNameLengthValidity(this.onlineInputEl, name);
		}
	}

	_handleSanitize(e) {
		const el = e.target;
		const raw = el.value;
		const cleaned = sanitizeName(raw);
		if (raw !== cleaned) {
			const pos = el.selectionStart ?? raw.length;
			const nextPos = sanitizeName(raw.slice(0, pos)).length;
			el.value = cleaned;
			try { el.setSelectionRange(nextPos, nextPos); } catch { /* ignore */ }
		}
		checkNameLengthValidity(el, el.value);
		this.setLocalStorageName(el.value);
	}

	_handleKeydown(e) {
		if (e.key === 'Enter') {
			// On Enter, commit current sanitized value
			this.setLocalStorageName(e.target.value);
		}
		const el = e.target;
		// Allow slider / external arrow navigation if input is empty.
		// If the input has content, stop propagation so PlayerBoxSlider (or other key listeners) doesn't hijack arrow keys.
		if (el && el.value !== '' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
			// Let the browser handle caret movement but prevent higher-level components from reacting.
			e.stopPropagation();
		}
	}

	destroy() {
		this._unwire(this.localInputEl);
		this._unwire(this.onlineInputEl);
	}
}

export default PlayerNameFields;

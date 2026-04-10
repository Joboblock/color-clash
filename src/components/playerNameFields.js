/**
 * PlayerNameFields component
 * Encapsulates sanitization, validity reflection and event wiring
 * for the online player name input field.
 */
import { sanitizeName, checkNameLengthValidity, getClientName } from '../utils/generalUtils.js';
import { MAX_PLAYER_NAME_LENGTH, PLAYER_NAME } from '../config/index.js';

export class PlayerNameFields {
	/**
	 * @param {Object} opts
	 * @param {HTMLInputElement|null} opts.onlineInputEl - The online menu name input.
	 * @param {() => void} [opts.onNameChange] - Callback after sanitized name changes.
	 */
	constructor({ onlineInputEl, onNameChange}) {
		this.onlineInputEl = onlineInputEl || null;
		this.onNameChange = typeof onNameChange === 'function' ? onNameChange : null;
		this.currentName = '';
		this._boundInputHandler = (e) => this._handleSanitize(e);
		this._boundKeyHandler = (e) => this._handleKeydown(e);
		this._init();
	}

	_init() {
		if (!this.onlineInputEl) return;
		this.currentName = getClientName(this.onlineInputEl);
		this._apply(this.currentName);
		this._wire();
	}

	_wire() {
		const el = this.onlineInputEl;
		if (!el) return;
		try { el.maxLength = MAX_PLAYER_NAME_LENGTH; } catch { /* ignore */ }
		el.addEventListener('input', this._boundInputHandler);
		el.addEventListener('blur', this._boundInputHandler);
		el.addEventListener('change', this._boundInputHandler);
		el.addEventListener('keydown', this._boundKeyHandler);
	}

	_unwire() {
		const el = this.onlineInputEl;
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
		localStorage.setItem(PLAYER_NAME, cleaned);
		this._apply(cleaned);
		if (this.onNameChange) {
			try { this.onNameChange(cleaned); } catch { /* ignore */ }
		}
	}

	getName() {
		return this.currentName;
	}

	_apply(name) {
		const el = this.onlineInputEl;
		if (!el) return;
		if (el.value !== name) el.value = name;
		checkNameLengthValidity(el, name);
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
		this._unwire();
	}
}

export default PlayerNameFields;

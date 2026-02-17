// ES Module: QrCodeButton
// Encapsulates behavior and accessibility for the QR code menu button.
/**
 * @typedef {Object} QrCodeButtonOptions
 * @property {HTMLElement[]|HTMLElement|null} buttons - One or more button elements.
 * @property {(event:MouseEvent) => void} [onClick] - Optional click handler for QR button.
 */
export class QrCodeButton {
    /**
     * @param {QrCodeButtonOptions} opts
     */
    constructor(opts = {}) {
        this.buttons = Array.isArray(opts.buttons) ? opts.buttons.filter(Boolean) : (opts.buttons ? [opts.buttons] : []);
        this.onClick = typeof opts.onClick === 'function' ? opts.onClick : null;
        this._onClick = this._onClick.bind(this);
        this._wire();
    }

    _wire() {
        for (const btn of this.buttons) {
            try {
                btn.classList.add('menu-color-box', 'qr-code-btn');
                btn.classList.remove('menu-close-btn');
                if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'QR code');
                if (!btn.getAttribute('title')) btn.setAttribute('title', 'QR code');
                if (!btn.hasAttribute('tabindex')) btn.tabIndex = 0;
                btn.addEventListener('click', this._onClick);
            } catch { /* ignore */ }
        }
    }

    _onClick(event) {
        if (!this.onClick) return;
        try { this.onClick(event); } catch { /* ignore */ }
    }

    destroy() {
        for (const btn of this.buttons) {
            try { btn.removeEventListener('click', this._onClick); } catch { /* ignore */ }
        }
    }
}

export default QrCodeButton;

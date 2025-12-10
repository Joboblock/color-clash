// ES Module: MenuCloseButton
// Encapsulates the logic for the top-right "X" buttons that close or navigate
// between menus. Supports multiple button elements sharing the same behavior.
/**
 * @typedef {Object} MenuCloseButtonOptions
 * @property {HTMLElement[]|HTMLElement|null} buttons - One or more button elements.
 * @property {() => string|null} getCurrentMenu - Returns current menu slug from URL/state.
 * @property {(target:string) => void} navigateToMenu - Function to show target menu (no history push).
 * @property {(menu:string, push:boolean) => void} setMenuParam - Update URL/menu param (replace/push).
 * @property {string[]} menuHistoryStack - Reference to shared history stack (mutable array).
 */
export class MenuCloseButton {
    /**
     * @param {MenuCloseButtonOptions} opts
     */
    constructor(opts) {
        this.buttons = Array.isArray(opts.buttons) ? opts.buttons.filter(Boolean) : (opts.buttons ? [opts.buttons] : []);
        this.getCurrentMenu = typeof opts.getCurrentMenu === 'function' ? opts.getCurrentMenu : () => null;
        this.navigateToMenu = typeof opts.navigateToMenu === 'function' ? opts.navigateToMenu : () => { };
        this.setMenuParam = typeof opts.setMenuParam === 'function' ? opts.setMenuParam : () => { };
        this.menuHistoryStack = Array.isArray(opts.menuHistoryStack) ? opts.menuHistoryStack : [];
        this._onClick = this._onClick.bind(this);
        this._wire();
    }

    _wire() {
        for (const btn of this.buttons) {
            try {
                btn.addEventListener('click', this._onClick);
                if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', 'Close menu');
                if (!btn.hasAttribute('tabindex')) btn.tabIndex = 0;
            } catch { /* ignore */ }
        }
    }

    _computeTargetMenu(current) {
        if (!current) return null;
        // Match original script.js logic
        if (current === 'host') return 'online';
        if (current === 'local' || current === 'online' || current === 'practice') return 'first';
        return null;
    }

    _onClick() {
        const current = this.getCurrentMenu();
        const expectedMenu = this._computeTargetMenu(current);
        if (!expectedMenu) return;
        const prev = this.menuHistoryStack.length >= 2 ? this.menuHistoryStack[this.menuHistoryStack.length - 2] : null;
        if (prev === expectedMenu) {
            try { window.history.back(); return; } catch { /* ignore */ }
        }
        // replace state, then navigate
        try { this.setMenuParam(expectedMenu, false); } catch { /* ignore */ }
        try { this.navigateToMenu(expectedMenu); } catch { /* ignore */ }
    }

    destroy() {
        for (const btn of this.buttons) {
            try { btn.removeEventListener('click', this._onClick); } catch { /* ignore */ }
        }
    }
}

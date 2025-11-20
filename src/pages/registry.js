// Central page registry to manage menu page modules.
// It hides/shows page root elements and invokes lifecycle hooks.

class PageRegistry {
    constructor() {
        this.pages = new Map();
    }
    register(pages) {
        (pages || []).forEach(p => {
            if (!p || !p.id) return;
            this.pages.set(p.id, p);
        });
    }
    get(id) { return this.pages.get(id); }
    /**
     * Open a page by id. Non-active pages are hidden (unless they share the same selector).
     * @param {string} id
     * @param {object} ctx optional shared context object passed to hooks
     */
    open(id, ctx = {}) {
        const target = this.get(id);
        if (!target) {
            console.warn('[PageRegistry] Unknown page id:', id);
            return;
        }
        this.pages.forEach(p => {
            if (p === target) return;
            try {
                const el = document.querySelector(p.selector);
                if (el && p.selector !== target.selector) {
                    el.classList.add('hidden');
                    el.setAttribute('aria-hidden', 'true');
                    if (p.hide) { try { p.hide(ctx); } catch { /* ignore */ } }
                }
            } catch { /* ignore */ }
        });
        // Show target
        try {
            const el = document.querySelector(target.selector);
            if (el) {
                el.classList.remove('hidden');
                el.setAttribute('aria-hidden', 'false');
            }
            if (target.show) { try { target.show(ctx); } catch { /* ignore */ } }
        } catch { /* ignore */ }
    }
    /** Run init() for all pages after DOM ready. */
    initAll(ctx = {}) {
        this.pages.forEach(p => {
            if (p.init) { try { p.init(ctx); } catch { /* ignore */ } }
        });
    }
}

export const pageRegistry = new PageRegistry();

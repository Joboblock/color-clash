// Host menu page module.
// Shares root with local/practice (#mainMenu) but configures host mode.

const hostPage = {
    id: 'host',
    selector: '#mainMenu',
    init() {
        // Placeholder for host-specific setup (e.g., grid size controls).
    },
    show(ctx) {
        try { ctx && ctx.setMainMenuMode && ctx.setMainMenuMode('host'); } catch { /* ignore */ }
        // Mark openedBy for existing logic relying on dataset.
        try {
            const el = document.querySelector('#mainMenu');
            if (el) el.dataset.openedBy = 'host';
        } catch { /* ignore */ }
    },
    hide() {
        try {
            const el = document.querySelector('#mainMenu');
            if (el && el.dataset.openedBy === 'host') delete el.dataset.openedBy;
        } catch { /* ignore */ }
    }
};

export default hostPage;

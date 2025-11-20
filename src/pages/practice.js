// Practice menu page module.
// Shares #mainMenu root; sets practice mode and updates AI preview if available.

const practicePage = {
    id: 'practice',
    selector: '#mainMenu',
    init() {
        // Placeholder for future practice-mode specific initialization.
    },
    show(ctx) {
        try { ctx && ctx.setMainMenuMode && ctx.setMainMenuMode('practice'); } catch { /* ignore */ }
        // Update AI preview tile if provided via context.
        try { ctx && ctx.aiStrengthTile && ctx.aiStrengthTile.updatePreview && ctx.aiStrengthTile.updatePreview(); } catch { /* ignore */ }
    },
    hide() { /* no-op */ }
};

export default practicePage;

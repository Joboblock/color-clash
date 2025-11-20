// Online menu page module.
// Handles visibility of #onlineMenu and can trigger connection banners.

const onlinePage = {
    id: 'online',
    selector: '#onlineMenu',
    init() {
        // Reserved for future: populate room list, bind buttons, etc.
    },
    show(ctx) {
        // Initiate (re)connection if not already connected.
        try { ctx && ctx.onlineConnection && ctx.onlineConnection.ensureConnected(); } catch { /* ignore */ }
        // If not connected, request banner display.
        try {
            if (ctx && ctx.onlineConnection && !ctx.onlineConnection.isConnected()) {
                ctx.showConnBanner && ctx.showConnBanner('Reconnecting…', 'info');
            } else {
                ctx.hideConnBanner && ctx.hideConnBanner();
            }
        } catch { /* ignore */ }
        // Refresh start button state if provided.
        try { ctx && ctx.updateStartButtonState && ctx.updateStartButtonState(); } catch { /* ignore */ }
    },
    hide(ctx) {
        // Hide connection banner when leaving online page.
        try { ctx && ctx.hideConnBanner && ctx.hideConnBanner(); } catch { /* ignore */ }
    }
};

export default onlinePage;

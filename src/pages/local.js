// Local game menu page module.
// Shares the same DOM root (#mainMenu) with other modes (host, practice).

const localPage = {
	id: 'local',
	selector: '#mainMenu',
	init() {
		// Could attach specific listeners for local mode here.
	},
	show(ctx) {
		// Expect setMainMenuMode to be provided via ctx to adjust layout.
		try { ctx && ctx.setMainMenuMode && ctx.setMainMenuMode('local'); } catch { /* ignore */ }
	},
	hide() { /* no-op */ }
};

export default localPage;
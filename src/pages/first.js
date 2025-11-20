// First menu page module
// Provides a consistent interface consumed by the central page registry.
// Contract (lightweight):
//  id        unique key matching ?menu param value
//  selector  CSS selector resolving to the root element
//  init(ctx) one-time setup after DOMContentLoaded (optional)
//  show(ctx) invoked when page becomes active (optional)
//  hide(ctx) invoked when page is hidden (optional)

const firstPage = {
	id: 'first',
	selector: '#firstMenu',
	init() {
		// Placeholder for any future event wiring specific to the first screen.
		// ctx can provide shared utilities if needed later.
	},
	show(ctx) {
		// Ensure body color mirrors current starting color if provided.
		try {
			const { playerColors, startingColorIndex } = ctx || {};
			if (Array.isArray(playerColors)) {
				const colorKey = playerColors[startingColorIndex || 0] || playerColors[0];
				if (colorKey) document.body.className = colorKey;
			}
		} catch {/* ignore */}
	},
	hide() {
		// No-op for now.
	}
};

export default firstPage;
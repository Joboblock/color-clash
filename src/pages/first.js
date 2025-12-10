// First (landing) menu page module.
// Adds menu close button component for first + online menus.

import { MenuCloseButton } from '../components/menuCloseButton.js';

export const firstPage = {
	id: 'first',
	selector: '#firstMenu',
	components: {},
	init(ctx = {}) {
		// Initialize menu close button component (top-right buttons)
		const menuTopRightBtn = document.getElementById('menuTopRightBtn');
		const onlineTopRightBtn = document.getElementById('onlineTopRightBtn');
		let closeButtons = null;
		try {
			closeButtons = new MenuCloseButton({
				buttons: [menuTopRightBtn, onlineTopRightBtn],
				getCurrentMenu: () => (new URLSearchParams(window.location.search)).get('menu'),
				navigateToMenu: (target) => ctx.showMenuFor && ctx.showMenuFor(target),
				setMenuParam: (menu, push) => ctx.setMenuParam && ctx.setMenuParam(menu, push),
				menuHistoryStack: ctx.menuHistoryStack || []
			});
		} catch {/* ignore */ }
		this.components = { closeButtons };
	},
	show(ctx) {
		try {
			const { playerColors, startingColorIndex } = ctx || {};
			if (Array.isArray(playerColors) && typeof startingColorIndex === 'number') {
				document.body.className = playerColors[startingColorIndex] || 'green';
			}
		} catch {/* ignore */ }
	},
	hide() { /* no-op */ }
};

export default firstPage;
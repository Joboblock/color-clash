// Online menu page module: hosts room list component.
import { OnlineRoomList } from '../components/onlineRoomList.js';

export const onlinePage = {
	id: 'online',
	selector: '#onlineMenu',
	components: {},
	init(ctx = {}) {
		const roomListElement = document.getElementById('roomList');
		let roomListView = null;
		try {
			roomListView = new OnlineRoomList({
				rootEl: roomListElement,
				getCurrentRoom: () => ctx.getMyJoinedRoom && ctx.getMyJoinedRoom(),
				getPlayerName: () => ctx.getPlayerName && ctx.getPlayerName(),
				onHost: () => ctx.hostRoom && ctx.hostRoom(),
				onJoin: (roomName) => ctx.joinRoom && ctx.joinRoom(roomName),
				onLeave: (roomName) => ctx.leaveRoom && ctx.leaveRoom(roomName)
			});
		} catch {/* ignore */}
		this.components = { roomListView };
	},
	show(ctx) {
		const { onlineConnection, updateStartButtonState, showConnBanner, hideConnBanner } = ctx || {};
		try { updateStartButtonState && updateStartButtonState(); } catch {/* ignore */}
		try {
			if (onlineConnection && !onlineConnection.isConnected()) {
				showConnBanner && showConnBanner('Reconnecting…', 'info');
				onlineConnection.ensureConnected && onlineConnection.ensureConnected();
			} else {
				hideConnBanner && hideConnBanner();
			}
		} catch {/* ignore */}
	},
	hide(ctx) {
		const { hideConnBanner } = ctx || {};
		try { hideConnBanner && hideConnBanner(); } catch {/* ignore */}
	}
};

export default onlinePage;

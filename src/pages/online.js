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
		} catch {/* ignore */ }
		this.components = { roomListView };
	},
	show(ctx) {
		const { onlineConnection, updateStartButtonState, showConnBanner, hideConnBanner } = ctx || {};
		try { updateStartButtonState && updateStartButtonState(); } catch {/* ignore */ }
		try {
			if (onlineConnection && !onlineConnection.isConnected()) {
				showConnBanner && showConnBanner('Reconnecting…', 'info');
				onlineConnection.ensureConnected && onlineConnection.ensureConnected();
			} else {
				hideConnBanner && hideConnBanner();
			}
		} catch {/* ignore */ }
		try {
			if (onlineConnection) {
				const history = Array.isArray(ctx?.menuHistoryStack) ? ctx.menuHistoryStack : [];
				const prevMenu = history.length > 1 ? history[history.length - 2] : null;
				const shouldRequestList = prevMenu === 'first' || prevMenu === null;
				if (shouldRequestList) {
					const requestList = () => {
						try { onlineConnection.off && onlineConnection.off('open', requestList); } catch {/* ignore */ }
						onlineConnection.requestRoomList && onlineConnection.requestRoomList();
					};
					if (onlineConnection.isConnected && onlineConnection.isConnected()) requestList();
					else onlineConnection.on && onlineConnection.on('open', requestList);
				}
			}
		} catch {/* ignore */ }
	},
	hide(ctx) {
		const { hideConnBanner, leaveRoom, getMyJoinedRoom, removeUrlRoomKey } = ctx || {};
		try { hideConnBanner && hideConnBanner(); } catch {/* ignore */ }
		// Leave the room when exiting the online menu (server handles like a normal leave)
		try {
			const currentRoom = getMyJoinedRoom && getMyJoinedRoom();
			if (currentRoom && leaveRoom) {
				leaveRoom(currentRoom);
			}
			// Remove the key from URL
			if (removeUrlRoomKey) {
				removeUrlRoomKey();
			}
		} catch {/* ignore */ }
		// Note: websocket lifecycle is managed centrally by menu navigation (see script.js)
	}
};

export default onlinePage;

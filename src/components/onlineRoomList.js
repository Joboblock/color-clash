/**
 * OnlineRoomList component encapsulates rendering of the online rooms <ul> list.
 * It partitions rooms into: current user's room, joinable rooms, and full rooms,
 * and renders appropriate action buttons (Leave / Join / Full / Host placeholder).
 *
 * Responsibilities:
 *  - DOM diff is naive: clears and rebuilds list each render (room counts are small).
 *  - Emits user intent via provided callbacks (onHost/onJoin/onLeave).
 *  - Provides a placeholder Host button when there are zero rooms.
 *
 * It deliberately does NOT own networking logic – callers pass callbacks that
 * invoke the OnlineConnection instance.
 *
 * @typedef {{currentPlayers:number, maxPlayers:number, players?:Array<{name:string}>, hostName?:string}} RoomInfo
 */
export class OnlineRoomList {
    /**
     * @param {Object} opts
     * @param {HTMLElement|null} opts.rootEl <ul> element that will contain <li> room entries.
     * @param {() => string|null} opts.getCurrentRoom Returns the room name the client is currently in.
     * @param {() => string} opts.getPlayerName Returns current local player name for hosting fallback.
     * @param {() => void} [opts.onHost] Invoked when user clicks the Host placeholder button.
     * @param {(roomName:string) => void} [opts.onJoin] Invoked when user wants to join a room.
     * @param {(roomName:string) => void} [opts.onLeave] Invoked when user wants to leave their room.
     */
    constructor({ rootEl, getCurrentRoom, getPlayerName, onHost, onJoin, onLeave }) {
        this.rootEl = rootEl;
        this.getCurrentRoom = getCurrentRoom || (() => null);
        this.getPlayerName = getPlayerName || (() => 'Player');
        this.onHost = onHost || (() => { });
        this.onJoin = onJoin || (() => { });
        this.onLeave = onLeave || (() => { });
    }

    /**
     * Render the rooms list.
     * @param {Record<string, RoomInfo>} rooms
     */
    render(rooms) {
        if (!this.rootEl) return;
        // Keep a global copy if other code relies on it (legacy support)
        window.lastRoomList = rooms;

        // Clear existing entries
        while (this.rootEl.firstChild) this.rootEl.removeChild(this.rootEl.firstChild);

        const entries = Object.entries(rooms || {});
        const currentRoom = this.getCurrentRoom();
        const my = [];
        const joinable = [];
        const full = [];
        for (const [roomName, infoRaw] of entries) {
            const info = infoRaw || {};
            const currentPlayers = Number.isFinite(info.currentPlayers) ? info.currentPlayers : 0;
            const maxPlayers = Number.isFinite(info.maxPlayers) ? info.maxPlayers : 2;
            if (roomName === currentRoom) my.push([roomName, info]);
            else if (currentPlayers < maxPlayers) joinable.push([roomName, info]);
            else full.push([roomName, info]);
        }
        const ordered = [...my, ...joinable, ...full];

        if (ordered.length === 0) {
            // Placeholder Host button when no rooms exist yet
            const li = document.createElement('li');
            li.className = 'room-list-item';
            const btn = document.createElement('button');
            btn.className = 'room-btn';
            btn.textContent = 'Host';
            btn.addEventListener('click', () => {
                try { this.onHost(); } catch { /* ignore */ }
            });
            const nameSpan = document.createElement('span');
            nameSpan.className = 'room-name';
            nameSpan.textContent = 'Empty Game';
            const countSpan = document.createElement('span');
            countSpan.className = 'room-player-count';
            countSpan.textContent = '(0/2)';
            li.appendChild(btn);
            li.appendChild(nameSpan);
            li.appendChild(countSpan);
            this.rootEl.appendChild(li);
            return;
        }

        for (const [roomName, info] of ordered) {
            const currentPlayers = Number.isFinite(info.currentPlayers) ? info.currentPlayers : 0;
            const maxPlayers = Number.isFinite(info.maxPlayers) ? info.maxPlayers : 2;
            const li = document.createElement('li');
            li.className = 'room-list-item';
            const btn = document.createElement('button');
            btn.className = 'room-btn';
            const isMine = roomName === currentRoom;
            const isFull = currentPlayers >= maxPlayers;
            if (isMine) {
                btn.classList.add('leave');
                btn.textContent = 'Leave';
                btn.addEventListener('click', () => { try { this.onLeave(roomName); } catch { /* ignore */ } });
            } else if (isFull) {
                btn.classList.add('full');
                btn.textContent = 'Full';
                btn.disabled = true;
            } else {
                btn.textContent = 'Join';
                btn.addEventListener('click', () => { try { this.onJoin(roomName); } catch { /* ignore */ } });
            }
            const nameSpan = document.createElement('span');
            nameSpan.className = 'room-name';
            nameSpan.textContent = `${roomName}'s Game`;
            const countSpan = document.createElement('span');
            countSpan.className = 'room-player-count';
            countSpan.textContent = `(${currentPlayers}/${maxPlayers})`;
            li.appendChild(btn);
            li.appendChild(nameSpan);
            li.appendChild(countSpan);
            this.rootEl.appendChild(li);
        }
    }
}

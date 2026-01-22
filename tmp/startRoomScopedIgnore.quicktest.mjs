// Quick regression check for room-scoped duplicate start ignoring.
// Goal: ensure "ignore start" only triggers when the SAME roomKey has started once.
// This is a logic-only test of the window-scoped state introduced in script.js.

function shouldIgnoreStart({ onlineGameActive, roomKey, startedOnceByRoomKey }) {
  // Mirrors the relevant logic in script.js (defensive, roomKey-scoped)
  const startedOnce = roomKey && startedOnceByRoomKey[roomKey];
  return Boolean(onlineGameActive && startedOnce);
}

// Host path ('start_cnf') uses the same condition: only ignore if this room has started once already.
function shouldIgnoreStartCnf({ onlineGameActive, roomKey, startedOnceByRoomKey }) {
  const startedOnce = roomKey && startedOnceByRoomKey[roomKey];
  return Boolean(onlineGameActive && startedOnce);
}

function assert(cond, msg) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// Scenario:
// 1) Room A starts -> mark startedOnceByRoomKey[A]=true
// 2) Leave room A -> delete startedOnceByRoomKey[A]
// 3) Join room B and receive its first start while "onlineGameActive" might still be true briefly
//    -> must NOT ignore because startedOnceByRoomKey[B] is false/undefined

const startedOnceByRoomKey = Object.create(null);

// Room A started once
startedOnceByRoomKey.A = true;
assert(shouldIgnoreStart({ onlineGameActive: true, roomKey: 'A', startedOnceByRoomKey }) === true, 'duplicate start in same room should be ignored');

// Leave A
delete startedOnceByRoomKey.A;

// First start in new room B must not be ignored
assert(shouldIgnoreStart({ onlineGameActive: true, roomKey: 'B', startedOnceByRoomKey }) === false, 'first start in new room must not be ignored');

// If we process B start, we would mark it started
startedOnceByRoomKey.B = true;
assert(shouldIgnoreStart({ onlineGameActive: true, roomKey: 'B', startedOnceByRoomKey }) === true, 'duplicate start in B should be ignored after first start');

// Host scenario: leave room A after hosting a game, then host room B.
const startedOnceHost = Object.create(null);
startedOnceHost.A = true;
assert(shouldIgnoreStartCnf({ onlineGameActive: true, roomKey: 'A', startedOnceByRoomKey: startedOnceHost }) === true, 'duplicate start_cnf in same room should be ignored');
delete startedOnceHost.A;
assert(shouldIgnoreStartCnf({ onlineGameActive: true, roomKey: 'B', startedOnceByRoomKey: startedOnceHost }) === false, 'first start_cnf in new room must not be ignored');

console.log('PASS: room-scoped start ignore logic');

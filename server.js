/**
 * COMBAT OS – WebSocket Game Server
 * Run: node server.js
 * Requires: npm install ws
 *
 * KEY FIX: 'join' is NOT broadcast immediately on connection.
 * It is held until 'setName' arrives (which includes modelId).
 * This means every client always receives 'join' with the correct
 * modelId — eliminating the t800-default race entirely.
 */

const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss  = new WebSocket.Server({ port: PORT });

// --- Helpers ---
function uid() { return Math.random().toString(36).slice(2, 9).toUpperCase(); }

function broadcast(excludeWs, data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(c => {
        if (c !== excludeWs && c.readyState === WebSocket.OPEN) c.send(msg);
    });
}

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// id -> { ws, ready, state: { pos, rotY, health, isShooting, name, modelId } }
const players = new Map();

wss.on('connection', (ws) => {
    const id = uid();

    players.set(id, {
        ws,
        ready: false,   // ← flips to true only after setName is received
        state: {
            pos: { x:0, y:0, z:0 }, rotY: 0, health: 100,
            isShooting: false, name: 'SPARTAN', modelId: 't800'
        }
    });

    console.log(`[+] Player ${id} connected  (${players.size} online)`);

    // Send the new player their ID + states of ALL READY players (correct modelIds)
    send(ws, {
        type: 'init',
        id,
        players: [...players.entries()]
            .filter(([pid, p]) => pid !== id && p.ready)
            .map(([pid, p]) => ({ id: pid, state: p.state }))
    });

    // NOTE: we do NOT broadcast 'join' here yet.
    // It fires in 'setName' once we have the real modelId.

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

            // ── setName — first message the client always sends after connect ──
            // Contains name + modelId. Once received, the player is 'ready'
            // and we broadcast their join to everyone else.
            case 'setName': {
                const entry = players.get(id);
                if (!entry) break;

                entry.state.name    = String(msg.name    || 'SPARTAN').slice(0, 16);
                entry.state.modelId = String(msg.modelId || 't800'   ).slice(0, 32);

                if (!entry.ready) {
                    // First setName: mark ready and announce join to others
                    entry.ready = true;
                    broadcast(ws, { type: 'join', id, state: entry.state });
                    console.log(`[READY] ${id} as ${entry.state.name} (${entry.state.modelId})`);
                } else {
                    // Subsequent setName (e.g. name change): broadcast updated state
                    broadcast(ws, { type: 'move', id, state: entry.state });
                }
                break;
            }

            // ── move — position/state tick sent ~20 Hz ──
            case 'move': {
                const entry = players.get(id);
                if (entry && entry.ready) {
                    entry.state = { ...entry.state, ...msg.state };
                    broadcast(ws, { type: 'move', id, state: entry.state });
                }
                break;
            }

            // ── hit — player reports hitting another player ──
            case 'hit': {
                const target = players.get(msg.targetId);
                if (target) {
                    send(target.ws, { type: 'damage', from: id, amount: msg.amount });
                    console.log(`[HIT] ${id} -> ${msg.targetId} for ${msg.amount} dmg`);
                }
                break;
            }

            // ── dead — player reports their own death ──
            case 'dead': {
                const entry = players.get(id);
                if (entry) entry.state.health = 0;
                broadcast(ws, { type: 'dead', id });
                console.log(`[DEAD] ${id}`);
                break;
            }

            // ── respawn — player has come back to life ──
            // Server resets health and re-broadcasts as 'join' so all clients
            // call resetForRespawn() on the existing RemotePlayer (no GLB reload).
            case 'respawn': {
                const entry = players.get(id);
                if (entry && entry.ready) {
                    entry.state.health  = 100;
                    if (msg.modelId) entry.state.modelId = String(msg.modelId).slice(0, 32);
                    broadcast(ws, { type: 'join', id, state: entry.state });
                    console.log(`[RESPAWN] ${id}`);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        players.delete(id);
        broadcast(ws, { type: 'leave', id });
        console.log(`[-] Player ${id} disconnected  (${players.size} online)`);
    });

    ws.on('error', err => console.error(`[WS ERROR] ${id}:`, err.message));
});

const os = require('os');
function getLocalIP() {
    for (const ifaces of Object.values(os.networkInterfaces()))
        for (const i of ifaces)
            if (i.family === 'IPv4' && !i.internal) return i.address;
    return 'localhost';
}
console.log(`\n🎮  COMBAT OS Server  –  ws://${getLocalIP()}:${PORT}\n`);
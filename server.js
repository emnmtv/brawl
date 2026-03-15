/**
 * COMBAT OS – WebSocket Game Server
 * Run: node server.js
 * Requires: npm install ws
 */

const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });

// --- Helpers ---
function uid() {
    return Math.random().toString(36).slice(2, 9).toUpperCase();
}

function broadcast(excludeWs, data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
            client.send(msg);
        }
    });
}

function send(ws, data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

// --- Player registry ---
// id -> { ws, state: { pos, rotY, health, isShooting, name } }
const players = new Map();

// --- Connection handler ---
wss.on('connection', (ws) => {
    const id = uid();
    players.set(id, {
        ws,
        state: { pos: { x: 0, y: 0, z: 0 }, rotY: 0, health: 100, isShooting: false, name: 'SPARTAN' }
    });

    console.log(`[+] Player ${id} connected  (${players.size} online)`);

    // Send new player their ID + all existing player states
    send(ws, {
        type: 'init',
        id,
        players: [...players.entries()]
            .filter(([pid]) => pid !== id)
            .map(([pid, p]) => ({ id: pid, state: p.state }))
    });

    // Tell everyone else a new player joined
    broadcast(ws, { type: 'join', id, state: players.get(id).state });

    // --- Message handler ---
    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

            // Player sends their position/rotation/health every tick
            case 'move': {
                const entry = players.get(id);
                if (entry) {
                    entry.state = { ...entry.state, ...msg.state };
                    broadcast(ws, { type: 'move', id, state: entry.state });
                }
                break;
            }

            // Player reports hitting another player
            case 'hit': {
                const target = players.get(msg.targetId);
                if (target) {
                    send(target.ws, {
                        type: 'damage',
                        from: id,
                        amount: msg.amount
                    });
                    console.log(`[HIT] ${id} -> ${msg.targetId} for ${msg.amount} dmg`);
                }
                break;
            }

            // Player reports their death
            case 'dead': {
                broadcast(ws, { type: 'dead', id });
                console.log(`[DEAD] ${id}`);
                break;
            }

            // Player name update
            case 'setName': {
                const entry = players.get(id);
                if (entry) entry.state.name = String(msg.name).slice(0, 16);
                break;
            }
        }
    });

    // --- Disconnect ---
    ws.on('close', () => {
        players.delete(id);
        broadcast(ws, { type: 'leave', id });
        console.log(`[-] Player ${id} disconnected  (${players.size} online)`);
    });

    ws.on('error', (err) => console.error(`[WS ERROR] ${id}:`, err.message));
});

const os = require('os');
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}
const localIP = getLocalIP();
console.log(`\n🎮  COMBAT OS Server  –  ws://${localIP}:${PORT}\n`);

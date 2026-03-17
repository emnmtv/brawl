/**
 * COMBAT OS – WebSocket Game Server
 * Run: node server.js  |  Requires: npm install ws
 */
const WebSocket = require('ws');
const PORT = process.env.PORT || 8080;
const wss  = new WebSocket.Server({ port: PORT });

function uid() { return Math.random().toString(36).slice(2, 9).toUpperCase(); }
function broadcast(exWs, data) {
    const msg = JSON.stringify(data);
    wss.clients.forEach(c => { if (c !== exWs && c.readyState === WebSocket.OPEN) c.send(msg); });
}
function send(ws, data) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); }

const players    = new Map();  // id → { ws, ready, state }
const lastHitter = new Map();  // victimId → attackerId (for kill feed)

wss.on('connection', (ws) => {
    const id = uid();
    players.set(id, {
        ws, ready: false,
        state: { pos:{x:0,y:0,z:0}, rotY:0, health:100, isShooting:false, name:'SPARTAN', modelId:'t800' }
    });
    console.log(`[+] ${id} connected  (${players.size} online)`);

    send(ws, {
        type: 'init', id,
        players: [...players.entries()]
            .filter(([pid, p]) => pid !== id && p.ready)
            .map(([pid, p]) => ({ id: pid, state: p.state }))
    });

    ws.on('message', (raw) => {
        let msg; try { msg = JSON.parse(raw); } catch { return; }
        switch (msg.type) {

            case 'setName': {
                const e = players.get(id); if (!e) break;
                e.state.name    = String(msg.name    || 'SPARTAN').slice(0, 16);
                e.state.modelId = String(msg.modelId || 't800'   ).slice(0, 32);
                if (!e.ready) {
                    e.ready = true;
                    broadcast(ws, { type: 'join', id, state: e.state });
                    console.log(`[READY] ${id} → ${e.state.name} (${e.state.modelId})`);
                } else {
                    broadcast(ws, { type: 'move', id, state: e.state });
                }
                break;
            }

            case 'move': {
                const e = players.get(id);
                if (e && e.ready) {
                    e.state = { ...e.state, ...msg.state };
                    broadcast(ws, { type: 'move', id, state: e.state });
                }
                break;
            }

            case 'hit': {
                const target = players.get(msg.targetId);
                if (target) {
                    lastHitter.set(msg.targetId, id);   // track for kill attribution
                    send(target.ws, { type: 'damage', from: id, amount: msg.amount });
                    console.log(`[HIT] ${id} → ${msg.targetId}  ${msg.amount} dmg`);
                }
                break;
            }

            case 'dead': {
                const e      = players.get(id); if (e) e.state.health = 0;
                const killer = lastHitter.get(id) || null;
                lastHitter.delete(id);
                broadcast(ws, { type: 'dead', id, killerId: killer });
                console.log(`[DEAD] ${id}  killer: ${killer || '?'}`);
                break;
            }

            case 'respawn': {
                const e = players.get(id);
                if (e && e.ready) {
                    e.state.health = 100;
                    if (msg.modelId) e.state.modelId = String(msg.modelId).slice(0, 32);
                    broadcast(ws, { type: 'join', id, state: e.state });
                    console.log(`[RESPAWN] ${id}`);
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        players.delete(id); lastHitter.delete(id);
        broadcast(ws, { type: 'leave', id });
        console.log(`[-] ${id} disconnected  (${players.size} online)`);
    });
    ws.on('error', err => console.error(`[WS ERROR] ${id}:`, err.message));
});

const os = require('os');
function getLocalIP() {
    for (const ifaces of Object.values(os.networkInterfaces()))
        for (const i of ifaces) if (i.family === 'IPv4' && !i.internal) return i.address;
    return 'localhost';
}
console.log(`\n🎮  COMBAT OS Server  –  ws://${getLocalIP()}:${PORT}\n`);
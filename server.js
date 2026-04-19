const { WebSocketServer } = require('ws');

const wss = new WebSocketServer({ port: 8080 });

const players = new Map();

console.log('Multiplayer server running on ws://localhost:8080');

wss.on('connection', (ws) => {
    const id = Math.random().toString(36).substring(2, 9);
    console.log(`Player connected: ${id}`);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'join') {
                players.set(id, {
                    id,
                    charId: data.charId,
                    pos: { x: 0, y: 0, z: 0 },
                    rot: { x: 0, y: 0, z: 0 },
                    anim: 'idle',
                    health: 100,
                    maxHealth: 100,
                    kills: 0,
                    deaths: 0,
                    laserActive: false,
                    isFiring: false
                });
                
                ws.send(JSON.stringify({ type: 'init', id, players: Array.from(players.values()) }));
                broadcast({ type: 'playerJoined', player: players.get(id) }, id);
            }
            
            if (data.type === 'update') {
                const player = players.get(id);
                if (player) {
                    Object.assign(player, data.state);
                    broadcast({ type: 'playerUpdate', id, state: data.state }, id);
                }
            }

            if (data.type === 'fire') {
                broadcast({ type: 'playerFire', id, origin: data.origin, dir: data.dir, cfg: data.cfg }, id);
            }

            if (data.type === 'damage') {
                const shooter = players.get(id);
                const target = players.get(data.targetId);
                
                if (target && target.health > 0) {
                    target.health -= data.amount;
                    
                    if (target.health <= 0) {
                        target.health = 0;
                        target.deaths++;
                        if (shooter) shooter.kills++;
                        
                        broadcast({ 
                            type: 'playerDeath', 
                            id: target.id, 
                            killerId: id,
                            scores: Array.from(players.values()).map(p => ({ id: p.id, kills: p.kills, deaths: p.deaths }))
                        });

                        // Respawn after 3 seconds
                        setTimeout(() => {
                            if (players.has(target.id)) {
                                target.health = target.maxHealth;
                                broadcast({ type: 'playerRespawn', id: target.id, health: target.health });
                            }
                        }, 3000);
                    } else {
                        broadcast({ type: 'playerDamage', id: data.targetId, health: target.health, shooterId: id });
                    }
                }
            }

        } catch (e) {
            console.error('Error processing message:', e);
        }
    });

    ws.on('close', () => {
        console.log(`Player disconnected: ${id}`);
        players.delete(id);
        broadcast({ type: 'playerLeft', id });
    });
});

function broadcast(data, excludeId = null) {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === 1) {
            client.send(msg);
        }
    });
}

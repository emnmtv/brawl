/**
 * NetworkManager.js — WebSocket client. Manages the connection,
 * spawning/removing RemotePlayers, and sending local state.
 *
 * All game callbacks are plain function properties — set them from main.js.
 */
import { RemotePlayer } from '../entities/RemotePlayer.js';

export class NetworkManager {
    /**
     * @param {THREE.Scene} scene
     * @param {string}      serverUrl
     * @param {string}      playerName
     * @param {string}      modelId
     */
    constructor(scene, serverUrl, playerName = 'SPARTAN', modelId = 't800') {
        this.scene         = scene;
        this.serverUrl     = serverUrl;
        this.playerName    = playerName;
        this.modelId       = modelId;
        this.ws            = null;
        this.localId       = null;
        this.connected     = false;
        this.remotePlayers = new Map();   // id → RemotePlayer

        // ── Callbacks — set from the outside ───────────────────
        /** (amount) */             this.onDamage      = null;
        /** (id, name) */           this.onPlayerJoin  = null;
        /** (id, name) */           this.onPlayerLeave = null;
        /** (victimId, killerId) */ this.onDead        = null;
        /** (killerName, victimName, isLocalKill) */ this.onKillFeed = null;
        /** () */                   this.onBlocked     = null;

        // Sending at 20 Hz
        this._sendInterval = 1 / 20;
        this._sendTimer    = 0;

        // Shared resources injected from main
        this._beamPool      = null;
        this._audioListener = null;
    }

    // ── Resource injection ──────────────────────────────────────

    set beamPool(pool) {
        this._beamPool = pool;
        this.remotePlayers.forEach(rp => { rp.beamPool = pool; });
    }
    get beamPool() { return this._beamPool; }

    set audioListener(l) {
        this._audioListener = l;
        this.remotePlayers.forEach(rp => { if (!rp._audioListener) rp.setAudioListener(l); });
    }
    get audioListener() { return this._audioListener; }

    // ── Connection ──────────────────────────────────────────────

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                this.connected = true;
                this._send({ type: 'setName', name: this.playerName, modelId: this.modelId });
            };

            this.ws.onmessage = event => this._handleMessage(event, resolve);
            this.ws.onerror   = ()    => reject(new Error('WebSocket connection failed'));
        });
    }

    // ── Sending ──────────────────────────────────────────────────

    /** Snapshot the local player and broadcast at 20 Hz. */
    update(dt, localPlayer, inputManager) {
        this.remotePlayers.forEach(rp => rp.update(dt));

        this._sendTimer += dt;
        if (this._sendTimer < this._sendInterval || !localPlayer) return;
        this._sendTimer = 0;

        const k = inputManager.keys;
        this._send({
            type: 'move',
            state: {
                pos:              localPlayer.mesh.position,
                rotY:             localPlayer.mesh.rotation.y,
                pitch:            localPlayer.cameraPivot.rotation.x,
                health:           localPlayer.health.currentHealth,
                weaponType:       localPlayer.weaponManager.currentType,
                ultimate:         localPlayer.currentUltimate,
                modelId:          localPlayer.modelId,
                isShooting:       inputManager.isShooting,
                isMoving:         !!(k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD']),
                isJumping:        localPlayer.isJumping,
                forward:          !!k['KeyW'], backward: !!k['KeyS'],
                left:             !!k['KeyA'], right:    !!k['KeyD'],
                isSprinting:      !!(k['KeyW'] && (k['ShiftLeft'] || k['ShiftRight'])),
                isMeleeAttacking: localPlayer.meleeAttacking,
                meleeAttackKey:   localPlayer.meleeAttackAction
                                    ? localPlayer.meleeAttackAction.getClip().name
                                    : null,
                isBlocking:       localPlayer.isBlocking,
            },
        });
    }

    /**
     * Report a hit on a remote player.
     * Checks blocking locally before sending — returns false if deflected.
     */
    reportHit(targetId, damage) {
        const rp = this.remotePlayers.get(targetId);
        if (rp && rp._isBlocking && rp.weaponManager?.currentType === 'melee') {
            this.onBlocked?.();
            return false;
        }
        this._send({ type: 'hit', targetId, amount: damage });
        if (rp) { rp.takeDamage(damage); rp.playHitReaction(); }
        return true;
    }

    reportDead()           { this._send({ type: 'dead' }); }
    reportRespawn(modelId) { this._send({ type: 'respawn', modelId }); }

    // ── Private ──────────────────────────────────────────────────

    _send(data) {
        if (this.ws?.readyState === WebSocket.OPEN)
            this.ws.send(JSON.stringify(data));
    }

    _handleMessage(event, resolveInit) {
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }

        switch (msg.type) {
            case 'init':
                this.localId = msg.id;
                msg.players.forEach(p => this._addRemote(p.id, p.state));
                resolveInit(msg.id);
                break;

            case 'join':
                if (this.remotePlayers.has(msg.id))
                    this.remotePlayers.get(msg.id).resetForRespawn(msg.state);
                else
                    this._addRemote(msg.id, msg.state);
                this.onPlayerJoin?.(msg.id, msg.state?.name || 'SPARTAN');
                break;

            case 'leave': {
                const rp   = this.remotePlayers.get(msg.id);
                const name = rp ? rp.name : msg.id;
                this._removeRemote(msg.id);
                this.onPlayerLeave?.(msg.id, name);
                break;
            }

            case 'move':
                if (this.remotePlayers.has(msg.id))
                    this.remotePlayers.get(msg.id).applyState(msg.state);
                else
                    this._addRemote(msg.id, msg.state);
                break;

            case 'damage':
                this.onDamage?.(msg.amount, msg.from, msg.blocked);
                break;

            case 'dead': {
                const rp = this.remotePlayers.get(msg.id);
                if (rp) { rp.isDead = true; rp.mesh.visible = false; rp.health = 0; }
                this.onDead?.(msg.id, msg.killerId);
                // Build kill feed entry
                if (this.onKillFeed && msg.killerId) {
                    const killerRp   = this.remotePlayers.get(msg.killerId);
                    const killerName = msg.killerId === this.localId
                        ? this.playerName
                        : (killerRp?.name || msg.killerId);
                    this.onKillFeed(killerName, rp?.name || msg.id, msg.killerId === this.localId);
                }
                break;
            }

            default:
                console.warn('[Network] Unknown message type:', msg.type);
        }
    }

    _addRemote(id, state) {
        if (this.remotePlayers.has(id)) return;
        const rp = new RemotePlayer(this.scene, id, state?.modelId || 't800', state?.name || 'SPARTAN');
        if (this._beamPool)      rp.beamPool = this._beamPool;
        if (this._audioListener) rp.setAudioListener(this._audioListener);
        this.remotePlayers.set(id, rp);
        if (state?.pos) rp.applyState(state);
    }

    _removeRemote(id) {
        const rp = this.remotePlayers.get(id);
        if (rp) { rp.dispose(this.scene); this.remotePlayers.delete(id); }
    }
}

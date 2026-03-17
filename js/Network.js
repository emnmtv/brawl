import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildActionMap, resolveAnimationTarget } from './AnimationUtils.js';
import { getModel, getBoneName, getSizeConfig } from './ModelRegistry.js';
import { WeaponManager } from './Weapons.js';
import { CONFIG } from './Config.js';

class RemotePlayer {
    constructor(scene, id, modelId = 't800', name = 'SPARTAN') {
        this.id = id; this.modelId = modelId; this.health = 100; this.isDead = false;
        this.name = name;
        this.targetPos   = new THREE.Vector3();
        this.targetRotY  = 0;
        this.boundingBox = new THREE.Box3();
        this.mesh        = new THREE.Group(); this.mesh.visible = false; scene.add(this.mesh);
        this.weaponManager = new WeaponManager(true, modelId);
        this._scene = scene;

        this.beamPool = null; this._audioListener = null; this._gunSound = null;
        this._lastShotState = false;
        this.currentUltimate = null;
        this.mixer = null; this.actions = {}; this.slots = {};
        this._activeAction = null;

        // ── Melee / block animation state ─────────────────────────
        this._meleeAttackKey   = null;   // last key we triggered as LoopOnce
        this._incomingKey      = null;   // incoming from move packet
        this._isMeleeAttacking = false;
        this._isAttacking      = false;  // true while LoopOnce plays
        this._attackAction     = null;
        this._isBlocking       = false;

        // ── Locomotion state ───────────────────────────────────────
        this._isShooting = false; this._isMoving  = false; this._isJumping = false;
        this._forward = false;    this._backward  = false;
        this._left = false;       this._right     = false; this._isSprinting = false;

        this._loadSeq = 0;
        this._loadModel(modelId);
    }

    _loadModel(modelId) {
        this.modelId = modelId;
        const seq     = ++this._loadSeq;
        const profile = getModel(modelId);

        new GLTFLoader().load(profile.path, (gltf) => {
            if (seq !== this._loadSeq) return;

            while (this.mesh.children.length) this.mesh.remove(this.mesh.children[0]);

            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;
            this.mesh.add(model);

            this.weaponManager.setModelId(modelId);
            const weaponBoneName = getBoneName(modelId, CONFIG.WEAPONS.GUN.WEAPON_BONE);
            const rightHand = model.getObjectByName(weaponBoneName);
            if (rightHand) this.weaponManager.init(rightHand);

            this.mixer = new THREE.AnimationMixer(model);

            // Reset attack lock when LoopOnce clip finishes
            this.mixer.addEventListener('finished', (e) => {
                if (e.action === this._attackAction) {
                    this._isAttacking  = false;
                    this._attackAction = null;
                }
            });

            const { slots, actions } = buildActionMap(gltf.animations, this.mixer, modelId);
            this.slots = slots; this.actions = actions;
            this._activeAction = null;
            this._isAttacking  = false;
            this._attackAction = null;
            this._meleeAttackKey = null;
            this.mesh.visible = !this.isDead;

            const sc = getSizeConfig(modelId);
            const c  = this.mesh.position.clone(); c.y += sc.hitboxCenterOffsetY;
            this.boundingBox.setFromCenterAndSize(
                c, new THREE.Vector3(sc.hitboxSize.x, sc.hitboxSize.y, sc.hitboxSize.z)
            );

            if (this._audioListener && !this._gunSound) this._setupGunSound();
        });
    }

    applyState(state) {
        if (state.pos) {
            this.targetPos.set(state.pos.x, state.pos.y, state.pos.z);
            this.mesh.visible = !this.isDead;
        }
        if (state.rotY  !== undefined) this.targetRotY  = state.rotY;
        if (state.pitch !== undefined) this.targetPitch = state.pitch;

        if (state.health !== undefined) {
            this.health = state.health;
            if (this.isDead && state.health > 0) { this.isDead = false; this.mesh.visible = true; }
        }

        this._isShooting     = state.isShooting;
        this._isMoving       = state.isMoving;
        this._isJumping      = state.isJumping;
        this._forward        = state.forward;
        this._backward       = state.backward;
        this._left           = state.left;
        this._right          = state.right;
        this._isSprinting    = state.isSprinting;
        this.currentUltimate = state.ultimate;

        // Melee / block sync
        this._isMeleeAttacking = !!state.isMeleeAttacking;
        this._incomingKey      = state.meleeAttackKey || null;
        this._isBlocking       = !!state.isBlocking;

        if (state.modelId && state.modelId !== this.modelId) this._loadModel(state.modelId);
        if (state.weaponType && state.weaponType !== this.weaponManager.currentType)
            this.weaponManager.equip(state.weaponType);
    }

    resetForRespawn(state) {
        this.health = 100; this.isDead = false; this.mesh.visible = true;
        this._activeAction = null; this._isAttacking = false;
        this._attackAction = null; this._meleeAttackKey = null;
        if (state?.modelId && state.modelId !== this.modelId) this._loadModel(state.modelId);
        if (state?.pos) this.applyState(state);
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0 && !this.isDead) { this.isDead = true; this.mesh.visible = false; }
    }

    /**
     * playHitReaction() — play hit_body LoopOnce when a beam connects.
     * Called by local client immediately on beam hit confirmation.
     */
    playHitReaction() {
        if (!this.mixer || this.isDead) return;
        const hitAct = this.actions['hit_body'];
        if (!hitAct) return;
        hitAct.reset();
        hitAct.setLoop(THREE.LoopOnce, 1);
        hitAct.clampWhenFinished = true;
        hitAct.setEffectiveWeight(1).play();
        if (this._activeAction && this._activeAction !== hitAct)
            this._activeAction.crossFadeTo(hitAct, 0.05, true);
        this._activeAction = hitAct;
        this._isAttacking  = true;
        this._attackAction = hitAct;
    }

    _setupGunSound() {
        this._gunSound = new THREE.PositionalAudio(this._audioListener);
        if (RemotePlayer._gunFireBuffer) {
            this._gunSound.setBuffer(RemotePlayer._gunFireBuffer);
            this._gunSound.setRefDistance(30);
            this.mesh.add(this._gunSound);
        } else {
            new THREE.AudioLoader().load('sound_effects/gun_fire.mp3', b => {
                RemotePlayer._gunFireBuffer = b;
                this._gunSound.setBuffer(b);
                this._gunSound.setRefDistance(30);
                this.mesh.add(this._gunSound);
            });
        }
    }

    setAudioListener(listener) {
        if (this._audioListener) return;
        this._audioListener = listener;
        if (this.mesh.children.length > 0) this._setupGunSound();
    }

    update(dt) {
        this.mesh.position.lerp(this.targetPos, 0.25);
        this.mesh.rotation.y += (this.targetRotY - this.mesh.rotation.y) * 0.25;

        if (!this._remoteClock) this._remoteClock = { elapsedTime: 0 };
        this._remoteClock.elapsedTime += dt;

        if (this._isShooting && this.mesh.visible && this.beamPool && !this.currentUltimate)
            this.weaponManager.attemptFire(this._remoteClock, { player: this, beamPool: this.beamPool, isRemote: true });

        if (this._gunSound && this._gunSound.buffer && this.weaponManager.currentType === 'gun') {
            if ( this._isShooting && !this._lastShotState) { if (!this._gunSound.isPlaying) { this._gunSound.setLoop(true); this._gunSound.play(); } }
            else if (!this._isShooting &&  this._lastShotState) { if (this._gunSound.isPlaying) this._gunSound.stop(); }
        }
        this._lastShotState = !!this._isShooting;

        if (this.mixer) {
            const isMelee = this.weaponManager.currentType === 'melee';

            // ── PRIORITY 1: BLOCKING ─────────────────────────────────
            if (this._isBlocking && isMelee) {
                const blockAct = this.actions['melee_block'] || this.actions['melee_idle'];
                if (blockAct && this._activeAction !== blockAct) {
                    blockAct.reset().setEffectiveWeight(1).play();
                    if (this._activeAction) this._activeAction.crossFadeTo(blockAct, 0.1, true);
                    this._activeAction = blockAct;
                    this._isAttacking  = false;
                    this._attackAction = null;
                    this._meleeAttackKey = null;
                }
            }
            // ── PRIORITY 2: NEW MELEE ATTACK (key changed → LoopOnce) ─
            else if (this._isMeleeAttacking && isMelee &&
                     this._incomingKey &&
                     this._incomingKey !== this._meleeAttackKey &&
                     !this._isBlocking) {
                const atk = this.actions[this._incomingKey]
                         || this.actions[this._incomingKey.toLowerCase()];
                if (atk) {
                    this._meleeAttackKey = this._incomingKey;
                    this._isAttacking    = true;
                    this._attackAction   = atk;
                    atk.reset();
                    atk.setLoop(THREE.LoopOnce, 1);
                    atk.clampWhenFinished = true;
                    atk.setEffectiveWeight(1).play();
                    if (this._activeAction && this._activeAction !== atk)
                        this._activeAction.crossFadeTo(atk, 0.12, true);
                    this._activeAction = atk;
                }
            }
            // ── PRIORITY 3: NORMAL LOCOMOTION ────────────────────────
            else if (!this._isAttacking) {
                if (!this._isMeleeAttacking) this._meleeAttackKey = null;

                const targetAnim = resolveAnimationTarget({
                    isMoving: !!this._isMoving, isShooting: !!this._isShooting,
                    isJumping: !!this._isJumping, forward: !!this._forward,
                    backward: !!this._backward, left: !!this._left, right: !!this._right,
                    isSprinting: !!this._isSprinting,
                    weaponType: this.weaponManager.currentType,
                    ultimate: this.currentUltimate, isBlocking: false,
                }, this.actions);

                if (targetAnim && this.actions[targetAnim]) {
                    const next = this.actions[targetAnim];
                    if (this._activeAction !== next) {
                        next.reset().setEffectiveWeight(1).play();
                        if (this._activeAction) this._activeAction.crossFadeTo(next, 0.2, true);
                        this._activeAction = next;
                    }
                }
            }

            this.mixer.update(dt);
        }

        // Hitbox
        const sc = getSizeConfig(this.modelId);
        const c  = this.mesh.position.clone(); c.y += sc.hitboxCenterOffsetY;
        this.boundingBox.setFromCenterAndSize(
            c, new THREE.Vector3(sc.hitboxSize.x, sc.hitboxSize.y, sc.hitboxSize.z)
        );
    }

    dispose(scene) { scene.remove(this.mesh); }
}

// ─────────────────────────────────────────────────────────────
export class NetworkManager {
    constructor(scene, serverUrl, playerName = 'SPARTAN', modelId = 't800') {
        this.scene         = scene;
        this.serverUrl     = serverUrl;
        this.playerName    = playerName;
        this.modelId       = modelId;
        this.ws            = null;
        this.localId       = null;
        this.connected     = false;
        this.remotePlayers = new Map();
        this._beamPool      = null;
        this._audioListener = null;

        // Callbacks
        this.onDamage      = null;  // (amount, fromId, blocked)
        this.onPlayerJoin  = null;  // (id, name)
        this.onPlayerLeave = null;  // (id, name)
        this.onDead        = null;  // (id, killerId)
        this.onKillFeed    = null;  // (killerName, victimName, isLocalKill)
        this.onBlocked     = null;  // () — local attack was blocked

        this._sendInterval = 1 / 20;
        this._sendTimer    = 0;
    }

    set beamPool(pool)    { this._beamPool = pool; this.remotePlayers.forEach(rp => { rp.beamPool = pool; }); }
    get beamPool()        { return this._beamPool; }
    set audioListener(l)  { this._audioListener = l; this.remotePlayers.forEach(rp => { if (!rp._audioListener) rp.setAudioListener(l); }); }
    get audioListener()   { return this._audioListener; }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                this.connected = true;
                this.ws.send(JSON.stringify({
                    type: 'setName', name: this.playerName, modelId: this.modelId,
                }));
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'init') {
                        this.localId = msg.id;
                        msg.players.forEach(p => this._addRemote(p.id, p.state));
                        resolve(msg.id);

                    } else if (msg.type === 'join') {
                        if (this.remotePlayers.has(msg.id)) {
                            this.remotePlayers.get(msg.id).resetForRespawn(msg.state);
                        } else {
                            this._addRemote(msg.id, msg.state);
                        }
                        if (this.onPlayerJoin) this.onPlayerJoin(msg.id, msg.state?.name || 'SPARTAN');

                    } else if (msg.type === 'leave') {
                        const rp   = this.remotePlayers.get(msg.id);
                        const name = rp ? rp.name : msg.id;
                        this._removeRemote(msg.id);
                        if (this.onPlayerLeave) this.onPlayerLeave(msg.id, name);

                    } else if (msg.type === 'move') {
                        if (this.remotePlayers.has(msg.id)) {
                            this.remotePlayers.get(msg.id).applyState(msg.state);
                        } else {
                            this._addRemote(msg.id, msg.state);
                        }

                    } else if (msg.type === 'damage') {
                        if (this.onDamage) this.onDamage(msg.amount, msg.from, msg.blocked);

                    } else if (msg.type === 'dead') {
                        const rp = this.remotePlayers.get(msg.id);
                        if (rp) { rp.isDead = true; rp.mesh.visible = false; rp.health = 0; }
                        if (this.onDead) this.onDead(msg.id, msg.killerId);
                        // Kill feed
                        if (this.onKillFeed && msg.killerId) {
                            const killerRp  = this.remotePlayers.get(msg.killerId);
                            const killerName = msg.killerId === this.localId
                                ? this.playerName
                                : (killerRp?.name || msg.killerId);
                            const victimName = rp?.name || msg.id;
                            this.onKillFeed(killerName, victimName, msg.killerId === this.localId);
                        }
                    }
                } catch (e) { console.warn('[Network] Bad message', e); }
            };

            this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
        });
    }

    _addRemote(id, state) {
        if (this.remotePlayers.has(id)) return;
        const modelId = state?.modelId || 't800';
        const name    = state?.name    || 'SPARTAN';
        const rp = new RemotePlayer(this.scene, id, modelId, name);
        if (this._beamPool)      rp.beamPool = this._beamPool;
        if (this._audioListener) rp.setAudioListener(this._audioListener);
        this.remotePlayers.set(id, rp);
        if (state?.pos) rp.applyState(state);
    }

    _removeRemote(id) {
        const rp = this.remotePlayers.get(id);
        if (rp) { rp.dispose(this.scene); this.remotePlayers.delete(id); }
    }

    update(dt, localPlayer, inputManager) {
        this.remotePlayers.forEach(rp => rp.update(dt));
        this._sendTimer += dt;
        if (this._sendTimer >= this._sendInterval && localPlayer) {
            this._sendTimer = 0;
            const k = inputManager.keys;
            this.ws.send(JSON.stringify({
                type: 'move',
                state: {
                    pos:             { x: localPlayer.mesh.position.x, y: localPlayer.mesh.position.y, z: localPlayer.mesh.position.z },
                    rotY:            localPlayer.mesh.rotation.y,
                    pitch:           localPlayer.cameraPivot.rotation.x,
                    health:          localPlayer.health.currentHealth,
                    weaponType:      localPlayer.weaponManager.currentType,
                    ultimate:        localPlayer.currentUltimate,
                    modelId:         localPlayer.modelId,
                    isShooting:      inputManager.isShooting,
                    isMoving:        !!(k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD']),
                    isJumping:       localPlayer.isJumping,
                    forward:         !!k['KeyW'], backward: !!k['KeyS'],
                    left:            !!k['KeyA'], right:    !!k['KeyD'],
                    isSprinting:     !!(k['KeyW'] && (k['ShiftLeft'] || k['ShiftRight'])),
                    // Melee animation + block sync
                    isMeleeAttacking: localPlayer.meleeAttacking,
                    meleeAttackKey:   localPlayer.meleeAttackAction
                                        ? localPlayer.meleeAttackAction.getClip().name
                                        : null,
                    isBlocking:      localPlayer.isBlocking,
                },
            }));
        }
    }

    /**
     * reportHit — checks if target is blocking first (local optimistic).
     * Returns true if hit was registered, false if blocked.
     */
    reportHit(targetId, damage) {
        const rp = this.remotePlayers.get(targetId);
        // Blocking deflection: melee-equipped blocker absorbs hits
        if (rp && rp._isBlocking && rp.weaponManager?.currentType === 'melee') {
            if (this.onBlocked) this.onBlocked();
            return false;
        }
        this.ws.send(JSON.stringify({ type: 'hit', targetId, amount: damage }));
        if (rp) { rp.takeDamage(damage); rp.playHitReaction(); }
        return true;
    }

    reportDead()           { this.ws.send(JSON.stringify({ type: 'dead' })); }
    reportRespawn(modelId) { this.ws.send(JSON.stringify({ type: 'respawn', modelId })); }
}
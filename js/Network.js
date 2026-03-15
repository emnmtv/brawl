import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { detectAnimationSlots, resolveAnimationTarget } from './AnimationUtils.js';
import { WeaponManager } from './Weapons.js';
import { CONFIG } from './Config.js';

class RemotePlayer {
    constructor(scene, id, name = 'SPARTAN') {
        this.id = id; this.health = 100; this.isDead = false;
        this.targetPos = new THREE.Vector3(); this.targetRotY = 0; this.boundingBox = new THREE.Box3();
        this.mesh = new THREE.Group(); this.mesh.visible = false; scene.add(this.mesh);
        this.weaponManager = new WeaponManager(true);

        this.beamPool = null; this._audioListener = null; this._gunSound = null; this._lastShotState = false;
        this.isSwinging = false; this.swingProgress = 0; this.currentUltimate = null;

        new GLTFLoader().load('models/t800.glb', (gltf) => {
            const model = gltf.scene; model.scale.set(10, 10, 10); model.rotation.y = Math.PI; this.mesh.add(model);

            const weaponBoneName = CONFIG.WEAPONS.GUN.WEAPON_BONE || 'bip_hand_R';
            const rightHand = model.getObjectByName(weaponBoneName);
            if (rightHand) this.weaponManager.init(rightHand);

            this.mixer = new THREE.AnimationMixer(model);
            const { slots, actions } = detectAnimationSlots(gltf.animations, this.mixer);
            this.slots = slots; this.actions = actions; this.mesh.visible = true;

            // If audioListener was assigned before model loaded, set up sound now
            if (this._audioListener && !this._gunSound) this._setupGunSound();
        });
    }

    applyState(state) {
        if (state.pos) { this.targetPos.set(state.pos.x, state.pos.y, state.pos.z); this.mesh.visible = true; }
        if (state.rotY !== undefined) this.targetRotY = state.rotY;
        if (state.pitch !== undefined) this.targetPitch = state.pitch;
        if (state.health !== undefined) this.health = state.health;

        this._isShooting = state.isShooting; this._isMoving = state.isMoving; this._isJumping = state.isJumping;
        this._forward = state.forward; this._backward = state.backward; this._left = state.left; this._right = state.right;
        this._isSprinting = state.isSprinting; this.currentUltimate = state.ultimate;

        if (state.weaponType && state.weaponType !== this.weaponManager.currentType) this.weaponManager.equip(state.weaponType);
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0 && !this.isDead) { this.isDead = true; this.mesh.visible = false; }
    }

    _setupGunSound() {
        this._gunSound = new THREE.PositionalAudio(this._audioListener);
        if (RemotePlayer._gunFireBuffer) {
            this._gunSound.setBuffer(RemotePlayer._gunFireBuffer);
            this._gunSound.setRefDistance(30);
            this.mesh.add(this._gunSound);
        } else {
            new THREE.AudioLoader().load('sound_effects/gun_fire.mp3', (b) => {
                RemotePlayer._gunFireBuffer = b;
                this._gunSound.setBuffer(b);
                this._gunSound.setRefDistance(30);
                this.mesh.add(this._gunSound);
            });
        }
    }

    setAudioListener(listener) {
        if (this._audioListener) return; // already set, don't re-init
        this._audioListener = listener;
        // If model already loaded, set up immediately; otherwise the GLTFLoader callback handles it
        if (this.mesh.children.length > 0) this._setupGunSound();
    }

    update(dt) {
        this.mesh.position.lerp(this.targetPos, 0.25);
        this.mesh.rotation.y += (this.targetRotY - this.mesh.rotation.y) * 0.25;

        if (!this._remoteClock) this._remoteClock = { elapsedTime: 0 };
        this._remoteClock.elapsedTime += dt;

        if (this._isShooting && this.mesh.visible && this.beamPool && !this.currentUltimate) {
            this.weaponManager.attemptFire(this._remoteClock, { player: this, beamPool: this.beamPool, isRemote: true });
        }

        if (this._gunSound && this._gunSound.buffer && this.weaponManager.currentType === 'gun') {
            if (this._isShooting && !this._lastShotState) {
                if (!this._gunSound.isPlaying) { this._gunSound.setLoop(true); this._gunSound.play(); }
            } else if (!this._isShooting && this._lastShotState) {
                if (this._gunSound.isPlaying) this._gunSound.stop();
            }
        }
        this._lastShotState = !!this._isShooting;

        if (this.mixer) {
            const targetAnim = resolveAnimationTarget({
                isMoving: !!this._isMoving, isShooting: !!this._isShooting, isJumping: !!this._isJumping,
                forward: !!this._forward, backward: !!this._backward, left: !!this._left, right: !!this._right,
                isSprinting: !!this._isSprinting, weaponType: this.weaponManager.currentType, ultimate: this.currentUltimate
            }, this.actions);

            if (targetAnim && this.actions[targetAnim]) {
                const next = this.actions[targetAnim];
                if (this._activeAction !== next) {
                    next.reset().setEffectiveWeight(1).play();
                    if (this._activeAction) this._activeAction.crossFadeTo(next, 0.2, true);
                    this._activeAction = next;
                }
            }
            this.mixer.update(dt);
        }

        // Procedural Swing Sync (Multi-Bone)
        if (this.weaponManager.currentType === 'melee' && !this.currentUltimate) {
            const conf = CONFIG.WEAPONS.MELEE;
            const swingBones = (conf.SWING_BONES || [conf.WEAPON_BONE]).map(name => this.mesh.getObjectByName(name));

            if (swingBones.some(b => b)) {
                if (this._isShooting && !this.isSwinging) { this.isSwinging = true; this.swingProgress = 0; }
                if (this.isSwinging) {
                    this.swingProgress += dt * conf.SWING_SPEED;
                    if (this.swingProgress > Math.PI) { this.isSwinging = false; this.swingProgress = 0; }

                    const swingFactor = Math.sin(this.swingProgress);
                    const rots = conf.SWING_ROTS || [[0,0,0],[0,0,0],[0,0,0]];
                    swingBones.forEach((bone, i) => {
                        if (bone && rots[i]) {
                            const q = new THREE.Quaternion().setFromEuler(
                                new THREE.Euler(rots[i][0] * swingFactor, rots[i][1] * swingFactor, rots[i][2] * swingFactor)
                            );
                            bone.quaternion.multiply(q);
                        }
                    });
                }
            }
        }

        const c = this.mesh.position.clone(); c.y += 6;
        this.boundingBox.setFromCenterAndSize(c, new THREE.Vector3(6, 12, 6));
    }

    dispose(scene) { scene.remove(this.mesh); }
}

export class NetworkManager {
    constructor(scene, serverUrl, playerName = 'SPARTAN') {
        this.scene = scene; this.serverUrl = serverUrl; this.playerName = playerName;
        this.ws = null; this.remotePlayers = new Map();
        this._beamPool = null; this._audioListener = null;
        this.onDamage = null; this.onPlayerJoin = null; this.onPlayerLeave = null; this.onDead = null;
        this._sendInterval = 1 / 20; this._sendTimer = 0;
    }

    // Setters that immediately propagate to all existing remote players
    // so order of assignment relative to connect() doesn't matter
    set beamPool(pool) {
        this._beamPool = pool;
        this.remotePlayers.forEach(rp => { rp.beamPool = pool; });
    }
    get beamPool() { return this._beamPool; }

    set audioListener(listener) {
        this._audioListener = listener;
        this.remotePlayers.forEach(rp => { if (!rp._audioListener) rp.setAudioListener(listener); });
    }
    get audioListener() { return this._audioListener; }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);
            this.ws.onopen = () => {
                this.connected = true;
                this.ws.send(JSON.stringify({ type: 'setName', name: this.playerName }));
            };
            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'init') {
                        this.localId = msg.id;
                        msg.players.forEach(p => this._addRemote(p.id, p.state));
                        resolve(msg.id);
                    } else if (msg.type === 'join') {
                        this._addRemote(msg.id, msg.state);
                        if (this.onPlayerJoin) this.onPlayerJoin(msg.id);
                    } else if (msg.type === 'leave') {
                        this._removeRemote(msg.id);
                        if (this.onPlayerLeave) this.onPlayerLeave(msg.id);
                    } else if (msg.type === 'move') {
                        if (this.remotePlayers.has(msg.id)) this.remotePlayers.get(msg.id).applyState(msg.state);
                    } else if (msg.type === 'damage') {
                        if (this.onDamage) this.onDamage(msg.amount);
                    } else if (msg.type === 'dead') {
                        this._removeRemote(msg.id);
                        if (this.onDead) this.onDead(msg.id);
                    }
                } catch (e) { console.warn('[Network] Bad message', e); }
            };
            this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
        });
    }

    // Assigns beamPool / audioListener immediately on creation
    _addRemote(id, state) {
        if (this.remotePlayers.has(id)) return;
        const rp = new RemotePlayer(this.scene, id, state?.name || 'SPARTAN');
        if (this._beamPool)       rp.beamPool = this._beamPool;
        if (this._audioListener)  rp.setAudioListener(this._audioListener);
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
                    pos: { x: localPlayer.mesh.position.x, y: localPlayer.mesh.position.y, z: localPlayer.mesh.position.z },
                    rotY: localPlayer.mesh.rotation.y, pitch: localPlayer.cameraPivot.rotation.x,
                    health: localPlayer.health.currentHealth, weaponType: localPlayer.weaponManager.currentType,
                    ultimate: localPlayer.currentUltimate, isShooting: inputManager.isShooting,
                    isMoving: k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD'],
                    isJumping: localPlayer.isJumping, forward: !!k['KeyW'], backward: !!k['KeyS'],
                    left: !!k['KeyA'], right: !!k['KeyD'],
                    isSprinting: k['KeyW'] && (k['ShiftLeft'] || k['ShiftRight'])
                }
            }));
        }
    }

    reportHit(targetId, damage) {
        this.ws.send(JSON.stringify({ type: 'hit', targetId, amount: damage }));
        const rp = this.remotePlayers.get(targetId);
        if (rp) rp.takeDamage(damage);
    }
    reportDead() { this.ws.send(JSON.stringify({ type: 'dead' })); }
}
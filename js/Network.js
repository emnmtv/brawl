import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildActionMap, resolveAnimationTarget } from './AnimationUtils.js';
import { getModel, getBoneName, getSizeConfig } from './ModelRegistry.js';
import { WeaponManager } from './Weapons.js';
import { CONFIG } from './Config.js';

class RemotePlayer {
    constructor(scene, id, modelId = 't800', name = 'SPARTAN') {
        this.id = id; this.modelId = modelId; this.health = 100; this.isDead = false;
        this.targetPos   = new THREE.Vector3();
        this.targetRotY  = 0;
        this.boundingBox = new THREE.Box3();
        this.mesh        = new THREE.Group(); this.mesh.visible = false; scene.add(this.mesh);
        this.weaponManager = new WeaponManager(true, modelId);
        this._scene = scene;

        this.beamPool = null; this._audioListener = null; this._gunSound = null;
        this._lastShotState = false;
        this.isSwinging = false; this.swingProgress = 0; this.currentUltimate = null;
        this.mixer = null; this.actions = {}; this.slots = {};
        this._activeAction = null;

        // ── Load counter: every new _loadModel call increments this.
        //    The GLTFLoader callback checks its captured id against the current one.
        //    If they differ, the load is stale and silently discarded. ──
        this._loadSeq = 0;

        this._loadModel(modelId);
    }

    _loadModel(modelId) {
        this.modelId = modelId;
        const seq     = ++this._loadSeq;   // capture this load's sequence number
        const profile = getModel(modelId);

        new GLTFLoader().load(profile.path, (gltf) => {
            // Discard stale loads — a newer _loadModel call won already
            if (seq !== this._loadSeq) return;

            // Remove any previously loaded model children
            while (this.mesh.children.length) this.mesh.remove(this.mesh.children[0]);

            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;
            this.mesh.add(model);

            // Swap to per-model weapon configs before reinitialising the hand bone
            this.weaponManager.setModelId(modelId);
            const weaponBoneName = getBoneName(modelId, CONFIG.WEAPONS.GUN.WEAPON_BONE);
            const rightHand = model.getObjectByName(weaponBoneName);
            if (rightHand) this.weaponManager.init(rightHand);

            this.mixer = new THREE.AnimationMixer(model);
            const { slots, actions } = buildActionMap(gltf.animations, this.mixer, modelId);
            this.slots = slots; this.actions = actions;
            this._activeAction = null;
            this.mesh.visible = !this.isDead;

            // Update hitbox for this model's size
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

        // Health sync — if we locally marked them dead but their health is positive,
        // a respawn was missed (race). Auto-resurrect as a safety net.
        if (state.health !== undefined) {
            this.health = state.health;
            if (this.isDead && state.health > 0) {
                this.isDead       = false;
                this.mesh.visible = true;
            }
        }

        this._isShooting  = state.isShooting;  this._isMoving    = state.isMoving;
        this._isJumping   = state.isJumping;   this._forward     = state.forward;
        this._backward    = state.backward;    this._left        = state.left;
        this._right       = state.right;       this._isSprinting = state.isSprinting;
        this.currentUltimate = state.ultimate;

        // Model swap — _loadId counter prevents stale t800 load from winning
        if (state.modelId && state.modelId !== this.modelId) {
            this._loadModel(state.modelId);
        }

        if (state.weaponType && state.weaponType !== this.weaponManager.currentType)
            this.weaponManager.equip(state.weaponType);
    }

    // Called when a 'join' arrives for an already-known id (respawn flow)
    resetForRespawn(state) {
        this.health        = 100;
        this.isDead        = false;
        this.mesh.visible  = true;
        this.isSwinging    = false;
        this.swingProgress = 0;
        this._activeAction = null;
        // Reload model if character changed at respawn
        if (state?.modelId && state.modelId !== this.modelId) this._loadModel(state.modelId);
        if (state?.pos) this.applyState(state);
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0 && !this.isDead) {
            this.isDead       = true;
            this.mesh.visible = false;
        }
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
            if (this._isShooting && !this._lastShotState) {
                if (!this._gunSound.isPlaying) { this._gunSound.setLoop(true); this._gunSound.play(); }
            } else if (!this._isShooting && this._lastShotState) {
                if (this._gunSound.isPlaying) this._gunSound.stop();
            }
        }
        this._lastShotState = !!this._isShooting;

        if (this.mixer) {
            const targetAnim = resolveAnimationTarget({
                isMoving: !!this._isMoving, isShooting: !!this._isShooting,
                isJumping: !!this._isJumping, forward: !!this._forward,
                backward: !!this._backward, left: !!this._left, right: !!this._right,
                isSprinting: !!this._isSprinting,
                weaponType: this.weaponManager.currentType, ultimate: this.currentUltimate,
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

        // Procedural swing sync — use per-model melee config
        if (this.weaponManager.currentType === 'melee' && !this.currentUltimate) {
            const conf        = this.weaponManager.weapons.melee.config;  // per-model
            const globalMelee = CONFIG.WEAPONS.MELEE;
            const swingBoneLogicals = globalMelee.SWING_BONES || [globalMelee.WEAPON_BONE];
            const swingBones = swingBoneLogicals.map(
                logical => this.mesh.getObjectByName(getBoneName(this.modelId, logical))
            );
            if (swingBones.some(b => b)) {
                if (this._isShooting && !this.isSwinging) {
                    this.isSwinging = true; this.swingProgress = 0;
                    const swings = conf.SWINGS || globalMelee.SWINGS;
                    this._activeSwing = swings[Math.floor(Math.random() * swings.length)];
                }
                if (this.isSwinging) {
                    const swingSpeed = conf.SWING_SPEED ?? globalMelee.SWING_SPEED;
                    this.swingProgress += dt * swingSpeed;
                    if (this.swingProgress > Math.PI) { this.isSwinging = false; this.swingProgress = 0; }
                    const swings    = conf.SWINGS || globalMelee.SWINGS;
                    const swingData = this._activeSwing || swings[0];
                    const t    = Math.min(this.swingProgress / Math.PI, 1.0);
                    const lerp = (a,b,f) => a+(b-a)*f;
                    const frame = (pA,pB,f,i) => [lerp(pA[i][0],pB[i][0],f),lerp(pA[i][1],pB[i][1],f),lerp(pA[i][2],pB[i][2],f)];
                    swingBones.forEach((bone, i) => {
                        if (!bone) return;
                        let r;
                        if (t < 0.2)      r = frame(swingData.address,   swingData.backswing,     t/0.2,       i);
                        else if (t < 0.4) r = frame(swingData.backswing,  swingData.downswing,    (t-0.2)/0.2, i);
                        else if (t < 0.6) r = frame(swingData.downswing,  swingData.impact,       (t-0.4)/0.2, i);
                        else              r = frame(swingData.impact,      swingData.followThrough,(t-0.6)/0.4, i);
                        bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0],r[1],r[2])));
                    });
                }
            }
        }

        // Hitbox update
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
        this.scene      = scene;
        this.serverUrl  = serverUrl;
        this.playerName = playerName;
        this.modelId    = modelId;
        this.ws         = null;
        this.remotePlayers = new Map();
        this._beamPool       = null;
        this._audioListener  = null;
        this.onDamage     = null; this.onPlayerJoin = null;
        this.onPlayerLeave = null; this.onDead      = null;
        this._sendInterval = 1 / 20;
        this._sendTimer    = 0;
    }

    set beamPool(pool) { this._beamPool = pool; this.remotePlayers.forEach(rp => { rp.beamPool = pool; }); }
    get beamPool()     { return this._beamPool; }
    set audioListener(l) { this._audioListener = l; this.remotePlayers.forEach(rp => { if (!rp._audioListener) rp.setAudioListener(l); }); }
    get audioListener()  { return this._audioListener; }

    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                this.connected = true;
                // Send name + modelId immediately — server won't broadcast our join
                // until it receives this, so other clients always get the correct modelId.
                this.ws.send(JSON.stringify({
                    type:    'setName',
                    name:    this.playerName,
                    modelId: this.modelId,
                }));
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);

                    if (msg.type === 'init') {
                        this.localId = msg.id;
                        // All players in init are 'ready' — they sent setName before we connected
                        msg.players.forEach(p => this._addRemote(p.id, p.state));
                        resolve(msg.id);

                    } else if (msg.type === 'join') {
                        if (this.remotePlayers.has(msg.id)) {
                            // Known player re-joining = respawn
                            this.remotePlayers.get(msg.id).resetForRespawn(msg.state);
                        } else {
                            // Server only sends join AFTER setName → state.modelId is always correct
                            this._addRemote(msg.id, msg.state);
                        }
                        if (this.onPlayerJoin) this.onPlayerJoin(msg.id);

                    } else if (msg.type === 'leave') {
                        this._removeRemote(msg.id);
                        if (this.onPlayerLeave) this.onPlayerLeave(msg.id);

                    } else if (msg.type === 'move') {
                        if (this.remotePlayers.has(msg.id)) {
                            this.remotePlayers.get(msg.id).applyState(msg.state);
                        } else {
                            // Player exists on server but we missed their join — create from move
                            this._addRemote(msg.id, msg.state);
                        }

                    } else if (msg.type === 'damage') {
                        if (this.onDamage) this.onDamage(msg.amount);

                    } else if (msg.type === 'dead') {
                        const rp = this.remotePlayers.get(msg.id);
                        if (rp) { rp.isDead = true; rp.mesh.visible = false; rp.health = 0; }
                        if (this.onDead) this.onDead(msg.id);
                    }
                } catch (e) { console.warn('[Network] Bad message', e); }
            };

            this.ws.onerror = () => reject(new Error('WebSocket connection failed'));
        });
    }

    _addRemote(id, state) {
        if (this.remotePlayers.has(id)) return;
        // state.modelId is now guaranteed correct because server waits for setName before join
        const modelId = state?.modelId || 't800';
        const rp = new RemotePlayer(this.scene, id, modelId, state?.name || 'SPARTAN');
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
                    pos:         { x: localPlayer.mesh.position.x, y: localPlayer.mesh.position.y, z: localPlayer.mesh.position.z },
                    rotY:        localPlayer.mesh.rotation.y,
                    pitch:       localPlayer.cameraPivot.rotation.x,
                    health:      localPlayer.health.currentHealth,
                    weaponType:  localPlayer.weaponManager.currentType,
                    ultimate:    localPlayer.currentUltimate,
                    modelId:     localPlayer.modelId,
                    isShooting:  inputManager.isShooting,
                    isMoving:    k['KeyW'] || k['KeyS'] || k['KeyA'] || k['KeyD'],
                    isJumping:   localPlayer.isJumping,
                    forward:     !!k['KeyW'], backward: !!k['KeyS'],
                    left:        !!k['KeyA'], right:    !!k['KeyD'],
                    isSprinting: k['KeyW'] && (k['ShiftLeft'] || k['ShiftRight']),
                },
            }));
        }
    }

    reportHit(targetId, damage) {
        this.ws.send(JSON.stringify({ type: 'hit', targetId, amount: damage }));
        const rp = this.remotePlayers.get(targetId);
        if (rp) rp.takeDamage(damage);
    }

    reportDead() { this.ws.send(JSON.stringify({ type: 'dead' })); }

    reportRespawn(modelId) { this.ws.send(JSON.stringify({ type: 'respawn', modelId })); }
}
import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { attachRifleToHand } from './RifleUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { detectAnimationSlots, resolveAnimationTarget } from './AnimationUtils.js';

// ─────────────────────────────────────────────
// Remote Player
// Represents another human player in the scene.
// ─────────────────────────────────────────────
class RemotePlayer {
    constructor(scene, id, name = 'SPARTAN') {
        this.id = id;
        this.name = name;
        this.health = 100;
        this.isDead = false;

        this.targetPos = new THREE.Vector3();
        this.targetRotY = 0;

        this.boundingBox = new THREE.Box3();

        // Root group
        this.mesh = new THREE.Group();
        this.mesh.visible = false; // hidden until first state arrives
        scene.add(this.mesh);

        // Fallback capsule (shown while model loads)
        const capGeo = new THREE.CylinderGeometry(1.5, 1.5, 10, 8);
        const capMat = new THREE.MeshBasicMaterial({ color: 0xff4400, wireframe: true });
        this.capsule = new THREE.Mesh(capGeo, capMat);
        this.capsule.position.y = 5;
        this.mesh.add(this.capsule);

        // Name tag (sprite)
        this._buildNameTag(name);

        // Beam pool reference — set by NetworkManager after construction
        this.beamPool = null;

        // Positional audio for gunfire
        this._audioListener = null;
        this._gunSound = null;
        this._lastShotState = false;

        // Load the shared T-800 model – tinted orange so you can tell them apart
        const loader = new GLTFLoader();
        loader.load('models/t800.glb', (gltf) => {
            const model = gltf.scene;
            model.scale.set(10, 10, 10);
            model.rotation.y = Math.PI;
            model.traverse(child => {
                if (child.isMesh) {
                    child.frustumCulled = false;
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0xcc4400,
                        emissive: 0x220800,
                        metalness: 0.6,
                        roughness: 0.4,
                        skinning: true,
                    });
                }
            });
            this.mesh.remove(this.capsule);
            this.mesh.add(model);
            this.model = model;
            this.mesh.visible = true;

            this.mixer = new THREE.AnimationMixer(model);
            const { slots, actions } = detectAnimationSlots(gltf.animations, this.mixer);
            this.slots = slots;
            this.actions = actions;
            const animNames = Object.keys(actions);

            // Attach rifle to right hand if bone exists
            const rightHand = model.getObjectByName('bip_hand_R');
            if (rightHand) {
                attachRifleToHand(rightHand, (rifle) => {
                    this.rifle = rifle;
                });
            }

            this._playAnim(slots.idle);
        }, undefined, (err) => {
            console.error('RemotePlayer model load error:', err.message || err);
            this.mesh.visible = true;
        });
    }

    _buildNameTag(name) {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, 0, 256, 64);
        ctx.fillStyle = '#ff4400';
        ctx.font = 'bold 28px Courier New';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, 128, 32);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
        this.nameSprite = new THREE.Sprite(mat);
        this.nameSprite.scale.set(12, 3, 1);
        this.nameSprite.position.set(0, 18, 0);
        this.mesh.add(this.nameSprite);
    }

    _playAnim(name) {
        if (!this.actions) return;
        const next = this.actions[name];
        if (!next || this._activeAction === next) return;
        next.reset().setEffectiveWeight(1).play();
        if (this._activeAction) this._activeAction.crossFadeTo(next, 0.2, true);
        this._activeAction = next;
    }

    applyState(state) {
        if (state.pos) {
            this.targetPos.set(state.pos.x, state.pos.y, state.pos.z);
            this.mesh.visible = true;
        }
            if (state.rotY       !== undefined) this.targetRotY    = state.rotY;
            if (state.pitch      !== undefined) this.targetPitch   = state.pitch;
        if (state.health     !== undefined) this.health        = state.health;
        if (state.isShooting !== undefined) this._isShooting   = state.isShooting;
        if (state.isMoving   !== undefined) this._isMoving     = state.isMoving;
        if (state.isJumping  !== undefined) this._isJumping    = state.isJumping;
        if (state.forward    !== undefined) this._forward      = state.forward;
        if (state.backward   !== undefined) this._backward     = state.backward;
        if (state.left       !== undefined) this._left         = state.left;
        if (state.right      !== undefined) this._right        = state.right;
        if (state.isSprinting !== undefined) this._isSprinting = state.isSprinting;
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0 && !this.isDead) {
            this.isDead = true;
            this.mesh.visible = false;
        }
    }

    /** Called by NetworkManager after audio listener is available */
    setAudioListener(listener) {
        this._audioListener = listener;
        this._gunSound = new THREE.PositionalAudio(listener);
        // Load gun sound
        const loader = new THREE.AudioLoader();
        loader.load('sound_effects/gun_fire.mp3', (buffer) => {
            this._gunSound.setBuffer(buffer);
            this._gunSound.setRefDistance(30);
            this._gunSound.setVolume(0.5);
            this._gunSound.setLoop(false);
        });
        this.mesh.add(this._gunSound);
    }

    update(dt) {
        // Smooth interpolation
        this.mesh.position.lerp(this.targetPos, 0.25);
        this.mesh.rotation.y += (this.targetRotY - this.mesh.rotation.y) * 0.25;

        // Fire bullet immediately on single shot and spawn at rifle tip if available
        if (this._isShooting && this.beamPool && this.mesh.visible) {
            this._shotTimer = (this._shotTimer || 0) + dt;

            // Helper: build aim direction using both yaw AND pitch
            const aimDir = () => new THREE.Vector3(0, 0, -1).applyEuler(
                new THREE.Euler(this.targetPitch || 0, this.mesh.rotation.y, 0, 'YXZ')
            );
            const aimPos = () => {
                const p = this.mesh.position.clone();
                p.y += 8;
                return p;
            };

            // Fire immediately when isShooting transitions from false to true
            if (!this._lastShotState) {
                const poolIdx = this.beamPool.pool.findIndex(b => !b.userData.active);
                this.beamPool.fire(aimPos(), aimDir(), false);
                if (poolIdx >= 0) {
                    this.beamPool.pool[poolIdx].userData.isRemote = true;
                    this.beamPool.pool[poolIdx].material.color.setHex(0xff6600);
                }
            }

            // Continue firing for rapid shots
            while (this._shotTimer > 0.15) {
                this._shotTimer -= 0.15;
                const poolIdx = this.beamPool.pool.findIndex(b => !b.userData.active);
                this.beamPool.fire(aimPos(), aimDir(), false);
                if (poolIdx >= 0) {
                    this.beamPool.pool[poolIdx].userData.isRemote = true;
                    this.beamPool.pool[poolIdx].material.color.setHex(0xff6600);
                }
            }
        } else {
            this._shotTimer = 0;
        }

        // Gun sound on/off
        if (this._gunSound && this._gunSound.buffer) {
            if (this._isShooting && !this._lastShotState) {
                if (!this._gunSound.isPlaying) {
                this.pitch = this.pitch || 0;
                this.pitch += ((this.targetPitch || 0) - this.pitch) * 0.25;
                    this._gunSound.offset = 1.0;
                    this._gunSound.setLoop(true);
                    this._gunSound.play();
                }
            } else if (!this._isShooting && this._lastShotState) {
                if (this._gunSound.isPlaying) this._gunSound.stop();
            }
        }
        this._lastShotState = !!this._isShooting;

        // Animation — shared state machine identical to Character.js
        if (this.mixer && this.slots && this.actions) {
            const targetAnim = resolveAnimationTarget(
                {
                    isMoving:    !!this._isMoving,
                    isShooting:  !!this._isShooting,
                    isJumping:   !!this._isJumping,
                    forward:     !!this._forward,
                    backward:    !!this._backward,
                    left:        !!this._left,
                    right:       !!this._right,
                    isSprinting: !!this._isSprinting,
                },
                this.actions,
                this.slots
            );
            if (targetAnim) this._playAnim(targetAnim);
            this.mixer.update(dt);
        }

        // Bounding box (manual, cheaper than setFromObject)
        const c = this.mesh.position.clone();
        c.y += 6;
        this.boundingBox.setFromCenterAndSize(c, new THREE.Vector3(6, 12, 6));
    }

    dispose(scene) {
        scene.remove(this.mesh);
    }
}

// ─────────────────────────────────────────────
// NetworkManager
// ─────────────────────────────────────────────
export class NetworkManager {
    /**
     * @param {THREE.Scene} scene
     * @param {string} serverUrl  e.g. 'ws://localhost:8080'
     * @param {string} playerName callsign
     */
    constructor(scene, serverUrl, playerName = 'SPARTAN') {
        this.scene = scene;
        this.serverUrl = serverUrl;
        this.playerName = playerName;

        this.ws = null;
        this.localId = null;
        this.connected = false;

        this.remotePlayers = new Map(); // id -> RemotePlayer

        // Set these after construction so remote players can use them
        this.beamPool = null;
        this.audioListener = null;

        // Callbacks
        this.onDamage = null;   // (amount) => void
        this.onPlayerJoin = null;
        this.onPlayerLeave = null;
        this.onDead = null;     // (id) => void

        // Throttle outgoing move packets
        this._sendInterval = 1 / 20; // 20Hz
        this._sendTimer = 0;
    }

    /** Returns a Promise that resolves with localId when server sends 'init' */
    connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.serverUrl);

            this.ws.onopen = () => {
                this.connected = true;
                this.ws.send(JSON.stringify({ type: 'setName', name: this.playerName }));
                console.log('%c[NET] Connected to server', 'color:#00ffcc');
            };

            this.ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    this._handleMessage(msg, resolve);
                } catch (e) { /* ignore */ }
            };

            this.ws.onerror = (err) => {
                console.error('[NET] WebSocket error:', err);
                reject(new Error('WebSocket connection failed'));
            };

            this.ws.onclose = () => {
                this.connected = false;
                console.warn('[NET] Disconnected from server');
            };
        });
    }

    _handleMessage(msg, initResolve) {
        switch (msg.type) {

            case 'init':
                this.localId = msg.id;
                msg.players.forEach(p => this._addRemote(p.id, p.state));
                if (initResolve) initResolve(msg.id);
                break;

            case 'join':
                this._addRemote(msg.id, msg.state || {});
                if (this.onPlayerJoin) this.onPlayerJoin(msg.id);
                break;

            case 'leave':
                this._removeRemote(msg.id);
                if (this.onPlayerLeave) this.onPlayerLeave(msg.id);
                break;

            case 'move':
                if (this.remotePlayers.has(msg.id)) {
                    this.remotePlayers.get(msg.id).applyState(msg.state);
                }
                break;

            case 'damage':
                if (this.onDamage) this.onDamage(msg.amount);
                break;

            case 'dead':
                this._removeRemote(msg.id);
                if (this.onDead) this.onDead(msg.id);
                break;
        }
    }

    _addRemote(id, state) {
        if (this.remotePlayers.has(id)) return;
        const rp = new RemotePlayer(this.scene, id, state.name || 'SPARTAN');
        // Pass beam pool so remote players can fire visual beams
        rp.beamPool = this.beamPool;
        // Pass audio listener so remote players have positional gun sounds
        if (this.audioListener) rp.setAudioListener(this.audioListener);
        this.remotePlayers.set(id, rp);
        if (state.pos) rp.applyState(state);
    }

    _removeRemote(id) {
        const rp = this.remotePlayers.get(id);
        if (rp) { rp.dispose(this.scene); this.remotePlayers.delete(id); }
    }

    /** Call every frame from animate(). dt is delta time in seconds. */
    update(dt, localPlayer, inputManager) {
        // Update all remote player interpolation
        this.remotePlayers.forEach(rp => rp.update(dt));

        // Throttled move send
        this._sendTimer += dt;
        if (this._sendTimer >= this._sendInterval && localPlayer) {
            this._sendTimer = 0;
            this._sendMove(localPlayer, inputManager);
        }
    }

    _sendMove(player, inputManager) {
        if (!this.connected) return;
        const p = player.mesh.position;

        let isShooting = false, isMoving = false, isJumping = false;
        let forward = false, backward = false, left = false, right = false, isSprinting = false;

        if (inputManager) {
            const k     = inputManager.keys;
            forward     = !!k['KeyW'];
            backward    = !!k['KeyS'];
            left        = !!k['KeyA'];
            right       = !!k['KeyD'];
            isShooting  = !!inputManager.isShooting;
            isSprinting = forward && !!(k['ShiftLeft'] || k['ShiftRight']);
            isMoving    = forward || backward || left || right;
        }
        isJumping = !!player.isJumping;

        this._send({
            type: 'move',
            state: {
                pos: { x: p.x, y: p.y, z: p.z },
                rotY: player.mesh.rotation.y,
                    pitch: player.cameraPivot ? player.cameraPivot.rotation.x || 0 : 0,
                health: player.health.currentHealth,
                isShooting, isMoving, isJumping,
                forward, backward, left, right, isSprinting,
                name: this.playerName
            }
        });
    }

    /** Call when a local beam hits a remote player bounding box. */
    reportHit(targetId, damage) {
        this._send({ type: 'hit', targetId, amount: damage });
        // Visually apply on local side too for instant feedback
        const rp = this.remotePlayers.get(targetId);
        if (rp) rp.takeDamage(damage);
    }

    /** Call when local player dies. */
    reportDead() {
        this._send({ type: 'dead' });
    }

    _send(data) {
        if (this.connected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        }
    }

    disconnect() {
        if (this.ws) this.ws.close();
    }
}
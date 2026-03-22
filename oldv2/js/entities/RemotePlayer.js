/**
 * RemotePlayer.js — One remote peer's visual representation.
 *
 * Receives state snapshots from the server, lerps position/rotation,
 * and mirrors the correct animations from the synced flags.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getModel, getBoneName, getSizeConfig } from '../registry/ModelRegistry.js';
import { buildActionMap, resolveAnimationTarget } from '../systems/AnimationSystem.js';
import { WeaponManager } from '../weapons/WeaponManager.js';
import { WEAPON_DEFAULTS } from '../data/WeaponDefaults.js';

export class RemotePlayer {
    /**
     * @param {THREE.Scene} scene
     * @param {string}      id
     * @param {string}      modelId
     * @param {string}      name
     */
    constructor(scene, id, modelId = 't800', name = 'SPARTAN') {
        this.id      = id;
        this.name    = name;
        this.modelId = modelId;
        this.health  = 100;
        this.isDead  = false;

        this.targetPos   = new THREE.Vector3();
        this.targetRotY  = 0;
        this.targetPitch = 0;
        this.boundingBox = new THREE.Box3();

        this.mesh = new THREE.Group();
        this.mesh.visible = false;
        scene.add(this.mesh);

        this.weaponManager = new WeaponManager(true, modelId);

        // Animation state
        this.mixer        = null;
        this.actions      = {};
        this.slots        = {};
        this._activeAction = null;

        // Locomotion flags (set by applyState)
        this._isShooting     = false;
        this._isMoving       = false;
        this._isJumping      = false;
        this._forward        = false;
        this._backward       = false;
        this._left           = false;
        this._right          = false;
        this._isSprinting    = false;
        this.currentUltimate = null;

        // Melee / block
        this._isMeleeAttacking = false;
        this._incomingKey      = null;
        this._meleeAttackKey   = null;
        this._isAttacking      = false;
        this._attackAction     = null;
        this._isBlocking       = false;
        this._wasBlocking      = false;
        this._blockAnims       = [];
        this._blockIdx         = 0;
        this._currentBlockAct  = null;

        // Audio
        this.beamPool        = null;
        this._audioListener  = null;
        this._gunSound       = null;
        this._lastShotState  = false;
        this._remoteClock    = { elapsedTime: 0 };

        // Stats for scoreboard
        this._kills  = 0;
        this._deaths = 0;

        this._loadSeq = 0;
        this._loadModel(modelId);
    }

    // ─────────────────────────────────────────────────────────
    //  Model loading
    // ─────────────────────────────────────────────────────────

    _loadModel(modelId) {
        this.modelId = modelId;
        const seq = ++this._loadSeq;
        const profile = getModel(modelId);

        new GLTFLoader().load(profile.path, gltf => {
            if (seq !== this._loadSeq) return;

            // Clear previous model children
            while (this.mesh.children.length) this.mesh.remove(this.mesh.children[0]);

            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;
            this.mesh.add(model);

            this.weaponManager.setModelId(modelId);
            const weaponBoneName = getBoneName(modelId, WEAPON_DEFAULTS.GUN.WEAPON_BONE);
            const rightHand = model.getObjectByName(weaponBoneName);
            if (rightHand) this.weaponManager.init(rightHand);

            this.mixer = new THREE.AnimationMixer(model);
            this.mixer.addEventListener('finished', e => {
                if (e.action === this._attackAction) {
                    this._isAttacking  = false;
                    this._attackAction = null;
                }
            });

            const { actions, slots } = buildActionMap(gltf.animations, this.mixer, modelId);
            this.actions = actions;
            this.slots   = slots;
            this._activeAction    = null;
            this._isAttacking     = false;
            this._attackAction    = null;
            this._meleeAttackKey  = null;
            this._currentBlockAct = null;

            const blockKeys = ['melee_block', 'melee_block_1', 'melee_block_2', 'melee_block_3', 'melee_block_4'];
            this._blockAnims = blockKeys.filter(k => !!actions[k]);
            if (!this._blockAnims.length && actions['melee_idle']) this._blockAnims = ['melee_idle'];
            this._blockIdx = 0;

            this.mesh.visible = !this.isDead;
            this._updateHitbox();

            if (this._audioListener && !this._gunSound) this._setupGunSound();
        });
    }

    // ─────────────────────────────────────────────────────────
    //  State sync
    // ─────────────────────────────────────────────────────────

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

        this._isShooting      = state.isShooting;
        this._isMoving        = state.isMoving;
        this._isJumping       = state.isJumping;
        this._forward         = state.forward;
        this._backward        = state.backward;
        this._left            = state.left;
        this._right           = state.right;
        this._isSprinting     = state.isSprinting;
        this.currentUltimate  = state.ultimate;
        this._isMeleeAttacking = !!state.isMeleeAttacking;
        this._incomingKey      = state.meleeAttackKey || null;
        this._isBlocking       = !!state.isBlocking;

        if (state.modelId && state.modelId !== this.modelId) this._loadModel(state.modelId);
        if (state.weaponType && state.weaponType !== this.weaponManager.currentType)
            this.weaponManager.equip(state.weaponType);
    }

    resetForRespawn(state) {
        this.health        = 100;
        this.isDead        = false;
        this.mesh.visible  = true;
        this._activeAction    = null;
        this._isAttacking     = false;
        this._attackAction    = null;
        this._meleeAttackKey  = null;
        this._currentBlockAct = null;
        this._wasBlocking  = false;
        this._isBlocking   = false;
        this._blockIdx     = 0;
        if (state?.modelId && state.modelId !== this.modelId) this._loadModel(state.modelId);
        if (state?.pos) this.applyState(state);
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0 && !this.isDead) { this.isDead = true; this.mesh.visible = false; }
    }

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

    // ─────────────────────────────────────────────────────────
    //  Per-frame update
    // ─────────────────────────────────────────────────────────

    update(dt) {
        this.mesh.position.lerp(this.targetPos, 0.25);
        this.mesh.rotation.y += (this.targetRotY - this.mesh.rotation.y) * 0.25;
        this._remoteClock.elapsedTime += dt;

        // Remote gun fire
        if (this._isShooting && this.mesh.visible && this.beamPool && !this.currentUltimate)
            this.weaponManager.attemptFire(this._remoteClock, {
                player: this, beamPool: this.beamPool, isRemote: true,
            });

        // Positional gun audio
        this._updateGunAudio();

        // Animation
        if (this.mixer) this._updateAnimation(dt);

        this._updateHitbox();
    }

    dispose(scene) { scene.remove(this.mesh); }

    // ─────────────────────────────────────────────────────────
    //  Private helpers
    // ─────────────────────────────────────────────────────────

    _updateHitbox() {
        const sc = getSizeConfig(this.modelId);
        const c  = this.mesh.position.clone();
        c.y += sc.hitboxCenterOffsetY;
        this.boundingBox.setFromCenterAndSize(
            c, new THREE.Vector3(sc.hitboxSize.x, sc.hitboxSize.y, sc.hitboxSize.z)
        );
    }

    _updateGunAudio() {
        if (!this._gunSound?.buffer || this.weaponManager.currentType !== 'gun') return;
        if (this._isShooting  && !this._lastShotState && !this._gunSound.isPlaying) {
            this._gunSound.setLoop(true);
            this._gunSound.play();
        } else if (!this._isShooting && this._lastShotState && this._gunSound.isPlaying) {
            this._gunSound.stop();
        }
        this._lastShotState = !!this._isShooting;
    }

    _updateAnimation(dt) {
        const isMelee     = this.weaponManager.currentType === 'melee';
        const blockRising = this._isBlocking && !this._wasBlocking;
        this._wasBlocking = this._isBlocking;

        if (!this._isBlocking) this._currentBlockAct = null;

        // Priority 1: blocking
        if (this._isBlocking && isMelee) {
            if ((blockRising || !this._currentBlockAct) && this._blockAnims.length) {
                const key      = this._blockAnims[this._blockIdx % this._blockAnims.length];
                this._blockIdx++;
                const blockAct = this.actions[key];
                if (blockAct && this._activeAction !== blockAct) {
                    blockAct.reset().setEffectiveWeight(1).play();
                    if (this._activeAction) this._activeAction.crossFadeTo(blockAct, 0.1, true);
                    this._activeAction    = blockAct;
                    this._currentBlockAct = blockAct;
                    this._isAttacking     = false;
                    this._attackAction    = null;
                    this._meleeAttackKey  = null;
                }
            }
        // Priority 2: new melee attack
        } else if (this._isMeleeAttacking && isMelee && this._incomingKey &&
                   this._incomingKey !== this._meleeAttackKey && !this._isBlocking) {
            const atk = this.actions[this._incomingKey] || this.actions[this._incomingKey.toLowerCase()];
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
        // Priority 3: locomotion
        } else if (!this._isAttacking) {
            if (!this._isMeleeAttacking) this._meleeAttackKey = null;
            const target = resolveAnimationTarget({
                isMoving: !!this._isMoving, isShooting: !!this._isShooting,
                isJumping: !!this._isJumping,
                forward: !!this._forward, backward: !!this._backward,
                left: !!this._left, right: !!this._right,
                isSprinting: !!this._isSprinting,
                weaponType: this.weaponManager.currentType,
                ultimate: this.currentUltimate, isBlocking: false,
            }, this.actions);
            if (target && this.actions[target]) {
                const next = this.actions[target];
                if (this._activeAction !== next) {
                    next.reset().setEffectiveWeight(1).play();
                    if (this._activeAction) this._activeAction.crossFadeTo(next, 0.2, true);
                    this._activeAction = next;
                }
            }
        }
        this.mixer.update(dt);
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
}

// Shared gun audio buffer across all instances (static)
RemotePlayer._gunFireBuffer = null;

/**
 * Character.js — Local player entity.
 *
 * Owns: mesh, health, weaponManager, animation mixer, block/melee state.
 * Delegates to: PhysicsSystem (movement/collision), AnimationSystem (anim logic),
 *               WeaponManager (fire), HealthComponent.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getModel, getBoneName, getSizeConfig } from '../registry/ModelRegistry.js';
import { buildActionMap, resolveAnimationTarget } from '../systems/AnimationSystem.js';
import { buildMoveDir, canMoveInDirection, classifyMoveDir, snapToGround } from '../systems/PhysicsSystem.js';
import { HealthComponent } from '../systems/HealthSystem.js';
import { WeaponManager } from '../weapons/WeaponManager.js';

export class Character {
    constructor(scene, modelId) {
        this.modelId = modelId;

        const sc = getSizeConfig(modelId);
        this.sizeConfig = sc;

        // ── Scene graph ───────────────────────────────────────────
        this.mesh = new THREE.Group();
        scene.add(this.mesh);
        this.cameraPivot = new THREE.Group();
        this.cameraPivot.position.set(0, sc.cameraPivotY, 0);
        this.mesh.add(this.cameraPivot);

        // ── Core components ───────────────────────────────────────
        this.health        = new HealthComponent(100, 'player-health-bar');
        this.weaponManager = new WeaponManager(false, modelId);
        this.boundingBox   = new THREE.Box3();
        this.meleeHitBox   = new THREE.Box3();

        // ── Physics state ─────────────────────────────────────────
        this.isJumping    = false;
        this.yVelocity    = 0;
        this._groundY     = 0;
        this._collisionMeshes = [];
        this.lastStepTime = 0;

        // ── Animation state ───────────────────────────────────────
        this.mixer           = null;
        this.actions         = {};
        this.slots           = {};
        this.activeAction    = null;
        this.currentUltimate = null;
        this.ultimateTimer   = 0;
        this._hitReacting    = false;

        // ── Melee state ───────────────────────────────────────────
        this.meleeAttacking    = false;
        this.meleeAttackAction = null;
        this.meleeHitBoxActive = false;
        this._meleeHitTargets  = new Set();
        this._meleeWasInWindow = false;

        // ── Block state ───────────────────────────────────────────
        this.isBlocking       = false;
        this._wasBlocking     = false;
        this._blockAnims      = [];
        this._blockIdx        = 0;
        this._currentBlockAct = null;

        // ── Head / spine bone refs (set after GLB loads) ──────────
        this._headBone  = null;
        this._spineBones = [];

        this._loadModel(scene, modelId, sc);
    }

    // ─────────────────────────────────────────────────────────
    //  Model loading
    // ─────────────────────────────────────────────────────────

    _loadModel(scene, modelId, sc) {
        const profile = getModel(modelId);
        new GLTFLoader().load(profile.path, gltf => {
            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;
            this.mesh.add(model);

            // Debug: log bones + clips once
            const boneNames = [], clipNames = gltf.animations.map(c => c.name);
            model.traverse(child => {
                if (child.isBone) boneNames.push(child.name);
                if (child.isMesh) child.frustumCulled = false;
            });
            console.groupCollapsed(`[${modelId}] ${boneNames.length} bones / ${clipNames.length} clips`);
            boneNames.forEach((n, i) => console.log(`  ${i.toString().padStart(3, '0')}  ${n}`));
            clipNames.forEach((n, i) => console.log(`  ${i.toString().padStart(3, '0')}  ${n}`));
            console.groupEnd();

            // Head + spine for pitch lean
            this._headBone = model.getObjectByName(getBoneName(modelId, 'head'));
            ['spine', 'spine_upper'].forEach(key => {
                const name = getBoneName(modelId, key);
                if (name && name !== key) {
                    const bone = model.getObjectByName(name);
                    if (bone && !this._spineBones.includes(bone)) this._spineBones.push(bone);
                }
            });
            if (this._spineBones.length === 0) {
                ['spine', 'Spine', 'mixamorigSpine', 'bip_spine_2'].forEach(n => {
                    const bone = model.getObjectByName(n);
                    if (bone) this._spineBones.push(bone);
                });
            }

            // Mixer + action map
            this.mixer = new THREE.AnimationMixer(model);
            this.mixer.addEventListener('finished', e => {
                if (e.action === this.meleeAttackAction) {
                    this.meleeAttacking    = false;
                    this.meleeAttackAction = null;
                    this.meleeHitBoxActive = false;
                }
            });

            const { actions, slots } = buildActionMap(gltf.animations, this.mixer, modelId);
            this.actions = actions;
            this.slots   = slots;

            // Build block anim list
            const blockKeys = ['melee_block', 'melee_block_1', 'melee_block_2', 'melee_block_3', 'melee_block_4'];
            this._blockAnims = blockKeys.filter(k => !!actions[k]);
            if (!this._blockAnims.length && actions['melee_idle']) this._blockAnims = ['melee_idle'];
            this._blockIdx = 0;

            // Attach weapon
            const boneName  = getBoneName(modelId, 'hand_R');
            const weaponBone = model.getObjectByName(boneName);
            if (weaponBone) this.weaponManager.init(weaponBone);
            else console.warn(`[${modelId}] Weapon bone not found: "${boneName}"`);

            this.playAction('idle');
        });
    }

    // ─────────────────────────────────────────────────────────
    //  Public helpers
    // ─────────────────────────────────────────────────────────

    setCollisionMeshes(meshes) { this._collisionMeshes = meshes || []; }

    snapToGround(collisionMeshes) {
        this._groundY = snapToGround(this.mesh.position, this.sizeConfig, collisionMeshes);
    }

    playAction(name) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset().setEffectiveWeight(1).play();
        if (this.activeAction) this.activeAction.crossFadeTo(next, 0.2, true);
        this.activeAction = next;
    }

    playHitReaction() {
        if (!this.mixer || this.health.isDead) return;
        const hitAct = this.actions['hit_body'];
        if (!hitAct) return;
        hitAct.reset();
        hitAct.setLoop(THREE.LoopOnce, 1);
        hitAct.clampWhenFinished = true;
        hitAct.setEffectiveWeight(1).play();
        if (this.activeAction && this.activeAction !== hitAct)
            this.activeAction.crossFadeTo(hitAct, 0.05, true);
        this.activeAction = hitAct;
        this._hitReacting = true;
        setTimeout(() => { this._hitReacting = false; }, ((hitAct.getClip()?.duration ?? 0.4) * 1000) + 50);
    }

    // ─────────────────────────────────────────────────────────
    //  Main update
    // ─────────────────────────────────────────────────────────

    update(dt, clock, inputManager, audioManager, dependencies) {
        if (this.health.isDead) { audioManager.stopAll(); return; }

        const sc = this.sizeConfig;
        const { beamPool, enemies, network } = dependencies;
        const k = inputManager.keys;

        const keys = {
            forward:  !!k['KeyW'], backward: !!k['KeyS'],
            left:     !!k['KeyA'], right:    !!k['KeyD'],
        };
        const sprint     = !!(k['ShiftLeft'] || k['ShiftRight']);
        const isSprinting = keys.forward && sprint;
        const camYaw      = inputManager.mouseLookX;

        // ── Block ─────────────────────────────────────────────────
        this.isBlocking = inputManager.isBlocking &&
                          this.weaponManager.currentType === 'melee' &&
                          !this.meleeAttacking;

        // ── Hitbox ────────────────────────────────────────────────
        const center = this.mesh.position.clone();
        center.y += sc.hitboxCenterOffsetY;
        this.boundingBox.setFromCenterAndSize(
            center, new THREE.Vector3(sc.hitboxSize.x, sc.hitboxSize.y, sc.hitboxSize.z)
        );

        // ── Weapon swap ───────────────────────────────────────────
        if (inputManager.activeWeapon !== this.weaponManager.currentType)
            this.weaponManager.equip(inputManager.activeWeapon);

        // ── Ultimate ──────────────────────────────────────────────
        if (inputManager.ultimateQueue && this.weaponManager.currentType === 'melee') {
            this.currentUltimate       = inputManager.ultimateQueue;
            this.ultimateTimer         = 0;
            inputManager.ultimateQueue = null;
        }
        if (this.currentUltimate) {
            this.ultimateTimer += dt;
            if (this.ultimateTimer > 1.5) this.currentUltimate = null;
        }

        // ── Movement ──────────────────────────────────────────────
        let isMoving = false;
        const moveDir = buildMoveDir(keys, camYaw);
        if (moveDir.lengthSq() > 0 && canMoveInDirection(this.mesh.position, moveDir, sc, this._collisionMeshes)) {
            const speed = isSprinting ? sc.walkSpeed * sc.runMultiplier : sc.walkSpeed;
            this.mesh.position.addScaledVector(moveDir, speed * dt);
            isMoving = true;
        }

        // ── Rotation (smooth yaw to camera) ───────────────────────
        let dYaw = camYaw - this.mesh.rotation.y;
        while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        this.mesh.rotation.y += dYaw * Math.min(1, 14 * dt);
        this.cameraPivot.rotation.x = -inputManager.mouseLookY;

        // ── Jump ──────────────────────────────────────────────────
        if (k['Space'] && !this.isJumping && !inputManager.isNoclip) {
            this.isJumping = true;
            this.yVelocity = sc.jumpStrength;
        }
        if (this.isJumping || this.mesh.position.y > this._groundY) {
            this.yVelocity -= sc.gravity * dt;
            this.mesh.position.y += this.yVelocity * dt;
            if (this.mesh.position.y <= this._groundY) {
                this.mesh.position.y = this._groundY;
                this.isJumping = false;
                this.yVelocity = 0;
            }
        } else {
            this.mesh.position.y = this._groundY;
        }

        // ── Audio ─────────────────────────────────────────────────
        if (inputManager.isShooting && !inputManager.isNoclip && this.weaponManager.currentType === 'gun')
            audioManager.playGunfire();
        else
            audioManager.stopGunfire();

        if (isMoving && !this.isJumping && !inputManager.isNoclip) {
            const rate = isSprinting ? sc.stepRate * 0.6 : sc.stepRate;
            if (clock.elapsedTime - this.lastStepTime > rate) {
                this.lastStepTime = clock.elapsedTime;
                audioManager.playFootstep();
            }
        }

        // ── Animations ────────────────────────────────────────────
        if (this.mixer) this._updateAnimation(dt, isMoving, moveDir, isSprinting, inputManager);

        // ── Melee attack (left-click, LoopOnce) ───────────────────
        if (this.weaponManager.currentType === 'melee' && !this.currentUltimate &&
            !inputManager.isNoclip && !this.isBlocking && inputManager.isShooting &&
            !this.meleeAttacking) {
            this._startMeleeAttack(clock, audioManager);
        }

        // ── Animation-timed melee damage box ──────────────────────
        if (this.meleeAttacking && this.meleeAttackAction)
            this._updateMeleeDamageBox(enemies, network);
        else
            this.meleeHitBoxActive = false;

        // ── Gun fire ──────────────────────────────────────────────
        if (inputManager.isShooting && !this.currentUltimate && !inputManager.isNoclip &&
            this.weaponManager.currentType === 'gun') {
            this.weaponManager.attemptFire(clock, {
                player: this, beamPool, enemies, network, inputManager, isRemote: false,
            });
        }
    }

    // ─────────────────────────────────────────────────────────
    //  Private animation helpers
    // ─────────────────────────────────────────────────────────

    _updateAnimation(dt, isMoving, moveDir, isSprinting, inputManager) {
        // Classify move direction vs character facing
        const dirs = isMoving && moveDir.lengthSq() > 0
            ? classifyMoveDir(moveDir, this.mesh.rotation.y)
            : { animFwd: false, animBack: false, animLeft: false, animRight: false };

        // Block animation cycling
        const blockRising = this.isBlocking && !this._wasBlocking;
        this._wasBlocking = this.isBlocking;

        if (this.isBlocking && !this.meleeAttacking && !this._hitReacting) {
            if ((blockRising || !this._currentBlockAct) && this._blockAnims.length) {
                const key      = this._blockAnims[this._blockIdx % this._blockAnims.length];
                this._blockIdx++;
                const blockAct = this.actions[key];
                if (blockAct && this.activeAction !== blockAct) {
                    blockAct.reset().setEffectiveWeight(1).play();
                    if (this.activeAction) this.activeAction.crossFadeTo(blockAct, 0.1, true);
                    this.activeAction     = blockAct;
                    this._currentBlockAct = blockAct;
                }
            }
        } else if (!this.isBlocking) {
            this._currentBlockAct = null;
        }

        if (!this.isBlocking && !this._hitReacting) {
            const target = resolveAnimationTarget({
                isMoving, isShooting: inputManager.isShooting, isJumping: this.isJumping,
                forward: dirs.animFwd, backward: dirs.animBack,
                left: dirs.animLeft, right: dirs.animRight,
                isSprinting,
                weaponType: this.weaponManager.currentType,
                ultimate: this.currentUltimate,
                isBlocking: false,
            }, this.actions);
            if (target && !this.meleeAttacking) this.playAction(target);
        }

        // Upper-body shoot blend over walk
        const upperKey = this.weaponManager.currentType === 'gun' ? this.slots.shoot + '_upperbody' : null;
        if (upperKey && this.actions[upperKey] && !this.currentUltimate) {
            const ua = this.actions[upperKey];
            ua.setEffectiveWeight(THREE.MathUtils.lerp(
                ua.getEffectiveWeight(),
                (inputManager.isShooting && isMoving && !this.isJumping) ? 1 : 0,
                0.15
            ));
        }

        this.mixer.update(dt);

        // Pitch lean: head + spine
        const pitch = inputManager.mouseLookY;
        if (this._headBone) this._headBone.rotation.x += pitch * 0.55;
        if (this._spineBones.length) {
            const share = (pitch * 0.45) / this._spineBones.length;
            this._spineBones.forEach(b => { b.rotation.x += share; });
        }
    }

    _startMeleeAttack(clock, audioManager) {
        const candidates = [
            'melee_attack_1', 'melee_attack_2', 'melee_attack_3',
            'melee_combo_1', 'melee_combo_2', 'melee_kick',
        ].filter(k => !!this.actions[k]);

        const meleeWep = this.weaponManager.weapons.melee;
        if (!candidates.length || !meleeWep.canFire(clock)) return;

        const key    = candidates[Math.floor(Math.random() * candidates.length)];
        const action = this.actions[key];
        action.reset();
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(1).play();
        if (this.activeAction && this.activeAction !== action)
            this.activeAction.crossFadeTo(action, 0.12, true);

        this.activeAction      = action;
        this.meleeAttacking    = true;
        this.meleeAttackAction = action;
        this._meleeHitTargets  = new Set();
        this._meleeWasInWindow = false;
        audioManager.playMeleeSwoosh();
    }

    _updateMeleeDamageBox(enemies, network) {
        const conf  = this.weaponManager.weapons.melee.config;
        const db    = conf.damageBox || {};
        const clip  = this.meleeAttackAction.getClip();
        const t     = clip.duration > 0 ? Math.min(this.meleeAttackAction.time / clip.duration, 1) : 0;
        const wStart = db.hitWindowStart ?? 0.25;
        const wEnd   = db.hitWindowEnd   ?? 0.72;
        const inWin  = t >= wStart && t <= wEnd;

        const wMesh = this.weaponManager.weapons.melee.mesh;
        const off   = db.offset || [0, 0, -8];
        const sz    = db.size   || [4, 4, 14];
        const origin = wMesh
            ? wMesh.localToWorld(new THREE.Vector3(off[0], off[1], off[2]))
            : this.mesh.position.clone().setY(this.mesh.position.y + (this.sizeConfig.height ?? 12) * 0.5);

        this.meleeHitBox.setFromCenterAndSize(origin, new THREE.Vector3(sz[0], sz[1], sz[2]));
        this.meleeHitBoxActive = inWin;

        if (inWin && !this._meleeWasInWindow) this._meleeHitTargets.clear();
        this._meleeWasInWindow = inWin;

        if (inWin) {
            enemies?.forEach(enemy => {
                if (!enemy.health.isDead && !this._meleeHitTargets.has(enemy) &&
                    enemy.boundingBox && this.meleeHitBox.intersectsBox(enemy.boundingBox)) {
                    enemy.health.takeDamage(conf.DAMAGE ?? 50);
                    this._meleeHitTargets.add(enemy);
                }
            });
            network?.remotePlayers.forEach((rp, id) => {
                if (!rp.isDead && !this._meleeHitTargets.has(id) && rp.boundingBox &&
                    this.meleeHitBox.intersectsBox(rp.boundingBox)) {
                    if (network.reportHit(id, conf.DAMAGE ?? 50)) this._meleeHitTargets.add(id);
                }
            });
        }
    }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildActionMap, resolveAnimationTarget } from './AnimationUtils.js';
import { getModel, getBoneName, getSizeConfig } from './ModelRegistry.js';
import { HealthComponent } from './Systems.js';
import { WeaponManager } from './Weapons.js';
import { CONFIG } from './Config.js';

export class Character {
    constructor(scene, modelId) {
        this.modelId = modelId;

        const sc = getSizeConfig(modelId);
        this.sizeConfig         = sc;
        this.baseWalkSpeed      = sc.walkSpeed;
        this.runSpeedMultiplier = sc.runMultiplier;
        this.gravity            = sc.gravity;
        this.jumpStrength       = sc.jumpStrength;
        this.stepRate           = sc.stepRate;

        this.mesh = new THREE.Group(); scene.add(this.mesh);
        this.cameraPivot = new THREE.Group();
        this.cameraPivot.position.set(0, sc.cameraPivotY, 0);
        this.mesh.add(this.cameraPivot);

        this.health        = new HealthComponent(100, 'player-health-bar');
        this.boundingBox   = new THREE.Box3();
        this.weaponManager = new WeaponManager(false, modelId);

        this.lastStepTime = 0;
        this.isJumping    = false; this.yVelocity = 0;
        this._groundY     = 0;
        this._raycaster   = new THREE.Raycaster();
        this._wallRay     = new THREE.Raycaster();
        this._collisionMeshes = [];

        this.mixer             = null; this.actions = {}; this.slots = {};
        this.currentUltimate   = null; this.ultimateTimer = 0;
        // Melee state
        this.meleeAttacking    = false;
        this.meleeAttackAction = null;
        this._meleeHitTargets  = new Set();
        this._meleeWasInWindow = false;
        this.meleeHitBox       = new THREE.Box3();
        this.meleeHitBoxActive = false;

        // Block state
        this.isBlocking        = false;
        this._wasBlocking      = false;
        this._blockAnims       = [];    // populated after GLB loads
        this._blockIdx         = 0;     // cycles through available block clips
        this._currentBlockAct  = null;  // the action currently playing as block

        // Weapon swap animation state
        this._swapping         = false;   // true while equip/unequip LoopOnce plays
        this._swapAction       = null;
        this._pendingWeapon    = null;    // weapon to equip after unequip finishes

        const profile = getModel(modelId);
        new GLTFLoader().load(profile.path, (gltf) => {
            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;
            this.mesh.add(model);

            const boneNames = [];
            model.traverse(child => {
                if (child.isBone) boneNames.push(child.name);
                if (child.isMesh) child.frustumCulled = false;
            });
            console.group(`%c[${modelId}] Bones (${boneNames.length} total)`, 'color:#00ffcc;font-weight:bold;');
            boneNames.forEach((name, i) => console.log(`  ${String(i).padStart(3, '0')}  ${name}`));
            console.groupEnd();

            const clipNames = gltf.animations.map(c => c.name);
            console.group(`%c[${modelId}] Animation clips (${clipNames.length} total)`, 'color:#ffaa00;font-weight:bold;');
            clipNames.forEach((name, i) => console.log(`  ${String(i).padStart(3, '0')}  ${name}`));
            console.groupEnd();

            this._headBone   = model.getObjectByName(getBoneName(modelId, 'head'));
            this._spineBones = [];
            const spineKeys  = ['spine', 'spine_upper'];
            spineKeys.forEach(key => {
                const boneName = getBoneName(modelId, key);
                if (boneName && boneName !== key) {
                    const bone = model.getObjectByName(boneName);
                    if (bone && !this._spineBones.includes(bone)) this._spineBones.push(bone);
                }
            });
            if (this._spineBones.length === 0) {
                ['spine', 'Spine', 'mixamorigSpine', 'bip_spine_2'].forEach(name => {
                    const bone = model.getObjectByName(name);
                    if (bone) this._spineBones.push(bone);
                });
            }

            this.mixer = new THREE.AnimationMixer(model);

            this.mixer.addEventListener('finished', (e) => {
                // Melee attack finished
                if (e.action === this.meleeAttackAction) {
                    this.meleeAttacking    = false;
                    this.meleeAttackAction = null;
                    this.meleeHitBoxActive = false;
                }
                // Weapon swap animation finished
                if (e.action === this._swapAction) {
                    this._swapping    = false;
                    this._swapAction  = null;
                    // Unequip finished — now do the actual mesh swap
                    if (this._pendingWeapon) {
                        const next = this._pendingWeapon;
                        this._pendingWeapon = null;
                        if (next === '__gun__') {
                            this.weaponManager.equip('gun');
                        } else {
                            this.weaponManager.equip(next);
                            this._playSwapAnim('equip_melee');
                        }
                    }
                }
            });

            const weaponBoneName = getBoneName(modelId, CONFIG.WEAPONS.GUN.WEAPON_BONE);
            const weaponBone = model.getObjectByName(weaponBoneName);
            if (weaponBone) {
                this.weaponManager.init(weaponBone);
            } else {
                console.warn(`[${modelId}] Weapon bone not found: "${weaponBoneName}"`);
            }

            const { actions, slots } = buildActionMap(gltf.animations, this.mixer, modelId);
            this.actions = actions; this.slots = slots;

            // Build ordered list of all block animations: melee_block, melee_block_1, melee_block_2 …
            const blockKeys = ['melee_block','melee_block_1','melee_block_2','melee_block_3','melee_block_4'];
            this._blockAnims = blockKeys.filter(k => !!this.actions[k]);
            // Fallback: if none found, use melee_idle so we always have something
            if (this._blockAnims.length === 0 && this.actions['melee_idle']) this._blockAnims = ['melee_idle'];
            this._blockIdx = 0;

            this.playAction('idle');
        });
    }

    snapToGround(collisionMeshes) {
        if (!collisionMeshes?.length) { this._groundY = 0; return; }
        const sc = this.sizeConfig, y = this.mesh.position.y;
        this._raycaster.set(new THREE.Vector3(this.mesh.position.x, y + sc.stepUp, this.mesh.position.z), new THREE.Vector3(0,-1,0));
        this._raycaster.far = sc.stepUp + sc.stepDown;
        const hits = this._raycaster.intersectObjects(collisionMeshes, false);
        this._groundY = (hits.length > 0 && hits[0].point.y <= y + sc.stepUp) ? hits[0].point.y : y - sc.stepDown;
        this._raycaster.far = Infinity;
    }

    setCollisionMeshes(meshes) { this._collisionMeshes = meshes || []; }

    playAction(name) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset().setEffectiveWeight(1).play();
        if (this.activeAction) this.activeAction.crossFadeTo(next, 0.2, true);
        this.activeAction = next;
    }

    /** Play hit_body LoopOnce on the local player (when taking damage). */
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
        // Brief flag to prevent next resolver tick from interrupting immediately
        this._hitReacting = true;
        const dur = (hitAct.getClip()?.duration ?? 0.4) * 1000;
        setTimeout(() => { this._hitReacting = false; }, dur + 50);
    }

    /** Play equip_melee or unequip_melee as LoopOnce, locking all other animation logic. */
    _playSwapAnim(key) {
        if (!this.mixer) return false;
        const act = this.actions[key];
        if (!act) return false;
        act.reset();
        act.setLoop(THREE.LoopOnce, 1);
        act.clampWhenFinished = true;
        // Play equip/unequip at 2.5x speed for snappier feel
        act.setEffectiveTimeScale(2.5);
        act.setEffectiveWeight(1).play();
        if (this.activeAction && this.activeAction !== act)
            this.activeAction.crossFadeTo(act, 0.1, true);
        this.activeAction = act;
        this._swapping    = true;
        this._swapAction  = act;

        // Safety: if the 'finished' event never fires (zero-duration clip or edge case)
        // release the swap lock after clip duration + 200ms grace period.
        const dur = ((act.getClip()?.duration ?? 0.5) * 1000 + 200) / 2.5;
        clearTimeout(this._swapTimeout);
        this._swapTimeout = setTimeout(() => {
            if (this._swapAction === act) {
                // Force-complete: run the finished logic manually
                this._swapping    = false;
                this._swapAction  = null;
                if (this._pendingWeapon) {
                    const next = this._pendingWeapon;
                    this._pendingWeapon = null;
                    if (next === '__gun__') { this.weaponManager.equip('gun'); }
                    else { this.weaponManager.equip(next); this._playSwapAnim('equip_melee'); }
                }
            }
        }, dur);

        return true;
    }

    /**
     * Animated weapon swap:
     *   gun → melee : play unequip_melee (there isn't one for gun so skip), then equip_melee
     *   melee → gun : play unequip_melee then switch mesh, no equip anim for gun
     * If the animations don't exist the swap happens instantly (same as before).
     */
    swapWeapon(targetType) {
        if (this._swapping) return;                                    // already mid-swap
        if (targetType === this.weaponManager.currentType) return;     // no-op

        const fromMelee = this.weaponManager.currentType === 'melee';
        const toMelee   = targetType === 'melee';

        if (fromMelee) {
            // Unequip melee → finished handler will swap mesh to gun
            const played = this._playSwapAnim('unequip_melee');
            if (played) {
                this._pendingWeapon = '__gun__';
            } else {
                this.weaponManager.equip('gun');
            }
        } else if (toMelee) {
            // Equip melee mesh immediately, play equip anim on top
            this.weaponManager.equip('melee');
            this._playSwapAnim('equip_melee');
        }
    }

    update(dt, clock, inputManager, audioManager, dependencies) {
        if (this.health.isDead) {
            audioManager.stopAll();   // force-kills gun loop, step, melee sounds
            return;
        }

        const sc = this.sizeConfig;
        this.baseWalkSpeed      = sc.walkSpeed;
        this.runSpeedMultiplier = sc.runMultiplier;
        this.gravity            = sc.gravity;
        this.jumpStrength       = sc.jumpStrength;
        this.stepRate           = sc.stepRate;
        let isMoving = false;
        const { beamPool, enemies, network } = dependencies;
        const input    = inputManager.keys;
        const forward  = input['KeyW'], backward = input['KeyS'];
        const left     = input['KeyA'], right    = input['KeyD'];
        const sprint   = input['ShiftLeft'] || input['ShiftRight'];
        const jump     = input['Space'];
        const isSprinting = forward && sprint;

        // ── Blocking state ─────────────────────────────────────────
        // Only active in melee mode; can't block while attacking
        this.isBlocking = inputManager.isBlocking &&
                          this.weaponManager.currentType === 'melee' &&
                          !this.meleeAttacking;

        const center = this.mesh.position.clone(); center.y += sc.hitboxCenterOffsetY;
        this.boundingBox.setFromCenterAndSize(center, new THREE.Vector3(sc.hitboxSize.x, sc.hitboxSize.y, sc.hitboxSize.z));

        if (inputManager.activeWeapon !== this.weaponManager.currentType && !this._swapping)
            this.swapWeapon(inputManager.activeWeapon);

        if (inputManager.ultimateQueue && this.weaponManager.currentType === 'melee') {
            this.currentUltimate = inputManager.ultimateQueue; this.ultimateTimer = 0; inputManager.ultimateQueue = null;
        }
        if (this.currentUltimate) { this.ultimateTimer += dt; if (this.ultimateTimer > 1.5) this.currentUltimate = null; }

        const camYaw   = inputManager.mouseLookX;
        const camSinY  = Math.sin(camYaw),  camCosY = Math.cos(camYaw);
        const camFwd   = new THREE.Vector3(-camSinY, 0, -camCosY);
        const camRight = new THREE.Vector3( camCosY, 0, -camSinY);

        const canMove = dir => {
            if (!this._collisionMeshes.length) return true;
            const rayHeights = Array.isArray(sc.wallRayHeights)
                ? sc.wallRayHeights
                : [sc.height * 0.083, sc.height * 0.417, sc.height * 0.75];
            for (const h of rayHeights) {
                this._wallRay.set(new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + h, this.mesh.position.z), dir);
                this._wallRay.far = sc.width * 0.6;
                if (this._wallRay.intersectObjects(this._collisionMeshes, false).length > 0) return false;
            }
            return true;
        };

        const moveDir = new THREE.Vector3();
        if (forward)  moveDir.addScaledVector(camFwd,   1);
        if (backward) moveDir.addScaledVector(camFwd,  -1);
        if (left)     moveDir.addScaledVector(camRight,-1);
        if (right)    moveDir.addScaledVector(camRight, 1);

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            if (canMove(moveDir)) {
                const moveSpeed = isSprinting ? this.baseWalkSpeed * this.runSpeedMultiplier : this.baseWalkSpeed;
                this.mesh.position.addScaledVector(moveDir, moveSpeed * dt);
                isMoving = true;
            }
        }

        const targetYaw = camYaw;
        let dYaw = targetYaw - this.mesh.rotation.y;
        while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        this.mesh.rotation.y += dYaw * Math.min(1, 14 * dt);

        this.cameraPivot.rotation.x = -inputManager.mouseLookY;

        if (jump && !this.isJumping && !inputManager.isNoclip) { this.isJumping = true; this.yVelocity = this.jumpStrength; }

        if (this.isJumping || this.mesh.position.y > this._groundY) {
            this.yVelocity -= this.gravity * dt; this.mesh.position.y += this.yVelocity * dt;
            if (this.mesh.position.y <= this._groundY) { this.mesh.position.y = this._groundY; this.isJumping = false; this.yVelocity = 0; }
        } else { this.mesh.position.y = this._groundY; }

        if (inputManager.isShooting && !inputManager.isNoclip && this.weaponManager.currentType === 'gun') audioManager.playGunfire();
        else audioManager.stopGunfire();

        if (isMoving && !this.isJumping && !inputManager.isNoclip) {
            const rate = isSprinting ? sc.stepRate * 0.6 : sc.stepRate;
            if (clock.elapsedTime - this.lastStepTime > rate) { this.lastStepTime = clock.elapsedTime; audioManager.playFootstep(); }
        }

        if (this.mixer) {
            let animFwd = false, animBack = false, animLeft = false, animRight = false;
            if (isMoving && moveDir.lengthSq() > 0) {
                const charAngle = this.mesh.rotation.y;
                const charFwdX  = -Math.sin(charAngle), charFwdZ = -Math.cos(charAngle);
                const charRgtX  =  Math.cos(charAngle), charRgtZ = -Math.sin(charAngle);
                const dotFwd = moveDir.x * charFwdX + moveDir.z * charFwdZ;
                const dotRgt = moveDir.x * charRgtX + moveDir.z * charRgtZ;
                if (dotFwd >  0.35) animFwd  = true;
                if (dotFwd < -0.35) animBack = true;
                if (dotRgt >  0.35) animRight = true;
                if (dotRgt < -0.35) animLeft  = true;
            }

            if (!this._swapping) {
            // ── Blocking animation — cycle on each new block press ────
            const blockRising = this.isBlocking && !this._wasBlocking;
            this._wasBlocking = this.isBlocking;

            if (this.isBlocking && !this.meleeAttacking && !this._hitReacting) {
                if (blockRising && this._blockAnims.length > 0) {
                    // Pick next block clip in round-robin order
                    const key = this._blockAnims[this._blockIdx % this._blockAnims.length];
                    this._blockIdx++;
                    const blockAct = this.actions[key];
                    if (blockAct && this.activeAction !== blockAct) {
                        blockAct.reset().setEffectiveWeight(1).play();
                        if (this.activeAction) this.activeAction.crossFadeTo(blockAct, 0.1, true);
                        this.activeAction = blockAct;
                        this._currentBlockAct = blockAct;
                    }
                } else if (!this._currentBlockAct && this._blockAnims.length > 0) {
                    // Hold state resumed after interrupted block
                    const key = this._blockAnims[(this._blockIdx - 1) % Math.max(1, this._blockAnims.length)];
                    const blockAct = this.actions[key];
                    if (blockAct && this.activeAction !== blockAct) {
                        blockAct.reset().setEffectiveWeight(1).play();
                        if (this.activeAction) this.activeAction.crossFadeTo(blockAct, 0.1, true);
                        this.activeAction = blockAct;
                        this._currentBlockAct = blockAct;
                    }
                }
            } else if (!this.isBlocking) {
                this._currentBlockAct = null;
            }

            if (!this.isBlocking && !this._hitReacting) {
                const targetAnim = resolveAnimationTarget({
                    isMoving, isShooting: inputManager.isShooting, isJumping: this.isJumping,
                    forward: animFwd, backward: animBack, left: animLeft, right: animRight, isSprinting,
                    weaponType: this.weaponManager.currentType, ultimate: this.currentUltimate,
                    isBlocking: false,  // handled above already
                }, this.actions);
                if (targetAnim && !this.meleeAttacking) this.playAction(targetAnim);
            }
            } // end if (!this._swapping)

            const upperKey = this.weaponManager.currentType === 'gun' ? this.slots.shoot + '_upperbody' : null;
            if (upperKey && this.actions[upperKey] && !this.currentUltimate) {
                const ua = this.actions[upperKey];
                ua.setEffectiveWeight(THREE.MathUtils.lerp(ua.getEffectiveWeight(), (inputManager.isShooting && isMoving && !this.isJumping) ? 1 : 0, 0.15));
            }
            this.mixer.update(dt);

            const pitch = inputManager.mouseLookY;
            if (this._headBone) this._headBone.rotation.x += pitch * 0.55;
            if (this._spineBones && this._spineBones.length > 0) {
                const spineShare = (pitch * 0.45) / this._spineBones.length;
                this._spineBones.forEach(bone => { bone.rotation.x += spineShare; });
            }

            // ── Animation-timed melee damage box ──────────────────────
            if (this.meleeAttacking && this.meleeAttackAction) {
                const conf  = this.weaponManager.weapons.melee.config;
                const db    = conf.damageBox || {};
                const clip  = this.meleeAttackAction.getClip();
                const t     = clip.duration > 0 ? Math.min(this.meleeAttackAction.time / clip.duration, 1) : 0;
                const wStart = db.hitWindowStart ?? 0.25;
                const wEnd   = db.hitWindowEnd   ?? 0.72;
                const inWin  = t >= wStart && t <= wEnd;

                const wMesh  = this.weaponManager.weapons.melee.mesh;
                const off    = db.offset || [0, 0, -8];
                const sz     = db.size   || [4, 4, 14];
                const origin = wMesh
                    ? wMesh.localToWorld(new THREE.Vector3(off[0], off[1], off[2]))
                    : this.mesh.position.clone().setY(this.mesh.position.y + (this.sizeConfig.height ?? 12) * 0.5);
                this.meleeHitBox.setFromCenterAndSize(origin, new THREE.Vector3(sz[0], sz[1], sz[2]));
                this.meleeHitBoxActive = inWin;

                if (inWin && !this._meleeWasInWindow) this._meleeHitTargets.clear();
                this._meleeWasInWindow = inWin;

                if (inWin) {
                    if (enemies) enemies.forEach(enemy => {
                        if (!enemy.health.isDead && !this._meleeHitTargets.has(enemy) && enemy.boundingBox &&
                            this.meleeHitBox.intersectsBox(enemy.boundingBox)) {
                            enemy.health.takeDamage(conf.DAMAGE ?? 50);
                            this._meleeHitTargets.add(enemy);
                        }
                    });
                    if (network) network.remotePlayers.forEach((rp, id) => {
                        if (!rp.isDead && !this._meleeHitTargets.has(id) && rp.boundingBox &&
                            this.meleeHitBox.intersectsBox(rp.boundingBox)) {
                            const hit = network.reportHit(id, conf.DAMAGE ?? 50);
                            if (hit) this._meleeHitTargets.add(id);
                        }
                    });
                }
            } else {
                this.meleeHitBoxActive = false;
            }
        }

        // ── Melee attack: trigger one-shot GLB animation on left-click ─
        if (!this._swapping && this.weaponManager.currentType === 'melee' &&
            !this.currentUltimate && !inputManager.isNoclip && !this.isBlocking) {
            if (inputManager.isShooting && !this.meleeAttacking) {
                const candidates = [
                    'melee_attack_1', 'melee_attack_2', 'melee_attack_3',
                    'melee_combo_1',  'melee_combo_2',  'melee_kick',
                ];
                const available = candidates.filter(k => !!this.actions[k]);
                const meleeWep  = this.weaponManager.weapons.melee;

                if (available.length > 0 && meleeWep.canFire(clock)) {
                    const key    = available[Math.floor(Math.random() * available.length)];
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
            }
        }

        // ── Gun fire ──────────────────────────────────────────────────────
        if (!this._swapping && inputManager.isShooting &&
            !this.currentUltimate && !inputManager.isNoclip) {
            if (this.weaponManager.currentType === 'gun') {
                this.weaponManager.attemptFire(clock, {
                    player: this, beamPool, enemies, network, isRemote: false,
                });
            }
        }
    }
}
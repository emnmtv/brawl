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
        // Pass modelId so WeaponManager picks up per-model weapon configs
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
        this.meleeAttacking    = false;    // true while a one-shot attack anim is playing
        this.meleeAttackAction = null;     // the AnimationAction currently playing
        this._meleeHitTargets  = new Set(); // targets already hit this swing (reset per swing)
        this._meleeWasInWindow = false;
        this.meleeHitBox       = new THREE.Box3(); // world-space damage box (read by main.js)
        this.meleeHitBoxActive = false;            // true only during the hit window

        const profile = getModel(modelId);
        new GLTFLoader().load(profile.path, (gltf) => {
            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;
            this.mesh.add(model);

            const boneNames = [];
            model.traverse(child => {
                if (child.isBone) boneNames.push(child.name);
                // Prevent character from disappearing when camera angle is extreme
                if (child.isMesh) child.frustumCulled = false;
            });
            console.group(`%c[${modelId}] Bones (${boneNames.length} total)`, 'color:#00ffcc;font-weight:bold;');
            boneNames.forEach((name, i) => console.log(`  ${String(i).padStart(3, '0')}  ${name}`));
            console.groupEnd();

            const clipNames = gltf.animations.map(c => c.name);
            console.group(`%c[${modelId}] Animation clips (${clipNames.length} total)`, 'color:#ffaa00;font-weight:bold;');
            clipNames.forEach((name, i) => console.log(`  ${String(i).padStart(3, '0')}  ${name}`));
            console.groupEnd();

            // Store head + spine bones for live aim tracking.
            // spineBones is an array so rigs with multiple spine segments
            // (like the T-800's bip_spine_0..3) can all contribute to the look.
            this._headBone   = model.getObjectByName(getBoneName(modelId, 'head'));
            this._spineBones = [];
            const spineKeys  = ['spine', 'spine_upper'];
            spineKeys.forEach(key => {
                const boneName = getBoneName(modelId, key);
                // Only add if it resolves to a real, different bone name
                if (boneName && boneName !== key) {
                    const bone = model.getObjectByName(boneName);
                    if (bone && !this._spineBones.includes(bone)) this._spineBones.push(bone);
                }
            });
            // Fallback: if no spine bones found via logical keys, try generic names
            if (this._spineBones.length === 0) {
                ['spine', 'Spine', 'mixamorigSpine', 'bip_spine_2'].forEach(name => {
                    const bone = model.getObjectByName(name);
                    if (bone) this._spineBones.push(bone);
                });
            }

            this.mixer = new THREE.AnimationMixer(model);

            // One-shot melee animations fire a 'finished' event when they complete.
            // We clear the attack lock here so the next idle/walk crossfade can run.
            // IMPORTANT: do NOT set activeAction = null here — playAction() needs it
            // as the crossfade source so the frozen last-frame pose fades out cleanly.
            this.mixer.addEventListener('finished', () => {
                this.meleeAttacking    = false;
                this.meleeAttackAction = null;
                this.meleeHitBoxActive = false;
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

    update(dt, clock, inputManager, audioManager, dependencies) {
        if (this.health.isDead) { audioManager.stopGunfire(); audioManager.stopAll(); return; }

        // Re-read physics values from the live config each frame
        // (entry.physics is mutated directly by the physics tuner)
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
        const speed = isSprinting ? this.baseWalkSpeed * this.runSpeedMultiplier : this.baseWalkSpeed;

        const center = this.mesh.position.clone(); center.y += sc.hitboxCenterOffsetY;
        this.boundingBox.setFromCenterAndSize(center, new THREE.Vector3(sc.hitboxSize.x, sc.hitboxSize.y, sc.hitboxSize.z));

        if (inputManager.activeWeapon !== this.weaponManager.currentType)
            this.weaponManager.equip(inputManager.activeWeapon);

        if (inputManager.ultimateQueue && this.weaponManager.currentType === 'melee') {
            this.currentUltimate = inputManager.ultimateQueue; this.ultimateTimer = 0; inputManager.ultimateQueue = null;
        }
        if (this.currentUltimate) { this.ultimateTimer += dt; if (this.ultimateTimer > 1.5) this.currentUltimate = null; }

        // ── Movement dirs are relative to CAMERA yaw, not character yaw ─
        // This means W always moves toward where the camera is looking.
        const camYaw   = inputManager.mouseLookX;
        const camSinY  = Math.sin(camYaw),  camCosY = Math.cos(camYaw);
        const camFwd   = new THREE.Vector3(-camSinY, 0, -camCosY);  // camera forward (flat)
        const camRight = new THREE.Vector3( camCosY, 0, -camSinY);  // camera right (flat)

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

        // Accumulate desired move direction from WASD relative to camera
        const moveDir = new THREE.Vector3();
        if (forward)  moveDir.addScaledVector(camFwd,              1);
        if (backward) moveDir.addScaledVector(camFwd,             -1);
        if (left)     moveDir.addScaledVector(camRight,            -1);
        if (right)    moveDir.addScaledVector(camRight,             1);

        if (moveDir.lengthSq() > 0) {
            moveDir.normalize();
            const moveSpeed = isSprinting ? this.baseWalkSpeed * this.runSpeedMultiplier : this.baseWalkSpeed;
            if (canMove(moveDir)) {
                this.mesh.position.addScaledVector(moveDir, moveSpeed * dt);
                isMoving = true;
            }
        }

        // ── Character rotation ────────────────────────────────────
        // Character ALWAYS faces camera direction — same as GTA/Uncharted.
        // targetYaw = camYaw directly: the model's rootRotation=Math.PI is already
        // baked into the GLB child, so mesh.rotation.y = camYaw gives correct facing.
        const targetYaw = camYaw;

        // Smooth shortest-path rotation (prevents 360° spin)
        let dYaw = targetYaw - this.mesh.rotation.y;
        while (dYaw >  Math.PI) dYaw -= Math.PI * 2;
        while (dYaw < -Math.PI) dYaw += Math.PI * 2;
        this.mesh.rotation.y += dYaw * Math.min(1, 14 * dt);

        // cameraPivot pitch — AIMING ONLY (Weapons.js reads getWorldDirection)
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
            // Compute movement direction relative to CHARACTER facing for animation resolver.
            // This way walk_backward plays when the character is moving away from their facing,
            // walk_left when strafing left relative to their body, etc.
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
            const targetAnim = resolveAnimationTarget({
                isMoving, isShooting: inputManager.isShooting, isJumping: this.isJumping,
                forward: animFwd, backward: animBack, left: animLeft, right: animRight, isSprinting,
                weaponType: this.weaponManager.currentType, ultimate: this.currentUltimate,
            }, this.actions);
            // Don't interrupt a playing one-shot melee attack
            if (targetAnim && !this.meleeAttacking) this.playAction(targetAnim);

            const upperKey = this.weaponManager.currentType === 'gun' ? this.slots.shoot + '_upperbody' : null;
            if (upperKey && this.actions[upperKey] && !this.currentUltimate) {
                const ua = this.actions[upperKey];
                ua.setEffectiveWeight(THREE.MathUtils.lerp(ua.getEffectiveWeight(), (inputManager.isShooting && isMoving && !this.isJumping) ? 1 : 0, 0.15));
            }
            this.mixer.update(dt);

            // ── Head + spine aim tracking ─────────────────────────────
            const pitch = inputManager.mouseLookY;
            if (this._headBone) this._headBone.rotation.x += pitch * 0.55;
            if (this._spineBones && this._spineBones.length > 0) {
                const spineShare = (pitch * 0.45) / this._spineBones.length;
                this._spineBones.forEach(bone => { bone.rotation.x += spineShare; });
            }

            // ── Animation-timed melee damage box ──────────────────────
            // The box is HOT only between hitWindowStart and hitWindowEnd of the clip.
            // Each target can only be hit once per swing (tracked in _meleeHitTargets).
            if (this.meleeAttacking && this.meleeAttackAction) {
                const conf  = this.weaponManager.weapons.melee.config;
                const db    = conf.damageBox || {};
                const clip  = this.meleeAttackAction.getClip();
                const t     = clip.duration > 0
                    ? Math.min(this.meleeAttackAction.time / clip.duration, 1)
                    : 0;
                const wStart = db.hitWindowStart ?? 0.25;
                const wEnd   = db.hitWindowEnd   ?? 0.72;
                const inWin  = t >= wStart && t <= wEnd;

                // Build world-space box from weapon mesh + local offset
                const wMesh  = this.weaponManager.weapons.melee.mesh;
                const off    = db.offset || [0, 0, -8];
                const sz     = db.size   || [4, 4, 14];
                const origin = wMesh
                    ? wMesh.localToWorld(new THREE.Vector3(off[0], off[1], off[2]))
                    : this.mesh.position.clone().setY(
                          this.mesh.position.y + (this.sizeConfig.height ?? 12) * 0.5
                      );
                this.meleeHitBox.setFromCenterAndSize(
                    origin, new THREE.Vector3(sz[0], sz[1], sz[2])
                );
                this.meleeHitBoxActive = inWin;

                // Reset hit list on leading edge of window so re-entering doesn't re-hit
                if (inWin && !this._meleeWasInWindow) this._meleeHitTargets.clear();
                this._meleeWasInWindow = inWin;

                if (inWin) {
                    if (enemies) enemies.forEach(enemy => {
                        if (!enemy.health.isDead &&
                            !this._meleeHitTargets.has(enemy) &&
                            enemy.boundingBox &&
                            this.meleeHitBox.intersectsBox(enemy.boundingBox)) {
                            enemy.health.takeDamage(conf.DAMAGE ?? 50);
                            this._meleeHitTargets.add(enemy);
                        }
                    });
                    if (network) network.remotePlayers.forEach((rp, id) => {
                        if (!rp.isDead &&
                            !this._meleeHitTargets.has(id) &&
                            rp.boundingBox &&
                            this.meleeHitBox.intersectsBox(rp.boundingBox)) {
                            network.reportHit(id, conf.DAMAGE ?? 50);
                            this._meleeHitTargets.add(id);
                        }
                    });
                }
            } else {
                this.meleeHitBoxActive = false;
            }
        }

        // ── Melee attack: trigger one-shot GLB animation on left-click ────────
        if (this.weaponManager.currentType === 'melee' && !this.currentUltimate && !inputManager.isNoclip) {
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

        // ── Gun fire ──────────────────────────────────────────────────────────
        if (inputManager.isShooting && !this.currentUltimate && !inputManager.isNoclip) {
            if (this.weaponManager.currentType === 'gun') {
                this.weaponManager.attemptFire(clock, {
                    player: this, beamPool, enemies, network, isRemote: false,
                });
            }
        }
    }
}
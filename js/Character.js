import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './Config.js';
import { attachRifleToHand } from './RifleUtils.js';
import { detectAnimationSlots, resolveAnimationTarget } from './AnimationUtils.js';
import { HealthComponent } from './Systems.js';

export class Character {
    constructor(scene, modelUrl, initTunerCallback) {
        this.mesh = new THREE.Group();
        scene.add(this.mesh);

        this.cameraPivot = new THREE.Group();
        this.cameraPivot.position.set(0, 10, 0);
        this.mesh.add(this.cameraPivot);

        this.health = new HealthComponent(100, 'player-health-bar');
        this.boundingBox = new THREE.Box3();

        this.baseWalkSpeed = 15;
        this.runSpeedMultiplier = 2.2;
        this.lastFired = 0;
        this.fireRate = 0.15;
        this.lastStepTime = 0;
        this.stepRate = 0.45;
        this.isJumping = false;
        this.yVelocity = 0;
        this.gravity = 75;
        this.jumpStrength = 30;
        this._groundY = 0;
        this._raycaster = new THREE.Raycaster();
        this._wallRay   = new THREE.Raycaster();
        this._collisionMeshes = [];

        this.mixer = null;
        this.actions = {};
        this.activeAction = null;
        this.manualAnimation = false;
        this.slots = { idle: null, walk: null, shoot: null };

        const loader = new GLTFLoader();
        loader.load(modelUrl, (gltf) => {
            const model = gltf.scene;
            model.scale.set(10, 10, 10);
            model.rotation.y = Math.PI;

            model.traverse((child) => {
                if (child.isMesh) {
                    child.frustumCulled = false;
                    // child.castShadow = true;
                }
            });

            this.mesh.add(model);
            this.mixer = new THREE.AnimationMixer(model);

            const rightHand = model.getObjectByName('bip_hand_R');
            if (rightHand) {
                attachRifleToHand(rightHand, (rifle) => {
                    this.rifle = rifle;
                    if (initTunerCallback) initTunerCallback(rifle);
                });
            }

            const { slots, actions } = detectAnimationSlots(gltf.animations, this.mixer);
            this.slots = slots;
            this.actions = actions;
            const animNames = Object.keys(actions);
            this.buildAnimMenu(animNames);
            this.playAction(slots.idle);
        });
    }

    // ─────────────────────────────────────────────
    // GROUND SNAPPING — call every frame from main.js
    // before update(), passing mapLoader.collisionMeshes
    // ─────────────────────────────────────────────
    snapToGround(collisionMeshes) {
        if (!collisionMeshes || collisionMeshes.length === 0) {
            this._groundY = 0;
            return;
        }

        const currentY = this.mesh.position.y;

        // Only cast from just above feet — this is the key fix.
        // Starting from y+50 would hit rooftops of nearby buildings.
        // Starting from y+2 only detects surfaces within step reach.
        const STEP_UP   = 2;   // max height we can step UP onto (ramp/kerb)
        const STEP_DOWN = 8;   // how far below to look for ground when walking off a ledge

        this._raycaster.set(
            new THREE.Vector3(this.mesh.position.x, currentY + STEP_UP, this.mesh.position.z),
            new THREE.Vector3(0, -1, 0)
        );
        // Only check within STEP_UP + STEP_DOWN range
        this._raycaster.far = STEP_UP + STEP_DOWN;

        const hits = this._raycaster.intersectObjects(collisionMeshes, false);

        if (hits.length > 0) {
            const hitY = hits[0].point.y;
            // Extra guard: never teleport UP more than STEP_UP from current position
            // This prevents rooftop / ceiling hits from yanking the player upward
            if (hitY <= currentY + STEP_UP) {
                this._groundY = hitY;
            }
            // If hitY > currentY + STEP_UP it means we hit a ceiling/overhang — ignore it
        } else {
            // No surface found nearby — keep current groundY so gravity takes over
            // (player will fall until a surface is found on the next frame)
            this._groundY = currentY - STEP_DOWN;
        }

        // Reset far to default so it doesn't affect other raycasts
        this._raycaster.far = Infinity;
    }

    /** Call once after map loads: player.setCollisionMeshes(mapLoader.collisionMeshes) */
    setCollisionMeshes(meshes) {
        this._collisionMeshes = meshes || [];
    }

    // ─────────────────────────────────────────────
    playAction(name) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset().setEffectiveWeight(1).play();
        if (this.activeAction) this.activeAction.crossFadeTo(next, 0.2, true);
        this.activeAction = next;
    }

    buildAnimMenu(names) {
        const menu        = document.getElementById('animation-menu');
        const slotRows    = document.getElementById('slot-rows');
        const btnContainer = document.getElementById('animation-buttons');
        if (!menu || !slotRows || !btnContainer) return;

        menu.style.display = 'block';
        const slotLabels = { idle: 'Idle', walk: 'Walk/Run', shoot: 'Shoot' };
        for (const [slot, label] of Object.entries(slotLabels)) {
            const row = document.createElement('div');
            row.className = 'slot-row';
            const lbl = document.createElement('span');
            lbl.className = 'slot-label';
            lbl.textContent = label + ':';
            const sel = document.createElement('select');
            sel.innerHTML = '<option value="">-- none --</option>';
            names.forEach(n => {
                if (n.includes('_upperbody')) return;
                const opt = document.createElement('option');
                opt.value = n; opt.textContent = n;
                if (n === this.slots[slot]) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.onchange = () => { this.slots[slot] = sel.value || null; };
            row.appendChild(lbl); row.appendChild(sel); slotRows.appendChild(row);
        }
        names.forEach(name => {
            if (name.includes('_upperbody')) return;
            const btn = document.createElement('button');
            btn.textContent = name;
            btn.onclick = () => { this.manualAnimation = true; this.fadeToAction(name, 0.3); };
            btnContainer.appendChild(btn);
        });
    }

    fadeToAction(name, duration = 0.2) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset();
        next.setEffectiveTimeScale(1);
        next.setEffectiveWeight(1);
        next.play();
        if (this.activeAction) this.activeAction.crossFadeTo(next, duration, true);
        this.activeAction = next;
    }

    resolveSlot(primary, ...fallbacks) {
        const candidates = [primary, ...fallbacks, this.slots.idle];
        for (const name of candidates) {
            if (name && this.actions[name]) return name;
        }
        const keys = Object.keys(this.actions);
        return keys.length > 0 ? keys[0] : null;
    }

    update(dt, clock, inputManager, audioManager, beamPool) {
        let isMoving = false;

        const input    = inputManager.keys;
        const forward  = input['KeyW'];
        const backward = input['KeyS'];
        const left     = input['KeyA'];
        const right    = input['KeyD'];
        const sprint   = input['ShiftLeft'] || input['ShiftRight'];
        const jump     = input['Space'];

        const isSprinting  = forward && sprint;
        const currentSpeed = isSprinting
            ? this.baseWalkSpeed * this.runSpeedMultiplier
            : this.baseWalkSpeed;

        // Bounding box
        if (this.boundingBox) {
            const center = this.mesh.position.clone();
            center.y += 6;
            this.boundingBox.setFromCenterAndSize(center, new THREE.Vector3(6, 12, 6));
        }

        // ── MOVEMENT WITH WALL COLLISION ──
        // Get the player's local forward and right vectors in world space
        const localForward = new THREE.Vector3(0, 0, -1).applyEuler(this.mesh.rotation);
        const localRight   = new THREE.Vector3(1, 0,  0).applyEuler(this.mesh.rotation);
        localForward.y = 0; localForward.normalize();
        localRight.y   = 0; localRight.normalize();

        const WALL_DIST  = 3.5;  // clearance radius before blocking
        const collMeshes = this._collisionMeshes || [];

        // Cast rays at foot / mid / chest to catch walls at any height
        const canMove = (dir) => {
            if (collMeshes.length === 0) return true;
            const heights = [1, 5, 9];
            for (const h of heights) {
                const origin = new THREE.Vector3(
                    this.mesh.position.x,
                    this.mesh.position.y + h,
                    this.mesh.position.z
                );
                this._wallRay.set(origin, dir);
                this._wallRay.far = WALL_DIST;
                if (this._wallRay.intersectObjects(collMeshes, false).length > 0) return false;
            }
            return true;
        };

        if (forward) {
            if (canMove(localForward)) {
                this.mesh.position.addScaledVector(localForward, currentSpeed * dt);
            }
            isMoving = true;
        }
        if (backward) {
            const backDir = localForward.clone().negate();
            if (canMove(backDir)) {
                this.mesh.position.addScaledVector(backDir, this.baseWalkSpeed * dt);
            }
            isMoving = true;
        }
        if (left) {
            const leftDir = localRight.clone().negate();
            if (canMove(leftDir)) {
                this.mesh.position.addScaledVector(leftDir, this.baseWalkSpeed * dt);
            }
            isMoving = true;
        }
        if (right) {
            if (canMove(localRight)) {
                this.mesh.position.addScaledVector(localRight, this.baseWalkSpeed * dt);
            }
            isMoving = true;
        }


        this.mesh.rotation.y      = inputManager.mouseLookX;
        this.cameraPivot.rotation.x = inputManager.mouseLookY;

        // ── JUMP & GRAVITY with map-aware ground ──
        if (jump && !this.isJumping && !inputManager.isNoclip) {
            this.isJumping = true;
            this.yVelocity = this.jumpStrength;
        }

        if (this.isJumping || this.mesh.position.y > this._groundY) {
            this.yVelocity -= this.gravity * dt;
            this.mesh.position.y += this.yVelocity * dt;

            if (this.mesh.position.y <= this._groundY) {
                this.mesh.position.y = this._groundY;
                this.isJumping = false;
                this.yVelocity = 0;
            }
        } else {
            // Snap to ground surface when not jumping
            // (handles walking up/down slopes smoothly)
            this.mesh.position.y = this._groundY;
        }

        // ── AUDIO ──
        if (inputManager.isShooting && !inputManager.isNoclip) {
            audioManager.playGunfire();
        } else {
            audioManager.stopGunfire();
        }

        const currentStepRate = isSprinting ? this.stepRate * 0.6 : this.stepRate;
        if (isMoving && !this.isJumping && !inputManager.isNoclip) {
            if (clock.elapsedTime - this.lastStepTime > currentStepRate) {
                this.lastStepTime = clock.elapsedTime;
                audioManager.playFootstep();
            }
        }

        // ── ANIMATION ──
        if (isMoving || inputManager.isShooting || this.isJumping) this.manualAnimation = false;

        if (!this.manualAnimation && this.mixer) {
            const targetAnim = resolveAnimationTarget(
                { isMoving, isShooting: inputManager.isShooting, isJumping: this.isJumping,
                  forward, backward, left, right, isSprinting },
                this.actions, this.slots
            );
            if (targetAnim) this.fadeToAction(targetAnim, 0.2);
        }

        // Upper-body shoot blend
        const upperShootName = this.slots.shoot ? this.slots.shoot + '_upperbody' : null;
        if (upperShootName && this.actions[upperShootName] && !this.manualAnimation) {
            const upperShootAction = this.actions[upperShootName];
            const isFullBodyFiring = (
                this.activeAction &&
                this.activeAction.getClip().name.toLowerCase() === 'run_forward_firing'
            );
            const targetWeight = (inputManager.isShooting && isMoving && !isFullBodyFiring && !this.isJumping) ? 1 : 0;
            const currentWeight = upperShootAction.getEffectiveWeight();
            upperShootAction.setEffectiveWeight(THREE.MathUtils.lerp(currentWeight, targetWeight, 0.15));
        }

        if (this.mixer) this.mixer.update(dt);

        // ── FIRE BEAM ──
        if (inputManager.isShooting && clock.elapsedTime - this.lastFired > this.fireRate) {
            this.lastFired = clock.elapsedTime;
            let spawnPos;

            if (this.rifle) {
                spawnPos = this.rifle.localToWorld(new THREE.Vector3(0, 0, -5));
            } else {
                spawnPos = this.cameraPivot.localToWorld(new THREE.Vector3(1.5, 0, -2));
            }

            const aimDir = new THREE.Vector3();
            this.cameraPivot.getWorldDirection(aimDir);
            aimDir.negate();

            beamPool.fire(spawnPos, aimDir, false);
        }
    }
}
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { detectAnimationSlots, resolveAnimationTarget } from './AnimationUtils.js';
import { HealthComponent } from './Systems.js';
import { WeaponManager } from './Weapons.js';
import { CONFIG } from './Config.js';

export class Character {
    constructor(scene, modelUrl) {
        this.mesh = new THREE.Group(); scene.add(this.mesh);
        this.cameraPivot = new THREE.Group(); this.cameraPivot.position.set(0, 10, 0); this.mesh.add(this.cameraPivot);
        this.health = new HealthComponent(100, 'player-health-bar'); this.boundingBox = new THREE.Box3();
        this.weaponManager = new WeaponManager(false);

        this.baseWalkSpeed = 15; this.runSpeedMultiplier = 2.2; this.lastStepTime = 0; this.stepRate = 0.45;
        this.isJumping = false; this.yVelocity = 0; this.gravity = 75; this.jumpStrength = 30;
        this._groundY = 0; this._raycaster = new THREE.Raycaster(); this._wallRay = new THREE.Raycaster(); this._collisionMeshes = [];

        this.mixer = null; this.actions = {}; this.slots = {};
        this.currentUltimate = null; this.ultimateTimer = 0;
        this.isSwinging = false; this.swingProgress = 0;

        new GLTFLoader().load(modelUrl, (gltf) => {
            const model = gltf.scene; model.scale.set(10, 10, 10); model.rotation.y = Math.PI; this.mesh.add(model);
            this.mixer = new THREE.AnimationMixer(model);

            const weaponBoneName = CONFIG.WEAPONS.GUN.WEAPON_BONE || 'bip_hand_R';
            const weaponBone = model.getObjectByName(weaponBoneName);
            if (weaponBone) this.weaponManager.init(weaponBone);

            const { slots, actions } = detectAnimationSlots(gltf.animations, this.mixer);
            this.slots = slots; this.actions = actions;
            this.playAction('idle');
        });
    }

    snapToGround(collisionMeshes) {
        if (!collisionMeshes || collisionMeshes.length === 0) { this._groundY = 0; return; }
        const currentY = this.mesh.position.y;
        const STEP_UP = 2, STEP_DOWN = 8;
        this._raycaster.set(new THREE.Vector3(this.mesh.position.x, currentY + STEP_UP, this.mesh.position.z), new THREE.Vector3(0, -1, 0));
        this._raycaster.far = STEP_UP + STEP_DOWN;
        const hits = this._raycaster.intersectObjects(collisionMeshes, false);
        if (hits.length > 0 && hits[0].point.y <= currentY + STEP_UP) this._groundY = hits[0].point.y;
        else this._groundY = currentY - STEP_DOWN;
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
        // Stop all audio immediately on death and bail — prevents stuck gun-fire loop
        if (this.health.isDead) {
            audioManager.stopGunfire();
            audioManager.stopAll();
            return;
        }

        let isMoving = false;
        const { beamPool, enemies, network } = dependencies;
        const input = inputManager.keys;
        const forward = input['KeyW']; const backward = input['KeyS']; const left = input['KeyA']; const right = input['KeyD'];
        const sprint = input['ShiftLeft'] || input['ShiftRight']; const jump = input['Space'];
        const isSprinting = forward && sprint;
        const currentSpeed = isSprinting ? this.baseWalkSpeed * this.runSpeedMultiplier : this.baseWalkSpeed;

        if (this.boundingBox) {
            const center = this.mesh.position.clone(); center.y += 6;
            this.boundingBox.setFromCenterAndSize(center, new THREE.Vector3(6, 12, 6));
        }

        if (inputManager.activeWeapon !== this.weaponManager.currentType) this.weaponManager.equip(inputManager.activeWeapon);

        // Ultimate Handling
        if (inputManager.ultimateQueue && this.weaponManager.currentType === 'melee') {
            this.currentUltimate = inputManager.ultimateQueue; this.ultimateTimer = 0; inputManager.ultimateQueue = null;
        }
        if (this.currentUltimate) {
            this.ultimateTimer += dt;
            if (this.ultimateTimer > 1.5) this.currentUltimate = null;
        }

        // Movement
        const localForward = new THREE.Vector3(0, 0, -1).applyEuler(this.mesh.rotation); localForward.y = 0; localForward.normalize();
        const localRight = new THREE.Vector3(1, 0, 0).applyEuler(this.mesh.rotation); localRight.y = 0; localRight.normalize();

        const canMove = (dir) => {
            if (!this._collisionMeshes.length) return true;
            for (const h of [1, 5, 9]) {
                this._wallRay.set(new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + h, this.mesh.position.z), dir);
                this._wallRay.far = 3.5;
                if (this._wallRay.intersectObjects(this._collisionMeshes, false).length > 0) return false;
            }
            return true;
        };

        if (forward)  { if (canMove(localForward))               this.mesh.position.addScaledVector(localForward, currentSpeed * dt);       isMoving = true; }
        if (backward) { const bd = localForward.clone().negate(); if (canMove(bd)) this.mesh.position.addScaledVector(bd, this.baseWalkSpeed * dt); isMoving = true; }
        if (left)     { const ld = localRight.clone().negate();   if (canMove(ld)) this.mesh.position.addScaledVector(ld, this.baseWalkSpeed * dt); isMoving = true; }
        if (right)    { if (canMove(localRight))                  this.mesh.position.addScaledVector(localRight, this.baseWalkSpeed * dt);   isMoving = true; }

        this.mesh.rotation.y = inputManager.mouseLookX;
        this.cameraPivot.rotation.x = inputManager.mouseLookY;

        if (jump && !this.isJumping && !inputManager.isNoclip) { this.isJumping = true; this.yVelocity = this.jumpStrength; }
        if (this.isJumping || this.mesh.position.y > this._groundY) {
            this.yVelocity -= this.gravity * dt; this.mesh.position.y += this.yVelocity * dt;
            if (this.mesh.position.y <= this._groundY) { this.mesh.position.y = this._groundY; this.isJumping = false; this.yVelocity = 0; }
        } else { this.mesh.position.y = this._groundY; }

        // Gun sound gated on being alive, pointer-locked, and using gun
        const canShootSound = inputManager.isShooting && !inputManager.isNoclip && this.weaponManager.currentType === 'gun';
        if (canShootSound) audioManager.playGunfire();
        else               audioManager.stopGunfire();

        if (isMoving && !this.isJumping && !inputManager.isNoclip) {
            if (clock.elapsedTime - this.lastStepTime > (isSprinting ? this.stepRate * 0.6 : this.stepRate)) {
                this.lastStepTime = clock.elapsedTime; audioManager.playFootstep();
            }
        }

        // Animation
        if (this.mixer) {
            const targetAnim = resolveAnimationTarget({
                isMoving, isShooting: inputManager.isShooting, isJumping: this.isJumping,
                forward, backward, left, right, isSprinting,
                weaponType: this.weaponManager.currentType, ultimate: this.currentUltimate
            }, this.actions);

            if (targetAnim) this.playAction(targetAnim);

            const upperShootName = this.weaponManager.currentType === 'gun' ? this.slots.shoot + '_upperbody' : null;
            if (upperShootName && this.actions[upperShootName] && !this.currentUltimate) {
                const upperAction = this.actions[upperShootName];
                const targetWeight = (inputManager.isShooting && isMoving && !this.isJumping) ? 1 : 0;
                upperAction.setEffectiveWeight(THREE.MathUtils.lerp(upperAction.getEffectiveWeight(), targetWeight, 0.15));
            }
            this.mixer.update(dt);
        }

        // Procedural Swing (5-Phase)
        if (this.weaponManager.currentType === 'melee' && !this.currentUltimate) {
            const conf = CONFIG.WEAPONS.MELEE;
            const swingBones = (conf.SWING_BONES || []).map(name => this.mesh.getObjectByName(name));

            if (swingBones.some(bone => bone)) {
                const isPreviewing = inputManager.isNoclip;

                if (inputManager.isShooting && !this.isSwinging && !isPreviewing) {
                    this.isSwinging = true;
                    this.swingProgress = 0;
                    this.activeSwingParams = conf.SWINGS[Math.floor(Math.random() * conf.SWINGS.length)];
                }

                if (this.isSwinging || isPreviewing) {
                    if (this.isSwinging) {
                        this.swingProgress += dt * conf.SWING_SPEED;
                        if (this.swingProgress > Math.PI) { this.isSwinging = false; this.swingProgress = 0; }
                    }

                    const swingData = this.activeSwingParams || conf.SWINGS[0];
                    const t = isPreviewing ? 0.6 : Math.min(this.swingProgress / Math.PI, 1.0);

                    const lerp = (a, b, f) => a + (b - a) * f;
                    const getFrame = (phaseA, phaseB, factor, boneIdx) => [
                        lerp(phaseA[boneIdx][0], phaseB[boneIdx][0], factor),
                        lerp(phaseA[boneIdx][1], phaseB[boneIdx][1], factor),
                        lerp(phaseA[boneIdx][2], phaseB[boneIdx][2], factor)
                    ];

                    swingBones.forEach((bone, i) => {
                        if (!bone) return;
                        let r;
                        if (t < 0.2)      r = getFrame(swingData.address,      swingData.backswing,     t / 0.2,           i);
                        else if (t < 0.4) r = getFrame(swingData.backswing,    swingData.downswing,     (t - 0.2) / 0.2,   i);
                        else if (t < 0.6) r = getFrame(swingData.downswing,    swingData.impact,        (t - 0.4) / 0.2,   i);
                        else              r = getFrame(swingData.impact,        swingData.followThrough, (t - 0.6) / 0.4,   i);

                        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0], r[1], r[2]));
                        bone.quaternion.multiply(q);
                    });
                }
            }
        }

        // Firing Logic
        if (inputManager.isShooting && !this.currentUltimate && !inputManager.isNoclip) {
            const fired = this.weaponManager.attemptFire(clock, { player: this, beamPool, enemies, network, isRemote: false });
            if (fired && this.weaponManager.currentType === 'melee') audioManager.playMeleeSwoosh();
        }
    }
}
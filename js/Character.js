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
        this.isSwinging        = false; this.swingProgress = 0;
        this.activeSwingParams = null;

        const profile = getModel(modelId);
        new GLTFLoader().load(profile.path, (gltf) => {
            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;
            this.mesh.add(model);

            const boneNames = [];
            model.traverse(child => { if (child.isBone) boneNames.push(child.name); });
            console.group(`%c[${modelId}] Bones (${boneNames.length} total)`, 'color:#00ffcc;font-weight:bold;');
            boneNames.forEach((name, i) => console.log(`  ${String(i).padStart(3, '0')}  ${name}`));
            console.groupEnd();

            const clipNames = gltf.animations.map(c => c.name);
            console.group(`%c[${modelId}] Animation clips (${clipNames.length} total)`, 'color:#ffaa00;font-weight:bold;');
            clipNames.forEach((name, i) => console.log(`  ${String(i).padStart(3, '0')}  ${name}`));
            console.groupEnd();

            this.mixer = new THREE.AnimationMixer(model);

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

        const sc = this.sizeConfig;
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

        const localForward = new THREE.Vector3(0,0,-1).applyEuler(this.mesh.rotation); localForward.y = 0; localForward.normalize();
        const localRight   = new THREE.Vector3(1,0, 0).applyEuler(this.mesh.rotation); localRight.y   = 0; localRight.normalize();

        const canMove = dir => {
            if (!this._collisionMeshes.length) return true;
            for (const h of sc.wallRayHeights) {
                this._wallRay.set(new THREE.Vector3(this.mesh.position.x, this.mesh.position.y + h, this.mesh.position.z), dir);
                this._wallRay.far = sc.width * 0.6;
                if (this._wallRay.intersectObjects(this._collisionMeshes, false).length > 0) return false;
            }
            return true;
        };

        if (forward)  { if (canMove(localForward))               this.mesh.position.addScaledVector(localForward, speed * dt);                    isMoving = true; }
        if (backward) { const d = localForward.clone().negate();  if (canMove(d)) this.mesh.position.addScaledVector(d, this.baseWalkSpeed * dt);  isMoving = true; }
        if (left)     { const d = localRight.clone().negate();    if (canMove(d)) this.mesh.position.addScaledVector(d, this.baseWalkSpeed * dt);  isMoving = true; }
        if (right)    { if (canMove(localRight))                  this.mesh.position.addScaledVector(localRight, this.baseWalkSpeed * dt);         isMoving = true; }

        this.mesh.rotation.y        = inputManager.mouseLookX;
        this.cameraPivot.rotation.x = inputManager.mouseLookY;

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
            const targetAnim = resolveAnimationTarget({
                isMoving, isShooting: inputManager.isShooting, isJumping: this.isJumping,
                forward, backward, left, right, isSprinting,
                weaponType: this.weaponManager.currentType, ultimate: this.currentUltimate,
            }, this.actions);
            if (targetAnim) this.playAction(targetAnim);

            const upperKey = this.weaponManager.currentType === 'gun' ? this.slots.shoot + '_upperbody' : null;
            if (upperKey && this.actions[upperKey] && !this.currentUltimate) {
                const ua = this.actions[upperKey];
                ua.setEffectiveWeight(THREE.MathUtils.lerp(ua.getEffectiveWeight(), (inputManager.isShooting && isMoving && !this.isJumping) ? 1 : 0, 0.15));
            }
            this.mixer.update(dt);
        }

        // Procedural Swing — read config from the per-model weapon config
        if (this.weaponManager.currentType === 'melee' && !this.currentUltimate) {
            const conf = this.weaponManager.weapons.melee.config;  // ← per-model
            const swingBoneLogicals = CONFIG.WEAPONS.MELEE.SWING_BONES || [];
            const swingBones = swingBoneLogicals.map(logical => this.mesh.getObjectByName(getBoneName(this.modelId, logical)));
            if (swingBones.some(b => b)) {
                const isPreviewing = inputManager.isNoclip;
                if (inputManager.isShooting && !this.isSwinging && !isPreviewing) {
                    this.isSwinging = true; this.swingProgress = 0;
                    const swings = conf.SWINGS || CONFIG.WEAPONS.MELEE.SWINGS;
                    this.activeSwingParams = swings[Math.floor(Math.random() * swings.length)];
                }
                if (this.isSwinging || isPreviewing) {
                    const swingSpeed = conf.SWING_SPEED ?? CONFIG.WEAPONS.MELEE.SWING_SPEED;
                    if (this.isSwinging) {
                        this.swingProgress += dt * swingSpeed;
                        if (this.swingProgress > Math.PI) { this.isSwinging = false; this.swingProgress = 0; }
                    }
                    const swings = conf.SWINGS || CONFIG.WEAPONS.MELEE.SWINGS;
                    const swingData = this.activeSwingParams || swings[0];
                    const t = isPreviewing ? 0.6 : Math.min(this.swingProgress / Math.PI, 1.0);
                    const lerp = (a,b,f) => a+(b-a)*f;
                    const frame = (pA,pB,f,i) => [lerp(pA[i][0],pB[i][0],f), lerp(pA[i][1],pB[i][1],f), lerp(pA[i][2],pB[i][2],f)];
                    swingBones.forEach((bone, i) => {
                        if (!bone) return;
                        let r;
                        if (t < 0.2)      r = frame(swingData.address,   swingData.backswing,     t / 0.2,       i);
                        else if (t < 0.4) r = frame(swingData.backswing,  swingData.downswing,    (t-0.2)/0.2,   i);
                        else if (t < 0.6) r = frame(swingData.downswing,  swingData.impact,       (t-0.4)/0.2,   i);
                        else              r = frame(swingData.impact,      swingData.followThrough,(t-0.6)/0.4,   i);
                        bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(r[0],r[1],r[2])));
                    });
                }
            }
        }

        if (inputManager.isShooting && !this.currentUltimate && !inputManager.isNoclip) {
            const fired = this.weaponManager.attemptFire(clock, { player: this, beamPool, enemies, network, isRemote: false });
            if (fired && this.weaponManager.currentType === 'melee') audioManager.playMeleeSwoosh();
        }
    }
}
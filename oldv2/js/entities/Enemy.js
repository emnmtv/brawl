/**
 * Enemy.js — Simple AI enemy entity.
 *
 * Loads a model, chases the player, and fires at range.
 * Separate from Systems.js so the file has a single clear responsibility.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getModel, getBoneName } from '../registry/ModelRegistry.js';
import { HealthComponent } from '../systems/HealthSystem.js';

export class Enemy {
    /**
     * @param {THREE.Scene} scene
     * @param {number}      x, z  — spawn position
     * @param {string}      modelId
     */
    constructor(scene, x, z, modelId = 't800') {
        this.modelId = modelId;
        this.mesh    = new THREE.Group();
        this.mesh.position.set(x, 0, z);
        scene.add(this.mesh);

        this.health      = new HealthComponent(100, 'enemy-health-bar');
        this.boundingBox = new THREE.Box3();

        this.speed       = 10;
        this.attackRange = 80;
        this.fireRate    = 0.6;
        this.lastFired   = 0;
        this.aiEnabled   = true;

        this.handBone    = null;
        this.mixer       = null;
        this.actions     = {};
        this.activeAction = null;

        this._loadModel(modelId);
    }

    _loadModel(modelId) {
        const profile = getModel(modelId);
        new GLTFLoader().load(profile.path, gltf => {
            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;

            const handBoneName = getBoneName(modelId, 'hand_R');
            model.traverse(child => {
                if (child.isMesh) child.frustumCulled = false;
                if (child.name === handBoneName) this.handBone = child;
            });

            this.mesh.add(model);
            this.mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach(clip => {
                this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
            });
            this.playAnim('idle');
        });
    }

    playAnim(name) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
        if (this.activeAction) this.activeAction.crossFadeTo(next, 0.2, true);
        this.activeAction = next;
    }

    getGunSpawnPosition() {
        if (this.handBone) {
            const pos = new THREE.Vector3();
            this.handBone.getWorldPosition(pos);
            return pos;
        }
        return new THREE.Vector3(0, 10, 5).applyMatrix4(this.mesh.matrixWorld);
    }

    update(dt, clock, player, beamPool) {
        if (this.health.isDead) {
            if (this.mesh.visible) {
                this.mesh.visible = false;
                const ti = document.getElementById('target-info');
                if (ti) ti.style.display = 'none';
            }
            return;
        }

        const center = this.mesh.position.clone();
        center.y += 1;
        this.boundingBox.setFromCenterAndSize(center, new THREE.Vector3(6, 12, 6));

        if (!this.mixer) return;

        if (!this.aiEnabled) {
            this.playAnim('idle');
            this.mixer.update(dt);
            return;
        }

        this.mixer.update(dt);
        const dist = this.mesh.position.distanceTo(player.mesh.position);
        this.mesh.lookAt(player.mesh.position.x, this.mesh.position.y, player.mesh.position.z);

        if (dist > this.attackRange) {
            this.mesh.translateZ(this.speed * dt);
            this.playAnim(this.actions['run_forward'] ? 'run_forward' : 'idle');
        } else {
            const shootAnim = this.actions['shoot_idle'] ? 'shoot_idle'
                            : this.actions['shoot']      ? 'shoot'
                            : 'idle';
            this.playAnim(shootAnim);

            if (clock.elapsedTime - this.lastFired > this.fireRate) {
                this.lastFired  = clock.elapsedTime;
                const spawnPos  = this.getGunSpawnPosition();
                const aimTarget = player.mesh.position.clone().add(new THREE.Vector3(0, 5, 0));
                const aimDir    = new THREE.Vector3().subVectors(aimTarget, spawnPos).normalize();
                const beam      = beamPool.fire(spawnPos, aimDir, true);
                if (beam) beam.userData.sourcePos = this.mesh.position.clone();
            }
        }
    }
}

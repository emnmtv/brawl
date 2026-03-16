import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getModel, getBoneName } from './ModelRegistry.js';

export class HealthComponent {
    constructor(maxHealth, uiElementId) {
        this.maxHealth = maxHealth;
        this.currentHealth = maxHealth;
        this.uiElement = document.getElementById(uiElementId);
        this.isDead = false;
        this.onDamage = null; // callback: (amount, sourcePos?) => void
    }

    takeDamage(amount, sourcePos = null) {
        if (this.isDead) return;
        this.currentHealth -= amount;
        if (this.currentHealth <= 0) { this.currentHealth = 0; this.isDead = true; }
        if (this.uiElement) this.uiElement.style.width = (this.currentHealth / this.maxHealth * 100) + '%';
        if (this.onDamage) this.onDamage(amount, sourcePos);
    }
}

export class BeamPool {
    constructor(scene, size = 30) {
        this.pool = [];
        const geometry = new THREE.CylinderGeometry(0.2, 0.2, 5, 8);
        geometry.rotateX(Math.PI / 2);

        for (let i = 0; i < size; i++) {
            const material = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
            const beam = new THREE.Mesh(geometry, material);
            beam.visible = false;
            beam.userData = {
                active: false, speed: 100, distance: 0,
                isEnemy: false, isRemote: false,
                sourcePos: null,
                direction: new THREE.Vector3()
            };
            scene.add(beam);
            this.pool.push(beam);
        }
    }

    // Returns the beam so callers can tag userData (isRemote, sourcePos, etc.)
    fire(position, direction, isEnemy = false) {
        const beam = this.pool.find(b => !b.userData.active);
        if (!beam) return null;

        beam.position.copy(position);
        beam.lookAt(position.clone().add(direction));
        beam.userData.direction.copy(direction).normalize();
        beam.visible = true;
        beam.userData.active   = true;
        beam.userData.distance = 0;
        beam.userData.isEnemy  = isEnemy;
        beam.userData.isRemote = false;
        beam.userData.sourcePos = null;
        beam.material.color.setHex(isEnemy ? 0xff3300 : 0x00ffcc);

        return beam;
    }

    update(dt, enemies, player) {
        this.pool.forEach(beam => {
            if (!beam.userData.active) return;

            const moveDist = beam.userData.speed * dt;
            beam.position.addScaledVector(beam.userData.direction, moveDist);
            beam.userData.distance += moveDist;

            // Remote beams are visual-only — damage is server-authoritative
            if (beam.userData.isRemote) {
                if (beam.userData.distance > 300) {
                    beam.visible = false; beam.userData.active = false; beam.userData.isRemote = false;
                }
                return;
            }

            if (beam.userData.isEnemy) {
                if (player.health && !player.health.isDead && player.boundingBox) {
                    if (player.boundingBox.containsPoint(beam.position)) {
                        player.health.takeDamage(10, beam.userData.sourcePos || null);
                        beam.visible = false; beam.userData.active = false;
                    }
                }
            } else {
                enemies.forEach(enemy => {
                    if (!enemy.health.isDead && enemy.boundingBox) {
                        if (enemy.boundingBox.containsPoint(beam.position)) {
                            enemy.health.takeDamage(20);
                            beam.visible = false; beam.userData.active = false;
                        }
                    }
                });
            }

            if (beam.userData.distance > 300) {
                beam.visible = false; beam.userData.active = false;
            }
        });
    }

    deactivateBeam(beam) { beam.visible = false; beam.userData.active = false; }
}

export class Enemy {
    /**
     * @param {THREE.Scene} scene
     * @param {number}      x
     * @param {number}      z
     * @param {string}      modelId  Key into MODEL_REGISTRY e.g. 't800'
     */
    constructor(scene, x, z, modelId = 't800') {
        this.modelId = modelId;
        this.mesh = new THREE.Group();
        this.mesh.position.set(x, 0, z);
        scene.add(this.mesh);

        this.health = new HealthComponent(100, 'enemy-health-bar');
        this.boundingBox = new THREE.Box3();

        this.speed = 10; this.attackRange = 80;
        this.fireRate = 0.6; this.lastFired = 0;
        this.aiEnabled = true;
        this.handBone = null; this.mixer = null;
        this.actions = {}; this.activeAction = null;

        // Load via registry
        const profile = getModel(modelId);
        new GLTFLoader().load(profile.path, (gltf) => {
            const model = gltf.scene;
            model.scale.setScalar(profile.scale);
            model.rotation.y = profile.rootRotation ?? Math.PI;

            // Resolve hand bone via registry
            const handBoneName = getBoneName(modelId, 'hand_R');
            model.traverse(child => {
                if (child.isMesh) child.frustumCulled = false;
                if (child.name === handBoneName) this.handBone = child;
            });

            this.mesh.add(model);
            this.mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach(clip => {
                // Register by actual name (lowercased) — enough for the simple enemy AI
                this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
            });
            this.playAnim('idle');
        });
    }

    getGunSpawnTransform() {
        if (this.handBone) {
            const pos = new THREE.Vector3();
            this.handBone.getWorldPosition(pos);
            return { position: pos };
        }
        const spawnOffset = new THREE.Vector3(0, 10, 5);
        return { position: spawnOffset.applyMatrix4(this.mesh.matrixWorld) };
    }

    playAnim(name) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
        if (this.activeAction) this.activeAction.crossFadeTo(next, 0.2, true);
        this.activeAction = next;
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

        if (this.boundingBox) {
            const center = this.mesh.position.clone();
            center.y += 1;
            this.boundingBox.setFromCenterAndSize(center, new THREE.Vector3(6, 12, 6));
        }
        if (!this.mixer) return;

        if (!this.aiEnabled) { this.playAnim('idle'); this.mixer.update(dt); return; }

        this.mixer.update(dt);
        const distToPlayer = this.mesh.position.distanceTo(player.mesh.position);
        this.mesh.lookAt(player.mesh.position.x, this.mesh.position.y, player.mesh.position.z);

        if (distToPlayer > this.attackRange) {
            this.mesh.translateZ(this.speed * dt);
            this.playAnim(this.actions['run_forward'] ? 'run_forward' : 'idle');
        } else {
            this.playAnim(this.actions['shoot_idle'] ? 'shoot_idle' : (this.actions['shoot'] ? 'shoot' : 'idle'));

            if (clock.elapsedTime - this.lastFired > this.fireRate) {
                this.lastFired = clock.elapsedTime;
                const { position: spawnPos } = this.getGunSpawnTransform();
                const aimTarget = player.mesh.position.clone().add(new THREE.Vector3(0, 5, 0));
                const aimDir = new THREE.Vector3().subVectors(aimTarget, spawnPos).normalize();
                const beam = beamPool.fire(spawnPos, aimDir, true);
                if (beam) beam.userData.sourcePos = this.mesh.position.clone();
            }
        }
    }
}
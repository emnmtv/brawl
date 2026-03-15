import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class HealthComponent {
    constructor(maxHealth, uiElementId) {
        this.maxHealth = maxHealth;
        this.currentHealth = maxHealth;
        this.uiElement = document.getElementById(uiElementId);
        this.isDead = false;
    }
    takeDamage(amount) {
        if (this.isDead) return;
        this.currentHealth -= amount;
        if (this.currentHealth <= 0) { this.currentHealth = 0; this.isDead = true; }
        if (this.uiElement) this.uiElement.style.width = (this.currentHealth / this.maxHealth * 100) + '%';
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
            beam.userData = { active: false, speed: 100, distance: 0, isEnemy: false, direction: new THREE.Vector3() };
            scene.add(beam);
            this.pool.push(beam);
        }
    }

    fire(position, direction, isEnemy = false) {
        const beam = this.pool.find(b => !b.userData.active);
        if (beam) {
            beam.position.copy(position);
            const lookTarget = position.clone().add(direction);
            beam.lookAt(lookTarget);
            beam.userData.direction.copy(direction).normalize();
            beam.visible = true;
            beam.userData.active = true;
            beam.userData.distance = 0;
            beam.userData.isEnemy = isEnemy;
            beam.material.color.setHex(isEnemy ? 0xff3300 : 0x00ffcc);
        }
    }

update(dt, enemies, player) {
        this.pool.forEach(beam => {
            if (!beam.userData.active) return;

            const moveDist = beam.userData.speed * dt;
            beam.position.addScaledVector(beam.userData.direction, moveDist);
            beam.userData.distance += moveDist;

            // isRemote beams are visual-only (remote player bullets rendered locally).
            // Damage is handled server-side — skip ALL collision for these.
            if (beam.userData.isRemote) {
                if (beam.userData.distance > 300) {
                    beam.visible = false;
                    beam.userData.active = false;
                    beam.userData.isRemote = false;
                }
                return;
            }

            if (beam.userData.isEnemy) {
                // Check if player AND their boundingBox are ready
                if (player.health && !player.health.isDead && player.boundingBox) {
                    
                    // DELETED THE setFromObject LINE HERE!
                    
                    if (player.boundingBox.containsPoint(beam.position)) {
                        player.health.takeDamage(10);
                        beam.visible = false;
                        beam.userData.active = false;
                    }
                }
            } else {
                enemies.forEach(enemy => {
                    // Check if enemy AND their boundingBox are ready
                    if (!enemy.health.isDead && enemy.boundingBox) {
                        
                        // DELETED THE setFromObject LINE HERE!
                        
                        if (enemy.boundingBox.containsPoint(beam.position)) {
                            enemy.health.takeDamage(20);
                            beam.visible = false;
                            beam.userData.active = false;
                        }
                    }
                });
            }

            if (beam.userData.distance > 300) {
                beam.visible = false;
                beam.userData.active = false;
            }
        });
    }
    
    deactivateBeam(beam) {
        beam.visible = false;
        beam.userData.active = false;
    }
}

export class Enemy {
    constructor(scene, x, z, modelUrl) {
        this.mesh = new THREE.Group();
        this.mesh.position.set(x, 0, z);
        scene.add(this.mesh);

        this.health = new HealthComponent(100, 'enemy-health-bar');
        this.boundingBox = new THREE.Box3(); // Initialize Box
        
        this.speed = 10;
        this.attackRange = 80;
        this.fireRate = 0.6;
        this.lastFired = 0;
        this.aiEnabled = true;
        this.handBone = null;
        this.mixer = null;
        this.actions = {};
        this.activeAction = null;

        const loader = new GLTFLoader();
        loader.load(modelUrl, (gltf) => {
            const model = gltf.scene;
            model.scale.set(10, 10, 10);
            model.traverse((child) => {
                if (child.isMesh) {
                    child.frustumCulled = false;
                    // child.castShadow = true;
                }
                if (child.name === 'bip_hand_R') this.handBone = child;
            });
            this.mesh.add(model);
            this.mixer = new THREE.AnimationMixer(model);
            gltf.animations.forEach(clip => {
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
                document.getElementById('target-info').style.display = 'none';
            }
            return;
        }
        
        // Update Hitbox once per frame
        if (this.boundingBox) {
            const center = this.mesh.position.clone();
            center.y += 1; // Center hitbox slightly above feet
            const size = new THREE.Vector3(6, 12, 6); // Width, Height, Depth (covers feet to head)
            this.boundingBox.setFromCenterAndSize(center, size);
        }
        if (!this.mixer) return;

        if (!this.aiEnabled) {
            this.playAnim('idle');
            this.mixer.update(dt);
            return;
        }

        this.mixer.update(dt);
        const distToPlayer = this.mesh.position.distanceTo(player.mesh.position);
        this.mesh.lookAt(player.mesh.position.x, this.mesh.position.y, player.mesh.position.z);

        if (distToPlayer > this.attackRange) {
            this.mesh.translateZ(this.speed * dt); 
            const moveAnim = this.actions['run_forward'] ? 'run_forward' : 'walk';
            this.playAnim(moveAnim || 'idle'); 
        } else {
            const attackAnim = this.actions['shoot_idle'] ? 'shoot_idle' : (this.actions['shoot'] ? 'shoot' : 'idle');
            this.playAnim(attackAnim);

            if (clock.elapsedTime - this.lastFired > this.fireRate) {
                this.lastFired = clock.elapsedTime;
                const { position: spawnPos } = this.getGunSpawnTransform();
                const aimTarget = player.mesh.position.clone().add(new THREE.Vector3(0, 5, 0));
                const aimDir = new THREE.Vector3().subVectors(aimTarget, spawnPos).normalize();
                beamPool.fire(spawnPos, aimDir, true);
            }
        }
    }
}
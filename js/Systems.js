import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getModel, getBoneName } from './ModelRegistry.js';

export class HealthComponent {
    constructor(maxHealth, uiElementId) {
        this.maxHealth = maxHealth;
        this.currentHealth = maxHealth;
        this.uiElement = document.getElementById(uiElementId);
        this.isDead = false;
        this.onDamage = null;
    }

    takeDamage(amount, sourcePos = null) {
        if (this.isDead) return;
        this.currentHealth -= amount;
        if (this.currentHealth <= 0) { this.currentHealth = 0; this.isDead = true; }
        if (this.uiElement) this.uiElement.style.width = (this.currentHealth / this.maxHealth * 100) + '%';
        if (this.onDamage) this.onDamage(amount, sourcePos);
    }
}

// ─────────────────────────────────────────────────────────────
//  DeflectFX — Star-Wars-style lightsaber deflect sparks + flash
// ─────────────────────────────────────────────────────────────
export class DeflectFX {
    constructor(scene, poolSize = 80) {
        this._scene = scene;
        this._sparks = [];
        this._flashes = [];

        // Spark geometry — thin bright streaks
        const sparkGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 4);
        sparkGeo.rotateX(Math.PI / 2);

        for (let i = 0; i < poolSize; i++) {
            const mat  = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 1,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const m = new THREE.Mesh(sparkGeo, mat);
            m.visible = false;
            m.userData = { active: false, life: 0, maxLife: 0, vel: new THREE.Vector3() };
            scene.add(m);
            this._sparks.push(m);
        }

        // Flash sphere — bright centre burst
        const flashGeo = new THREE.SphereGeometry(1.5, 8, 6);
        for (let i = 0; i < 6; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const m = new THREE.Mesh(flashGeo, mat);
            m.visible = false;
            m.userData = { active: false, life: 0 };
            scene.add(m);
            this._flashes.push(m);
        }
    }

    /** Spawn deflect burst at worldPos, incomingDir is the beam direction that was blocked. */
    spawn(worldPos, incomingDir, beamColor = 0xff3300) {
        const SPARK_COUNT = 10;
        const SPARK_LIFE  = 0.28;

        // Convert beam color to HSL for tinted sparks
        const col = new THREE.Color(beamColor);

        // Spawn sparks flying out in cone from the deflect point
        let spawned = 0;
        for (const s of this._sparks) {
            if (s.userData.active) continue;
            if (spawned >= SPARK_COUNT) break;

            // Random direction in hemisphere: mostly perpendicular to incoming
            const right   = new THREE.Vector3(1, 0, 0);
            const up      = new THREE.Vector3(0, 1, 0);
            // Deflected sparks spray in a cone around the reflected vector
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.random() * Math.PI * 0.55;  // 0–~100° cone
            const dir   = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            );
            // Rotate so cone points roughly in "reflected" direction
            const reflected = incomingDir.clone().reflect(new THREE.Vector3(
                (Math.random()-0.5)*0.4, 1, (Math.random()-0.5)*0.4
            ).normalize()).normalize();
            const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1), reflected);
            dir.applyQuaternion(quat);

            const speed = 25 + Math.random() * 55;
            s.userData.vel.copy(dir).multiplyScalar(speed);
            s.userData.life    = SPARK_LIFE;
            s.userData.maxLife = SPARK_LIFE;
            s.userData.active  = true;
            s.position.copy(worldPos);
            s.lookAt(worldPos.clone().add(dir));
            s.material.color.set(col).lerp(new THREE.Color(0xffffff), 0.4 + Math.random() * 0.6);
            s.material.opacity = 1;
            s.visible = true;
            spawned++;
        }

        // Flash burst
        for (const f of this._flashes) {
            if (f.userData.active) continue;
            f.position.copy(worldPos);
            f.userData.active = true;
            f.userData.life   = 0.14;
            f.material.color.set(col).lerp(new THREE.Color(0xffffff), 0.7);
            f.material.opacity = 0.9;
            f.scale.setScalar(0.6);
            f.visible = true;
            break;
        }
    }

    update(dt) {
        for (const s of this._sparks) {
            if (!s.userData.active) continue;
            s.userData.life -= dt;
            if (s.userData.life <= 0) { s.visible = false; s.userData.active = false; continue; }
            const t = s.userData.life / s.userData.maxLife;
            s.position.addScaledVector(s.userData.vel, dt);
            s.userData.vel.multiplyScalar(1 - dt * 6); // drag
            s.material.opacity = t * t;                 // fade out quadratically
            s.scale.set(1, 1, THREE.MathUtils.lerp(0.3, 1, t));
        }
        for (const f of this._flashes) {
            if (!f.userData.active) continue;
            f.userData.life -= dt;
            if (f.userData.life <= 0) { f.visible = false; f.userData.active = false; continue; }
            const t = f.userData.life / 0.14;
            f.material.opacity = t * 0.9;
            f.scale.setScalar(THREE.MathUtils.lerp(3.0, 0.6, t)); // expand then fade
        }
    }
}

export class BeamPool {
    constructor(scene, size = 30) {
        this.pool = [];
        this.deflectFX = new DeflectFX(scene);

        const geometry = new THREE.CylinderGeometry(0.2, 0.2, 5, 8);
        geometry.rotateX(Math.PI / 2);

        for (let i = 0; i < size; i++) {
            const material = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
            const beam = new THREE.Mesh(geometry, material);
            beam.visible = false;
            beam.userData = {
                active: false, speed: 100, distance: 0,
                isEnemy: false, isRemote: false, isDeflected: false,
                sourcePos: null,
                direction: new THREE.Vector3()
            };
            scene.add(beam);
            this.pool.push(beam);
        }
    }

    fire(position, direction, isEnemy = false) {
        const beam = this.pool.find(b => !b.userData.active);
        if (!beam) return null;

        beam.position.copy(position);
        beam.lookAt(position.clone().add(direction));
        beam.userData.direction.copy(direction).normalize();
        beam.visible = true;
        beam.userData.active     = true;
        beam.userData.distance   = 0;
        beam.userData.isEnemy    = isEnemy;
        beam.userData.isRemote   = false;
        beam.userData.isDeflected= false;
        beam.userData.sourcePos  = null;
        beam.material.color.setHex(isEnemy ? 0xff3300 : 0x00ffcc);

        return beam;
    }

    /** Reflect the beam off a blocking player — spawns sparks and a new deflected beam. */
    _deflect(beam, player) {
        const hitPos = beam.position.clone();
        const inDir  = beam.userData.direction.clone();

        // Spawn Star Wars sparks at the saber contact point
        this.deflectFX.spawn(hitPos, inDir, 0xff3300);

        // Build a reflected direction — angled off the player's facing
        const charFwd = new THREE.Vector3(
            -Math.sin(player.mesh.rotation.y), 0, -Math.cos(player.mesh.rotation.y)
        );
        // True reflect off a "saber plane" normal (roughly the player's right vector)
        const saberNormal = new THREE.Vector3(
            Math.cos(player.mesh.rotation.y) + (Math.random()-0.5)*0.6,
            0.3 + Math.random()*0.4,                      // slight upward arc
            -Math.sin(player.mesh.rotation.y) + (Math.random()-0.5)*0.6
        ).normalize();
        const reflected = inDir.reflect(saberNormal).normalize();

        // Fire a deflected bolt from the impact point — white/yellow (Jedi style)
        const newBeam = this.pool.find(b => !b.userData.active);
        if (newBeam) {
            newBeam.position.copy(hitPos);
            newBeam.lookAt(hitPos.clone().add(reflected));
            newBeam.userData.direction.copy(reflected);
            newBeam.userData.active      = true;
            newBeam.userData.distance    = 0;
            newBeam.userData.isEnemy     = false;  // won't hurt local player
            newBeam.userData.isDeflected = true;   // visual only — harmless
            newBeam.userData.isRemote    = false;
            newBeam.material.color.setHex(0xffff88); // yellow deflected bolt
            newBeam.visible = true;
        }

        // Kill original beam
        beam.visible = false; beam.userData.active = false;

        // Notify UI (block flash + "BLOCKED" text)
        document.dispatchEvent(new CustomEvent('player-blocked-bullet'));
    }

    update(dt, enemies, player) {
        this.deflectFX.update(dt);

        this.pool.forEach(beam => {
            if (!beam.userData.active) return;

            const moveDist = beam.userData.speed * dt;
            beam.position.addScaledVector(beam.userData.direction, moveDist);
            beam.userData.distance += moveDist;

            // Deflected bolts — purely visual, die at range
            if (beam.userData.isDeflected) {
                if (beam.userData.distance > 200) { beam.visible = false; beam.userData.active = false; }
                return;
            }

            if (beam.userData.isRemote) {
                if (beam.userData.distance > 300) { beam.visible = false; beam.userData.active = false; beam.userData.isRemote = false; }
                return;
            }

            if (beam.userData.isEnemy) {
                if (player.health && !player.health.isDead && player.boundingBox) {
                    if (player.boundingBox.containsPoint(beam.position)) {
                        // ── LIGHTSABER DEFLECT ─────────────────────────────
                        if (player.isBlocking && player.weaponManager?.currentType === 'melee') {
                            this._deflect(beam, player);
                            return;
                        }
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

            if (beam.userData.distance > 300) { beam.visible = false; beam.userData.active = false; }
        });
    }

    deactivateBeam(beam) { beam.visible = false; beam.userData.active = false; }
}

export class Enemy {
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

        const profile = getModel(modelId);
        new GLTFLoader().load(profile.path, (gltf) => {
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
            const center = this.mesh.position.clone(); center.y += 1;
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
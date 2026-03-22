/**
 * BeamSystem.js — Projectile pool + lightsaber deflect VFX.
 *
 * BeamPool   — manages beam lifecycle, movement, wall/entity collision
 * DeflectFX  — particle sparks and flash burst on block
 */
import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
//  DeflectFX
// ─────────────────────────────────────────────────────────────

export class DeflectFX {
    constructor(scene, poolSize = 80) {
        this._sparks  = [];
        this._flashes = [];
        this._buildPool(scene, poolSize);
    }

    _buildPool(scene, poolSize) {
        const sparkGeo = new THREE.CylinderGeometry(0.06, 0.06, 1.8, 4);
        sparkGeo.rotateX(Math.PI / 2);
        for (let i = 0; i < poolSize; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 1,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const m = new THREE.Mesh(sparkGeo, mat);
            m.visible   = false;
            m.userData  = { active: false, life: 0, maxLife: 0, vel: new THREE.Vector3() };
            scene.add(m);
            this._sparks.push(m);
        }
        const flashGeo = new THREE.SphereGeometry(1.5, 8, 6);
        for (let i = 0; i < 6; i++) {
            const mat = new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0,
                blending: THREE.AdditiveBlending, depthWrite: false,
            });
            const m = new THREE.Mesh(flashGeo, mat);
            m.visible   = false;
            m.userData  = { active: false, life: 0 };
            scene.add(m);
            this._flashes.push(m);
        }
    }

    spawn(worldPos, incomingDir, beamColor = 0xff3300) {
        const SPARK_COUNT = 10, SPARK_LIFE = 0.28;
        const col = new THREE.Color(beamColor);
        let spawned = 0;

        for (const s of this._sparks) {
            if (s.userData.active || spawned >= SPARK_COUNT) continue;
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.random() * Math.PI * 0.55;
            const dir   = new THREE.Vector3(
                Math.sin(phi) * Math.cos(theta),
                Math.sin(phi) * Math.sin(theta),
                Math.cos(phi)
            );
            const reflected = incomingDir.clone()
                .reflect(new THREE.Vector3(
                    (Math.random() - 0.5) * 0.4, 1, (Math.random() - 0.5) * 0.4
                ).normalize())
                .normalize();
            dir.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), reflected));
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
            s.userData.vel.multiplyScalar(1 - dt * 6);
            s.material.opacity = t * t;
            s.scale.set(1, 1, THREE.MathUtils.lerp(0.3, 1, t));
        }
        for (const f of this._flashes) {
            if (!f.userData.active) continue;
            f.userData.life -= dt;
            if (f.userData.life <= 0) { f.visible = false; f.userData.active = false; continue; }
            const t = f.userData.life / 0.14;
            f.material.opacity = t * 0.9;
            f.scale.setScalar(THREE.MathUtils.lerp(3.0, 0.6, t));
        }
    }
}

// ─────────────────────────────────────────────────────────────
//  BeamPool
// ─────────────────────────────────────────────────────────────

export class BeamPool {
    constructor(scene, size = 30) {
        this.pool       = [];
        this.deflectFX  = new DeflectFX(scene);
        this._wallRay   = new THREE.Raycaster();
        this._buildPool(scene, size);
    }

    _buildPool(scene, size) {
        const geo = new THREE.CylinderGeometry(0.2, 0.2, 5, 8);
        geo.rotateX(Math.PI / 2);
        for (let i = 0; i < size; i++) {
            const beam = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x00ffcc }));
            beam.visible   = false;
            beam.userData  = {
                active: false, speed: 100, distance: 0,
                isEnemy: false, isRemote: false, isDeflected: false,
                sourcePos: null,
                direction: new THREE.Vector3(),
                prevPos:   new THREE.Vector3(),
                segStart:  new THREE.Vector3(),
            };
            scene.add(beam);
            this.pool.push(beam);
        }
    }

    /** Activate and aim a beam from the pool. Returns the beam or null if pool full. */
    fire(position, direction, isEnemy = false) {
        const beam = this.pool.find(b => !b.userData.active);
        if (!beam) return null;
        beam.position.copy(position);
        beam.userData.prevPos.copy(position);
        beam.lookAt(position.clone().add(direction));
        beam.userData.direction.copy(direction).normalize();
        beam.visible             = true;
        beam.userData.active     = true;
        beam.userData.distance   = 0;
        beam.userData.isEnemy    = isEnemy;
        beam.userData.isRemote   = false;
        beam.userData.isDeflected = false;
        beam.userData.sourcePos  = null;
        beam.material.color.setHex(isEnemy ? 0xff3300 : 0x00ffcc);
        return beam;
    }

    deactivate(beam) {
        beam.visible = false;
        beam.userData.active = false;
    }

    /**
     * Per-frame update.
     *
     * @param {number}       dt
     * @param {object[]}     enemies        — entities with health + boundingBox
     * @param {object}       localPlayer    — entity with health + boundingBox + isBlocking
     * @param {THREE.Mesh[]} collisionMeshes
     */
    update(dt, enemies, localPlayer, collisionMeshes = []) {
        this.deflectFX.update(dt);

        this.pool.forEach(beam => {
            if (!beam.userData.active) return;

            const prev     = beam.userData.prevPos;
            const moveDist = beam.userData.speed * dt;
            const next     = beam.position.clone().addScaledVector(beam.userData.direction, moveDist);
            beam.userData.segStart.copy(prev);

            // ── Wall collision (continuous raycasting prevents tunnelling) ──
            if (collisionMeshes.length) {
                const segDir = next.clone().sub(prev);
                const segLen = segDir.length();
                if (segLen > 1e-6) {
                    this._wallRay.set(prev, segDir.clone().divideScalar(segLen));
                    this._wallRay.near = 0;
                    this._wallRay.far  = segLen;
                    const hits = this._wallRay.intersectObjects(collisionMeshes, false);
                    if (hits.length) {
                        beam.position.copy(hits[0].point);
                        beam.userData.prevPos.copy(beam.position);
                        beam.userData.distance += hits[0].distance;
                        this.deactivate(beam);
                        return;
                    }
                }
            }

            beam.position.copy(next);
            beam.userData.distance += moveDist;

            // ── Deflected bolts — visual only, no hit checks ──
            if (beam.userData.isDeflected) {
                if (beam.userData.distance > 200) this.deactivate(beam);
                beam.userData.prevPos.copy(beam.position);
                return;
            }

            // ── Remote beams — check local player block ──
            if (beam.userData.isRemote) {
                if (localPlayer && !localPlayer.health.isDead && localPlayer.isBlocking &&
                    localPlayer.weaponManager?.currentType === 'melee' &&
                    localPlayer.boundingBox.containsPoint(beam.position)) {
                    this._deflect(beam, localPlayer);
                }
                if (beam.userData.distance > 300) this.deactivate(beam);
                beam.userData.prevPos.copy(beam.position);
                return;
            }

            // ── Enemy beam → check local player ──
            if (beam.userData.isEnemy) {
                if (localPlayer?.health && !localPlayer.health.isDead && localPlayer.boundingBox) {
                    const hit = this._segmentBoxHit(prev, beam.position, localPlayer.boundingBox);
                    if (hit) {
                        if (localPlayer.isBlocking && localPlayer.weaponManager?.currentType === 'melee') {
                            this._deflect(beam, localPlayer);
                        } else {
                            localPlayer.health.takeDamage(10, beam.userData.sourcePos || null);
                            this.deactivate(beam);
                        }
                    }
                }

            // ── Local beam → check enemies ──
            } else {
                enemies.forEach(enemy => {
                    if (!enemy.health.isDead && enemy.boundingBox &&
                        this._segmentBoxHit(prev, beam.position, enemy.boundingBox)) {
                        enemy.health.takeDamage(20);
                        this.deactivate(beam);
                    }
                });
            }

            if (beam.userData.distance > 300) this.deactivate(beam);
            beam.userData.prevPos.copy(beam.position);
        });
    }

    // ── Private helpers ──────────────────────────────────────

    _segmentBoxHit(segStart, segEnd, box) {
        const dir = segEnd.clone().sub(segStart);
        const len = dir.length();
        if (len < 1e-6) return false;
        const ray      = new THREE.Ray(segStart.clone(), dir.clone().divideScalar(len));
        const hitPoint = ray.intersectBox(box, new THREE.Vector3());
        return !!hitPoint && hitPoint.distanceTo(segStart) <= len + 1e-4;
    }

    _deflect(beam, player) {
        const hitPos = beam.position.clone();
        const inDir  = beam.userData.direction.clone();
        this.deflectFX.spawn(hitPos, inDir, 0xff3300);

        const saberNormal = new THREE.Vector3(
            Math.cos(player.mesh.rotation.y) + (Math.random() - 0.5) * 0.6,
            0.3 + Math.random() * 0.4,
            -Math.sin(player.mesh.rotation.y) + (Math.random() - 0.5) * 0.6
        ).normalize();
        const reflected = inDir.reflect(saberNormal).normalize();

        const newBeam = this.pool.find(b => !b.userData.active);
        if (newBeam) {
            newBeam.position.copy(hitPos);
            newBeam.lookAt(hitPos.clone().add(reflected));
            newBeam.userData.direction.copy(reflected);
            newBeam.userData.active       = true;
            newBeam.userData.distance     = 0;
            newBeam.userData.isEnemy      = false;
            newBeam.userData.isDeflected  = true;
            newBeam.userData.isRemote     = false;
            newBeam.material.color.setHex(0xffff88);
            newBeam.visible = true;
        }

        this.deactivate(beam);
        document.dispatchEvent(new CustomEvent('player-blocked-bullet'));
    }
}

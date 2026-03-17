import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './Config.js';
import { getWeaponConfig } from './ModelRegistry.js';

class WeaponStrategy {
    constructor(type, config) {
        this.type   = type;
        this.config = config;   // live reference — mutations are visible immediately
        this.mesh   = null;
        this.lastFired = 0;
    }

    load() {
        return new Promise((resolve) => {
            // Always read MODEL from the global CONFIG (it's the same GLB for all models)
            const modelPath = CONFIG.WEAPONS[this.type.toUpperCase()].MODEL;
            new GLTFLoader().load(modelPath, (gltf) => {
                this.mesh = gltf.scene;
                this._applyTransform();
                resolve(this.mesh);
            }, undefined, () => resolve(null));
        });
    }

    /** Re-apply scale/pos/rot from the live config to the mesh. */
    _applyTransform() {
        if (!this.mesh) return;
        this.mesh.scale.set(this.config.SCALE, this.config.SCALE, this.config.SCALE);
        this.mesh.position.set(...this.config.POS);
        this.mesh.rotation.set(...this.config.ROT);
    }

    attach(bone) {
        if (this.mesh && bone) {
            bone.add(this.mesh);
            // Re-apply transform on every attach so per-model values are used
            this._applyTransform();
        }
    }

    detach(bone) {
        if (this.mesh && bone) bone.remove(this.mesh);
    }

    canFire(clock) {
        if (clock.elapsedTime - this.lastFired > this.config.FIRE_RATE) {
            this.lastFired = clock.elapsedTime;
            return true;
        }
        return false;
    }

    fire(context) { throw new Error('Not implemented'); }
}

class GunWeapon extends WeaponStrategy {
    constructor(config) { super('gun', config); }

    fire({ player, beamPool, inputManager, isRemote }) {
        let spawnPos;

        if (this.mesh && !isRemote) {
            // Fire from barrel tip — BULLET_OFFSET is local to the gun mesh
            // X = right, Y = up, Z = negative forward (shoot direction)
            const bo = this.config.BULLET_OFFSET || [0, 0, -5];
            spawnPos = this.mesh.localToWorld(new THREE.Vector3(bo[0], bo[1], bo[2]));
        } else {
            // Fallback: spawn at player feet + BULLET_HEIGHT_OFFSET
            spawnPos = player.mesh.position.clone();
            spawnPos.y += this.config.BULLET_HEIGHT_OFFSET ?? 8;
        }

        let aimDir;
        if (isRemote) {
            aimDir = new THREE.Vector3(0, 0, -1).applyEuler(
                new THREE.Euler(player.targetPitch || 0, player.mesh.rotation.y, 0, 'YXZ')
            );
        } else {
            // True aim direction is computed by the spring camera each frame (crosshair direction).
            // Fall back to the camera pivot direction if unavailable.
            if (inputManager?.aimDir) {
                aimDir = inputManager.aimDir.clone().normalize();
            } else {
                aimDir = new THREE.Vector3();
                player.cameraPivot.getWorldDirection(aimDir);
                aimDir.normalize();
            }
        }

        const beam = beamPool.fire(spawnPos, aimDir, false);
        if (beam && isRemote) {
            beam.userData.isRemote = true;
            beam.material.color.setHex(0xff6600);
        }
    }
}

class MeleeWeapon extends WeaponStrategy {
    constructor(config) { super('melee', config); }

    fire({ player, enemies, network, isRemote }) {
        if (isRemote) return;
        const attackOrigin = player.mesh.position.clone();

        if (enemies) {
            enemies.forEach(enemy => {
                if (!enemy.health.isDead && attackOrigin.distanceTo(enemy.mesh.position) < this.config.RANGE) {
                    enemy.health.takeDamage(this.config.DAMAGE);
                }
            });
        }
        if (network) {
            network.remotePlayers.forEach((rp, id) => {
                if (!rp.isDead && attackOrigin.distanceTo(rp.mesh.position) < this.config.RANGE) {
                    network.reportHit(id, this.config.DAMAGE);
                }
            });
        }
    }
}

export class WeaponManager {
    /**
     * @param {boolean} isRemote
     * @param {string}  modelId  — used to look up per-model weapon configs
     */
    constructor(isRemote = false, modelId = 't800') {
        this.isRemote    = isRemote;
        this.modelId     = modelId;
        this.currentType = 'gun';
        this.handBone    = null;

        // Create strategies with the per-model config references
        this.weapons = {
            gun:   new GunWeapon(getWeaponConfig(modelId, 'gun')),
            melee: new MeleeWeapon(getWeaponConfig(modelId, 'melee')),
        };
    }

    /**
     * Hot-swap the model's weapon configs (called on character/respawn swap).
     * Updates config references and re-applies transforms to any loaded meshes.
     */
    setModelId(modelId) {
        this.modelId = modelId;
        this.weapons.gun.config   = getWeaponConfig(modelId, 'gun');
        this.weapons.melee.config = getWeaponConfig(modelId, 'melee');
        // Re-apply transforms so the currently-equipped weapon repositions
        this.weapons.gun._applyTransform();
        this.weapons.melee._applyTransform();
    }

    async init(handBone) {
        this.handBone = handBone;
        await Promise.all([this.weapons.gun.load(), this.weapons.melee.load()]);
        this.equip('gun');
    }

    equip(type) {
        if (!this.weapons[type] || type === this.currentType) return;
        if (this.weapons[this.currentType]) this.weapons[this.currentType].detach(this.handBone);

        this.currentType = type;
        this.weapons[this.currentType].attach(this.handBone);

        if (!this.isRemote) {
            const updateUI = (pref) => {
                const g = document.getElementById(`${pref}gun`);
                const m = document.getElementById(`${pref}melee`);
                if (g && m) {
                    g.classList.toggle('active', type === 'gun');
                    m.classList.toggle('active', type === 'melee');
                }
            };
            updateUI('ui-wep-');
            updateUI('ui-wep-gun-pvp');
        }
    }

    attemptFire(clock, context) {
        const wep = this.weapons[this.currentType];
        if (wep.canFire(clock)) { wep.fire(context); return true; }
        return false;
    }
}
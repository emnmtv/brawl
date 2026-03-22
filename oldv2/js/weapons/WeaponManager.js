/**
 * WeaponManager.js — Load, equip, and fire weapons.
 *
 * Uses the Strategy pattern: GunWeapon and MeleeWeapon implement the same
 * interface (load / attach / detach / canFire / fire).
 * WeaponManager owns the strategies and delegates to the active one.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { WEAPON_DEFAULTS } from '../data/WeaponDefaults.js';
import { getWeaponConfig } from '../registry/ModelRegistry.js';

// ─────────────────────────────────────────────────────────────
//  Base strategy
// ─────────────────────────────────────────────────────────────

class WeaponStrategy {
    constructor(type, config) {
        this.type      = type;
        this.config    = config;   // live reference — mutations visible immediately
        this.mesh      = null;
        this.lastFired = 0;
    }

    /** Loads the GLB from the global WEAPON_DEFAULTS model path. */
    load() {
        return new Promise(resolve => {
            const modelPath = WEAPON_DEFAULTS[this.type.toUpperCase()].MODEL;
            new GLTFLoader().load(
                modelPath,
                gltf => { this.mesh = gltf.scene; this._applyTransform(); resolve(this.mesh); },
                undefined,
                ()   => resolve(null)
            );
        });
    }

    /** Re-applies scale/pos/rot from the live config to the mesh. */
    _applyTransform() {
        if (!this.mesh) return;
        this.mesh.scale.set(this.config.SCALE, this.config.SCALE, this.config.SCALE);
        this.mesh.position.set(...this.config.POS);
        this.mesh.rotation.set(...this.config.ROT);
    }

    attach(bone) {
        if (this.mesh && bone) { bone.add(this.mesh); this._applyTransform(); }
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

    fire(_context) { throw new Error('Not implemented'); }
}

// ─────────────────────────────────────────────────────────────
//  Gun strategy
// ─────────────────────────────────────────────────────────────

class GunWeapon extends WeaponStrategy {
    constructor(config) { super('gun', config); }

    fire({ player, beamPool, inputManager, isRemote }) {
        let spawnPos;
        if (this.mesh && !isRemote) {
            const bo = this.config.BULLET_OFFSET || [0, 0, -5];
            spawnPos = this.mesh.localToWorld(new THREE.Vector3(bo[0], bo[1], bo[2]));
        } else {
            spawnPos = player.mesh.position.clone();
            spawnPos.y += this.config.BULLET_HEIGHT_OFFSET ?? 8;
        }

        let aimDir;
        if (isRemote) {
            aimDir = new THREE.Vector3(0, 0, -1).applyEuler(
                new THREE.Euler(player.targetPitch || 0, player.mesh.rotation.y, 0, 'YXZ')
            );
        } else {
            aimDir = inputManager?.aimDir
                ? inputManager.aimDir.clone().normalize()
                : (() => { const d = new THREE.Vector3(); player.cameraPivot.getWorldDirection(d); return d.normalize(); })();
        }

        const beam = beamPool.fire(spawnPos, aimDir, false);
        if (beam && isRemote) {
            beam.userData.isRemote = true;
            beam.material.color.setHex(0xff6600);
        }
    }
}

// ─────────────────────────────────────────────────────────────
//  Melee strategy
// ─────────────────────────────────────────────────────────────

class MeleeWeapon extends WeaponStrategy {
    constructor(config) { super('melee', config); }

    fire({ player, enemies, network, isRemote }) {
        if (isRemote) return;
        const origin = player.mesh.position.clone();
        enemies?.forEach(enemy => {
            if (!enemy.health.isDead && origin.distanceTo(enemy.mesh.position) < this.config.RANGE)
                enemy.health.takeDamage(this.config.DAMAGE);
        });
        network?.remotePlayers.forEach((rp, id) => {
            if (!rp.isDead && origin.distanceTo(rp.mesh.position) < this.config.RANGE)
                network.reportHit(id, this.config.DAMAGE);
        });
    }
}

// ─────────────────────────────────────────────────────────────
//  WeaponManager
// ─────────────────────────────────────────────────────────────

export class WeaponManager {
    /**
     * @param {boolean} isRemote  — remote players skip local-player-only effects
     * @param {string}  modelId
     */
    constructor(isRemote = false, modelId = 't800') {
        this.isRemote    = isRemote;
        this.modelId     = modelId;
        this.currentType = 'gun';
        this.handBone    = null;
        this.weapons     = {
            gun:   new GunWeapon(getWeaponConfig(modelId, 'gun')),
            melee: new MeleeWeapon(getWeaponConfig(modelId, 'melee')),
        };
    }

    /** Hot-swap configs after a model / respawn change. */
    setModelId(modelId) {
        this.modelId = modelId;
        this.weapons.gun.config   = getWeaponConfig(modelId, 'gun');
        this.weapons.melee.config = getWeaponConfig(modelId, 'melee');
        this.weapons.gun._applyTransform();
        this.weapons.melee._applyTransform();
    }

    /** Load both weapon GLBs and attach the default one. */
    async init(handBone) {
        this.handBone = handBone;
        await Promise.all([this.weapons.gun.load(), this.weapons.melee.load()]);
        this.equip('gun');
    }

    equip(type) {
        if (!this.weapons[type] || type === this.currentType) return;
        this.weapons[this.currentType]?.detach(this.handBone);
        this.currentType = type;
        this.weapons[this.currentType].attach(this.handBone);
        if (!this.isRemote) this._syncWeaponUI(type);
    }

    attemptFire(clock, context) {
        const wep = this.weapons[this.currentType];
        if (wep.canFire(clock)) { wep.fire(context); return true; }
        return false;
    }

    _syncWeaponUI(type) {
        // Sync both legacy dev slots and PVP cards
        [['ui-wep-gun', 'ui-wep-melee'], ['pvp-wep-gun', 'pvp-wep-melee']].forEach(([gId, mId]) => {
            const g = document.getElementById(gId), m = document.getElementById(mId);
            if (g && m) {
                g.classList.toggle('active', type === 'gun');
                m.classList.toggle('active', type === 'melee');
            }
        });
    }
}

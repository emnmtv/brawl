import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './Config.js';

class WeaponStrategy {
    constructor(type, config) {
        this.type = type;
        this.config = config;
        this.mesh = null;
        this.lastFired = 0;
    }

    load() {
        return new Promise((resolve) => {
            new GLTFLoader().load(this.config.MODEL, (gltf) => {
                this.mesh = gltf.scene;
                this.mesh.scale.set(this.config.SCALE, this.config.SCALE, this.config.SCALE);
                this.mesh.position.set(...this.config.POS);
                this.mesh.rotation.set(...this.config.ROT);
                resolve(this.mesh);
            }, undefined, () => resolve(null));
        });
    }

    attach(bone) { if (this.mesh && bone) bone.add(this.mesh); }
    detach(bone) { if (this.mesh && bone) bone.remove(this.mesh); }

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
    constructor() { super('gun', CONFIG.WEAPONS.GUN); }
    fire({ player, beamPool, isRemote }) {
        let spawnPos;
        if (this.mesh && !isRemote) {
            spawnPos = this.mesh.localToWorld(new THREE.Vector3(0, 0, -5));
        } else {
            spawnPos = player.mesh.position.clone(); spawnPos.y += 8; 
        }

        let aimDir;
        if (isRemote) aimDir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(player.targetPitch || 0, player.mesh.rotation.y, 0, 'YXZ'));
        else { aimDir = new THREE.Vector3(); player.cameraPivot.getWorldDirection(aimDir); aimDir.negate(); }

        const beam = beamPool.fire(spawnPos, aimDir, false);
        if (beam && isRemote) { beam.userData.isRemote = true; beam.material.color.setHex(0xff6600); }
    }
}

class MeleeWeapon extends WeaponStrategy {
    constructor() { super('melee', CONFIG.WEAPONS.MELEE); }
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
    constructor(isRemote = false) {
        this.isRemote = isRemote;
        this.weapons = { gun: new GunWeapon(), melee: new MeleeWeapon() };
        this.currentType = 'gun';
        this.handBone = null;
    }

    async init(handBone) {
        this.handBone = handBone;
        await Promise.all([this.weapons.gun.load(), this.weapons.melee.load()]);
        this.equip('gun');
    }

    equip(type, prefix = 'ui-wep-') {
        if (!this.weapons[type] || type === this.currentType) return;
        if (this.weapons[this.currentType]) this.weapons[this.currentType].detach(this.handBone);

        this.currentType = type;
        this.weapons[this.currentType].attach(this.handBone);

        if (!this.isRemote) {
            const updateUI = (pref) => {
                const g = document.getElementById(`${pref}gun`);
                const m = document.getElementById(`${pref}melee`);
                if (g && m) { g.classList.toggle('active', type === 'gun'); m.classList.toggle('active', type === 'melee'); }
            };
            updateUI('ui-wep-');
            updateUI('ui-wep-gun-pvp'); // Handle PVP overlay too
        }
    }

    attemptFire(clock, context) {
        const wep = this.weapons[this.currentType];
        if (wep.canFire(clock)) { wep.fire(context); return true; }
        return false;
    }
}
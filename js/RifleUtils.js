import { CONFIG } from './Config.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Loads and attaches the rifle model to the given hand bone.
 * Calls callback(rifle) when done.
 */
export function attachRifleToHand(rightHand, callback) {
    if (!rightHand) return;
    const weaponLoader = new GLTFLoader();
    weaponLoader.load('models/battle_rifle.glb', (weaponGltf) => {
        const rifle = weaponGltf.scene;
        rifle.scale.set(CONFIG.RIFLE_SCALE, CONFIG.RIFLE_SCALE, CONFIG.RIFLE_SCALE);
        rifle.position.set(...CONFIG.RIFLE_POS);
        rifle.rotation.set(...CONFIG.RIFLE_ROT);
        rightHand.add(rifle);
        if (callback) callback(rifle);
    });
}

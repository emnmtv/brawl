/**
 * SpringCamera.js — Over-the-shoulder 3rd-person spring arm camera.
 *
 * Orbit math, collision raycast, character fade, and aim-dir computation
 * are all here and nowhere else. main.js calls update() each frame.
 */
import * as THREE from 'three';

const _springRay     = new THREE.Raycaster();
const _camFocus      = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();
const _camDesired    = new THREE.Vector3();
const _camSmoothed   = new THREE.Vector3();
const _aimDir        = new THREE.Vector3();

export class SpringCamera {
    constructor(camera) {
        this._camera        = camera;
        this._ready         = false;
        this._charMaterials = null;
    }

    /** Must be called when the player mesh is rebuilt (respawn, model change). */
    reset() {
        this._ready         = false;
        this._charMaterials = null;
    }

    /**
     * @param {Character}       player
     * @param {InputManager}    inputManager   — reads mouseLookX / mouseLookY
     * @param {THREE.Mesh[]}    collisionMeshes
     */
    update(player, inputManager, collisionMeshes) {
        const sc    = player.sizeConfig;
        const yaw   = inputManager.mouseLookX;
        const pitch = inputManager.mouseLookY;

        const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
        const fwdX = -sinY, fwdZ = -cosY;
        const rgtX =  cosY, rgtZ = -sinY;

        const ARM   = sc.camOffset.z;
        const SIDE  = sc.camOffset.x * 1.6;
        const CAM_Y = sc.cameraPivotY * 0.85 + sc.camOffset.y;
        const LOOK_FWD = ARM * 5.0;
        const LOOK_Y   = sc.cameraPivotY * 1.1;

        const cosP = Math.cos(-pitch), sinP = Math.sin(-pitch);

        // Desired camera world position (before collision)
        _camDesired.set(
            player.mesh.position.x - fwdX * ARM * cosP + rgtX * SIDE,
            player.mesh.position.y + CAM_Y - ARM * sinP,
            player.mesh.position.z - fwdZ * ARM * cosP + rgtZ * SIDE
        );

        // Spring arm anchor (right shoulder)
        _camFocus.set(
            player.mesh.position.x + rgtX * SIDE * 0.3,
            player.mesh.position.y + sc.cameraPivotY,
            player.mesh.position.z + rgtZ * SIDE * 0.3
        );

        // Spring arm collision
        const armVec  = _camDesired.clone().sub(_camFocus);
        const armFull = armVec.length();
        const armDir  = armVec.clone().divideScalar(armFull);

        _springRay.set(_camFocus, armDir);
        _springRay.near = 0.05;
        _springRay.far  = armFull;

        let actualLen = armFull;
        if (collisionMeshes?.length) {
            const hits = _springRay.intersectObjects(collisionMeshes, false);
            if (hits.length) actualLen = Math.max(0.5, hits[0].distance - 0.3);
        }
        const actualPos = _camFocus.clone().addScaledVector(armDir, actualLen);

        // Smooth position
        if (!this._ready) { _camSmoothed.copy(actualPos); this._ready = true; }
        else              { _camSmoothed.lerp(actualPos, 0.18); }
        this._camera.position.copy(_camSmoothed);

        // Look at far-ahead world point (keeps character in lower frame)
        _camLookTarget.set(
            player.mesh.position.x + fwdX * LOOK_FWD * cosP,
            player.mesh.position.y + LOOK_Y + LOOK_FWD * sinP * 0.4,
            player.mesh.position.z + fwdZ * LOOK_FWD * cosP
        );
        this._camera.lookAt(_camLookTarget);

        // True aim direction (crosshair forward)
        this._camera.getWorldDirection(_aimDir);
        inputManager.aimDir = _aimDir;

        // Character fade when arm is compressed
        this._updateCharacterFade(player, actualLen, armFull);
    }

    _updateCharacterFade(player, actualLen, armFull) {
        if (!this._charMaterials && player.mesh.children.length > 0) {
            this._charMaterials = [];
            player.mesh.traverse(child => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => { m.transparent = true; this._charMaterials.push(m); });
                }
            });
        }
        if (this._charMaterials) {
            const ratio   = actualLen / armFull;
            const opacity = ratio < 0.35 ? Math.max(0, ratio / 0.35) : 1;
            this._charMaterials.forEach(m => { m.opacity = opacity; });
        }
    }
}

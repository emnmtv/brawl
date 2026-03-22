// SpringCamera.js — Over-the-shoulder 3rd-person spring arm camera for test/main.js
import * as THREE from 'three';

const _springRay     = new THREE.Raycaster();
const _camFocus      = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();
const _camDesired    = new THREE.Vector3();
const _camSmoothed   = new THREE.Vector3();
const _aimDir        = new THREE.Vector3();


export class SpringCamera {
    /**
     * @param {THREE.Camera} camera
     * @param {Object} [options]
     * @param {number} [options.smoothing=0] - 0 for instant/snappy, >0 for smoothing (0.18 = old value)
     */
    constructor(camera, options = {}) {
        this._camera        = camera;
        this._ready         = false;
        this._charMaterials = null;
        this.smoothing      = options.smoothing !== undefined ? options.smoothing : 0; // Default: snappy
    }

    reset() {
        this._ready            = false;
        this._charMaterials    = null;
        this._trackedModelRoot = null;
    }

    /**
     * @param {THREE.Object3D} playerMesh
     * @param {Object} sizeConfig
     * @param {number} yaw
     * @param {number} pitch
     * @param {THREE.Mesh[]} collisionMeshes
     */
    update(playerMesh, sizeConfig, yaw, pitch, collisionMeshes) {
        const sc = sizeConfig;
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
            playerMesh.position.x - fwdX * ARM * cosP + rgtX * SIDE,
            playerMesh.position.y + CAM_Y - ARM * sinP,
            playerMesh.position.z - fwdZ * ARM * cosP + rgtZ * SIDE
        );

        // Spring arm anchor (right shoulder)
        _camFocus.set(
            playerMesh.position.x + rgtX * SIDE * 0.3,
            playerMesh.position.y + sc.cameraPivotY,
            playerMesh.position.z + rgtZ * SIDE * 0.3
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
            if (hits.length) {
                // Find the closest hit
                let minDist = Infinity;
                for (const hit of hits) {
                    if (hit.distance < minDist) minDist = hit.distance;
                }
                // Stop camera right at the wall, but not inside player
                actualLen = Math.max(0.35, minDist);
            }
        }
        let actualPos = _camFocus.clone().addScaledVector(armDir, actualLen);
        // Prevent camera from going below ground (Y < 0.2)
        if (actualPos.y < 0.2) actualPos.y = 0.2;

        // Smooth or snappy position
        if (!this._ready || this.smoothing === 0) {
            _camSmoothed.copy(actualPos); this._ready = true;
        } else {
            _camSmoothed.lerp(actualPos, this.smoothing);
        }
        this._camera.position.copy(_camSmoothed);

        // Look at far-ahead world point (keeps character in lower frame)
        _camLookTarget.set(
            playerMesh.position.x + fwdX * LOOK_FWD * cosP,
            playerMesh.position.y + LOOK_Y + LOOK_FWD * sinP * 0.4,
            playerMesh.position.z + fwdZ * LOOK_FWD * cosP
        );
        this._camera.lookAt(_camLookTarget);
    }
}

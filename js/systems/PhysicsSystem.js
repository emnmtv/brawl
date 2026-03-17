/**
 * PhysicsSystem.js — Stateless movement, collision, and jump helpers.
 *
 * All functions take explicit parameters; nothing is stored here.
 * Character.js calls these each frame instead of embedding the logic.
 */
import * as THREE from 'three';

const _wallRaycaster  = new THREE.Raycaster();
const _groundRaycaster = new THREE.Raycaster();

// ─────────────────────────────────────────────────────────────
//  Ground snap
// ─────────────────────────────────────────────────────────────

/**
 * Raycasts downward and returns the ground Y below the mesh.
 * Falls back to (currentY - stepDown) if nothing is hit.
 *
 * @param {THREE.Vector3} pos       — mesh world position
 * @param {object}        physics   — getSizeConfig() result
 * @param {THREE.Mesh[]}  meshes
 * @returns {number} groundY
 */
export function snapToGround(pos, physics, meshes) {
    if (!meshes?.length) return 0;
    const { stepUp, stepDown } = physics;
    _groundRaycaster.set(
        new THREE.Vector3(pos.x, pos.y + stepUp, pos.z),
        new THREE.Vector3(0, -1, 0)
    );
    _groundRaycaster.far = stepUp + stepDown;
    const hits = _groundRaycaster.intersectObjects(meshes, false);
    _groundRaycaster.far = Infinity;
    return (hits.length > 0 && hits[0].point.y <= pos.y + stepUp)
        ? hits[0].point.y
        : pos.y - stepDown;
}

// ─────────────────────────────────────────────────────────────
//  Wall collision
// ─────────────────────────────────────────────────────────────

/**
 * Returns false if moving in `dir` would immediately collide with a wall.
 *
 * @param {THREE.Vector3} pos
 * @param {THREE.Vector3} dir     — normalised move direction
 * @param {object}        physics
 * @param {THREE.Mesh[]}  meshes
 * @returns {boolean} canMove
 */
export function canMoveInDirection(pos, dir, physics, meshes) {
    if (!meshes?.length) return true;
    const heights = Array.isArray(physics.wallRayHeights)
        ? physics.wallRayHeights
        : [physics.height * 0.083, physics.height * 0.417, physics.height * 0.75];

    for (const h of heights) {
        _wallRaycaster.set(new THREE.Vector3(pos.x, pos.y + h, pos.z), dir);
        _wallRaycaster.far = physics.width * 0.6;
        if (_wallRaycaster.intersectObjects(meshes, false).length > 0) return false;
    }
    return true;
}

// ─────────────────────────────────────────────────────────────
//  Locomotion input → world move direction
// ─────────────────────────────────────────────────────────────

/**
 * Converts WASD booleans + camera yaw into a world-space move direction.
 *
 * @param {{ forward, backward, left, right }} keys
 * @param {number} camYaw
 * @returns {THREE.Vector3} normalised, or zero-length if no input
 */
export function buildMoveDir(keys, camYaw) {
    const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
    const camFwd   = new THREE.Vector3(-sinY, 0, -cosY);
    const camRight = new THREE.Vector3( cosY, 0, -sinY);
    const dir      = new THREE.Vector3();
    if (keys.forward)  dir.addScaledVector(camFwd,    1);
    if (keys.backward) dir.addScaledVector(camFwd,   -1);
    if (keys.left)     dir.addScaledVector(camRight, -1);
    if (keys.right)    dir.addScaledVector(camRight,  1);
    if (dir.lengthSq() > 0) dir.normalize();
    return dir;
}

// ─────────────────────────────────────────────────────────────
//  Animation direction classification
// ─────────────────────────────────────────────────────────────

/**
 * Projects a world moveDir onto the character's facing axes and returns
 * boolean flags: { animFwd, animBack, animLeft, animRight }.
 *
 * @param {THREE.Vector3} moveDir       — normalised
 * @param {number}        charRotationY
 * @returns {{ animFwd, animBack, animLeft, animRight }}
 */
export function classifyMoveDir(moveDir, charRotationY) {
    const fwdX =  -Math.sin(charRotationY), fwdZ = -Math.cos(charRotationY);
    const rgtX =   Math.cos(charRotationY), rgtZ = -Math.sin(charRotationY);
    const dotFwd = moveDir.x * fwdX + moveDir.z * fwdZ;
    const dotRgt = moveDir.x * rgtX + moveDir.z * rgtZ;
    return {
        animFwd:   dotFwd >  0.35,
        animBack:  dotFwd < -0.35,
        animRight: dotRgt >  0.35,
        animLeft:  dotRgt < -0.35,
    };
}

/**
 * MapLoader.js — Loads a GLB map, exposes collision meshes.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class MapLoader {
    constructor(scene) {
        this.scene            = scene;
        this.root             = null;
        this.collisionMeshes  = [];
        this.isLoaded         = false;
    }

    /**
     * @param {string} url
     * @param {object} opts  — { scale, pos, rot, onProgress }
     * @returns {Promise<THREE.Group>}
     */
    load(url, opts = {}) {
        const { scale = 1, pos = {x:0,y:0,z:0}, rot = {x:0,y:0,z:0}, onProgress = null } = opts;

        return new Promise((resolve, reject) => {
            new GLTFLoader().load(
                url,
                gltf => {
                    this.root = gltf.scene;
                    this.root.scale.setScalar(scale);
                    this.root.position.set(pos.x, pos.y, pos.z);
                    this.root.rotation.set(rot.x, rot.y, rot.z);

                    this.root.traverse(child => {
                        if (child.isMesh) {
                            child.receiveShadow  = true;
                            child.castShadow     = true;
                            child.frustumCulled  = true;
                            this.collisionMeshes.push(child);
                        }
                    });

                    this.scene.add(this.root);
                    this.isLoaded = true;
                    resolve(this.root);
                },
                xhr => { if (onProgress && xhr.total > 0) onProgress(Math.round(xhr.loaded / xhr.total * 100)); },
                err => { console.error('[MapLoader] Failed:', url, err); reject(err); }
            );
        });
    }

    getGroundY(worldX, worldZ) {
        if (!this.isLoaded) return 0;
        const ray  = new THREE.Raycaster(new THREE.Vector3(worldX, 200, worldZ), new THREE.Vector3(0, -1, 0));
        const hits = ray.intersectObjects(this.collisionMeshes, false);
        return hits.length ? hits[0].point.y : 0;
    }

    dispose() {
        if (!this.root) return;
        this.scene.remove(this.root);
        this.root.traverse(child => {
            if (!child.isMesh) return;
            child.geometry.dispose();
            (Array.isArray(child.material) ? child.material : [child.material]).forEach(m => m.dispose());
        });
        this.root = null;
        this.collisionMeshes = [];
        this.isLoaded = false;
    }
}

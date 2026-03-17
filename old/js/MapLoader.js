import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * MapLoader
 * Loads a GLB map file into the scene.
 * Exposes collision meshes for future physics/raycasting.
 */
export class MapLoader {
    constructor(scene) {
        this.scene = scene;
        this.root = null;
        this.collisionMeshes = [];
        this.isLoaded = false;
    }

    /**
     * @param {string} url  Path to the .glb file
     * @param {object} opts
     *   scale   {number}           default 1
     *   pos     {x,y,z}            default 0,0,0
     *   rot     {x,y,z} radians    default 0,0,0
     *   onProgress (pct) => void
     * @returns {Promise<THREE.Group>}
     */
    load(url, opts = {}) {
        const {
            scale    = 1,
            pos      = { x: 0, y: 0, z: 0 },
            rot      = { x: 0, y: 0, z: 0 },
            onProgress = null,
        } = opts;

        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();

            loader.load(
                url,
                (gltf) => {
                    this.root = gltf.scene;
                    this.root.scale.setScalar(scale);
                    this.root.position.set(pos.x, pos.y, pos.z);
                    this.root.rotation.set(rot.x, rot.y, rot.z);

                    this.root.traverse(child => {
                        if (child.isMesh) {
                            child.receiveShadow = true;
                            child.castShadow = true;
                            child.frustumCulled = true;
                            this.collisionMeshes.push(child);
                        }
                    });

                    this.scene.add(this.root);
                    this.isLoaded = true;
                    resolve(this.root);
                },
                (xhr) => {
                    if (onProgress && xhr.total > 0) {
                        onProgress(Math.round(xhr.loaded / xhr.total * 100));
                    }
                },
                (err) => {
                    console.error('[MapLoader] Failed to load:', url, err);
                    reject(err);
                }
            );
        });
    }

    /** Simple raycaster-based ground height query. */
    getGroundY(worldX, worldZ) {
        if (!this.isLoaded) return 0;
        const ray = new THREE.Raycaster(
            new THREE.Vector3(worldX, 200, worldZ),
            new THREE.Vector3(0, -1, 0)
        );
        const hits = ray.intersectObjects(this.collisionMeshes, false);
        return hits.length > 0 ? hits[0].point.y : 0;
    }

    dispose() {
        if (this.root) {
            this.scene.remove(this.root);
            this.root.traverse(child => {
                if (child.isMesh) {
                    child.geometry.dispose();
                    if (Array.isArray(child.material))
                        child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
            this.root = null;
            this.collisionMeshes = [];
            this.isLoaded = false;
        }
    }
}

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './Config.js';
import { HealthComponent } from './Systems.js';

export class Character {
    constructor(scene, modelUrl, initTunerCallback) {
        this.mesh = new THREE.Group();
        scene.add(this.mesh);

        this.cameraPivot = new THREE.Group();
        this.cameraPivot.position.set(0, 10, 0);
        this.mesh.add(this.cameraPivot);

        this.health = new HealthComponent(100, 'player-health-bar');
        this.boundingBox = new THREE.Box3(); 

        this.baseWalkSpeed = 15;
        this.runSpeedMultiplier = 2.2;
        this.lastFired = 0;
        this.fireRate = 0.15;
        this.lastStepTime = 0;
        this.stepRate = 0.45;
        this.isJumping = false;
        this.yVelocity = 0;
        this.gravity = 75;
        this.jumpStrength = 30;

        this.mixer = null;
        this.actions = {};          
        this.activeAction = null;
        this.manualAnimation = false;
        this.slots = { idle: null, walk: null, shoot: null };

        const loader = new GLTFLoader();
        loader.load(modelUrl, (gltf) => {
            const model = gltf.scene;
            model.scale.set(10, 10, 10);
            model.rotation.y = Math.PI;

            model.traverse((child) => {
                if (child.isMesh) {
                    child.frustumCulled = false; 
                    child.castShadow = true;
                }
            });

            this.mesh.add(model);
            this.mixer = new THREE.AnimationMixer(model);

            const rightHand = model.getObjectByName('bip_hand_R');
            if (rightHand) {
                const weaponLoader = new GLTFLoader();
                weaponLoader.load('models/battle_rifle.glb', (weaponGltf) => {
                    this.rifle = weaponGltf.scene;
                    this.rifle.scale.set(CONFIG.RIFLE_SCALE, CONFIG.RIFLE_SCALE, CONFIG.RIFLE_SCALE);
                    this.rifle.position.set(...CONFIG.RIFLE_POS);
                    this.rifle.rotation.set(...CONFIG.RIFLE_ROT);
                    rightHand.add(this.rifle);
                    if(initTunerCallback) initTunerCallback(this.rifle);
                });
            }

            gltf.animations.forEach(clip => {
                const safeName = clip.name.toLowerCase();
                this.actions[safeName] = this.mixer.clipAction(clip);

                if (safeName.includes('shoot')) {
                    const maskedClip = clip.clone();
                    maskedClip.name = safeName + '_upperbody';
                    maskedClip.tracks = maskedClip.tracks.filter(track => {
                        const tName = track.name.toLowerCase();
                        return tName.includes('spine') || tName.includes('chest') || tName.includes('arm') || tName.includes('hand');
                    });
                    this.actions[maskedClip.name] = this.mixer.clipAction(maskedClip);
                    this.actions[maskedClip.name].setEffectiveWeight(0).play();
                }
            });

            // Auto-assign slots
            const animNames = Object.keys(this.actions);
            this.slots.idle = animNames.find(n => n.includes('idle')) || animNames[0];
            this.slots.walk = animNames.find(n => n.includes('walk')) || animNames[0];
            this.slots.shoot = animNames.find(n => n.includes('shoot'));

            this.buildAnimMenu(animNames);
            this.playAction(this.slots.idle);
        });
    }

    playAction(name) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset().setEffectiveWeight(1).play();
        if (this.activeAction) this.activeAction.crossFadeTo(next, 0.2, true);
        this.activeAction = next;
    }

    
    buildAnimMenu(names) {
        const menu = document.getElementById('animation-menu');
        const slotRows = document.getElementById('slot-rows');
        const btnContainer = document.getElementById('animation-buttons');
        if (!menu || !slotRows || !btnContainer) return;

        menu.style.display = 'block';
        const slotLabels = { idle: 'Idle', walk: 'Walk/Run', shoot: 'Shoot' };
        for (const [slot, label] of Object.entries(slotLabels)) {
            const row = document.createElement('div');
            row.className = 'slot-row';
            const lbl = document.createElement('span');
            lbl.className = 'slot-label';
            lbl.textContent = label + ':';
            const sel = document.createElement('select');
            sel.innerHTML = '<option value="">-- none --</option>';
            names.forEach(n => {
                if (n.includes('_upperbody')) return; 
                const opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                if (n === this.slots[slot]) opt.selected = true;
                sel.appendChild(opt);
            });
            sel.onchange = () => { this.slots[slot] = sel.value || null; };
            row.appendChild(lbl); row.appendChild(sel); slotRows.appendChild(row);
        }
        names.forEach(name => {
            if (name.includes('_upperbody')) return; 
            const btn = document.createElement('button');
            btn.textContent = name;
            btn.onclick = () => {
                this.manualAnimation = true;
                this.fadeToAction(name, 0.3);
            };
            btnContainer.appendChild(btn);
        });
    }

    fadeToAction(name, duration = 0.2) {
        const next = this.actions[name];
        if (!next || this.activeAction === next) return;
        next.reset();
        next.setEffectiveTimeScale(1);
        next.setEffectiveWeight(1);
        next.play();
        if (this.activeAction) {
            this.activeAction.crossFadeTo(next, duration, true);
        }
        this.activeAction = next;
    }

    resolveSlot(primary, ...fallbacks) {
        const candidates = [primary, ...fallbacks, this.slots.idle];
        for (const name of candidates) {
            if (name && this.actions[name]) return name;
        }
        const keys = Object.keys(this.actions);
        return keys.length > 0 ? keys[0] : null;
    }

    update(dt, clock, inputManager, audioManager, beamPool) {
        let isMoving = false;
        
        const input = inputManager.keys;
        const forward  = input['KeyW'];
        const backward = input['KeyS'];
        const left     = input['KeyA'];
        const right    = input['KeyD'];
        const sprint   = input['ShiftLeft'] || input['ShiftRight'];
        const jump     = input['Space'];

        const isSprinting = forward && sprint;
        const currentSpeed = isSprinting ? this.baseWalkSpeed * this.runSpeedMultiplier : this.baseWalkSpeed;
        if (this.boundingBox) {
            const center = this.mesh.position.clone();
            center.y += 1; // Move center up to chest height
            const size = new THREE.Vector3(6, 12, 6); // Width, Height, Depth
            this.boundingBox.setFromCenterAndSize(center, size);
        }
        if (forward)  { this.mesh.translateZ(-currentSpeed * dt); isMoving = true; }
        if (backward) { this.mesh.translateZ( this.baseWalkSpeed * dt); isMoving = true; }
        if (left)     { this.mesh.translateX(-this.baseWalkSpeed * dt); isMoving = true; }
        if (right)    { this.mesh.translateX( this.baseWalkSpeed * dt); isMoving = true; }

        this.mesh.rotation.y = inputManager.mouseLookX;
        this.cameraPivot.rotation.x = inputManager.mouseLookY;

        if (jump && !this.isJumping && !inputManager.isNoclip) {
            this.isJumping = true;
            this.yVelocity = this.jumpStrength;
        }

        if (this.isJumping) {
            this.yVelocity -= this.gravity * dt;
            this.mesh.position.y += this.yVelocity * dt;
            if (this.mesh.position.y <= 0) {
                this.mesh.position.y = 0;
                this.isJumping = false;
                this.yVelocity = 0;
            }
        }

        if (inputManager.isShooting && !inputManager.isNoclip) {
            audioManager.playGunfire();
        } else {
            audioManager.stopGunfire();
        }

        const currentStepRate = isSprinting ? this.stepRate * 0.6 : this.stepRate;
        if (isMoving && !this.isJumping && !inputManager.isNoclip) {
            if (clock.elapsedTime - this.lastStepTime > currentStepRate) {
                this.lastStepTime = clock.elapsedTime;
                audioManager.playFootstep();
            }
        }

        if (isMoving || inputManager.isShooting || this.isJumping) this.manualAnimation = false;

        if (!this.manualAnimation && this.mixer) {
            let targetAnim = null;
            
            if (this.isJumping) {
                if (isSprinting || forward) {
                    targetAnim = this.actions['run_forward_jump'] ? 'run_forward_jump' : 'stationary_jump';
                } else {
                    targetAnim = this.actions['stationary_jump'] ? 'stationary_jump' : 'run_forward_jump';
                }
            } else if (isMoving) {
                if (forward) {
                    if (isSprinting) {
                        if (inputManager.isShooting && this.actions['run_forward_firing']) {
                            targetAnim = 'run_forward_firing';
                        } else if (this.actions['run_forward']) {
                            targetAnim = 'run_forward';
                        }
                    }
                    if (!targetAnim) {
                        if (left) targetAnim = 'walk_forward_left';
                        else if (right) targetAnim = 'walk_forward_right';
                        else targetAnim = 'walk_forward';
                    }
                }
                else if (backward) {
                    if (left) targetAnim = 'walk_backward_left';
                    else if (right) targetAnim = 'walk_backward_right';
                    else targetAnim = 'walk_backward_right';
                }
                else if (left && !forward && !backward) targetAnim = 'walk_forward_left';
                else if (right && !forward && !backward) targetAnim = 'walk_forward_right';
                
                if (!this.actions[targetAnim]) targetAnim = this.resolveSlot(this.slots.walk);
            }
            else {
                if (inputManager.isShooting && this.slots.shoot) {
                    targetAnim = this.slots.shoot; 
                } else {
                    targetAnim = this.resolveSlot(this.slots.idle);
                }
            }
            if (targetAnim) this.fadeToAction(targetAnim, 0.2);
        }

        const upperShootName = this.slots.shoot ? this.slots.shoot + '_upperbody' : null;
        if (upperShootName && this.actions[upperShootName] && !this.manualAnimation) {
            const upperShootAction = this.actions[upperShootName];
            const isFullBodyFiring = (this.activeAction && this.activeAction.getClip().name.toLowerCase() === 'run_forward_firing');
            let targetWeight = (inputManager.isShooting && isMoving && !isFullBodyFiring && !this.isJumping) ? 1 : 0;
            let currentWeight = upperShootAction.getEffectiveWeight();
            let newWeight = THREE.MathUtils.lerp(currentWeight, targetWeight, 0.15);
            upperShootAction.setEffectiveWeight(newWeight);
        }

        if (this.mixer) this.mixer.update(dt);

        if (inputManager.isShooting && clock.elapsedTime - this.lastFired > this.fireRate) {
            this.lastFired = clock.elapsedTime;
            let spawnPos = new THREE.Vector3();
            
            if (this.rifle) {
                const barrelOffset = new THREE.Vector3(0, 0, -5);
                spawnPos = this.rifle.localToWorld(barrelOffset);
            } else {
                const fallbackOffset = new THREE.Vector3(1.5, 0, -2);
                spawnPos = this.cameraPivot.localToWorld(fallbackOffset);
            }
            
        // Get the absolute world direction the camera is facing
            const aimDir = new THREE.Vector3();
            this.cameraPivot.getWorldDirection(aimDir); 
            aimDir.negate(); // <-- THIS FLIPS IT FORWARD!

            // Fire using the new vector math!
            beamPool.fire(spawnPos, aimDir, false);
        }
    }
}
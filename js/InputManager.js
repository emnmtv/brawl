import * as THREE from 'three';

export class InputManager {
    constructor(camera, audioManager) {
        this.camera = camera; this.audioManager = audioManager;
        this.keys = {}; this.isShooting = false; this.isLocked = false; this.isNoclip = false;
        this.mouseLookX = 0; this.mouseLookY = 0;
        this.freecamYaw = 0; this.freecamPitch = 0;
        
        this.activeWeapon = 'gun';
        this.ultimateQueue = null;

        this.initListeners();
    }

    initListeners() {
        window.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            if (e.code === 'KeyV') this.toggleNoclip();
            if (e.code === 'Digit1') this.activeWeapon = 'gun';
            if (e.code === 'Digit2') this.activeWeapon = 'melee';
            
            if (this.activeWeapon === 'melee' && !this.ultimateQueue) {
                if (e.code === 'KeyQ') this.ultimateQueue = 'melee_combo_1';
                if (e.code === 'KeyE') this.ultimateQueue = 'melee_combo_2';
                if (e.code === 'KeyR') this.ultimateQueue = 'melee_kick';
            }
        });
        
        window.addEventListener('keyup', e => this.keys[e.code] = false);

        document.body.addEventListener('click', (e) => {
            if(e.target.closest('#dev-tuner') || !document.getElementById('ui-layer').style.display) return;
            this.audioManager.resumeContext();
            document.body.requestPointerLock().catch(err => console.warn('Pointer lock denied:', err.message));
        });

        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === document.body;
            document.getElementById('lock-hint').style.display = this.isLocked ? 'none' : 'block';
        });

        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mousedown', (e) => { if (e.button === 0 && this.isLocked) this.isShooting = true; });
        document.addEventListener('mouseup',   (e) => { if (e.button === 0) this.isShooting = false; });
    }

    handleMouseMove(e) {
        if (!this.isLocked) return;
        if (this.isNoclip) {
            this.freecamYaw -= e.movementX * 0.002;
            this.freecamPitch -= e.movementY * 0.002;
            this.freecamPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.freecamPitch));
        } else {
            this.mouseLookX -= e.movementX * 0.002;
            this.mouseLookY += e.movementY * 0.002;   // raw: spring arm inverts on its end
            // PI/2.2 gives ~81° vertical range; spring arm in main.js prevents geometry clip
            this.mouseLookY = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.mouseLookY));
        }
    }

    toggleNoclip() {
        this.isNoclip = !this.isNoclip;
        document.getElementById('noclip-alert').style.display = this.isNoclip ? 'block' : 'none';
        document.getElementById('dev-tuner').style.display = this.isNoclip ? 'block' : 'none';
        if (this.isNoclip) {
            this.audioManager.stopAll();
            const euler = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion);
            this.freecamYaw = euler.y; this.freecamPitch = euler.x;
        }
    }
}
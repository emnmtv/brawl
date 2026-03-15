import * as THREE from 'three';


// ... rest of the code
export class InputManager {
    constructor(camera, audioManager) {
        this.camera = camera;
        this.audioManager = audioManager;
        
        this.keys = {};
        this.mouseLookX = 0;
        this.mouseLookY = 0;
        this.isShooting = false;
        this.isLocked = false;
        this.isNoclip = false;
        this.freecamYaw = 0;
        this.freecamPitch = 0;

        this.initListeners();
    }

    initListeners() {
        window.addEventListener('keydown', e => {
            this.keys[e.code] = true;
            if (e.code === 'KeyV') this.toggleNoclip();
        });
        
        window.addEventListener('keyup', e => this.keys[e.code] = false);

        document.body.addEventListener('click', (e) => {
            if(e.target.closest('#rifle-tuner') || e.target.closest('#animation-menu')) return;
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
            this.mouseLookY -= e.movementY * 0.002;
            this.mouseLookY = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this.mouseLookY));
        }
    }

    toggleNoclip() {
        this.isNoclip = !this.isNoclip;
        document.getElementById('noclip-alert').style.display = this.isNoclip ? 'block' : 'none';
        document.getElementById('rifle-tuner').style.display = this.isNoclip ? 'block' : 'none';
        
        if (this.isNoclip) {
            this.audioManager.stopAll();
            const euler = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion);
            this.freecamYaw = euler.y;
            this.freecamPitch = euler.x;
        }
    }
}
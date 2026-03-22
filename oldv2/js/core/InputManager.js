/**
 * InputManager.js — Captures keyboard, mouse, and pointer-lock state.
 *
 * Stores raw input state only. No game logic here.
 * Other systems read .keys, .isShooting, .activeWeapon, etc. each frame.
 */
import * as THREE from 'three';

export class InputManager {
    constructor(camera, audioManager) {
        this.camera       = camera;
        this.audioManager = audioManager;

        // Raw key state
        this.keys = {};

        // Mouse look (radians)
        this.mouseLookX = 0;   // yaw   (horizontal)
        this.mouseLookY = 0;   // pitch (vertical, clamped)

        // Pointer lock
        this.isLocked = false;

        // Combat flags
        this.isShooting  = false;
        this.isBlocking  = false;

        // Weapon selection
        this.activeWeapon  = 'gun';
        this.ultimateQueue = null;

        // Noclip / free-cam
        this.isNoclip    = false;
        this.freecamYaw   = 0;
        this.freecamPitch = 0;

        // Aim direction — set by the spring camera each frame and read by Weapons
        this.aimDir = null;

        this._initListeners();
    }

    _initListeners() {
        // ── Keyboard ───────────────────────────────────────────────
        window.addEventListener('keydown', e => {
            this.keys[e.code] = true;

            if (e.code === 'KeyV') this._toggleNoclip();
            if (e.code === 'Digit1') this.activeWeapon = 'gun';
            if (e.code === 'Digit2') this.activeWeapon = 'melee';

            if (this.activeWeapon === 'melee' && !this.ultimateQueue) {
                if (e.code === 'KeyQ') this.ultimateQueue = 'melee_combo_1';
                if (e.code === 'KeyE') this.ultimateQueue = 'melee_combo_2';
                if (e.code === 'KeyR') this.ultimateQueue = 'melee_kick';
            }
        });

        window.addEventListener('keyup', e => { this.keys[e.code] = false; });

        // ── Click (resume audio context) ──────────────────────────
        document.body.addEventListener('click', () => {
            this.audioManager.resumeContext();
        });

        // ── Pointer lock ──────────────────────────────────────────
        document.addEventListener('pointerlockchange', () => {
            this.isLocked = document.pointerLockElement === document.body;
            const hint = document.getElementById('lock-hint');
            if (hint) hint.style.display = this.isLocked ? 'none' : 'block';
        });

        // ── Mouse look ────────────────────────────────────────────
        document.addEventListener('mousemove', e => this._handleMouseMove(e));

        // ── Mouse buttons ─────────────────────────────────────────
        document.addEventListener('mousedown', e => {
            if (e.button === 0 && this.isLocked) this.isShooting = true;
            if (e.button === 2 && this.isLocked) { this.isBlocking = true; e.preventDefault(); }
        });
        document.addEventListener('mouseup', e => {
            if (e.button === 0) this.isShooting = false;
            if (e.button === 2) this.isBlocking = false;
        });
        document.addEventListener('contextmenu', e => { if (this.isLocked) e.preventDefault(); });

        // ── ESC exits pointer lock ────────────────────────────────
        window.addEventListener('keydown', e => {
            if (e.key === 'Escape' && document.pointerLockElement === document.body)
                document.exitPointerLock();
        });
    }

    _handleMouseMove(e) {
        if (!this.isLocked) return;
        if (this.isNoclip) {
            this.freecamYaw   -= e.movementX * 0.002;
            this.freecamPitch -= e.movementY * 0.002;
            this.freecamPitch  = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.freecamPitch));
        } else {
            this.mouseLookX -= e.movementX * 0.002;
            this.mouseLookY += e.movementY * 0.002;
            this.mouseLookY  = Math.max(-Math.PI / 2.2, Math.min(Math.PI / 2.2, this.mouseLookY));
        }
    }

    _toggleNoclip() {
        this.isNoclip = !this.isNoclip;
        const alert  = document.getElementById('noclip-alert');
        const tuner  = document.getElementById('dev-tuner');
        if (alert) alert.style.display = this.isNoclip ? 'block' : 'none';
        if (tuner) tuner.style.display = this.isNoclip ? 'block' : 'none';

        if (this.isNoclip) {
            this.audioManager.stopAll();
            const euler = new THREE.Euler(0, 0, 0, 'YXZ').setFromQuaternion(this.camera.quaternion);
            this.freecamYaw   = euler.y;
            this.freecamPitch = euler.x;
        }
    }

    /** Request pointer lock; shows an error banner if denied. */
    requestPointerLock() {
        if (document.pointerLockElement === document.body) return;
        try {
            const p = document.body.requestPointerLock();
            p?.catch?.(err => this._showPointerLockError(err));
        } catch (err) {
            this._showPointerLockError(err);
        }
    }

    _showPointerLockError(err) {
        let el = document.getElementById('pointerlock-error');
        if (!el) {
            el = document.createElement('div');
            el.id = 'pointerlock-error';
            Object.assign(el.style, {
                position: 'fixed', top: '20px', left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(200,0,0,0.9)', color: '#fff',
                padding: '10px 24px', borderRadius: '8px',
                zIndex: 9999, fontSize: '1.1em',
            });
            document.body.appendChild(el);
        }
        el.textContent = err?.message || String(err) || 'Pointer lock failed.';
        el.style.display = 'block';
        setTimeout(() => { el.style.display = 'none'; }, 3000);
    }
}

/**
 * AudioManager.js — Owns and plays all in-game audio.
 *
 * Manages: gunfire loop, footstep snippet, and melee swoosh.
 * Call resumeContext() once on the first user gesture.
 */
import * as THREE from 'three';
import { AUDIO_DEFAULTS } from '../data/WeaponDefaults.js';

export class AudioManager {
    constructor(camera) {
        this.listener   = new THREE.AudioListener();
        camera.add(this.listener);

        this._loader   = new THREE.AudioLoader();
        this._gun      = new THREE.Audio(this.listener);
        this._step     = new THREE.Audio(this.listener);
        this._melee    = new THREE.Audio(this.listener);
        this._stepTimer = null;

        this._loadSounds();
    }

    _loadSounds() {
        this._loader.load('sound_effects/gun_fire.mp3',  b => { this._gun.setBuffer(b);   this._gun.setVolume(0.4);   });
        this._loader.load('sound_effects/robot_step.mp3',b => { this._step.setBuffer(b);  this._step.setVolume(0.2);  });
        this._loader.load('sound_effects/swoosh.mp3',    b => { this._melee.setBuffer(b); this._melee.setVolume(0.6); });
    }

    resumeContext() {
        if (this.listener.context.state === 'suspended')
            this.listener.context.resume();
    }

    playGunfire() {
        if (!this._gun.isPlaying) {
            this._gun.offset = AUDIO_DEFAULTS.GUN_START;
            this._gun.setLoop(true);
            this._gun.play();
        }
    }

    stopGunfire() {
        try {
            if (this._gun.source)   this._gun.stop();
            else if (this._gun.isPlaying) this._gun.stop();
        } catch (_) {}
        this._gun.isPlaying = false;
    }

    playMeleeSwoosh() {
        if (!this._melee.buffer) return;
        if (this._melee.isPlaying) this._melee.stop();
        this._melee.play();
    }

    playFootstep() {
        if (this._step.isPlaying) this._step.stop();
        this._step.offset = AUDIO_DEFAULTS.STEP_START;
        this._step.play();
        clearTimeout(this._stepTimer);
        this._stepTimer = setTimeout(() => {
            if (this._step.isPlaying) this._step.stop();
        }, AUDIO_DEFAULTS.STEP_SNIPPET * 1000);
    }

    stopAll() {
        this.stopGunfire();
        try { if (this._step.isPlaying)  this._step.stop();  } catch (_) {}
        try { if (this._melee.isPlaying) this._melee.stop(); } catch (_) {}
        clearTimeout(this._stepTimer);
    }
}

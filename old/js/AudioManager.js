import * as THREE from 'three';
import { CONFIG } from './Config.js';

export class AudioManager {
    constructor(camera) {
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);
        this.audioLoader = new THREE.AudioLoader();

        this.gunSound = new THREE.Audio(this.listener);
        this.stepSound = new THREE.Audio(this.listener);
        this.meleeSound = new THREE.Audio(this.listener); // Added melee

        this.loadSounds();
    }

    loadSounds() {
        this.audioLoader.load('sound_effects/gun_fire.mp3', (b) => { this.gunSound.setBuffer(b); this.gunSound.setVolume(0.4); });
        this.audioLoader.load('sound_effects/robot_step.mp3', (b) => { this.stepSound.setBuffer(b); this.stepSound.setVolume(0.2); });
        
        // Load a swoosh sound for lightsaber (or use procedural if preferred)
        this.audioLoader.load('sound_effects/swoosh.mp3', (b) => { this.meleeSound.setBuffer(b); this.meleeSound.setVolume(0.6); });
    }

    resumeContext() { if (this.listener.context.state === 'suspended') this.listener.context.resume(); }

    playGunfire() { if (!this.gunSound.isPlaying) { this.gunSound.offset = CONFIG.AUDIO.GUN_START; this.gunSound.setLoop(true); this.gunSound.play(); } }
    stopGunfire() {
        // Force-stop even if Three.js isPlaying flag is stale
        try { if (this.gunSound.source) { this.gunSound.stop(); } else if (this.gunSound.isPlaying) { this.gunSound.stop(); } } catch(_) {}
        this.gunSound.isPlaying = false;
    }

    playMeleeSwoosh() { if (this.meleeSound.buffer) { if (this.meleeSound.isPlaying) this.meleeSound.stop(); this.meleeSound.play(); } }

    playFootstep() {
        if (this.stepSound.isPlaying) this.stepSound.stop();
        this.stepSound.offset = CONFIG.AUDIO.STEP_START; this.stepSound.play();
        clearTimeout(this.stepSound.stopTimer); 
        this.stepSound.stopTimer = setTimeout(() => { if (this.stepSound.isPlaying) this.stepSound.stop(); }, CONFIG.AUDIO.STEP_SNIPPET * 1000);
    }

    stopAll() {
        this.stopGunfire();
        try { if (this.stepSound.isPlaying) this.stepSound.stop(); } catch(_) {}
        clearTimeout(this.stepSound.stopTimer);
        try { if (this.meleeSound.isPlaying) this.meleeSound.stop(); } catch(_) {}
    }
}
import * as THREE from 'three';
import { CONFIG } from './Config.js';

export class AudioManager {
// ... rest of the code
    constructor(camera) {
        this.listener = new THREE.AudioListener();
        camera.add(this.listener);
        this.audioLoader = new THREE.AudioLoader();

        this.gunSound = new THREE.Audio(this.listener);
        this.stepSound = new THREE.Audio(this.listener);

        this.loadSounds();
    }

    loadSounds() {
        this.audioLoader.load('sound_effects/gun_fire.mp3', (buffer) => {
            this.gunSound.setBuffer(buffer);
            this.gunSound.setVolume(0.4);
        });
        this.audioLoader.load('sound_effects/robot_step.mp3', (buffer) => {
            this.stepSound.setBuffer(buffer);
            this.stepSound.setVolume(0.2);
        });
    }

    resumeContext() {
        if (this.listener.context.state === 'suspended') {
            this.listener.context.resume();
        }
    }

    playGunfire() {
        if (!this.gunSound.isPlaying) {
            this.gunSound.offset = CONFIG.AUDIO.GUN_START;
            this.gunSound.setLoop(true); 
            this.gunSound.play();
        }
    }

    stopGunfire() {
        if (this.gunSound.isPlaying) this.gunSound.stop();
    }

    playFootstep() {
        if (this.stepSound.isPlaying) this.stepSound.stop();
        this.stepSound.offset = CONFIG.AUDIO.STEP_START;
        this.stepSound.play();
        
        clearTimeout(this.stepSound.stopTimer); 
        this.stepSound.stopTimer = setTimeout(() => {
            if (this.stepSound.isPlaying) this.stepSound.stop();
        }, CONFIG.AUDIO.STEP_SNIPPET * 1000);
    }

    stopAll() {
        this.stopGunfire();
        if (this.stepSound.isPlaying) this.stepSound.stop();
        clearTimeout(this.stepSound.stopTimer);
    }
}
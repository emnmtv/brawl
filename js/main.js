import * as THREE from 'three';
import { CONFIG } from './Config.js';
import { InputManager } from './InputManager.js';
import { AudioManager } from './AudioManager.js';
import { BeamPool, Enemy } from './Systems.js';
import { Character } from './Character.js';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x111111, 20, 200);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.rotation.order = 'YXZ'; 

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
scene.add(ambientLight);
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(50, 100, 50);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(400, 200, 0x00ffcc, 0x333333);
scene.add(gridHelper);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

// Initialize Subsystems
const audioManager = new AudioManager(camera);
const inputManager = new InputManager(camera, audioManager);
const beamPool = new BeamPool(scene);
// Change this:
// const enemy = new Enemy(scene, 0, -40);

// To this:
const enemy = new Enemy(scene, 0, -100, 'models/t800.glb');

// Tuner Logic
// --- Tuner Logic ---
const tuners = ['scale', 'px', 'py', 'pz', 'rx', 'ry', 'rz'];

function initTuner(rifleObj) {
    document.getElementById('tune-scale').value = CONFIG.RIFLE_SCALE;
    document.getElementById('tune-scale-num').value = CONFIG.RIFLE_SCALE;
    document.getElementById('tune-px').value = CONFIG.RIFLE_POS[0];
    document.getElementById('tune-px-num').value = CONFIG.RIFLE_POS[0];
    document.getElementById('tune-py').value = CONFIG.RIFLE_POS[1];
    document.getElementById('tune-py-num').value = CONFIG.RIFLE_POS[1];
    document.getElementById('tune-pz').value = CONFIG.RIFLE_POS[2];
    document.getElementById('tune-pz-num').value = CONFIG.RIFLE_POS[2];
    document.getElementById('tune-rx').value = CONFIG.RIFLE_ROT[0] * (180 / Math.PI);
    document.getElementById('tune-rx-num').value = CONFIG.RIFLE_ROT[0] * (180 / Math.PI);
    document.getElementById('tune-ry').value = CONFIG.RIFLE_ROT[1] * (180 / Math.PI);
    document.getElementById('tune-ry-num').value = CONFIG.RIFLE_ROT[1] * (180 / Math.PI);
    document.getElementById('tune-rz').value = CONFIG.RIFLE_ROT[2] * (180 / Math.PI);
    document.getElementById('tune-rz-num').value = CONFIG.RIFLE_ROT[2] * (180 / Math.PI);
    
    generateTunerCode();

    tuners.forEach(id => {
        const slider = document.getElementById('tune-' + id);
        const numBox = document.getElementById('tune-' + id + '-num');
        slider.addEventListener('input', (e) => { numBox.value = e.target.value; applyTunerToRifle(rifleObj); });
        numBox.addEventListener('input', (e) => { slider.value = e.target.value; applyTunerToRifle(rifleObj); });
    });
}

function applyTunerToRifle(rifleObj) {
    if (!rifleObj) return;
    const s = parseFloat(document.getElementById('tune-scale').value);
    const px = parseFloat(document.getElementById('tune-px').value);
    const py = parseFloat(document.getElementById('tune-py').value);
    const pz = parseFloat(document.getElementById('tune-pz').value);
    const rxD = parseFloat(document.getElementById('tune-rx').value);
    const ryD = parseFloat(document.getElementById('tune-ry').value);
    const rzD = parseFloat(document.getElementById('tune-rz').value);
    
    const rx = rxD * (Math.PI / 180);
    const ry = ryD * (Math.PI / 180);
    const rz = rzD * (Math.PI / 180);
    
    rifleObj.scale.set(s, s, s);
    rifleObj.position.set(px, py, pz);
    rifleObj.rotation.set(rx, ry, rz);
    
    generateTunerCode(s, px, py, pz, rx, ry, rz);
}

function generateTunerCode(
    s = CONFIG.RIFLE_SCALE, 
    px = CONFIG.RIFLE_POS[0], 
    py = CONFIG.RIFLE_POS[1], 
    pz = CONFIG.RIFLE_POS[2], 
    rx = CONFIG.RIFLE_ROT[0], 
    ry = CONFIG.RIFLE_ROT[1], 
    rz = CONFIG.RIFLE_ROT[2]
) {
    const codeBlock = document.getElementById('tuner-code');
    if (codeBlock) {
        codeBlock.innerText = 
`RIFLE_SCALE: ${s.toFixed(3)},
RIFLE_POS: [${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}],
RIFLE_ROT: [${rx.toFixed(3)}, ${ry.toFixed(3)}, ${rz.toFixed(3)}],`;
    }
}
// -----------------------

// Instantiate Player
const player = new Character(scene, 'models/t800.glb', initTuner);

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (inputManager.isNoclip) {
        camera.quaternion.setFromEuler(new THREE.Euler(inputManager.freecamPitch, inputManager.freecamYaw, 0, 'YXZ'));
        const freeSpeed = 30 * dt;
        if (inputManager.keys['KeyW']) camera.translateZ(-freeSpeed);
        if (inputManager.keys['KeyS']) camera.translateZ(freeSpeed);
        if (inputManager.keys['KeyA']) camera.translateX(-freeSpeed);
        if (inputManager.keys['KeyD']) camera.translateX(freeSpeed);
    } else {
        player.update(dt, clock, inputManager, audioManager, beamPool);
        
        const cameraOffset   = new THREE.Vector3(3, 2, 20);
        const desiredCamPos  = player.cameraPivot.localToWorld(cameraOffset);
        camera.position.lerp(desiredCamPos, 0.4);
        
// Inside your animate() function, change the bottom part to look like this:
        
        const lookAtTarget   = new THREE.Vector3(0, 0, -100);
        const lookAtPos      = player.cameraPivot.localToWorld(lookAtTarget);
        camera.lookAt(lookAtPos);
        
        // --- UPDATED METHOD CALLS ---
        beamPool.update(dt, [enemy], player); // Pass player so enemy beams can hit you
        enemy.update(dt, clock, player, beamPool); // Pass player so enemy knows who to chase
    }
    renderer.render(scene, camera);
}
animate();

// --- AI Toggle Logic ---
const aiToggleBtn = document.getElementById('toggle-ai-btn');
if (aiToggleBtn) {
    aiToggleBtn.addEventListener('click', (e) => {
        enemy.aiEnabled = !enemy.aiEnabled;
        aiToggleBtn.innerText = `AI: ${enemy.aiEnabled ? 'ON' : 'OFF'}`;
        aiToggleBtn.style.background = enemy.aiEnabled ? '#ffaa00' : '#444';
        aiToggleBtn.style.color = enemy.aiEnabled ? 'black' : 'white';
        e.target.blur(); // Drops focus so pressing spacebar doesn't accidentally click it again
    });
}

// --- Hitbox Toggle Logic ---
let showHitbox = false;
const hitboxBtn = document.getElementById('toggle-hitbox-btn');
if (hitboxBtn) {
    hitboxBtn.addEventListener('click', (e) => {
        showHitbox = !showHitbox;
        hitboxBtn.innerText = showHitbox ? 'Hide Hitbox' : 'View Hitbox';
        hitboxBtn.style.background = showHitbox ? '#00ffcc' : '#444';
        hitboxBtn.style.color = showHitbox ? 'black' : 'white';
        e.target.blur();
    });
}

// --- Hitbox Visualization ---
const playerBoxHelper = new THREE.Box3Helper(player.boundingBox, 0x00ffcc);
scene.add(playerBoxHelper);
enemy.boundingBox = new THREE.Box3();
const enemyBoxHelper = new THREE.Box3Helper(enemy.boundingBox, 0xff3300);
scene.add(enemyBoxHelper);

// Update hitbox helpers each frame
const oldAnimate = animate;
function animateWithHitbox() {
    requestAnimationFrame(animateWithHitbox);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (inputManager.isNoclip) {
        camera.quaternion.setFromEuler(new THREE.Euler(inputManager.freecamPitch, inputManager.freecamYaw, 0, 'YXZ'));
        const freeSpeed = 30 * dt;
        if (inputManager.keys['KeyW']) camera.translateZ(-freeSpeed);
        if (inputManager.keys['KeyS']) camera.translateZ(freeSpeed);
        if (inputManager.keys['KeyA']) camera.translateX(-freeSpeed);
        if (inputManager.keys['KeyD']) camera.translateX(freeSpeed);
    } else {
        player.update(dt, clock, inputManager, audioManager, beamPool);
        const cameraOffset   = new THREE.Vector3(3, 2, 20);
        const desiredCamPos  = player.cameraPivot.localToWorld(cameraOffset);
        camera.position.lerp(desiredCamPos, 0.4);
        const lookAtTarget   = new THREE.Vector3(0, 0, -100);
        const lookAtPos      = player.cameraPivot.localToWorld(lookAtTarget);
        camera.lookAt(lookAtPos);
        beamPool.update(dt, [enemy], player);
        enemy.update(dt, clock, player, beamPool);
    }

    // Update hitbox helpers
    player.boundingBox.setFromObject(player.mesh);
    playerBoxHelper.box.copy(player.boundingBox);
    playerBoxHelper.visible = showHitbox;

    enemy.boundingBox.setFromObject(enemy.mesh);
    enemyBoxHelper.box.copy(enemy.boundingBox);
    enemyBoxHelper.visible = showHitbox;

    renderer.render(scene, camera);
}
animateWithHitbox();





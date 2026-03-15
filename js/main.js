import * as THREE from 'three';
import { CONFIG }          from './Config.js';
import { InputManager }    from './InputManager.js';
import { AudioManager }    from './AudioManager.js';
import { BeamPool, Enemy } from './Systems.js';
import { Character }       from './Character.js';
import { MapLoader }       from './MapLoader.js';
import { NetworkManager }  from './Network.js';

// ═══════════════════════════════════════════════════
// THREE CORE SETUP
// ═══════════════════════════════════════════════════
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x111111, 40, 600);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// renderer.shadowMap.enabled = true;
// renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Lighting
// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(80, 160, 80);
scene.add(dirLight);

// Fallback grid (hidden once map loads)
const gridHelper = new THREE.GridHelper(1000, 200, 0x00ffcc, 0x222222);
scene.add(gridHelper);

// ═══════════════════════════════════════════════════
// SUBSYSTEMS
// ═══════════════════════════════════════════════════
const clock        = new THREE.Clock();
const audioManager = new AudioManager(camera);
const inputManager = new InputManager(camera, audioManager);
const beamPool     = new BeamPool(scene);

// ═══════════════════════════════════════════════════
// GAME STATE
// ═══════════════════════════════════════════════════
let gameMode    = null;
let player      = null;
let enemy       = null;
let network     = null;
let mapLoader   = null;
let isRunning   = false;

let playerBoxHelper = null;
let enemyBoxHelper  = null;
let showHitbox      = false;

// ═══════════════════════════════════════════════════
// MOBILE CONTROLS SETUP
// ═══════════════════════════════════════════════════
function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

function setupMobileControls() {
    const mobileControls = document.getElementById('mobile-controls');
    if (!mobileControls) return;
    if (isTouchDevice()) {
        mobileControls.style.display = 'block';
        // Move Left
        document.getElementById('btn-move-left').addEventListener('touchstart', () => inputManager.keys['KeyA'] = true);
        document.getElementById('btn-move-left').addEventListener('touchend',   () => inputManager.keys['KeyA'] = false);
        // Move Right
        document.getElementById('btn-move-right').addEventListener('touchstart', () => inputManager.keys['KeyD'] = true);
        document.getElementById('btn-move-right').addEventListener('touchend',   () => inputManager.keys['KeyD'] = false);
        // Jump
        document.getElementById('btn-jump').addEventListener('touchstart', () => inputManager.keys['Space'] = true);
        document.getElementById('btn-jump').addEventListener('touchend',   () => inputManager.keys['Space'] = false);
        // Shoot
        document.getElementById('btn-shoot').addEventListener('touchstart', () => inputManager.isShooting = true);
        document.getElementById('btn-shoot').addEventListener('touchend',   () => inputManager.isShooting = false);
    }
}

setupMobileControls();

// ═══════════════════════════════════════════════════
// MAP LOADER
// ═══════════════════════════════════════════════════
function loadMap(url, scale = 1, onDone = null) {
    mapLoader = new MapLoader(scene);
    setLoadingStatus('Loading map…');

    mapLoader.load(url, {
        scale,
        onProgress: (pct) => setLoadingStatus(`Loading map… ${pct}%`)
    }).then(() => {
        gridHelper.visible = false;
        setLoadingStatus('');
        if (onDone) onDone();
    }).catch(() => {
        setLoadingStatus('Map load failed — using grid');
        if (onDone) onDone();
    });
}

// ═══════════════════════════════════════════════════
// RIFLE TUNER
// ═══════════════════════════════════════════════════
const tunerIds = ['scale', 'px', 'py', 'pz', 'rx', 'ry', 'rz'];

function initTuner(rifleObj) {
    const setVal = (id, v) => {
        const el = document.getElementById('tune-' + id);
        const nm = document.getElementById('tune-' + id + '-num');
        if (el) el.value = v;
        if (nm) nm.value = v;
    };
    setVal('scale', CONFIG.RIFLE_SCALE);
    setVal('px', CONFIG.RIFLE_POS[0]);
    setVal('py', CONFIG.RIFLE_POS[1]);
    setVal('pz', CONFIG.RIFLE_POS[2]);
    setVal('rx', CONFIG.RIFLE_ROT[0] * (180 / Math.PI));
    setVal('ry', CONFIG.RIFLE_ROT[1] * (180 / Math.PI));
    setVal('rz', CONFIG.RIFLE_ROT[2] * (180 / Math.PI));
    generateTunerCode();

    tunerIds.forEach(id => {
        const slider = document.getElementById('tune-' + id);
        const numBox = document.getElementById('tune-' + id + '-num');
        if (!slider || !numBox) return;
        slider.addEventListener('input', e => { numBox.value = e.target.value; applyTuner(rifleObj); });
        numBox.addEventListener('input', e => { slider.value = e.target.value; applyTuner(rifleObj); });
    });
}

function applyTuner(rifleObj) {
    if (!rifleObj) return;
    const g  = id => parseFloat(document.getElementById('tune-' + id).value);
    const s  = g('scale');
    const px = g('px'), py = g('py'), pz = g('pz');
    const rx = g('rx') * Math.PI / 180;
    const ry = g('ry') * Math.PI / 180;
    const rz = g('rz') * Math.PI / 180;
    rifleObj.scale.set(s, s, s);
    rifleObj.position.set(px, py, pz);
    rifleObj.rotation.set(rx, ry, rz);
    generateTunerCode(s, px, py, pz, rx, ry, rz);
}

function generateTunerCode(
    s  = CONFIG.RIFLE_SCALE,
    px = CONFIG.RIFLE_POS[0], py = CONFIG.RIFLE_POS[1], pz = CONFIG.RIFLE_POS[2],
    rx = CONFIG.RIFLE_ROT[0], ry = CONFIG.RIFLE_ROT[1], rz = CONFIG.RIFLE_ROT[2]
) {
    const el = document.getElementById('tuner-code');
    if (el) el.innerText =
`RIFLE_SCALE: ${s.toFixed(3)},
RIFLE_POS: [${px.toFixed(2)}, ${py.toFixed(2)}, ${pz.toFixed(2)}],
RIFLE_ROT: [${rx.toFixed(3)}, ${ry.toFixed(3)}, ${rz.toFixed(3)}],`;
}

// ═══════════════════════════════════════════════════
// HITBOX HELPERS
// ═══════════════════════════════════════════════════
function initHitboxHelpers() {
    if (playerBoxHelper) scene.remove(playerBoxHelper);
    playerBoxHelper = new THREE.Box3Helper(player.boundingBox, 0x00ffcc);
    playerBoxHelper.visible = false;
    scene.add(playerBoxHelper);

    if (enemy && gameMode === 'dev') {
        if (enemyBoxHelper) scene.remove(enemyBoxHelper);
        enemyBoxHelper = new THREE.Box3Helper(enemy.boundingBox, 0xff3300);
        enemyBoxHelper.visible = false;
        scene.add(enemyBoxHelper);
    }
}

// ═══════════════════════════════════════════════════
// PVP BEAM HIT vs REMOTE PLAYERS
// ═══════════════════════════════════════════════════
function checkPvpHits() {
    if (!network) return;
    beamPool.pool.forEach(beam => {
        if (!beam.userData.active || beam.userData.isEnemy || beam.userData.isRemote) return;
        network.remotePlayers.forEach((rp, id) => {
            if (rp.isDead) return;
            if (rp.boundingBox.containsPoint(beam.position)) {
                network.reportHit(id, 20);
                beam.visible = false;
                beam.userData.active = false;
            }
        });
    });
}

// ═══════════════════════════════════════════════════
// START MODES
// ═══════════════════════════════════════════════════
function startDevMode() {
    gameMode = 'dev';
    hideMainMenu();
    document.getElementById('dev-hud').style.display = 'block';
    document.getElementById('pvp-hud').style.display = 'none';

    player = new Character(scene, 'models/t800.glb', initTuner);
    enemy  = new Enemy(scene, 0, -120, 'models/t800.glb');

    loadMap('maps/battle_guys.glb', 1, () => {
        player.mesh.position.set(0, 5, 60);
        enemy.mesh.position.set(0, 5, -60);
        // Give player wall collision meshes (called once)
        player.setCollisionMeshes(mapLoader.collisionMeshes);
        initHitboxHelpers();
        initDevButtons();
        startLoop();
    });
}

function startPvpMode(serverUrl, playerName) {
    gameMode = 'pvp';
    hideMainMenu();
    showConnectingOverlay(true, 'Connecting…');

    network = new NetworkManager(scene, serverUrl, playerName);

    network.connect().then((myId) => {
        showConnectingOverlay(false);
        document.getElementById('dev-hud').style.display = 'none';
        document.getElementById('pvp-hud').style.display = 'block';
        document.getElementById('pvp-id').textContent    = `ID: ${myId}`;

        // Give network access to beamPool and audio listener so remote
        // players fire visible beams and play positional gun sounds
        network.beamPool = beamPool;
        network.audioListener = audioManager.listener;

        network.onDamage = (amount) => {
            if (player) player.health.takeDamage(amount);
            if (player && player.health.isDead) network.reportDead();
        };
        network.onPlayerJoin  = (id) => showNetworkAlert(`Player ${id} joined`);
        network.onPlayerLeave = (id) => showNetworkAlert(`Player ${id} left`);

        player = new Character(scene, 'models/t800.glb', null);
        player.mesh.position.set(
            (Math.random() - 0.5) * 100, 5,
            (Math.random() - 0.5) * 100
        );

        loadMap('maps/battle_guys.glb', 1, () => {
            player.setCollisionMeshes(mapLoader.collisionMeshes);
            initHitboxHelpers();
            startLoop();
        });
    }).catch(err => {
        showConnectingOverlay(true, `❌ ${err.message}`);
    });
}

// ═══════════════════════════════════════════════════
// DEV BUTTONS
// ═══════════════════════════════════════════════════
function initDevButtons() {
    const aiBtn = document.getElementById('toggle-ai-btn');
    if (aiBtn) {
        aiBtn.addEventListener('click', (e) => {
            enemy.aiEnabled = !enemy.aiEnabled;
            aiBtn.innerText        = `AI: ${enemy.aiEnabled ? 'ON' : 'OFF'}`;
            aiBtn.style.background = enemy.aiEnabled ? '#ffaa00' : '#444';
            aiBtn.style.color      = enemy.aiEnabled ? 'black'   : 'white';
            e.target.blur();
        });
    }

    const hbBtn = document.getElementById('toggle-hitbox-btn');
    if (hbBtn) {
        hbBtn.addEventListener('click', (e) => {
            showHitbox             = !showHitbox;
            hbBtn.innerText        = showHitbox ? 'Hide Hitbox' : 'View Hitbox';
            hbBtn.style.background = showHitbox ? '#00ffcc' : '#444';
            hbBtn.style.color      = showHitbox ? 'black'   : 'white';
            e.target.blur();
        });
    }
}

// ═══════════════════════════════════════════════════
// SINGLE GAME LOOP
// ═══════════════════════════════════════════════════
function startLoop() {
    if (isRunning) return;
    isRunning = true;
    loop();
}

function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);

    // ── NOCLIP / FREE CAM ──
    if (inputManager.isNoclip) {
        camera.quaternion.setFromEuler(
            new THREE.Euler(inputManager.freecamPitch, inputManager.freecamYaw, 0, 'YXZ')
        );
        const speed = 50 * dt;
        if (inputManager.keys['KeyW']) camera.translateZ(-speed);
        if (inputManager.keys['KeyS']) camera.translateZ( speed);
        if (inputManager.keys['KeyA']) camera.translateX(-speed);
        if (inputManager.keys['KeyD']) camera.translateX( speed);
        renderer.render(scene, camera);
        return;
    }

    // ── PLAYER ──
    if (player) {
        // Snap to map surface BEFORE movement update
        if (mapLoader && mapLoader.isLoaded) {
            player.snapToGround(mapLoader.collisionMeshes);
        }

        player.update(dt, clock, inputManager, audioManager, beamPool);

        // Camera follow
        const offset  = new THREE.Vector3(3, 2, 20);
        const desired = player.cameraPivot.localToWorld(offset);
        camera.position.lerp(desired, 0.4);
        const lookAt  = player.cameraPivot.localToWorld(new THREE.Vector3(0, 0, -100));
        camera.lookAt(lookAt);

        // Bounding box
        if (player.boundingBox) {
            const c = player.mesh.position.clone();
            c.y += 6;
            player.boundingBox.setFromCenterAndSize(c, new THREE.Vector3(6, 12, 6));
        }
        if (playerBoxHelper) {
            playerBoxHelper.box.copy(player.boundingBox);
            playerBoxHelper.visible = showHitbox;
        }
    }

    // ── DEV MODE: AI ENEMY ──
    if (gameMode === 'dev' && enemy) {
        // Snap enemy to map surface (step-aware, no rooftop teleport)
        if (mapLoader && mapLoader.isLoaded) {
            const p = enemy.mesh.position;
            const STEP_UP = 2, STEP_DOWN = 8;
            const ray = new THREE.Raycaster(
                new THREE.Vector3(p.x, p.y + STEP_UP, p.z),
                new THREE.Vector3(0, -1, 0)
            );
            ray.far = STEP_UP + STEP_DOWN;
            const hits = ray.intersectObjects(mapLoader.collisionMeshes, false);
            if (hits.length > 0 && hits[0].point.y <= p.y + STEP_UP) {
                enemy.mesh.position.y = hits[0].point.y;
            }
        }

        enemy.update(dt, clock, player, beamPool);
        beamPool.update(dt, [enemy], player);

        if (enemy.boundingBox) {
            const c = enemy.mesh.position.clone();
            c.y += 6;
            enemy.boundingBox.setFromCenterAndSize(c, new THREE.Vector3(6, 12, 6));
        }
        if (enemyBoxHelper) {
            enemyBoxHelper.box.copy(enemy.boundingBox);
            enemyBoxHelper.visible = showHitbox;
        }
    }

    // ── PVP MODE ──
    if (gameMode === 'pvp' && network) {
        network.update(dt, player, inputManager);
        beamPool.update(dt, [], player);
        checkPvpHits();

        const countEl = document.getElementById('pvp-count');
        if (countEl) countEl.textContent = `Online: ${network.remotePlayers.size + 1}`;
    }

    renderer.render(scene, camera);
}

// ═══════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════
function hideMainMenu() {
    const m = document.getElementById('main-menu');
    if (m) m.style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
}

function showConnectingOverlay(show, msg = '') {
    const el = document.getElementById('connecting-overlay');
    if (!el) return;
    el.style.display = show ? 'flex' : 'none';
    const txt = document.getElementById('connecting-msg');
    if (txt) txt.textContent = msg;
}

function setLoadingStatus(msg) {
    const el = document.getElementById('loading-status');
    if (el) el.textContent = msg;
}

function showNetworkAlert(msg) {
    const el = document.getElementById('net-alert');
    if (!el) return;
    el.textContent   = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ═══════════════════════════════════════════════════
// MAIN MENU WIRING
// ═══════════════════════════════════════════════════
document.getElementById('btn-dev-mode').addEventListener('click', () => {
    startDevMode();
});

document.getElementById('btn-pvp-mode').addEventListener('click', () => {
    document.getElementById('menu-lobby').style.display = 'none';
    document.getElementById('menu-pvp').style.display   = 'flex';
});

document.getElementById('btn-pvp-back').addEventListener('click', () => {
    document.getElementById('menu-pvp').style.display   = 'none';
    document.getElementById('menu-lobby').style.display = 'flex';
});

document.getElementById('btn-pvp-connect').addEventListener('click', () => {
    const url  = document.getElementById('pvp-server-url').value.trim() || 'ws://192.168.0.107:8080';
    const name = document.getElementById('pvp-name').value.trim()       || 'SPARTAN';
    startPvpMode(url, name);
});

document.getElementById('pvp-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-pvp-connect').click();
});
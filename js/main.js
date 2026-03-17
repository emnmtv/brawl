/**
 * main.js — Game entry point and orchestrator.
 *
 * Responsibilities:
 *   - Create the Three.js scene, renderer, lights
 *   - Instantiate all systems/entities and wire callbacks
 *   - Run the game loop (loop())
 *   - Delegate all rendering decisions to the systems that own them
 *
 * Does NOT contain: input logic, physics, animation, UI building,
 *                   weapon config, or network protocol.
 */
import * as THREE from 'three';

// ── Core ──────────────────────────────────────────────────────────
import { InputManager }  from './core/InputManager.js';
import { AudioManager }  from './core/AudioManager.js';
import { MapLoader }     from './core/MapLoader.js';
import { SpringCamera }  from './core/SpringCamera.js';

// ── Systems ───────────────────────────────────────────────────────
import { BeamPool }      from './systems/BeamSystem.js';

// ── Entities ──────────────────────────────────────────────────────
import { Character }     from './entities/Character.js';
import { Enemy }         from './entities/Enemy.js';

// ── Network ───────────────────────────────────────────────────────
import { NetworkManager } from './network/NetworkManager.js';

// ── UI ────────────────────────────────────────────────────────────
import { DamageUI }        from './ui/DamageUI.js';
import { HUD }             from './ui/HUD.js';
import { Scoreboard }      from './ui/Scoreboard.js';
import { CharacterSelect } from './ui/CharacterSelect.js';
import { DevTuner }        from './ui/DevTuner.js';

// ── Registry ──────────────────────────────────────────────────────
import { getAllModelIds } from './registry/ModelRegistry.js';

// ═══════════════════════════════════════════════════════════════
//  Scene setup
// ═══════════════════════════════════════════════════════════════

const scene    = new THREE.Scene();
scene.fog      = new THREE.Fog(0x111111, 40, 600);

const camera   = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000);
camera.rotation.order = 'YXZ';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// Lights
scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(80, 160, 80);
scene.add(dirLight);

const gridHelper = new THREE.GridHelper(1000, 200, 0x00ffcc, 0x222222);
scene.add(gridHelper);

// ═══════════════════════════════════════════════════════════════
//  Shared singletons
// ═══════════════════════════════════════════════════════════════

const clock        = new THREE.Clock();
const audioManager = new AudioManager(camera);
const inputManager = new InputManager(camera, audioManager);
const beamPool     = new BeamPool(scene);
const springCamera = new SpringCamera(camera);
const damageUI     = new DamageUI(camera);
const hud          = new HUD();
const scoreboard   = new Scoreboard();

// ═══════════════════════════════════════════════════════════════
//  Game state
// ═══════════════════════════════════════════════════════════════

let gameMode  = null;   // 'dev' | 'pvp'
let player    = null;
let enemy     = null;
let network   = null;
let mapLoader = null;
let isRunning = false;
let deathHandled = false;

let showHitbox       = false;
let playerBoxHelper  = null;
let enemyBoxHelper   = null;
let meleeBoxHelper   = null;

// ═══════════════════════════════════════════════════════════════
//  Pointer lock helpers
// ═══════════════════════════════════════════════════════════════

renderer.domElement.addEventListener('click', () => {
    const menuVisible = document.getElementById('main-menu').style.display !== 'none';
    if (!menuVisible) inputManager.requestPointerLock();
});
document.addEventListener('pointerlockerror', e => inputManager._showPointerLockError(e));

// ═══════════════════════════════════════════════════════════════
//  Menu navigation helpers
// ═══════════════════════════════════════════════════════════════

function showPanel(id) {
    ['menu-lobby', 'menu-char-select', 'menu-pvp'].forEach(p => {
        document.getElementById(p).style.display = (p === id) ? 'flex' : 'none';
    });
}

// ═══════════════════════════════════════════════════════════════
//  CharacterSelect
// ═══════════════════════════════════════════════════════════════

let pendingMode = null;

const charSelect = new CharacterSelect(modelId => {
    if (pendingMode === 'dev') startDevMode(modelId);
    else                       showPanel('menu-pvp');
});

document.getElementById('btn-dev-mode').addEventListener('click', () => {
    pendingMode = 'dev';
    showPanel('menu-char-select');
});
document.getElementById('btn-pvp-mode').addEventListener('click', () => {
    pendingMode = 'pvp';
    showPanel('menu-char-select');
});
document.getElementById('btn-char-back').addEventListener('click', () => showPanel('menu-lobby'));
document.getElementById('btn-pvp-back').addEventListener('click',  () => showPanel('menu-char-select'));

document.getElementById('btn-pvp-connect').addEventListener('click', () => {
    const url  = document.getElementById('pvp-server-url').value.trim() || 'ws://localhost:8080';
    const name = document.getElementById('pvp-name').value.trim()       || 'SPARTAN';
    startPvpMode(url, name, charSelect.selectedId || 't800');
});
document.getElementById('pvp-name')
    .addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-pvp-connect').click(); });

// ═══════════════════════════════════════════════════════════════
//  Dev tuner (lazy: created when dev mode starts)
// ═══════════════════════════════════════════════════════════════

let devTuner = null;

// ═══════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════

function loadMap(url, scale = 1, onDone = null) {
    mapLoader = new MapLoader(scene);
    hud.setLoadingStatus('Loading map…');
    mapLoader.load(url, {
        scale,
        onProgress: pct => hud.setLoadingStatus(`Loading map… ${pct}%`),
    })
        .then(() => {
            gridHelper.visible = false;
            hud.setLoadingStatus('');
            onDone?.();
        })
        .catch(() => {
            hud.setLoadingStatus('Map load failed');
            onDone?.();
        });
}

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

    if (meleeBoxHelper) scene.remove(meleeBoxHelper);
    meleeBoxHelper = new THREE.Box3Helper(player.meleeHitBox, 0xff6600);
    meleeBoxHelper.visible = false;
    scene.add(meleeBoxHelper);
}

function respawnPlayer() {
    if (!player) return;
    player.health.reset();
    player.mesh.position.set((Math.random() - 0.5) * 100, 5, (Math.random() - 0.5) * 100);
    springCamera.reset();
    player.isJumping      = false;
    player.yVelocity      = 0;
    player.currentUltimate = null;
    player.meleeAttacking  = false;
    player.meleeAttackAction = null;
    player.meleeHitBoxActive = false;
    deathHandled = false;
}

function wirePlayerDamage() {
    if (!player) return;
    player.health.onDamage = (amount, sourcePos) => {
        damageUI.showHit(amount, sourcePos || null, player.mesh.position, player.mesh.rotation.y);
        player.playHitReaction?.();
        hud.updateHealth(player.health.currentHealth, player.health.maxHealth);
    };
}

// ═══════════════════════════════════════════════════════════════
//  MODE: DEV
// ═══════════════════════════════════════════════════════════════

function startDevMode(modelId) {
    gameMode = 'dev';
    document.getElementById('main-menu').style.display  = 'none';
    document.getElementById('ui-layer').style.display   = 'block';
    document.getElementById('dev-hud').style.display    = 'block';
    document.getElementById('pvp-hud').style.display    = 'none';

    player = new Character(scene, modelId);
    enemy  = new Enemy(scene, 0, -120, modelId);
    wirePlayerDamage();

    // Dev tuner (lazy init)
    devTuner = new DevTuner(() => player);
    devTuner.showTab('weapon');

    inputManager.requestPointerLock();

    loadMap('maps/battle_guys.glb', 1, () => {
        player.mesh.position.set(0, 5, 60);
        enemy.mesh.position.set(0, 5, -60);
        player.setCollisionMeshes(mapLoader.collisionMeshes);
        initHitboxHelpers();

        // AI toggle
        document.getElementById('toggle-ai-btn')?.addEventListener('click', e => {
            enemy.aiEnabled = !enemy.aiEnabled;
            e.target.innerText    = `AI: ${enemy.aiEnabled ? 'ON' : 'OFF'}`;
            e.target.style.background = enemy.aiEnabled ? '#ffaa00' : '#444';
            e.target.style.color      = enemy.aiEnabled ? 'black' : 'white';
            e.target.blur();
        });

        // Hitbox toggle
        document.getElementById('toggle-hitbox-btn')?.addEventListener('click', e => {
            showHitbox = !showHitbox;
            e.target.innerText    = showHitbox ? 'Hide Hitbox' : 'View Hitbox';
            e.target.style.background = showHitbox ? '#00ffcc' : '#444';
            e.target.style.color      = showHitbox ? 'black' : 'white';
            e.target.blur();
        });

        setTimeout(() => devTuner.refreshWeapon(), 500);

        if (!isRunning) { isRunning = true; loop(); }
    });
}

// ═══════════════════════════════════════════════════════════════
//  MODE: PVP
// ═══════════════════════════════════════════════════════════════

function startPvpMode(serverUrl, playerName, modelId) {
    gameMode = 'pvp';
    document.getElementById('main-menu').style.display          = 'none';
    document.getElementById('ui-layer').style.display           = 'block';
    document.getElementById('connecting-overlay').style.display = 'flex';

    network = new NetworkManager(scene, serverUrl, playerName, modelId);

    network.connect().then(myId => {
        inputManager.requestPointerLock();
        document.getElementById('connecting-overlay').style.display = 'none';
        document.getElementById('dev-hud').style.display            = 'none';
        document.getElementById('pvp-hud').style.display            = 'block';

        hud.setSessionId(myId);
        damageUI.setCamera(camera);

        network.beamPool      = beamPool;
        network.audioListener = audioManager.listener;

        // ── Callbacks ────────────────────────────────────────────
        network.onDamage = amount => {
            if (!player) return;
            player.health.takeDamage(amount);
            hud.updateHealth(player.health.currentHealth, player.health.maxHealth);
            if (player.health.isDead && !deathHandled) {
                deathHandled = true;
                scoreboard.addDeath();
                network.reportDead();
                damageUI.showDeath(5, 'NEUTRALIZED BY ENEMY', () => {
                    respawnPlayer();
                    wirePlayerDamage();
                    network.reportRespawn(player.modelId);
                    hud.updateHealth(player.health.currentHealth, player.health.maxHealth);
                });
            }
        };

        network.onBlocked    = () => damageUI.showBlockDeflect();

        network.onKillFeed   = (killerName, victimName, isLocalKill) => {
            damageUI.addKillFeed(killerName, victimName, isLocalKill);
            if (isLocalKill) scoreboard.addKill();
        };

        network.onDead = (victimId, killerId) => {
            if (victimId === network.localId) return;
            const victim = network.remotePlayers.get(victimId);
            if (victim) victim._deaths = (victim._deaths || 0) + 1;
            if (killerId && killerId !== network.localId) {
                const killer = network.remotePlayers.get(killerId);
                if (killer) killer._kills = (killer._kills || 0) + 1;
            }
        };

        network.onPlayerJoin  = (id, name) => { _updateOnlineCount(); hud.showNetAlert(`${name} JOINED`); };
        network.onPlayerLeave = (id, name) => { _updateOnlineCount(); hud.showNetAlert(`${name} LEFT`);   };

        // ── Player setup ──────────────────────────────────────────
        player = new Character(scene, modelId);
        player.mesh.position.set((Math.random() - 0.5) * 100, 5, (Math.random() - 0.5) * 100);
        wirePlayerDamage();
        hud.updateHealth(player.health.currentHealth, player.health.maxHealth);

        loadMap('maps/battle_guys.glb', 1, () => {
            player.setCollisionMeshes(mapLoader.collisionMeshes);
            initHitboxHelpers();
            if (!isRunning) { isRunning = true; loop(); }
        });

    }).catch(err => {
        document.getElementById('connecting-msg').textContent = `❌ ${err.message}`;
    });
}

function _updateOnlineCount() {
    if (!network) return;
    hud.setOnlineCount(network.remotePlayers.size + 1);
}

// ═══════════════════════════════════════════════════════════════
//  GAME LOOP
// ═══════════════════════════════════════════════════════════════

function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);

    // ── Noclip free-cam ─────────────────────────────────────────
    if (inputManager.isNoclip) {
        camera.quaternion.setFromEuler(
            new THREE.Euler(inputManager.freecamPitch, inputManager.freecamYaw, 0, 'YXZ')
        );
        const spd = 50 * dt;
        if (inputManager.keys['KeyW']) camera.translateZ(-spd);
        if (inputManager.keys['KeyS']) camera.translateZ( spd);
        if (inputManager.keys['KeyA']) camera.translateX(-spd);
        if (inputManager.keys['KeyD']) camera.translateX( spd);
        renderer.render(scene, camera);
        return;
    }

    // ── Player ───────────────────────────────────────────────────
    if (player) {
        if (mapLoader?.isLoaded) player.snapToGround(mapLoader.collisionMeshes);

        player.update(dt, clock, inputManager, audioManager, {
            beamPool,
            enemies: enemy && !enemy.health.isDead ? [enemy] : [],
            network,
        });

        springCamera.update(player, inputManager,
            mapLoader?.isLoaded ? mapLoader.collisionMeshes : []
        );

        // Hitbox helpers
        if (playerBoxHelper) { playerBoxHelper.box.copy(player.boundingBox); playerBoxHelper.visible = showHitbox; }
        if (meleeBoxHelper) {
            meleeBoxHelper.box.copy(player.meleeHitBox);
            meleeBoxHelper.material.color.setHex(player.meleeHitBoxActive ? 0xff6600 : 0x442200);
            meleeBoxHelper.visible = showHitbox && player.weaponManager.currentType === 'melee';
        }

        // Dev: player death
        if (gameMode === 'dev' && player.health.isDead && !deathHandled) {
            deathHandled = true;
            damageUI.showDeath(3, 'TERMINATED BY AI', () => {
                respawnPlayer();
                wirePlayerDamage();
                if (enemy) {
                    enemy.health.reset();
                    enemy.mesh.visible = true;
                    const ti = document.getElementById('target-info');
                    if (ti) ti.style.display = 'block';
                }
            });
        }
    }

    // ── Dev: AI enemy ────────────────────────────────────────────
    if (gameMode === 'dev' && enemy) {
        if (mapLoader?.isLoaded) {
            const p   = enemy.mesh.position;
            const ray = new THREE.Raycaster(new THREE.Vector3(p.x, p.y + 2, p.z), new THREE.Vector3(0, -1, 0));
            ray.far   = 10;
            const hits = ray.intersectObjects(mapLoader.collisionMeshes, false);
            if (hits.length && hits[0].point.y <= p.y + 2) enemy.mesh.position.y = hits[0].point.y;
        }
        enemy.update(dt, clock, player, beamPool);
        beamPool.update(dt, [enemy], player, mapLoader?.isLoaded ? mapLoader.collisionMeshes : []);
        if (enemyBoxHelper) { enemyBoxHelper.box.copy(enemy.boundingBox); enemyBoxHelper.visible = showHitbox; }
    }

    // ── PVP ──────────────────────────────────────────────────────
    if (gameMode === 'pvp' && network) {
        network.update(dt, player, inputManager);
        beamPool.update(dt, [], player, mapLoader?.isLoaded ? mapLoader.collisionMeshes : []);

        if (player) {
            hud.updateWeapon(player.weaponManager.currentType);
            damageUI.setBlocking(!!player.isBlocking);
        }

        // Local beam → remote player hit detection
        beamPool.pool.forEach(beam => {
            if (!beam.userData.active || beam.userData.isDeflected) return;
            if (beam.userData.isRemote || beam.userData.isEnemy) return;

            const segStart = beam.userData.segStart || beam.userData.prevPos || beam.position;
            const segEnd   = beam.position;
            const segVec   = segEnd.clone().sub(segStart);
            const segLen   = segVec.length();
            if (segLen < 1e-6) return;
            const ray = new THREE.Ray(segStart.clone(), segVec.clone().divideScalar(segLen));

            network.remotePlayers.forEach((rp, id) => {
                if (rp.isDead || !rp.boundingBox) return;
                const hitPoint = ray.intersectBox(rp.boundingBox, new THREE.Vector3());
                if (hitPoint && hitPoint.distanceTo(segStart) <= segLen + 1e-4) {
                    const hit = network.reportHit(id, 20);
                    beamPool.deactivate(beam);
                    if (hit) damageUI.showHitConfirm(20, rp.mesh.position.clone());
                }
            });
        });

        _updateOnlineCount();
    }

    renderer.render(scene, camera);
}

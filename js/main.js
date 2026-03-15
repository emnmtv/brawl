import * as THREE from 'three';
import { CONFIG }          from './Config.js';
import { InputManager }    from './InputManager.js';
import { AudioManager }    from './AudioManager.js';
import { BeamPool, Enemy } from './Systems.js';
import { Character }       from './Character.js';
import { MapLoader }       from './MapLoader.js';
import { NetworkManager }  from './Network.js';

const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x111111, 40, 600);
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000); camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2); dirLight.position.set(80, 160, 80); scene.add(dirLight);
const gridHelper = new THREE.GridHelper(1000, 200, 0x00ffcc, 0x222222); scene.add(gridHelper);

const clock = new THREE.Clock();
const audioManager = new AudioManager(camera);
const inputManager = new InputManager(camera, audioManager);
const beamPool = new BeamPool(scene);

let gameMode = null, player = null, enemy = null, network = null, mapLoader = null, isRunning = false;
let playerBoxHelper = null, enemyBoxHelper = null, showHitbox = false;
let deathHandled = false; // prevents showing death screen more than once per life

// ═══════════════════════════════════════════════════
//  DAMAGE UI  — hit flash + directional indicator + death/respawn screen
// ═══════════════════════════════════════════════════
class DamageUI {
    constructor() {
        this.flashEl        = document.getElementById('hit-flash');
        this.indicatorsEl   = document.getElementById('damage-indicators');
        this.deathScreen    = document.getElementById('death-screen');
        this.countdownEl    = document.getElementById('respawn-countdown');
        this.progressEl     = document.getElementById('respawn-progress');
        this.killerEl       = document.getElementById('respawn-killer');
        this._countdownInterval = null;
        this._isDead = false;
    }

    // Call whenever player takes a hit.
    // attackerWorldPos is optional — if provided, shows a directional arrow.
    showHit(amount, attackerWorldPos, playerPos, playerYaw) {
        if (this._isDead) return;

        // 1. Full-screen red vignette flash
        this.flashEl.classList.remove('flash-active');
        void this.flashEl.offsetWidth; // force reflow to restart CSS animation
        this.flashEl.classList.add('flash-active');

        // 2. Directional indicator (only when we know where the damage came from)
        if (attackerWorldPos && playerPos) {
            const dx = attackerWorldPos.x - playerPos.x;
            const dz = attackerWorldPos.z - playerPos.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist > 1) {
                // Rotate the world-space direction into player-local space
                const cos = Math.cos(-playerYaw);
                const sin = Math.sin(-playerYaw);
                const localX =  dx * cos - dz * sin;
                const localZ =  dx * sin + dz * cos;
                // atan2(localX, -localZ):  0 = attacker in front, PI/2 = right, PI = behind, -PI/2 = left
                const indicatorAngle = Math.atan2(localX, -localZ);
                this._spawnIndicator(indicatorAngle);
            }
        }
    }

    _spawnIndicator(angle) {
        // Place indicator on a circle 38% of the shorter screen dimension from center
        const R  = Math.min(window.innerWidth, window.innerHeight) * 0.38;
        const cx = window.innerWidth  / 2;
        const cy = window.innerHeight / 2;
        const x  = cx + R * Math.sin(angle);
        const y  = cy - R * Math.cos(angle);

        const el = document.createElement('div');
        el.className = 'dmg-indicator';
        el.style.left      = `${x}px`;
        el.style.top       = `${y}px`;
        // Rotate the triangle so its tip points inward (toward screen center = toward player)
        el.style.transform = `translate(-50%, -50%) rotate(${angle}rad)`;
        this.indicatorsEl.appendChild(el);

        setTimeout(() => el.remove(), 1200);
    }

    // Show death/respawn screen. countdownSeconds: how long before auto-respawn.
    showDeath(countdownSeconds, killerLabel, onRespawn) {
        this._isDead = true;
        if (this.killerEl) this.killerEl.textContent = killerLabel || '';
        this.deathScreen.style.display = 'flex';

        // Animate the progress bar from 100% → 0% over countdownSeconds
        this.progressEl.style.transition = 'none';
        this.progressEl.style.width = '100%';
        // Double-rAF to ensure the transition is applied after display:flex kicks in
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.progressEl.style.transition = `width ${countdownSeconds}s linear`;
            this.progressEl.style.width = '0%';
        }));

        let remaining = countdownSeconds;
        this.countdownEl.textContent = remaining;

        clearInterval(this._countdownInterval);
        this._countdownInterval = setInterval(() => {
            remaining--;
            this.countdownEl.textContent = remaining;
            if (remaining <= 0) {
                clearInterval(this._countdownInterval);
                this.hideDeath();
                onRespawn();
            }
        }, 1000);
    }

    hideDeath() {
        this._isDead = false;
        this.deathScreen.style.display = 'none';
        clearInterval(this._countdownInterval);
    }
}

const damageUI = new DamageUI();

// ── TUNER WIRING ──
const tunerIds = ['scale', 'px', 'py', 'pz', 'rx', 'ry', 'rz',
                  's0x', 's0y', 's0z', 's1x', 's1y', 's1z', 's2x', 's2y', 's2z'];

function initTuner() {
    tunerIds.forEach(id => {
        const slider = document.getElementById('tune-' + id);
        const numBox = document.getElementById('tune-' + id + '-num');
        if (!slider || !numBox) return;
        const updateVals = (e) => { const val = parseFloat(e.target.value); slider.value = val; numBox.value = val; applyTuner(); };
        slider.addEventListener('input', updateVals);
        numBox.addEventListener('input', updateVals);
    });
}

function refreshTunerUI() {
    if (!player) return;
    const wepType = player.weaponManager.currentType;
    const config = wepType === 'gun' ? CONFIG.WEAPONS.GUN : CONFIG.WEAPONS.MELEE;
    const setVal = (id, v) => {
        const slider = document.getElementById('tune-' + id);
        const numBox = document.getElementById('tune-' + id + '-num');
        if (slider && numBox) { slider.value = v; numBox.value = v; }
    };
    setVal('scale', config.SCALE);
    setVal('px', config.POS[0]); setVal('py', config.POS[1]); setVal('pz', config.POS[2]);
    setVal('rx', config.ROT[0]); setVal('ry', config.ROT[1]); setVal('rz', config.ROT[2]);
    if (wepType === 'melee') {
        setVal('s0x', config.SWING_ROTS[0][0]); setVal('s0y', config.SWING_ROTS[0][1]); setVal('s0z', config.SWING_ROTS[0][2]);
        setVal('s1x', config.SWING_ROTS[1][0]); setVal('s1y', config.SWING_ROTS[1][1]); setVal('s1z', config.SWING_ROTS[1][2]);
        setVal('s2x', config.SWING_ROTS[2][0]); setVal('s2y', config.SWING_ROTS[2][1]); setVal('s2z', config.SWING_ROTS[2][2]);
    } else {
        ['0','1','2'].forEach(i => { setVal(`s${i}x`,0); setVal(`s${i}y`,0); setVal(`s${i}z`,0); });
    }
    generateTunerCode();
}

function applyTuner() {
    if (!player) return;
    const wepType = player.weaponManager.currentType;
    const config = wepType === 'gun' ? CONFIG.WEAPONS.GUN : CONFIG.WEAPONS.MELEE;
    const mesh = player.weaponManager.weapons[wepType].mesh;
    const g = id => { const el = document.getElementById('tune-' + id); return el ? parseFloat(el.value) : 0; };
    config.SCALE = g('scale');
    config.POS = [g('px'), g('py'), g('pz')];
    config.ROT = [g('rx'), g('ry'), g('rz')];
    if (mesh) { mesh.scale.set(config.SCALE, config.SCALE, config.SCALE); mesh.position.set(...config.POS); mesh.rotation.set(...config.ROT); }
    if (wepType === 'melee') {
        config.SWING_ROTS[0] = [g('s0x'), g('s0y'), g('s0z')];
        config.SWING_ROTS[1] = [g('s1x'), g('s1y'), g('s1z')];
        config.SWING_ROTS[2] = [g('s2x'), g('s2y'), g('s2z')];
    }
    generateTunerCode();
}

function generateTunerCode() {
    if (!player) return;
    const wepType = player.weaponManager.currentType;
    const config = wepType === 'gun' ? CONFIG.WEAPONS.GUN : CONFIG.WEAPONS.MELEE;
    let code = `${wepType.toUpperCase()}:\nSCALE: ${config.SCALE.toFixed(3)},\nPOS: [${config.POS.map(n=>n.toFixed(2)).join(', ')}],\nROT: [${config.ROT.map(n=>n.toFixed(2)).join(', ')}],`;
    if (wepType === 'melee') {
        code += `\nSWING_ROTS: [\n  [${config.SWING_ROTS[0].map(n=>n.toFixed(2)).join(', ')}],\n  [${config.SWING_ROTS[1].map(n=>n.toFixed(2)).join(', ')}],\n  [${config.SWING_ROTS[2].map(n=>n.toFixed(2)).join(', ')}]\n],`;
    }
    document.getElementById('tuner-code').innerText = code;
}

window.addEventListener('keydown', e => {
    if ((e.code === 'Digit1' || e.code === 'Digit2') && inputManager.isNoclip) setTimeout(refreshTunerUI, 50);
});

// ── MAP LOADER ──
function loadMap(url, scale = 1, onDone = null) {
    mapLoader = new MapLoader(scene);
    document.getElementById('loading-status').textContent = 'Loading map…';
    mapLoader.load(url, { scale, onProgress: pct => document.getElementById('loading-status').textContent = `Loading map… ${pct}%` })
        .then(() => { gridHelper.visible = false; document.getElementById('loading-status').textContent = ''; if (onDone) onDone(); })
        .catch(() => { document.getElementById('loading-status').textContent = 'Map load failed'; if (onDone) onDone(); });
}

function initHitboxHelpers() {
    if (playerBoxHelper) scene.remove(playerBoxHelper);
    playerBoxHelper = new THREE.Box3Helper(player.boundingBox, 0x00ffcc);
    playerBoxHelper.visible = false; scene.add(playerBoxHelper);
    if (enemy && gameMode === 'dev') {
        if (enemyBoxHelper) scene.remove(enemyBoxHelper);
        enemyBoxHelper = new THREE.Box3Helper(enemy.boundingBox, 0xff3300);
        enemyBoxHelper.visible = false; scene.add(enemyBoxHelper);
    }
}

// ── RESPAWN ──
function respawnPlayer() {
    if (!player) return;
    player.health.currentHealth = player.health.maxHealth;
    player.health.isDead = false;
    if (player.health.uiElement) player.health.uiElement.style.width = '100%';
    player.mesh.position.set((Math.random() - 0.5) * 100, 5, (Math.random() - 0.5) * 100);
    player.isJumping = false;
    player.yVelocity = 0;
    player.currentUltimate = null;
    player.isSwinging = false;
    player.swingProgress = 0;
    if (player.boundingBox) {
        const c = player.mesh.position.clone(); c.y += 6;
        player.boundingBox.setFromCenterAndSize(c, new THREE.Vector3(6, 12, 6));
    }
    deathHandled = false;
}

// Wire up the player's onDamage callback after player is created.
// Called once per mode start and again after respawn.
function wirePlayerDamage() {
    if (!player) return;
    player.health.onDamage = (amount, sourcePos) => {
        // Show hit flash + optional directional indicator
        damageUI.showHit(
            amount,
            sourcePos || null,
            player.mesh.position,
            player.mesh.rotation.y
        );
    };
}

// ── START MODES ──
function startDevMode() {
    gameMode = 'dev';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    document.getElementById('dev-hud').style.display = 'block';
    document.getElementById('pvp-hud').style.display = 'none';

    initTuner();

    player = new Character(scene, 'models/t800.glb');
    enemy  = new Enemy(scene, 0, -120, 'models/t800.glb');
    wirePlayerDamage();

    loadMap('maps/battle_guys.glb', 1, () => {
        player.mesh.position.set(0, 5, 60);
        enemy.mesh.position.set(0, 5, -60);
        player.setCollisionMeshes(mapLoader.collisionMeshes);
        initHitboxHelpers();
        setTimeout(refreshTunerUI, 500);

        document.getElementById('toggle-ai-btn').addEventListener('click', e => {
            enemy.aiEnabled = !enemy.aiEnabled;
            e.target.innerText = `AI: ${enemy.aiEnabled ? 'ON' : 'OFF'}`;
            e.target.style.background = enemy.aiEnabled ? '#ffaa00' : '#444';
            e.target.style.color      = enemy.aiEnabled ? 'black'   : 'white';
            e.target.blur();
        });
        document.getElementById('toggle-hitbox-btn').addEventListener('click', e => {
            showHitbox = !showHitbox;
            e.target.innerText    = showHitbox ? 'Hide Hitbox' : 'View Hitbox';
            e.target.style.background = showHitbox ? '#00ffcc' : '#444';
            e.target.style.color      = showHitbox ? 'black'   : 'white';
            e.target.blur();
        });

        if (!isRunning) { isRunning = true; loop(); }
    });
}

function startPvpMode(serverUrl, playerName) {
    gameMode = 'pvp';
    document.getElementById('main-menu').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    document.getElementById('connecting-overlay').style.display = 'flex';

    network = new NetworkManager(scene, serverUrl, playerName);
    network.connect().then(myId => {
        document.getElementById('connecting-overlay').style.display = 'none';
        document.getElementById('dev-hud').style.display = 'none';
        document.getElementById('pvp-hud').style.display = 'block';
        document.getElementById('pvp-id').textContent = `ID: ${myId}`;

        // Assign BEFORE creating player so remote players created in init message
        // already have beamPool/audioListener (previous bug fix)
        network.beamPool       = beamPool;
        network.audioListener  = audioManager.listener;

        // PvP damage: no source pos from server, so just flash (no direction arrow)
        network.onDamage = amount => {
            if (!player) return;
            player.health.takeDamage(amount);
            if (player.health.isDead && !deathHandled) {
                deathHandled = true;
                network.reportDead();
                damageUI.showDeath(5, 'NEUTRALIZED BY ENEMY', () => {
                    respawnPlayer();
                    wirePlayerDamage();
                });
            }
        };

        player = new Character(scene, 'models/t800.glb');
        player.mesh.position.set((Math.random() - 0.5) * 100, 5, (Math.random() - 0.5) * 100);
        wirePlayerDamage();

        loadMap('maps/battle_guys.glb', 1, () => {
            player.setCollisionMeshes(mapLoader.collisionMeshes);
            initHitboxHelpers();
            if (!isRunning) { isRunning = true; loop(); }
        });
    }).catch(err => {
        document.getElementById('connecting-msg').textContent = `❌ ${err.message}`;
    });
}

// ── MAIN LOOP ──
function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);

    // Noclip / free-cam
    if (inputManager.isNoclip) {
        camera.quaternion.setFromEuler(new THREE.Euler(inputManager.freecamPitch, inputManager.freecamYaw, 0, 'YXZ'));
        const speed = 50 * dt;
        if (inputManager.keys['KeyW']) camera.translateZ(-speed);
        if (inputManager.keys['KeyS']) camera.translateZ( speed);
        if (inputManager.keys['KeyA']) camera.translateX(-speed);
        if (inputManager.keys['KeyD']) camera.translateX( speed);
        renderer.render(scene, camera);
        return;
    }

    if (player) {
        if (mapLoader && mapLoader.isLoaded) player.snapToGround(mapLoader.collisionMeshes);

        player.update(dt, clock, inputManager, audioManager, {
            beamPool,
            enemies: enemy && !enemy.health.isDead ? [enemy] : [],
            network
        });

        camera.position.lerp(player.cameraPivot.localToWorld(new THREE.Vector3(3, 2, 20)), 0.4);
        camera.lookAt(player.cameraPivot.localToWorld(new THREE.Vector3(0, 0, -100)));

        if (playerBoxHelper) { playerBoxHelper.box.copy(player.boundingBox); playerBoxHelper.visible = showHitbox; }

        // ── DEV MODE: detect player death and trigger respawn screen ──
        if (gameMode === 'dev' && player.health.isDead && !deathHandled) {
            deathHandled = true;
            damageUI.showDeath(3, 'TERMINATED BY AI', () => {
                respawnPlayer();
                wirePlayerDamage();
                // Revive the enemy for the next round too
                if (enemy) {
                    enemy.health.currentHealth = enemy.health.maxHealth;
                    enemy.health.isDead = false;
                    enemy.mesh.visible = true;
                    const ti = document.getElementById('target-info');
                    if (ti) ti.style.display = 'block';
                }
            });
        }
    }

    if (gameMode === 'dev' && enemy) {
        if (mapLoader && mapLoader.isLoaded) {
            const p = enemy.mesh.position;
            const ray = new THREE.Raycaster(new THREE.Vector3(p.x, p.y + 2, p.z), new THREE.Vector3(0, -1, 0));
            ray.far = 10;
            const hits = ray.intersectObjects(mapLoader.collisionMeshes, false);
            if (hits.length > 0 && hits[0].point.y <= p.y + 2) enemy.mesh.position.y = hits[0].point.y;
        }
        enemy.update(dt, clock, player, beamPool);
        beamPool.update(dt, [enemy], player);
        if (enemyBoxHelper) { enemyBoxHelper.box.copy(enemy.boundingBox); enemyBoxHelper.visible = showHitbox; }
    }

    if (gameMode === 'pvp' && network) {
        network.update(dt, player, inputManager);
        beamPool.update(dt, [], player);

        beamPool.pool.forEach(beam => {
            if (!beam.userData.active || beam.userData.isEnemy || beam.userData.isRemote) return;
            network.remotePlayers.forEach((rp, id) => {
                if (!rp.isDead && rp.boundingBox.containsPoint(beam.position)) {
                    network.reportHit(id, 20);
                    beam.visible = false;
                    beam.userData.active = false;
                }
            });
        });

        document.getElementById('pvp-count').textContent = `Online: ${network.remotePlayers.size + 1}`;
    }

    renderer.render(scene, camera);
}

// ── MENU BINDINGS ──
document.getElementById('btn-dev-mode').addEventListener('click', startDevMode);
document.getElementById('btn-pvp-mode').addEventListener('click', () => {
    document.getElementById('menu-lobby').style.display = 'none';
    document.getElementById('menu-pvp').style.display = 'flex';
});
document.getElementById('btn-pvp-back').addEventListener('click', () => {
    document.getElementById('menu-pvp').style.display = 'none';
    document.getElementById('menu-lobby').style.display = 'flex';
});
document.getElementById('btn-pvp-connect').addEventListener('click', () => {
    const url  = document.getElementById('pvp-server-url').value.trim() || 'ws://192.168.0.107:8080';
    const name = document.getElementById('pvp-name').value.trim() || 'SPARTAN';
    startPvpMode(url, name);
});
document.getElementById('pvp-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-pvp-connect').click();
});
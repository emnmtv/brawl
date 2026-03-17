import * as THREE from 'three';
import { CONFIG }              from './Config.js';
import { InputManager }        from './InputManager.js';
import { AudioManager }        from './AudioManager.js';
import { BeamPool, Enemy }     from './Systems.js';
import { Character }           from './Character.js';
import { MapLoader }           from './MapLoader.js';
import { NetworkManager }      from './Network.js';
import { getAllModelIds, getModel, getWeaponConfig, getSizeConfig } from './ModelRegistry.js';

const scene    = new THREE.Scene(); scene.fog = new THREE.Fog(0x111111, 40, 600);
const camera   = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 2000); camera.rotation.order = 'YXZ';
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.7));
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2); dirLight.position.set(80, 160, 80); scene.add(dirLight);
const gridHelper = new THREE.GridHelper(1000, 200, 0x00ffcc, 0x222222); scene.add(gridHelper);

const clock        = new THREE.Clock();
const audioManager = new AudioManager(camera);
const inputManager = new InputManager(camera, audioManager);
const beamPool     = new BeamPool(scene);

let gameMode = null, player = null, enemy = null, network = null, mapLoader = null, isRunning = false;

// ═══════════════════════════════════════════════════
//  SPRING ARM CAMERA
//  Proper 3rd-person: orbit around focus, raycast arm,
//  character fades when camera is forced too close.
// ═══════════════════════════════════════════════════
const _springRay     = new THREE.Raycaster();
const _camFocus      = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();
const _aimDir        = new THREE.Vector3();   // true aim direction, set every frame
const _camDesired    = new THREE.Vector3();
const _camSmoothed   = new THREE.Vector3();
let   _camReady      = false;          // skip lerp on first frame
let   _charMaterials = null;           // cached material list for fade

function _buildMatCache(player) {
    _charMaterials = [];
    player.mesh.traverse(child => {
        if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
                m.transparent = true;
                _charMaterials.push(m);
            });
        }
    });
}

// Handle ESC to exit pointer lock and click to re-enter
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.pointerLockElement === document.body) {
        document.exitPointerLock();
    }
});

// Re-enter pointer lock on click if in game (not in menu), with error handling
renderer.domElement.addEventListener('click', () => {
    const menuVisible = document.getElementById('main-menu').style.display !== 'none' ||
                        document.getElementById('char-card-grid').offsetParent !== null;
    if (!menuVisible) {
        try {
            const lockPromise = document.body.requestPointerLock();
            if (lockPromise && typeof lockPromise.then === 'function') {
                lockPromise.catch(err => {
                    // Only show error if not already locked
                    if (document.pointerLockElement !== document.body) {
                        showPointerLockError(err);
                    }
                });
            }
        } catch (err) {
            if (document.pointerLockElement !== document.body) {
                showPointerLockError(err);
            }
        }
    }
});

// Show pointer lock error to user (optional UI feedback)
function showPointerLockError(err) {
    let el = document.getElementById('pointerlock-error');
    if (!el) {
        el = document.createElement('div');
        el.id = 'pointerlock-error';
        el.style.position = 'fixed';
        el.style.top = '20px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.background = 'rgba(200,0,0,0.9)';
        el.style.color = '#fff';
        el.style.padding = '10px 24px';
        el.style.borderRadius = '8px';
        el.style.zIndex = 9999;
        el.style.fontSize = '1.1em';
        document.body.appendChild(el);
    }
    let msg = '';
    if (err && typeof err === 'object') {
        if (err.message) {
            msg = err.message;
        } else if (err.type === 'pointerlockerror') {
            msg = 'Pointer lock request was denied by the browser or interrupted by the user.';
        } else if (err.type) {
            msg = 'Pointer lock failed: ' + err.type;
        } else {
            msg = 'Pointer lock failed.';
        }
    } else {
        msg = err ? String(err) : 'Pointer lock failed.';
    }
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// Listen for pointerlockerror event globally
document.addEventListener('pointerlockerror', (e) => {
    showPointerLockError(e);
});
function updateSpringCamera(player, camera, inputManager, collisionMeshes) {
    const sc    = player.sizeConfig;
    // Camera yaw is driven by mouse ONLY — independent of character facing.
    // Character facing is handled in Character.js based on movement/shooting.
    const yaw   = inputManager.mouseLookX;
    const pitch = inputManager.mouseLookY;

    // World-space direction vectors
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const fwdX = -sinY, fwdZ = -cosY;   // character forward in world
    const rgtX =  cosY, rgtZ = -sinY;   // character right in world

    // ═══════════════════════════════════════════════════════════
    //  BATTLEFRONT 2 / RE4 CAMERA STYLE
    //
    //  CAMERA is close behind the character at shoulder height.
    //  LOOK TARGET is far ahead at eye level.
    //  Result: character fills bottom-center of screen, world
    //  stretches out above them — exactly like the reference.
    //
    //  Tunable via physics camOffset in the registry:
    //    camOffset.z  = spring arm length (back distance)
    //    camOffset.x  = shoulder offset (right of center)
    //    camOffset.y  = extra height tweak
    //    cameraPivotY = character eye/shoulder level
    // ═══════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════
    //  OVER-THE-SHOULDER CAMERA  (GTA5 / Uncharted style)
    //
    //  Camera sits behind + above the right shoulder.
    //  Look target is far ahead in the world — this is what
    //  makes the character appear in the LOWER-RIGHT of the
    //  frame rather than dead-centre.
    //
    //  camOffset.z  → spring arm length  (back distance)
    //  camOffset.x  → shoulder offset    (right of centre)
    //  camOffset.y  → extra height tweak
    //  cameraPivotY → eye / shoulder level
    // ══════════════════════════════════════════════════════════

    const ARM   = sc.camOffset.z;           // full arm length from registry
    const SIDE  = sc.camOffset.x * 1.6;    // right shoulder — wider pushes char left in frame
    const CAM_Y = sc.cameraPivotY * 0.85 + sc.camOffset.y;  // camera height above feet

    // Look target is FAR ahead — this is the key to the character appearing
    // in the bottom of the screen rather than the middle.
    const LOOK_FWD = ARM * 5.0;            // look distance forward in world
    const LOOK_Y   = sc.cameraPivotY * 1.1; // look at just above eye level

    // ── Camera orbit (pitch tilts camera up/down around shoulder pivot) ──
    const cosP = Math.cos(-pitch);
    const sinP = Math.sin(-pitch);

    _camDesired.set(
        player.mesh.position.x - fwdX * ARM * cosP + rgtX * SIDE,
        player.mesh.position.y + CAM_Y - ARM * sinP,
        player.mesh.position.z - fwdZ * ARM * cosP + rgtZ * SIDE
    );

    // ── Spring arm anchor (right-shoulder world position) ─────
    // Anchor is offset to the right shoulder so the arm starts there,
    // not at the spine — this prevents the camera clipping the body.
    _camFocus.set(
        player.mesh.position.x + rgtX * SIDE * 0.3,
        player.mesh.position.y + sc.cameraPivotY,
        player.mesh.position.z + rgtZ * SIDE * 0.3
    );

    // ── Spring arm collision ──────────────────────────────────
    const armVec  = _camDesired.clone().sub(_camFocus);
    const armFull = armVec.length();
    const armDir  = armVec.clone().divideScalar(armFull);

    _springRay.set(_camFocus, armDir);
    _springRay.near = 0.05;
    _springRay.far  = armFull;

    let actualLen = armFull;
    if (collisionMeshes && collisionMeshes.length) {
        const hits = _springRay.intersectObjects(collisionMeshes, false);
        if (hits.length > 0) actualLen = Math.max(0.5, hits[0].distance - 0.3);
    }

    const actualPos = _camFocus.clone().addScaledVector(armDir, actualLen);

    // ── Smooth position ───────────────────────────────────────
    if (!_camReady) { _camSmoothed.copy(actualPos); _camReady = true; }
    else            { _camSmoothed.lerp(actualPos, 0.18); }
    camera.position.copy(_camSmoothed);

    // ── Look target: far ahead in the world ──────────────────
    // Camera looks at a point far in front of the character.
    // Character is NOT the look target — they're just in the way.
    // This is what keeps them in the lower portion of the frame.
    _camLookTarget.set(
        player.mesh.position.x + fwdX * LOOK_FWD * cosP,
        player.mesh.position.y + LOOK_Y + LOOK_FWD * sinP * 0.4,
        player.mesh.position.z + fwdZ * LOOK_FWD * cosP
    );
    camera.lookAt(_camLookTarget);

    // ── TRUE AIM DIRECTION — from camera toward crosshair ─────
    // This is what bullets must use. It equals the camera's forward
    // direction after lookAt(), which is exactly where the crosshair points.
    camera.getWorldDirection(_aimDir);
    inputManager.aimDir = _aimDir;  // Weapons.js reads this every fire

    // ── Character fade when spring arm is compressed ──────────
    if (!_charMaterials && player.mesh.children.length > 0) _buildMatCache(player);
    if (_charMaterials) {
        const ratio   = actualLen / armFull;
        const opacity = ratio < 0.35 ? Math.max(0, ratio / 0.35) : 1.0;
        _charMaterials.forEach(m => { m.opacity = opacity; });
    }
}
let playerBoxHelper = null, enemyBoxHelper = null, meleeBoxHelper = null, showHitbox = false, deathHandled = false;
let selectedModelId = null, pendingMode = null;

// ═══════════════════════════════════════════════════
//  CHARACTER SELECT
// ═══════════════════════════════════════════════════
function buildCharacterSelect() {
    const grid = document.getElementById('char-card-grid');
    grid.innerHTML = '';
    getAllModelIds().forEach(id => {
        const profile = getModel(id);
        const ui      = profile.ui  || {};
        const accent  = ui.accent   || '#00ffcc';

        const card = document.createElement('div');
        card.className  = 'char-card';
        card.dataset.id = id;
        card.style.setProperty('--accent', accent);
        card.setAttribute('tabindex', '0');
        card.setAttribute('role', 'button');
        card.setAttribute('aria-label', ui.displayName || id);

        const previewDiv = document.createElement('div');
        previewDiv.className = 'char-preview';
        if (ui.preview) {
            const img = document.createElement('img');
            img.src = ui.preview; img.alt = ui.displayName || id;
            img.onerror = () => img.replaceWith(makePlaceholder(accent));
            previewDiv.appendChild(img);
        } else { previewDiv.appendChild(makePlaceholder(accent)); }

        const footer = document.createElement('div');
        footer.className = 'char-card-footer';
        footer.innerHTML = `
            <div class="char-card-name">${ui.displayName || id.toUpperCase()}</div>
            <div class="char-card-sub">${ui.subtitle || ''}</div>`;

        card.appendChild(previewDiv);
        card.appendChild(footer);
        grid.appendChild(card);

        card.addEventListener('mouseenter', () => populateDetail(id));
        card.addEventListener('focus',      () => populateDetail(id));
        card.addEventListener('click',      () => selectCharacter(id));
        card.addEventListener('keydown', e => { if (e.key==='Enter'||e.key===' ') selectCharacter(id); });
    });
    const ids = getAllModelIds();
    if (ids.length > 0) populateDetail(ids[0]);
}

function makePlaceholder(accent) {
    const ph = document.createElement('div'); ph.className = 'char-preview-placeholder';
    const sil = document.createElement('div'); sil.className = 'char-silhouette'; sil.textContent = '🤖';
    ph.appendChild(sil); return ph;
}

function populateDetail(id) {
    const profile = getModel(id);
    const ui      = profile.ui   || {};
    const stats   = ui.stats     || { speed:5, damage:5, armor:5 };
    const sc      = profile.size ?? { height:12, width:6 };
    const accent  = ui.accent    || '#00ffcc';

    document.getElementById('char-detail').style.borderColor     = accent;
    document.getElementById('char-detail-name').textContent      = ui.displayName || id.toUpperCase();
    document.getElementById('char-detail-name').style.color      = accent;
    document.getElementById('char-detail-sub').textContent       = `${ui.subtitle||''}  ·  H:${sc.height}  W:${sc.width}`;
    document.getElementById('char-detail-desc').textContent      = ui.description || '';

    animateStat('stat-speed',  'stat-speed-val',  stats.speed,  accent);
    animateStat('stat-damage', 'stat-damage-val', stats.damage, accent);
    animateStat('stat-armor',  'stat-armor-val',  stats.armor,  accent);
}

function animateStat(barId, valId, value, accent) {
    const bar = document.getElementById(barId), val = document.getElementById(valId);
    if (!bar||!val) return;
    bar.style.background = `linear-gradient(to right,${accent},color-mix(in srgb,${accent} 60%,#004433))`;
    bar.style.boxShadow  = `0 0 6px ${accent}`;
    bar.style.width      = Math.max(0, Math.min(10, value??5)) * 10 + '%';
    val.textContent      = value ?? '—';
}

function selectCharacter(id) {
    selectedModelId = id;
    document.querySelectorAll('.char-card').forEach(c => c.classList.toggle('selected', c.dataset.id===id));
    const accent = getModel(id).ui?.accent || '#00ffcc';
    document.getElementById('char-detail').style.borderColor = accent;
    populateDetail(id);
    const btn = document.getElementById('btn-char-confirm');
    btn.disabled = false; btn.style.borderColor = accent; btn.style.color = accent;
}

function showPanel(id) {
    ['menu-lobby','menu-char-select','menu-pvp'].forEach(p => {
        document.getElementById(p).style.display = (p===id) ? 'flex' : 'none';
    });
}

document.getElementById('btn-dev-mode').addEventListener('click', () => { pendingMode='dev'; buildCharacterSelect(); showPanel('menu-char-select'); });
document.getElementById('btn-pvp-mode').addEventListener('click', () => { pendingMode='pvp'; buildCharacterSelect(); showPanel('menu-char-select'); });
document.getElementById('btn-char-back').addEventListener('click', () => showPanel('menu-lobby'));
document.getElementById('btn-char-confirm').addEventListener('click', () => {
    if (!selectedModelId) return;
    if (pendingMode==='dev') startDevMode(selectedModelId);
    else showPanel('menu-pvp');
});
document.getElementById('btn-pvp-back').addEventListener('click', () => showPanel('menu-char-select'));
document.getElementById('btn-pvp-connect').addEventListener('click', () => {
    const url  = document.getElementById('pvp-server-url').value.trim() || 'ws://192.168.0.107:8080';
    const name = document.getElementById('pvp-name').value.trim() || 'SPARTAN';
    startPvpMode(url, name, selectedModelId);
});
document.getElementById('pvp-name').addEventListener('keydown', e => { if (e.key==='Enter') document.getElementById('btn-pvp-connect').click(); });

// ═══════════════════════════════════════════════════
//  DAMAGE UI — Floating numbers, block flash, kill feed
// ═══════════════════════════════════════════════════
class DamageUI {
    constructor() {
        this.flashEl      = document.getElementById('hit-flash');
        this.blockFlashEl = document.getElementById('block-flash');
        this.indicatorsEl = document.getElementById('damage-indicators');
        this.numbersEl    = document.getElementById('damage-numbers');
        this.deathScreen  = document.getElementById('death-screen');
        this.countdownEl  = document.getElementById('respawn-countdown');
        this.progressEl   = document.getElementById('respawn-progress');
        this.killerEl     = document.getElementById('respawn-killer');
        this.killFeedEl   = document.getElementById('kill-feed');
        this._countdownInterval = null;
        this._isDead = false;

        // Block indicator
        this.blockIndicator = document.getElementById('block-indicator');
        document.addEventListener('player-blocked-bullet', () => this.showBlockDeflect());
    }

    showHit(amount, attackerWorldPos, playerPos, playerYaw) {
        if (this._isDead) return;
        // Red vignette flash
        this.flashEl.classList.remove('flash-active');
        void this.flashEl.offsetWidth;
        this.flashEl.classList.add('flash-active');
        // Directional arrow
        if (attackerWorldPos && playerPos) {
            const dx = attackerWorldPos.x - playerPos.x, dz = attackerWorldPos.z - playerPos.z;
            if (Math.sqrt(dx*dx + dz*dz) > 1) {
                const cos = Math.cos(-playerYaw), sin = Math.sin(-playerYaw);
                this._spawnIndicator(Math.atan2(dx*cos - dz*sin, -(dx*sin + dz*cos)));
            }
        }
        // Floating damage number — self damage (red), centre-ish
        this._spawnDmgNumber(amount, innerWidth * 0.5 + (Math.random()-0.5)*80, innerHeight * 0.42, 'self');
    }

    /** Called when a remote player is hit — shows floating number at screen-projected position */
    showHitConfirm(amount, targetWorldPos) {
        // Project world pos to screen
        if (!_pvpCamera) { this._spawnDmgNumber(amount, innerWidth*0.5, innerHeight*0.4, 'hit'); return; }
        const ndc = targetWorldPos.clone().project(_pvpCamera);
        const sx  = (ndc.x * 0.5 + 0.5) * innerWidth;
        const sy  = (-ndc.y * 0.5 + 0.5) * innerHeight;
        if (ndc.z < 1) this._spawnDmgNumber(amount, sx + (Math.random()-0.5)*30, sy - 20, 'hit');
    }

    showBlockDeflect() {
        // Cyan block flash
        this.blockFlashEl.classList.remove('flash-active');
        void this.blockFlashEl.offsetWidth;
        this.blockFlashEl.classList.add('flash-active');
        // "BLOCKED!" text
        this._spawnDmgNumber('BLOCKED', innerWidth*0.5, innerHeight*0.38, 'block-deflect');
    }

    _spawnDmgNumber(text, x, y, cls) {
        if (!this.numbersEl) return;
        const el = document.createElement('div');
        el.className = `dmg-number ${cls}`;
        el.textContent = typeof text === 'number' ? `-${text}` : text;
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
        this.numbersEl.appendChild(el);
        setTimeout(() => el.remove(), 1300);
    }

    _spawnIndicator(angle) {
        const R = Math.min(innerWidth, innerHeight) * 0.38;
        const el = document.createElement('div');
        el.className = 'dmg-indicator';
        el.style.left = `${innerWidth/2 + R * Math.sin(angle)}px`;
        el.style.top  = `${innerHeight/2 - R * Math.cos(angle)}px`;
        el.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
        this.indicatorsEl.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }

    /** Add entry to kill feed. isLocalKill = local player got the kill. */
    addKillFeed(killerName, victimName, isLocalKill, isLocalDeath) {
        if (!this.killFeedEl) return;
        const el = document.createElement('div');
        el.className = `kill-entry${isLocalKill ? ' local-kill' : ''}${isLocalDeath ? ' local-victim' : ''}`;
        el.innerHTML = `
            <span class="kill-attacker${isLocalKill ? ' local' : ''}">${killerName}</span>
            <span class="kill-weapon">⚡</span>
            <span class="kill-victim${isLocalDeath ? ' local' : ''}">${victimName}</span>`;
        this.killFeedEl.appendChild(el);
        // Keep at most 5 entries
        while (this.killFeedEl.children.length > 5) this.killFeedEl.removeChild(this.killFeedEl.firstChild);
        setTimeout(() => el.remove(), 4000);
    }

    /** Show / hide the 🛡 block indicator (bottom centre) */
    setBlocking(active) {
        if (this.blockIndicator) this.blockIndicator.classList.toggle('active', active);
    }

    showDeath(secs, label, onRespawn) {
        this._isDead = true;
        if (this.killerEl) this.killerEl.textContent = label || '';
        this.deathScreen.style.display = 'flex';
        this.progressEl.style.transition = 'none';
        this.progressEl.style.width = '100%';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.progressEl.style.transition = `width ${secs}s linear`;
            this.progressEl.style.width = '0%';
        }));
        let rem = secs; this.countdownEl.textContent = rem; clearInterval(this._countdownInterval);
        this._countdownInterval = setInterval(() => {
            rem--; this.countdownEl.textContent = rem;
            if (rem <= 0) { clearInterval(this._countdownInterval); this.hideDeath(); onRespawn(); }
        }, 1000);
    }

    hideDeath() { this._isDead = false; this.deathScreen.style.display = 'none'; clearInterval(this._countdownInterval); }
}
const damageUI = new DamageUI();

// Camera ref for world→screen projection of damage numbers
let _pvpCamera = null;

// ═══════════════════════════════════════════════════
//  SCOREBOARD — TAB to toggle, tracks kills/deaths
// ═══════════════════════════════════════════════════
const scoreBoard = {
    localKills:  0,
    localDeaths: 0,
    _visible:    false,
    _el:         null,

    init() {
        // Inject scoreboard element dynamically so it doesn't clutter HTML
        const el = document.createElement('div');
        el.id = 'scoreboard';
        el.style.cssText = `
            display:none; position:fixed; inset:0; z-index:80;
            align-items:center; justify-content:center;
            background:rgba(0,0,0,0.72); backdrop-filter:blur(4px); pointer-events:none;
        `;
        el.innerHTML = `
            <div style="min-width:480px;max-width:90vw;font-family:'Courier New',monospace;">
                <div style="text-align:center;margin-bottom:18px;">
                    <div style="font-size:11px;letter-spacing:6px;color:rgba(0,255,204,0.5);margin-bottom:4px;">PRESS TAB TO CLOSE</div>
                    <div style="font-size:22px;font-weight:900;letter-spacing:8px;color:#00ffcc;text-shadow:0 0 16px #00ffcc;">SCOREBOARD</div>
                </div>
                <div style="border:1px solid rgba(0,255,204,0.2);overflow:hidden;">
                    <div style="display:grid;grid-template-columns:1fr 80px 80px 80px;gap:0;background:rgba(0,255,204,0.08);padding:8px 14px;font-size:10px;letter-spacing:3px;color:rgba(0,255,204,0.5);border-bottom:1px solid rgba(0,255,204,0.15);">
                        <span>CALLSIGN</span><span style="text-align:center;">HP</span><span style="text-align:center;">KILLS</span><span style="text-align:center;">DEATHS</span>
                    </div>
                    <div id="scoreboard-rows"></div>
                </div>
            </div>`;
        document.getElementById('ui-layer').appendChild(el);
        this._el = el;

        window.addEventListener('keydown', e => {
            if (e.code !== 'Tab') return;
            e.preventDefault();
            if (gameMode !== 'pvp' && gameMode !== 'dev') return;
            this._visible = !this._visible;
            el.style.display = this._visible ? 'flex' : 'none';
            if (this._visible) this.refresh();
        });
    },

    addKill()  { this.localKills++;  },
    addDeath() { this.localDeaths++; },

    refresh() {
        const rows = document.getElementById('scoreboard-rows');
        if (!rows) return;
        rows.innerHTML = '';

        const addRow = (name, hp, kills, deaths, isLocal, isDead) => {
            const r = document.createElement('div');
            const hpCol  = hp > 60 ? '#00ffcc' : hp > 25 ? '#ffaa00' : '#ff3333';
            const nameCol = isLocal ? '#00ffff' : 'rgba(255,255,255,0.8)';
            r.style.cssText = `display:grid;grid-template-columns:1fr 80px 80px 80px;padding:10px 14px;
                font-size:13px;letter-spacing:2px;border-bottom:1px solid rgba(255,255,255,0.05);
                background:${isLocal ? 'rgba(0,40,30,0.4)' : 'transparent'};
                opacity:${isDead ? 0.4 : 1};`;
            r.innerHTML = `
                <span style="color:${nameCol};font-weight:${isLocal?'bold':'normal'};">
                    ${isLocal ? '▶ ' : ''}${name}${isDead ? ' <span style="color:#ff3333;font-size:10px;">[DEAD]</span>' : ''}
                </span>
                <span style="text-align:center;color:${hpCol};">${isDead ? '0' : hp}</span>
                <span style="text-align:center;color:#00ffcc;">${kills}</span>
                <span style="text-align:center;color:#ff6666;">${deaths}</span>`;
            rows.appendChild(r);
        };

        // Local player first
        const localHp = player ? Math.round(player.health.currentHealth) : 0;
        const localName = network ? network.playerName : (player ? player.modelId.toUpperCase() : 'YOU');
        addRow(localName, localHp, this.localKills, this.localDeaths, true, player?.health?.isDead);

        // Remote players
        if (network) {
            network.remotePlayers.forEach((rp) => {
                addRow(rp.name || rp.id, Math.round(rp.health), rp._kills || 0, rp._deaths || 0, false, rp.isDead);
            });
        }
        // Dev mode enemy
        if (gameMode === 'dev' && enemy) {
            const eHp = Math.round(enemy.health.currentHealth);
            addRow('AI T-800', eHp, 0, 0, false, enemy.health.isDead);
        }
    },
};
scoreBoard.init();

// ═══════════════════════════════════════════════════
//  TUNER
// ═══════════════════════════════════════════════════
const tunerIds=['scale','px','py','pz','rx','ry','rz','s0x','s0y','s0z','s1x','s1y','s1z','s2x','s2y','s2z','bx','by','bz','bh'];
function initTuner() {
    tunerIds.forEach(id=>{
        const s=document.getElementById('tune-'+id), n=document.getElementById('tune-'+id+'-num'); if(!s||!n) return;
        const sync=e=>{const v=parseFloat(e.target.value);s.value=v;n.value=v;applyTuner();};
        s.addEventListener('input',sync); n.addEventListener('input',sync);
    });
    // Gun spawn inputs
    ['x','y','z'].forEach(axis => {
        const s = document.getElementById('tune-gs-'+axis);
        const n = document.getElementById('tune-gs-'+axis+'-num');
        if (s && n) {
            const sync = e => { const v=parseFloat(e.target.value); s.value=v; n.value=v; applyTuner(); };
            s.addEventListener('input', sync); n.addEventListener('input', sync);
        }
    });
    const cb = document.getElementById('tune-gs-fromBarrel');
    if (cb) cb.addEventListener('change', () => {
        const lbl = document.getElementById('tune-gs-fromBarrel-label');
        if (lbl) lbl.textContent = cb.checked ? 'ON' : 'OFF';
        applyTuner();
    });
}
function refreshTunerUI() {
    if (!player) return;
    const wt  = player.weaponManager.currentType;
    const cfg = player.weaponManager.weapons[wt].config;
    const set = (id,v) => { const s=document.getElementById('tune-'+id), n=document.getElementById('tune-'+id+'-num'); if(s&&n){s.value=v;n.value=parseFloat(v).toFixed(3);} };
    set('scale', cfg.SCALE); set('px', cfg.POS[0]); set('py', cfg.POS[1]); set('pz', cfg.POS[2]);
    set('rx', cfg.ROT[0]);   set('ry', cfg.ROT[1]); set('rz', cfg.ROT[2]);
    // Bullet spawn — gun only
    const bulletSection = document.getElementById('tune-bullet-section');
    if (bulletSection) bulletSection.style.display = wt === 'gun' ? 'block' : 'none';
    if (wt === 'gun') {
        const bo = cfg.BULLET_OFFSET || [0, 0, -5];
        set('bx', bo[0]); set('by', bo[1]); set('bz', bo[2]);
        set('bh', cfg.BULLET_HEIGHT_OFFSET ?? 8);
    }
    if (wt === 'melee') {
        const swings = cfg.SWINGS;
        if (swings && swings[0]) {
            const addr = swings[0].address;
            ['s0x','s0y','s0z','s1x','s1y','s1z','s2x','s2y','s2z'].forEach((id, i) => {
                const boneIdx = Math.floor(i/3), axis = i%3;
                set(id, addr[boneIdx] ? addr[boneIdx][axis] : 0);
            });
        }
    } else {
        ['0','1','2'].forEach(i=>{set(`s${i}x`,0);set(`s${i}y`,0);set(`s${i}z`,0);});
    }
    generateTunerCode();
}
function applyTuner() {
    if (!player) return;
    const wt   = player.weaponManager.currentType;
    const cfg  = player.weaponManager.weapons[wt].config;
    const mesh = player.weaponManager.weapons[wt].mesh;
    const g    = id => { const el=document.getElementById('tune-'+id); return el ? parseFloat(el.value) : 0; };
    cfg.SCALE = g('scale');
    cfg.POS   = [g('px'), g('py'), g('pz')];
    cfg.ROT   = [g('rx'), g('ry'), g('rz')];
    if (mesh) { mesh.scale.setScalar(cfg.SCALE); mesh.position.set(...cfg.POS); mesh.rotation.set(...cfg.ROT); }
    if (wt === 'gun') {
        cfg.BULLET_OFFSET        = [g('bx'), g('by'), g('bz')];
        cfg.BULLET_HEIGHT_OFFSET = g('bh');
    }
    if (wt === 'melee' && cfg.SWINGS && cfg.SWINGS[0]) {
        const addr = cfg.SWINGS[0].address;
        [[0,g('s0x'),g('s0y'),g('s0z')],[1,g('s1x'),g('s1y'),g('s1z')],[2,g('s2x'),g('s2y'),g('s2z')]].forEach(([i,x,y,z])=>{
            if (addr[i]) { addr[i][0]=x; addr[i][1]=y; addr[i][2]=z; }
        });
    }
    generateTunerCode();
}
function generateTunerCode() {
    if (!player) return;
    const wt  = player.weaponManager.currentType;
    const cfg = player.weaponManager.weapons[wt].config;
    const mid = player.modelId;
    const f   = n => parseFloat(n).toFixed(3);
    let code = `// Model: ${mid}  Weapon: ${wt.toUpperCase()}\n`;
    code += `weapons: {\n  ${wt}: {\n`;
    code += `    SCALE: ${f(cfg.SCALE)},\n`;
    code += `    POS:   [${cfg.POS.map(f).join(', ')}],\n`;
    code += `    ROT:   [${cfg.ROT.map(f).join(', ')}],\n`;
    if (wt === 'gun') {
        const bo = cfg.BULLET_OFFSET || [0,0,-5];
        code += `    BULLET_OFFSET:        [${bo.map(f).join(', ')}],\n`;
        code += `    BULLET_HEIGHT_OFFSET: ${f(cfg.BULLET_HEIGHT_OFFSET ?? 8)},\n`;
    }
    if (wt === 'melee' && cfg.RANGE       != null) code += `    RANGE: ${cfg.RANGE},\n`;
    if (wt === 'melee' && cfg.DAMAGE      != null) code += `    DAMAGE: ${cfg.DAMAGE},\n`;
    if (wt === 'melee' && cfg.SWING_SPEED != null) code += `    SWING_SPEED: ${cfg.SWING_SPEED},\n`;
    code += `  }\n}`;
    document.getElementById('tuner-code').innerText = code;
}
window.addEventListener('keydown', e=>{ if((e.code==='Digit1'||e.code==='Digit2')&&inputManager.isNoclip) setTimeout(refreshTunerUI,50); });

// ── Tab switching ─────────────────────────────────────────────
let activeTunerTab = 'weapon';
window.switchTunerTab = function(tab) {
    activeTunerTab = tab;
    const tabs   = ['weapon', 'melee', 'physics'];
    const colors = { weapon:'#ffaa00', melee:'#ff6600', physics:'#00ffcc' };
    tabs.forEach(t => {
        const panel = document.getElementById('tuner-tab-'+t);
        const btn   = document.getElementById('tab-btn-'+t);
        if (!panel || !btn) return;
        const active = tab === t;
        panel.style.display  = active ? 'block' : 'none';
        btn.style.background = active ? colors[t] : '#333';
        btn.style.color      = active ? 'black'   : '#aaa';
        btn.style.border     = active ? 'none'    : '1px solid #555';
    });
    if (tab === 'weapon')  refreshTunerUI();
    if (tab === 'melee')   refreshMeleeTuner();
    if (tab === 'physics') refreshPhysicsTuner();
};

// ── Melee damage-box tuner ────────────────────────────────────
const meleeIds = ['damage','range','fireRate',
                  'dbOffX','dbOffY','dbOffZ',
                  'dbSzX','dbSzY','dbSzZ',
                  'dbWinStart','dbWinEnd'];

function initMeleeTuner() {
    meleeIds.forEach(id => {
        const s = document.getElementById('mt-'+id);
        const n = document.getElementById('mt-'+id+'-num');
        if (!s || !n) return;
        const sync = e => { const v=parseFloat(e.target.value); s.value=v; n.value=v; applyMeleeTuner(); };
        s.addEventListener('input', sync);
        n.addEventListener('input', sync);
    });
}

function refreshMeleeTuner() {
    if (!player) return;
    const cfg = player.weaponManager.weapons.melee.config;
    const db  = cfg.damageBox || {};
    const set = (id, v) => {
        const s = document.getElementById('mt-'+id);
        const n = document.getElementById('mt-'+id+'-num');
        if (s && n) { s.value = v; n.value = parseFloat(v).toFixed(3); }
    };
    set('damage',     cfg.DAMAGE      ?? 50);
    set('range',      cfg.RANGE       ?? 20);
    set('fireRate',   cfg.FIRE_RATE   ?? 0.4);
    set('dbOffX',    (db.offset??[0,0,-8])[0]);
    set('dbOffY',    (db.offset??[0,0,-8])[1]);
    set('dbOffZ',    (db.offset??[0,0,-8])[2]);
    set('dbSzX',     (db.size??[4,4,14])[0]);
    set('dbSzY',     (db.size??[4,4,14])[1]);
    set('dbSzZ',     (db.size??[4,4,14])[2]);
    set('dbWinStart', db.hitWindowStart ?? 0.25);
    set('dbWinEnd',   db.hitWindowEnd   ?? 0.72);
    generateMeleeCode();
}

function applyMeleeTuner() {
    if (!player) return;
    const cfg = player.weaponManager.weapons.melee.config;
    const g   = id => { const el=document.getElementById('mt-'+id); return el ? parseFloat(el.value) : 0; };
    cfg.DAMAGE    = g('damage');
    cfg.RANGE     = g('range');
    cfg.FIRE_RATE = g('fireRate');
    if (!cfg.damageBox) cfg.damageBox = {};
    cfg.damageBox.offset         = [g('dbOffX'), g('dbOffY'), g('dbOffZ')];
    cfg.damageBox.size           = [g('dbSzX'),  g('dbSzY'),  g('dbSzZ')];
    cfg.damageBox.hitWindowStart = g('dbWinStart');
    cfg.damageBox.hitWindowEnd   = g('dbWinEnd');
    generateMeleeCode();
}

function generateMeleeCode() {
    if (!player) return;
    const cfg = player.weaponManager.weapons.melee.config;
    const db  = cfg.damageBox || {};
    const mid = player.modelId;
    const f   = v => parseFloat(v).toFixed(3);
    const off = db.offset || [0,0,-8];
    const sz  = db.size   || [4,4,14];
    let code  = `// Model: ${mid}  Weapon: MELEE\n`;
    code += `melee: {\n`;
    code += `    DAMAGE:    ${f(cfg.DAMAGE   ?? 50)},\n`;
    code += `    RANGE:     ${f(cfg.RANGE    ?? 20)},\n`;
    code += `    FIRE_RATE: ${f(cfg.FIRE_RATE ?? 0.4)},\n`;
    code += `    damageBox: {\n`;
    code += `        offset:         [${off.map(f).join(', ')}],\n`;
    code += `        size:           [${sz.map(f).join(', ')}],\n`;
    code += `        hitWindowStart: ${f(db.hitWindowStart ?? 0.25)},\n`;
    code += `        hitWindowEnd:   ${f(db.hitWindowEnd   ?? 0.72)},\n`;
    code += `    },\n}`;
    document.getElementById('tuner-code').innerText = code;
}

// ── Physics tuner ─────────────────────────────────────────────
const physIds = ['walkSpeed','runMultiplier','stepRate','gravity','jumpStrength',
                 'stepUp','stepDown','cameraPivotY',
                 'camOffsetX','camOffsetY','camOffsetZ','camLookAtZ',
                 'hitboxCY','hitboxX','hitboxY','hitboxZ'];

function initPhysicsTuner() {
    physIds.forEach(id => {
        const s = document.getElementById('phys-'+id);
        const n = document.getElementById('phys-'+id+'-num');
        if (!s || !n) return;
        const sync = e => { const v = parseFloat(e.target.value); s.value = v; n.value = v; applyPhysicsTuner(); };
        s.addEventListener('input', sync);
        n.addEventListener('input', sync);
    });
}

function refreshPhysicsTuner() {
    if (!player) return;
    const p   = player.sizeConfig;  // live reference to entry.physics
    const set = (id, v) => {
        const s = document.getElementById('phys-'+id), n = document.getElementById('phys-'+id+'-num');
        if (s && n) { s.value = v; n.value = parseFloat(v).toFixed(3); }
    };
    set('walkSpeed',     p.walkSpeed);
    set('runMultiplier', p.runMultiplier);
    set('stepRate',      p.stepRate);
    set('gravity',       p.gravity);
    set('jumpStrength',  p.jumpStrength);
    set('stepUp',        p.stepUp);
    set('stepDown',      p.stepDown);
    set('cameraPivotY',  p.cameraPivotY);
    set('camOffsetX',    p.camOffset.x);
    set('camOffsetY',    p.camOffset.y);
    set('camOffsetZ',    p.camOffset.z);
    set('camLookAtZ',    p.camLookAt.z);
    set('hitboxCY',      p.hitboxCenterOffsetY);
    set('hitboxX',       p.hitboxSize.x);
    set('hitboxY',       p.hitboxSize.y);
    set('hitboxZ',       p.hitboxSize.z);
    generatePhysicsCode();
}

function applyPhysicsTuner() {
    if (!player) return;
    const p = player.sizeConfig;  // write directly to live entry.physics
    const g = id => { const el = document.getElementById('phys-'+id); return el ? parseFloat(el.value) : 0; };

    p.walkSpeed           = g('walkSpeed');
    p.runMultiplier       = g('runMultiplier');
    p.stepRate            = g('stepRate');
    p.gravity             = g('gravity');
    p.jumpStrength        = g('jumpStrength');
    p.stepUp              = g('stepUp');
    p.stepDown            = g('stepDown');
    p.cameraPivotY        = g('cameraPivotY');
    p.camOffset.x         = g('camOffsetX');
    p.camOffset.y         = g('camOffsetY');
    p.camOffset.z         = g('camOffsetZ');
    p.camLookAt.z         = g('camLookAtZ');
    p.hitboxCenterOffsetY = g('hitboxCY');
    p.hitboxSize.x        = g('hitboxX');
    p.hitboxSize.y        = g('hitboxY');
    p.hitboxSize.z        = g('hitboxZ');

    // Apply camera pivot immediately (mounted on the mesh)
    if (player.cameraPivot) player.cameraPivot.position.y = p.cameraPivotY;

    // Re-sync Character cached values from the live config
    player.baseWalkSpeed      = p.walkSpeed;
    player.runSpeedMultiplier = p.runMultiplier;
    player.gravity            = p.gravity;
    player.jumpStrength       = p.jumpStrength;
    player.stepRate           = p.stepRate;

    generatePhysicsCode();
}

function generatePhysicsCode() {
    if (!player) return;
    const p   = player.sizeConfig;
    const mid = player.modelId;
    const f   = v => parseFloat(v).toFixed(3);
    let code = `// Model: ${mid}\nphysics: {\n`;
    code += `  height: ${f(p.height)}, width: ${f(p.width)},\n`;
    code += `  walkSpeed:      ${f(p.walkSpeed)},\n`;
    code += `  runMultiplier:  ${f(p.runMultiplier)},\n`;
    code += `  stepRate:       ${f(p.stepRate)},\n`;
    code += `  gravity:        ${f(p.gravity)},\n`;
    code += `  jumpStrength:   ${f(p.jumpStrength)},\n`;
    code += `  stepUp:         ${f(p.stepUp)},\n`;
    code += `  stepDown:       ${f(p.stepDown)},\n`;
    code += `  hitboxCenterOffsetY: ${f(p.hitboxCenterOffsetY)},\n`;
    code += `  hitboxSize: { x: ${f(p.hitboxSize.x)}, y: ${f(p.hitboxSize.y)}, z: ${f(p.hitboxSize.z)} },\n`;
    code += `  cameraPivotY:   ${f(p.cameraPivotY)},\n`;
    code += `  camOffset: { x: ${f(p.camOffset.x)}, y: ${f(p.camOffset.y)}, z: ${f(p.camOffset.z)} },\n`;
    code += `  camLookAt: { x: 0, y: 0, z: ${f(p.camLookAt.z)} },\n}`;
    document.getElementById('tuner-code').innerText = code;
}

// ═══════════════════════════════════════════════════
//  PVP HUD HELPERS
// ═══════════════════════════════════════════════════
function updatePvpHealthPanel() {
    if (gameMode !== 'pvp' || !player) return;
    const hp  = Math.max(0, Math.round(player.health.currentHealth));
    const pct = hp / player.health.maxHealth * 100;
    const valEl  = document.getElementById('pvp-health-value');
    const fillEl = document.getElementById('pvp-health-bar-fill');
    if (!valEl || !fillEl) return;
    valEl.textContent = hp;
    fillEl.style.width = pct + '%';
    // Colour tiers
    valEl.classList.toggle('low',  hp <= 60 && hp > 25);
    valEl.classList.toggle('crit', hp <= 25);
    fillEl.style.background = hp > 60
        ? 'linear-gradient(to right,#00ffcc,#00cc88)'
        : hp > 25
        ? 'linear-gradient(to right,#ffaa00,#ff6600)'
        : 'linear-gradient(to right,#ff2222,#cc0000)';
    fillEl.style.boxShadow = hp > 60 ? '0 0 8px #00ffcc'
        : hp > 25 ? '0 0 8px #ffaa00' : '0 0 8px #ff2222';
}

function updatePvpWeaponCards(type) {
    const gunCard   = document.getElementById('pvp-wep-gun');
    const meleeCard = document.getElementById('pvp-wep-melee');
    if (!gunCard || !meleeCard) return;
    gunCard.classList.toggle('active',   type === 'gun');
    meleeCard.classList.toggle('active', type === 'melee');
    // Also sync old-style dev slots if present
    const g = document.getElementById('ui-wep-gun');
    const m = document.getElementById('ui-wep-melee');
    if (g && m) { g.classList.toggle('active', type==='gun'); m.classList.toggle('active', type==='melee'); }
}

function updatePvpPlayerCount() {
    if (!network) return;
    const n = network.remotePlayers.size + 1;
    const el = document.getElementById('pvp-count');
    if (el) el.textContent = `${n} ONLINE`;
}

let _netAlertTimer = null;
function showNetAlert(msg) {
    const el = document.getElementById('net-alert');
    if (!el) return;
    el.textContent = msg; el.style.opacity = '1';
    clearTimeout(_netAlertTimer);
    _netAlertTimer = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// ═══════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════
function loadMap(url, scale=1, onDone=null) {
    mapLoader=new MapLoader(scene); document.getElementById('loading-status').textContent='Loading map…';
    mapLoader.load(url,{scale,onProgress:pct=>{document.getElementById('loading-status').textContent=`Loading map… ${pct}%`;}})
        .then(()=>{gridHelper.visible=false;document.getElementById('loading-status').textContent='';if(onDone)onDone();})
        .catch(()=>{document.getElementById('loading-status').textContent='Map load failed';if(onDone)onDone();});
}
function initHitboxHelpers() {
    if(playerBoxHelper) scene.remove(playerBoxHelper);
    playerBoxHelper=new THREE.Box3Helper(player.boundingBox,0x00ffcc); playerBoxHelper.visible=false; scene.add(playerBoxHelper);
    if(enemy&&gameMode==='dev'){if(enemyBoxHelper)scene.remove(enemyBoxHelper);enemyBoxHelper=new THREE.Box3Helper(enemy.boundingBox,0xff3300);enemyBoxHelper.visible=false;scene.add(enemyBoxHelper);}
    // Melee damage box — bright orange when active, dim when inactive
    if(meleeBoxHelper) scene.remove(meleeBoxHelper);
    meleeBoxHelper = new THREE.Box3Helper(player.meleeHitBox, 0xff6600);
    meleeBoxHelper.visible = false;
    scene.add(meleeBoxHelper);
}
function respawnPlayer() {
    if (!player) return;
    player.health.currentHealth=player.health.maxHealth; player.health.isDead=false;
    if(player.health.uiElement) player.health.uiElement.style.width='100%';
    player.mesh.position.set((Math.random()-0.5)*100, 5, (Math.random()-0.5)*100);
    _camReady = false; _charMaterials = null;  // reset spring arm on respawn
    player.isJumping=false; player.yVelocity=0; player.currentUltimate=null;
    player.meleeAttacking=false; player.meleeAttackAction=null; player.meleeHitBoxActive=false;
    const c=player.mesh.position.clone(); const sc=player.sizeConfig;
    c.y+=sc.hitboxCenterOffsetY;
    player.boundingBox.setFromCenterAndSize(c,new THREE.Vector3(sc.hitboxSize.x,sc.hitboxSize.y,sc.hitboxSize.z));
    deathHandled=false;
}
function wirePlayerDamage() {
    if (!player) return;
    player.health.onDamage=(amount,sourcePos)=>{
        damageUI.showHit(amount,sourcePos||null,player.mesh.position,player.mesh.rotation.y);
        player.playHitReaction?.();       // ← play hit_body anim on local player
        updatePvpHealthPanel();           // ← sync new health panel numbers
    };
}

// ═══════════════════════════════════════════════════
//  START MODES
// ═══════════════════════════════════════════════════
function startDevMode(modelId) {
    gameMode='dev';
    document.getElementById('main-menu').style.display='none';
    document.getElementById('ui-layer').style.display='block';
    document.getElementById('dev-hud').style.display='block';
    document.getElementById('pvp-hud').style.display='none';
    initTuner(); initPhysicsTuner(); initMeleeTuner(); switchTunerTab('weapon');
    // Request pointer lock on first join
    if (document.pointerLockElement !== document.body) {
        try {
            const lockPromise = document.body.requestPointerLock();
            if (lockPromise && typeof lockPromise.then === 'function') {
                lockPromise.catch(err => {
                    console.warn('Pointer lock denied:', err.message);
                    if (typeof showPointerLockError === 'function') showPointerLockError(err);
                });
            }
        } catch (err) {
            console.warn('Pointer lock error:', err.message);
            if (typeof showPointerLockError === 'function') showPointerLockError(err);
        }
    }
    player=new Character(scene,modelId); enemy=new Enemy(scene,0,-120,modelId); wirePlayerDamage();
    loadMap('maps/battle_guys.glb',1,()=>{
        player.mesh.position.set(0,5,60); enemy.mesh.position.set(0,5,-60);
        player.setCollisionMeshes(mapLoader.collisionMeshes); initHitboxHelpers(); setTimeout(()=>{
            refreshTunerUI();
            const lbl = document.getElementById('tuner-model-label');
            if (lbl) lbl.textContent = 'MODEL: ' + (player ? player.modelId.toUpperCase() : '—');
        },500);
        document.getElementById('toggle-ai-btn').addEventListener('click',e=>{
            enemy.aiEnabled=!enemy.aiEnabled; e.target.innerText=`AI: ${enemy.aiEnabled?'ON':'OFF'}`;
            e.target.style.background=enemy.aiEnabled?'#ffaa00':'#444'; e.target.style.color=enemy.aiEnabled?'black':'white'; e.target.blur();
        });
        document.getElementById('toggle-hitbox-btn').addEventListener('click',e=>{
            showHitbox=!showHitbox; e.target.innerText=showHitbox?'Hide Hitbox':'View Hitbox';
            e.target.style.background=showHitbox?'#00ffcc':'#444'; e.target.style.color=showHitbox?'black':'white'; e.target.blur();
        });
        if(!isRunning){isRunning=true;loop();}
    });
}
function startPvpMode(serverUrl,playerName,modelId) {
    gameMode='pvp';
    document.getElementById('main-menu').style.display='none';
    document.getElementById('ui-layer').style.display='block';
    document.getElementById('connecting-overlay').style.display='flex';
    network=new NetworkManager(scene,serverUrl,playerName,modelId);
    network.connect().then(myId=>{
        // Request pointer lock on first join
        if (document.pointerLockElement !== document.body) {
            try {
                const lockPromise = document.body.requestPointerLock();
                if (lockPromise && typeof lockPromise.then === 'function') {
                    lockPromise.catch(err => {
                        console.warn('Pointer lock denied:', err.message);
                        if (typeof showPointerLockError === 'function') showPointerLockError(err);
                    });
                }
            } catch (err) {
                console.warn('Pointer lock error:', err.message);
                if (typeof showPointerLockError === 'function') showPointerLockError(err);
            }
        }
        document.getElementById('connecting-overlay').style.display='none';
        document.getElementById('dev-hud').style.display='none';
        document.getElementById('pvp-hud').style.display='block';
        document.getElementById('pvp-session-id').textContent=`ID: ${myId}`;

        // Expose camera for world→screen damage number projection
        _pvpCamera = camera;

        network.beamPool=beamPool; network.audioListener=audioManager.listener;

        // ── Damage received ─────────────────────────────────────
        network.onDamage=amount=>{
            if(!player) return;
            player.health.takeDamage(amount);
            updatePvpHealthPanel();
            if(player.health.isDead&&!deathHandled){
                deathHandled=true;
                scoreBoard.addDeath();
                network.reportDead();
                damageUI.showDeath(5,'NEUTRALIZED BY ENEMY',()=>{
                    respawnPlayer();wirePlayerDamage();network.reportRespawn(player.modelId);
                    updatePvpHealthPanel();
                });
            }
        };

        // ── Block feedback ───────────────────────────────────────
        network.onBlocked=()=>{
            damageUI.showBlockDeflect();
        };

        // ── Kill feed ────────────────────────────────────────────
        network.onKillFeed=(killerName, victimName, isLocalKill)=>{
            damageUI.addKillFeed(killerName, victimName, isLocalKill, false);
            if(isLocalKill) {
                scoreBoard.addKill();
            }
        };

        // ── Dead event — track remote stats for scoreboard ───────
        network.onDead=(victimId, killerId)=>{
            if(victimId === network.localId) return; // own death handled via onDamage
            const victim = network.remotePlayers.get(victimId);
            if(victim) victim._deaths = (victim._deaths || 0) + 1;
            if(killerId && killerId !== network.localId) {
                const killer = network.remotePlayers.get(killerId);
                if(killer) killer._kills = (killer._kills || 0) + 1;
            }
            if(scoreBoard._visible) scoreBoard.refresh();
        };

        // ── Join / Leave notifications ───────────────────────────
        network.onPlayerJoin=(id, name)=>{
            updatePvpPlayerCount(); showNetAlert(`${name} JOINED`);
        };
        network.onPlayerLeave=(id, name)=>{
            updatePvpPlayerCount(); showNetAlert(`${name} LEFT`);
        };

        player=new Character(scene,modelId);
        player.mesh.position.set((Math.random()-0.5)*100,5,(Math.random()-0.5)*100);
        wirePlayerDamage();
        updatePvpHealthPanel();
        loadMap('maps/battle_guys.glb',1,()=>{
            player.setCollisionMeshes(mapLoader.collisionMeshes);
            initHitboxHelpers();
            if(!isRunning){isRunning=true;loop();}
        });
    }).catch(err=>{document.getElementById('connecting-msg').textContent=`❌ ${err.message}`;});
}

// ═══════════════════════════════════════════════════
//  MAIN LOOP
// ═══════════════════════════════════════════════════
function loop() {
    requestAnimationFrame(loop);
    const dt=Math.min(clock.getDelta(),0.05);

    // Keep model label and physics tab fresh while noclip is active
    if (inputManager.isNoclip && player) {
        const lbl = document.getElementById('tuner-model-label');
        if (lbl && !lbl._set) { lbl.textContent = 'MODEL: ' + player.modelId.toUpperCase(); lbl._set = true; }
    } else if (!inputManager.isNoclip) {
        const lbl = document.getElementById('tuner-model-label');
        if (lbl) lbl._set = false;
    }
    if (inputManager.isNoclip) {
        camera.quaternion.setFromEuler(new THREE.Euler(inputManager.freecamPitch,inputManager.freecamYaw,0,'YXZ'));
        const spd=50*dt;
        if(inputManager.keys['KeyW']) camera.translateZ(-spd); if(inputManager.keys['KeyS']) camera.translateZ(spd);
        if(inputManager.keys['KeyA']) camera.translateX(-spd); if(inputManager.keys['KeyD']) camera.translateX(spd);
        renderer.render(scene,camera); return;
    }

    if (player) {
        if(mapLoader&&mapLoader.isLoaded) player.snapToGround(mapLoader.collisionMeshes);
        player.update(dt,clock,inputManager,audioManager,{beamPool,enemies:enemy&&!enemy.health.isDead?[enemy]:[],network});

        // ── Spring arm 3rd-person camera ──────────────────────────
        updateSpringCamera(
            player, camera, inputManager,
            mapLoader && mapLoader.isLoaded ? mapLoader.collisionMeshes : []
        );

        if(playerBoxHelper){playerBoxHelper.box.copy(player.boundingBox);playerBoxHelper.visible=showHitbox;}

        // Melee damage box: bright orange = active (hot window), dark = inactive
        if(meleeBoxHelper){
            meleeBoxHelper.box.copy(player.meleeHitBox);
            meleeBoxHelper.material.color.setHex(player.meleeHitBoxActive ? 0xff6600 : 0x442200);
            meleeBoxHelper.visible = showHitbox && player.weaponManager.currentType === 'melee';
        }

        if(gameMode==='dev'&&player.health.isDead&&!deathHandled){
            deathHandled=true;
            damageUI.showDeath(3,'TERMINATED BY AI',()=>{
                respawnPlayer(); wirePlayerDamage();
                if(enemy){enemy.health.currentHealth=enemy.health.maxHealth;enemy.health.isDead=false;enemy.mesh.visible=true;const ti=document.getElementById('target-info');if(ti)ti.style.display='block';}
            });
        }
    }

    if(gameMode==='dev'&&enemy){
        if(mapLoader&&mapLoader.isLoaded){const p=enemy.mesh.position;const ray=new THREE.Raycaster(new THREE.Vector3(p.x,p.y+2,p.z),new THREE.Vector3(0,-1,0));ray.far=10;const hits=ray.intersectObjects(mapLoader.collisionMeshes,false);if(hits.length>0&&hits[0].point.y<=p.y+2)enemy.mesh.position.y=hits[0].point.y;}
        enemy.update(dt,clock,player,beamPool);
        beamPool.update(dt,[enemy],player, mapLoader && mapLoader.isLoaded ? mapLoader.collisionMeshes : []);
        if(enemyBoxHelper){enemyBoxHelper.box.copy(enemy.boundingBox);enemyBoxHelper.visible=showHitbox;}
    }

    if(gameMode==='pvp'&&network){
        network.update(dt,player,inputManager);
        beamPool.update(dt,[],player, mapLoader && mapLoader.isLoaded ? mapLoader.collisionMeshes : []);

        // Sync weapon cards when weapon changes
        if (player) updatePvpWeaponCards(player.weaponManager.currentType);

        // Block indicator
        if (player) damageUI.setBlocking(!!player.isBlocking);

        beamPool.pool.forEach(beam=>{
            if(!beam.userData.active) return;

            // ── Deflected bolts are purely visual — skip all hit checks ──
            if(beam.userData.isDeflected) return;

            // ── Remote beams (fired by other players) — visual only,
            //    but DEFLECT them if local player is blocking ──────────
            if(beam.userData.isRemote) {
                if(player && !player.health.isDead && player.isBlocking &&
                   player.weaponManager?.currentType==='melee' &&
                   player.boundingBox.containsPoint(beam.position)) {
                    beamPool._deflect(beam, player);
                }
                return;
            }

            // Skip enemy-team beams (dev mode AI — handled by beamPool.update above)
            if(beam.userData.isEnemy) return;

            // ── Local outgoing beams — check remote player hits ───────
            const segStart = beam.userData.segStart || beam.userData.prevPos || beam.position;
            const segEnd   = beam.position;
            const segVec   = segEnd.clone().sub(segStart);
            const segLen   = segVec.length();
            const ray      = segLen > 1e-6 ? new THREE.Ray(segStart.clone(), segVec.clone().divideScalar(segLen)) : null;

            network.remotePlayers.forEach((rp,id)=>{
                if(rp.isDead || !rp.boundingBox) return;
                if(!ray) return;
                const hitPoint = rp.boundingBox.intersectRay(ray, new THREE.Vector3());
                const hitInSeg = !!hitPoint && hitPoint.distanceTo(segStart) <= segLen + 1e-4;
                if(hitInSeg){
                    const hit = network.reportHit(id, 20);
                    beam.visible=false; beam.userData.active=false;
                    if(hit) damageUI.showHitConfirm(20, rp.mesh.position.clone());
                }
            });
        });
        updatePvpPlayerCount();
    }

    renderer.render(scene,camera);
}
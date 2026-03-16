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
let playerBoxHelper = null, enemyBoxHelper = null, showHitbox = false, deathHandled = false;
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
//  DAMAGE UI
// ═══════════════════════════════════════════════════
class DamageUI {
    constructor() {
        this.flashEl=document.getElementById('hit-flash'); this.indicatorsEl=document.getElementById('damage-indicators');
        this.deathScreen=document.getElementById('death-screen'); this.countdownEl=document.getElementById('respawn-countdown');
        this.progressEl=document.getElementById('respawn-progress'); this.killerEl=document.getElementById('respawn-killer');
        this._countdownInterval=null; this._isDead=false;
    }
    showHit(amount, attackerWorldPos, playerPos, playerYaw) {
        if (this._isDead) return;
        this.flashEl.classList.remove('flash-active'); void this.flashEl.offsetWidth; this.flashEl.classList.add('flash-active');
        if (attackerWorldPos && playerPos) {
            const dx=attackerWorldPos.x-playerPos.x, dz=attackerWorldPos.z-playerPos.z;
            if (Math.sqrt(dx*dx+dz*dz)>1) {
                const cos=Math.cos(-playerYaw), sin=Math.sin(-playerYaw);
                this._spawnIndicator(Math.atan2(dx*cos-dz*sin, -(dx*sin+dz*cos)));
            }
        }
    }
    _spawnIndicator(angle) {
        const R=Math.min(innerWidth,innerHeight)*0.38, el=document.createElement('div');
        el.className='dmg-indicator'; el.style.left=`${innerWidth/2+R*Math.sin(angle)}px`; el.style.top=`${innerHeight/2-R*Math.cos(angle)}px`;
        el.style.transform=`translate(-50%,-50%) rotate(${angle}rad)`; this.indicatorsEl.appendChild(el); setTimeout(()=>el.remove(),1200);
    }
    showDeath(secs, label, onRespawn) {
        this._isDead=true; if(this.killerEl) this.killerEl.textContent=label||'';
        this.deathScreen.style.display='flex'; this.progressEl.style.transition='none'; this.progressEl.style.width='100%';
        requestAnimationFrame(()=>requestAnimationFrame(()=>{ this.progressEl.style.transition=`width ${secs}s linear`; this.progressEl.style.width='0%'; }));
        let rem=secs; this.countdownEl.textContent=rem; clearInterval(this._countdownInterval);
        this._countdownInterval=setInterval(()=>{ rem--; this.countdownEl.textContent=rem; if(rem<=0){clearInterval(this._countdownInterval);this.hideDeath();onRespawn();} },1000);
    }
    hideDeath() { this._isDead=false; this.deathScreen.style.display='none'; clearInterval(this._countdownInterval); }
}
const damageUI = new DamageUI();

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
    document.getElementById('tuner-tab-weapon').style.display  = tab === 'weapon'  ? 'block' : 'none';
    document.getElementById('tuner-tab-physics').style.display = tab === 'physics' ? 'block' : 'none';
    document.getElementById('tab-btn-weapon').style.background  = tab === 'weapon'  ? '#ffaa00' : '#333';
    document.getElementById('tab-btn-weapon').style.color       = tab === 'weapon'  ? 'black'   : '#aaa';
    document.getElementById('tab-btn-physics').style.background = tab === 'physics' ? '#00ffcc' : '#333';
    document.getElementById('tab-btn-physics').style.color      = tab === 'physics' ? 'black'   : '#aaa';
    document.getElementById('tab-btn-weapon').style.border      = tab === 'weapon'  ? 'none' : '1px solid #555';
    document.getElementById('tab-btn-physics').style.border     = tab === 'physics' ? 'none' : '1px solid #555';
    if (tab === 'weapon')  { refreshTunerUI(); }
    if (tab === 'physics') { refreshPhysicsTuner(); }
};

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
}
function respawnPlayer() {
    if (!player) return;
    player.health.currentHealth=player.health.maxHealth; player.health.isDead=false;
    if(player.health.uiElement) player.health.uiElement.style.width='100%';
    player.mesh.position.set((Math.random()-0.5)*100, 5, (Math.random()-0.5)*100);
    player.isJumping=false; player.yVelocity=0; player.currentUltimate=null; player.isSwinging=false; player.swingProgress=0;
    const c=player.mesh.position.clone(); const sc=player.sizeConfig;
    c.y+=sc.hitboxCenterOffsetY;
    player.boundingBox.setFromCenterAndSize(c,new THREE.Vector3(sc.hitboxSize.x,sc.hitboxSize.y,sc.hitboxSize.z));
    deathHandled=false;
}
function wirePlayerDamage() {
    if (!player) return;
    player.health.onDamage=(amount,sourcePos)=>damageUI.showHit(amount,sourcePos||null,player.mesh.position,player.mesh.rotation.y);
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
    initTuner(); initPhysicsTuner(); switchTunerTab('weapon');
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
        document.getElementById('connecting-overlay').style.display='none';
        document.getElementById('dev-hud').style.display='none'; document.getElementById('pvp-hud').style.display='block';
        document.getElementById('pvp-id').textContent=`ID: ${myId}`;
        network.beamPool=beamPool; network.audioListener=audioManager.listener;
        network.onDamage=amount=>{
            if(!player) return;
            player.health.takeDamage(amount);
            if(player.health.isDead&&!deathHandled){
                deathHandled=true; network.reportDead();
                damageUI.showDeath(5,'NEUTRALIZED BY ENEMY',()=>{respawnPlayer();wirePlayerDamage();network.reportRespawn(player.modelId);});
            }
        };
        player=new Character(scene,modelId); player.mesh.position.set((Math.random()-0.5)*100,5,(Math.random()-0.5)*100); wirePlayerDamage();
        loadMap('maps/battle_guys.glb',1,()=>{player.setCollisionMeshes(mapLoader.collisionMeshes);initHitboxHelpers();if(!isRunning){isRunning=true;loop();}});
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

        // ── Camera offsets from sizeConfig — auto-adjusts per selected character ──
        const co=player.sizeConfig.camOffset, cl=player.sizeConfig.camLookAt;
        camera.position.lerp(player.cameraPivot.localToWorld(new THREE.Vector3(co.x,co.y,co.z)),0.4);
        camera.lookAt(player.cameraPivot.localToWorld(new THREE.Vector3(cl.x,cl.y,cl.z)));

        if(playerBoxHelper){playerBoxHelper.box.copy(player.boundingBox);playerBoxHelper.visible=showHitbox;}

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
        enemy.update(dt,clock,player,beamPool); beamPool.update(dt,[enemy],player);
        if(enemyBoxHelper){enemyBoxHelper.box.copy(enemy.boundingBox);enemyBoxHelper.visible=showHitbox;}
    }

    if(gameMode==='pvp'&&network){
        network.update(dt,player,inputManager); beamPool.update(dt,[],player);
        beamPool.pool.forEach(beam=>{
            if(!beam.userData.active||beam.userData.isEnemy||beam.userData.isRemote) return;
            network.remotePlayers.forEach((rp,id)=>{if(!rp.isDead&&rp.boundingBox.containsPoint(beam.position)){network.reportHit(id,20);beam.visible=false;beam.userData.active=false;}});
        });
        document.getElementById('pvp-count').textContent=`Online: ${network.remotePlayers.size+1}`;
    }

    renderer.render(scene,camera);
}
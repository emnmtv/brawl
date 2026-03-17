/**
 * DevTuner.js — Noclip dev panel for live weapon/physics tuning.
 *
 * Reads the live weapon / physics config objects from the player,
 * mutates them directly, and outputs copyable code snippets.
 * Has no knowledge of Three.js rendering or game loop.
 */
export class DevTuner {
    /** @param {() => Character|null} getPlayer — returns the current local player */
    constructor(getPlayer) {
        this._getPlayer = getPlayer;
        this._activeTab = 'weapon';
        this._init();
    }

    showTab(tab) {
        this._activeTab = tab;
        ['weapon', 'melee', 'physics'].forEach(t => {
            const panel  = document.getElementById(`tuner-tab-${t}`);
            const btn    = document.getElementById(`tab-btn-${t}`);
            const COLORS = { weapon: '#ffaa00', melee: '#ff6600', physics: '#00ffcc' };
            if (!panel || !btn) return;
            const active      = tab === t;
            panel.style.display  = active ? 'block' : 'none';
            btn.style.background = active ? COLORS[t] : '#333';
            btn.style.color      = active ? 'black'   : '#aaa';
            btn.style.border     = active ? 'none'    : '1px solid #555';
        });
        if (tab === 'weapon')  this.refreshWeapon();
        if (tab === 'melee')   this.refreshMelee();
        if (tab === 'physics') this.refreshPhysics();
    }

    refreshWeapon() {
        const player = this._getPlayer();
        if (!player) return;
        const wt  = player.weaponManager.currentType;
        const cfg = player.weaponManager.weapons[wt].config;
        const set = (id, v) => this._setField(`tune-${id}`, v);

        set('scale', cfg.SCALE);
        set('px', cfg.POS[0]); set('py', cfg.POS[1]); set('pz', cfg.POS[2]);
        set('rx', cfg.ROT[0]); set('ry', cfg.ROT[1]); set('rz', cfg.ROT[2]);

        const bulletSection = document.getElementById('tune-bullet-section');
        if (bulletSection) bulletSection.style.display = wt === 'gun' ? 'block' : 'none';

        if (wt === 'gun') {
            const bo = cfg.BULLET_OFFSET || [0, 0, -5];
            set('bx', bo[0]); set('by', bo[1]); set('bz', bo[2]);
            set('bh', cfg.BULLET_HEIGHT_OFFSET ?? 8);
        }

        const lbl = document.getElementById('tuner-model-label');
        if (lbl) lbl.textContent = 'MODEL: ' + player.modelId.toUpperCase();

        this._generateWeaponCode();
    }

    refreshMelee() {
        const player = this._getPlayer();
        if (!player) return;
        const cfg = player.weaponManager.weapons.melee.config;
        const db  = cfg.damageBox || {};
        const set = (id, v) => this._setField(`mt-${id}`, v);

        set('damage',    cfg.DAMAGE    ?? 50);
        set('range',     cfg.RANGE     ?? 20);
        set('fireRate',  cfg.FIRE_RATE ?? 0.4);
        set('dbOffX',   (db.offset ?? [0, 0, -8])[0]);
        set('dbOffY',   (db.offset ?? [0, 0, -8])[1]);
        set('dbOffZ',   (db.offset ?? [0, 0, -8])[2]);
        set('dbSzX',    (db.size   ?? [4, 4, 14])[0]);
        set('dbSzY',    (db.size   ?? [4, 4, 14])[1]);
        set('dbSzZ',    (db.size   ?? [4, 4, 14])[2]);
        set('dbWinStart', db.hitWindowStart ?? 0.25);
        set('dbWinEnd',   db.hitWindowEnd   ?? 0.72);
        this._generateMeleeCode();
    }

    refreshPhysics() {
        const player = this._getPlayer();
        if (!player) return;
        const p   = player.sizeConfig;
        const set = (id, v) => this._setField(`phys-${id}`, v);

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
        this._generatePhysicsCode();
    }

    // ── Private ──────────────────────────────────────────────────

    _init() {
        // Weapon tuner inputs
        ['scale','px','py','pz','rx','ry','rz','bx','by','bz','bh'].forEach(id => {
            this._bindField(`tune-${id}`, () => this._applyWeapon());
        });
        ['x','y','z'].forEach(axis => this._bindField(`tune-gs-${axis}`, () => this._applyWeapon()));
        const cbFromBarrel = document.getElementById('tune-gs-fromBarrel');
        cbFromBarrel?.addEventListener('change', () => {
            const lbl = document.getElementById('tune-gs-fromBarrel-label');
            if (lbl) lbl.textContent = cbFromBarrel.checked ? 'ON' : 'OFF';
            this._applyWeapon();
        });

        // Melee tuner inputs
        ['damage','range','fireRate','dbOffX','dbOffY','dbOffZ','dbSzX','dbSzY','dbSzZ','dbWinStart','dbWinEnd']
            .forEach(id => this._bindField(`mt-${id}`, () => this._applyMelee()));

        // Physics tuner inputs
        ['walkSpeed','runMultiplier','stepRate','gravity','jumpStrength','stepUp','stepDown',
         'cameraPivotY','camOffsetX','camOffsetY','camOffsetZ','camLookAtZ',
         'hitboxCY','hitboxX','hitboxY','hitboxZ']
            .forEach(id => this._bindField(`phys-${id}`, () => this._applyPhysics()));

        // Expose tab switcher globally (called from inline onclick in HTML)
        window.switchTunerTab = tab => this.showTab(tab);

        // Weapon slot change triggers refresh
        window.addEventListener('keydown', e => {
            if ((e.code === 'Digit1' || e.code === 'Digit2') && document.getElementById('dev-tuner')?.style.display !== 'none')
                setTimeout(() => this.refreshWeapon(), 50);
        });

        // COPY button
        document.querySelector('#dev-tuner button[onclick*="clipboard"]')?.addEventListener('click', () => {
            const code = document.getElementById('tuner-code')?.innerText;
            if (code) navigator.clipboard.writeText(code);
        });
    }

    _bindField(id, onChange) {
        const s = document.getElementById(id);
        const n = document.getElementById(id + '-num');
        if (!s || !n) return;
        const sync = e => { const v = parseFloat(e.target.value); s.value = v; n.value = v; onChange(); };
        s.addEventListener('input', sync);
        n.addEventListener('input', sync);
    }

    _setField(id, v) {
        const s = document.getElementById(id), n = document.getElementById(id + '-num');
        if (s && n) { s.value = v; n.value = parseFloat(v).toFixed(3); }
    }

    _getField(id) {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) : 0;
    }

    _applyWeapon() {
        const player = this._getPlayer();
        if (!player) return;
        const wt   = player.weaponManager.currentType;
        const cfg  = player.weaponManager.weapons[wt].config;
        const mesh = player.weaponManager.weapons[wt].mesh;
        const g    = id => this._getField(`tune-${id}`);

        cfg.SCALE = g('scale');
        cfg.POS   = [g('px'), g('py'), g('pz')];
        cfg.ROT   = [g('rx'), g('ry'), g('rz')];

        if (mesh) { mesh.scale.setScalar(cfg.SCALE); mesh.position.set(...cfg.POS); mesh.rotation.set(...cfg.ROT); }

        if (wt === 'gun') {
            cfg.BULLET_OFFSET        = [g('bx'), g('by'), g('bz')];
            cfg.BULLET_HEIGHT_OFFSET = g('bh');
        }
        this._generateWeaponCode();
    }

    _applyMelee() {
        const player = this._getPlayer();
        if (!player) return;
        const cfg = player.weaponManager.weapons.melee.config;
        const g   = id => this._getField(`mt-${id}`);

        cfg.DAMAGE    = g('damage');
        cfg.RANGE     = g('range');
        cfg.FIRE_RATE = g('fireRate');
        if (!cfg.damageBox) cfg.damageBox = {};
        cfg.damageBox.offset         = [g('dbOffX'), g('dbOffY'), g('dbOffZ')];
        cfg.damageBox.size           = [g('dbSzX'),  g('dbSzY'),  g('dbSzZ')];
        cfg.damageBox.hitWindowStart = g('dbWinStart');
        cfg.damageBox.hitWindowEnd   = g('dbWinEnd');
        this._generateMeleeCode();
    }

    _applyPhysics() {
        const player = this._getPlayer();
        if (!player) return;
        const p = player.sizeConfig;
        const g = id => this._getField(`phys-${id}`);

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

        if (player.cameraPivot) player.cameraPivot.position.y = p.cameraPivotY;
        this._generatePhysicsCode();
    }

    _generateWeaponCode() {
        const player = this._getPlayer();
        if (!player) return;
        const wt  = player.weaponManager.currentType;
        const cfg = player.weaponManager.weapons[wt].config;
        const mid = player.modelId;
        const f   = v => parseFloat(v).toFixed(3);
        let code  = `// Model: ${mid}  Weapon: ${wt.toUpperCase()}\nweapons: {\n  ${wt}: {\n`;
        code += `    SCALE: ${f(cfg.SCALE)},\n`;
        code += `    POS:   [${cfg.POS.map(f).join(', ')}],\n`;
        code += `    ROT:   [${cfg.ROT.map(f).join(', ')}],\n`;
        if (wt === 'gun') {
            code += `    BULLET_OFFSET:        [${(cfg.BULLET_OFFSET || [0,0,-5]).map(f).join(', ')}],\n`;
            code += `    BULLET_HEIGHT_OFFSET: ${f(cfg.BULLET_HEIGHT_OFFSET ?? 8)},\n`;
        }
        if (wt === 'melee') {
            if (cfg.RANGE   != null) code += `    RANGE: ${cfg.RANGE},\n`;
            if (cfg.DAMAGE  != null) code += `    DAMAGE: ${cfg.DAMAGE},\n`;
        }
        code += '  }\n}';
        const codeEl = document.getElementById('tuner-code');
        if (codeEl) codeEl.innerText = code;
    }

    _generateMeleeCode() {
        const player = this._getPlayer();
        if (!player) return;
        const cfg = player.weaponManager.weapons.melee.config;
        const db  = cfg.damageBox || {};
        const f   = v => parseFloat(v).toFixed(3);
        const off = db.offset || [0, 0, -8];
        const sz  = db.size   || [4, 4, 14];
        let code  = `// Model: ${player.modelId}  Weapon: MELEE\nmelee: {\n`;
        code += `    DAMAGE:    ${f(cfg.DAMAGE ?? 50)},\n`;
        code += `    RANGE:     ${f(cfg.RANGE  ?? 20)},\n`;
        code += `    FIRE_RATE: ${f(cfg.FIRE_RATE ?? 0.4)},\n`;
        code += `    damageBox: {\n`;
        code += `        offset:         [${off.map(f).join(', ')}],\n`;
        code += `        size:           [${sz.map(f).join(', ')}],\n`;
        code += `        hitWindowStart: ${f(db.hitWindowStart ?? 0.25)},\n`;
        code += `        hitWindowEnd:   ${f(db.hitWindowEnd   ?? 0.72)},\n`;
        code += `    },\n}`;
        const codeEl = document.getElementById('tuner-code');
        if (codeEl) codeEl.innerText = code;
    }

    _generatePhysicsCode() {
        const player = this._getPlayer();
        if (!player) return;
        const p   = player.sizeConfig;
        const f   = v => parseFloat(v).toFixed(3);
        let code  = `// Model: ${player.modelId}\nphysics: {\n`;
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
        const codeEl = document.getElementById('tuner-code');
        if (codeEl) codeEl.innerText = code;
    }
}

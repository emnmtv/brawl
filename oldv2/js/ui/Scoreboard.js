/**
 * Scoreboard.js — TAB-toggle kill/death table.
 *
 * Injects its own DOM element into #ui-layer.
 * Reads from external refs (player, network, enemy) only when refresh() is called.
 */
export class Scoreboard {
    constructor() {
        this.localKills  = 0;
        this.localDeaths = 0;
        this._visible    = false;
        this._el         = null;

        this._build();
        this._bindTab();
    }

    addKill()  { this.localKills++;  }
    addDeath() { this.localDeaths++; }

    show() { this._visible = true;  this._el.style.display = 'flex'; this.refresh(); }
    hide() { this._visible = false; this._el.style.display = 'none'; }
    toggle() { this._visible ? this.hide() : this.show(); }

    /**
     * Re-renders the rows.
     * @param {object}  refs  — { player, network, enemy, gameMode, localName }
     */
    refresh(refs = {}) {
        this._refs = refs;
        const rows = this._el.querySelector('#scoreboard-rows');
        if (!rows) return;
        rows.innerHTML = '';

        const { player, network, enemy, gameMode, localName } = refs;
        const name  = localName || (player ? player.modelId.toUpperCase() : 'YOU');
        const hp    = player ? Math.round(player.health.currentHealth) : 0;
        this._addRow(rows, name, hp, this.localKills, this.localDeaths, true, !!player?.health?.isDead);

        network?.remotePlayers.forEach(rp =>
            this._addRow(rows, rp.name || rp.id, Math.round(rp.health), rp._kills || 0, rp._deaths || 0, false, rp.isDead)
        );

        if (gameMode === 'dev' && enemy) {
            this._addRow(rows, 'AI T-800', Math.round(enemy.health.currentHealth), 0, 0, false, enemy.health.isDead);
        }
    }

    // ── Private ────────────────────────────────────────────────────

    _addRow(container, name, hp, kills, deaths, isLocal, isDead) {
        const hpCol    = hp > 60 ? '#00ffcc' : hp > 25 ? '#ffaa00' : '#ff3333';
        const nameCol  = isLocal ? '#00ffff' : 'rgba(255,255,255,0.8)';
        const r        = document.createElement('div');
        r.style.cssText = `
            display:grid;grid-template-columns:1fr 80px 80px 80px;padding:10px 14px;
            font-size:13px;letter-spacing:2px;border-bottom:1px solid rgba(255,255,255,0.05);
            background:${isLocal ? 'rgba(0,40,30,0.4)' : 'transparent'};
            opacity:${isDead ? 0.4 : 1};`;
        r.innerHTML = `
            <span style="color:${nameCol};font-weight:${isLocal ? 'bold' : 'normal'};">
                ${isLocal ? '▶ ' : ''}${name}${isDead ? ' <span style="color:#ff3333;font-size:10px;">[DEAD]</span>' : ''}
            </span>
            <span style="text-align:center;color:${hpCol};">${isDead ? '0' : hp}</span>
            <span style="text-align:center;color:#00ffcc;">${kills}</span>
            <span style="text-align:center;color:#ff6666;">${deaths}</span>`;
        container.appendChild(r);
    }

    _build() {
        const el = document.createElement('div');
        el.id = 'scoreboard';
        el.style.cssText = `
            display:none;position:fixed;inset:0;z-index:80;
            align-items:center;justify-content:center;
            background:rgba(0,0,0,0.72);backdrop-filter:blur(4px);pointer-events:none;`;
        el.innerHTML = `
            <div style="min-width:480px;max-width:90vw;font-family:'Courier New',monospace;">
                <div style="text-align:center;margin-bottom:18px;">
                    <div style="font-size:11px;letter-spacing:6px;color:rgba(0,255,204,0.5);margin-bottom:4px;">PRESS TAB TO CLOSE</div>
                    <div style="font-size:22px;font-weight:900;letter-spacing:8px;color:#00ffcc;text-shadow:0 0 16px #00ffcc;">SCOREBOARD</div>
                </div>
                <div style="border:1px solid rgba(0,255,204,0.2);overflow:hidden;">
                    <div style="display:grid;grid-template-columns:1fr 80px 80px 80px;gap:0;
                        background:rgba(0,255,204,0.08);padding:8px 14px;font-size:10px;
                        letter-spacing:3px;color:rgba(0,255,204,0.5);border-bottom:1px solid rgba(0,255,204,0.15);">
                        <span>CALLSIGN</span><span style="text-align:center;">HP</span>
                        <span style="text-align:center;">KILLS</span><span style="text-align:center;">DEATHS</span>
                    </div>
                    <div id="scoreboard-rows"></div>
                </div>
            </div>`;
        document.getElementById('ui-layer')?.appendChild(el);
        this._el = el;
    }

    _bindTab() {
        window.addEventListener('keydown', e => {
            if (e.code !== 'Tab') return;
            e.preventDefault();
            this.toggle();
            if (this._visible && this._refs) this.refresh(this._refs);
        });
    }
}

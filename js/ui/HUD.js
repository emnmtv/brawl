/**
 * HUD.js — Reads game state and writes it to the DOM.
 *
 * Covers the PVP HUD: health panel, weapon cards, session info, net alert.
 * Does NOT read input or modify game state — one-way data flow only.
 */
export class HUD {
    constructor() {
        this._netAlertTimer = null;
        this._el = {
            pvpHealthValue: document.getElementById('pvp-health-value'),
            pvpHealthFill:  document.getElementById('pvp-health-bar-fill'),
            pvpWepGun:      document.getElementById('pvp-wep-gun'),
            pvpWepMelee:    document.getElementById('pvp-wep-melee'),
            pvpCount:       document.getElementById('pvp-count'),
            pvpSessionId:   document.getElementById('pvp-session-id'),
            netAlert:       document.getElementById('net-alert'),
            loadingStatus:  document.getElementById('loading-status'),
        };
    }

    // ── Health panel ──────────────────────────────────────────────

    /**
     * @param {number} current
     * @param {number} max
     */
    updateHealth(current, max) {
        const hp  = Math.max(0, Math.round(current));
        const pct = hp / max * 100;
        const { pvpHealthValue: valEl, pvpHealthFill: fillEl } = this._el;
        if (!valEl || !fillEl) return;

        valEl.textContent = hp;
        fillEl.style.width = pct + '%';

        const isLow  = hp > 25 && hp <= 60;
        const isCrit = hp <= 25;
        valEl.classList.toggle('low',  isLow);
        valEl.classList.toggle('crit', isCrit);

        fillEl.style.background = hp > 60
            ? 'linear-gradient(to right,#00ffcc,#00cc88)'
            : hp > 25
            ? 'linear-gradient(to right,#ffaa00,#ff6600)'
            : 'linear-gradient(to right,#ff2222,#cc0000)';
        fillEl.style.boxShadow = hp > 60 ? '0 0 8px #00ffcc'
            : hp > 25 ? '0 0 8px #ffaa00' : '0 0 8px #ff2222';
    }

    // ── Weapon display ────────────────────────────────────────────

    /** @param {'gun'|'melee'} type */
    updateWeapon(type) {
        const { pvpWepGun: g, pvpWepMelee: m } = this._el;
        g?.classList.toggle('active', type === 'gun');
        m?.classList.toggle('active', type === 'melee');
    }

    // ── Session info ──────────────────────────────────────────────

    setSessionId(id) {
        if (this._el.pvpSessionId) this._el.pvpSessionId.textContent = `ID: ${id}`;
    }

    setOnlineCount(n) {
        if (this._el.pvpCount) this._el.pvpCount.textContent = `${n} ONLINE`;
    }

    // ── Temporary alerts ──────────────────────────────────────────

    showNetAlert(msg, durationMs = 2500) {
        const el = this._el.netAlert;
        if (!el) return;
        el.textContent    = msg;
        el.style.opacity  = '1';
        clearTimeout(this._netAlertTimer);
        this._netAlertTimer = setTimeout(() => { el.style.opacity = '0'; }, durationMs);
    }

    setLoadingStatus(msg) {
        if (this._el.loadingStatus) this._el.loadingStatus.textContent = msg;
    }
}

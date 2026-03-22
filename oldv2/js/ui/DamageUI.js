/**
 * DamageUI.js — All transient combat feedback UI.
 *
 * Covers: red vignette flash, directional indicators, floating damage numbers,
 * block-deflect flash, kill feed entries, death/respawn overlay.
 * Knows nothing about game logic — callers pass in the data.
 */
export class DamageUI {
    /**
     * @param {THREE.Camera|null} cameraRef — set later via setCamera() for world→screen projection
     */
    constructor(cameraRef = null) {
        this._camera      = cameraRef;
        this._isDead      = false;
        this._countdownTimer = null;

        this._el = {
            hitFlash:     document.getElementById('hit-flash'),
            blockFlash:   document.getElementById('block-flash'),
            indicators:   document.getElementById('damage-indicators'),
            numbers:      document.getElementById('damage-numbers'),
            deathScreen:  document.getElementById('death-screen'),
            countdown:    document.getElementById('respawn-countdown'),
            progress:     document.getElementById('respawn-progress'),
            killerLabel:  document.getElementById('respawn-killer'),
            killFeed:     document.getElementById('kill-feed'),
            blockIndicator: document.getElementById('block-indicator'),
        };

        document.addEventListener('player-blocked-bullet', () => this.showBlockDeflect());
    }

    setCamera(cam) { this._camera = cam; }

    // ── Hit feedback ──────────────────────────────────────────────

    showHit(amount, attackerWorldPos, playerPos, playerYaw) {
        if (this._isDead) return;
        // Red vignette pulse
        this._flashEl(this._el.hitFlash);
        // Directional arrow
        if (attackerWorldPos && playerPos) {
            const dx = attackerWorldPos.x - playerPos.x;
            const dz = attackerWorldPos.z - playerPos.z;
            if (Math.sqrt(dx * dx + dz * dz) > 1) {
                const cos = Math.cos(-playerYaw), sin = Math.sin(-playerYaw);
                this._spawnIndicator(Math.atan2(dx * cos - dz * sin, -(dx * sin + dz * cos)));
            }
        }
        this._spawnDmgNumber(amount, innerWidth * 0.5 + (Math.random() - 0.5) * 80, innerHeight * 0.42, 'self');
    }

    /** Floating hit-confirm number projected to the enemy's screen position. */
    showHitConfirm(amount, targetWorldPos) {
        if (!this._camera) {
            this._spawnDmgNumber(amount, innerWidth * 0.5, innerHeight * 0.4, 'hit');
            return;
        }
        const ndc = targetWorldPos.clone().project(this._camera);
        const sx  = (ndc.x * 0.5 + 0.5) * innerWidth;
        const sy  = (-ndc.y * 0.5 + 0.5) * innerHeight;
        if (ndc.z < 1)
            this._spawnDmgNumber(amount, sx + (Math.random() - 0.5) * 30, sy - 20, 'hit');
    }

    showBlockDeflect() {
        this._flashEl(this._el.blockFlash);
        this._spawnDmgNumber('BLOCKED', innerWidth * 0.5, innerHeight * 0.38, 'block-deflect');
    }

    // ── Block indicator ───────────────────────────────────────────

    setBlocking(active) {
        this._el.blockIndicator?.classList.toggle('active', active);
    }

    // ── Kill feed ─────────────────────────────────────────────────

    addKillFeed(killerName, victimName, isLocalKill, isLocalDeath = false) {
        if (!this._el.killFeed) return;
        const el = document.createElement('div');
        el.className = `kill-entry${isLocalKill ? ' local-kill' : ''}${isLocalDeath ? ' local-victim' : ''}`;
        el.innerHTML =
            `<span class="kill-attacker${isLocalKill ? ' local' : ''}">${killerName}</span>` +
            `<span class="kill-weapon">⚡</span>` +
            `<span class="kill-victim${isLocalDeath ? ' local' : ''}">${victimName}</span>`;
        this._el.killFeed.appendChild(el);
        while (this._el.killFeed.children.length > 5)
            this._el.killFeed.removeChild(this._el.killFeed.firstChild);
        setTimeout(() => el.remove(), 4000);
    }

    // ── Death / respawn screen ────────────────────────────────────

    showDeath(seconds, label, onRespawn) {
        this._isDead = true;
        if (this._el.killerLabel) this._el.killerLabel.textContent = label || '';
        this._el.deathScreen.style.display = 'flex';

        // Countdown bar
        const prog = this._el.progress;
        if (prog) {
            prog.style.transition = 'none';
            prog.style.width      = '100%';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                prog.style.transition = `width ${seconds}s linear`;
                prog.style.width      = '0%';
            }));
        }

        let rem = seconds;
        if (this._el.countdown) this._el.countdown.textContent = rem;
        clearInterval(this._countdownTimer);
        this._countdownTimer = setInterval(() => {
            rem--;
            if (this._el.countdown) this._el.countdown.textContent = rem;
            if (rem <= 0) {
                clearInterval(this._countdownTimer);
                this.hideDeath();
                onRespawn();
            }
        }, 1000);
    }

    hideDeath() {
        this._isDead = false;
        this._el.deathScreen.style.display = 'none';
        clearInterval(this._countdownTimer);
    }

    // ── Private helpers ───────────────────────────────────────────

    _flashEl(el) {
        if (!el) return;
        el.classList.remove('flash-active');
        void el.offsetWidth;            // force reflow to restart animation
        el.classList.add('flash-active');
    }

    _spawnDmgNumber(text, x, y, cls) {
        if (!this._el.numbers) return;
        const el = document.createElement('div');
        el.className   = `dmg-number ${cls}`;
        el.textContent = typeof text === 'number' ? `-${text}` : text;
        el.style.left  = x + 'px';
        el.style.top   = y + 'px';
        this._el.numbers.appendChild(el);
        setTimeout(() => el.remove(), 1300);
    }

    _spawnIndicator(angle) {
        if (!this._el.indicators) return;
        const R  = Math.min(innerWidth, innerHeight) * 0.38;
        const el = document.createElement('div');
        el.className   = 'dmg-indicator';
        el.style.left  = `${innerWidth / 2 + R * Math.sin(angle)}px`;
        el.style.top   = `${innerHeight / 2 - R * Math.cos(angle)}px`;
        el.style.transform = `translate(-50%,-50%) rotate(${angle}rad)`;
        this._el.indicators.appendChild(el);
        setTimeout(() => el.remove(), 1200);
    }
}

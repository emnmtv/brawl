/**
 * HealthSystem.js — Manages HP, death state, and UI bar updates.
 *
 * Intentionally small: no physics, no animation, no network.
 * Callbacks (onDamage, onDeath) keep it decoupled from everything else.
 */
export class HealthComponent {
    /**
     * @param {number} maxHealth
     * @param {string|null} uiBarId  — id of a bar-fill element, or null
     */
    constructor(maxHealth, uiBarId = null) {
        this.maxHealth     = maxHealth;
        this.currentHealth = maxHealth;
        this.isDead        = false;
        this.uiBar         = uiBarId ? document.getElementById(uiBarId) : null;

        /** Called with (amount, sourceWorldPos|null) on every hit. */
        this.onDamage = null;
        /** Called with () when health first reaches 0. */
        this.onDeath  = null;
    }

    takeDamage(amount, sourcePos = null) {
        if (this.isDead) return;
        this.currentHealth = Math.max(0, this.currentHealth - amount);
        this._syncBar();
        if (this.onDamage) this.onDamage(amount, sourcePos);
        if (this.currentHealth <= 0 && !this.isDead) {
            this.isDead = true;
            if (this.onDeath) this.onDeath();
        }
    }

    heal(amount) {
        if (this.isDead) return;
        this.currentHealth = Math.min(this.maxHealth, this.currentHealth + amount);
        this._syncBar();
    }

    /** Full reset — used on respawn. */
    reset() {
        this.currentHealth = this.maxHealth;
        this.isDead        = false;
        this._syncBar();
    }

    get pct() { return this.currentHealth / this.maxHealth; }

    _syncBar() {
        if (this.uiBar) this.uiBar.style.width = (this.pct * 100) + '%';
    }
}

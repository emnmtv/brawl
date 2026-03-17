/**
 * CharacterSelect.js — Character selection UI.
 *
 * Builds the card grid, populates the detail panel, and calls
 * onConfirm(modelId) when the player clicks CONFIRM.
 */
import { getAllModelIds, getModel } from '../registry/ModelRegistry.js';

export class CharacterSelect {
    /**
     * @param {(modelId: string) => void} onConfirm
     */
    constructor(onConfirm) {
        this._selectedId = null;
        this._onConfirm  = onConfirm;
        this._grid       = document.getElementById('char-card-grid');
        this._confirmBtn = document.getElementById('btn-char-confirm');

        this._build();
        this._bindConfirm();
    }

    /** Render all character cards. Call once before showing the panel. */
    _build() {
        if (!this._grid) return;
        this._grid.innerHTML = '';

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

            // Preview image or placeholder
            const previewDiv = document.createElement('div');
            previewDiv.className = 'char-preview';
            if (ui.preview) {
                const img = document.createElement('img');
                img.src   = ui.preview;
                img.alt   = ui.displayName || id;
                img.onerror = () => img.replaceWith(this._makePlaceholder(accent));
                previewDiv.appendChild(img);
            } else {
                previewDiv.appendChild(this._makePlaceholder(accent));
            }

            const footer = document.createElement('div');
            footer.className = 'char-card-footer';
            footer.innerHTML =
                `<div class="char-card-name">${ui.displayName || id.toUpperCase()}</div>` +
                `<div class="char-card-sub">${ui.subtitle || ''}</div>`;

            card.appendChild(previewDiv);
            card.appendChild(footer);
            this._grid.appendChild(card);

            card.addEventListener('mouseenter', () => this._populateDetail(id));
            card.addEventListener('focus',      () => this._populateDetail(id));
            card.addEventListener('click',      () => this._selectCharacter(id));
            card.addEventListener('keydown', e  => { if (e.key === 'Enter' || e.key === ' ') this._selectCharacter(id); });
        });

        // Pre-populate detail with the first card
        const ids = getAllModelIds();
        if (ids.length) this._populateDetail(ids[0]);
    }

    _makePlaceholder(accent) {
        const ph  = document.createElement('div');
        ph.className = 'char-preview-placeholder';
        const sil = document.createElement('div');
        sil.className   = 'char-silhouette';
        sil.textContent = '🤖';
        ph.appendChild(sil);
        return ph;
    }

    _selectCharacter(id) {
        this._selectedId = id;
        document.querySelectorAll('.char-card').forEach(c =>
            c.classList.toggle('selected', c.dataset.id === id)
        );
        const accent = getModel(id).ui?.accent || '#00ffcc';
        const detailEl = document.getElementById('char-detail');
        if (detailEl) detailEl.style.borderColor = accent;
        this._populateDetail(id);

        if (this._confirmBtn) {
            this._confirmBtn.disabled         = false;
            this._confirmBtn.style.borderColor = accent;
            this._confirmBtn.style.color       = accent;
        }
    }

    _populateDetail(id) {
        const profile = getModel(id);
        const ui      = profile.ui   || {};
        const stats   = ui.stats     || { speed: 5, damage: 5, armor: 5 };
        const sc      = profile.size ?? { height: 12, width: 6 };
        const accent  = ui.accent    || '#00ffcc';

        const detailEl = document.getElementById('char-detail');
        if (detailEl) detailEl.style.borderColor = accent;

        const nameEl = document.getElementById('char-detail-name');
        if (nameEl) { nameEl.textContent = ui.displayName || id.toUpperCase(); nameEl.style.color = accent; }

        const subEl = document.getElementById('char-detail-sub');
        if (subEl) subEl.textContent = `${ui.subtitle || ''}  ·  H:${sc.height}  W:${sc.width}`;

        const descEl = document.getElementById('char-detail-desc');
        if (descEl) descEl.textContent = ui.description || '';

        this._animateStat('stat-speed',  'stat-speed-val',  stats.speed,  accent);
        this._animateStat('stat-damage', 'stat-damage-val', stats.damage, accent);
        this._animateStat('stat-armor',  'stat-armor-val',  stats.armor,  accent);
    }

    _animateStat(barId, valId, value, accent) {
        const bar = document.getElementById(barId);
        const val = document.getElementById(valId);
        if (!bar || !val) return;
        bar.style.background = `linear-gradient(to right,${accent},color-mix(in srgb,${accent} 60%,#004433))`;
        bar.style.boxShadow  = `0 0 6px ${accent}`;
        bar.style.width      = Math.max(0, Math.min(10, value ?? 5)) * 10 + '%';
        val.textContent      = value ?? '—';
    }

    _bindConfirm() {
        this._confirmBtn?.addEventListener('click', () => {
            if (this._selectedId) this._onConfirm(this._selectedId);
        });
    }

    get selectedId() { return this._selectedId; }
}

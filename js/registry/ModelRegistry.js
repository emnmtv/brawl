/**
 * ModelRegistry.js — READ-ONLY API over CharacterData.
 *
 * Responsibilities:
 *   - Provide typed accessors for model profiles
 *   - Merge per-model weapon overrides with global defaults (once, lazily)
 *   - Derive physics config from size when no explicit physics block exists
 *
 * Does NOT mutate the source data except for the one-time lazy-init merge.
 */
import { CHARACTER_DATA } from '../data/CharacterData.js';
import { WEAPON_DEFAULTS } from '../data/WeaponDefaults.js';

// ─────────────────────────────────────────────────────────────
//  Internal helpers
// ─────────────────────────────────────────────────────────────

function _cloneWeaponConfig(cfg) {
    return {
        ...cfg,
        POS:           cfg.POS           ? [...cfg.POS]           : [0, 0, 0],
        ROT:           cfg.ROT           ? [...cfg.ROT]           : [0, 0, 0],
        BULLET_OFFSET: cfg.BULLET_OFFSET ? [...cfg.BULLET_OFFSET] : [0, 0, -5],
        ...(cfg.damageBox ? {
            damageBox: {
                ...cfg.damageBox,
                offset: cfg.damageBox.offset ? [...cfg.damageBox.offset] : [0, 0, -8],
                size:   cfg.damageBox.size   ? [...cfg.damageBox.size]   : [4, 4, 10],
            },
        } : {}),
        ...(cfg.SWINGS ? {
            SWINGS: cfg.SWINGS.map(s => ({
                ...s,
                address:       s.address.map(r => [...r]),
                backswing:     s.backswing.map(r => [...r]),
                downswing:     s.downswing.map(r => [...r]),
                impact:        s.impact.map(r => [...r]),
                followThrough: s.followThrough.map(r => [...r]),
            })),
        } : {}),
    };
}

function _derivePhysicsFromSize(entry) {
    const size = entry.size ?? { height: 12, width: 6 };
    const h = size.height, w = size.width, r = h / 12;
    return {
        height: h, width: w,
        walkSpeed:            15   * r,
        runMultiplier:        2.2,
        stepRate:             0.45,
        gravity:              75   * r,
        jumpStrength:         30   * r,
        cameraPivotY:         h * 0.833,
        hitboxCenterOffsetY:  h * 0.5,
        hitboxSize:           { x: w, y: h, z: w },
        wallRayHeights:       [h * 0.083, h * 0.417, h * 0.75],
        stepUp:               h * 0.167,
        stepDown:             h * 0.667,
        camOffset:            { x: w * 0.5,  y: h * 0.167, z: h * 1.667 },
        camLookAt:            { x: 0,        y: 0,          z: -h * 8.333 },
    };
}

function _ensurePhysicsDefaults(physics) {
    const h = physics.height || 12;
    const w = physics.width  || 6;
    if (!Array.isArray(physics.wallRayHeights))
        physics.wallRayHeights = [h * 0.083, h * 0.417, h * 0.75];
    if (!physics.hitboxSize || typeof physics.hitboxSize !== 'object')
        physics.hitboxSize = { x: w, y: h, z: w };
    if (!physics.camOffset  || typeof physics.camOffset  !== 'object')
        physics.camOffset  = { x: w * 0.5, y: h * 0.167, z: h * 1.667 };
    if (!physics.camLookAt  || typeof physics.camLookAt  !== 'object')
        physics.camLookAt  = { x: 0, y: 0, z: -h * 8.333 };
}

// ─────────────────────────────────────────────────────────────
//  Public API
// ─────────────────────────────────────────────────────────────

/** Returns the raw character entry. Throws on unknown id. */
export function getModel(modelId) {
    const entry = CHARACTER_DATA[modelId];
    if (!entry) {
        const valid = Object.keys(CHARACTER_DATA).join(', ');
        throw new Error(`[ModelRegistry] Unknown model id: "${modelId}". Valid: ${valid}`);
    }
    return entry;
}

/** All registered model IDs. */
export function getAllModelIds() {
    return Object.keys(CHARACTER_DATA);
}

/**
 * Returns the actual bone name for a logical bone key.
 * Falls back to the logical key if no mapping exists.
 */
export function getBoneName(modelId, logicalName) {
    const entry = CHARACTER_DATA[modelId];
    return entry?.bones?.[logicalName] ?? logicalName;
}

/**
 * Returns candidate clip names for a logical animation key.
 * Always returns an array; first matching clip wins at load time.
 */
export function getAnimCandidates(modelId, logicalKey) {
    const mapped = CHARACTER_DATA[modelId]?.animations?.[logicalKey];
    if (!mapped) return [logicalKey];
    return Array.isArray(mapped) ? mapped : [mapped];
}

/**
 * Reverse-maps an actual GLB clip name to its logical key for this model.
 * Returns null if no match.
 */
export function logicalKeyForClip(modelId, actualClipName) {
    const animations = CHARACTER_DATA[modelId]?.animations;
    if (!animations) return null;
    const lower = actualClipName.toLowerCase();
    for (const [logical, mapped] of Object.entries(animations)) {
        const candidates = Array.isArray(mapped) ? mapped : [mapped];
        if (candidates.some(c => c.toLowerCase() === lower)) return logical;
    }
    return null;
}

/**
 * Returns the LIVE physics config object.
 * Mutations are reflected everywhere (used by the dev tuner).
 */
export function getSizeConfig(modelId) {
    const entry = getModel(modelId);
    if (!entry.physics) entry.physics = _derivePhysicsFromSize(entry);
    _ensurePhysicsDefaults(entry.physics);
    return entry.physics;
}

/**
 * Returns the LIVE merged weapon config for modelId + weaponType.
 * Per-model values always override global defaults.
 * Result is a live object — mutations from the dev tuner are immediate.
 */
export function getWeaponConfig(modelId, type) {
    const entry     = getModel(modelId);
    const globalCfg = WEAPON_DEFAULTS[type.toUpperCase()];

    if (!entry.weapons)          entry.weapons          = {};
    if (!entry._wcInitialized)   entry._wcInitialized   = {};

    if (!entry._wcInitialized[type]) {
        const base           = _cloneWeaponConfig(globalCfg);
        const modelOverrides = entry.weapons[type] || {};
        entry.weapons[type]  = { ...base, ...modelOverrides };
        entry._wcInitialized[type] = true;
    }
    return entry.weapons[type];
}

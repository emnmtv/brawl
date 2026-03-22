/**
 * WeaponDefaults.js — PURE DATA, no imports, no logic.
 *
 * These are the global fallback weapon configs.
 * Per-character overrides live in CharacterData.js and are merged at runtime
 * by WeaponRegistry.getWeaponConfig().
 *
 * WEAPON_BONE / SWING_BONES use LOGICAL bone names (e.g. 'hand_R').
 * ModelRegistry.getBoneName() resolves them to actual bone names at runtime.
 */
export const WEAPON_DEFAULTS = {

    GUN: {
        MODEL:       'models/battle_rifle.glb',
        WEAPON_BONE: 'hand_R',
        SCALE:       0.340,
        POS:         [-0.57, 3.00, 0.43],
        ROT:         [1.344, 3.368, -0.524],
        FIRE_RATE:   0.15,
        DAMAGE:      20,
        // Local offset from gun mesh origin toward barrel tip.
        // X = right, Y = up, Z = negative = forward (shoot direction).
        BULLET_OFFSET:        [0, 0, -5],
        // Fallback spawn height above player feet when gun mesh isn't loaded yet.
        BULLET_HEIGHT_OFFSET: 8,
    },

    MELEE: {
        MODEL:       'models/lightsaber.glb',
        WEAPON_BONE: 'hand_R',
        SWING_BONES: ['upper_arm_R', 'lower_arm_R', 'hand_R'],
        SCALE:       0.660,
        POS:         [-0.57, 3.00, -1.48],
        ROT:         [1.34, 3.14, -1.47],
        FIRE_RATE:   0.4,
        DAMAGE:      50,
        RANGE:       20,
        SWING_SPEED: 18,
    },
};

/** Audio timing constants — shared by AudioManager. */
export const AUDIO_DEFAULTS = {
    GUN_SNIPPET:  0.15,
    GUN_START:    1.0,
    STEP_SNIPPET: 0.25,
    STEP_START:   0.10,
};

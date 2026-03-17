/**
 * CONFIG
 *
 * WEAPON_BONE and SWING_BONES use LOGICAL bone names (e.g. 'hand_R').
 * Character.js calls getBoneName(modelId, logicalName) at runtime to
 * get the real bone name for whatever model is loaded.
 * This means the same Config works for every model in the registry.
 */
export const CONFIG = {
    WEAPONS: {
        GUN: {
            MODEL:       'models/battle_rifle.glb',
            WEAPON_BONE: 'hand_R',               // ← logical bone name
            SCALE: 0.340, POS: [-0.57, 3.00, 0.43], ROT: [1.344, 3.368, -0.524],
            FIRE_RATE: 0.15,
            DAMAGE:    20,
            // Bullet spawn point — local offset from the gun mesh origin (tip of barrel)
            // X = right, Y = up, Z = negative = forward (shoot direction)
            BULLET_OFFSET:        [0, 0, -5],
            // Fallback height above player feet used when the gun mesh isn't loaded yet
            BULLET_HEIGHT_OFFSET: 8,
        },
        MELEE: {
            MODEL:       'models/lightsaber.glb',
            WEAPON_BONE: 'hand_R',               // ← logical bone name
            SWING_BONES: ['upper_arm_R', 'lower_arm_R', 'hand_R'], // ← logical
            SCALE: 0.660, POS: [-0.57, 3.00, -1.48], ROT: [1.34, 3.14, -1.47],
            FIRE_RATE: 0.4, DAMAGE: 50, RANGE: 20,
            SWING_SPEED: 18,

            // Optional config for melee swing hit detection boxes. If not defined, a single box around the player is used.
        },
    },
    AUDIO: { GUN_SNIPPET: 0.15, GUN_START: 1.0, STEP_SNIPPET: 0.25, STEP_START: 0.10 },
};
/**
 * CONFIG — Global defaults & shared constants
 *
 * WEAPON_BONE and SWING_BONES use LOGICAL bone names resolved at runtime
 * via getBoneName(modelId, logicalName) in ModelRegistry.
 *
 * SCALE / POS / ROT / DAMAGE / FIRE_RATE are now per-model and live in
 * ModelRegistry weapons{} blocks.  The values here are the FALLBACK DEFAULTS
 * used by getWeaponConfig() for any model that doesn't specify its own.
 * Per-model values always win — these are never read directly by gameplay code.
 */
export const CONFIG = {
    WEAPONS: {
        GUN: {
            // ── Shared (same GLB for all models) ──
            MODEL:       'models/battle_rifle.glb',
            WEAPON_BONE: 'hand_R',          // logical bone key → resolved per-model

            // ── Fallback defaults (per-model weapons{} overrides these) ──
            SCALE:     0.340,
            POS:       [-0.57, 3.00,  0.43],
            ROT:       [1.344, 3.368, -0.524],
            FIRE_RATE: 0.15,
            DAMAGE:    20,
        },
        MELEE: {
            // ── Shared ──
            MODEL:       'models/lightsaber.glb',
            WEAPON_BONE: 'hand_R',
            SWING_BONES: ['upper_arm_R', 'lower_arm_R', 'hand_R'],  // logical

            // ── Fallback defaults ──
            SCALE:       0.660,
            POS:         [-0.57, 3.00, -1.48],
            ROT:         [1.34,  3.14, -1.47],
            FIRE_RATE:   0.4,
            DAMAGE:      50,
            RANGE:       20,
            SWING_SPEED: 18,

            SWINGS: [
                {
                    name: 'Standard Slash',
                    address:       [ [0.3,  0.0,  0.1],  [0.4,  0.0,  0.0],  [0.1,  0.0,  0.2]  ],
                    backswing:     [ [1.2,  0.9, -0.4],  [1.6,  0.3,  0.1],  [0.9,  0.4,  1.4]  ],
                    downswing:     [ [0.9, -0.2,  0.5],  [1.1,  0.1,  0.0],  [0.7,  0.2,  1.1]  ],
                    impact:        [ [0.5, -0.8,  1.1],  [0.1, -0.1,  0.0],  [-0.3, 0.0,  0.3]  ],
                    followThrough: [ [-0.4,-1.3,  1.5],  [0.7,  0.0,  0.3],  [0.4, -0.3,  0.9]  ],
                },
                {
                    name: 'Overhead Heavy Chop',
                    address:       [ [0.3,  0.0,  0.1],  [0.4,  0.0,  0.0],  [0.1,  0.0,  0.2]  ],
                    backswing:     [ [2.0,  0.0, -0.2],  [1.8,  0.0,  0.0],  [1.0,  0.0,  0.5]  ],
                    downswing:     [ [1.0,  0.0,  0.0],  [1.0,  0.0,  0.0],  [0.5,  0.0,  0.0]  ],
                    impact:        [ [0.0,  0.0,  0.2],  [0.1,  0.0,  0.0],  [-0.5, 0.0,  0.0]  ],
                    followThrough: [ [-0.5, 0.2,  0.5],  [0.5,  0.0,  0.0],  [-0.2, 0.0,  0.0]  ],
                },
                {
                    name: 'Underhand Uppercut',
                    address:       [ [0.3,  0.0,  0.1],  [0.4,  0.0,  0.0],  [0.1,  0.0,  0.2]  ],
                    backswing:     [ [-0.5, 0.5, -0.5],  [0.5,  0.0,  0.0],  [0.2, -0.5,  0.5]  ],
                    downswing:     [ [0.0,  0.2,  0.0],  [0.2,  0.0,  0.0],  [0.0,  0.0,  0.0]  ],
                    impact:        [ [1.0, -0.5,  1.0],  [0.1,  0.0,  0.0],  [-0.2, 0.5,  0.0]  ],
                    followThrough: [ [1.5, -0.8,  1.2],  [1.0,  0.0,  0.0],  [0.0,  0.8,  0.0]  ],
                },
            ],
        },
    },
    AUDIO: { GUN_SNIPPET: 0.15, GUN_START: 1.0, STEP_SNIPPET: 0.25, STEP_START: 0.10 },
};
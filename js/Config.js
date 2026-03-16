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
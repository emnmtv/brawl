export const CONFIG = {
    WEAPONS: {
        GUN: {
            MODEL: 'models/battle_rifle.glb',
            WEAPON_BONE: 'bip_hand_R',
            SCALE: 0.340, POS: [-0.57, 3.00, 0.43], ROT: [1.344, 3.368, -0.524],
            FIRE_RATE: 0.15, DAMAGE: 20
        },
        MELEE: {
            MODEL: 'models/lightsaber.glb',
            WEAPON_BONE: 'bip_hand_R',
            SWING_BONES: ['bip_upperArm_R', 'bip_lowerArm_R', 'bip_hand_R'], 
            SCALE: 0.660, POS: [-0.57, 3.00, -1.48], ROT: [1.34, 3.14, -1.47],
            FIRE_RATE: 0.4, DAMAGE: 50, RANGE: 20,
            SWING_SPEED: 18, // Sped up slightly for the 5 phases
            
            // Array of randomized swing variations!
            SWINGS: [
                {
                    name: "Standard Slash",
                    address:       [ [0.3, 0.0, 0.1],   [0.4, 0.0, 0.0],   [0.1, 0.0, 0.2] ],
                    backswing:     [ [1.2, 0.9, -0.4],  [1.6, 0.3, 0.1],   [0.9, 0.4, 1.4] ],
                    downswing:     [ [0.9, -0.2, 0.5],  [1.1, 0.1, 0.0],   [0.7, 0.2, 1.1] ],
                    impact:        [ [0.5, -0.8, 1.1],  [0.1, -0.1, 0.0],  [-0.3, 0.0, 0.3] ],
                    followThrough: [ [-0.4, -1.3, 1.5], [0.7, 0.0, 0.3],   [0.4, -0.3, 0.9] ]
                },
                {
                    name: "Overhead Heavy Chop",
                    address:       [ [0.3, 0.0, 0.1],   [0.4, 0.0, 0.0],   [0.1, 0.0, 0.2] ],
                    backswing:     [ [2.0, 0.0, -0.2],  [1.8, 0.0, 0.0],   [1.0, 0.0, 0.5] ], // Lifted high
                    downswing:     [ [1.0, 0.0, 0.0],   [1.0, 0.0, 0.0],   [0.5, 0.0, 0.0] ],
                    impact:        [ [0.0, 0.0, 0.2],   [0.1, 0.0, 0.0],   [-0.5, 0.0, 0.0] ], // Slammed down
                    followThrough: [ [-0.5, 0.2, 0.5],  [0.5, 0.0, 0.0],   [-0.2, 0.0, 0.0] ]
                },
                {
                    name: "Underhand Uppercut",
                    address:       [ [0.3, 0.0, 0.1],   [0.4, 0.0, 0.0],   [0.1, 0.0, 0.2] ],
                    backswing:     [ [-0.5, 0.5, -0.5], [0.5, 0.0, 0.0],   [0.2, -0.5, 0.5] ], // Dropped low
                    downswing:     [ [0.0, 0.2, 0.0],   [0.2, 0.0, 0.0],   [0.0, 0.0, 0.0] ],
                    impact:        [ [1.0, -0.5, 1.0],  [0.1, 0.0, 0.0],   [-0.2, 0.5, 0.0] ], // Swept upward
                    followThrough: [ [1.5, -0.8, 1.2],  [1.0, 0.0, 0.0],   [0.0, 0.8, 0.0] ]
                }
            ]
        }
    },
    AUDIO: { GUN_SNIPPET: 0.15, GUN_START: 1.0, STEP_SNIPPET: 0.25, STEP_START: 0.10 }
};
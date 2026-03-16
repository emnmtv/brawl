import { CONFIG } from './Config.js';

export const MODEL_REGISTRY = {

    t800: {
        ui: {
            displayName: 'T-800',
            subtitle:    'CYBERDYNE MODEL 101',
            description: 'Titanium endoskeleton. Relentless pursuit protocol engaged.',
            stats:       { speed: 6, damage: 9, armor: 9 },
            accent:      '#00ffcc',
            preview:     null,
        },
        path:         'models/t800.glb',
        scale:        10,
        rootRotation: Math.PI,
        upperBodyPattern: /(spine|chest|arm|hand|head|neck)/,
        size: { height: 12, width: 6 },
        bones: {
            hand_R:      'bip_hand_R',
            upper_arm_R: 'bip_upperArm_R',
            lower_arm_R: 'bip_lowerArm_R',
            spine:       'bip_spine',
            head:        'bip_head',
        },
        animations: {
            idle:                   'idle',
            walk_forward:           'walk_forward',
            walk_backward:          'walk_backward',
            walk_left:              'walk_left',
            walk_right:             'walk_right',
            walk_forward_left:      'walk_forward_left',
            walk_forward_right:     'walk_forward_right',
            walk_backward_left:     'walk_backward_left',
            walk_backward_right:    'walk_backward_right',
            run_forward:            'run_forward',
            run_backward:           'run_backward',
            run_left:               'run_left',
            run_right:              'run_right',
            run_forward_left:       'run_forward_left',
            run_forward_right:      'run_forward_right',
            run_backward_left:      'run_backward_left',
            run_backward_right:     'run_backward_right',
            run_forward_firing:     'run_forward_firing',
            run_forward_jump:       'run_forward_jump',
            stationary_jump:        'stationary_jump',
            shoot_idle:             'shoot_idle',
            melee_idle:             'melee_idle',
            melee_walk_forward:     'melee_walk_forward',
            melee_walk_back:        'melee_walk_back',
            melee_walk_left:        'melee_walk_left',
            melee_walk_right:       'melee_walk_right',
            melee_walk_forward_left:    'melee_walk_forward_left',
            melee_walk_forward_right:   'melee_walk_forward_right',
            melee_walk_backward_left:   'melee_walk_backward_left',
            melee_walk_backward_right:  'melee_walk_backward_right',
            melee_run_forward:          'melee_run_forward',
            melee_run_backward:         'melee_run_backward',
            melee_run_left:             'melee_run_left',
            melee_run_right:            'melee_run_right',
            melee_run_forward_left:     'melee_run_forward_left',
            melee_run_forward_right:    'melee_run_forward_right',
            melee_run_backward_left:    'melee_run_backward_left',
            melee_run_backward_right:   'melee_run_backward_right',
            melee_combo_1:          'melee_combo_1',
            melee_combo_2:          'melee_combo_2',
            melee_kick:             'melee_kick',
        },
        // Per-model weapon config — edit here or use the in-game tuner (V key)
        weapons: {
            gun: {
                SCALE: 0.340,
                POS:   [-0.57, 3.00, 0.43],
                ROT:   [1.344, 3.368, -0.524],
                FIRE_RATE: 0.15,
                DAMAGE:    20,
            },
            melee: {
                SCALE: 0.660,
                POS:   [-0.57, 3.00, -1.48],
                ROT:   [1.34, 3.14, -1.47],
                RANGE: 20,
                DAMAGE: 50,
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
    },

    walterwhite: {
        ui: {
            displayName: 'WALTER WHITE',
            subtitle:    'HEISENBERG PROTOCOL',
            description: 'I am the one who knocks.',
            stats:       { speed: 5, damage: 10, armor: 3 },
            accent:      '#f5c542',
            preview:     null,
        },
        path:         'models/walterwhite.glb',
        scale:        1,
        rootRotation: Math.PI,
        upperBodyPattern: /(spine|chest|arm|hand|head|neck)/i,
        size: { height: 5, width: 4.5 },
        bones: {
            hand_R:      'mixamorigRightHand',
            upper_arm_R: 'RightUpperArm',
            lower_arm_R: 'RightForeArm',
            spine:       'Spine',
            head:        'Head',
        },
        animations: {
            idle:          ['Idle', 'idle', 'IDLE'],
            walk_forward:  'walk_forward',
            run_forward:   ['Run', 'Running', 'run_forward'],
            walk_backward: ['Run', 'Running', 'run_backward'],
            shoot_idle:    ['Shoot', 'ShootIdle', 'shoot_idle'],
        },
        // Per-model weapon config — tune these in-game with V key, then copy here
        weapons: {
            gun: {
                SCALE: 0.200,
                POS:   [-0.20, 1.20, 0.20],
                ROT:   [1.344, 3.368, -0.524],
                FIRE_RATE: 0.15,
                DAMAGE:    20,
            },


            // Model: walterwhite  Weapon: MELEE

           melee: {
               SCALE: 1.370,
               POS:   [2.780, 2.520, 2.070],
             ROT:   [-1.780, 2.790, -0.500],
              RANGE: 12,
              DAMAGE: 50,
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
                ],
            },
        },
    },
};

// ───────────────────────────────────────────────────────────────
//  Public API
// ───────────────────────────────────────────────────────────────

export function getModel(modelId) {
    const entry = MODEL_REGISTRY[modelId];
    if (!entry) {
        const valid = Object.keys(MODEL_REGISTRY).join(', ');
        throw new Error(`[ModelRegistry] Unknown model id: "${modelId}". Valid ids: ${valid}`);
    }
    return entry;
}

export function getBoneName(modelId, logicalName) {
    const entry = MODEL_REGISTRY[modelId];
    if (!entry) return logicalName;
    return entry.bones?.[logicalName] ?? logicalName;
}

export function getAnimCandidates(modelId, logicalKey) {
    const entry = MODEL_REGISTRY[modelId];
    if (!entry) return [logicalKey];
    const mapped = entry.animations?.[logicalKey];
    if (!mapped) return [logicalKey];
    return Array.isArray(mapped) ? mapped : [mapped];
}

export function logicalKeyForClip(modelId, actualClipName) {
    const entry = MODEL_REGISTRY[modelId];
    if (!entry?.animations) return null;
    const lower = actualClipName.toLowerCase();
    for (const [logical, mapped] of Object.entries(entry.animations)) {
        const candidates = Array.isArray(mapped) ? mapped : [mapped];
        if (candidates.some(c => c.toLowerCase() === lower)) return logical;
    }
    return null;
}

export function getAllModelIds() {
    return Object.keys(MODEL_REGISTRY);
}

/**
 * getWeaponConfig(modelId, type)
 *
 * Returns a LIVE, STABLE reference to the fully-merged weapon config for this
 * model and weapon type ('gun' or 'melee').
 *
 * HOW IT WORKS — called once per (modelId, type) pair:
 *   1. Deep-clone the global CONFIG.WEAPONS[TYPE] as the base defaults.
 *   2. Spread any per-model overrides on top  (per-model wins on every key).
 *   3. Store the merged object back into entry.weapons[type].
 *   4. All subsequent calls return that same object reference.
 *
 * This means:
 *   - Models with a partial weapons block (e.g. only SCALE/POS/ROT) still get
 *     FIRE_RATE, SWINGS, MODEL, etc. from the global defaults.
 *   - In-game tuner mutations write to the same stable reference and persist.
 *   - Models never share array references (deep-clone prevents cross-model bleed).
 */
export function getWeaponConfig(modelId, type) {
    const entry     = MODEL_REGISTRY[modelId];
    const globalCfg = CONFIG.WEAPONS[type.toUpperCase()];

    if (!entry) return _deepCloneWeaponCfg(globalCfg);   // unknown model — return safe copy

    if (!entry.weapons)            entry.weapons            = {};
    if (!entry._wcInitialized)     entry._wcInitialized     = {};
    if (!entry._wcInitialized[type]) {
        // Deep-clone global defaults so arrays are never shared between models
        const base = _deepCloneWeaponCfg(globalCfg);
        // Spread per-model overrides on top — per-model keys always win
        const modelOverrides = entry.weapons[type] || {};
        entry.weapons[type] = {
            ...base,
            ...modelOverrides,
            // If both sides define SWINGS, per-model wins (already handled by spread above)
        };
        entry._wcInitialized[type] = true;
    }
    return entry.weapons[type];
}

/** Deep-clones a weapon config object so models never share array references. */
function _deepCloneWeaponCfg(cfg) {
    return {
        ...cfg,
        POS: cfg.POS ? [...cfg.POS] : [0, 0, 0],
        ROT: cfg.ROT ? [...cfg.ROT] : [0, 0, 0],
        ...(cfg.SWINGS ? {
            SWINGS: cfg.SWINGS.map(s => ({
                ...s,
                address:       s.address.map(r => [...r]),
                backswing:     s.backswing.map(r => [...r]),
                downswing:     s.downswing.map(r => [...r]),
                impact:        s.impact.map(r => [...r]),
                followThrough: s.followThrough.map(r => [...r]),
            }))
        } : {}),
    };
}

/**
 * Derives all physics, camera, and hitbox constants from a model's size.
 * Reference baseline: height=12, width=6  (the T-800)
 */
export function getSizeConfig(modelId) {
    const entry   = getModel(modelId);
    const size    = entry.size ?? { height: 12, width: 6 };
    const h       = size.height;
    const w       = size.width;
    const r       = h / 12;

    return {
        height: h, width: w,
        walkSpeed:           15  * r,
        runMultiplier:       2.2,
        stepRate:            0.45,
        gravity:             75  * r,
        jumpStrength:        30  * r,
        cameraPivotY:        h * 0.833,
        hitboxCenterOffsetY: h * 0.5,
        hitboxSize:          { x: w, y: h, z: w },
        wallRayHeights:      [h * 0.083, h * 0.417, h * 0.75],
        stepUp:              h * 0.167,
        stepDown:            h * 0.667,
        camOffset:           { x: w * 0.5,  y: h * 0.167, z: h * 1.667 },
        camLookAt:           { x: 0,        y: 0,          z: -h * 8.333 },
    };
}
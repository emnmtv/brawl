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
            spine:       'bip_spine_2',   // mid-chest — best for aim lean
            spine_upper: 'bip_spine_3',   // upper chest — distributes pitch naturally
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
            // Block animations — cycle through all that exist in your GLB
            melee_block:            ['melee_block',   'Block',    'block'],
            melee_block_1:          ['melee_block_1', 'Block1',   'block_1',  'melee_block'],
            melee_block_2:          ['melee_block_2', 'Block2',   'block_2',  'melee_block'],
            melee_block_3:          ['melee_block_3', 'Block3',   'block_3'],
            melee_block_4:          ['melee_block_4', 'Block4',   'block_4'],
            // Hit / damage reaction
            hit_body:               ['hit_body', 'HitBody', 'hit', 'Hit', 'damage', 'Damage'],
            // Weapon swap animations
            equip_melee:            ['equip_melee',   'EquipMelee',   'equip',   'draw_melee'],
            unequip_melee:          ['unequip_melee', 'UnequipMelee', 'unequip', 'holster_melee'],
            // Basic left-click attack animations — map to your actual GLB clip names.
            // First candidate that exists in the loaded GLB wins.
            melee_attack_1: ['melee_1', 'Melee1', 'melee_attack_1', 'melee_combo_1'],
            melee_attack_2: ['melee_2', 'Melee2', 'melee_attack_2', 'melee_combo_2'],
            melee_attack_3: ['melee_3', 'Melee3', 'melee_attack_3', 'melee_kick'],
        },
       // Model: t800
physics: {
  height: 12.000, width: 6.000,
  walkSpeed:      15.000,
  runMultiplier:  2.200,
  stepRate:       0.450,
  gravity:        75.000,
  jumpStrength:   30.000,
  stepUp:         2.000,
  stepDown:       8.000,
  hitboxCenterOffsetY: 3.200,
  hitboxSize: { x: 2.900, y: 7.200, z: 3.700 },
  cameraPivotY:   5.000,
  camOffset: { x: 1.300, y: 1.500, z: 8.500 },
  camLookAt: { x: 0, y: 0, z: -42.000 },
},
        weapons: {
            gun: {
                SCALE: 0.340,
                POS:   [-0.57, 3.00, 0.43],
                ROT:   [1.344, 3.368, -0.524],
                FIRE_RATE: 0.15,
                DAMAGE:    20,
                // Bullet spawn — local offset from the gun mesh origin (tip of barrel)
                // X = right, Y = up, Z = forward (negative = shoot direction)
                BULLET_OFFSET:        [0, 0, -5],
                // Fallback height above player feet when gun mesh isn't loaded yet
                BULLET_HEIGHT_OFFSET: 8,
            },
            melee: {
                SCALE: 0.660,
                POS:   [-0.57, 3.00, -1.48],
                ROT:   [1.34, 3.14, -1.47],
                RANGE: 20,
                DAMAGE: 50,
                SWING_SPEED: 18,
                // Damage box — world-space hitbox active only during hit window.
                // offset: local offset from weapon mesh origin toward blade tip (Z = forward/negative)
                // size:   full extents of the box (width, height, depth along blade)
                // hitWindowStart/End: fraction [0-1] of the clip duration when box deals damage
                damageBox: {
                        offset:         [0, 0, -8],
                        size:           [4, 4, 14],
                    hitWindowStart: 0.25,
                    hitWindowEnd:   0.72,
                },
                // Optional: define multiple swings with different animation timing and damage box configs.
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
        scale:        3,
        rootRotation: Math.PI,
        upperBodyPattern: /(spine|chest|arm|hand|head|neck)/i,
        size: { height: 1, width: 1 },
        bones: {
            hand_R:      'mixamorigRightHand',
            upper_arm_R: 'mixamorigRightArm',
            lower_arm_R: 'mixamorigRightForeArm',
            spine:       'mixamorigSpine',
            head:        'mixamorigHead',
        },
        animations: {
            idle:          ['Idle', 'idle', 'IDLE'],
            walk_forward:  'walk_forward',
            run_forward:   ['Run', 'Running', 'run_forward'],
            walk_backward: ['Run', 'Running', 'run_backward'],
            shoot_idle:    ['Shoot', 'ShootIdle', 'shoot_idle'],
            walk_forward_firing:     'run_forward_firing',
            melee_idle:             'idle',
            melee_walk_forward:     'walk_forward',
            melee_run_forward:      'run_forward',
            melee_walk_backward:    'run_backward',
            melee_run_backward:     'run_backward',
            melee_walk_left:        'walk_left',
            melee_run_left:         'run_left',
            melee_walk_right:       'walk_right',
            melee_run_right:        'run_right',
            melee_attack_1: ['melee_1', ],
            melee_attack_2: ['melee_2', ],
            melee_attack_3: ['melee_3', ],
            melee_block:    ['melee_block',   'Block',  'block',  ],
            melee_block_1:  ['melee_block_1', 'Block1', 'block_1', 'melee_block', ],
            melee_block_2:  ['melee_block_2', 'Block2', 'block_2', 'melee_block', ],
            melee_block_3:  ['melee_block_3', 'Block3', 'block_3'],
            melee_block_4:  ['melee_block_4', 'Block4', 'block_4'],
            hit_body:       ['hit_body', 'HitBody', 'hit', 'Hit', 'damage'],
            equip_melee:    ['equip_melee_1',   'EquipMelee',   'equip',   'draw_melee'],
            unequip_melee:  ['equip_melee_1', 'UnequipMelee', 'unequip', 'holster_melee'],

        },
       // Model: walterwhite
physics: {
  height: 5.000, width: 4.500,
  walkSpeed:      10.500,
  runMultiplier:  1.700,
  stepRate:       0.450,
  gravity:        61.000,
  jumpStrength:   24.500,
  stepUp:         1.000,
  stepDown:       3.600,
  hitboxCenterOffsetY: 2.500,
  hitboxSize: { x: 1.800, y: 4.700, z: 2.400 },
  cameraPivotY:   4.200,
  camOffset: { x: 1.300, y: 1.500, z: 5.500 },
  camLookAt: { x: 0, y: 0, z: -42.000 },
},
        weapons: {
            gun: {
                SCALE: 0.910,
                POS:   [1.000, 1.000, 0.810],
                ROT:   [1.680, 3.140, 1.650],
                FIRE_RATE: 0.15,
                DAMAGE:    20,
                BULLET_OFFSET:        [0, 10, 5],
                BULLET_HEIGHT_OFFSET: 4,
            },
          // Model: walterwhite  Weapon: MELEE

  melee: {
    SCALE: 1.650,
    POS:   [0.260, 0.840, 1.270],
    ROT:   [1.620, 2.520, 0.530],
    RANGE: 12,
    DAMAGE: 50,
    SWING_SPEED: 18,
    damageBox: {
        offset:         [-16.900, -11.300, -6.000],
        size:           [1.800, 5.700, 1.200],
        hitWindowStart: 0.25,
        hitWindowEnd:   0.72,
    },
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
 * Returns a LIVE merged weapon config — per-model values always win over globals.
 */
export function getWeaponConfig(modelId, type) {
    const entry     = MODEL_REGISTRY[modelId];
    const globalCfg = CONFIG.WEAPONS[type.toUpperCase()];

    if (!entry) return _deepCloneWeaponCfg(globalCfg);

    if (!entry.weapons)            entry.weapons            = {};
    if (!entry._wcInitialized)     entry._wcInitialized     = {};
    if (!entry._wcInitialized[type]) {
        const base           = _deepCloneWeaponCfg(globalCfg);
        const modelOverrides = entry.weapons[type] || {};
        entry.weapons[type]  = { ...base, ...modelOverrides };
        entry._wcInitialized[type] = true;
    }
    return entry.weapons[type];
}

function _deepCloneWeaponCfg(cfg) {
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
            }
        } : {}),
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
 * getSizeConfig(modelId)
 * Returns the LIVE physics config object — mutations are immediately visible everywhere.
 */
export function getSizeConfig(modelId) {
    const entry = getModel(modelId);

    if (entry.physics) {
        const p = entry.physics;
        const h = p.height || 12;
        const w = p.width  || 6;
        if (!Array.isArray(p.wallRayHeights))
            p.wallRayHeights = [h * 0.083, h * 0.417, h * 0.75];
        if (!p.hitboxSize || typeof p.hitboxSize !== 'object')
            p.hitboxSize = { x: w, y: h, z: w };
        if (!p.camOffset  || typeof p.camOffset  !== 'object')
            p.camOffset  = { x: w * 0.5, y: h * 0.167, z: h * 1.667 };
        if (!p.camLookAt  || typeof p.camLookAt  !== 'object')
            p.camLookAt  = { x: 0, y: 0, z: -h * 8.333 };
        return p;
    }

    const size = entry.size ?? { height: 12, width: 6 };
    const h = size.height, w = size.width, r = h / 12;
    entry.physics = {
        height: h, width: w,
        walkSpeed:           15   * r,
        runMultiplier:       2.2,
        stepRate:            0.45,
        gravity:             75   * r,
        jumpStrength:        30   * r,
        cameraPivotY:        h * 0.833,
        hitboxCenterOffsetY: h * 0.5,
        hitboxSize:          { x: w, y: h, z: w },
        wallRayHeights:      [h * 0.083, h * 0.417, h * 0.75],
        stepUp:              h * 0.167,
        stepDown:            h * 0.667,
        camOffset:           { x: w * 0.5,  y: h * 0.167, z: h * 1.667 },
        camLookAt:           { x: 0,        y: 0,          z: -h * 8.333 },
    };
    return entry.physics;
}
/**
 * AnimationSystem.js
 *
 * Two exported functions:
 *   buildActionMap      — builds the logical-key → AnimationAction map from raw clips
 *   resolveAnimationTarget — pure function: given locomotion state → logical anim key
 */
import { getModel, logicalKeyForClip } from '../registry/ModelRegistry.js';

// ─────────────────────────────────────────────────────────────
//  buildActionMap
// ─────────────────────────────────────────────────────────────

/**
 * Builds a complete actions map from GLB clips + mixer.
 *
 * @param {THREE.AnimationClip[]} clips
 * @param {THREE.AnimationMixer}  mixer
 * @param {string}                modelId
 * @returns {{ actions: object, slots: { shoot: string } }}
 */
export function buildActionMap(clips, mixer, modelId) {
    const profile      = getModel(modelId);
    const upperBodyRx  = profile.upperBodyPattern || /(spine|chest|arm|hand|head|neck)/;

    const clipByName   = {};
    const actions      = {};
    let   shootSlotKey = 'shoot_idle';

    // Pass 1: index every clip by actual name and logical key
    clips.forEach(clip => {
        const actualLower = clip.name.toLowerCase();
        clipByName[actualLower] = clip;

        const logicalKey = logicalKeyForClip(modelId, clip.name) || actualLower;
        actions[logicalKey] = mixer.clipAction(clip);
        if (logicalKey !== actualLower) actions[actualLower] = actions[logicalKey];

        // Build masked upper-body shoot clip for blending over locomotion
        if (logicalKey.includes('shoot') || logicalKey.includes('fire')) {
            shootSlotKey = logicalKey;
            const maskedClip  = clip.clone();
            maskedClip.name   = logicalKey + '_upperbody';
            maskedClip.tracks = maskedClip.tracks.filter(
                t => t.name.toLowerCase().match(upperBodyRx)
            );
            actions[maskedClip.name] = mixer.clipAction(maskedClip);
        }
    });

    // Pass 2: resolve any logical keys that weren't already matched
    const animMap = profile.animations || {};
    Object.entries(animMap).forEach(([logicalKey, mapped]) => {
        if (actions[logicalKey]) return;
        const candidates = Array.isArray(mapped) ? mapped : [mapped];
        for (const candidate of candidates) {
            const lower = candidate.toLowerCase();
            if (clipByName[lower])  { actions[logicalKey] = mixer.clipAction(clipByName[lower]); break; }
            if (actions[lower])     { actions[logicalKey] = actions[lower]; break; }
        }
    });

    return { actions, slots: { shoot: shootSlotKey } };
}

// ─────────────────────────────────────────────────────────────
//  Animation table — DATA, not code
//
//  Key:   "{weapon}:{speed}:{direction}"
//           weapon    = 'gun' | 'melee'
//           speed     = 'run' | 'walk'
//           direction = 'fwd_left' | 'fwd_right' | 'back_left' | 'back_right'
//                     | 'fwd' | 'back' | 'left' | 'right'
//
//  Value: priority-ordered fallback list — first key that exists in
//         the loaded GLB's action map wins.
//
//  To add a new weapon stance: add a new weapon prefix block.
//  To adjust fallbacks for a direction: edit that one row.
// ─────────────────────────────────────────────────────────────

const ANIM_TABLE = {
    // ── Gun ──────────────────────────────────────────────────
    'gun:run:fwd_left':    ['run_forward_left',    'run_forward',    'walk_forward_left',  'walk_forward', 'idle'],
    'gun:run:fwd_right':   ['run_forward_right',   'run_forward',    'walk_forward_right', 'walk_forward', 'idle'],
    'gun:run:fwd':         ['run_forward_firing',  'run_forward',    'walk_forward',                       'idle'],
    'gun:run:back_left':   ['run_backward_left',   'run_backward',   'walk_backward_left', 'walk_backward','idle'],
    'gun:run:back_right':  ['run_backward_right',  'run_backward',   'walk_backward_right','walk_backward','idle'],
    'gun:run:back':        ['run_backward',                          'walk_backward',                      'idle'],
    'gun:run:left':        ['run_left',                              'walk_left',                          'idle'],
    'gun:run:right':       ['run_right',                             'walk_right',                         'idle'],
    'gun:walk:fwd_left':   ['walk_forward_left',   'walk_forward',                                         'idle'],
    'gun:walk:fwd_right':  ['walk_forward_right',  'walk_forward',                                         'idle'],
    'gun:walk:fwd':        ['walk_forward',                                                                 'idle'],
    'gun:walk:back_left':  ['walk_backward_left',  'walk_backward',                                        'idle'],
    'gun:walk:back_right': ['walk_backward_right', 'walk_backward',                                        'idle'],
    'gun:walk:back':       ['walk_backward',                                                                'idle'],
    'gun:walk:left':       ['walk_left',                                                                    'idle'],
    'gun:walk:right':      ['walk_right',                                                                   'idle'],

    // ── Melee ────────────────────────────────────────────────
    'melee:run:fwd_left':    ['melee_run_forward_left',    'melee_run_forward',    'melee_walk_forward_left',  'melee_walk_forward', 'melee_idle', 'idle'],
    'melee:run:fwd_right':   ['melee_run_forward_right',   'melee_run_forward',    'melee_walk_forward_right', 'melee_walk_forward', 'melee_idle', 'idle'],
    'melee:run:fwd':         ['melee_run_forward',                                 'melee_walk_forward',        'melee_idle', 'idle'],
    'melee:run:back_left':   ['melee_run_backward_left',   'melee_run_backward',   'melee_walk_backward_left', 'melee_walk_back',    'melee_idle', 'idle'],
    'melee:run:back_right':  ['melee_run_backward_right',  'melee_run_backward',   'melee_walk_backward_right','melee_walk_back',    'melee_idle', 'idle'],
    'melee:run:back':        ['melee_run_backward',                                'melee_walk_back',           'melee_idle', 'idle'],
    'melee:run:left':        ['melee_run_left',                                    'melee_walk_left',           'melee_idle', 'idle'],
    'melee:run:right':       ['melee_run_right',                                   'melee_walk_right',          'melee_idle', 'idle'],
    'melee:walk:fwd_left':   ['melee_walk_forward_left',   'melee_walk_forward',   'melee_idle', 'idle'],
    'melee:walk:fwd_right':  ['melee_walk_forward_right',  'melee_walk_forward',   'melee_idle', 'idle'],
    'melee:walk:fwd':        ['melee_walk_forward',                                'melee_idle', 'idle'],
    'melee:walk:back_left':  ['melee_walk_backward_left',  'melee_walk_back',      'melee_idle', 'idle'],
    'melee:walk:back_right': ['melee_walk_backward_right', 'melee_walk_back',      'melee_idle', 'idle'],
    'melee:walk:back':       ['melee_walk_back',                                   'melee_idle', 'idle'],
    'melee:walk:left':       ['melee_walk_left',                                   'melee_idle', 'idle'],
    'melee:walk:right':      ['melee_walk_right',                                  'melee_idle', 'idle'],
};

// Encode direction booleans into a table key segment
function _dirKey(forward, backward, left, right) {
    if (forward  && left)  return 'fwd_left';
    if (forward  && right) return 'fwd_right';
    if (backward && left)  return 'back_left';
    if (backward && right) return 'back_right';
    if (forward)           return 'fwd';
    if (backward)          return 'back';
    if (left)              return 'left';
    if (right)             return 'right';
    return null;
}

// ─────────────────────────────────────────────────────────────
//  resolveAnimationTarget — table-driven, no if-else per state
// ─────────────────────────────────────────────────────────────

/**
 * Given the current locomotion / combat state, returns the logical animation key
 * that should be playing — the first key in the priority list that actually
 * exists in the loaded GLB's action map.
 *
 * @param {object} state  — { isMoving, isShooting, isJumping, forward, backward,
 *                           left, right, isSprinting, weaponType, ultimate, isBlocking }
 * @param {object} actions — the action map from buildActionMap
 * @returns {string|null}
 */
export function resolveAnimationTarget(state, actions) {
    const {
        isMoving, isShooting, isJumping,
        forward, backward, left, right,
        isSprinting, weaponType, ultimate, isBlocking,
    } = state;

    const has  = k => k != null && !!actions[k];
    const pick = (...keys) => keys.find(has) ?? null;

    // ── Priority overrides (order matters) ───────────────────

    // 1. Block (melee only)
    if (isBlocking && weaponType === 'melee')
        return pick('melee_block', 'melee_idle', 'idle');

    // 2. Ultimate (any key name injected externally)
    if (ultimate && has(ultimate)) return ultimate;

    // 3. Jump
    if (isJumping)
        return pick((isSprinting || forward) ? 'run_forward_jump' : 'stationary_jump', 'idle');

    // ── Table lookup for all movement states ─────────────────

    if (isMoving) {
        const weapon = weaponType === 'melee' ? 'melee' : 'gun';
        // For gun+run+fwd, also try run_forward_firing when shooting
        const speed  = isSprinting ? 'run' : 'walk';
        const dir    = _dirKey(forward, backward, left, right);
        if (dir) {
            const candidates = [...(ANIM_TABLE[`${weapon}:${speed}:${dir}`] ?? ['idle'])];
            // Inject run_forward_firing at position 0 for gun sprint-forward while shooting
            if (weapon === 'gun' && speed === 'run' && dir === 'fwd' && !isShooting)
                candidates.shift();   // remove run_forward_firing when not shooting
            return pick(...candidates);
        }
    }

    // ── Stationary ───────────────────────────────────────────

    if (isShooting) return pick('shoot_idle', 'idle');
    if (weaponType === 'melee') return pick('melee_idle', 'idle');
    return pick('idle');
}

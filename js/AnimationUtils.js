import { getModel, logicalKeyForClip, getAnimCandidates } from './ModelRegistry.js';

/**
 * ─────────────────────────────────────────────────────────────
 *  buildActionMap(clips, mixer, modelId)
 *
 *  Builds a { logicalKey → AnimationAction } map so all game
 *  code works with stable logical names regardless of what the
 *  GLB actually calls its clips.
 *
 *  1. Each clip name is translated to a logical key via the registry.
 *     Unknown clips fall back to their lowercased actual name.
 *  2. A convenience alias under the actual name is also kept so
 *     legacy / raw lookups still work.
 *  3. Any shoot-family clip gets an automatic upper-body masked
 *     variant keyed as <logicalKey>_upperbody.
 *
 *  Returns { actions, slots: { shoot } }
 * ─────────────────────────────────────────────────────────────
 */
export function buildActionMap(clips, mixer, modelId) {
    const profile     = getModel(modelId);
    const upperBodyRx = profile.upperBodyPattern || /(spine|chest|arm|hand|head|neck)/;

    // Build a lookup: actual clip name (lowercased) → Three.js AnimationAction
    const clipByName = {};
    const actions    = {};
    let shootSlotKey = 'shoot_idle';

    // ── Pass 1: register every clip by its actual name + reverse-mapped logical key ──
    clips.forEach(clip => {
        const actualLower = clip.name.toLowerCase();
        clipByName[actualLower] = clip;

        const logicalKey = logicalKeyForClip(modelId, clip.name) || actualLower;
        actions[logicalKey] = mixer.clipAction(clip);

        // Alias under actual name so raw-name lookups still work
        if (logicalKey !== actualLower) actions[actualLower] = actions[logicalKey];

        // Auto upper-body mask for shoot/fire family clips
        if (logicalKey.includes('shoot') || logicalKey.includes('fire')) {
            shootSlotKey = logicalKey;
            const maskedClip = clip.clone();
            maskedClip.name   = logicalKey + '_upperbody';
            maskedClip.tracks = maskedClip.tracks.filter(
                t => t.name.toLowerCase().match(upperBodyRx)
            );
            actions[maskedClip.name] = mixer.clipAction(maskedClip);
        }
    });

    // ── Pass 2: forward-map every logical key in the registry ────────────────────────
    // This is what makes  melee_walk_forward: 'walk_forward'  work.
    // For each logical key, find the target clip name(s) from the registry and
    // point that logical key at the matching action — even if the clip was already
    // registered under a different logical key in pass 1.
    const animMap = profile.animations || {};
    Object.entries(animMap).forEach(([logicalKey, mapped]) => {
        if (actions[logicalKey]) return;   // already registered in pass 1 — skip

        const candidates = Array.isArray(mapped) ? mapped : [mapped];
        for (const candidate of candidates) {
            const candidateLower = candidate.toLowerCase();
            // Direct hit: a clip with this exact name exists
            if (clipByName[candidateLower]) {
                actions[logicalKey] = mixer.clipAction(clipByName[candidateLower]);
                break;
            }
            // Indirect hit: the candidate is itself a logical key that was already resolved
            if (actions[candidateLower]) {
                actions[logicalKey] = actions[candidateLower];
                break;
            }
        }
    });

    return { actions, slots: { shoot: shootSlotKey } };
}

/**
 * ─────────────────────────────────────────────────────────────
 *  resolveAnimationTarget(state, actions)
 *
 *  Resolves the best logical animation key for the current
 *  movement / weapon / combat state.
 *
 *  FALLBACK RULE (applied everywhere):
 *    run_* missing  → try the equivalent walk_*
 *    walk_* missing → try the base direction (walk_forward / walk_backward …)
 *    base missing   → idle
 *
 *  Full logical key list this function may return:
 *    Gun stance
 *      idle
 *      walk_forward  walk_backward  walk_left  walk_right
 *      walk_forward_left   walk_forward_right
 *      walk_backward_left  walk_backward_right
 *      run_forward         run_forward_left    run_forward_right
 *      run_backward        run_backward_left   run_backward_right
 *      run_left            run_right
 *      run_forward_firing
 *      run_forward_jump    stationary_jump
 *      shoot_idle
 *    Melee stance  (same but prefixed melee_)
 *      melee_idle
 *      melee_walk_forward  melee_walk_back  melee_walk_left  melee_walk_right
 *      melee_walk_forward_left   melee_walk_forward_right
 *      melee_walk_backward_left  melee_walk_backward_right
 *      melee_run_forward         melee_run_forward_left    melee_run_forward_right
 *      melee_run_backward        melee_run_backward_left   melee_run_backward_right
 *      melee_run_left            melee_run_right
 *      melee_combo_1  melee_combo_2  melee_kick
 * ─────────────────────────────────────────────────────────────
 */
export function resolveAnimationTarget(state, actions) {
    const {
        isMoving, isShooting, isJumping,
        forward, backward, left, right,
        isSprinting, weaponType, ultimate,
    } = state;

    // pick() — return first key that exists in actions, or null
    const has  = k => k != null && !!actions[k];
    const pick = (...keys) => keys.find(has) ?? null;

    // ── 1. Ultimate override ──────────────────────────────────
    if (ultimate && has(ultimate)) return ultimate;

    // ── 2. Jump ──────────────────────────────────────────────
    if (isJumping) {
        return pick(
            (isSprinting || forward) ? 'run_forward_jump' : 'stationary_jump',
            'idle'
        );
    }

    // ── 3. Melee stance ──────────────────────────────────────
    if (weaponType === 'melee') {
        if (isMoving) {
            const p = isSprinting;

            // forward combos
            if (forward && left)  return pick(
                p ? 'melee_run_forward_left'  : 'melee_walk_forward_left',
                p ? 'melee_run_forward'       : 'melee_walk_forward_left',
                'melee_walk_forward_left', 'melee_walk_forward', 'melee_idle', 'idle'
            );
            if (forward && right) return pick(
                p ? 'melee_run_forward_right' : 'melee_walk_forward_right',
                p ? 'melee_run_forward'       : 'melee_walk_forward_right',
                'melee_walk_forward_right', 'melee_walk_forward', 'melee_idle', 'idle'
            );
            if (forward) return pick(
                p ? 'melee_run_forward'  : 'melee_walk_forward',
                'melee_walk_forward', 'melee_idle', 'idle'
            );

            // backward combos
            if (backward && left)  return pick(
                p ? 'melee_run_backward_left'  : 'melee_walk_backward_left',
                p ? 'melee_run_backward'       : 'melee_walk_backward_left',
                'melee_walk_backward_left', 'melee_walk_back', 'melee_idle', 'idle'
            );
            if (backward && right) return pick(
                p ? 'melee_run_backward_right' : 'melee_walk_backward_right',
                p ? 'melee_run_backward'       : 'melee_walk_backward_right',
                'melee_walk_backward_right', 'melee_walk_back', 'melee_idle', 'idle'
            );
            if (backward) return pick(
                p ? 'melee_run_backward' : 'melee_walk_back',
                'melee_walk_back', 'melee_idle', 'idle'
            );

            // pure strafe
            if (left)  return pick(
                p ? 'melee_run_left'  : 'melee_walk_left',
                'melee_walk_left', 'melee_idle', 'idle'
            );
            if (right) return pick(
                p ? 'melee_run_right' : 'melee_walk_right',
                'melee_walk_right', 'melee_idle', 'idle'
            );
        }
        return pick('melee_idle', 'idle');
    }

    // ── 4. Gun / default stance ───────────────────────────────
    if (isMoving) {
        const p = isSprinting;

        // forward combos
        if (forward && left) return pick(
            p ? 'run_forward_left'   : 'walk_forward_left',
            p ? 'run_forward'        : 'walk_forward_left',
            'walk_forward_left', 'walk_forward', 'idle'
        );
        if (forward && right) return pick(
            p ? 'run_forward_right'  : 'walk_forward_right',
            p ? 'run_forward'        : 'walk_forward_right',
            'walk_forward_right', 'walk_forward', 'idle'
        );
        if (forward) return pick(
            p && isShooting ? 'run_forward_firing' : null,
            p ? 'run_forward'   : 'walk_forward',
            'walk_forward', 'idle'
        );

        // backward combos
        if (backward && left) return pick(
            p ? 'run_backward_left'  : 'walk_backward_left',
            p ? 'run_backward'       : 'walk_backward_left',
            'walk_backward_left', 'walk_backward', 'idle'
        );
        if (backward && right) return pick(
            p ? 'run_backward_right' : 'walk_backward_right',
            p ? 'run_backward'       : 'walk_backward_right',
            'walk_backward_right', 'walk_backward', 'idle'
        );
        if (backward) return pick(
            p ? 'run_backward' : 'walk_backward',
            'walk_backward', 'idle'
        );

        // pure strafe
        if (left)  return pick(p ? 'run_left'  : 'walk_left',  'walk_left',  'idle');
        if (right) return pick(p ? 'run_right' : 'walk_right', 'walk_right', 'idle');
    }

    if (isShooting) return pick('shoot_idle', 'idle');
    return pick('idle');
}
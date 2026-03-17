import { getModel, logicalKeyForClip, getAnimCandidates } from './ModelRegistry.js';

export function buildActionMap(clips, mixer, modelId) {
    const profile     = getModel(modelId);
    const upperBodyRx = profile.upperBodyPattern || /(spine|chest|arm|hand|head|neck)/;

    const clipByName = {};
    const actions    = {};
    let shootSlotKey = 'shoot_idle';

    clips.forEach(clip => {
        const actualLower = clip.name.toLowerCase();
        clipByName[actualLower] = clip;

        const logicalKey = logicalKeyForClip(modelId, clip.name) || actualLower;
        actions[logicalKey] = mixer.clipAction(clip);

        if (logicalKey !== actualLower) actions[actualLower] = actions[logicalKey];

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

    const animMap = profile.animations || {};
    Object.entries(animMap).forEach(([logicalKey, mapped]) => {
        if (actions[logicalKey]) return;
        const candidates = Array.isArray(mapped) ? mapped : [mapped];
        for (const candidate of candidates) {
            const candidateLower = candidate.toLowerCase();
            if (clipByName[candidateLower]) {
                actions[logicalKey] = mixer.clipAction(clipByName[candidateLower]);
                break;
            }
            if (actions[candidateLower]) {
                actions[logicalKey] = actions[candidateLower];
                break;
            }
        }
    });

    return { actions, slots: { shoot: shootSlotKey } };
}

/**
 * resolveAnimationTarget
 *
 * Logical keys this function may return (additions vs. original):
 *   melee_block  — when isBlocking is true in melee stance
 *   hit_body     — external call only (not resolver-driven)
 */
export function resolveAnimationTarget(state, actions) {
    const {
        isMoving, isShooting, isJumping,
        forward, backward, left, right,
        isSprinting, weaponType, ultimate, isBlocking,
    } = state;

    const has  = k => k != null && !!actions[k];
    const pick = (...keys) => keys.find(has) ?? null;

    // ── 0. Block override (melee only) ────────────────────────────
    if (isBlocking && weaponType === 'melee') {
        return pick('melee_block', 'melee_idle', 'idle');
    }

    // ── 1. Ultimate override ──────────────────────────────────────
    if (ultimate && has(ultimate)) return ultimate;

    // ── 2. Jump ──────────────────────────────────────────────────
    if (isJumping) {
        return pick(
            (isSprinting || forward) ? 'run_forward_jump' : 'stationary_jump',
            'idle'
        );
    }

    // ── 3. Melee stance ──────────────────────────────────────────
    if (weaponType === 'melee') {
        if (isMoving) {
            const p = isSprinting;

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

            if (left)  return pick(p ? 'melee_run_left'  : 'melee_walk_left',  'melee_walk_left',  'melee_idle', 'idle');
            if (right) return pick(p ? 'melee_run_right' : 'melee_walk_right', 'melee_walk_right', 'melee_idle', 'idle');
        }
        return pick('melee_idle', 'idle');
    }

    // ── 4. Gun / default stance ───────────────────────────────────
    if (isMoving) {
        const p = isSprinting;

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
        if (backward) return pick(p ? 'run_backward' : 'walk_backward', 'walk_backward', 'idle');

        if (left)  return pick(p ? 'run_left'  : 'walk_left',  'walk_left',  'idle');
        if (right) return pick(p ? 'run_right' : 'walk_right', 'walk_right', 'idle');
    }

    if (isShooting) return pick('shoot_idle', 'idle');
    return pick('idle');
}
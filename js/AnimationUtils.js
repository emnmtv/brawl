/**
 * Detects animation slots and creates masked upper-body shoot animation if needed.
 * Returns { slots, actions }.
 *
 * THE BUG THAT WAS HERE:
 *   `safeName.includes('idle')` also matches 'shoot_idle', so slots.idle was being
 *   overwritten with 'shoot_idle', causing both players to always play shoot_idle.
 *
 * FIX: use a two-pass system — prefer clips containing 'idle' but NOT 'shoot',
 * then fall back to any 'idle' clip as a last resort.
 */
export function detectAnimationSlots(clips, mixer) {
    const actions = {};
    const slots = { idle: null, walk: null, shoot: null };

    clips.forEach(clip => {
        const safeName = clip.name.toLowerCase();
        actions[safeName] = mixer.clipAction(clip);

        // Walk slot: prefer 'walk_forward', then any 'walk'
        if (safeName.includes('walk')) {
            if (!slots.walk || safeName === 'walk_forward') {
                slots.walk = safeName;
            }
        }

        // Shoot slot: prefer 'shoot_idle', then any 'shoot'
        if (safeName.includes('shoot')) {
            if (!slots.shoot || safeName === 'shoot_idle') {
                slots.shoot = safeName;
            }
            // Create masked upper-body version
            const maskedClip = clip.clone();
            maskedClip.name = safeName + '_upperbody';
            maskedClip.tracks = maskedClip.tracks.filter(track => {
                const tName = track.name.toLowerCase();
                return tName.includes('spine') || tName.includes('chest') ||
                       tName.includes('arm')   || tName.includes('hand');
            });
            actions[maskedClip.name] = mixer.clipAction(maskedClip);
        }
    });

    // Idle slot — two-pass to prevent 'shoot_idle' from polluting it
    // Pass 1: clip contains 'idle' but NOT 'shoot' and NOT '_upperbody'
    for (const name of Object.keys(actions)) {
        if (name.includes('idle') && !name.includes('shoot') && !name.includes('_upperbody')) {
            slots.idle = name;
            break;
        }
    }
    // Pass 2: allow 'shoot_idle' only if nothing else was found
    if (!slots.idle) {
        for (const name of Object.keys(actions)) {
            if (name.includes('idle') && !name.includes('_upperbody')) {
                slots.idle = name;
                break;
            }
        }
    }

    // Final fallbacks
    const firstClip = Object.keys(actions).find(n => !n.includes('_upperbody')) || Object.keys(actions)[0];
    if (!slots.idle)  slots.idle  = firstClip;
    if (!slots.walk)  slots.walk  = slots.idle;
    if (!slots.shoot) slots.shoot = slots.idle;

    return { slots, actions };
}

/**
 * Shared animation state machine — used by BOTH Character.js (local player)
 * and Network.js (remote players). Guarantees identical animation behavior.
 *
 * @param {object} state   - { isMoving, isShooting, isJumping, forward, backward, left, right, isSprinting }
 * @param {object} actions - map of clip name → AnimationAction
 * @param {object} slots   - { idle, walk, shoot }
 * @returns {string|null}  - clip name to play
 */
export function resolveAnimationTarget(state, actions, slots) {
    const { isMoving, isShooting, isJumping, forward, backward, left, right, isSprinting } = state;
    let targetAnim = null;

    if (isJumping) {
        if (isSprinting || forward) {
            targetAnim = actions['run_forward_jump'] ? 'run_forward_jump' : 'stationary_jump';
        } else {
            targetAnim = actions['stationary_jump'] ? 'stationary_jump' : 'run_forward_jump';
        }
        if (!actions[targetAnim]) targetAnim = null; // no jump clip → keep current

    } else if (isMoving) {
        if (forward) {
            if (isSprinting) {
                if (isShooting && actions['run_forward_firing']) targetAnim = 'run_forward_firing';
                else if (actions['run_forward'])                 targetAnim = 'run_forward';
            }
            if (!targetAnim) {
                if (left)       targetAnim = 'walk_forward_left';
                else if (right) targetAnim = 'walk_forward_right';
                else            targetAnim = 'walk_forward';
            }
        } else if (backward) {
            if (left)       targetAnim = 'walk_backward_left';
            else if (right) targetAnim = 'walk_backward_right';
            else            targetAnim = 'walk_backward_right';
        } else if (left  && !forward && !backward) targetAnim = 'walk_forward_left';
          else if (right && !forward && !backward) targetAnim = 'walk_forward_right';

        // If exact directional clip missing, fall back to walk slot
        if (!actions[targetAnim]) targetAnim = slots.walk;

    } else {
        // Standing still
        targetAnim = (isShooting && slots.shoot) ? slots.shoot : slots.idle;
    }

    return targetAnim || null;
}
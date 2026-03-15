export function detectAnimationSlots(clips, mixer) {
    const actions = {};
    clips.forEach(clip => {
        const safeName = clip.name.toLowerCase();
        actions[safeName] = mixer.clipAction(clip);

        if (safeName.includes('shoot')) {
            const maskedClip = clip.clone();
            maskedClip.name = safeName + '_upperbody';
            maskedClip.tracks = maskedClip.tracks.filter(t => t.name.toLowerCase().match(/(spine|chest|arm|hand|head|neck)/));
            actions[maskedClip.name] = mixer.clipAction(maskedClip);
        }
    });
    return { slots: { shoot: 'shoot_idle' }, actions };
}

export function resolveAnimationTarget(state, actions) {
    const { isMoving, isShooting, isJumping, forward, backward, left, right, isSprinting, weaponType, ultimate } = state;
    
    // 1. Ultimate Override
    if (ultimate && actions[ultimate]) return ultimate;

    // 2. Jumping
    if (isJumping) {
        const jumpAnim = (isSprinting || forward) ? 'run_forward_jump' : 'stationary_jump';
        if (actions[jumpAnim]) return jumpAnim;
    }

    // 3. Melee Stance Locomotion
    if (weaponType === 'melee') {
        if (isMoving) {
            if (forward && isSprinting) return actions['melee_run_forward'] ? 'melee_run_forward' : 'melee_walk_forward';
            if (forward) return actions['melee_walk_forward'] ? 'melee_walk_forward' : 'melee_idle';
            if (backward) return actions['melee_walk_back'] ? 'melee_walk_back' : 'melee_idle';
            if (left) return actions['melee_walk_left'] ? 'melee_walk_left' : 'melee_idle';
            if (right) return actions['melee_walk_right'] ? 'melee_walk_right' : 'melee_idle';
        }
        return actions['melee_idle'] ? 'melee_idle' : 'idle';
    }

    // 4. Gun / Default Stance Locomotion
    if (isMoving) {
        if (forward) {
            if (isSprinting) return (isShooting && actions['run_forward_firing']) ? 'run_forward_firing' : 'run_forward';
            if (left) return actions['walk_forward_left'] ? 'walk_forward_left' : 'walk_forward';
            if (right) return actions['walk_forward_right'] ? 'walk_forward_right' : 'walk_forward';
            return 'walk_forward';
        }
        if (backward) return left ? 'walk_backward_left' : right ? 'walk_backward_right' : 'walk_backward';
        if (left) return 'walk_left';
        if (right) return 'walk_right';
    }

    if (isShooting) return actions['shoot_idle'] ? 'shoot_idle' : 'idle';
    return 'idle';
}
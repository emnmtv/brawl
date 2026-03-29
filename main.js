/**
 * ACTION ARENA — main.js  (DEV BUILD · no enemies)
 *
 * Key animation fixes vs previous build:
 *   1. clipAction() now sets LoopRepeat + clampWhenFinished=false explicitly
 *   2. _playClip() resets _curClip to null before force-starting idle on load
 *      so the "already playing this clip" guard never blocks the first play
 *   3. _playClip() checks prev.isRunning() before crossFadeFrom to avoid
 *      fading from a stopped action (which leaves the new action at weight 0)
 *   4. action.enabled = true; action.paused = false enforced before every play()
 *   5. mixer.timeScale driven by Dev Panel slider (0 = pause, >1 = fast)
 *   6. devPlayClip() bypasses the _curClip guard for manual clip testing
 */

import * as THREE     from 'three';
import { GLTFLoader }  from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader }   from 'three/addons/loaders/FBXLoader.js';
import { SpringCamera } from './SpringCamera.js';

// ─── Global animation cache: url → AnimationClip ─────────────────────────────
const _animCache = new Map();

// ─── DEV globals (written by DevPanel, read by game systems each tick) ────────
const DEV = {
  gravity:    -22,
  friction:    0.78,
  sprintMult:  1.85,
  noclip:      false,
  godMode:     false,
  // weapon/bullet overrides — null means "use characters.json value"
  damageMult:  null,
  fireRate:    null,
  projSpeed:   null,
  projSize:    null,
  range:       null,
  piercing:    false,
  primaryCdMax:  8,
  ultimateCdMax: 45,
  blendTime:   0.25,
  timeScale:   1.0,
};

// ─── Constants ────────────────────────────────────────────────────────────────
const MAP_BOUND = 46;
const PROJ_TTL  = 3.5;
const DEG2RAD  = Math.PI / 180;

// ═══════════════════════════════════════════════════════════════════════════════
//  INPUT MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
class InputManager {
  constructor () {
    this.keys = {};
    this._jd  = {};          // "just-down" flags, consumed by justDown()
    this.mouseBtn   = {};
    this.mouseDelta = { x: 0, y: 0 };
    this.locked     = false;

    window.addEventListener('keydown', e => {
      if (!this.keys[e.code]) this._jd[e.code] = true;
      this.keys[e.code] = true;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault();
      
      // Specifically prevent Ctrl+A, Ctrl+S, etc. if we use Ctrl for game actions
      if (e.ctrlKey && ['KeyA', 'KeyS', 'KeyD', 'KeyW'].includes(e.code)) {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup',     e => { this.keys[e.code]     = false; });
    window.addEventListener('mousedown', e => { this.mouseBtn[e.button] = true; });
    window.addEventListener('mouseup',   e => { this.mouseBtn[e.button] = false; });
    window.addEventListener('contextmenu', e => e.preventDefault());
    window.addEventListener('mousemove', e => {
      if (this.locked) {
        this.mouseDelta.x += e.movementX;
        this.mouseDelta.y += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = !!document.pointerLockElement;
    });
  }

  isDown  (code) { return !!this.keys[code]; }
  isMouse (btn=0){ return !!this.mouseBtn[btn]; }
  justDown (code){ const v = !!this._jd[code]; this._jd[code] = false; return v; }
  consumeDelta () {
    const d = { x: this.mouseDelta.x, y: this.mouseDelta.y };
    this.mouseDelta.x = 0; this.mouseDelta.y = 0;
    return d;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  KINEMATIC BODY
// ═══════════════════════════════════════════════════════════════════════════════
class KinematicBody {
  constructor (pos, radius = 0.45) {
    this.position = pos.clone();
    this.velocity = new THREE.Vector3();
    this.radius   = radius;
    this.onGround = false;
    this.isFlying = false;
  }

  update (dt, staticCols = [], noclip = false, flightParams = null) {
    if (noclip) {
      // Free-fly: integrate, then heavy damping so it stops quickly
      this.position.addScaledVector(this.velocity, dt);
      this.velocity.multiplyScalar(0.80);
      this.onGround = false;
      return;
    }

    if (this.isFlying && flightParams) {
      this.position.addScaledVector(this.velocity, dt);
      this.velocity.multiplyScalar(flightParams.flyFriction);
      this.onGround = false;
      return;
    }

    // Gravity
    if (!this.onGround) this.velocity.y += DEV.gravity * dt;

    // Integrate
    this.position.addScaledVector(this.velocity, dt);

    // Ground
    if (this.position.y < 0) {
      this.position.y = 0; this.velocity.y = 0; this.onGround = true;
    } else if (this.position.y > 0.05) {
      this.onGround = false;
    }

    // Ground friction
    if (this.onGround) {
      this.velocity.x *= DEV.friction;
      this.velocity.z *= DEV.friction;
    }

    // Static collider push-out
    for (const col of staticCols) {
      const dx = this.position.x - col.position.x;
      const dz = this.position.z - col.position.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      const mn = this.radius + col.radius;
      if (d < mn && d > 0.001) {
        const k = (mn - d) / d;
        this.position.x += dx * k; this.position.z += dz * k;
        this.velocity.x  = 0;      this.velocity.z  = 0;
      }
    }

    // Map clamp
    this.position.x = Math.max(-MAP_BOUND, Math.min(MAP_BOUND, this.position.x));
    this.position.z = Math.max(-MAP_BOUND, Math.min(MAP_BOUND, this.position.z));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WEAPONS
// ═══════════════════════════════════════════════════════════════════════════════
class BaseWeapon {
  constructor (cfg) {
    this.cfg       = cfg;
    this.name      = cfg.name     || 'Weapon';
    this._baseDmg  = cfg.damage   || 10;
    this._baseFr   = cfg.fireRate || 0.5;
    this._cd       = 0;
  }
  get damage   () { return DEV.damageMult !== null ? this._baseDmg * DEV.damageMult : this._baseDmg; }
  get fireRate () { return DEV.fireRate   !== null ? DEV.fireRate   : this._baseFr; }
  get ready    () { return this._cd <= 0; }

  update (dt)  { if (this._cd > 0) this._cd -= dt; }

  tryFire (origin, dir, pm, owner) {
    if (!this.ready) return false;
    this._cd = this.fireRate;
    pm.spawn(origin, dir, {
      ...this.cfg,
      damage:          this.damage,
      projectileSpeed: DEV.projSpeed ?? this.cfg.projectileSpeed ?? 30,
      projectileSize:  DEV.projSize  ?? this.cfg.projectileSize  ?? 0.1,
      range:           DEV.range     ?? this.cfg.range           ?? 50,
      piercing:        DEV.piercing  || this.cfg.piercing,
    }, owner);
    return true;
  }
}

function createWeapon (cfg) {
  return cfg ? new BaseWeapon(cfg) : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PROJECTILE MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
class Projectile {
  constructor (scene, origin, dir, cfg, owner) {
    this.owner  = owner;
    this.damage = cfg.damage          || 10;
    this.speed  = cfg.projectileSpeed || 30;
    this.range  = cfg.range           || 50;
    this.pierce = cfg.piercing        || false;
    this.ttl    = PROJ_TTL;
    this.dist   = 0;
    this.alive  = true;
    this.vel    = dir.clone().normalize().multiplyScalar(this.speed);

    const sz  = cfg.projectileSize  || 0.1;
    const col = cfg.projectileColor || '#ffff00';

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(sz, 6, 6),
      new THREE.MeshBasicMaterial({ color: col })
    );
    this.mesh.position.copy(origin);
    // Glow halo
    this.mesh.add(new THREE.Mesh(
      new THREE.SphereGeometry(sz * 2.5, 6, 6),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.25 })
    ));
    scene.add(this.mesh);
    this._scene = scene;
  }

  update (dt) {
    if (!this.alive) return;
    this.ttl -= dt;
    const mv = this.vel.clone().multiplyScalar(dt);
    this.mesh.position.add(mv);
    this.dist += mv.length();
    if (this.ttl <= 0 || this.dist >= this.range || this.mesh.position.y < -1) this.kill();
  }

  kill () {
    if (!this.alive) return;
    this.alive = false;
    this._scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.children.forEach(c => { c.geometry?.dispose(); c.material?.dispose(); });
  }
}

class ProjectileManager {
  constructor (scene) { this._scene = scene; this.pool = []; }

  spawn (origin, dir, cfg, owner) {
    this.pool.push(new Projectile(this._scene, origin, dir, cfg, owner));
  }

  update (dt) {
    this.pool = this.pool.filter(p => p.alive);
    this.pool.forEach(p => p.update(dt));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BASE CHARACTER
// ═══════════════════════════════════════════════════════════════════════════════
class BaseCharacter extends THREE.Group {
  constructor (charData, scene) {
    super();
    this.charData  = charData;
    this._scene    = scene;

    const s        = charData.stats || {};
    this.maxHealth = s.maxHealth || 100;
    this.health    = this.maxHealth;
    this.baseSpeed = s.speed     || 4;
    this.speed     = this.baseSpeed;
    this.jumpForce = s.jumpForce || 8;
    this.isDead    = false;
    this._deathTtl = 3.0;

    this.body   = new KinematicBody(new THREE.Vector3());
    this.weapon = createWeapon(charData.defaultWeapon);
    this.bulletOriginOffset = new THREE.Vector3().copy(charData.bulletOriginOffset || { x: 0, y: 1.4, z: 0.2 });
    this.flightParams = charData.flight ? { ...charData.flight } : { canFly: false };

    // Animation state
    this.mixer     = null;
    this._clips    = {};    // { key: AnimationAction }
    this._curClip  = null;  // currently-active clip key
    this._aimProfile = this._buildAimProfile(charData.aimRig);
    this._aimState = {
      active: false,
      dir: new THREE.Vector3(0, 0, -1),
      yaw: 0,
      pitch: 0,
    };
    this._aimRig = null;
    this._lookRig = null;
    this._firePoseT = 0;

    this.cdPrimary  = 0;
    this.cdUltimate = 0;

    this._buildPlaceholder(charData);
  }

  // ── Placeholder mesh (shown while model is loading or if load fails) ─────────
  _buildPlaceholder (cd) {
    const col = cd.color || '#888';

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.36, 0.85, 4, 8),
      new THREE.MeshLambertMaterial({ color: col })
    );
    body.position.y = 1.0; body.castShadow = true;
    this._bodyMesh = body;
    this.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.24, 8, 8),
      new THREE.MeshLambertMaterial({ color: '#ffcc99' })
    );
    head.position.y = 1.9; head.castShadow = true;
    this.add(head);

    // Eye dots (show facing direction)
    const em = new THREE.MeshBasicMaterial({ color: '#111' });
    const eg = new THREE.SphereGeometry(0.06, 4, 4);
    const eL = new THREE.Mesh(eg, em); eL.position.set(-0.1, 1.92, 0.2);
    const eR = new THREE.Mesh(eg, em); eR.position.set( 0.1, 1.92, 0.2);
    this.add(eL, eR);

    // Gun stub
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.07, 0.42),
      new THREE.MeshLambertMaterial({ color: '#222' })
    );
    gun.position.set(0.42, 1.02, 0.24);
    this.add(gun);

    // Faction ring
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.48, 16),
      new THREE.MeshBasicMaterial({ color: '#00f5d4', side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02;
    this.add(ring);

    this.scale.setScalar(cd.scale || 1);
  }

  // ── Model + animation loading ─────────────────────────────────────────────
  async loadModel (gltfLoader, fbxLoader) {
    const url = this.charData.modelUrl;
    if (!url) return;

    try {
      const { root: model, isFbx } = await this._loadFile(url, gltfLoader, fbxLoader);

      // Mixamo FBX exports at 100× (centimetres) — normalise to metres
      if (isFbx) model.scale.setScalar(0.01);
      model.scale.multiplyScalar(this.charData.scale || 1);

  model.traverse(n => {
  if (n.isMesh) { 
    n.castShadow = true; 
    n.receiveShadow = true;

    // 🔥 FIX TRANSPARENCY / METALLIC ISSUES
    const m = n.material;

    if (m) {
      m.transparent = false;   // MOST IMPORTANT
      m.opacity = 1;
      m.alphaTest = 0;

      m.depthWrite = true;
      m.depthTest = true;

      m.side = THREE.FrontSide;

      m.needsUpdate = true;
    }
  }
});
      // DEBUG: Print bone names in the loaded model
      model.traverse(n => {
        if (n.isBone) {
          console.log('[DEBUG] Model bone:', n.name);
        }
      });

      // Swap out placeholder
      [...this.children].forEach(c => this.remove(c));
      this.add(model);
      this._model = model;
      this._cacheAimRig(model);
      this.scale.setScalar(1); // model already carries the scale

      // Mixer must be created AFTER model is in the scene graph
      this.mixer = new THREE.AnimationMixer(model);


      // Load clips — separate files (animationUrls) or embedded (animations)
      if (this.charData.animationUrls) {
        await this._loadSeparateAnims(this.charData.animationUrls, gltfLoader, fbxLoader);
      } else if (this.charData.animations) {
        await this._loadEmbeddedAnims(url, this.charData.animations, gltfLoader, fbxLoader);
      }

      // Print all loaded animation keys and their durations
      Object.entries(this._clips).forEach(([key, action]) => {
        const clip = action._clip;
        if (clip) {
          console.log(`[DEBUG] Loaded animation: key='${key}', name='${clip.name}', duration=${clip.duration.toFixed(2)}s`);
        } else {
          console.log(`[DEBUG] Loaded animation: key='${key}', but no _clip property`);
        }
      });

      // Fallback: if no 'idle' key, use whatever loaded first
      if (!this._clips.idle) {
        const first = Object.values(this._clips)[0];
        if (first) {
          this._clips.idle = first;
          console.warn('[DEBUG] No "idle" animation found, using first loaded animation as idle.');
        }
      }

      // DEBUG: Print track names of the idle animation
      if (this._clips.idle && this._clips.idle._clip) {
        console.log('[DEBUG] Idle animation tracks:');
        this._clips.idle._clip.tracks.forEach(track => {
          console.log('  ', track.name);
        });
      } else {
        console.warn('[DEBUG] No idle animation to print tracks for.');
      }

      // ── Start idle ────────────────────────────────────────────────────────
      // Reset _curClip to null first so _playClip's guard never blocks this
      this._curClip = null;
      this._startIdle();

      console.log(`[${this.charData.name}] clips loaded: [${Object.keys(this._clips).join(', ')}]`);

      // Tell DevPanel to refresh its list
      window.gameManager?.devPanel?.refreshAnimTab();

    } catch (err) {
      console.warn(`[${this.charData.name}] loadModel failed — placeholder stays.`, err?.message ?? err);
    }
  }

  // Force-start idle cleanly (called right after load)
  _startIdle () {
      const action = this._clips.idle;
      console.log('[DEBUG] _startIdle called. this._clips.idle =', action);
      if (!action) {
        console.warn('[DEBUG] _startIdle: No idle action found in this._clips:', this._clips);
        return;
      }
      action.enabled         = true;
      action.paused          = false;
      action.timeScale       = 1;
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.clampWhenFinished = false;
      action.reset().play();
      this._curClip = 'idle';
      console.log('[DEBUG] _startIdle: Idle animation started.');
  }

  async _loadSeparateAnims (urlMap, gltfLoader, fbxLoader) {
    // Load all animation files in parallel
    await Promise.all(
      Object.entries(urlMap).map(async ([key, animUrl]) => {
        const clip = await this._loadClip(animUrl, gltfLoader, fbxLoader);
        if (!clip) return;
        const action = this.mixer.clipAction(clip);
        if (['jump', 'running_jump', 'attack', 'death'].includes(key)) {
          action.setLoop(THREE.LoopOnce);
          action.clampWhenFinished = true;
        } else {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        }
        this._clips[key] = action;
      })
    );
  }

  async _loadEmbeddedAnims (modelUrl, nameMap, gltfLoader, fbxLoader) {
    try {
      const { clips } = await this._loadFile(modelUrl, gltfLoader, fbxLoader);
      for (const [key, clipName] of Object.entries(nameMap)) {
        const clip = THREE.AnimationClip.findByName(clips, clipName);
        if (!clip) { console.warn(`  clip "${clipName}" not found in ${modelUrl}`); continue; }
        const action = this.mixer.clipAction(clip);
        if (['jump', 'running_jump', 'attack', 'death'].includes(key)) {
          action.setLoop(THREE.LoopOnce);
          action.clampWhenFinished = true;
        } else {
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
        }
        this._clips[key] = action;
      }
    } catch (e) {
      console.warn('  _loadEmbeddedAnims failed:', e?.message);
    }
  }

  // Load any .glb/.gltf/.fbx → { root, clips, isFbx }
  async _loadFile (url, gltfLoader, fbxLoader) {
    const ext = url.split('.').pop().toLowerCase();
    if (ext === 'fbx') {
      const fbx = await new Promise((ok, err) => fbxLoader.load(url, ok, undefined, err));
      return { root: fbx, clips: fbx.animations || [], isFbx: true };
    }
    const gltf = await new Promise((ok, err) => gltfLoader.load(url, ok, undefined, err));
    return { root: gltf.scene, clips: gltf.animations || [], isFbx: false };
  }

  // Load one animation clip, using cache so the same file is only fetched once
  async _loadClip (url, gltfLoader, fbxLoader) {
    if (_animCache.has(url)) {
      return _animCache.get(url).clone(); // each character needs its own clone
    }
    try {
      const { clips } = await this._loadFile(url, gltfLoader, fbxLoader);
      if (!clips.length) { console.warn(`  no clip in "${url}"`); return null; }
      const clip = clips[0];
      this._fixBoneNames(clip);    // strip "Armature|" prefix
      this._stripRootMotion(clip); // remove hip drift
      _animCache.set(url, clip);
      console.log(`  cached "${clip.name}" ← ${url.split('/').pop()}`);
      return clip.clone();
    } catch (e) {
      console.warn(`  clip load failed: ${url}`, e?.message);
      return null;
    }
  }

  // Remove the "Armature|" prefix Mixamo FBX exporter adds to every track
  // Before: "Armature|mixamorigHips.quaternion"
  // After:  "mixamorigHips.quaternion"
  _fixBoneNames (clip) {
    for (const track of clip.tracks) {
      track.name = track.name.replace(/^[^|]+\|/, '');
    }
  }

  // Remove horizontal root-bone drift so physics drives position
  _stripRootMotion (clip) {
    clip.tracks = clip.tracks.filter(t =>
      !(t.name.toLowerCase().includes('hips') && t.name.endsWith('.position'))
    );
  }

  _buildAimProfile (cfg = {}) {
    const defaultBones = {
      mixamorigRightShoulder: { aimWeight: 0.7, fireWeight: 0.45, overrideAnimation: false, aimPose: [0, 0, 0], firePose: [0, 0, 0] },
      mixamorigRightArm:      { aimWeight: 0.9, fireWeight: 0.70, overrideAnimation: false, aimPose: [0, 0, 0], firePose: [0, 0, 0] },
      mixamorigRightForeArm:  { aimWeight: 1.0, fireWeight: 1.00, overrideAnimation: false, aimPose: [0, 0, 0], firePose: [0, 0, 0] },
      mixamorigRightHand:     { aimWeight: 0.40, fireWeight: 1.00, overrideAnimation: true,  aimPose: [0, 0, 0], firePose: [0, 0, 0] },
    };

    const bones = {};
    for (const [boneName, defaults] of Object.entries(defaultBones)) {
      const src = cfg.bones?.[boneName] || {};
      bones[boneName] = {
        aimWeight: src.aimWeight ?? defaults.aimWeight,
        fireWeight: src.fireWeight ?? defaults.fireWeight,
        overrideAnimation: src.overrideAnimation ?? defaults.overrideAnimation,
        aimPose: [...(src.aimPose || defaults.aimPose)],
        firePose: [...(src.firePose || defaults.firePose)],
      };
    }

    return {
      enabled: cfg.enabled ?? true,
      targetDistance: cfg.targetDistance ?? 50,
      firePoseDuration: cfg.firePoseDuration ?? 0.12,
      bones,
    };
  }

  _cacheAimRig (model) {
    const getBone = name => model.getObjectByName(name);
    const getAxisToChild = (bone, child) => {
      if (!bone || !child) return new THREE.Vector3(1, 0, 0);
      const axis = child.position.clone();
      if (axis.lengthSq() < 1e-6) return new THREE.Vector3(1, 0, 0);
      return axis.normalize();
    };
    const rig = {};
    const boneNames = Object.keys(this._aimProfile.bones);

    for (let i = 0; i < boneNames.length; i++) {
      const boneName = boneNames[i];
      const childName = boneNames[i + 1];
      const bone = getBone(boneName);
      const child = childName ? getBone(childName) : null;
      rig[boneName] = bone ? {
        bone,
        axis: getAxisToChild(bone, child),
        restQuat: bone.quaternion.clone(),
      } : null;
    }

    this._aimRig = rig;
    this._cacheLookRig(model);
  }

  _cacheLookRig (model) {
    const getBone = name => model.getObjectByName(name);
    const bones = [
      ['mixamorigHips', 0.10, 0.16],
      ['mixamorigSpine', 0.16, 0.22],
      ['mixamorigSpine1', 0.22, 0.30],
      ['mixamorigSpine2', 0.30, 0.40],
      ['mixamorigNeck', 0.42, 0.55],
      ['mixamorigHead', 0.52, 0.7],
    ];

    this._lookRig = bones
      .map(([name, pitchWeight, yawWeight]) => {
        const bone = getBone(name);
        return bone ? {
          bone,
          pitchWeight,
          yawWeight,
          currentQuat: bone.quaternion.clone(),
          targetQuat: bone.quaternion.clone(),
        } : null;
      })
      .filter(Boolean);
  }

  _setAimState (active, dir, yaw = this._aimState.yaw, pitch = this._aimState.pitch) {
    this._aimState.active = !!active;
    if (dir && dir.lengthSq() > 1e-6) this._aimState.dir.copy(dir).normalize();
    this._aimState.yaw = yaw;
    this._aimState.pitch = pitch;
  }

  _getAimTargetWorld () {
    const target = new THREE.Vector3();

    if (this._cam?.isCamera) {
      const camPos = new THREE.Vector3();
      const camDir = new THREE.Vector3();
      this._cam.getWorldPosition(camPos);
      this._cam.getWorldDirection(camDir);
      // Simplified ray distance. The original calculation could cause issues.
      // By using a fixed distance from the camera, we get a more reliable target
      // on the camera's line-of-sight.
      const rayDistance = this._aimProfile.targetDistance;
      return target.copy(camPos).addScaledVector(camDir, rayDistance);
    }

    return this.shootOrigin.clone().add(this._aimState.dir.clone().multiplyScalar(this._aimProfile.targetDistance));
  }

  _triggerFirePose () {
    this._firePoseT = Math.max(this._firePoseT, this._aimProfile.firePoseDuration || 0);
  }

  getAimRigConfig () {
    return JSON.parse(JSON.stringify(this._aimProfile));
  }

  setAimRigConfig (cfg) {
    this._aimProfile = this._buildAimProfile(cfg);
    this.charData.aimRig = this.getAimRigConfig();
    if (this._model) this._cacheAimRig(this._model);
  }

  _applyAimRig (dt = 1 / 60) {
    const fireActive = this._firePoseT > 0;
    if ((!this._aimState.active && !fireActive) || !this._aimRig || !this._aimProfile.enabled) return;

    // Apply look-at-camera rotation to spine/head first
    this._applyLookRig(dt);

    // Instead of aiming at a world target, we use the camera's direction directly.
    // This ensures the arm rotation is parallel to the bullet trajectory, fixing the parallax issue.
    const desiredDir = this._aimState.dir;

    const worldQuat   = new THREE.Quaternion();
    const parentQuat  = new THREE.Quaternion();
    const desiredQuat = new THREE.Quaternion();
    const deltaQuat   = new THREE.Quaternion();
    const currentAxis = new THREE.Vector3();
    const poseQuat    = new THREE.Quaternion();
    const firePoseQuat= new THREE.Quaternion();
    const finalQuat   = new THREE.Quaternion();

    for (const [boneName, cfg] of Object.entries(this._aimProfile.bones)) {
      const part = this._aimRig[boneName];
      if (!part?.bone) continue;

      const trackWeight = fireActive ? cfg.fireWeight : cfg.aimWeight;

      if (trackWeight > 0) {
        part.bone.getWorldQuaternion(worldQuat);
        currentAxis.copy(part.axis).applyQuaternion(worldQuat).normalize();
        deltaQuat.setFromUnitVectors(currentAxis, desiredDir);
        desiredQuat.copy(deltaQuat).multiply(worldQuat);

        if (part.bone.parent) {
          part.bone.parent.getWorldQuaternion(parentQuat).invert();
          desiredQuat.premultiply(parentQuat);
        }
      } else {
        desiredQuat.copy(cfg.overrideAnimation ? part.restQuat : part.bone.quaternion);
      }

      poseQuat.setFromEuler(new THREE.Euler(
        (cfg.aimPose?.[0] || 0) * DEG2RAD,
        (cfg.aimPose?.[1] || 0) * DEG2RAD,
        (cfg.aimPose?.[2] || 0) * DEG2RAD,
        'XYZ'
      ));
      finalQuat.copy(desiredQuat).multiply(poseQuat);

      if (fireActive) {
        firePoseQuat.setFromEuler(new THREE.Euler(
          (cfg.firePose?.[0] || 0) * DEG2RAD,
          (cfg.firePose?.[1] || 0) * DEG2RAD,
          (cfg.firePose?.[2] || 0) * DEG2RAD,
          'XYZ'
        ));
        finalQuat.multiply(firePoseQuat);
      }

      if (cfg.overrideAnimation || trackWeight >= 0.999) part.bone.quaternion.copy(finalQuat);
      else part.bone.quaternion.slerp(finalQuat, Math.max(0, Math.min(1, trackWeight)));
      part.bone.updateMatrixWorld(true);
    }
  }

  _applyLookRig (dt = 1 / 60) {
    if (!this._lookRig?.length) return;

    const yawDelta = Math.atan2(
      Math.sin(this._aimState.yaw - this.rotation.y),
      Math.cos(this._aimState.yaw - this.rotation.y)
    );
    const lookYaw = THREE.MathUtils.clamp(-yawDelta, -0.65, 0.65);
    const lookPitch = THREE.MathUtils.clamp(this._aimState.pitch, -0.55, 0.55);
    const blend = 1 - Math.exp(-dt * 14);
    const poseQuat = new THREE.Quaternion();
    const animatedQuat = new THREE.Quaternion();

    for (const part of this._lookRig) {
      animatedQuat.copy(part.bone.quaternion);
      poseQuat.setFromEuler(new THREE.Euler(
        lookPitch * part.pitchWeight,
        lookYaw * part.yawWeight,
        0,
        'XYZ'
      ));
      part.targetQuat.copy(animatedQuat).multiply(poseQuat);
      part.currentQuat.slerp(part.targetQuat, blend);
      part.bone.quaternion.copy(part.currentQuat);
      part.bone.updateMatrixWorld(true);
    }
  }

  // ── Animation playback ─────────────────────────────────────────────────────
  /**
   * Transition to a named clip. Safe to call every frame.
   * Guards:
   *   - returns early if that clip is already the active one
   *   - checks prev.isRunning() before crossFadeFrom so we never fade
   *     from a stopped/reset action (which would leave the new action at weight 0)
   */
  _playClip (name) {
    if (this._curClip === name) {
      // Removed debug log to prevent spam
      return; // already playing
    }
    const next = this._clips[name];
    if (!next) {
      console.warn(`[DEBUG] _playClip('${name}') failed: clip not loaded. this._clips:`, this._clips);
      return;
    }

    const prev = this._clips[this._curClip];

    // Ensure the target action is in a good state before playing
    next.enabled   = true;
    next.paused    = false;
    next.timeScale = 1;

    if (prev && prev.isRunning()) {
      console.log(`[DEBUG] _playClip('${name}'): crossfading from '${this._curClip}'.`);
      next.reset().crossFadeFrom(prev, DEV.blendTime, false).play();
    } else {
      // If there's a previous clip that's not running (e.g. a clamped, finished one-shot),
      // explicitly fade it out.
      if (prev) {
        prev.fadeOut(DEV.blendTime);
      }
      // Fade in the new clip.
      console.log(`[DEBUG] _playClip('${name}'): fading in.`);
      next.reset().fadeIn(DEV.blendTime > 0 ? DEV.blendTime : 0).play();
    }

    this._curClip = name;
    // Removed debug log to prevent spam
  }

  /**
   * Force-play a clip by key, bypassing the "already playing" guard.
   * Used by DevPanel's ▶ PLAY buttons for manual testing.
   */
  devPlayClip (name) {
    const action = this._clips[name]; if (!action) return;
    this.mixer?.stopAllAction();
    action.enabled = true; action.paused = false; action.timeScale = 1;
    action.reset().play();
    this._curClip = name;
  }

  // Advance the animation mixer — called inside _baseUpdate every frame
  _tickMixer (dt) {
    if (!this.mixer) return;
    this.mixer.timeScale = DEV.timeScale; // let DevPanel slow/pause/speed up
    this.mixer.update(dt);
  }

  // ── Health / damage ────────────────────────────────────────────────────────
  takeDamage (amount) {
    if (this.isDead) return;
    if (DEV.godMode) return; // invincible
    this.health = Math.max(0, this.health - amount);
    this.traverse(n => {
      if (n.isMesh && n.material?.emissive) {
        n.material.emissive.setHex(0xff2200);
        setTimeout(() => { if (n.material) n.material.emissive.setHex(0); }, 120);
      }
    });
    _spawnDmgNum(Math.round(amount));
    if (this.health <= 0) this._die();
  }

  heal (amount) { this.health = Math.min(this.maxHealth, this.health + amount); }

  _die () {
    if (this.isDead) return;
    this.isDead    = true;
    this._playClip('death');
    this.rotation.z = Math.PI / 2; this.position.y = 0;
  }

  get shootOrigin () {
    const handBone = this._model?.getObjectByName('mixamorigRightHand');

    // If we have a rigged hand and are aiming/firing, use it for origin
    if (handBone && (this._aimState.active || this._firePoseT > 0)) {
      const handPosition = new THREE.Vector3();
      handBone.getWorldPosition(handPosition);

      // Move origin slightly forward from the hand wrist, along the aim direction
      // We use the aim direction from the state, which is synced from the camera
      const forwardOffset = 0.2; // 20cm
      if (this._aimState.dir.lengthSq() > 1e-6) {
        handPosition.addScaledVector(this._aimState.dir, forwardOffset);
      }
      
      // Add a slight vertical offset to better align with a potential gun model
      handPosition.y += 0.05;

      return handPosition;
    }

    // Fallback to old logic (placeholder or non-aiming)
    const offset = this.bulletOriginOffset.clone();
    // Apply character's rotation to make the offset relative to the character's facing direction
    offset.applyQuaternion(this.quaternion);
    return this.body.position.clone().add(offset);
  }

  // ── Effect / buff system ───────────────────────────────────────────────────
  _effects = {};
  _applyEffect (key, eff) {
    if (this._effects[key]) this._clearEffect(key);
    this._effects[key] = eff;
    if (eff.speedMult) this.speed = this.baseSpeed * eff.speedMult;
    if (eff.damageMult && this.weapon) this.weapon._baseDmg = (this.charData.defaultWeapon?.damage || 10) * eff.damageMult;
    if (eff.aura) this.add(eff.aura);
  }
  _clearEffect (key) {
    const eff = this._effects[key]; if (!eff) return;
    if (eff.aura) this.remove(eff.aura);
    this.speed = this.baseSpeed;
    if (this.weapon) this.weapon._baseDmg = this.charData.defaultWeapon?.damage || 10;
    delete this._effects[key];
  }
  _makeAura (color, opacity, radius) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 12, 12),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide })
    );
    m.position.y = 1; return m;
  }

  // ── Shared per-frame update (call from subclass update) ───────────────────
  _baseUpdate (dt) {
    if (this.isDead) { this._deathTtl -= dt; return; }

    this.position.copy(this.body.position);
    if (this._firePoseT > 0) this._firePoseT = Math.max(0, this._firePoseT - dt);

    if (this.cdPrimary  > 0) this.cdPrimary  -= dt;
    if (this.cdUltimate > 0) this.cdUltimate -= dt;

    for (const [k, eff] of Object.entries(this._effects)) {
      eff.duration -= dt;
      if (eff.duration <= 0) this._clearEffect(k);
    }

    this.weapon?.update(dt);
    this._tickMixer(dt); // ← drives all AnimationActions
  }

  dispose () {
    this._scene.remove(this);
    this.mixer?.stopAllAction();
    this.traverse(n => {
      n.geometry?.dispose();
      if (n.material) {
        if (Array.isArray(n.material)) n.material.forEach(m => m.dispose());
        else n.material.dispose();
      }
    });
  }
}

function _spawnDmgNum (val) {
  if (!document.getElementById('dmg-kf')) {
    const s = document.createElement('style');
    s.id = 'dmg-kf';
    s.textContent = '@keyframes floatDmg{0%{opacity:1;transform:translateY(0)}100%{opacity:0;transform:translateY(-55px)}}';
    document.head.appendChild(s);
  }
  const el = document.createElement('div');
  el.textContent = `-${val}`;
  el.style.cssText = `position:fixed;pointer-events:none;z-index:50;font-family:'Rajdhani',sans-serif;font-weight:700;font-size:1.1rem;color:#ff2244;text-shadow:0 0 8px currentColor;animation:floatDmg .9s ease-out forwards;left:${40+Math.random()*20}%;top:${30+Math.random()*10}%;`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PLAYER CONTROLLER
// ═══════════════════════════════════════════════════════════════════════════════
class PlayerController extends BaseCharacter {
  constructor (charData, scene, camera) {
    super(charData, scene);
    this._cam    = camera;
    this._yaw    = 0;
    this._pitch  = -0.25;
    this._jumpCd  = 0;
    this._lastJumpPress = 0;
    this._jumpPressInterval = 0.3;
    this._isArmed = true;    // Player starts with weapon equipped
    this._punchCd = 0;      // Cooldown for unarmed attacks
    this._isPunching = false; // Is an attack animation playing?
    // Camera config for SpringCamera — load from charData.camera if present
    const defaultCam = { camOffset: { x: 0.7, y: 1.6, z: 5.5 }, cameraPivotY: 1.6 };
    if (charData.camera) {
      this._sizeConfig = {
        camOffset: { ...defaultCam.camOffset, ...(charData.camera.camOffset || {}) },
        cameraPivotY: charData.camera.cameraPivotY ?? defaultCam.cameraPivotY
      };
    } else {
      this._sizeConfig = defaultCam;
    }
    // Force play idle animation on creation
    this._playClip('idle');
  }

  _toggleFly () {
    if (!this.flightParams.canFly) return;
    this.body.isFlying = !this.body.isFlying;

    if (this.body.isFlying) {
      this.body.velocity.y = 0; // Prevent falling while toggling
      this._playClip('float');
      window.gameManager?.ui.showMessage('Flight Mode ON', 1500);
    } else {
      window.gameManager?.ui.showMessage('Flight Mode OFF', 1500);
    }
  }

  _rotateTowardYaw (targetYaw, dt, speed = 14) {
    const delta = Math.atan2(Math.sin(targetYaw - this.rotation.y), Math.cos(targetYaw - this.rotation.y));
    const step = Math.min(1, dt * speed);
    this.rotation.y += delta * step;
  }

  _syncAimFromCamera () {
    const camDir = new THREE.Vector3();
    this._cam.getWorldDirection(camDir);
    camDir.normalize();
    const yaw = Math.atan2(-camDir.x, -camDir.z);
    const pitch = Math.asin(THREE.MathUtils.clamp(-camDir.y, -1, 1));
    this._setAimState(this._aimState.active, camDir, yaw, pitch);
    return camDir;
  }

  handleInput (input, dt, pm) {
    if (this.isDead) return;

    // ── Weapon switching ───────────────────────────────────────────────────
    if (input.justDown('Digit1')) {
      this._isArmed = !this._isArmed;
      window.gameManager?.ui.showMessage(this._isArmed ? 'Weapon Equipped' : 'Unarmed', 1500);
    }

    // ── Camera look ────────────────────────────────────────────────────────
    const delta = input.consumeDelta();
    this._yaw   -= delta.x * 0.0022;
    // Allow much wider pitch (almost straight up/down, but not flipping)
    const maxPitch = Math.PI/2 - 0.1;
    const minPitch = -Math.PI/2 + 0.1;
    this._pitch = Math.max(minPitch, Math.min(maxPitch, this._pitch + delta.y * 0.0022));

    // Calculate movement vectors from yaw and pitch. These are used for player
    // movement input and may not match the camera's final direction perfectly.
    const fwd = new THREE.Vector3(
      -Math.sin(this._yaw) * Math.cos(this._pitch),
      -Math.sin(this._pitch), // flip sign to fix inversion
      -Math.cos(this._yaw) * Math.cos(this._pitch)
    );
    const right = new THREE.Vector3(
      Math.cos(this._yaw),
      0,
      -Math.sin(this._yaw)
    );

    // For accurate shooting, get the world direction from the camera itself.
    // This is the "true" direction the player is looking and where projectiles should go.
    const camDir = new THREE.Vector3();
    this._cam.getWorldDirection(camDir);

    const isAiming = input.isMouse(2);
    const isFiring = input.isMouse(0) || input.isDown('KeyF');
    // We still pass camDir to _setAimState for consistency, although the visual
    // aiming rig on the player character reads the camera direction directly.
    this._setAimState(isAiming || isFiring, camDir, this._yaw, this._pitch);

    // ── Movement ───────────────────────────────────────────────────────────
    const move   = new THREE.Vector3();
    const sprint = input.isDown('ShiftLeft') || input.isDown('ShiftRight');

    if (input.isDown('KeyW') || input.isDown('ArrowUp'))    move.add(fwd);
    if (input.isDown('KeyS') || input.isDown('ArrowDown'))  move.sub(fwd);
    if (input.isDown('KeyA') || input.isDown('ArrowLeft'))  move.sub(right);
    if (input.isDown('KeyD') || input.isDown('ArrowRight')) move.add(right);

    // Double-tap jump to toggle flight
    if (input.justDown('Space')) {
      const now = performance.now() / 1000;
      if (now - this._lastJumpPress < this._jumpPressInterval) {
        this._toggleFly();
      }
      this._lastJumpPress = now;
    }

    if (DEV.noclip) {
      // ── No-clip: 6DOF free flight ────────────────────────────────────────
      if (move.lengthSq() > 0) {
        move.normalize();
        this.body.velocity.x = move.x * this.speed * 3;
        this.body.velocity.z = move.z * this.speed * 3;
      }
      if      (input.isDown('Space'))                                        this.body.velocity.y =  this.speed * 3;
      else if (input.isDown('ControlLeft') || input.isDown('ControlRight')) this.body.velocity.y = -this.speed * 3;
      else                                                                   this.body.velocity.y *= 0.8;
      if (isAiming) this._rotateTowardYaw(Math.atan2(camDir.x, camDir.z), dt);
      else this.rotation.y = Math.atan2(fwd.x, fwd.z);
      // Keep idle playing in noclip so we have a visual reference
      this._playClip('idle');

    } else if (this.body.isFlying) {
      // ── Flight movement: fly where you look ──────────────────────────────
      const isMoving = move.lengthSq() > 0.01;
      const flySpeed = this.flightParams.flySpeed || 10;
      const currentSpeed = sprint ? flySpeed * DEV.sprintMult : flySpeed;
      
      // When moving, velocity is based on camera direction
      if (isMoving) {
        move.normalize();
        this.body.velocity.copy(move).multiplyScalar(currentSpeed);
      }

      // Vertical thrust is only for hovering up/down
      if (input.isDown('Space')) {
        this.body.velocity.y = this.flightParams.ascendSpeed || 5;
      } else if (input.isDown('ControlLeft') || input.isDown('ControlRight')) {
        this.body.velocity.y = - (this.flightParams.descendSpeed || 5);
      } else {
        // If not moving and not using vertical thrust, hover
        if (!isMoving) {
          this.body.velocity.y *= 0.9;
        }
      }
      
      // Always face camera direction when flying
      this.rotation.y = Math.atan2(fwd.x, fwd.z);

      // Animation
      if (isMoving) {
        this._playClip(sprint ? 'flying' : 'float');
      } else {
        this._playClip('float');
      }
    
    } else {
      // ── Normal movement ──────────────────────────────────────────────────
      // Don't play movement animations if we are in the middle of an attack
      if (!this._isPunching) {
        if (this.body.onGround) {
          if (move.lengthSq() > 0) {
            move.normalize();
            const spd = this.speed * (sprint ? DEV.sprintMult : 1.0);
            this.body.velocity.x = move.x * spd;
            this.body.velocity.z = move.z * spd;
            if (isAiming) this._rotateTowardYaw(Math.atan2(camDir.x, camDir.z), dt);
            else this.rotation.y = Math.atan2(move.x, move.z);
            this._playClip(sprint ? 'run' : 'walk');
          } else {
            // Dampen and play idle
            this.body.velocity.x *= 0.65;
            this.body.velocity.z *= 0.65;
            if (isAiming) this._rotateTowardYaw(Math.atan2(camDir.x, camDir.z), dt);
            this._playClip('idle');
          }
        }
      }

      // Jump
      if (input.isDown('Space') && this.body.onGround && this._jumpCd <= 0) {
        this.body.velocity.y = this.jumpForce;
        this.body.onGround   = false;
        this._jumpCd         = 0.55;
        this._playClip(move.lengthSq() > 0.1 ? 'running_jump' : 'jump');
      }
    }

    if (this._jumpCd > 0) this._jumpCd -= dt;

    // ── Shoot / Attack ─────────────────────────────────────────────────────
    if (input.isMouse(0) || input.isDown('KeyF')) {
      if (this._isArmed) {
        const didFire = this.weapon?.tryFire(this.shootOrigin, camDir, pm, 'player');
        if (didFire) this._triggerFirePose();
      } else {
        if (this._punchCd <= 0) {
          this._playClip('attack');
          this._punchCd = 0.5; // 0.5s cooldown

          this._isPunching = true;
          
          // Listen for the animation to finish
          const listener = (e) => {
            if (e.action === this._clips.attack) {
              this._isPunching = false;
              this.mixer.removeEventListener('finished', listener);
            }
          };
          this.mixer.addEventListener('finished', listener);
        }
      }
    }

    // ── Skills ─────────────────────────────────────────────────────────────
    if (input.justDown('KeyE')) this._activatePrimary(pm, fwd);
    if (input.justDown('KeyQ')) this._activateUltimate(pm, fwd);
  }

  _activatePrimary (pm, dir) {
    const sk = this.charData.skills?.primary;
    if (!sk || this.cdPrimary > 0) {
      if (this.cdPrimary > 0) window.gameManager?.ui.showMessage(`⏱ ${this.cdPrimary.toFixed(1)}s remaining`);
      return;
    }
    this.cdPrimary = DEV.primaryCdMax;
    const id = this.charData.id;

    if (id === 'walter_white') {
      this._applyEffect('blueSky', {
        duration: 5, speedMult: 2, damageMult: 1.8, aura: this._makeAura('#00aaff', 0.35, 1.6)
      });
      window.gameManager?.ui.showMessage('⚗ BLUE SKY BOOST');

    } else if (id === 't800') {
      pm.spawn(this.shootOrigin, dir, {
        damage: (this.charData.defaultWeapon.damage || 10) * 4,
        projectileSpeed: 65, range: 90,
        projectileColor: '#00ffff', projectileSize: 0.28, piercing: true
      }, 'player');
      window.gameManager?.ui.showMessage('⚡ PLASMA SHOT');

    } else if (id === 'mando') {
      this.body.velocity.x = dir.x * 24;
      this.body.velocity.z = dir.z * 24;
      this.body.velocity.y = 5;
      window.gameManager?.ui.showMessage('🚀 JETPACK DASH');

    } else {
      // Generic burst
      const cfg = { ...this.charData.defaultWeapon, damage: (this.charData.defaultWeapon?.damage || 10) * 1.5 };
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const sp = dir.clone().add(new THREE.Vector3((Math.random()-0.5)*0.2, 0, (Math.random()-0.5)*0.2)).normalize();
          pm.spawn(this.shootOrigin, sp, cfg, 'player');
        }, i * 80);
      }
      window.gameManager?.ui.showMessage('⚡ BURST FIRE');
    }
  }

  _activateUltimate (pm, dir) {
    const sk = this.charData.skills?.ultimate;
    if (!sk || this.cdUltimate > 0) {
      if (this.cdUltimate > 0) window.gameManager?.ui.showMessage(`⏱ ${this.cdUltimate.toFixed(1)}s remaining`);
      return;
    }
    this.cdUltimate = DEV.ultimateCdMax;
    window.gameManager?.ui.showMessage(`✦ ${sk.name || 'ULTIMATE'}`, 2000);
  }

  // _updateCamera is now handled by SpringCamera

  update (dt, pm, cols, springCamera) {
    this._baseUpdate(dt);
    if (this._punchCd > 0) this._punchCd -= dt;
    if (!this.isDead) {
      this.body.update(dt, cols, DEV.noclip, this.flightParams);

      // Flight tilting
      if (this.body.isFlying) {
        const localVelocity = this.body.velocity.clone().applyQuaternion(this.quaternion.clone().invert());
        
        const targetPitch = localVelocity.y * 0.05; // Ascend/descend pitch

        const lerpFactor = 0.08;
        this.rotation.x = THREE.MathUtils.lerp(this.rotation.x, targetPitch, lerpFactor);
        this.rotation.z = THREE.MathUtils.lerp(this.rotation.z, 0, lerpFactor); // remove roll
      } else {
        // Reset tilt when not flying
        const lerpFactor = 0.08;
        this.rotation.z = THREE.MathUtils.lerp(this.rotation.z, 0, lerpFactor);
        this.rotation.x = THREE.MathUtils.lerp(this.rotation.x, 0, lerpFactor);
      }

      // Use SpringCamera for camera updates
      if (springCamera) {
        springCamera.update(
          this, // player mesh
          this._sizeConfig,
          this._yaw,
          this._pitch,
          cols?.map(c => c.mesh).filter(Boolean) // collision meshes
        );
      }
      if (this._aimState.active || this._firePoseT > 0) this._syncAimFromCamera();

      // Don't apply procedural aim rig if we're in the middle of a punch animation
      if (!this._isPunching) {
        this._applyAimRig(dt);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LEVEL BUILDER
// ═══════════════════════════════════════════════════════════════════════════════
class LevelBuilder {
  constructor (scene) { this._scene = scene; this.colliders = []; }

  build () { this._ground(); this._buildings(); }

  _ground () {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(100, 100, 20, 20),
      new THREE.MeshLambertMaterial({ color: '#1e3a1e' })
    );
    mesh.rotation.x = -Math.PI / 2; mesh.receiveShadow = true;
    this._scene.add(mesh);
    const grid = new THREE.GridHelper(100, 25, '#143214', '#143214');
    grid.position.y = 0.01;
    this._scene.add(grid);
  }

  _buildings () {
    const layout = [
      [ 12, 10, 5, 7, 5, '#5c4033'], [-13,  9, 4, 5, 8, '#4a3728'],
      [  6,-16, 7, 6, 4, '#606060'], [ -9,-11, 5, 9, 5, '#707070'],
      [ 19, -4, 4, 5, 6, '#5c4033'], [-19,  6, 6, 4, 4, '#555'],
      [  0, 22, 9, 5, 4, '#7b5e42'], [  0,-24, 9, 5, 4, '#7b5e42'],
    ];
    for (const [x, z, w, h, d, col] of layout) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: col }));
      mesh.position.set(x, h/2, z); mesh.castShadow = true; mesh.receiveShadow = true;
      this._scene.add(mesh);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(w+0.2, 0.2, d+0.2), new THREE.MeshLambertMaterial({ color: '#2a2a2a' }));
      roof.position.set(x, h+0.1, z); this._scene.add(roof);
      this.colliders.push({ position: new THREE.Vector3(x, 0, z), radius: Math.max(w, d) * 0.52 });
    }

    // Cover crates
    for (const [cx, cz] of [[3.5,3.5],[-3.5,5.5],[7.5,-3.5],[-6.5,-2.5]]) {
      const sz = 1.2 + Math.random() * 0.6;
      const m  = new THREE.Mesh(new THREE.BoxGeometry(sz,sz,sz), new THREE.MeshLambertMaterial({ color: '#8B6914' }));
      m.position.set(cx, sz/2, cz); m.castShadow = true; this._scene.add(m);
      this.colliders.push({ position: new THREE.Vector3(cx, 0, cz), radius: sz * 0.65 });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UI MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
class UIManager {
  constructor () { this._msgTimer = null; }
  $ (id) { return document.getElementById(id); }

  update (player) {
    if (!player) return;

    const pct  = (player.health / player.maxHealth) * 100;
    const fill = this.$('health-fill');
    if (fill) {
      fill.style.width      = pct + '%';
      fill.style.background = pct > 60 ? 'var(--safe)' : pct > 30 ? 'var(--warn)' : 'var(--danger)';
    }
    const ht = this.$('health-text');
    if (ht) ht.textContent = `${Math.ceil(player.health)} / ${player.maxHealth}`;

    this._updateSkill('primary',  player.cdPrimary,  DEV.primaryCdMax);
    this._updateSkill('ultimate', player.cdUltimate, DEV.ultimateCdMax);
  }

  _updateSkill (which, cd, max) {
    const cdEl   = this.$(`${which}-cd`);
    const fillEl = this.$(`${which}-fill`);
    const ready  = cd <= 0;
    if (cdEl)   { cdEl.textContent = ready ? 'READY' : cd.toFixed(1) + 's'; cdEl.className = 'skill-cd' + (ready ? '' : ' active'); }
    if (fillEl) { fillEl.style.height = ((1 - Math.min(1, cd / max)) * 100) + '%'; }
  }

  setCharInfo (cd) {
    const cn = this.$('char-name');    if (cn) cn.textContent = '// ' + cd.name.toUpperCase();
    const s1 = this.$('skill-name-1');if (s1) s1.textContent = cd.skills?.primary?.name   || 'Skill';
    const s2 = this.$('skill-name-2');if (s2) s2.textContent = cd.skills?.ultimate?.name  || 'Ultimate';
    const wn = this.$('weapon-name'); if (wn) wn.textContent = '🔫 ' + (cd.defaultWeapon?.name || '—');
    const emo = { walter_white:'⚗', t800:'⚡', mando:'🚀' };
    const ult = { walter_white:'👤', t800:'☢', mando:'🐦' };
    const e1 = this.$('primary-emoji');  if (e1) e1.textContent = emo[cd.id] || '⚡';
    const e2 = this.$('ultimate-emoji'); if (e2) e2.textContent = ult[cd.id] || '💥';
  }

  showMessage (text, dur = 2500) {
    const el = this.$('message'); if (!el) return;
    el.textContent = text; el.style.opacity = '1';
    clearTimeout(this._msgTimer);
    this._msgTimer = setTimeout(() => { el.style.opacity = '0'; }, dur);
  }

  setLoading (pct, text) {
    const b = document.getElementById('load-bar');  if (b) b.style.width = pct + '%';
    const t = document.getElementById('load-text'); if (t) t.textContent = text;
  }

  showScreen (id, show) {
    const el = document.getElementById(id);
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  populateCharSelect (chars) {
    const grid = document.getElementById('char-select-grid'); if (!grid) return;
    grid.innerHTML = '';
    const emo = { walter_white:'🧪', t800:'🤖', mando:'⚔️' };
    for (const cd of chars) {
      if (cd.isEnemy || cd.isAlly) continue;
      const card = document.createElement('div');
      card.className = 'char-card'; card.dataset.id = cd.id;
      card.innerHTML = `
        <div class="char-preview" style="background:linear-gradient(135deg,${cd.color||'#555'} 0%,#0a1220 100%)">${emo[cd.id]||'🎮'}</div>
        <div class="char-info">
          <h3>${cd.name}</h3>
          <div class="char-stats"><div><span>HP</span>${cd.stats?.maxHealth}</div><div><span>SPD</span>${cd.stats?.speed}</div></div>
          <div class="char-weapon">🔫 ${cd.defaultWeapon?.name||'—'}</div>
          <div class="char-skill">
            <span class="key">E</span>${cd.skills?.primary?.name||'—'}<br>
            <span class="key">Q</span>${cd.skills?.ultimate?.name||'—'}
          </div>
        </div>`;
      grid.appendChild(card);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DEV PANEL
// ═══════════════════════════════════════════════════════════════════════════════
class DevPanel {
  constructor (game) {
    this.game    = game;
    this.visible = false;
    this._panel  = document.getElementById('dev-panel');
    this._btn    = document.getElementById('dev-toggle');
    this._aimBone = 'mixamorigRightHand';

    this._initTabs();
    this._initDrag();
    this._initShootOriginEditor(); // Create the new sliders
    this._wireAll();

    // Backtick hotkey
    window.addEventListener('keydown', e => {
      if (e.code === 'Backquote') this.toggle();
    });
    this._btn.addEventListener('click', () => this.toggle());
  }

  toggle () {
    this.visible = !this.visible;
    this._panel.classList.toggle('visible', this.visible);
    this._btn.classList.toggle('active', this.visible);
    if (this.visible) {
      this.refreshAnimTab();
      this.refreshAimRigEditor();
      this.refreshBulletOriginEditor();
      this.refreshFlightEditor();
    }
  }

  _initTabs () {
    document.querySelectorAll('.dev-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.dev-tab').forEach(t  => t.classList.remove('active'));
        document.querySelectorAll('.dev-pane').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`)?.classList.add('active');
        if (tab.dataset.tab === 'character') {
          this.refreshBulletOriginEditor();
          this.refreshFlightEditor();
        }
        if (tab.dataset.tab === 'animations') {
          this.refreshAnimTab();
          this.refreshAimRigEditor();
        }
      });
    });
  }

  _initDrag () {
    const handle = document.getElementById('dev-drag-handle');
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      ox = e.clientX - this._panel.getBoundingClientRect().left;
      oy = e.clientY - this._panel.getBoundingClientRect().top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      this._panel.style.right = 'auto';
      this._panel.style.left  = (e.clientX - ox) + 'px';
      this._panel.style.top   = (e.clientY - oy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  _initShootOriginEditor() {
      const parent = document.getElementById('tab-character');
      if (!parent) return;

      const createSlider = (id, label, min, max, step, value) => {
          const row = document.createElement('div');
          row.className = 'dev-row';
          row.innerHTML = `
              <label>${label}</label>
              <input class="dev-slider" type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"/>
              <span class="val" id="${id}-v">${parseFloat(value).toFixed(2)}</span>
          `;
          parent.appendChild(row);
      };

      const bulletSection = document.createElement('div');
      bulletSection.className = 'dev-section';
      bulletSection.textContent = 'Bullet Origin';
      parent.appendChild(bulletSection);

      createSlider('d-shoot-x', 'Offset X', -2, 2, 0.01, 0);
      createSlider('d-shoot-y', 'Offset Y', 0, 3, 0.01, 1.4);
      createSlider('d-shoot-z', 'Offset Z', -2, 2, 0.01, 0.2);

      const exportSection = document.createElement('div');
      exportSection.className = 'dev-section';
      exportSection.innerHTML = `<textarea id="d-bullet-export" class="dev-export" rows="4" readonly></textarea><button id="d-bullet-copy" class="dev-btn2">Copy JSON</button>`;
      parent.appendChild(exportSection);

      const flightSection = document.createElement('div');
      flightSection.className = 'dev-section';
      flightSection.textContent = 'Flight';
      parent.appendChild(flightSection);

      const flightToggleRow = document.createElement('div');
      flightToggleRow.className = 'dev-row';
      flightToggleRow.innerHTML = `
          <label>Can Fly</label>
          <input class="dev-toggle" type="checkbox" id="d-flight-canfly"/>
      `;
      parent.appendChild(flightToggleRow);

      createSlider('d-flight-speed', 'Fly Speed', 0, 30, 0.5, 10);
      createSlider('d-flight-ascend', 'Ascend Speed', 0, 20, 0.5, 6);
      createSlider('d-flight-descend', 'Descend Speed', 0, 20, 0.5, 4);
      createSlider('d-flight-friction', 'Fly Friction', 0.8, 0.99, 0.01, 0.92);
  }

  _wireAll () {
    // CHARACTER
    this._slider('d-scale',   v => { this.game.player?.scale.setScalar(+v); });
    this._slider('d-speed',   v => { const p = this.game.player; if (p) { p.speed = +v; p.baseSpeed = +v; } });
    this._slider('d-sprint',  v => { DEV.sprintMult = +v; }, '×');
    this._slider('d-jump',    v => { const p = this.game.player; if (p) p.jumpForce = +v; });
    this._slider('d-maxhp',   v => { const p = this.game.player; if (p) { p.maxHealth = +v; p.health = Math.min(p.health, +v); } });
    this._btn2('d-fullheal',  () => { const p = this.game.player; if (p) p.health = p.maxHealth; });

    // Bullet Origin
    const onBulletOriginChange = (v, axis) => {
        if (this.game.player) {
            this.game.player.bulletOriginOffset[axis] = +v;
            this.updateBulletOriginExport();
        }
    };
    this._slider('d-shoot-x', v => onBulletOriginChange(v, 'x'));
    this._slider('d-shoot-y', v => onBulletOriginChange(v, 'y'));
    this._slider('d-shoot-z', v => onBulletOriginChange(v, 'z'));
    this._btn2('d-bullet-copy', async () => {
      const p = this.game.player; if (!p) return;
      const text = `"bulletOriginOffset": ${this.getBulletOriginExportText(p)}`;
      document.getElementById('d-bullet-export').value = text;
      await navigator.clipboard.writeText(text);
      this.game.ui.showMessage('Bullet Origin JSON copied', 1800);
    });

    // Flight
    this._toggle('d-flight-canfly', v => {
      const p = this.game.player; if (!p) return;
      p.flightParams.canFly = v;
    });
    this._slider('d-flight-speed', v => { const p = this.game.player; if (p) p.flightParams.flySpeed = +v; });
    this._slider('d-flight-ascend', v => { const p = this.game.player; if (p) p.flightParams.ascendSpeed = +v; });
    this._slider('d-flight-descend', v => { const p = this.game.player; if (p) p.flightParams.descendSpeed = +v; });
    this._slider('d-flight-friction', v => { const p = this.game.player; if (p) p.flightParams.flyFriction = +v; });

    // CAMERA (DEV)
    this._slider('d-camx', v => {
      const p = this.game.player; if (p) p._sizeConfig.camOffset.x = +v;
    });
    this._slider('d-camy', v => {
      const p = this.game.player; if (p) p._sizeConfig.camOffset.y = +v;
    });
    this._slider('d-camz', v => {
      const p = this.game.player; if (p) p._sizeConfig.camOffset.z = +v;
    });
    this._slider('d-campivot', v => {
      const p = this.game.player; if (p) p._sizeConfig.cameraPivotY = +v;
    });

    // PHYSICS
    this._slider('d-gravity',  v => { DEV.gravity  = +v; });
    this._slider('d-friction', v => { DEV.friction  = +v; });
    this._toggle('d-noclip',   v => {
      DEV.noclip = v;
      document.getElementById('noclip-badge').style.display = v ? 'block' : 'none';
    });
    this._toggle('d-godmode',  v => {
      DEV.godMode = v;
      document.getElementById('godmode-badge').style.display = v ? 'block' : 'none';
    });
    this._btn2('d-tp-origin', () => { const p = this.game.player; if (p) { p.body.position.set(0,0,0); p.body.velocity.set(0,0,0); } });
    this._btn2('d-tp-sky',    () => { const p = this.game.player; if (p) { p.body.position.set(0,30,0); p.body.velocity.set(0,0,0); } });

    // COMBAT
    this._slider('d-dmg',      v => { DEV.damageMult = +v; }, '×');
    this._slider('d-firerate', v => { DEV.fireRate    = +v; });
    this._slider('d-projspd',  v => { DEV.projSpeed   = +v; });
    this._slider('d-projsize', v => { DEV.projSize    = +v; });
    this._slider('d-range',    v => { DEV.range       = +v; });
    this._toggle('d-pierce',   v => { DEV.piercing    = v; });
    this._slider('d-pcd',      v => { DEV.primaryCdMax  = +v; }, 's');
    this._slider('d-ucd',      v => { DEV.ultimateCdMax = +v; }, 's');
    this._btn2('d-reset-cds',    () => { const p = this.game.player; if (p) { p.cdPrimary = 0; p.cdUltimate = 0; } });
    this._btn2('d-reset-combat', () => {
      DEV.damageMult = null; DEV.fireRate = null; DEV.projSpeed = null;
      DEV.projSize   = null; DEV.range    = null; DEV.piercing  = false;
      document.getElementById('d-pierce').checked = false;
      document.getElementById('d-dmg').value = '1';
      document.getElementById('d-dmg-v').textContent = '1.0×';
    });

    // ANIMATIONS
    this._slider('d-blend', v => {
      DEV.blendTime = +v;
      const p = this.game.player; if (p) p._blendTime = +v; // sync
    }, 's');
    this._slider('d-timescale', v => {
      DEV.timeScale = +v;
      // also apply immediately to mixer
      const p = this.game.player;
      if (p?.mixer) p.mixer.timeScale = +v;
    }, '×');
    this._btn2('d-anim-refresh', () => this.refreshAnimTab());
    this._btn2('d-anim-stop',    () => { this.game.player?.mixer?.stopAllAction(); });
    this._initAimRigEditor();
  }

  refreshBulletOriginEditor() {
    const p = this.game.player;
    const parent = document.getElementById('tab-character');
    if (!p) {
        if (parent) parent.style.opacity = '0.45';
        return;
    }
    if (parent) parent.style.opacity = '1';

    const setSlider = (id, value) => {
        const slider = document.getElementById(id);
        const label = document.getElementById(`${id}-v`);
        if (slider) slider.value = value;
        if (label) label.textContent = parseFloat(value).toFixed(2);
    };

    setSlider('d-shoot-x', p.bulletOriginOffset.x);
    setSlider('d-shoot-y', p.bulletOriginOffset.y);
    setSlider('d-shoot-z', p.bulletOriginOffset.z);
    this.updateBulletOriginExport();
  }

  getBulletOriginExportText(player) {
      if (!player) return '{}';
      return JSON.stringify(player.bulletOriginOffset, (k,v) => v.toFixed ? Number(v.toFixed(3)) : v, 2);
  }

  refreshFlightEditor() {
    const p = this.game.player;
    if (!p) return;

    const canFlyToggle = document.getElementById('d-flight-canfly');
    if (canFlyToggle) canFlyToggle.checked = p.flightParams.canFly;

    const setSlider = (id, value) => {
        const slider = document.getElementById(id);
        const label = document.getElementById(`${id}-v`);
        if (slider) slider.value = value;
        if (label) label.textContent = parseFloat(value).toFixed(2);
    };

    if (p.flightParams.canFly) {
      setSlider('d-flight-speed', p.flightParams.flySpeed || 10);
      setSlider('d-flight-ascend', p.flightParams.ascendSpeed || 6);
      setSlider('d-flight-descend', p.flightParams.descendSpeed || 4);
      setSlider('d-flight-friction', p.flightParams.flyFriction || 0.92);
    }
  }

  updateBulletOriginExport() {
      const out = document.getElementById('d-bullet-export');
      if (out) out.value = `"bulletOriginOffset": ${this.getBulletOriginExportText(this.game.player)}`;
  }

  _initAimRigEditor () {
    const bind = (id, fn, evt = 'input') => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener(evt, () => fn(el));
    };

    bind('d-aim-enabled', el => {
      const p = this.game.player; if (!p) return;
      const cfg = p.getAimRigConfig();
      cfg.enabled = el.checked;
      p.setAimRigConfig(cfg);
      this.refreshAimRigEditor();
    }, 'change');

    bind('d-aim-targetdist', el => {
      const p = this.game.player; if (!p) return;
      const cfg = p.getAimRigConfig();
      cfg.targetDistance = +el.value;
      p.setAimRigConfig(cfg);
      this._syncAimRigValues();
      this._updateAimRigExport();
    });

    bind('d-aim-firedur', el => {
      const p = this.game.player; if (!p) return;
      const cfg = p.getAimRigConfig();
      cfg.firePoseDuration = +el.value;
      p.setAimRigConfig(cfg);
      this._syncAimRigValues();
      this._updateAimRigExport();
    });

    bind('d-aim-bone', el => {
      this._aimBone = el.value;
      this.refreshAimRigEditor();
    }, 'change');

    bind('d-aim-override', el => {
      const p = this.game.player; if (!p) return;
      const cfg = p.getAimRigConfig();
      cfg.bones[this._aimBone].overrideAnimation = el.checked;
      p.setAimRigConfig(cfg);
      this.refreshAimRigEditor();
    }, 'change');

    for (const id of ['d-aim-weight', 'd-fire-weight']) {
      bind(id, el => {
        const p = this.game.player; if (!p) return;
        const cfg = p.getAimRigConfig();
        const bone = cfg.bones[this._aimBone];
        if (!bone) return;
        bone[id === 'd-aim-weight' ? 'aimWeight' : 'fireWeight'] = +el.value;
        p.setAimRigConfig(cfg);
        this._syncAimRigValues();
        this._updateAimRigExport();
      });
    }

    for (const id of ['d-aim-rx', 'd-aim-ry', 'd-aim-rz', 'd-fire-rx', 'd-fire-ry', 'd-fire-rz']) {
      bind(id, el => {
        const p = this.game.player; if (!p) return;
        const cfg = p.getAimRigConfig();
        const bone = cfg.bones[this._aimBone];
        if (!bone) return;
        const target = id.startsWith('d-fire-') ? bone.firePose : bone.aimPose;
        const axis = id.endsWith('x') ? 0 : id.endsWith('y') ? 1 : 2;
        target[axis] = +el.value;
        p.setAimRigConfig(cfg);
        this._syncAimRigValues();
        this._updateAimRigExport();
      });
    }

    this._btn2('d-aim-copy', async () => {
      const p = this.game.player; if (!p) return;
      const block = this._getAimRigExportText(p);
      const out = document.getElementById('d-aim-export');
      if (out) out.value = block;
      try {
        await navigator.clipboard.writeText(block);
        this.game.ui.showMessage('AIM RIG JSON copied to clipboard', 1800);
      } catch {
        this.game.ui.showMessage('Clipboard blocked, JSON left in export box', 2200);
      }
    });

    this._btn2('d-aim-reset-bone', () => {
      const p = this.game.player; if (!p) return;
      const cfg = p.getAimRigConfig();
      const defaults = p._buildAimProfile().bones[this._aimBone];
      if (!defaults) return;
      cfg.bones[this._aimBone] = JSON.parse(JSON.stringify(defaults));
      p.setAimRigConfig(cfg);
      this.refreshAimRigEditor();
    });
  }

  _syncAimRigValues () {
    const p = this.game.player;
    const cfg = p?.getAimRigConfig();
    if (!cfg) return;
    const bone = cfg.bones[this._aimBone];
    if (!bone) return;

    const setVal = (id, value, suffix = '') => {
      const el = document.getElementById(id);
      const out = document.getElementById(id + '-v');
      if (el) el.value = String(value);
      if (out) {
        const n = parseFloat(value);
        out.textContent = (Number.isInteger(n) ? String(n) : n.toFixed(2)) + suffix;
      }
    };

    const enabled = document.getElementById('d-aim-enabled');
    const override = document.getElementById('d-aim-override');
    const boneSel = document.getElementById('d-aim-bone');
    if (enabled) enabled.checked = !!cfg.enabled;
    if (override) override.checked = !!bone.overrideAnimation;
    if (boneSel) boneSel.value = this._aimBone;

    setVal('d-aim-targetdist', cfg.targetDistance);
    setVal('d-aim-firedur', cfg.firePoseDuration, 's');
    setVal('d-aim-weight', bone.aimWeight);
    setVal('d-fire-weight', bone.fireWeight);
    setVal('d-aim-rx', bone.aimPose[0], ' deg');
    setVal('d-aim-ry', bone.aimPose[1], ' deg');
    setVal('d-aim-rz', bone.aimPose[2], ' deg');
    setVal('d-fire-rx', bone.firePose[0], ' deg');
    setVal('d-fire-ry', bone.firePose[1], ' deg');
    setVal('d-fire-rz', bone.firePose[2], ' deg');
  }

  _getAimRigExportText (player) {
    return JSON.stringify({ aimRig: player.getAimRigConfig() }, null, 2);
  }

  _updateAimRigExport () {
    const out = document.getElementById('d-aim-export');
    const p = this.game.player;
    if (!out || !p) return;
    out.value = this._getAimRigExportText(p);
  }

  refreshAimRigEditor () {
    const p = this.game.player;
    const status = document.getElementById('d-aim-status');
    const wrap = document.getElementById('d-aim-editor');
    if (!p) {
      if (status) status.textContent = 'No player loaded.';
      if (wrap) wrap.style.opacity = '0.45';
      return;
    }

    if (!p.getAimRigConfig().bones[this._aimBone]) {
      this._aimBone = Object.keys(p.getAimRigConfig().bones)[0];
    }

    if (status) status.textContent = `${p.charData.name} - ${this._aimBone.replace('mixamorig', '')}`;
    if (wrap) wrap.style.opacity = '1';
    this._syncAimRigValues();
    this._updateAimRigExport();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  _slider (id, onChange, suffix = '') {
    const el  = document.getElementById(id);       if (!el) return;
    const val = document.getElementById(id + '-v');
    const fmt = v => {
      const n = parseFloat(v);
      return (Number.isInteger(n) ? String(n) : n.toFixed(2)) + suffix;
    };
    el.addEventListener('input', () => { if (val) val.textContent = fmt(el.value); onChange(el.value); });
    if (val) val.textContent = fmt(el.value);
  }

  _toggle (id, onChange) {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('change', () => onChange(el.checked));
  }

  _btn2 (id, onClick) {
    const el = document.getElementById(id); if (!el) return;
    el.addEventListener('click', onClick);
  }

  // ── Live readout (called every frame) ─────────────────────────────────────
  updateReadout (fps) {
    if (!this.visible) return;

    const fEl = document.getElementById('dr-fps');
    const pEl = document.getElementById('dr-pos');
    const cEl = document.getElementById('dr-clip');
    const p   = this.game.player;

    if (fEl) fEl.textContent = fps.toFixed(0);
    if (pEl && p) {
      const pos = p.body.position;
      pEl.textContent = `${pos.x.toFixed(1)},${pos.y.toFixed(1)},${pos.z.toFixed(1)}`;
    }
    if (cEl && p) cEl.textContent = p._curClip ?? '—';

    // Animation state strip in Anims tab
    if (p?.mixer) {
      const cur  = p._clips[p._curClip];
      const asC  = document.getElementById('as-current'); if (asC) asC.textContent = p._curClip ?? '—';
      const asT  = document.getElementById('as-time');
      const asW  = document.getElementById('as-weight');
      if (cur) {
        if (asT) asT.textContent = cur.time?.toFixed(2) ?? '—';
        if (asW) asW.textContent = cur.getEffectiveWeight()?.toFixed(2) ?? '—';
      }
    }
  }

  // ── Animation clips list ───────────────────────────────────────────────────
  refreshAnimTab () {
    const list = document.getElementById('anim-clips-list'); if (!list) return;
    list.innerHTML = '';
    const player = this.game.player;
    if (!player) { list.innerHTML = '<div class="anim-no-clips">No player in scene.</div>'; return; }

    const keys = Object.keys(player._clips);
    if (!keys.length) {
      list.innerHTML = '<div class="anim-no-clips">No clips loaded yet.<br>Model loads async — click ↺ Refresh after deploying.</div>';
      return;
    }

    for (const key of keys) {
      const isPlaying = player._curClip === key;
      const row = document.createElement('div');
      row.className = 'anim-clip' + (isPlaying ? ' playing' : '');

      const srcFile = player.charData.animationUrls?.[key]?.split('/').pop() ?? 'embedded';

      row.innerHTML = `
        <div>
          <div class="anim-clip-name">${key}</div>
          <div class="anim-clip-src">${srcFile}</div>
        </div>
        <button class="anim-play-btn${isPlaying ? ' active' : ''}" data-key="${key}">
          ${isPlaying ? '▶ PLAYING' : '▶ PLAY'}
        </button>`;

      row.querySelector('.anim-play-btn').addEventListener('click', () => {
        player.devPlayClip(key);
        this.refreshAnimTab(); // re-render to update active highlight
      });

      list.appendChild(row);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME MANAGER
// ═══════════════════════════════════════════════════════════════════════════════
class GameManager {
  constructor () {
    this.scene = null; this.camera = null; this.renderer = null;
    this.clock  = new THREE.Clock();

    this.player = null;
    this.pm     = null;
    this.level  = null;

    this.ui    = new UIManager();
    this.input = new InputManager();

    this.gltfLoader = new GLTFLoader();
    this.fbxLoader  = new FBXLoader();

    this.charDB   = [];
    this._state   = 'select';
    this.devPanel = null;

    this._fps      = 0;
    this._fpsFrames = 0;
    this._fpsTimer  = 0;

    window.gameManager = this;
  }

  async init () {
    this.ui.setLoading(10, 'SETTING UP RENDERER...');
    this._initRenderer();
    this._initScene();
    this._initLighting();

    this.ui.setLoading(35, 'BUILDING LEVEL...');
    this.level = new LevelBuilder(this.scene);
    this.level.build();
    this.pm = new ProjectileManager(this.scene);

    this.ui.setLoading(60, 'LOADING CHARACTER DATABASE...');
    await this._loadCharDB();

    this.ui.setLoading(85, 'PREPARING UI...');
    this.ui.populateCharSelect(this.charDB);
    this._wireUI();
    this.devPanel = new DevPanel(this);

    this.ui.setLoading(100, 'READY');
    await _sleep(400);
    this.ui.showScreen('loading-screen', false);
    this.ui.showScreen('char-select',    true);

    this._loop();
  }

  _initRenderer () {
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('game-canvas'), antialias: true
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled   = true;
    this.renderer.shadowMap.type      = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.outputColorSpace    = THREE.SRGBColorSpace;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  _initScene () {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0f1a');
    this.scene.fog         = new THREE.FogExp2('#0a0f1a', 0.018);
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 400);
    this.camera.position.set(0, 10, 15);
  }

  _initLighting () {
    this.scene.add(new THREE.AmbientLight('#20304a', 0.6));
    this.scene.add(new THREE.HemisphereLight('#7ec8e3', '#2a4a1a', 0.5));
    const sun = new THREE.DirectionalLight('#fff8e0', 1.4);
    sun.position.set(25, 40, 20); sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { near: 0.5, far: 120, left: -40, right: 40, top: 40, bottom: -40 });
    sun.shadow.bias = -0.001;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#a0b8ff', 0.35);
    fill.position.set(-15, 8, -10);
    this.scene.add(fill);
  }

  async _loadCharDB () {
    try {
      const res = await fetch('./characters.json');
      this.charDB = await res.json();
      console.log(`[GameManager] ${this.charDB.length} characters loaded`);

    } catch (e) {
      console.warn('[GameManager] characters.json not found — using defaults');
      this.charDB = _defaultCharDB();
    }
  }

  _wireUI () {
    let selected = this.charDB.find(c => !c.isEnemy && !c.isAlly) || null;
    if (selected) setTimeout(() => {
      document.querySelector(`[data-id="${selected.id}"]`)?.classList.add('selected');
    }, 100);

    document.getElementById('char-select-grid')?.addEventListener('click', e => {
      const card = e.target.closest('.char-card'); if (!card) return;
      document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      selected = this.charDB.find(c => c.id === card.dataset.id) || selected;
    });

    document.getElementById('start-btn')?.addEventListener('click', () => {
      if (!selected) return;
      this.ui.showScreen('char-select', false);
      this._startGame(selected);
    });

    document.getElementById('game-canvas')?.addEventListener('click', () => {
      if (this._state === 'playing') document.getElementById('game-canvas').requestPointerLock();
    });
  }

  async _startGame (charData) {
    this._state = 'playing';

    this.player = new PlayerController(charData, this.scene, this.camera);
    this.player.body.position.set(0, 0, 0);
    this.scene.add(this.player);

    // SpringCamera setup
    this.springCamera = new SpringCamera(this.camera, { smoothing: 0 }); // snappy Battlefront 2 style

    // Async model load — placeholder capsule visible immediately while it loads
    this.player.loadModel(this.gltfLoader, this.fbxLoader);
    this.devPanel?.refreshAimRigEditor();
    this.devPanel?.refreshBulletOriginEditor();
    this.devPanel?.refreshFlightEditor();

    this.ui.setCharInfo(charData);
    this.ui.showMessage(`[${charData.name.toUpperCase()}] — press \` to open Dev Panel`, 4000);

    setTimeout(() => document.getElementById('game-canvas')?.requestPointerLock(), 600);
  }

  _loop () {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);

    // FPS counter
    this._fpsFrames++;
    this._fpsTimer += dt;
    if (this._fpsTimer >= 0.5) {
      this._fps = this._fpsFrames / this._fpsTimer;
      this._fpsFrames = 0; this._fpsTimer = 0;
    }

    if (this._state === 'playing') this._update(dt);
    this.renderer.render(this.scene, this.camera);
    this.devPanel?.updateReadout(this._fps);
  }

  _update (dt) {
    const cols = this.level.colliders;

    if (this.player) {
      if (!this.player.isDead) {
        this.player.handleInput(this.input, dt, this.pm);
        this.player.update(dt, this.pm, cols, this.springCamera);
      } else {
        this.player._baseUpdate(dt);
      }
    }

    this.pm.update(dt);
    this.ui.update(this.player);
  }
}

// ─── DEFAULT CHARACTER DB ─────────────────────────────────────────────────────
function _defaultCharDB () {
  const ANIMS = {
    idle:   '/assets/idle.fbx',
    walk:   '/assets/walk.fbx',
    run:    '/assets/run.fbx',
    attack: '/assets/attack.fbx',
    death:  '/assets/death.fbx',
  };
  return [
    { id:'walter_white', name:'Walter White', modelUrl:'/assets/walter_white.glb', scale:1, color:'#e0e0e0', stats:{speed:5,maxHealth:100,mass:70,jumpForce:8}, animationUrls:ANIMS, defaultWeapon:{type:'ranged',name:'Walther PPK',damage:28,fireRate:.45,range:55,projectileSpeed:32,projectileColor:'#ffee00',projectileSize:.11}, skills:{primary:{name:'Blue Sky Boost',key:'e',cooldown:8},ultimate:{name:'Summon Jesse',key:'q',cooldown:45}} },
    { id:'t800', name:'T-800 Terminator', modelUrl:'/assets/t800.glb', scale:1.1, color:'#282828', stats:{speed:3.5,maxHealth:350,mass:180,jumpForce:7}, animationUrls:ANIMS, defaultWeapon:{type:'ranged',name:'M134 Minigun',damage:14,fireRate:.08,range:85,projectileSpeed:55,projectileColor:'#ff3300',projectileSize:.07}, skills:{primary:{name:'Plasma Shot',key:'e',cooldown:5},ultimate:{name:'Nuclear Option',key:'q',cooldown:60}} },
    { id:'mando', name:'The Mandalorian', modelUrl:'/assets/mando.glb', scale:1, color:'#788da0', stats:{speed:6,maxHealth:175,mass:85,jumpForce:11}, animationUrls:ANIMS, defaultWeapon:{type:'ranged',name:'IB-94 Blaster',damage:22,fireRate:.28,range:65,projectileSpeed:42,projectileColor:'#00eeff',projectileSize:.09}, skills:{primary:{name:'Jetpack Dash',key:'e',cooldown:6},ultimate:{name:'Whistling Birds',key:'q',cooldown:30}} },
  ];
}

const _sleep = ms => new Promise(r => setTimeout(r, ms));
new GameManager().init().catch(console.error);

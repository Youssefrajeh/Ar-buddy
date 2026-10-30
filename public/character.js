import * as THREE from 'three';

// Target height of the robot in the real world (metres)
const HEIGHT = 0.55;
const WALK_SPEED = 0.35; // m/s

// Looping states vs one-shot emotes (names come from RobotExpressive.glb)
const LOOPS = { idle: 'Idle', walk: 'Walking', dance: 'Dance', sit: 'Sitting' };
const EMOTES = {
  wave: 'Wave',
  yes: 'Yes',
  no: 'No',
  thumbsup: 'ThumbsUp',
  jump: 'Jump',
  punch: 'Punch',
  fall: 'Death',
};

// Face morph targets on the robot's head mesh
const EXPRESSIONS = {
  happy: {},
  neutral: {},
  sad: { Sad: 1 },
  angry: { Angry: 1 },
  surprised: { Surprised: 1 },
};

export class Character {
  constructor(gltf) {
    this.model = gltf.scene;
    this.root = new THREE.Group();
    this.root.add(this.model);

    // Scale the model so it is HEIGHT metres tall and stands on y = 0
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const s = HEIGHT / size.y;
    this.model.scale.setScalar(s);
    this.model.position.y = -box.min.y * s;

    upgradeLook(this.model);

    this.root.add(makeBlobShadow());
    this.root.add(makeShadowCatcher());

    // Invisible box used for "did the user tap the robot?" (easier to hit than thin limbs)
    this.hitBox = new THREE.Mesh(
      new THREE.BoxGeometry(HEIGHT * 0.8, HEIGHT, HEIGHT * 0.6).translate(0, HEIGHT / 2, 0),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.root.add(this.hitBox);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const clip of gltf.animations) {
      const action = this.mixer.clipAction(clip);
      const isEmote = Object.values(EMOTES).includes(clip.name) || clip.name === 'Standing';
      if (isEmote) {
        action.clampWhenFinished = true;
        action.loop = THREE.LoopOnce;
      }
      this.actions[clip.name] = action;
    }
    this.mixer.addEventListener('finished', (e) => this.onEmoteFinished(e.action));

    this.model.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary) this.face = o;
      if (o.isBone && o.name === 'Head') this.headBone = o;
    });

    this.placed = false;
    this.talking = false;
    this.state = 'Idle';
    this.current = null;
    this.walkTarget = null;
    this.afterWalk = null;
    this.morphGoal = {};
    this.time = 0;
    this.play('Idle', 0);
  }

  // ------------------------------------------------------------- placement
  placeAt(position, lookAtPoint) {
    this.root.position.copy(position);
    this.root.visible = true;
    this.placed = true;
    this.root.scale.setScalar(0.01);
    this.popIn = 0;
    if (lookAtPoint) this.root.rotation.y = this.yawTo(lookAtPoint);
  }

  reset() {
    this.placed = false;
    this.root.visible = false;
    this.walkTarget = null;
    this.talking = false;
    this.setExpression('neutral');
    this.setState('Idle');
  }

  // ------------------------------------------------------------- animation
  play(name, fade = 0.3) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = next;
  }

  setState(name) {
    this.state = name;
    this.play(name);
  }

  // action = one of: wave yes no thumbsup jump punch fall dance sit idle
  perform(action) {
    if (!action || action === 'none') return;
    if (LOOPS[action]) {
      this.walkTarget = null;
      return this.setState(LOOPS[action]);
    }
    const clip = EMOTES[action];
    if (!clip) return;
    if (this.state === 'Sitting' || this.state === 'Dance') this.state = 'Idle';
    this.walkTarget = null;
    this.play(clip, 0.2);
  }

  onEmoteFinished(action) {
    if (action !== this.current) return; // an older emote that was already replaced
    const name = action.getClip().name;
    if (name === 'Death') {
      // Lie there for a moment, then get back up
      setTimeout(() => this.current === action && this.play('Standing', 0.3), 1500);
      return;
    }
    this.play(this.walkTarget ? 'Walking' : this.state, 0.3);
  }

  setExpression(name) {
    this.morphGoal = EXPRESSIONS[name] || {};
    clearTimeout(this.exprTimer);
    if (name && name !== 'neutral' && name !== 'happy') {
      this.exprTimer = setTimeout(() => (this.morphGoal = {}), 5000);
    }
  }

  // ------------------------------------------------------------- movement
  // Walk toward a point on the floor and stop `stopDistance` metres from it
  walkToward(point, stopDistance = 0) {
    const target = new THREE.Vector3(point.x, this.root.position.y, point.z);
    const dist = target.distanceTo(this.root.position);
    if (dist <= stopDistance + 0.05) return this.perform('wave');
    const dir = target.clone().sub(this.root.position).normalize();
    this.walkTarget = target.sub(dir.multiplyScalar(stopDistance));
    this.state = 'Idle';
    this.play('Walking');
  }

  yawTo(point) {
    return Math.atan2(point.x - this.root.position.x, point.z - this.root.position.z);
  }

  // ------------------------------------------------------------- per frame
  update(dt, viewerPos) {
    this.time += dt;
    this.mixer.update(dt);

    // Pop-in when first placed
    if (this.popIn !== undefined && this.popIn < 1) {
      this.popIn = Math.min(1, this.popIn + dt * 3);
      const t = this.popIn;
      this.root.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.15 * (1 - t) - (1 - t) * (1 - t));
    }

    let facePoint = viewerPos;

    if (this.walkTarget) {
      const toTarget = this.walkTarget.clone().sub(this.root.position);
      const dist = toTarget.length();
      if (dist < 0.02) {
        this.walkTarget = null;
        this.play(this.state);
      } else {
        const step = Math.min(dist, WALK_SPEED * dt);
        this.root.position.add(toTarget.normalize().multiplyScalar(step));
        facePoint = this.walkTarget;
      }
    }

    // Turn smoothly to face the viewer (or where it's walking)
    if (facePoint) {
      const goal = this.yawTo(facePoint);
      let diff = goal - this.root.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.root.rotation.y += diff * Math.min(1, dt * (this.walkTarget ? 8 : 3));
    }

    // Head bob while talking (added on top of the current animation)
    if (this.headBone && this.talking) {
      this.headBone.rotation.x += Math.sin(this.time * 14) * 0.09;
      this.headBone.rotation.z += Math.sin(this.time * 5) * 0.05;
    }

    // Blend facial expression
    if (this.face) {
      const dict = this.face.morphTargetDictionary;
      const infl = this.face.morphTargetInfluences;
      for (const [key, idx] of Object.entries(dict)) {
        const goal = this.morphGoal[key] || 0;
        infl[idx] += (goal - infl[idx]) * Math.min(1, dt * 6);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Make the low-poly robot look like a polished, glossy toy:
// smoother surfaces, painted clear-coat body, brushed metal joints, glassy eyes
// ---------------------------------------------------------------------------
const LOOKS = {
  Main: { color: 0xe07b10, roughness: 0.38, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.15 },
  Grey: { color: 0x8d939c, roughness: 0.32, metalness: 0.85, clearcoat: 0.2, clearcoatRoughness: 0.3 },
  Black: { color: 0x0b0d12, roughness: 0.08, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03 },
};

function upgradeLook(model) {
  const made = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;

    // Smooth the faceted look but keep sharp edges (crease angle 80 deg)
    if (!o.geometry.userData.smoothed) {
      const g = smoothNormals(o.geometry, THREE.MathUtils.degToRad(80));
      g.userData.smoothed = true;
      o.geometry = g;
    }

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const upgraded = mats.map((m) => {
      if (made.has(m)) return made.get(m);
      const look = LOOKS[m.name] || {};
      const pm = new THREE.MeshPhysicalMaterial({
        name: m.name,
        color: look.color ?? m.color,
        map: m.map || null,
        roughness: look.roughness ?? 0.5,
        metalness: look.metalness ?? 0,
        clearcoat: look.clearcoat ?? 0,
        clearcoatRoughness: look.clearcoatRoughness ?? 0.2,
      });
      made.set(m, pm);
      return pm;
    });
    o.material = Array.isArray(o.material) ? upgraded : upgraded[0];
  });
}

// Recompute normals so faces meeting at less than `creaseAngle` share a smooth normal.
// Vertices are matched by position (the model stores each face's corners separately).
function smoothNormals(geometry, creaseAngle) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const pos = g.attributes.position;
  const count = pos.count;
  const cosCrease = Math.cos(creaseAngle);

  // Face normals (area-weighted: cross product length = 2x area)
  const fn = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = new THREE.Vector3().subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b));
    fn.push(n, n, n);
  }

  // Group vertices that sit at the same position
  const groups = new Map();
  const key = (i) => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  for (let i = 0; i < count; i++) {
    const k = key(i);
    let list = groups.get(k);
    if (!list) groups.set(k, (list = []));
    list.push(i);
  }

  const normals = new Float32Array(count * 3);
  const sum = new THREE.Vector3(), mine = new THREE.Vector3(), other = new THREE.Vector3();
  for (const list of groups.values()) {
    for (const i of list) {
      mine.copy(fn[i]).normalize();
      sum.set(0, 0, 0);
      for (const j of list) {
        other.copy(fn[j]).normalize();
        if (mine.dot(other) >= cosCrease) sum.add(fn[j]);
      }
      sum.normalize();
      normals[i * 3] = sum.x;
      normals[i * 3 + 1] = sum.y;
      normals[i * 3 + 2] = sum.z;
    }
  }
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

// Invisible floor that only shows the robot's real shadow
function makeShadowCatcher() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.32, depthWrite: false })
  );
  mesh.position.y = 0.001;
  mesh.receiveShadow = true;
  mesh.raycast = () => {};
  return mesh;
}

// Soft round contact shadow right under the robot
function makeBlobShadow() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.45)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(HEIGHT * 0.7, HEIGHT * 0.7).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
  );
  mesh.position.y = 0.002;
  mesh.renderOrder = -1;
  mesh.raycast = () => {}; // don't count as "tapping the robot"
  return mesh;
}

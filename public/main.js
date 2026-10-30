import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { XREstimatedLight } from 'three/addons/webxr/XREstimatedLight.js';
import { Character } from './character.js';
import { askBrain } from './brain.js';
import { Voice } from './voice.js';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const ui = {
  startScreen: $('start-screen'),
  startAR: $('start-ar'),
  startPreview: $('start-preview'),
  supportNote: $('support-note'),
  hud: $('hud'),
  status: $('status'),
  exit: $('exit'),
  bubble: $('bubble'),
  mic: $('mic'),
  textForm: $('text-form'),
  textInput: $('text-input'),
  video: $('camera'),
  overlay: $('overlay'),
};

// Language for listening and speaking. Override with ?lang=ar-SA, ?lang=fr-FR, etc.
const LANG = new URLSearchParams(location.search).get('lang') || navigator.language || 'en-US';

// ---------------------------------------------------------------------------
// Three.js basics
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.01, 30);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
document.body.prepend(renderer.domElement);

// Default lights (replaced by the real room's light when the phone can estimate it)
const defaultLights = new THREE.Group();
defaultLights.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.5, 2, 1);
defaultLights.add(sun);
scene.add(defaultLights);

// Ring that shows where the floor is
const reticle = new THREE.Mesh(
  new THREE.RingGeometry(0.08, 0.1, 40).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ color: 0x7fa4ff, transparent: true, opacity: 0.9 })
);
reticle.matrixAutoUpdate = false;
reticle.visible = false;
scene.add(reticle);

// ---------------------------------------------------------------------------
// The character
// ---------------------------------------------------------------------------
let buddy = null;
const loader = new GLTFLoader();
const robotReady = loader.loadAsync('./RobotExpressive.glb').then((gltf) => {
  buddy = new Character(gltf);
  buddy.root.visible = false;
  scene.add(buddy.root);
  return buddy;
});

// ---------------------------------------------------------------------------
// Voice (listen + speak) and conversation
// ---------------------------------------------------------------------------
const voice = new Voice(LANG);
const history = []; // [{ role: 'user' | 'assistant', content }]
let busy = false;

voice.onSpeakStart = () => buddy && (buddy.talking = true);
voice.onSpeakEnd = () => buddy && (buddy.talking = false);

let bubbleTimer;
function showBubble(text, fromYou = false) {
  ui.bubble.textContent = text;
  ui.bubble.classList.toggle('you', fromYou);
  ui.bubble.hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => (ui.bubble.hidden = true), fromYou ? 4000 : 9000);
}

function setStatus(text) {
  ui.status.textContent = text;
}

async function talkToBuddy(text) {
  text = text.trim();
  if (!text || busy) return;
  if (!buddy || !buddy.placed) {
    setStatus('Place your buddy first: tap the floor');
    return;
  }
  busy = true;
  ui.mic.classList.add('thinking');
  showBubble(text, true);
  history.push({ role: 'user', content: text });

  const reply = await askBrain(history, LANG);
  history.push({ role: 'assistant', content: reply.say });
  while (history.length > 16) history.shift();

  showBubble(reply.say);
  buddy.setExpression(reply.expression);
  doAction(reply.action);
  voice.speak(reply.say);

  ui.mic.classList.remove('thinking');
  busy = false;
}

function doAction(action) {
  if (!buddy) return;
  if (action === 'come') {
    const me = getViewerPosition();
    buddy.walkToward(me, renderer.xr.isPresenting ? 0.6 : 1.0);
  } else {
    buddy.perform(action);
  }
}

// Mic button: tap to talk, tap again to stop
ui.mic.addEventListener('click', () => {
  if (busy) return;
  if (!voice.canListen) {
    ui.textInput.focus();
    setStatus('Voice input not supported here: type instead');
    return;
  }
  if (voice.listening) {
    voice.stopListening();
    return;
  }
  voice.stopSpeaking();
  ui.mic.classList.add('listening');
  setStatus('Listening…');
  voice.listen({
    onResult: (text) => talkToBuddy(text),
    onEnd: () => {
      ui.mic.classList.remove('listening');
      setStatus(buddy?.placed ? 'Tap the mic and talk to your buddy' : 'Tap the floor to place your buddy');
    },
    onError: (err) => setStatus(err === 'not-allowed' ? 'Microphone permission denied' : 'Didn’t catch that, try again'),
  });
});

ui.textForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = ui.textInput.value;
  ui.textInput.value = '';
  ui.textInput.blur();
  talkToBuddy(text);
});

// Taps on the HUD must not count as "tap on the floor" inside the AR session
for (const el of [ui.mic, ui.textInput, ui.exit, ui.bubble]) {
  el.addEventListener('beforexrselect', (e) => e.preventDefault());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const tmpVec = new THREE.Vector3();
function getViewerPosition(target = new THREE.Vector3()) {
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  return cam.getWorldPosition(target);
}

const raycaster = new THREE.Raycaster();
function rayHitsBuddy(origin, direction) {
  if (!buddy?.root.visible) return false;
  raycaster.set(origin, direction);
  return raycaster.intersectObject(buddy.hitBox, false).length > 0;
}

function poke() {
  const lines = ['Hey! That tickles!', 'Boop! Hi there!', 'Hehe, I’m awake!', 'Oh! Hello!'];
  const say = lines[Math.floor(Math.random() * lines.length)];
  buddy.setExpression('surprised');
  buddy.perform('jump');
  showBubble(say);
  voice.speak(say);
}

// ---------------------------------------------------------------------------
// Mode 1: real AR (WebXR, Android Chrome)
// ---------------------------------------------------------------------------
let xrSession = null;
let hitTestSource = null;
let localSpace = null;
let xrLight = null;

async function startAR() {
  await robotReady;
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['dom-overlay', 'light-estimation'],
    domOverlay: { root: ui.overlay },
  });
  xrSession = session;

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);

  const viewerSpace = await session.requestReferenceSpace('viewer');
  hitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  localSpace = renderer.xr.getReferenceSpace();

  // Match the room's real lighting when the phone supports it
  xrLight = new XREstimatedLight(renderer);
  xrLight.addEventListener('estimationstart', () => {
    scene.add(xrLight);
    scene.remove(defaultLights);
    if (xrLight.environment) scene.environment = xrLight.environment;
  });
  xrLight.addEventListener('estimationend', () => {
    scene.remove(xrLight);
    scene.add(defaultLights);
    scene.environment = null;
  });

  // Tap on screen = "select" from a ray that starts at the phone
  const controller = renderer.xr.getController(0);
  scene.add(controller);
  controller.addEventListener('select', () => {
    const origin = new THREE.Vector3().setFromMatrixPosition(controller.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(controller.matrixWorld));

    if (rayHitsBuddy(origin, dir)) return poke();
    if (!reticle.visible) return;

    const spot = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    if (!buddy.placed) {
      buddy.placeAt(spot, getViewerPosition());
      const hello = 'Hi! I’m Robi. Tap the mic and talk to me!';
      buddy.perform('wave');
      showBubble(hello);
      voice.speak(hello);
      setStatus('Tap the mic and talk to your buddy');
    } else {
      buddy.walkToward(spot, 0); // tap somewhere else and it walks there
    }
  });

  session.addEventListener('end', onSessionEnd);
  enterHud('Point your phone at the floor, then tap it');
}

function onSessionEnd() {
  hitTestSource?.cancel?.();
  hitTestSource = null;
  xrSession = null;
  reticle.visible = false;
  if (xrLight) scene.remove(xrLight);
  scene.add(defaultLights);
  scene.environment = null;
  leaveHud();
}

// ---------------------------------------------------------------------------
// Mode 2: camera preview (iPhone / desktop / no WebXR): no floor tracking
// ---------------------------------------------------------------------------
let previewStream = null;

async function startPreview() {
  await robotReady;
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    ui.video.srcObject = previewStream;
  } catch (err) {
    console.warn('Camera unavailable, showing robot without camera feed', err);
  }
  document.body.classList.add('preview');

  camera.position.set(0, 0.75, 0);
  camera.lookAt(0, 0.3, -1.4);
  buddy.placeAt(new THREE.Vector3(0, 0, -1.4), camera.position);

  enterHud('Preview mode: no floor tracking on this device');
  const hello = 'Hi! I’m Robi. Tap the mic and talk to me!';
  buddy.perform('wave');
  showBubble(hello);
  voice.speak(hello);
}

function stopPreview() {
  previewStream?.getTracks().forEach((t) => t.stop());
  previewStream = null;
  ui.video.srcObject = null;
  document.body.classList.remove('preview');
  leaveHud();
}

// Tap the robot in preview mode
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (renderer.xr.isPresenting || !buddy?.placed) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (raycaster.intersectObject(buddy.hitBox, false).length) poke();
});

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------
function enterHud(status) {
  ui.startScreen.hidden = true;
  ui.hud.hidden = false;
  setStatus(status);
}

function leaveHud() {
  voice.stopSpeaking();
  voice.stopListening();
  buddy?.reset();
  history.length = 0;
  ui.hud.hidden = true;
  ui.bubble.hidden = true;
  ui.startScreen.hidden = false;
}

ui.exit.addEventListener('click', () => {
  if (xrSession) xrSession.end();
  else stopPreview();
});

ui.startAR.addEventListener('click', () =>
  startAR().catch((err) => {
    console.error(err);
    ui.supportNote.textContent = 'Could not start AR: ' + err.message;
  })
);
ui.startPreview.addEventListener('click', () => startPreview());

async function checkSupport() {
  let arOK = false;
  try {
    arOK = !!(navigator.xr && (await navigator.xr.isSessionSupported('immersive-ar')));
  } catch { /* not supported */ }

  ui.startPreview.hidden = false;
  if (arOK) {
    ui.startAR.hidden = false;
    ui.supportNote.textContent = 'Full AR is supported. Your buddy will stand on your real floor.';
  } else if (!window.isSecureContext) {
    ui.supportNote.textContent = 'Open this page over HTTPS to use the camera and AR.';
  } else {
    ui.supportNote.textContent =
      'Full AR needs Chrome on an ARCore Android phone. You can still try the camera preview.';
  }
  if (!voice.canListen) ui.supportNote.textContent += ' (Voice input isn’t available in this browser: you can type.)';
}
checkSupport();

// ---------------------------------------------------------------------------
// Resize + render loop
// ---------------------------------------------------------------------------
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const timer = new THREE.Timer();

renderer.setAnimationLoop((time, frame) => {
  timer.update(time);
  const dt = Math.min(timer.getDelta(), 0.1);

  if (frame && hitTestSource && localSpace) {
    const hits = frame.getHitTestResults(hitTestSource);
    if (hits.length) {
      const pose = hits[0].getPose(localSpace);
      reticle.visible = true;
      reticle.matrix.fromArray(pose.transform.matrix);
      if (buddy && !buddy.placed) setStatus('Tap to place your buddy here');
    } else {
      reticle.visible = false;
    }
  }

  if (buddy?.placed) buddy.update(dt, getViewerPosition(tmpVec));
  renderer.render(scene, camera);
});

// Handy for debugging from the browser console
window.__arBuddy = { scene, camera, talkToBuddy, get buddy() { return buddy; } };

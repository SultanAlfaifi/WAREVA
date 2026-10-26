// Renders the WAREVA unit: studio lighting from RoomEnvironment, bloom only on the glowing parts,
// eased camera moves (camera-controls) and HTML labels. Rendering pauses while the canvas is off screen.
import * as THREE from 'three';
import CameraControls from 'camera-controls';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, SMAAEffect, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import rules from '../../../core/rules.json';
import { PALETTE, buildUnit, drawScreen, flowPulses } from './unit.js';

CameraControls.install({ THREE });

// Camera stops: [position, target]. The story moves between them; the control room starts at `control`.
export const STOPS = {
  overview: [[-8.3, 2.7, 7.4], [-1.0, 0.6, 0]],
  overviewLtr: [[8.6, 2.7, 7.4], [1.0, 0.6, 0]],
  collect: [[6.6, 2.7, 5.4], [2.5, 0.9, 0]],
  treat: [[2.9, 2.7, 5.8], [0.55, 1.0, 0]],
  sense: [[-3.4, 1.7, 3.6], [-2.2, 0.5, 0.35]],
  gate: [[-4.4, 2.0, 3.9], [-2.75, 0.75, 0]],
  lawn: [[-6.6, 3.0, 5.4], [-3.6, 0.45, 0.2]],
  control: [[3.0, 4.1, 8.8], [-0.7, 0.6, 0]],
};

const COLORS = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, new THREE.Color(v)]));
const GRASS_WET = new THREE.Color('#3fa36b'), GRASS_DRY = new THREE.Color('#2a5c44');
const QUALITY = new Set(['TURBIDITY_HIGH', 'PH_OUT_OF_RANGE', 'CHLORINE_OUT_OF_RANGE', 'SENSOR_MISSING']);

export function tone(snapshot) {
  const d = snapshot.decision;
  if (d.state === 'REUSE') return 'verify';
  if (d.state === 'HOLD') return d.reasons.some(r => rules.reasons[r.code].severity === 'critical') ? 'danger' : 'hold';
  return 'idle';
}

export function createViewer(container, { interactive = false, labels = {}, lang = 'ar' } = {}) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.domElement.className = 'stage__canvas';
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#08121a');
  scene.fog = new THREE.Fog('#08121a', 11, 24);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(4, 7, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 5, bottom: -5, near: 1, far: 20 });
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key, new THREE.HemisphereLight('#bcd6e0', '#05090c', 0.35));
  const rim = new THREE.DirectionalLight('#7fd3ea', 1.1);
  rim.position.set(-6, 3, -5);
  scene.add(rim);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 60);
  const controls = new CameraControls(camera, renderer.domElement);
  controls.smoothTime = reduceMotion ? 0 : 0.7;
  controls.draggingSmoothTime = 0.12;
  controls.minDistance = 2.5;
  controls.maxDistance = 15;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.mouseButtons.wheel = CameraControls.ACTION.NONE; // the page scrolls; pinch and buttons zoom
  controls.enabled = interactive;

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new EffectPass(camera,
    new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.92, luminanceSmoothing: 0.15, intensity: 1.15, radius: 0.72 }),
    new VignetteEffect({ darkness: 0.5, offset: 0.32 }),
    new ToneMappingEffect({ mode: ToneMappingMode.AGX }),
    new SMAAEffect()));

  const unit = buildUnit();
  scene.add(unit.root);
  const { parts } = unit;
  const pulses = { treat: flowPulses(parts.paths.treat, parts.M.pulse, 52), reuse: flowPulses(parts.paths.reuse, parts.M.pulse, 30) };
  scene.add(pulses.treat, pulses.reuse);

  // HTML labels pinned to parts.
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'stage__labels';
  container.append(labelRenderer.domElement);
  const labelEls = {};
  for (const [name, text] of Object.entries(labels)) {
    const el = document.createElement('span');
    el.className = 'hotspot';
    el.textContent = text;
    const obj = new CSS2DObject(el);
    obj.position.copy(unit.anchors[name]);
    scene.add(obj);
    labelEls[name] = el;
  }

  let snap = null, levels = { raw: 0.6, treated: 0.4 }, active = true, frame = 0, side = null, shotDistance = 10;
  const clock = new THREE.Clock();
  // Slide the unit away from the text: sideways on wide screens (side = 1 when text is on the right),
  // upwards on narrow ones where the text sits at the bottom.
  const applyFrame = smooth => {
    if (side === null) return;
    const wide = camera.aspect > 1.2;
    controls.setFocalOffset(wide ? side * 0.16 * shotDistance : 0, wide ? 0 : 0.11 * shotDistance, 0, smooth && !reduceMotion);
  };
  const fit = () => {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    labelRenderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyFrame(false);
  };
  new ResizeObserver(fit).observe(container);
  fit();

  function setLed(mesh, color) { mesh.material.color.copy(COLORS[color]).multiplyScalar(3); }

  function applyState() {
    if (!snap) return;
    const t = tone(snap), d = snap.decision;
    setLed(parts.valveLed, snap.valve.feedback === 'open' ? 'verify' : t === 'verify' ? 'idle' : t);
    setLed(parts.valveFlag, snap.valve.feedback === 'open' ? 'verify' : t === 'verify' ? 'idle' : t);
    parts.valveFlag.rotation.y = snap.valve.feedback === 'open' ? Math.PI / 2 : 0;
    const qualityIssue = d.reasons.some(r => QUALITY.has(r.code));
    setLed(parts.sensorLed, qualityIssue ? (d.reasons.some(r => r.code === 'SENSOR_MISSING') ? 'danger' : 'hold') : snap.power === false ? 'idle' : 'verify');
    const code = d.reasons[0]?.code ?? 'ALL_CLEAR';
    drawScreen(parts.screen, { word: rules.states[d.state][lang], code: d.state, color: PALETTE[t === 'idle' ? 'brand' : t], detail: code });
  }

  function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    controls.update(dt);
    const motion = reduceMotion ? 0 : dt;
    if (snap) {
      const f = snap.flows_lpm;
      pulses.treat.userData.update(motion, f.feed > 0 ? 0.045 : f.backwash > 0 ? -0.03 : 0);
      pulses.reuse.userData.update(motion, f.irrigation > 0 ? 0.08 : 0);
      parts.fan.rotation.x += f.feed > 0 ? motion * 18 : 0;
      for (const [k, mesh] of [['raw', parts.rawLevel], ['treated', parts.treatedLevel]]) {
        levels[k] += (snap.tanks[k].percent / 100 - levels[k]) * Math.min(1, dt * 3);
        const h = Math.max(0.01, levels[k] * mesh.userData.height);
        mesh.scale.y = h;
        mesh.position.y = mesh.userData.base + h / 2;
      }
      const wet = f.irrigation > 0;
      parts.grass.color.lerp(wet ? GRASS_WET : GRASS_DRY, Math.min(1, dt * 0.8));
      const spray = parts.spray, dummy = spray.userData.dummy ??= new THREE.Object3D();
      spray.visible = wet;
      if (wet) {
        spray.userData.seeds.forEach((s, i) => {
          s.t = (s.t + motion * s.v * 0.7) % 1;
          const r = s.t * 1.05;
          dummy.position.set(Math.cos(s.a) * r, 0.27 + Math.sin(s.t * Math.PI) * 0.5 * s.v, Math.sin(s.a) * r);
          dummy.updateMatrix();
          spray.setMatrixAt(i, dummy.matrix);
        });
        spray.instanceMatrix.needsUpdate = true;
      }
    }
    composer.render(dt);
    labelRenderer.render(scene, camera);
    frame++;
  }

  const loop = () => renderer.setAnimationLoop(active && !document.hidden ? tick : null);
  new IntersectionObserver(([e]) => { active = e.isIntersecting; clock.getDelta(); loop(); }, { rootMargin: '120px' }).observe(container);
  document.addEventListener('visibilitychange', loop);
  document.fonts?.ready.then(applyState);

  function distanceScale() {
    return camera.aspect < 0.75 ? 2.0 : camera.aspect < 1.15 ? 1.6 : 1;
  }

  return {
    renderer, scene, camera, controls, unit,
    get frames() { return frame; },
    setSnapshot(s) { snap = s; applyState(); },
    setLang(l) { lang = l; applyState(); },
    setLabels(map) { for (const [k, v] of Object.entries(map)) if (labelEls[k]) labelEls[k].textContent = v; },
    highlight(name) { for (const [k, el] of Object.entries(labelEls)) el.classList.toggle('is-active', k === name); },
    showLabels(on) { labelRenderer.domElement.hidden = !on; },
    // Ease the camera to a stop, or between two stops (f in 0..1).
    goTo(a, b = a, f = 0, smooth = true) {
      const pick = n => STOPS[n === 'overview' && side === -1 ? 'overviewLtr' : n];
      const [pa, ta] = pick(a), [pb, tb] = pick(b), k = distanceScale();
      const lerp = (x, y) => x.map((v, i) => v + (y[i] - v) * f);
      const target = lerp(ta, tb), pos = lerp(pa, pb).map((v, i) => target[i] + (v - target[i]) * k);
      controls.setLookAt(...pos, ...target, smooth && !reduceMotion);
      shotDistance = Math.hypot(...pos.map((v, i) => v - target[i]));
      applyFrame(smooth);
    },
    zoom(step) { controls.dolly(step, true); },
    renderOnce() { for (let i = 0; i < 100; i++) controls.update(0.05); tick(); },
    frame(s) { side = s; applyFrame(true); },
  };
}

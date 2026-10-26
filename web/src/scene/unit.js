// The WAREVA unit, modelled in code: a skid with collection tank, feed pump, media and carbon
// filters, 5-micron cartridge, dosing, treated tank, the sensor cell, the gate valve with its
// cabinet, and the lawn it irrigates. Water travels right to left on screen, the reading direction.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const PALETTE = {
  ink: '#e5eef2', brand: '#5bb8d1', verify: '#3fd1a8', hold: '#f0b030', danger: '#f07a6e', idle: '#6a8390',
};

function materials(low) {
  const m = (opts) => new THREE.MeshPhysicalMaterial(opts);
  return {
    hdpe: m({ color: '#e8edef', roughness: 0.55, clearcoat: 0.2 }),
    steel: m({ color: '#c3ccd2', metalness: 1, roughness: 0.26 }),
    brushed: m({ color: '#8d989f', metalness: 1, roughness: 0.42 }),
    frame: m({ color: '#1b2730', metalness: 0.55, roughness: 0.45 }),
    deck: m({ color: '#2a3842', metalness: 0.4, roughness: 0.62 }),
    frp: m({ color: '#2f6f86', roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    carbon: m({ color: '#1d252b', roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.15 }),
    motor: m({ color: '#24343f', metalness: 0.3, roughness: 0.5 }),
    cabinet: m({ color: '#eef2f3', roughness: 0.4, clearcoat: 0.4 }),
    rubber: m({ color: '#0f1418', roughness: 0.9 }),
    // Transmission needs an extra full-screen render pass; phones get plain transparency instead.
    glass: low ? m({ color: '#dfeaee', roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false })
      : m({ color: '#ffffff', metalness: 0, roughness: 0.04, transmission: 1, thickness: 0.05, ior: 1.45, transparent: true }),
    water: low ? m({ color: PALETTE.brand, roughness: 0.15, emissive: PALETTE.brand, emissiveIntensity: 0.2 })
      : m({ color: PALETTE.brand, roughness: 0.1, transmission: 0.35, thickness: 0.4, emissive: PALETTE.brand, emissiveIntensity: 0.15 }),
    floor: new THREE.MeshStandardMaterial({ color: '#070e13', roughness: 0.95, metalness: 0, envMapIntensity: 0.25 }),
    grass: new THREE.MeshStandardMaterial({ color: '#2f7a52', roughness: 0.9 }),
    soil: new THREE.MeshStandardMaterial({ color: '#1a2a24', roughness: 1 }),
    pulse: new THREE.MeshBasicMaterial({ color: new THREE.Color('#9eeeff').multiplyScalar(low ? 1.1 : 2.2), toneMapped: false }),
    spray: new THREE.MeshBasicMaterial({ color: new THREE.Color('#bff6ff').multiplyScalar(1.4), toneMapped: false, transparent: true, opacity: 0.85 }),
  };
}

function led(color) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), toneMapped: false });
}

const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
};

// A pressure vessel with elliptical heads, standing on a ring base.
function vessel(r, h, mat, base) {
  const g = new THREE.Group();
  const pts = [];
  const head = r * 0.55;
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r, head - Math.cos(a) * head)); }
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI / 2; pts.push(new THREE.Vector2(Math.cos(a) * r, h - head + Math.sin(a) * head)); }
  add(g, new THREE.LatheGeometry(pts, 48), mat, 0, 0.14, 0);
  add(g, new THREE.CylinderGeometry(r * 0.78, r * 0.86, 0.16, 32, 1, true), base, 0, 0.08, 0);
  add(g, new THREE.CylinderGeometry(0.035, 0.035, 0.08, 16), base, 0, h + 0.17, 0);
  return g;
}

// Polyline with rounded corners, so pipes read like bent stainless tube.
export function roundedPath(points, radius = 0.12) {
  const v = points.map(p => new THREE.Vector3(...p));
  const path = new THREE.CurvePath();
  let start = v[0].clone();
  for (let i = 1; i < v.length - 1; i++) {
    const [prev, cur, next] = [v[i - 1], v[i], v[i + 1]];
    const r = Math.min(radius, cur.distanceTo(prev) / 2, cur.distanceTo(next) / 2);
    const a = cur.clone().addScaledVector(cur.clone().sub(prev).normalize(), -r);
    const b = cur.clone().addScaledVector(next.clone().sub(cur).normalize(), r);
    path.add(new THREE.LineCurve3(start, a));
    path.add(new THREE.QuadraticBezierCurve3(a, cur.clone(), b));
    start = b;
  }
  path.add(new THREE.LineCurve3(start, v[v.length - 1]));
  return path;
}

function tank(mat, r, h, M) {
  const g = new THREE.Group();
  add(g, new THREE.CylinderGeometry(r, r, h, 48), mat, 0, h / 2 + 0.06, 0);
  add(g, new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.05, 48), M.frame, 0, h + 0.085, 0);
  for (let i = 1; i < 4; i++) add(g, new THREE.TorusGeometry(r * 1.005, 0.012, 8, 64), mat, 0, (h / 4) * i + 0.06, 0).rotation.x = Math.PI / 2;
  add(g, new THREE.CylinderGeometry(r * 0.3, r * 0.3, 0.06, 32), M.frame, 0, h + 0.12, 0);
  // Sight glass on the front: the water column inside it shows the level.
  const tubeH = h * 0.86;
  add(g, new THREE.CylinderGeometry(0.035, 0.035, tubeH, 16), M.glass, 0, tubeH / 2 + 0.12, r + 0.06);
  const level = add(g, new THREE.CylinderGeometry(0.026, 0.026, 1, 16), M.water, 0, 0.12, r + 0.06);
  level.userData = { base: 0.12, height: tubeH };
  for (const y of [0.1, tubeH + 0.14]) add(g, new THREE.BoxGeometry(0.05, 0.03, 0.1), M.steel, 0, y, r + 0.03);
  return { group: g, level };
}

function pump(M) {
  const g = new THREE.Group();
  add(g, new RoundedBoxGeometry(0.62, 0.06, 0.36, 2, 0.02), M.frame, 0, 0.03, 0);
  const motor = add(g, new THREE.CylinderGeometry(0.13, 0.13, 0.34, 32), M.motor, 0.08, 0.2, 0);
  motor.rotation.z = Math.PI / 2;
  for (let i = 0; i < 7; i++) add(g, new THREE.TorusGeometry(0.133, 0.008, 6, 32), M.motor, -0.04 + i * 0.04, 0.2, 0).rotation.y = Math.PI / 2;
  const volute = add(g, new THREE.CylinderGeometry(0.12, 0.12, 0.1, 32), M.steel, -0.17, 0.2, 0);
  volute.rotation.z = Math.PI / 2;
  const fan = add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.02, 6), M.brushed, 0.26, 0.2, 0);
  fan.rotation.z = Math.PI / 2;
  return { group: g, fan };
}

function screenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 320;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { canvas, texture };
}

export function drawScreen(screen, { word, code, color, detail }) {
  const c = screen.canvas.getContext('2d');
  c.fillStyle = '#081016'; c.fillRect(0, 0, 256, 320);
  c.fillStyle = color; c.fillRect(0, 0, 256, 10);
  c.beginPath(); c.arc(128, 104, 46, 0, Math.PI * 2); c.fillStyle = color; c.globalAlpha = 0.18; c.fill(); c.globalAlpha = 1;
  c.lineWidth = 9; c.strokeStyle = color; c.lineCap = 'round'; c.lineJoin = 'round'; c.beginPath();
  if (code === 'REUSE') { c.moveTo(104, 106); c.lineTo(122, 124); c.lineTo(154, 88); } else { c.moveTo(128, 80); c.lineTo(128, 112); c.moveTo(128, 130); c.lineTo(128, 131); }
  c.stroke();
  c.fillStyle = '#e5eef2'; c.textAlign = 'center'; c.direction = 'rtl';
  c.font = '600 34px "Readex Pro", system-ui, sans-serif'; c.fillText(word, 128, 200);
  c.font = '500 18px "IBM Plex Mono", monospace'; c.fillStyle = color; c.fillText(code, 128, 232);
  c.font = '400 15px "Readex Pro", system-ui, sans-serif'; c.fillStyle = '#9cb0ba'; c.fillText(detail ?? '', 128, 272);
  screen.texture.needsUpdate = true;
}

export function buildUnit({ low = false } = {}) {
  const M = materials(low);
  const root = new THREE.Group();
  const parts = {}, anchors = {};

  // Floor and skid.
  const floor = add(root, new THREE.CircleGeometry(16, 64), M.floor, 0, 0, 0);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
  const skid = new THREE.Group(); root.add(skid);
  for (const z of [-0.78, 0.78]) add(skid, new THREE.BoxGeometry(7.0, 0.12, 0.1), M.frame, 0.15, 0.06, z);
  for (let x = -3.2; x <= 3.5; x += 0.95) add(skid, new THREE.BoxGeometry(0.08, 0.1, 1.5), M.frame, x, 0.05, 0);
  add(skid, new THREE.BoxGeometry(7.0, 0.025, 1.62), M.deck, 0.15, 0.125, 0);
  const deck = 0.14;

  // 1. Collection tank and feed pump.
  const raw = tank(M.hdpe, 0.56, 1.55, M); raw.group.position.set(2.95, deck, -0.05); root.add(raw.group);
  parts.rawLevel = raw.level; anchors.collect = new THREE.Vector3(2.95, 1.9, 0);
  const p = pump(M); p.group.position.set(1.95, deck, 0.35); root.add(p.group);
  parts.fan = p.fan; anchors.pump = new THREE.Vector3(1.95, 0.75, 0.35);

  // 2. Treatment: media, carbon, cartridge, dosing.
  const media = vessel(0.27, 1.45, M.frp, M.frame); media.position.set(1.05, deck, -0.05); root.add(media);
  const carbon = vessel(0.27, 1.45, M.carbon, M.frame); carbon.position.set(0.3, deck, -0.05); root.add(carbon);
  const cart = vessel(0.12, 0.62, M.steel, M.frame); cart.position.set(-0.32, deck, 0.25); root.add(cart);
  anchors.treat = new THREE.Vector3(0.65, 1.95, 0);
  const dose = new THREE.Group(); dose.position.set(-0.55, deck, -0.55); root.add(dose);
  add(dose, new THREE.CylinderGeometry(0.15, 0.15, 0.42, 32), M.hdpe, 0, 0.21, 0);
  add(dose, new RoundedBoxGeometry(0.16, 0.12, 0.12, 2, 0.02), M.motor, 0.24, 0.07, 0);
  anchors.dose = new THREE.Vector3(-0.55, 0.8, -0.55);

  // 3. Treated tank.
  const treated = tank(M.steel, 0.5, 1.45, M); treated.group.position.set(-1.25, deck, -0.1); root.add(treated.group);
  parts.treatedLevel = treated.level; anchors.store = new THREE.Vector3(-1.25, 1.8, 0);

  // 4. Sensor cell: a glass chamber on the outlet line with four probes and a status ring.
  const cell = new THREE.Group(); cell.position.set(-2.12, deck + 0.3, 0.42); root.add(cell);
  const glass = add(cell, new THREE.CylinderGeometry(0.1, 0.1, 0.62, 32), M.glass, 0, 0, 0); glass.rotation.z = Math.PI / 2;
  const inner = add(cell, new THREE.CylinderGeometry(0.085, 0.085, 0.6, 32), M.water, 0, 0, 0); inner.rotation.z = Math.PI / 2; inner.material = M.water.clone(); inner.material.transparent = true; inner.material.opacity = 0.55;
  add(cell, new RoundedBoxGeometry(0.66, 0.08, 0.2, 2, 0.02), M.brushed, 0, 0.16, 0);
  for (let i = 0; i < 4; i++) {
    const x = -0.21 + i * 0.14;
    add(cell, new THREE.CylinderGeometry(0.018, 0.018, 0.32, 12), M.steel, x, 0.08, 0);
    add(cell, new THREE.CylinderGeometry(0.03, 0.03, 0.09, 16), M.rubber, x, 0.26, 0);
  }
  parts.sensorLed = add(cell, new THREE.TorusGeometry(0.11, 0.012, 8, 48), led(PALETTE.verify), 0, 0.21, 0);
  parts.sensorLed.rotation.x = Math.PI / 2;
  anchors.sense = new THREE.Vector3(-2.12, 0.95, 0.42);

  // 5. The gate: motorised ball valve and the control cabinet that decides.
  const gate = new THREE.Group(); gate.position.set(-2.82, deck + 0.3, 0.42); root.add(gate);
  add(gate, new THREE.SphereGeometry(0.11, 32, 16), M.steel, 0, 0, 0);
  for (const s of [-1, 1]) add(gate, new THREE.CylinderGeometry(0.1, 0.1, 0.04, 32), M.steel, s * 0.13, 0, 0).rotation.z = Math.PI / 2;
  add(gate, new THREE.CylinderGeometry(0.025, 0.025, 0.12, 12), M.brushed, 0, 0.14, 0);
  add(gate, new RoundedBoxGeometry(0.24, 0.16, 0.2, 3, 0.03), M.motor, 0, 0.27, 0);
  parts.valveLed = add(gate, new THREE.SphereGeometry(0.022, 16, 8), led(PALETTE.verify), 0, 0.28, 0.105);
  parts.valveFlag = add(gate, new THREE.BoxGeometry(0.2, 0.025, 0.05), led(PALETTE.verify), 0, 0.37, 0);
  anchors.gate = new THREE.Vector3(-2.82, 1.0, 0.42);
  const cabinet = new THREE.Group(); cabinet.position.set(-2.75, deck, -0.5); root.add(cabinet);
  add(cabinet, new THREE.CylinderGeometry(0.03, 0.03, 0.55, 12), M.frame, 0, 0.27, 0);
  add(cabinet, new RoundedBoxGeometry(0.5, 0.68, 0.22, 3, 0.03), M.cabinet, 0, 0.88, 0);
  const screen = screenTexture();
  const screenMesh = add(cabinet, new THREE.PlaneGeometry(0.32, 0.4), new THREE.MeshBasicMaterial({ map: screen.texture, toneMapped: false }), 0, 0.92, 0.112);
  screenMesh.castShadow = false;
  parts.screen = screen;
  anchors.cabinet = new THREE.Vector3(-2.75, 1.45, -0.5);

  // 6. The lawn: grass blades, a sprinkler and its spray.
  const lawn = new THREE.Group(); lawn.position.set(-4.75, 0, 0.3); root.add(lawn);
  add(lawn, new THREE.CylinderGeometry(1.15, 1.2, 0.08, 64), M.soil, 0, 0.04, 0);
  const bladeGeo = new THREE.ConeGeometry(0.012, 0.16, 3); bladeGeo.translate(0, 0.08, 0);
  const blades = new THREE.InstancedMesh(bladeGeo, M.grass, low ? 700 : 1800);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < blades.count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 1.1;
    dummy.position.set(Math.cos(a) * r, 0.08, Math.sin(a) * r);
    dummy.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    dummy.scale.setScalar(0.7 + Math.random() * 0.7);
    dummy.updateMatrix(); blades.setMatrixAt(i, dummy.matrix);
  }
  blades.castShadow = blades.receiveShadow = true;
  lawn.add(blades);
  add(lawn, new THREE.CylinderGeometry(0.03, 0.04, 0.22, 12), M.brushed, 0, 0.15, 0);
  const spray = new THREE.InstancedMesh(new THREE.SphereGeometry(0.014, 6, 4), M.spray, low ? 80 : 160);
  spray.userData.seeds = Array.from({ length: spray.count }, () => ({ a: Math.random() * Math.PI * 2, t: Math.random(), v: 0.7 + Math.random() * 0.5 }));
  spray.castShadow = false;
  lawn.add(spray);
  parts.grass = M.grass; parts.spray = spray; parts.lawn = lawn;
  anchors.lawn = new THREE.Vector3(-4.75, 0.6, 0.3);

  // Pipework. The treatment line climbs through each vessel; the reuse line runs through the
  // sensor cell and the gate to the lawn.
  const y0 = deck + 0.3;
  const treatPath = roundedPath([
    [2.95, y0, 0.5], [2.35, y0, 0.5], [2.35, y0, 0.35], [1.5, y0, 0.35],
    [1.5, 1.85, 0.35], [1.05, 1.85, 0.35], [1.05, 1.85, -0.05], [1.05, 0.35, -0.05],
    [0.68, 0.35, -0.05], [0.68, 1.85, -0.05], [0.3, 1.85, -0.05], [0.3, 0.35, -0.05],
    [0.0, 0.35, 0.25], [-0.32, 0.35, 0.25], [-0.32, 0.92, 0.25], [-0.75, 0.92, 0.25], [-0.75, 1.75, -0.1], [-1.25, 1.75, -0.1],
  ], 0.1);
  const reusePath = roundedPath([
    [-1.25, y0, 0.25], [-1.25, y0, 0.42], [-1.8, y0, 0.42], [-3.1, y0, 0.42], [-3.6, y0, 0.42], [-3.6, 0.12, 0.42], [-4.75, 0.12, 0.3],
  ], 0.12);
  for (const path of [treatPath, reusePath]) {
    const tube = add(root, new THREE.TubeGeometry(path, 400, 0.032, 12, false), M.steel);
    tube.castShadow = true;
  }
  parts.paths = { treat: treatPath, reuse: reusePath };
  parts.M = M;
  return { root, parts, anchors };
}

// Glowing pulses that travel along a path while that line is flowing.
export function flowPulses(path, material, count = 36) {
  const mesh = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.018, 0.05, 4, 8), material, count);
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D(), tangent = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let offset = 0;
  mesh.userData.update = (dt, speed) => {
    offset = (offset + dt * speed) % 1;
    for (let i = 0; i < count; i++) {
      const u = (i / count + offset) % 1;
      path.getPointAt(u, dummy.position);
      path.getTangentAt(u, tangent);
      dummy.quaternion.setFromUnitVectors(up, tangent);
      dummy.scale.setScalar(speed ? 1 : 0.0001);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };
  return mesh;
}

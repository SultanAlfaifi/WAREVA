// WAREVA 3D experience: the browser twin (twin/plant.js) driving a simple scene of the unit.
// Water flows from the raw tank on the right, through treatment and the validation gate, to the lawn on the left.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import rules from '../../core/rules.json';
import { Plant } from '../../twin/plant.js';
import verified from '../../brand/icons/verified.svg?raw';
import alert from '../../brand/icons/alert.svg?raw';
import standby from '../../brand/icons/standby.svg?raw';
import backwash from '../../brand/icons/backwash.svg?raw';
import valveIcon from '../../brand/icons/valve.svg?raw';
import power from '../../brand/icons/power.svg?raw';

const icon = svg => svg.replace('<svg ', '<svg class="wv-icon" aria-hidden="true" ');
const ICONS = { verified, alert, standby, backwash, valve: valveIcon, power };
const STATES = { REUSE: ['reuse', 'verified'], HOLD: ['hold', 'alert'], STANDBY: ['standby', 'standby'], BACKWASH: ['backwash', 'backwash'] };
const FAULTS = [['none', 'تشغيل اعتيادي'], ['turbidity', 'ارتفاع العكارة'], ['sensor_dropout', 'فقد قراءة الكلور'],
  ['clogging', 'انسداد المرشح'], ['power_loss', 'انقطاع الكهرباء'], ['valve_stuck', 'تعطل صمام الري']];
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const plant = new Plant(rules, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
let speed = 1, snap = plant.snapshot();

// ---------------------------------------------------------------- panel
function renderPanel() {
  const d = snap.decision, [cls, ic] = STATES[d.state];
  $('#status').innerHTML = `<span class="wv-status wv-status--${cls} wv-status--lg">${icon(ICONS[ic])}${rules.states[d.state].ar} <span class="wv-status__code">${d.state}</span></span>`;
  $('#reasons').innerHTML = d.reasons.length
    ? d.reasons.map(r => {
      const sev = rules.reasons[r.code].severity, kind = sev === 'critical' ? 'critical' : sev === 'warning' ? 'hold' : 'info';
      const ic2 = r.code === 'POWER_LOSS' ? 'power' : r.code === 'BACKWASH_MODE' ? 'backwash' : kind === 'info' ? 'standby' : 'alert';
      return `<li class="wv-reason" data-kind="${kind}">${icon(ICONS[ic2])}<code>${esc(r.code)}</code><span>${esc(r.text)}</span></li>`;
    }).join('')
    : `<li class="wv-reason" data-kind="ok">${icon(verified)}<code>ALL_CLEAR</code><span>كل القراءات ضمن الحدود؛ الري مسموح.</span></li>`;

  const L = rules.limits, r = snap.readings;
  const rows = [
    ['turbidity', 2, v => v > L.turbidity_max_ntu], ['chlorine', 2, v => v < L.chlorine_min_mg_l || v > L.chlorine_max_mg_l],
    ['ph', 2, v => v < L.ph_min || v > L.ph_max], ['flow_lpm', 1, () => false],
  ];
  $('#readings').innerHTML = rows.map(([k, digits, out]) => {
    const v = r[k], missing = typeof v !== 'number', meta = rules.sensors[k];
    return `<div data-state="${missing ? 'missing' : out(v) ? 'out' : 'ok'}"><dt>${meta.ar}</dt><dd><bdi>${missing ? '—' : v.toFixed(digits)}</bdi> <small>${meta.unit}</small></dd></div>`;
  }).join('');

  const v = snap.valve, mismatch = d.latched.includes('VALVE_MISMATCH');
  $('#valve').innerHTML = `<div class="wv-valve" data-match="${!mismatch}">${icon(valveIcon)}<div><dl>
    <div><dt>أمر المتحكم</dt><dd>${v.command === 'open' ? 'فتح' : 'إغلاق'}</dd></div>
    <div><dt>الموضع المقاس</dt><dd>${v.feedback === 'open' ? 'مفتوح' : 'مغلق'}</dd></div></dl>
    <p class="wv-valve__alert">${icon(alert)}تعارض: الصمام لا يطابق الأمر</p></div></div>`;

  document.querySelectorAll('#faults button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fault === snap.fault)));
  document.querySelectorAll('#speed button').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.speed) === speed)));
  $('#reset').disabled = !d.latched.length;
  $('#clock').textContent = `${snap.time.replace('T', ' ').replace('Z', ' UTC')} · ${snap.volumes_l.irrigated.toFixed(1)} L → irrigation`;
}

$('#faults').innerHTML = FAULTS.map(([k, label]) => `<button type="button" data-fault="${k}" aria-pressed="false">${label}</button>`).join('');
$('#faults').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { plant.setFault(b.dataset.fault); tick(); } });
$('#speed').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { speed = Number(b.dataset.speed); renderPanel(); } });
$('#reset').addEventListener('click', () => { plant.reset(); tick(); });

function tick() { snap = plant.step(speed); renderPanel(); updateScene(); }
renderPanel();
setInterval(tick, 1000);

// ---------------------------------------------------------------- scene
const stage = $('#stage');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch {
  stage.hidden = true;
  $('#fallback').hidden = false;
}

const css = name => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
camera.position.set(-1.5, 6.5, 13);
const mats = {};
const material = (key, opts = {}) => (mats[key] = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, ...opts }));
['ground', 'shell', 'steel', 'carbon', 'brand', 'water', 'lawn', 'valve', 'probe', 'pipe'].forEach(k => material(k));
mats.shell.transparent = true; mats.shell.opacity = 0.28; mats.shell.depthWrite = false;
mats.water.transparent = true; mats.water.opacity = 0.85;

function paint() {
  mats.ground.color = css('--surface-200');
  mats.shell.color = css('--line-strong');
  mats.steel.color = css('--line-strong');
  mats.carbon.color = css('--ink');
  mats.brand.color = css('--brand');
  mats.water.color = css('--brand');
  mats.lawn.color = css('--status-reuse');
  mats.pipe.color = css('--line-strong');
  mats.probe.color = css('--ink-muted');
  flowMat.color = css('--brand-tint');
  updateScene();
}

const add = (geo, mat, x, y, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); scene.add(m); return m; };
add(new THREE.CylinderGeometry(9, 9, 0.1, 64), mats.ground, 0, -0.05);
const lawn = add(new THREE.BoxGeometry(2.6, 0.12, 2.6), mats.lawn, -5.4, 0.06);

function tank(x, label, labelAt) {
  add(new THREE.CylinderGeometry(0.95, 0.95, 2.2, 48, 1, true), mats.shell, x, 1.1);
  add(new THREE.TorusGeometry(0.95, 0.03, 8, 48), mats.steel, x, 2.2).rotation.x = Math.PI / 2;
  const water = add(new THREE.CylinderGeometry(0.9, 0.9, 1, 48), mats.water, x, 0.5);
  labels.push([label, labelAt]);
  return water;
}
const labels = [];
const rawWater = tank(5.2, 'الماء الخام', new THREE.Vector3(5.2, 2.75, 0));
const treatedWater = tank(-0.9, 'الخزان المعالج', new THREE.Vector3(-0.9, 0.15, 1.3));
add(new THREE.BoxGeometry(0.6, 0.45, 0.5), mats.brand, 3.75, 0.25); labels.push(['مضخة التغذية', new THREE.Vector3(3.75, 0.2, 1.1)]);
[[2.6, 0.32, 1.9, mats.steel, 'وسائط', 2.3], [1.6, 0.32, 1.9, mats.carbon, 'كربون', 2.95], [0.75, 0.18, 1.3, mats.steel, '5 ميكرون', 1.7]].forEach(([x, r, h, m, name, ly]) => {
  add(new THREE.CylinderGeometry(r, r, h, 32), m, x, h / 2);
  labels.push([name, new THREE.Vector3(x, ly, 0)]);
});
[-0.6, -0.8, -1.0, -1.2].forEach(x => add(new THREE.CylinderGeometry(0.035, 0.035, 1.1, 8), mats.probe, x, 2.3, 0.35));
const lamp = add(new THREE.SphereGeometry(0.13, 24, 16), new THREE.MeshStandardMaterial({ emissiveIntensity: 0.7 }), -0.9, 2.95, 0.35);
labels.push(['حساسات التحقق', new THREE.Vector3(-0.9, 3.5, 0.35)]);

const valve = new THREE.Group();
const coneGeo = new THREE.ConeGeometry(0.28, 0.42, 24);
[1, -1].forEach(s => { const c = new THREE.Mesh(coneGeo, mats.valve); c.rotation.z = (s * Math.PI) / 2; c.position.x = s * 0.21; valve.add(c); });
const handle = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.1), mats.steel); handle.position.y = 0.45; valve.add(handle);
valve.position.set(-2.9, 0.3, 0); scene.add(valve);
labels.push(['صمام الري', new THREE.Vector3(-2.9, 1.05, 0)]);
labels.push(['المسطح الأخضر', new THREE.Vector3(-5.4, 0.2, 1.4)]);

const pipe = pts => {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.05);
  scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.06, 10), mats.pipe));
  return curve;
};
const feedCurve = pipe([[4.4, 0.25, 0], [3.75, 0.25, 0], [2.6, 0.25, 0], [1.6, 0.25, 0], [0.75, 0.25, 0], [-0.1, 0.25, 0]]);
const reuseCurve = pipe([[-1.7, 0.3, 0], [-2.6, 0.3, 0], [-3.2, 0.3, 0], [-4.1, 0.3, 0]]);
const washCurve = pipe([[-0.9, 2.25, -0.55], [0.8, 2.6, -0.55], [2.6, 2.2, -0.2]]);

const flowMat = new THREE.MeshBasicMaterial();
const particles = curve => Array.from({ length: 14 }, (_, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), flowMat); scene.add(m); return { m, t: i / 14, curve };
});
const streams = { feed: particles(feedCurve), irrigation: particles(reuseCurve), backwash: particles(washCurve) };
const spray = Array.from({ length: 40 }, () => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), flowMat); scene.add(m);
  return { m, a: Math.random() * Math.PI * 2, t: Math.random() };
});

scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-4, 9, 7); scene.add(sun);

function updateScene() {
  if (!renderer) return;
  const level = (w, pct) => { const h = Math.max(0.02, (pct / 100) * 2.1); w.scale.y = h; w.position.y = h / 2 + 0.02; };
  level(rawWater, snap.tanks.raw.percent);
  level(treatedWater, snap.tanks.treated.percent);
  const d = snap.decision, critical = d.reasons.some(r => rules.reasons[r.code].severity === 'critical');
  mats.valve.color = css(snap.valve.feedback === 'open' ? '--verify' : critical ? '--danger' : '--status-hold-edge');
  handle.rotation.y = snap.valve.feedback === 'open' ? Math.PI / 2 : 0;
  const lampColor = css(d.state === 'REUSE' ? '--verify' : critical ? '--danger' : '--status-hold');
  lamp.material.color = lampColor; lamp.material.emissive = lampColor;
  mats.lawn.color = css(snap.flows_lpm.irrigation > 0 ? '--status-reuse' : '--line-strong');
}

const labelEls = labels.map(([text]) => {
  const el = document.createElement('span'); el.className = 'xp__label'; el.textContent = text; stage.append(el); return el;
});

if (renderer) {
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  stage.append(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(-0.3, 1, 0);
  controls.enableDamping = true;
  controls.minDistance = 7; controls.maxDistance = 20; controls.maxPolarAngle = 1.35;
  new ResizeObserver(() => {
    const { clientWidth: w, clientHeight: h } = stage;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    // Narrow stages need the camera further back to keep the whole unit in frame.
    const distance = camera.aspect < 1 ? 24 : camera.aspect < 1.6 ? 18 : 14.5;
    camera.position.sub(controls.target).setLength(distance).add(controls.target);
  }).observe(stage);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint);
  paint();

  const clock = new THREE.Clock(), v = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    const dt = reduceMotion ? 0 : clock.getDelta();
    for (const [key, list] of Object.entries(streams)) {
      const on = snap.flows_lpm[key] > 0;
      for (const p of list) { p.m.visible = on; if (on) { p.t = (p.t + dt * 0.25) % 1; p.m.position.copy(p.curve.getPointAt(p.t)); } }
    }
    const watering = snap.flows_lpm.irrigation > 0;
    for (const s of spray) {
      s.m.visible = watering;
      if (watering) { s.t = (s.t + dt * 0.8) % 1; const r = s.t * 1.1; s.m.position.set(-5.4 + Math.cos(s.a) * r, 0.2 + Math.sin(s.t * Math.PI) * 0.8, Math.sin(s.a) * r); }
    }
    controls.update();
    renderer.render(scene, camera);
    const { clientWidth: w, clientHeight: h } = stage;
    labels.forEach(([, pos], i) => {
      v.copy(pos).project(camera);
      labelEls[i].style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      labelEls[i].hidden = v.z > 1;
    });
  });
}

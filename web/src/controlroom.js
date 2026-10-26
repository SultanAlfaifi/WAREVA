// The live control room: a twin you can break, shown on the phone and, where the device allows,
// as the 3D unit. The twin, phone and scenarios never depend on the 3D code.
import rules from '../../core/rules.json';
import { FAULTS, Plant } from '../../twin/plant.js';
import { STRINGS, t } from './i18n.js';
import { createPhone } from './phone.js';
import { tone } from './tone.js';

const LABELS = ['collect', 'treat', 'store', 'sense', 'gate', 'cabinet', 'lawn'];
const labelText = lang => Object.fromEntries(LABELS.map(k => [k, STRINGS[lang][`label.${k}`]]));

export function mountControlRoom(root, lang) {
  const stage = root.querySelector('[data-stage]');
  const phone = createPhone(root.querySelector('[data-phone]'));
  const plant = new Plant(rules, new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
  let speed = 1, signature = null, visible = false, snap = plant.snapshot(), viewer = null;

  const faults = root.querySelector('[data-faults]');
  faults.innerHTML = FAULTS.map(f => `<button type="button" class="chip" data-fault="${f}" data-i18n="fault.${f}" aria-pressed="${f === 'none'}">${t(lang, `fault.${f}`)}</button>`).join('');
  faults.addEventListener('click', e => {
    const b = e.target.closest('[data-fault]');
    if (!b) return;
    plant.setFault(b.dataset.fault);
    for (const x of faults.children) x.setAttribute('aria-pressed', String(x === b));
    step();
  });
  const reset = root.querySelector('[data-reset]');
  reset.addEventListener('click', () => { plant.reset(); step(); });
  root.querySelector('[data-speed]')?.addEventListener('click', e => {
    const b = e.target.closest('[data-speed-value]');
    if (!b) return;
    speed = Number(b.dataset.speedValue);
    for (const x of b.parentElement.children) x.setAttribute('aria-checked', String(x === b));
  });
  root.querySelectorAll('[data-zoom]').forEach(b => b.addEventListener('click', () => viewer?.zoom(Number(b.dataset.zoom))));

  function render() {
    viewer?.setSnapshot(snap);
    phone.render(snap, lang);
    reset.disabled = !snap.decision.latched.length;
  }

  function step() {
    snap = plant.step(speed);
    const sig = snap.decision.state + snap.decision.reasons.map(r => r.code).join();
    if (signature !== null && sig !== signature) phone.notify(snap, lang, tone(snap));
    signature = sig;
    render();
  }

  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
  setInterval(() => { if (visible && !document.hidden) step(); }, 1000);
  step();

  return {
    stage,
    get has3d() { return Boolean(viewer); },
    // Create the 3D unit with the factory from scene/viewer.js; called once that code has loaded.
    attach(createViewer, onLost) {
      if (viewer) return;
      viewer = createViewer(stage, { interactive: true, labels: labelText(lang), lang, onLost });
      viewer.goTo('control', 'control', 0, false);
      viewer.setSnapshot(snap);
    },
    detach() { viewer?.dispose(); viewer = null; },
    setLang(l) {
      lang = l;
      viewer?.setLang(l);
      viewer?.setLabels(labelText(l));
      render();
    },
  };
}

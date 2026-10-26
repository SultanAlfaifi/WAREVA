// Phone mockup: the WAREVA mobile view, fed by the same twin snapshot as the 3D unit.
// The frame is drawn in CSS and carries no device maker's marks.
import rules from '../../core/rules.json';
import { describe } from '../../core/decide.js';
import { t } from './i18n.js';
import verified from '../../brand/icons/verified.svg?raw';
import alert from '../../brand/icons/alert.svg?raw';
import standby from '../../brand/icons/standby.svg?raw';
import backwash from '../../brand/icons/backwash.svg?raw';
import valve from '../../brand/icons/valve.svg?raw';
import power from '../../brand/icons/power.svg?raw';
import mark from '../../brand/logos/wareva-mark-white.svg';

const icon = svg => svg.replace('<svg ', '<svg class="wv-icon" aria-hidden="true" ');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const STATE = { REUSE: ['reuse', verified], HOLD: ['hold', alert], STANDBY: ['standby', standby], BACKWASH: ['backwash', backwash] };
const READINGS = [['turbidity', 2], ['chlorine', 2], ['ph', 2], ['flow_lpm', 1]];

export function createPhone(el) {
  el.innerHTML = `
    <div class="phone__screen">
      <span class="phone__island" aria-hidden="true"></span>
      <div class="phone__toast" role="status" aria-live="polite" hidden></div>
      <header class="app__bar"><img src="${mark}" alt="" width="28" height="28"><div><strong>WAREVA</strong><span data-slot="site"></span></div><span class="app__live" data-slot="live"></span></header>
      <div class="app__body">
        <p class="app__label" data-slot="now"></p>
        <div data-slot="status"></div>
        <p class="app__reason" data-slot="reason"></p>
        <div class="app__valve" data-slot="valve"></div>
        <dl class="app__readings" data-slot="readings"></dl>
        <div class="app__today"><span data-slot="todayLabel"></span><strong data-slot="today"></strong></div>
        <p class="app__label" data-slot="eventsLabel"></p>
        <ol class="app__events" data-slot="events"></ol>
      </div>
    </div>`;
  const slot = name => el.querySelector(`[data-slot="${name}"]`);
  const toast = el.querySelector('.phone__toast');
  const events = [];
  let toastTimer;

  return {
    render(snap, lang) {
      const d = snap.decision, [cls, ic] = STATE[d.state];
      slot('site').textContent = t(lang, 'phone.site');
      slot('live').textContent = t(lang, 'cr.sim');
      slot('now').textContent = t(lang, 'phone.now');
      slot('status').innerHTML = `<span class="wv-status wv-status--${cls} wv-status--lg">${icon(ic)}${esc(rules.states[d.state][lang])} <span class="wv-status__code">${d.state}</span></span>`;
      slot('reason').textContent = d.reasons.length ? describe(rules, d.reasons[0], lang) : t(lang, 'phone.allclear');
      const open = snap.valve.feedback === 'open';
      slot('valve').innerHTML = `${icon(valve)}<span>${t(lang, open ? 'phone.open' : 'phone.closed')}</span>`;
      slot('valve').dataset.open = String(open);
      slot('readings').innerHTML = READINGS.map(([k, digits]) => {
        const v = snap.readings[k], meta = rules.sensors[k];
        return `<div><dt>${esc(meta[lang])}</dt><dd><bdi>${typeof v === 'number' ? v.toFixed(digits) : '—'}</bdi> <small>${esc(meta.unit)}</small></dd></div>`;
      }).join('');
      slot('todayLabel').textContent = t(lang, 'phone.today');
      slot('today').innerHTML = `<bdi>${snap.volumes_l.irrigated.toFixed(0)}</bdi> ${t(lang, 'phone.liters')}`;
      slot('eventsLabel').textContent = t(lang, 'phone.events');
      slot('events').innerHTML = events.slice(0, 3).map(e => `<li data-tone="${e.tone}"><time>${e.time}</time><span>${esc(rules.states[e.state][lang])}</span></li>`).join('');
    },
    // Called when the decision changes: logs it and slides a notification in, as a push alert would.
    notify(snap, lang, tone) {
      const d = snap.decision;
      events.unshift({ time: snap.time.slice(11, 19), state: d.state, tone });
      const text = d.reasons.length ? describe(rules, d.reasons[0], lang) : t(lang, 'phone.allclear');
      toast.innerHTML = `${icon(d.reasons[0]?.code === 'POWER_LOSS' ? power : d.state === 'REUSE' ? verified : alert)}<div><strong>WAREVA · ${esc(rules.states[d.state][lang])}</strong><span>${esc(text)}</span></div><time>${t(lang, 'phone.now_word')}</time>`;
      toast.dataset.tone = tone;
      toast.hidden = false;
      toast.classList.remove('is-in');
      void toast.offsetWidth;
      toast.classList.add('is-in');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove('is-in'), 5200);
    },
  };
}

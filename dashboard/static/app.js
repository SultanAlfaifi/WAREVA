// WAREVA dashboard. Reads /api/state every second and renders it with the brand components.
// It never decides anything: the state, reasons and valve command come from the safety controller.

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (v, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '—');

const STATES = {
  REUSE: { cls: 'reuse', icon: 'verified' },
  HOLD: { cls: 'hold', icon: 'alert' },
  STANDBY: { cls: 'standby', icon: 'standby' },
  BACKWASH: { cls: 'backwash', icon: 'backwash' },
};
const FAULTS = [
  ['none', 'تشغيل اعتيادي'], ['turbidity', 'ارتفاع العكارة'], ['sensor_dropout', 'فقد قراءة الكلور'],
  ['clogging', 'انسداد المرشح'], ['power_loss', 'انقطاع الكهرباء'], ['valve_stuck', 'تعطل صمام الري'],
];
const SEVERITY = { info: 'معلومة', warning: 'تنبيه', critical: 'حرج' };

let rules, icons = {}, current;

async function loadIcons() {
  const names = ['verified', 'alert', 'standby', 'backwash', 'valve', 'power', 'gauge', 'drop'];
  await Promise.all(names.map(async n => {
    const svg = await (await fetch(`/brand/icons/${n}.svg`)).text();
    icons[n] = svg.replace('<svg ', '<svg class="wv-icon" aria-hidden="true" ');
  }));
}

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json()).error);
  return res.json();
}

// Sensor cards: scale and allowed band per sensor, limits from rules.json.
function sensorSpecs() {
  const L = rules.limits;
  return [
    { key: 'turbidity', max: 10, lo: 0, hi: L.turbidity_max_ntu, limit: `≤ ${L.turbidity_max_ntu}` },
    { key: 'ph', max: 14, lo: L.ph_min, hi: L.ph_max, limit: `${L.ph_min} – ${L.ph_max}` },
    { key: 'chlorine', max: 1, lo: L.chlorine_min_mg_l, hi: L.chlorine_max_mg_l, limit: `${L.chlorine_min_mg_l} – ${L.chlorine_max_mg_l}` },
    { key: 'filter_dp', label: 'فرق ضغط المرشح', unit: 'bar', max: 2, lo: 0, hi: L.filter_dp_max_bar, limit: `≤ ${L.filter_dp_max_bar}` },
    { key: 'treated_level_percent', max: 100, lo: L.treated_level_min_percent, hi: 100, limit: `≥ ${L.treated_level_min_percent}`, digits: 0 },
    { key: 'flow_lpm', max: 30, digits: 1, limit: 'للتسجيل' },
    { key: 'orp', max: 1000, digits: 0, limit: 'للعرض' },
  ];
}

function sensorCard(spec, readings) {
  const meta = rules.sensors[spec.key] ?? {};
  const value = spec.key === 'filter_dp'
    ? (Number.isFinite(readings.p1) && Number.isFinite(readings.p2) ? readings.p1 - readings.p2 : null)
    : readings[spec.key];
  const missing = typeof value !== 'number';
  const hasBand = spec.hi !== undefined;
  const out = !missing && hasBand && (value < spec.lo || value > spec.hi);
  const state = missing ? 'missing' : out ? 'out' : 'ok';
  const pct = v => `${Math.max(0, Math.min(100, (v / spec.max) * 100))}%`;
  const note = missing ? `${icons.alert}لا توجد قراءة` : out ? `${icons.alert}خارج الحد` : hasBand ? `${icons.verified}ضمن الحد` : `${icons.gauge}قراءة مسجلة`;
  return `<article class="wv-sensor" data-state="${state}">
    <header class="wv-sensor__head"><span class="wv-sensor__name">${esc(spec.label ?? meta.ar)}</span><span class="wv-sensor__limit">${esc(spec.limit)}</span></header>
    <p class="wv-sensor__value"><bdi>${missing ? '—' : num(value, spec.digits ?? 2)}</bdi> <span class="wv-sensor__unit">${esc(spec.unit ?? meta.unit)}</span></p>
    <div class="wv-sensor__bar">${hasBand ? `<span class="wv-sensor__band" style="--lo:${pct(spec.lo)};--hi:${pct(spec.hi)}"></span>` : ''}${missing ? '' : `<span class="wv-sensor__dot" style="--at:${pct(value)}"></span>`}</div>
    <p class="wv-sensor__note">${note}</p>
  </article>`;
}

function render(st) {
  current = st;
  const snap = st.snapshot;
  document.querySelectorAll('#source button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.source === st.source)));
  $('#controls').hidden = st.source !== 'twin';

  const notice = $('#notice');
  if (st.source === 'device' && st.stale) {
    notice.hidden = false;
    notice.textContent = snap ? 'لم تصل قراءة من الجهاز منذ أكثر من 10 ثوانٍ. آخر حالة معروضة أدناه، وصمام الري يُفترض مغلقًا حتى يعود الاتصال.' : 'لا يوجد اتصال بالجهاز بعد. شغّل البوابة على Raspberry Pi، أو عُد إلى التوأم الرقمي.';
  } else notice.hidden = true;
  if (!snap) { $('#status').innerHTML = ''; $('#reasons').innerHTML = ''; return; }

  const d = snap.decision, s = STATES[d.state];
  $('#clock').textContent = `${snap.time.replace('T', ' ').replace('Z', ' UTC')}${st.source === 'twin' ? ' · محاكاة' : ''}`;
  $('#status').innerHTML = `<span class="wv-status wv-status--${s.cls} wv-status--lg">${icons[s.icon]}${esc(rules.states[d.state].ar)} <span class="wv-status__code">${d.state}</span></span>`;
  $('#reasons').innerHTML = d.reasons.length
    ? d.reasons.map(r => {
      const sev = rules.reasons[r.code].severity;
      const kind = sev === 'critical' ? 'critical' : sev === 'warning' ? 'hold' : 'info';
      const icon = r.code === 'POWER_LOSS' ? icons.power : r.code === 'BACKWASH_MODE' ? icons.backwash : kind === 'info' ? icons.standby : icons.alert;
      return `<li class="wv-reason" data-kind="${kind}">${icon}<code>${esc(r.code)}</code><span>${esc(r.text)}</span></li>`;
    }).join('')
    : `<li class="wv-reason" data-kind="ok">${icons.verified}<code>ALL_CLEAR</code><span>كل القراءات ضمن الحدود؛ الري مسموح.</span></li>`;

  const v = snap.valve, fb = v.feedback, match = !fb || fb === (v.command === 'open' ? 'open' : 'closed');
  const word = x => ({ open: 'مفتوح', closed: 'مغلق' })[x] ?? 'غير معروف';
  $('#valve').innerHTML = `<div class="wv-valve" data-match="${match && !d.latched?.includes('VALVE_MISMATCH')}">${icons.valve}
    <div><dl><div><dt>أمر المتحكم</dt><dd>${v.command === 'open' ? 'فتح' : 'إغلاق'}</dd></div><div><dt>الموضع المقاس</dt><dd>${word(fb)}</dd></div></dl>
    <p class="wv-valve__alert">${icons.alert}تعارض: الصمام لا يطابق الأمر</p></div></div>`;

  $('#sensors').innerHTML = sensorSpecs().map(spec => sensorCard(spec, snap.readings)).join('');

  const tanks = snap.tanks;
  $('#tanks').innerHTML = tanks ? [['raw', 'خزان الماء الخام'], ['treated', 'الخزان المعالج']].map(([k, name]) => `
    <div class="tank"><span class="tank__name">${name}</span>
      <div class="tank__body" role="img" aria-label="${name}: ${num(tanks[k].liters, 0)} لتر"><div class="tank__water" style="height:${tanks[k].percent}%"></div></div>
      <span class="tank__value"><bdi>${num(tanks[k].liters, 0)}</bdi> L</span></div>`).join('') : '';
  const vol = snap.volumes_l ?? {};
  const totals = [['ماء ذهب للري', vol.irrigated], ['عولج', vol.treated], ['فائض للصرف', vol.overflow], ['غسيل عكسي', vol.backwash]].filter(([, x]) => x !== undefined);
  $('#totals').innerHTML = totals.map(([k, x]) => `<div><dt>${k}</dt><dd><bdi>${num(x, 1)}</bdi> L</dd></div>`).join('');

  if (st.source === 'twin') {
    document.querySelectorAll('#faults button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fault === snap.fault)));
    document.querySelectorAll('#mode button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === snap.mode)));
    document.querySelectorAll('#speed button').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.speed) === st.speed)));
    $('#run').textContent = st.running ? 'إيقاف المحاكاة مؤقتًا' : 'متابعة المحاكاة';
    $('#hold').textContent = snap.manual_hold ? 'إلغاء الإيقاف اليدوي' : 'إيقاف يدوي';
    $('#reset').disabled = !d.latched?.length;
  }
}

async function renderEvents() {
  const events = await (await fetch('/api/events')).json();
  $('#events').innerHTML = events.map(e => `<li class="wv-event" data-severity="${e.severity}" data-acknowledged="${Boolean(e.acknowledged_at)}">
    <time class="wv-event__time">${esc(e.time.slice(11, 19))}</time>
    <span class="wv-event__sev">${SEVERITY[e.severity]}</span>
    <div class="wv-event__body"><strong>${esc(rules.states[e.state]?.ar ?? e.state)}</strong><p>${esc(e.message)}</p></div>
    ${e.acknowledged_at ? '<span class="wv-event__time">تمت المراجعة</span>' : `<button class="wv-btn wv-btn--ghost" type="button" data-ack="${e.id}">تم الاطلاع</button>`}
  </li>`).join('');
}

async function refresh() {
  try {
    render(await (await fetch('/api/state')).json());
  } catch {
    const notice = $('#notice');
    notice.hidden = false;
    notice.textContent = 'انقطع الاتصال بخادم اللوحة. تأكد أنه يعمل ثم أعد تحميل الصفحة.';
  }
}

async function control(body) {
  try { render(await post('/api/control', body)); } catch (err) { alertNotice(err.message); }
}
function alertNotice(text) { const n = $('#notice'); n.hidden = false; n.textContent = text; }

function wire() {
  $('#faults').innerHTML = FAULTS.map(([key, label]) => `<button type="button" data-fault="${key}" aria-pressed="false">${label}</button>`).join('');
  $('#faults').addEventListener('click', e => { const b = e.target.closest('button'); if (b) control({ fault: b.dataset.fault }); });
  $('#mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) control({ mode: b.dataset.mode }); });
  $('#speed').addEventListener('click', e => { const b = e.target.closest('button'); if (b) control({ speed: Number(b.dataset.speed) }); });
  $('#source').addEventListener('click', e => { const b = e.target.closest('button'); if (b) control({ source: b.dataset.source }); });
  $('#run').addEventListener('click', () => control({ running: !current.running }));
  $('#hold').addEventListener('click', () => control({ manual_hold: !current.snapshot.manual_hold }));
  $('#reset').addEventListener('click', () => control({ reset: true }));
  $('#events').addEventListener('click', async e => {
    const b = e.target.closest('[data-ack]');
    if (b) { await post(`/api/events/${b.dataset.ack}/ack`, {}); renderEvents(); }
  });
}

rules = await (await fetch('/api/rules')).json();
await loadIcons();
wire();
await refresh();
renderEvents();
setInterval(refresh, 1000);
setInterval(renderEvents, 3000);

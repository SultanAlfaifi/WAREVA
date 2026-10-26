// WAREVA safety controller for the browser. Same algorithm as core/decide.py;
// both must pass core/vectors.json. The caller passes the parsed rules.json.

const MODES = ['auto', 'standby', 'backwash'];
const present = v => typeof v === 'number' && Number.isFinite(v);

export class SafetyController {
  constructor(rules) {
    this.limits = rules.limits;
    this.required = rules.required_sensors;
    this.command = 'closed';
    this.sinceS = 0;
    this.latched = [];
  }

  step(inputs) {
    const lim = this.limits;
    const mode = inputs.mode ?? 'auto';
    if (!MODES.includes(mode)) throw new RangeError(`unknown mode: ${mode}`);
    const r = inputs.readings ?? {};
    if (inputs.reset) this.latched = [];
    this.sinceS += Number(inputs.dt_s ?? 0);

    // Valve supervision uses the command that was in force during the elapsed time.
    // Without power the normally-closed valve shuts by itself, so there is nothing to supervise.
    const power = inputs.power ?? true;
    const feedback = inputs.valve_feedback ?? null;
    if (power && this.sinceS >= lim.valve_settle_s) {
      const positionWrong = feedback !== null && feedback !== this.command;
      const flowingWhileClosed = this.command === 'closed' && present(r.flow_lpm) && r.flow_lpm > lim.closed_flow_max_lpm;
      if ((positionWrong || flowingWhileClosed) && !this.latched.includes('VALVE_MISMATCH')) this.latched.push('VALVE_MISMATCH');
    }

    const reasons = [];
    const add = (code, detail = {}) => reasons.push({ code, ...detail });
    if (!power) add('POWER_LOSS');
    if (inputs.manual_hold) add('MANUAL_HOLD');
    for (const code of this.latched) add(code);

    // Power loss and manual hold stop everything; a latched fault still lets the
    // readings be checked so the operator sees every active reason.
    let state;
    if (!power || inputs.manual_hold) {
      state = 'HOLD';
    } else if (mode === 'standby') {
      add('STANDBY_MODE');
      state = this.latched.length ? 'HOLD' : 'STANDBY';
    } else {
      const level = r.treated_level_percent;
      if (present(level) && level < lim.treated_level_min_percent) add('TREATED_TANK_LOW', { value: level, limit: lim.treated_level_min_percent });
      if (mode === 'backwash') {
        if (!reasons.length) { add('BACKWASH_MODE'); state = 'BACKWASH'; } else state = 'HOLD';
      } else {
        this.#checkReadings(r, feedback, add);
        state = reasons.length ? 'HOLD' : 'REUSE';
      }
    }

    const newCommand = state === 'REUSE' ? 'open' : 'closed';
    if (newCommand !== this.command) { this.command = newCommand; this.sinceS = 0; }
    return { state, valve_command: this.command, irrigation_pump: state === 'REUSE' ? 'on' : 'off', reasons, latched: [...this.latched] };
  }

  #checkReadings(r, feedback, add) {
    const lim = this.limits;
    for (const sensor of this.required) if (!present(r[sensor])) add('SENSOR_MISSING', { sensor });
    if (feedback !== 'open' && feedback !== 'closed') add('SENSOR_MISSING', { sensor: 'valve_position' });
    const ok = k => present(r[k]);
    if (ok('turbidity') && r.turbidity > lim.turbidity_max_ntu) add('TURBIDITY_HIGH', { value: r.turbidity, limit: lim.turbidity_max_ntu });
    if (ok('ph') && !(lim.ph_min <= r.ph && r.ph <= lim.ph_max)) add('PH_OUT_OF_RANGE', { value: r.ph, limit: `${lim.ph_min}–${lim.ph_max}` });
    if (ok('chlorine') && !(lim.chlorine_min_mg_l <= r.chlorine && r.chlorine <= lim.chlorine_max_mg_l)) {
      add('CHLORINE_OUT_OF_RANGE', { value: r.chlorine, limit: `${lim.chlorine_min_mg_l}–${lim.chlorine_max_mg_l}` });
    }
    if (ok('p1') && ok('p2') && r.p1 - r.p2 > lim.filter_dp_max_bar) add('FILTER_DP_HIGH', { value: Math.round((r.p1 - r.p2) * 1000) / 1000, limit: lim.filter_dp_max_bar });
    const pressures = ['p1', 'p2'].filter(ok).map(k => r[k]);
    const line = pressures.length ? Math.max(...pressures) : null;
    if (line !== null && line > lim.line_pressure_max_bar) add('LINE_PRESSURE_HIGH', { value: line, limit: lim.line_pressure_max_bar });
  }
}

// Render a reason as the sentence from rules.json, with its values filled in.
export function describe(rules, reason, lang = 'ar') {
  const label = reason.sensor ? rules.sensors[reason.sensor][lang] : '';
  const fmt = v => (typeof v === 'number' ? String(Math.round(v * 100) / 100) : v ?? '');
  return rules.reasons[reason.code][lang]
    .replace('{sensor}', label)
    .replace('{value}', fmt(reason.value))
    .replace('{limit}', fmt(reason.limit));
}

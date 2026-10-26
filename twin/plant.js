// Browser copy of twin/plant.py. Must reproduce twin/trace.json.
import { SafetyController, describe } from '../core/decide.js';

export const CAPACITY_L = 5000;
const INLET_LPM = 1000 / 60, FEED_LPM = 1000 / 60, IRRIGATION_LPM = 1000 / 60, BACKWASH_LPM = 65;
const VALVE_TRAVEL_S = 2, MAX_STEP_S = 60;
export const FAULTS = ['none', 'turbidity', 'sensor_dropout', 'clogging', 'power_loss', 'valve_stuck'];
export const MODES = ['auto', 'standby', 'backwash'];
const SENSORS = ['turbidity', 'ph', 'chlorine', 'orp', 'p1', 'p2', 'treated_level_percent', 'flow_lpm'];

export class Plant {
  constructor(rules, start = '2026-10-26T06:00:00Z') {
    this.rules = rules;
    this.start = Date.parse(start);
    this.elapsedS = 0;
    this.rawL = 3000; this.treatedL = 2000; this.initialL = 5000;
    this.valveOpening = 0;
    this.mode = 'auto'; this.fault = 'none'; this.manualHold = false;
    this.resetRequested = false;
    this.controller = new SafetyController(rules);
    this.flows = { inlet: 0, feed: 0, irrigation: 0, backwash: 0, overflow: 0 };
    this.volumes = { inlet: 0, treated: 0, irrigated: 0, overflow: 0, backwash: 0 };
    // Start from steady operation: the first decision is taken and the valve has already moved to it.
    this.decision = this.controller.step(this.#inputs(0));
    this.valveOpening = this.decision.valve_command === 'open' ? 1 : 0;
    this.readings = this.#sensors();
  }

  setFault(fault) { if (!FAULTS.includes(fault)) throw new RangeError(`unknown fault: ${fault}`); this.fault = fault; }
  setMode(mode) { if (!MODES.includes(mode)) throw new RangeError(`unknown mode: ${mode}`); this.mode = mode; }
  setManualHold(hold) { this.manualHold = Boolean(hold); }
  reset() { this.resetRequested = true; }
  get power() { return this.fault !== 'power_loss'; }

  #sensors() {
    if (!this.power) return Object.fromEntries(SENSORS.map(k => [k, null]));
    const t = this.elapsedS, wave = Math.sin(t / 600), feeding = this.flows.feed > 0;
    const r = {
      turbidity: 0.65 + 0.08 * wave,
      ph: 7.2 + 0.05 * Math.sin(t / 900),
      chlorine: 0.35 + 0.02 * Math.sin(t / 720),
      orp: 680 + 8 * Math.sin(t / 800),
      p1: feeding ? 2.8 + 0.03 * wave : 0,
      p2: feeding ? 2.55 + 0.03 * wave : 0,
      treated_level_percent: this.treatedL / CAPACITY_L * 100,
      flow_lpm: this.flows.irrigation,
    };
    if (this.fault === 'turbidity') r.turbidity = 8 + 0.2 * wave;
    if (this.fault === 'sensor_dropout') r.chlorine = null;
    if (this.fault === 'clogging' && feeding) { r.p1 = 2.9; r.p2 = 1.5; }
    return r;
  }

  #feedback() { return this.valveOpening > 0.5 ? 'open' : 'closed'; }

  #inputs(dtS) {
    const inputs = { dt_s: dtS, power: this.power, manual_hold: this.manualHold, mode: this.mode,
      reset: this.resetRequested, readings: this.#sensors(), valve_feedback: this.#feedback() };
    this.resetRequested = false;
    return inputs;
  }

  step(dtS) {
    if (!(dtS > 0 && dtS <= MAX_STEP_S)) throw new RangeError(`step must be in (0, ${MAX_STEP_S}] seconds`);
    const inputs = this.#inputs(dtS);
    this.readings = inputs.readings;
    const d = this.decision = this.controller.step(inputs);

    // The valve travels toward the command. Without power the spring closes it; the
    // valve_stuck fault jams it shut whatever the command says.
    const target = d.valve_command === 'open' && this.power ? 1 : 0;
    if (!this.power || this.fault === 'valve_stuck') this.valveOpening = 0;
    else {
      const move = dtS / VALVE_TRAVEL_S;
      this.valveOpening = target > this.valveOpening ? Math.min(target, this.valveOpening + move) : Math.max(target, this.valveOpening - move);
    }

    const minutes = dtS / 60;
    const inlet = INLET_LPM * minutes;
    const feeding = this.power && !this.manualHold && this.mode === 'auto';
    const feed = feeding ? Math.min(FEED_LPM * minutes, this.rawL + inlet, CAPACITY_L - this.treatedL) : 0;
    const backwash = d.state === 'BACKWASH' ? Math.min(BACKWASH_LPM * minutes, this.treatedL + feed) : 0;
    const irrigating = d.irrigation_pump === 'on' && this.valveOpening > 0.5;
    const irrigated = irrigating ? Math.min(IRRIGATION_LPM * minutes, this.treatedL + feed - backwash) : 0;
    const raw = this.rawL + inlet - feed;
    const overflow = Math.max(0, raw - CAPACITY_L);
    this.rawL = raw - overflow;
    this.treatedL = this.treatedL + feed - backwash - irrigated;

    const moved = { inlet, treated: feed, irrigated, overflow, backwash };
    for (const [k, v] of Object.entries(moved)) this.volumes[k] += v;
    this.flows = { inlet: inlet / minutes, feed: feed / minutes, irrigation: irrigated / minutes, backwash: backwash / minutes, overflow: overflow / minutes };
    this.elapsedS += dtS;
    this.#checkBalance();
    return this.snapshot();
  }

  #checkBalance() {
    const v = this.volumes;
    const error = this.initialL + v.inlet - this.rawL - this.treatedL - v.irrigated - v.overflow - v.backwash;
    if (Math.abs(error) > 1e-6 || this.rawL < -1e-9 || this.treatedL < -1e-9 || this.treatedL > CAPACITY_L + 1e-9) {
      throw new Error(`water balance broken by ${error} L`);
    }
  }

  snapshot() {
    const d = this.decision;
    return {
      source: 'twin',
      time: new Date(this.start + this.elapsedS * 1000).toISOString().replace('.000Z', 'Z'),
      elapsed_s: this.elapsedS,
      mode: this.mode, fault: this.fault, manual_hold: this.manualHold, power: this.power,
      readings: { ...this.readings },
      decision: { ...d, reasons: d.reasons.map(r => ({ ...r, text: describe(this.rules, r) })) },
      valve: { command: d.valve_command, feedback: this.#feedback(), opening: this.valveOpening },
      tanks: { raw: { liters: this.rawL, percent: this.rawL / CAPACITY_L * 100 }, treated: { liters: this.treatedL, percent: this.treatedL / CAPACITY_L * 100 } },
      flows_lpm: { ...this.flows },
      volumes_l: { ...this.volumes },
    };
  }
}

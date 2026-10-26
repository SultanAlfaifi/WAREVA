import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Plant } from './plant.js';

const load = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const rules = load('../core/rules.json');
const expected = load('./trace.json');

// Same scenario as SCENARIO in twin/plant.py.
const SCENARIO = [
  [30], [30], [30], [30],
  [10, 'fault', 'turbidity'], [10], [10], [10],
  [10, 'fault', 'none'], [10], [10],
  [5, 'fault', 'valve_stuck'], [5], [5],
  [5, 'fault', 'none'], [5, 'reset'], [5], [5],
  [20, 'fault', 'power_loss'], [20, 'fault', 'none'],
  [60, 'mode', 'backwash'], [60, 'mode', 'auto'],
  [30, 'fault', 'clogging'], [30, 'fault', 'sensor_dropout'],
  [30, 'hold', true], [30, 'hold', false], [30, 'fault', 'none'],
];

test('browser twin reproduces the Python trace', () => {
  const plant = new Plant(rules);
  assert.equal(SCENARIO.length, expected.length);
  SCENARIO.forEach(([dt, kind, value], i) => {
    if (kind === 'fault') plant.setFault(value);
    if (kind === 'mode') plant.setMode(value);
    if (kind === 'hold') plant.setManualHold(value);
    if (kind === 'reset') plant.reset();
    const s = plant.step(dt), want = expected[i], where = `step ${i + 1}`;
    assert.equal(s.decision.state, want.state, where);
    assert.deepEqual(s.decision.reasons.map(r => r.code), want.codes, where);
    assert.equal(s.valve.feedback, want.valve, where);
    for (const [got, exp] of [[s.tanks.raw.liters, want.raw_l], [s.tanks.treated.liters, want.treated_l], [s.volumes_l.irrigated, want.irrigated_l]]) {
      assert.ok(Math.abs(got - exp) < 1e-6, `${where}: ${got} vs ${exp}`);
    }
  });
});

test('reason text is attached for the UI', () => {
  const plant = new Plant(rules);
  plant.setFault('turbidity');
  const s = plant.step(10);
  assert.match(s.decision.reasons[0].text, /^العكارة 8(\.\d{1,2})? NTU تتجاوز الحد 2 NTU/);
});

test('invalid controls are rejected', () => {
  const plant = new Plant(rules);
  assert.throws(() => plant.setFault('flood'), RangeError);
  assert.throws(() => plant.step(0), RangeError);
  assert.throws(() => plant.step(61), RangeError);
});

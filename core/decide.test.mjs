import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SafetyController, describe } from './decide.js';

const load = name => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'));
const rules = load('./rules.json');
const vectors = load('./vectors.json');
const merge = (d, o) => ({ ...d, ...o, readings: { ...d.readings, ...(o.readings ?? {}) } });
const codes = out => out.reasons.map(r => r.code + (r.sensor ? `:${r.sensor}` : ''));

for (const c of vectors.cases) {
  test(c.name, () => {
    const controller = new SafetyController(rules);
    c.steps.forEach((step, i) => {
      const out = controller.step(merge(vectors.defaults, step.in));
      const want = step.expect;
      const where = `${c.name}, step ${i + 1}`;
      assert.equal(out.state, want.state, where);
      assert.equal(out.valve_command, want.valve_command, where);
      assert.deepEqual(codes(out), want.codes, where);
      if (want.latched) assert.deepEqual(out.latched, want.latched, where);
      assert.equal(out.irrigation_pump, want.state === 'REUSE' ? 'on' : 'off', where);
    });
  });
}

test('describe fills values the same way as Python', () => {
  assert.equal(describe(rules, { code: 'TURBIDITY_HIGH', value: 8.14, limit: 2.0 }), 'العكارة 8.14 NTU تتجاوز الحد 2 NTU؛ الري متوقف والماء محتجز.');
});

test('unknown mode is rejected', () => {
  assert.throws(() => new SafetyController(rules).step({ mode: 'turbo' }), RangeError);
});

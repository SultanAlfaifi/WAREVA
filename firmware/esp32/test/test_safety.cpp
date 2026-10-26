// Runs core/vectors.json (via the generated vectors.h) against the firmware controller on a PC:
//   g++ -std=c++17 -Iinclude -Itest test/test_safety.cpp -o test_safety && ./test_safety
#include <cstdio>
#include <cstring>
#include <string>

#include "safety.h"
#include "vectors.h"

using namespace wareva;

static std::string reason_text(const Reason& r) {
  std::string s = code_name(r.code);
  if (r.sensor != Sensor::None) s += std::string(":") + sensor_name(r.sensor);
  return s;
}

int main() {
  int failures = 0, steps = 0;
  for (const VectorCase& c : VECTOR_CASES) {
    SafetyController controller;
    for (int i = 0; i < c.nsteps; ++i, ++steps) {
      const VectorStep& s = c.steps[i];
      Decision d = controller.step(s.in);
      bool ok = std::strcmp(state_name(d.state), s.state) == 0 &&
                std::strcmp(d.valve_command == Valve::Open ? "open" : "closed", s.command) == 0 &&
                d.count == s.ncodes && d.irrigation_pump == (d.state == State::Reuse);
      for (int k = 0; ok && k < s.ncodes; ++k) ok = reason_text(d.reasons[k]) == s.codes[k];
      if (s.latched >= 0) ok = ok && d.mismatch_latched == (s.latched == 1);
      if (!ok) {
        ++failures;
        std::printf("FAIL %s, step %d: got %s/%s with %d reasons\n", c.name, i + 1, state_name(d.state),
                    d.valve_command == Valve::Open ? "open" : "closed", d.count);
      }
    }
  }
  std::printf("%d steps, %d failures\n", steps, failures);
  return failures ? 1 : 0;
}

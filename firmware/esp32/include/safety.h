#pragma once
// WAREVA safety controller for the ESP32. Same algorithm as core/decide.py and core/decide.js;
// all three must pass core/vectors.json (test/test_safety.cpp). Limits come from the generated rules.h.
// No Arduino dependencies, so it compiles and is tested on a PC as well.
#include <cmath>
#include <cstdint>

#include "rules.h"

namespace wareva {

enum class Mode : uint8_t { Auto, Standby, Backwash };
enum class Valve : uint8_t { Closed, Open, Unknown };
enum class State : uint8_t { Reuse, Hold, Standby, Backwash };
enum class Code : uint8_t {
  PowerLoss, ManualHold, ValveMismatch, StandbyMode, BackwashMode, TreatedTankLow,
  SensorMissing, TurbidityHigh, PhOutOfRange, ChlorineOutOfRange, FilterDpHigh, LinePressureHigh
};
enum class Sensor : uint8_t { None, Turbidity, Ph, Chlorine, P1, P2, TreatedLevel, Flow, ValvePosition };

// NAN means "no reading". A missing value is never replaced by a default.
struct Readings {
  double turbidity, ph, chlorine, orp, p1, p2, treated_level_percent, flow_lpm;
};

struct Inputs {
  double dt_s;
  bool power;
  bool manual_hold;
  Mode mode;
  bool reset;
  Readings r;
  Valve valve_feedback;
};

struct Reason {
  Code code;
  Sensor sensor;
  double value;
};

struct Decision {
  State state;
  Valve valve_command;
  bool irrigation_pump;
  Reason reasons[16];
  uint8_t count;
  bool mismatch_latched;
};

inline bool present(double v) { return std::isfinite(v); }

inline const char* code_name(Code c) {
  static const char* names[] = {"POWER_LOSS", "MANUAL_HOLD", "VALVE_MISMATCH", "STANDBY_MODE", "BACKWASH_MODE",
                                "TREATED_TANK_LOW", "SENSOR_MISSING", "TURBIDITY_HIGH", "PH_OUT_OF_RANGE",
                                "CHLORINE_OUT_OF_RANGE", "FILTER_DP_HIGH", "LINE_PRESSURE_HIGH"};
  return names[static_cast<uint8_t>(c)];
}

inline const char* sensor_name(Sensor s) {
  static const char* names[] = {"", "turbidity", "ph", "chlorine", "p1", "p2", "treated_level_percent", "flow_lpm", "valve_position"};
  return names[static_cast<uint8_t>(s)];
}

inline const char* state_name(State s) {
  static const char* names[] = {"REUSE", "HOLD", "STANDBY", "BACKWASH"};
  return names[static_cast<uint8_t>(s)];
}

class SafetyController {
 public:
  // Advance by in.dt_s seconds and return the decision for this tick.
  Decision step(const Inputs& in) {
    Decision d{};
    if (in.reset) latched_ = false;
    since_s_ += in.dt_s;

    // Valve supervision uses the command that was in force during the elapsed time.
    // Without power the normally-closed valve shuts by itself, so there is nothing to supervise.
    if (in.power && since_s_ >= rules::VALVE_SETTLE_S) {
      bool position_wrong = in.valve_feedback != Valve::Unknown && in.valve_feedback != command_;
      bool flowing_while_closed = command_ == Valve::Closed && present(in.r.flow_lpm) && in.r.flow_lpm > rules::CLOSED_FLOW_MAX_LPM;
      if (position_wrong || flowing_while_closed) latched_ = true;
    }

    if (!in.power) add(d, Code::PowerLoss);
    if (in.manual_hold) add(d, Code::ManualHold);
    if (latched_) add(d, Code::ValveMismatch);

    // Power loss and manual hold stop everything; a latched fault still lets the
    // readings be checked so the operator sees every active reason.
    if (!in.power || in.manual_hold) {
      d.state = State::Hold;
    } else if (in.mode == Mode::Standby) {
      add(d, Code::StandbyMode);
      d.state = latched_ ? State::Hold : State::Standby;
    } else {
      double level = in.r.treated_level_percent;
      if (present(level) && level < rules::TREATED_LEVEL_MIN_PERCENT) add(d, Code::TreatedTankLow, Sensor::None, level);
      if (in.mode == Mode::Backwash) {
        if (d.count == 0) {
          add(d, Code::BackwashMode);
          d.state = State::Backwash;
        } else {
          d.state = State::Hold;
        }
      } else {
        check_readings(in, d);
        d.state = d.count ? State::Hold : State::Reuse;
      }
    }

    Valve next = d.state == State::Reuse ? Valve::Open : Valve::Closed;
    if (next != command_) {
      command_ = next;
      since_s_ = 0;
    }
    d.valve_command = command_;
    d.irrigation_pump = d.state == State::Reuse;
    d.mismatch_latched = latched_;
    return d;
  }

 private:
  Valve command_ = Valve::Closed;
  double since_s_ = 0;
  bool latched_ = false;

  static void add(Decision& d, Code code, Sensor sensor = Sensor::None, double value = NAN) {
    if (d.count < 16) d.reasons[d.count++] = Reason{code, sensor, value};
  }

  static double reading(const Readings& r, Sensor s) {
    switch (s) {
      case Sensor::Turbidity: return r.turbidity;
      case Sensor::Ph: return r.ph;
      case Sensor::Chlorine: return r.chlorine;
      case Sensor::P1: return r.p1;
      case Sensor::P2: return r.p2;
      case Sensor::TreatedLevel: return r.treated_level_percent;
      case Sensor::Flow: return r.flow_lpm;
      default: return NAN;
    }
  }

  static void check_readings(const Inputs& in, Decision& d) {
    const Readings& r = in.r;
#define WAREVA_CHECK_PRESENT(name) \
    if (!present(reading(r, Sensor::name))) add(d, Code::SensorMissing, Sensor::name);
    WAREVA_REQUIRED_SENSORS(WAREVA_CHECK_PRESENT)
#undef WAREVA_CHECK_PRESENT
    if (in.valve_feedback == Valve::Unknown) add(d, Code::SensorMissing, Sensor::ValvePosition);
    if (present(r.turbidity) && r.turbidity > rules::TURBIDITY_MAX_NTU) add(d, Code::TurbidityHigh, Sensor::None, r.turbidity);
    if (present(r.ph) && !(rules::PH_MIN <= r.ph && r.ph <= rules::PH_MAX)) add(d, Code::PhOutOfRange, Sensor::None, r.ph);
    if (present(r.chlorine) && !(rules::CHLORINE_MIN_MG_L <= r.chlorine && r.chlorine <= rules::CHLORINE_MAX_MG_L)) {
      add(d, Code::ChlorineOutOfRange, Sensor::None, r.chlorine);
    }
    if (present(r.p1) && present(r.p2) && r.p1 - r.p2 > rules::FILTER_DP_MAX_BAR) add(d, Code::FilterDpHigh, Sensor::None, r.p1 - r.p2);
    double line = NAN;
    if (present(r.p1)) line = r.p1;
    if (present(r.p2) && (!present(line) || r.p2 > line)) line = r.p2;
    if (present(line) && line > rules::LINE_PRESSURE_MAX_BAR) add(d, Code::LinePressureHigh, Sensor::None, line);
  }
};

}  // namespace wareva

// Generated from core/rules.json by core/gen_rules_h.py. Do not edit.

#pragma once
#include "safety.h"

namespace wareva {

struct VectorStep { Inputs in; const char* state; const char* command; const char* codes[8]; int ncodes; int latched; };
struct VectorCase { const char* name; VectorStep steps[6]; int nsteps; };

// latched: -1 = not checked, 0 = nothing latched, 1 = VALVE_MISMATCH latched
static const VectorCase VECTOR_CASES[] = {
  {"all readings within limits", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"turbidity exactly at the limit", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{2.0, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"turbidity just above the limit", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{2.01, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"TURBIDITY_HIGH"}, 1, -1}}, 1},
  {"turbidity contamination", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{8.14, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"TURBIDITY_HIGH"}, 1, -1}}, 1},
  {"pH at lower limit", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 6.5, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"pH below range", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 6.49, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"PH_OUT_OF_RANGE"}, 1, -1}}, 1},
  {"pH above range", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 8.51, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"PH_OUT_OF_RANGE"}, 1, -1}}, 1},
  {"chlorine at lower limit", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.2, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"chlorine at upper limit", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.5, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"chlorine lost", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.19, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"CHLORINE_OUT_OF_RANGE"}, 1, -1}}, 1},
  {"chlorine overdosed", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.51, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"CHLORINE_OUT_OF_RANGE"}, 1, -1}}, 1},
  {"chlorine sensor dropout", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, NAN, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"SENSOR_MISSING:chlorine"}, 1, -1}}, 1},
  {"turbidity sensor dropout", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{NAN, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"SENSOR_MISSING:turbidity"}, 1, -1}}, 1},
  {"flow sensor dropout", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, NAN}, Valve::Closed}, "HOLD", "closed", {"SENSOR_MISSING:flow_lpm"}, 1, -1}}, 1},
  {"valve position unknown", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Unknown}, "HOLD", "closed", {"SENSOR_MISSING:valve_position"}, 1, -1}}, 1},
  {"ORP missing does not block (display only)", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, NAN, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"filter pressure drop acceptable", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 1.95, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"clogged filter", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.9, 1.5, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"FILTER_DP_HIGH"}, 1, -1}}, 1},
  {"line overpressure", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 5.2, 4.9, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"LINE_PRESSURE_HIGH"}, 1, -1}}, 1},
  {"treated tank at minimum level", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 10.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 1},
  {"treated tank too low", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 9.9, 0.0}, Valve::Closed}, "HOLD", "closed", {"TREATED_TANK_LOW"}, 1, -1}}, 1},
  {"several faults reported in fixed order", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{8.0, 7.2, NAN, 680.0, 2.9, 1.5, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"SENSOR_MISSING:chlorine", "TURBIDITY_HIGH", "FILTER_DP_HIGH"}, 3, -1}}, 1},
  {"power loss hides sensor checks", {{Inputs{1.0, false, false, Mode::Auto, false, Readings{9.0, 7.2, NAN, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"POWER_LOSS"}, 1, -1}}, 1},
  {"manual hold", {{Inputs{1.0, true, true, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"MANUAL_HOLD"}, 1, -1}}, 1},
  {"power loss and manual hold together", {{Inputs{1.0, false, true, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"POWER_LOSS", "MANUAL_HOLD"}, 2, -1}}, 1},
  {"standby", {{Inputs{1.0, true, false, Mode::Standby, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "STANDBY", "closed", {"STANDBY_MODE"}, 1, -1}}, 1},
  {"backwash", {{Inputs{1.0, true, false, Mode::Backwash, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "BACKWASH", "closed", {"BACKWASH_MODE"}, 1, -1}}, 1},
  {"backwash refused with low treated tank", {{Inputs{1.0, true, false, Mode::Backwash, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 5.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"TREATED_TANK_LOW"}, 1, -1}}, 1},
  {"valve opens normally within settle time", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}, {Inputs{5.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Open}, "REUSE", "open", {nullptr}, 0, -1}, {Inputs{60.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 16.7}, Valve::Open}, "REUSE", "open", {nullptr}, 0, -1}}, 3},
  {"valve stuck closed latches until reset", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}, {Inputs{2.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}, {Inputs{3.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"VALVE_MISMATCH"}, 1, 1}, {Inputs{10.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"VALVE_MISMATCH"}, 1, -1}, {Inputs{1.0, true, false, Mode::Auto, true, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, 0}}, 5},
  {"valve stuck open while water is held", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{8.0, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Open}, "HOLD", "closed", {"TURBIDITY_HIGH"}, 1, -1}, {Inputs{5.0, true, false, Mode::Auto, false, Readings{8.0, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Open}, "HOLD", "closed", {"VALVE_MISMATCH", "TURBIDITY_HIGH"}, 2, -1}}, 2},
  {"water flowing through a closed valve", {{Inputs{6.0, true, false, Mode::Auto, false, Readings{8.0, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 3.0}, Valve::Closed}, "HOLD", "closed", {"VALVE_MISMATCH", "TURBIDITY_HIGH"}, 2, -1}}, 1},
  {"small residual flow through a closed valve is tolerated", {{Inputs{6.0, true, false, Mode::Auto, false, Readings{8.0, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.4}, Valve::Closed}, "HOLD", "closed", {"TURBIDITY_HIGH"}, 1, -1}}, 1},
  {"power loss closes the valve without latching a mismatch", {{Inputs{1.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}, {Inputs{10.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Open}, "REUSE", "open", {nullptr}, 0, -1}, {Inputs{30.0, false, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"POWER_LOSS"}, 1, 0}, {Inputs{2.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "REUSE", "open", {nullptr}, 0, -1}}, 4},
  {"reset does not override a live fault", {{Inputs{6.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 3.0}, Valve::Closed}, "HOLD", "closed", {"VALVE_MISMATCH"}, 1, -1}, {Inputs{1.0, true, false, Mode::Auto, true, Readings{5.0, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"TURBIDITY_HIGH"}, 1, 0}}, 2},
  {"manual hold during a latched fault keeps both", {{Inputs{6.0, true, false, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 3.0}, Valve::Closed}, "HOLD", "closed", {"VALVE_MISMATCH"}, 1, -1}, {Inputs{1.0, true, true, Mode::Auto, false, Readings{0.7, 7.2, 0.35, 680.0, 2.8, 2.55, 40.0, 0.0}, Valve::Closed}, "HOLD", "closed", {"MANUAL_HOLD", "VALVE_MISMATCH"}, 2, -1}}, 2},
};

}  // namespace wareva

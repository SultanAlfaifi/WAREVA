// Generated from core/rules.json by core/gen_rules_h.py. Do not edit.

#pragma once

namespace wareva {
namespace rules {
constexpr double TURBIDITY_MAX_NTU = 2.0;
constexpr double PH_MIN = 6.5;
constexpr double PH_MAX = 8.5;
constexpr double CHLORINE_MIN_MG_L = 0.2;
constexpr double CHLORINE_MAX_MG_L = 0.5;
constexpr double FILTER_DP_MAX_BAR = 0.9;
constexpr double LINE_PRESSURE_MAX_BAR = 5.0;
constexpr double TREATED_LEVEL_MIN_PERCENT = 10.0;
constexpr double CLOSED_FLOW_MAX_LPM = 0.5;
constexpr double VALVE_SETTLE_S = 5.0;
}  // namespace rules
}  // namespace wareva

// Required sensors in rules.json order; SENSOR_MISSING reasons follow this order.
#define WAREVA_REQUIRED_SENSORS(X) X(Turbidity) X(Ph) X(Chlorine) X(P1) X(P2) X(TreatedLevel) X(Flow)

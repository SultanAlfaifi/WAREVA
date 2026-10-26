#pragma once
// Pin map and sensor calibration for the Rabigh prototype. The numbers below are
// starting points from sensor datasheets; replace them with bench calibration
// against reference instruments (see docs/prototype-plan.md) before any test.

namespace wareva {
namespace pins {
// Analog inputs (ADC1 except LEVEL, which uses ADC2; Wi-Fi stays off).
constexpr int TURBIDITY = 36;
constexpr int PH = 39;
constexpr int CHLORINE = 34;
constexpr int ORP = 35;
constexpr int P1 = 32;  // pressure before the media filter
constexpr int P2 = 33;  // pressure after the media filter
constexpr int LEVEL = 4;  // treated tank level transducer
// Digital inputs (active LOW, internal pull-ups).
constexpr int VALVE_OPEN_SWITCH = 18;
constexpr int VALVE_CLOSED_SWITCH = 19;
constexpr int MAINS_PRESENT = 21;  // LOW when mains is lost; the ESP32 itself runs on the UPS
constexpr int MANUAL_HOLD = 22;
constexpr int RESET_BUTTON = 23;   // reset after inspection is a physical button only
constexpr int FLOW_PULSES = 27;
// Outputs. Relays are off at boot, so the normally-closed valve stays shut.
constexpr int VALVE_RELAY = 25;
constexpr int IRRIGATION_PUMP_RELAY = 26;
}  // namespace pins

namespace cal {
constexpr double ADC_VOLTS = 3.3 / 4095.0;
// Linear sensor = slope * volts + offset. A voltage outside [min, max] means a disconnected or failed sensor.
struct Linear { double slope, offset, min_v, max_v; };
constexpr Linear TURBIDITY_NTU{-1120.4, 3200.0, 0.2, 3.0};  // replace with a 2-point calibration
constexpr Linear PH{-5.70, 21.34, 0.3, 3.0};
constexpr Linear CHLORINE_MG_L{0.5, 0.0, 0.05, 3.0};
constexpr Linear ORP_MV{1000.0, -1000.0, 0.05, 3.2};
constexpr Linear PRESSURE_BAR{2.5, -1.25, 0.3, 3.0};  // 0.5-4.5 V transducer behind a 2:3 divider
constexpr Linear LEVEL_PERCENT{40.0, -20.0, 0.3, 3.0};
constexpr double FLOW_PULSES_PER_LITER = 450.0;
constexpr unsigned long VALVE_TRAVEL_MAX_MS = 5000;  // neither limit switch longer than this = position unknown
}  // namespace cal
}  // namespace wareva

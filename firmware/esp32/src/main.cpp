// WAREVA safety controller firmware for the ESP32 (Arduino framework).
// Every second: read the sensors, let SafetyController decide, drive the valve and pump relays,
// and print one JSON line for the Raspberry Pi gateway. The decision never depends on the Pi.
#include <Arduino.h>
#include <esp_random.h>
#include <esp_task_wdt.h>

#include "calibration.h"
#include "safety.h"

using namespace wareva;

static SafetyController controller;
static volatile uint32_t flow_pulses = 0;
static uint32_t boot_id = 0, seq = 0;
static double irrigated_l = 0;
static unsigned long last_tick_ms = 0;

static void IRAM_ATTR on_flow_pulse() { flow_pulses++; }

static double read_linear(int pin, const cal::Linear& c) {
  double volts = analogRead(pin) * cal::ADC_VOLTS;
  if (volts < c.min_v || volts > c.max_v) return NAN;  // disconnected or failed sensor: no value, not a guess
  return c.slope * volts + c.offset;
}

// Limit switches report open or closed. While the valve travels neither is active, so the last
// confirmed position is kept for up to VALVE_TRAVEL_MAX_MS; after that, or with both active, it is unknown.
static Valve read_valve() {
  static Valve last = Valve::Closed;
  static unsigned long neither_since = 0;
  bool open = digitalRead(pins::VALVE_OPEN_SWITCH) == LOW, closed = digitalRead(pins::VALVE_CLOSED_SWITCH) == LOW;
  if (open && closed) return Valve::Unknown;
  if (open || closed) {
    last = open ? Valve::Open : Valve::Closed;
    neither_since = 0;
    return last;
  }
  if (!neither_since) neither_since = millis();
  return millis() - neither_since > cal::VALVE_TRAVEL_MAX_MS ? Valve::Unknown : last;
}

static void print_number(const char* key, double v, bool comma = true) {
  if (std::isfinite(v)) Serial.printf("\"%s\":%.3f", key, v);
  else Serial.printf("\"%s\":null", key);
  if (comma) Serial.print(',');
}

static void report(const Readings& r, const Decision& d, Valve feedback) {
  Serial.printf("{\"device\":\"wareva-proto-1\",\"boot\":\"%08lx\",\"seq\":%lu,\"readings\":{", (unsigned long)boot_id, (unsigned long)seq++);
  print_number("turbidity", r.turbidity);
  print_number("ph", r.ph);
  print_number("chlorine", r.chlorine);
  print_number("orp", r.orp);
  print_number("p1", r.p1);
  print_number("p2", r.p2);
  print_number("treated_level_percent", r.treated_level_percent);
  print_number("flow_lpm", r.flow_lpm, false);
  Serial.printf("},\"decision\":{\"state\":\"%s\",\"valve_command\":\"%s\",\"valve_feedback\":%s,\"reasons\":[",
                state_name(d.state), d.valve_command == Valve::Open ? "open" : "closed",
                feedback == Valve::Unknown ? "null" : feedback == Valve::Open ? "\"open\"" : "\"closed\"");
  for (int i = 0; i < d.count; ++i) {
    const Reason& reason = d.reasons[i];
    Serial.printf("%s{\"code\":\"%s\"", i ? "," : "", code_name(reason.code));
    if (reason.sensor != Sensor::None) Serial.printf(",\"sensor\":\"%s\"", sensor_name(reason.sensor));
    if (std::isfinite(reason.value)) Serial.printf(",\"value\":%.3f", reason.value);
    Serial.print('}');
  }
  Serial.printf("],\"latched\":[%s]},", d.mismatch_latched ? "\"VALVE_MISMATCH\"" : "");
  print_number("irrigated_l", irrigated_l, false);
  Serial.println('}');
}

void setup() {
  pinMode(pins::VALVE_RELAY, OUTPUT);
  pinMode(pins::IRRIGATION_PUMP_RELAY, OUTPUT);
  digitalWrite(pins::VALVE_RELAY, LOW);
  digitalWrite(pins::IRRIGATION_PUMP_RELAY, LOW);
  for (int pin : {pins::VALVE_OPEN_SWITCH, pins::VALVE_CLOSED_SWITCH, pins::MAINS_PRESENT, pins::MANUAL_HOLD,
                  pins::RESET_BUTTON, pins::FLOW_PULSES}) {
    pinMode(pin, INPUT_PULLUP);
  }
  attachInterrupt(digitalPinToInterrupt(pins::FLOW_PULSES), on_flow_pulse, FALLING);
  Serial.begin(115200);
  boot_id = esp_random();
  // A stuck loop resets the board; at reset the relays drop and the valve closes.
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  esp_task_wdt_config_t wdt = {.timeout_ms = 5000, .idle_core_mask = 0, .trigger_panic = true};
  esp_task_wdt_reconfigure(&wdt);
#else
  esp_task_wdt_init(5, true);
#endif
  esp_task_wdt_add(nullptr);
  last_tick_ms = millis();
}

void loop() {
  esp_task_wdt_reset();
  unsigned long now = millis();
  if (now - last_tick_ms < 1000) return;
  double dt_s = (now - last_tick_ms) / 1000.0;
  last_tick_ms = now;

  noInterrupts();
  uint32_t pulses = flow_pulses;
  flow_pulses = 0;
  interrupts();
  double liters = pulses / cal::FLOW_PULSES_PER_LITER;
  irrigated_l += liters;

  Readings r{read_linear(pins::TURBIDITY, cal::TURBIDITY_NTU), read_linear(pins::PH, cal::PH),
             read_linear(pins::CHLORINE, cal::CHLORINE_MG_L), read_linear(pins::ORP, cal::ORP_MV),
             read_linear(pins::P1, cal::PRESSURE_BAR), read_linear(pins::P2, cal::PRESSURE_BAR),
             read_linear(pins::LEVEL, cal::LEVEL_PERCENT), liters / dt_s * 60.0};
  Valve feedback = read_valve();
  Inputs in{dt_s, digitalRead(pins::MAINS_PRESENT) == HIGH, digitalRead(pins::MANUAL_HOLD) == LOW, Mode::Auto,
            digitalRead(pins::RESET_BUTTON) == LOW, r, feedback};
  Decision d = controller.step(in);

  digitalWrite(pins::VALVE_RELAY, d.valve_command == Valve::Open ? HIGH : LOW);
  digitalWrite(pins::IRRIGATION_PUMP_RELAY, d.irrigation_pump ? HIGH : LOW);
  report(r, d, feedback);
}

export interface PIDConfig {
    kp:           number;  // proportional gain
    ki:           number;  // integral gain
    kd:           number;  // derivative gain
    setpoint:     number;  // target as fraction of cap (0.0–1.0)
    outputMin:    number;  // minimum output value (e.g. 0 upgraders)
    outputMax:    number;  // maximum output value (e.g. 4 upgraders)
    outputMid:    number;  // baseline output at zero error (e.g. 1 upgrader)
    integralMax:  number;  // anti-windup clamp (±)
}

export interface PIDState {
    integral:  number;  // accumulated error × dt
    lastError: number;  // normalized error from previous call
    lastTick:  number;  // game tick of previous call
}

export const DEFAULT_PID_CONFIG: PIDConfig = {
    kp:          3.0,
    ki:          0.2,
    kd:          1.5,
    setpoint:    0.60,  // target 60% of total energy capacity
    outputMin:   0,
    outputMax:   4,
    outputMid:   1,     // baseline = 1 upgrader at steady state
    integralMax: 5.0,
};

/**
 * Compute one PID step.
 *
 * @param pv    Process variable — current total energy (spawn + containers + storage)
 * @param cap   Total energy capacity (same components as pv)
 * @param state Previous PID state (integral, lastError, lastTick)
 * @param config PID tuning parameters
 * @param tick  Current game tick
 * @returns { output, nextState }
 *
 * Error is normalized: (pv - setpoint*cap) / cap → dimensionless, cap-independent.
 * Positive error = energy above setpoint → increase sinks (more upgraders).
 * Negative error = energy below setpoint → decrease sinks (fewer upgraders).
 * Output is offsetted by outputMid so zero error → outputMid (baseline upgrader count).
 */
export function computePID(
    pv:     number,
    cap:    number,
    state:  PIDState,
    config: PIDConfig,
    tick:   number,
): { output: number; nextState: PIDState } {
    const setpointAbs = config.setpoint * cap;
    const error       = (pv - setpointAbs) / Math.max(cap, 1);   // normalized error

    const dt = Math.max(1, tick - state.lastTick);

    // Proportional
    const p = config.kp * error;

    // Integral with anti-windup clamp
    const rawIntegral = state.integral + error * dt;
    const integral    = Math.max(-config.integralMax, Math.min(config.integralMax, rawIntegral));
    const i           = config.ki * integral;

    // Derivative (error rate of change per tick)
    const d = config.kd * (error - state.lastError) / dt;

    // Output = baseline + PID correction
    const raw    = config.outputMid + p + i + d;
    const output = Math.max(config.outputMin, Math.min(config.outputMax, raw));

    return {
        output,
        nextState: { integral, lastError: error, lastTick: tick },
    };
}

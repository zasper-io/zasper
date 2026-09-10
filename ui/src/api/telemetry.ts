import { requestBeacon, requestJson } from './client';

/** Response of /api/telemetry/settings. */
export interface ITelemetrySettings {
  /** Whether anything is actually being sent, after the flag and the environment have had their say. */
  enabled: boolean;
  /** False only on an install that has never been asked, which is what shows the notice once. */
  chosen: boolean;
}

export function getTelemetrySettings(): Promise<ITelemetrySettings> {
  return requestJson<ITelemetrySettings>('/api/telemetry/settings');
}

export function setTelemetrySettings(body: {
  enabled?: boolean;
  reset_id?: boolean;
}): Promise<ITelemetrySettings> {
  return requestJson<ITelemetrySettings>('/api/telemetry/settings', {
    method: 'POST',
    body,
  });
}

/** Fire-and-forget: a batch of events that nothing waits for and no failure is reported for. */
export function sendTelemetry(events: unknown[]): void {
  requestBeacon('/api/telemetry', { events });
}
